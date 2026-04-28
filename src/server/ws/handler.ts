/**
 * WebSocket connection handler
 *
 * 管理 WebSocket 连接生命周期，处理消息路由。
 * Chat / Code 都走桌面端原生 runtime；不再启动或桥接 CLI 子进程。
 */

import type { ServerWebSocket } from 'bun'
import type { ClientMessage, ServerMessage } from './events.js'
import { computerUseApprovalService } from '../services/computerUseApprovalService.js'
import { sessionService } from '../services/sessionService.js'
import { SettingsService } from '../services/settingsService.js'
import { ProviderService } from '../services/providerService.js'
import { deriveTitle, generateTitle, saveAiTitle } from '../services/titleService.js'
import { chatEngine } from '../runtime/ChatEngine.js'
import { codeEngine } from '../runtime/CodeEngine.js'
import {
  ProviderConfigError,
  ProviderRequestError,
} from '../runtime/ProviderAdapter.js'
import { permissionService } from '../runtime/PermissionService.js'
import {
  toolRuntime,
  type ToolExecutionMetadata,
} from '../runtime/ToolRuntime.js'
import type { RuntimeSettings } from '../runtime/types.js'

const settingsService = new SettingsService()
const providerService = new ProviderService()

/**
 * Timers for delayed session cleanup after client disconnect.
 * If a client reconnects within 5 minutes, the timer is cancelled.
 */
const sessionCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
const nativeAbortControllers = new Map<string, AbortController>()

/**
 * Track user message count and title state per session for auto-title generation.
 */
const sessionTitleState = new Map<string, {
  userMessageCount: number
  hasCustomTitle: boolean
  firstUserMessage: string
  allUserMessages: string[]
}>()

export type WebSocketData = {
  sessionId: string
  connectedAt: number
  serverPort: number
  serverHost: string
}

// Active WebSocket sessions
const activeSessions = new Map<string, ServerWebSocket<WebSocketData>>()

export const handleWebSocket = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const { sessionId } = ws.data

    console.log(`[WS] Client connected for session: ${sessionId}`)

    // Cancel pending cleanup timer if client reconnects
    const pendingTimer = sessionCleanupTimers.get(sessionId)
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      sessionCleanupTimers.delete(sessionId)
    }

    activeSessions.set(sessionId, ws)

    const msg: ServerMessage = { type: 'connected', sessionId }
    ws.send(JSON.stringify(msg))
  },

  message(ws: ServerWebSocket<WebSocketData>, rawMessage: string | Buffer) {
    try {
      const message = JSON.parse(
        typeof rawMessage === 'string' ? rawMessage : rawMessage.toString()
      ) as ClientMessage

      switch (message.type) {
        case 'user_message':
          handleUserMessage(ws, message).catch((err) => {
            console.error(`[WS] Unhandled error in handleUserMessage:`, err)
          })
          break

        case 'rollback_patch':
          handleRollbackPatch(ws, message).catch((err) => {
            console.error(`[WS] Unhandled error in handleRollbackPatch:`, err)
          })
          break

        case 'permission_response':
          handlePermissionResponse(ws, message)
          break

        case 'computer_use_permission_response':
          handleComputerUsePermissionResponse(ws, message)
          break

        case 'set_permission_mode':
          handleSetPermissionMode(ws, message)
          break

        case 'stop_generation':
          handleStopGeneration(ws)
          break

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' } satisfies ServerMessage))
          break

        default:
          sendError(ws, `Unknown message type: ${(message as any).type}`, 'UNKNOWN_TYPE')
      }
    } catch (error) {
      sendError(ws, `Invalid message format: ${error}`, 'PARSE_ERROR')
    }
  },

  close(ws: ServerWebSocket<WebSocketData>, code: number, reason: string) {
    const { sessionId } = ws.data

    console.log(`[WS] Client disconnected from session: ${sessionId} (${code}: ${reason})`)
    computerUseApprovalService.cancelSession(sessionId)
    activeSessions.delete(sessionId)
    permissionService.cancelSession(sessionId)
    sessionTitleState.delete(sessionId)

    // Schedule delayed cleanup: if the client doesn't reconnect within 30 seconds,
    // stop the native runtime to avoid leaking work.
    const cleanupTimer = setTimeout(() => {
      sessionCleanupTimers.delete(sessionId)
      if (!activeSessions.has(sessionId)) {
        console.log(`[WS] Session ${sessionId} not reconnected after 30s, stopping conversation runtime`)
        nativeAbortControllers.get(sessionId)?.abort()
        nativeAbortControllers.delete(sessionId)
        permissionService.cancelSession(sessionId)
      }
    }, 30_000)
    sessionCleanupTimers.set(sessionId, cleanupTimer)
  },

  drain(ws: ServerWebSocket<WebSocketData>) {
    // Backpressure handling - called when the socket is ready to receive more data
  },
}

