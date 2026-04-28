import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  bindSessionContext,
  buildComputerUseTools,
  DEFAULT_GRANT_FLAGS,
  getDefaultTierForApp,
  type AppGrant,
  type ComputerUseSessionContext,
  type CuCallToolResult,
  type CuGrantFlags,
  type CuPermissionRequest,
  type CuPermissionResponse,
  type ScreenshotDims,
} from '../../vendor/computer-use-mcp/index.js'
import { isComputerUseSupportedPlatform } from '../../utils/computerUse/common.js'
import { getChicagoCoordinateMode } from '../../utils/computerUse/gates.js'
import { getComputerUseHostAdapter } from '../../utils/computerUse/hostAdapter.js'
import {
  COMPUTER_WIDE_ACCESS_BUNDLE_ID,
  COMPUTER_WIDE_ACCESS_DISPLAY_NAME,
  resolveStoredComputerUseConfig,
  type StoredComputerUseConfig,
} from '../../utils/computerUse/preauthorizedConfig.js'
import { getAppDataDir } from '../utils/paths.js'
import type { ChatContentBlock } from './types.js'

type ComputerUseDispatch = (name: string, args: unknown) => Promise<CuCallToolResult>

type ToolDefinition = {
  name: string
  description: string
  input_schema: Record<string, unknown>
  risk: 'read' | 'write' | 'execute' | 'external'
}

type ToolExecutionResult = {
  content: string | ChatContentBlock[]
  isError?: boolean
  metadata?: {
    summary?: string
    durationMs?: number
  }
}

type ComputerUseSessionState = {
  allowedApps: AppGrant[]
  grantFlags: CuGrantFlags
  selectedDisplayId?: number
  displayPinnedByModel: boolean
  displayResolvedForApps?: string
  lastScreenshotDims?: ScreenshotDims
  hiddenBundleIds: Set<string>
  clipboardStash?: string
  dispatch: ComputerUseDispatch
}

type McpToolLike = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

const CONFIG_FILE = 'computer-use-config.json'
const TEXT_PREVIEW_LIMIT = 120

export class ComputerUseRuntime {
  private definitions: ToolDefinition[] | null = null
  private definitionNames = new Set<string>()
  private sessions = new Map<string, ComputerUseSessionState>()
  private lockHolder: string | undefined

  getDefinitions(): ToolDefinition[] {
    if (this.definitions) return this.definitions
    if (!isComputerUseSupportedPlatform()) {
      this.definitions = []
      return this.definitions
    }

    const adapter = getComputerUseHostAdapter()
    const tools = buildComputerUseTools(
      adapter.executor.capabilities,
      getChicagoCoordinateMode(),
    ) as McpToolLike[]

    this.definitions = tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? `Computer Use tool: ${tool.name}`,
      input_schema: tool.inputSchema ?? { type: 'object', properties: {} },
      // Computer Use has its own app-level approval dialog. The generic
      // desktop permission system should not add a second prompt on top.
      risk: 'read',
    }))
    this.definitionNames = new Set(this.definitions.map((tool) => tool.name))
    return this.definitions
  }

  hasTool(toolName: string): boolean {
    this.getDefinitions()
    return this.definitionNames.has(toolName)
  }

  getRisk(toolName: string): ToolDefinition['risk'] | null {
    return this.hasTool(toolName) ? 'read' : null
  }

  async execute(
    toolName: string,
    input: unknown,
    context: { sessionId: string; signal: AbortSignal },
  ): Promise<ToolExecutionResult> {
    if (!this.hasTool(toolName)) {
      return { content: `Unknown Computer Use tool: ${toolName}`, isError: true }
    }

    const state = await this.ensureSession(context.sessionId, context.signal)
    const result = await state.dispatch(toolName, input)
    const content = convertComputerUseContent(result.content)

    return {
      content,
      isError: result.isError === true,
      metadata: {
        summary: summarizeComputerUseResult(toolName, result, content),
      },
    }
  }

  async cleanupSessionTurn(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) return

    if (state.clipboardStash !== undefined) {
      try {
        await getComputerUseHostAdapter().executor.writeClipboard(state.clipboardStash)
      } catch {
        // Best effort. Keep the UI responsive even if the OS clipboard refuses.
      }
      state.clipboardStash = undefined
    }

    state.hiddenBundleIds.clear()
    if (this.lockHolder === sessionId) {
      this.lockHolder = undefined
    }
  }

  cancelSession(sessionId: string): void {
    if (this.lockHolder === sessionId) {
      this.lockHolder = undefined
    }
    void import('../services/computerUseApprovalService.js')
      .then(({ computerUseApprovalService }) => {
        computerUseApprovalService.cancelSession(sessionId)
      })
      .catch(() => undefined)
  }

  private async ensureSession(
    sessionId: string,
    signal: AbortSignal,
  ): Promise<ComputerUseSessionState> {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing

    const adapter = getComputerUseHostAdapter()
    const initial = await loadDesktopComputerUseConfig()
    const state: ComputerUseSessionState = {
      allowedApps: initial.allowedApps,
      grantFlags: initial.grantFlags,
      displayPinnedByModel: false,
      hiddenBundleIds: new Set(),
      dispatch: async () => ({
        content: [{ type: 'text', text: 'Computer Use session is still initializing.' }],
        isError: true,
      }),
    }

    const ctx: ComputerUseSessionContext = {
      getAllowedApps: () => state.allowedApps,
      getGrantFlags: () => state.grantFlags,
      getUserDeniedBundleIds: () => [],
      getSelectedDisplayId: () => state.selectedDisplayId,
      getDisplayPinnedByModel: () => state.displayPinnedByModel,
      getDisplayResolvedForApps: () => state.displayResolvedForApps,
      getLastScreenshotDims: () => state.lastScreenshotDims,
      onPermissionRequest: (req, dialogSignal) =>
        this.requestApproval(sessionId, req, mergeAbortSignals(signal, dialogSignal)),
      onAllowedAppsChanged: (apps, flags) => {
        state.allowedApps = [...apps]
        state.grantFlags = flags
      },
      onAppsHidden: (bundleIds) => {
        for (const bundleId of bundleIds) state.hiddenBundleIds.add(bundleId)
      },
      getClipboardStash: () => state.clipboardStash,
      onClipboardStashChanged: (stash) => {
        state.clipboardStash = stash
      },
      onResolvedDisplayUpdated: (displayId) => {
        state.selectedDisplayId = displayId
        state.displayPinnedByModel = false
        state.displayResolvedForApps = undefined
      },
      onDisplayPinned: (displayId) => {
        state.selectedDisplayId = displayId
        state.displayPinnedByModel = displayId !== undefined
        if (displayId === undefined) state.displayResolvedForApps = undefined
      },
      onDisplayResolvedForApps: (key) => {
        state.displayResolvedForApps = key
      },
      onScreenshotCaptured: (dims) => {
        state.lastScreenshotDims = dims
      },
      checkCuLock: async () => ({
        holder: this.lockHolder,
        isSelf: this.lockHolder === undefined || this.lockHolder === sessionId,
      }),
      acquireCuLock: async () => {
        if (this.lockHolder === undefined) {
          this.lockHolder = sessionId
          return
        }
        if (this.lockHolder !== sessionId) {
          throw new Error('Computer Use is already active in another session.')
        }
      },
      formatLockHeldMessage: (holder) =>
        `Computer Use is active in another session (${holder.slice(0, 8)}). Wait for that session to finish, then try again.`,
      isAborted: () => signal.aborted,
    }

    state.dispatch = bindSessionContext(adapter, getChicagoCoordinateMode(), ctx)
    this.sessions.set(sessionId, state)
    return state
  }

  private async requestApproval(
    sessionId: string,
    request: CuPermissionRequest,
    signal: AbortSignal,
  ): Promise<CuPermissionResponse> {
    if (signal.aborted) {
      throw new Error('Computer Use permission request was cancelled.')
    }

    return await new Promise<CuPermissionResponse>((resolve, reject) => {
      const abort = () => {
        void import('../services/computerUseApprovalService.js')
          .then(({ computerUseApprovalService }) => {
            computerUseApprovalService.cancelSession(sessionId)
          })
          .catch(() => undefined)
        reject(new Error('Computer Use permission request was cancelled.'))
      }

      signal.addEventListener('abort', abort, { once: true })
      void import('../services/computerUseApprovalService.js')
        .then(({ computerUseApprovalService }) =>
          computerUseApprovalService.requestApproval(sessionId, request),
        )
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort))
    })
  }
}

async function loadDesktopComputerUseConfig(): Promise<{
  allowedApps: AppGrant[]
  grantFlags: CuGrantFlags
}> {
  const configPath = join(getAppDataDir(), CONFIG_FILE)
  await mkdir(getAppDataDir(), { recursive: true }).catch(() => undefined)

  let parsed: StoredComputerUseConfig | undefined
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf-8')) as StoredComputerUseConfig
  } catch {
    parsed = undefined
  }

  const resolved = resolveStoredComputerUseConfig(parsed)
  const now = Date.now()
  const allowedApps: AppGrant[] = resolved.authorizedApps.map((app) => ({
    bundleId: app.bundleId,
    displayName: app.displayName,
    grantedAt: now,
    tier: getDefaultTierForApp(app.bundleId, app.displayName),
  }))
  if (resolved.computerWideAccess) {
    allowedApps.unshift({
      bundleId: COMPUTER_WIDE_ACCESS_BUNDLE_ID,
      displayName: COMPUTER_WIDE_ACCESS_DISPLAY_NAME,
      grantedAt: now,
      tier: 'full',
    })
  }

  return {
    allowedApps,
    grantFlags: {
      ...DEFAULT_GRANT_FLAGS,
      ...resolved.grantFlags,
    },
  }
}

function convertComputerUseContent(
  content: CuCallToolResult['content'],
): ToolExecutionResult['content'] {
  const blocks: ChatContentBlock[] = []

  for (const part of content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text })
      continue
    }
    if (part.type === 'image') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: part.mimeType ?? 'image/png',
          data: part.data,
        },
      })
    }
  }

  const hasImage = blocks.some((block) => block.type === 'image')
  if (!hasImage) {
    return blocks
      .filter((block): block is Extract<ChatContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
  }

  return blocks
}

function summarizeComputerUseResult(
  toolName: string,
  result: CuCallToolResult,
  content: ToolExecutionResult['content'],
): string {
  if (result.isError) return 'Computer Use failed'
  if (toolName === 'screenshot') return 'Screenshot captured'
  if (toolName === 'zoom') return 'Zoom captured'
  if (toolName === 'request_access') return 'Computer Use access updated'

  const text = typeof content === 'string'
    ? content
    : content
      .filter((block): block is Extract<ChatContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join(' ')
      .trim()
  if (!text) return `Computer Use: ${toolName}`
  return text.length > TEXT_PREVIEW_LIMIT
    ? `${text.slice(0, TEXT_PREVIEW_LIMIT)}...`
    : text
}

function mergeAbortSignals(primary: AbortSignal, secondary: AbortSignal): AbortSignal {
  if (primary.aborted || secondary.aborted) {
    const controller = new AbortController()
    controller.abort()
    return controller.signal
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  primary.addEventListener('abort', abort, { once: true })
  secondary.addEventListener('abort', abort, { once: true })
  return controller.signal
}

export const computerUseRuntime = new ComputerUseRuntime()