// ============================================================================
// Message handlers
// ============================================================================

async function handleUserMessage(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'user_message' }>
) {
  const { sessionId } = ws.data

  sendMessage(ws, { type: 'status', state: 'thinking', verb: 'Thinking' })

  const { sessionMode } = await resolveSessionLaunchContext(sessionId)
  const runtimeSettings = {
    ...(await getRuntimeSettings()),
    mode: sessionMode,
  }

  trackUserMessageForTitle(sessionId, message.content)

  await handleNativeRuntimeMessage(ws, message, runtimeSettings)
}

async function resolveSessionLaunchContext(
  sessionId: string,
): Promise<{ sessionMode: 'chat' | 'code' }> {
  let sessionMode: 'chat' | 'code' = 'code'

  try {
    const launchInfo = await sessionService.getSessionLaunchInfo(sessionId)
    sessionMode = launchInfo?.mode ?? 'code'
    console.log(
      `[WS] handleUserMessage: sessionId=${sessionId}, mode=${sessionMode}, native runtime`,
    )
  } catch (resolveErr) {
    console.warn(
      `[WS] handleUserMessage: failed to resolve launch context for ${sessionId}: ${
        resolveErr instanceof Error ? resolveErr.message : String(resolveErr)
      }`,
    )
  }

  return { sessionMode }
}

function trackUserMessageForTitle(sessionId: string, content: string): void {
  let titleState = sessionTitleState.get(sessionId)
  if (!titleState) {
    titleState = {
      userMessageCount: 0,
      hasCustomTitle: false,
      firstUserMessage: '',
      allUserMessages: [],
    }
    sessionTitleState.set(sessionId, titleState)
  }

  titleState.userMessageCount++
  titleState.allUserMessages.push(content)
  if (titleState.userMessageCount === 1) {
    titleState.firstUserMessage = content
  }
}

async function handleNativeRuntimeMessage(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'user_message' }>,
  runtimeSettings: RuntimeSettings,
): Promise<void> {
  const { sessionId } = ws.data
  const previousController = nativeAbortControllers.get(sessionId)
  previousController?.abort()

  const controller = new AbortController()
  nativeAbortControllers.set(sessionId, controller)
  let completed = false
  const engine = runtimeSettings.mode === 'chat' ? chatEngine : codeEngine

  try {
    for await (const serverMessage of engine.sendMessage({
      sessionId,
      content: message.content,
      attachments: message.attachments,
      settings: runtimeSettings,
      signal: controller.signal,
    })) {
      sendMessage(ws, serverMessage)
      if (serverMessage.type === 'message_complete') {
        completed = true
        triggerTitleGeneration(ws, sessionId)
      }
    }
  } catch (err) {
    if (controller.signal.aborted || isAbortError(err)) {
      if (!completed) {
        sendMessage(ws, {
          type: 'message_complete',
          usage: { input_tokens: 0, output_tokens: 0 },
        })
      }
      return
    }

    const errMsg = err instanceof Error ? err.message : String(err)
    const code =
      err instanceof ProviderConfigError
        ? 'PROVIDER_NOT_CONFIGURED'
        : err instanceof ProviderRequestError
          ? err.providerCode ?? 'PROVIDER_REQUEST_FAILED'
          : 'DESKTOP_RUNTIME_ERROR'

    console.error(`[WS] Native runtime failed for ${sessionId}: ${errMsg}`)
    sendMessage(ws, {
      type: 'error',
      message: errMsg,
      code,
      retryable: err instanceof ProviderRequestError,
    })
  } finally {
    if (nativeAbortControllers.get(sessionId) === controller) {
      nativeAbortControllers.delete(sessionId)
    }
  }
}

async function handleRollbackPatch(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'rollback_patch' }>,
): Promise<void> {
  const { sessionId } = ws.data
  const reversePatch = typeof message.reversePatch === 'string'
    ? message.reversePatch
    : ''
  if (!reversePatch.trim()) {
    sendError(ws, 'Rollback patch is empty.', 'INVALID_ROLLBACK_PATCH')
    return
  }

  if (nativeAbortControllers.has(sessionId)) {
    sendError(ws, 'Another native operation is already running in this session.', 'NATIVE_RUNTIME_BUSY')
    return
  }

  const launchInfo = await sessionService.getSessionLaunchInfo(sessionId)
  const workDir = launchInfo?.workDir
  if (launchInfo?.mode !== 'code' || !workDir) {
    sendError(ws, 'Patch rollback requires a Code mode session with a project folder.', 'PROJECT_REQUIRED')
    return
  }

  const controller = new AbortController()
  nativeAbortControllers.set(sessionId, controller)
  const toolUseId = `rollback_${crypto.randomUUID()}`
  const toolInput = { patch: reversePatch }
  const description = `Rollback patch from ${message.originalToolUseId || 'previous tool'}`

  try {
    sendMessage(ws, {
      type: 'content_start',
      blockType: 'tool_use',
      toolName: 'apply_patch',
      toolUseId,
    })
    sendMessage(ws, {
      type: 'tool_use_complete',
      toolName: 'apply_patch',
      toolUseId,
      input: toolInput,
    })
    await sessionService.appendAssistantMessage(
      sessionId,
      [{
        type: 'tool_use',
        id: toolUseId,
        name: 'apply_patch',
        input: toolInput,
      }],
      { model: 'ycode-desktop' },
    )

    const risk = toolRuntime.getRisk('apply_patch')
    if (!risk) {
      throw new Error('apply_patch tool is unavailable.')
    }

    const requestId = crypto.randomUUID()
    const permissionRequest = {
      requestId,
      sessionId,
      projectPath: workDir,
      toolUseId,
      toolName: 'apply_patch',
      input: toolInput,
      risk,
      description,
    }

    if (permissionService.shouldAsk(permissionRequest)) {
      sendMessage(ws, {
        type: 'permission_request',
        requestId,
        toolName: 'apply_patch',
        toolUseId,
        input: toolInput,
        description,
      })

      const decision = await permissionService.waitForDecision(
        permissionRequest,
        controller.signal,
      )
      if (!decision.allowed) {
        await sendAndPersistRollbackResult({
          ws,
          sessionId,
          toolUseId,
          content: 'User denied this patch rollback.',
          isError: true,
        })
        return
      }
    }

    sendMessage(ws, {
      type: 'status',
      state: 'tool_executing',
      verb: 'Rolling back patch',
    })

    const result = await toolRuntime.execute('apply_patch', toolInput, {
      sessionId,
      workDir,
      signal: controller.signal,
    })

    await sendAndPersistRollbackResult({
      ws,
      sessionId,
      toolUseId,
      content: result.content,
      isError: result.isError === true,
      metadata: result.metadata,
    })
  } catch (err) {
    if (controller.signal.aborted || isAbortError(err)) {
      await sendAndPersistRollbackResult({
        ws,
        sessionId,
        toolUseId,
        content: 'Patch rollback was cancelled.',
        isError: true,
      }).catch(() => undefined)
      return
    }

    const messageText = err instanceof Error ? err.message : String(err)
    await sendAndPersistRollbackResult({
      ws,
      sessionId,
      toolUseId,
      content: messageText,
      isError: true,
    }).catch(() => undefined)
  } finally {
    if (nativeAbortControllers.get(sessionId) === controller) {
      nativeAbortControllers.delete(sessionId)
    }
    sendMessage(ws, { type: 'status', state: 'idle' })
  }
}

async function sendAndPersistRollbackResult(args: {
  ws: ServerWebSocket<WebSocketData>
  sessionId: string
  toolUseId: string
  content: string
  isError: boolean
  metadata?: ToolExecutionMetadata
}): Promise<void> {
  const metadata = args.metadata
  sendMessage(args.ws, {
    type: 'tool_result',
    toolUseId: args.toolUseId,
    content: args.content,
    isError: args.isError,
    ...(metadata ? { metadata } : {}),
  })

  await sessionService.appendUserMessage(args.sessionId, [{
    type: 'tool_result',
    tool_use_id: args.toolUseId,
    content: args.content,
    is_error: args.isError,
    ...(metadata ? { metadata } : {}),
  }])
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException && err.name === 'AbortError'
  ) || (
    err instanceof Error && err.name === 'AbortError'
  )
}

function handlePermissionResponse(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'permission_response' }>
) {
  const { sessionId } = ws.data
  const ok = permissionService.respond(message.requestId, {
    allowed: message.allowed,
    rule: message.rule,
    updatedInput: message.updatedInput,
  })
  if (!ok) {
    console.warn(`[WS] Ignored permission response for unknown native request ${message.requestId} from ${sessionId}`)
  }
  console.log(`[WS] Permission response for ${message.requestId}: ${message.allowed}`)
}

function handleComputerUsePermissionResponse(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'computer_use_permission_response' }>
) {
  const { sessionId } = ws.data
  const ok = computerUseApprovalService.resolveApproval(
    message.requestId,
    message.response,
  )
  if (!ok) {
    console.warn(
      `[WS] Ignored Computer Use permission response for unknown request ${message.requestId} from ${sessionId}`
    )
  }
}

function handleSetPermissionMode(
  ws: ServerWebSocket<WebSocketData>,
  message: Extract<ClientMessage, { type: 'set_permission_mode' }>
) {
  const { sessionId } = ws.data
  void settingsService.setPermissionMode(message.mode)
    .then(() => {
      sendMessage(ws, {
        type: 'system_notification',
        subtype: 'permission_mode',
        message: `Permission mode updated to ${message.mode}`,
        data: { sessionId, mode: message.mode },
      })
    })
    .catch((err) => {
      sendMessage(ws, {
        type: 'error',
        code: 'PERMISSION_MODE_UPDATE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      })
    })
}

function handleStopGeneration(ws: ServerWebSocket<WebSocketData>) {
  const { sessionId } = ws.data
  console.log(`[WS] Stop generation requested for session: ${sessionId}`)

  const nativeController = nativeAbortControllers.get(sessionId)
  if (nativeController) {
    nativeController.abort()
    nativeAbortControllers.delete(sessionId)
  }
  permissionService.cancelSession(sessionId)

  sendMessage(ws, { type: 'status', state: 'idle' })
}

// ============================================================================
// Title generation
// ============================================================================

function triggerTitleGeneration(ws: ServerWebSocket<WebSocketData>, sessionId: string): void {
  const state = sessionTitleState.get(sessionId)
  if (!state || state.hasCustomTitle) return

  const count = state.userMessageCount

  // Generate on count 1 (first response) and count 3 (with more context)
  if (count !== 1 && count !== 3) return

  const text = count === 1
    ? state.firstUserMessage
    : state.allUserMessages.join('\n')

  // Fire-and-forget: derive quick title, then upgrade with AI
  void (async () => {
    try {
      // Stage 1: quick placeholder (only on first message)
      if (count === 1) {
        const placeholder = deriveTitle(text)
        if (placeholder) {
          await saveAiTitle(sessionId, placeholder)
          sendMessage(ws, { type: 'session_title_updated', sessionId, title: placeholder })
        }
      }

      // Stage 2: AI-generated title
      const aiTitle = await generateTitle(text)
      if (aiTitle) {
        await saveAiTitle(sessionId, aiTitle)
        sendMessage(ws, { type: 'session_title_updated', sessionId, title: aiTitle })
      }
    } catch (err) {
      console.error(`[Title] Failed to generate title for ${sessionId}:`, err)
    }
  })()
}

// ============================================================================
// Helpers
// ============================================================================

function sendMessage(ws: ServerWebSocket<WebSocketData>, message: ServerMessage) {
  ws.send(JSON.stringify(message))
}

function sendError(ws: ServerWebSocket<WebSocketData>, message: string, code: string) {
  sendMessage(ws, { type: 'error', message, code })
}

async function getRuntimeSettings(): Promise<{
  permissionMode?: string
  model?: string
  effort?: string
}> {
  const userSettings = await settingsService.getUserSettings()
  const modelContext =
    typeof userSettings.modelContext === 'string' && userSettings.modelContext.trim()
      ? userSettings.modelContext
      : undefined
  const effort =
    typeof userSettings.effort === 'string' && userSettings.effort.trim()
      ? userSettings.effort
      : undefined

  // Check if a custom provider is active
  const { activeId } = await providerService.listProviders()

  let model: string | undefined
  if (activeId) {
    // Provider is active — only pass a model override if the user explicitly
    // selected a non-default model. Otherwise use the provider snapshot model.
    const baseModel = (userSettings.model as string) || ''
    if (baseModel && baseModel !== 'claude-sonnet-4-6') {
      // User explicitly selected a different model — pass it through
      model = baseModel
      if (modelContext) model += `:${modelContext}`
    }
  } else {
    // No provider — pass model normally
    const baseModel =
      typeof userSettings.model === 'string' && userSettings.model.trim()
        ? userSettings.model
        : undefined
    model = baseModel ? (modelContext ? `${baseModel}:${modelContext}` : baseModel) : undefined
  }

  return {
    permissionMode: await settingsService.getPermissionMode().catch(() => undefined),
    model,
    effort,
  }
}

/**
 * Send a message to a specific session's WebSocket (for use by services)
 */
export function sendToSession(sessionId: string, message: ServerMessage): boolean {
  const ws = activeSessions.get(sessionId)
  if (!ws) return false
  ws.send(JSON.stringify(message))
  return true
}

export function getActiveSessionIds(): string[] {
  return Array.from(activeSessions.keys())
}
