import { sessionService, type MessageEntry } from '../services/sessionService.js'
import type { AttachmentRef, ServerMessage, TokenUsage } from '../ws/events.js'
import type {
  ChatContentBlock,
  ChatModelMessage,
  ChatModelRequest,
  ConversationEngine,
  ModelStreamEvent,
  RuntimeProviderSnapshot,
  SendMessageInput,
} from './types.js'
import { ProviderAdapter } from './ProviderAdapter.js'
import {
  permissionService,
  type PermissionService,
} from './PermissionService.js'
import {
  chatToolRuntime,
  type ChatToolRuntime,
} from './ChatToolRuntime.js'
import type {
  ToolDefinition,
  ToolExecutionMetadata,
} from './ToolRuntime.js'
import {
  resolveComputerUseRouting,
  type ComputerUseRouting,
} from './computerUseRouting.js'
import {
  resolveComputerUseDirectIntent,
  toolResultReportsCompleted,
  type ComputerUseDirectIntentPlan,
} from './computerUseDirectIntent.js'

const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_MAX_TOOL_LOOPS = 6
const COMPUTER_USE_MAX_TOOL_LOOPS = 18
const MAX_ATTACHED_TEXT_CHARS = 40_000

type ChatEngineOptions = {
  providerAdapter?: ProviderAdapter
  sessionStore?: typeof sessionService
  permissionService?: PermissionService
  chatToolRuntime?: ChatToolRuntime
}

type ToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

type ToolExecutionResultContent = string | ChatContentBlock[]

type ActiveToolBlock = {
  id: string
  name: string
  inputJson: string
  initialInput: Record<string, unknown>
}

type SyntheticToolCallResult = {
  parentUuid: string | null
  toolCall: ToolCall
  content: ToolExecutionResultContent
  isError: boolean
}

type DirectIntentRunResult = {
  parentUuid: string | null
  shouldContinue: boolean
  modelMessages: ChatModelMessage[]
}

export class ChatEngine implements ConversationEngine {
  private providerAdapter: ProviderAdapter
  private sessionStore: typeof sessionService
  private permissions: PermissionService
  private tools: ChatToolRuntime

  constructor(options?: ChatEngineOptions) {
    this.providerAdapter = options?.providerAdapter ?? new ProviderAdapter()
    this.sessionStore = options?.sessionStore ?? sessionService
    this.permissions = options?.permissionService ?? permissionService
    this.tools = options?.chatToolRuntime ?? chatToolRuntime
  }

  async *sendMessage(input: SendMessageInput): AsyncIterable<ServerMessage> {
    try {
      const snapshot = await this.providerAdapter.resolveSnapshot(input.settings?.model)
      const history = await this.loadHistory(input.sessionId)
      const rawUserMessage = buildUserMessage(input.content, input.attachments)
      const userUuid = await this.sessionStore.appendUserMessage(
        input.sessionId,
        rawUserMessage.content as string | Array<Record<string, unknown>>,
      )

      const messages: ChatModelMessage[] = [...history, rawUserMessage]
      const usage: TokenUsage = { input_tokens: 0, output_tokens: 0 }
      const toolDefinitions = this.tools.getDefinitions()
      const computerUseRouting = resolveComputerUseRouting(input.content, toolDefinitions)
      const maxToolLoops = computerUseRouting ? COMPUTER_USE_MAX_TOOL_LOOPS : DEFAULT_MAX_TOOL_LOOPS
      let parentUuid = userUuid
      let loopStart = 0

      const directIntent = resolveComputerUseDirectIntent(input.content, toolDefinitions)
      if (directIntent) {
        const directResult = yield* this.runComputerUseDirectIntent({
          input,
          snapshot,
          parentUuid,
          directIntent,
        })
        parentUuid = directResult.parentUuid
        if (!directResult.shouldContinue) {
          yield { type: 'message_complete', usage }
          return
        }
        messages.push(...directResult.modelMessages)
        loopStart = 2
      }

      for (let loop = loopStart; loop < maxToolLoops; loop++) {
        const assistantTurn = yield* this.runAssistantTurn({
          input,
          snapshot,
          messages,
          usage,
          toolDefinitions,
          computerUseRouting,
          loop,
        })

        if (assistantTurn.failed) return

        const persistedBlocks =
          assistantTurn.blocks.length > 0
            ? assistantTurn.blocks
            : [{ type: 'text', text: '' } satisfies ChatContentBlock]
        parentUuid = await this.sessionStore.appendAssistantMessage(
          input.sessionId,
          persistedBlocks as Array<Record<string, unknown>>,
          { model: snapshot.model, parentUuid },
        ) ?? parentUuid

        if (assistantTurn.blocks.length > 0) {
          messages.push({ role: 'assistant', content: assistantTurn.blocks })
        } else {
          messages.push({ role: 'assistant', content: persistedBlocks })
        }

        if (assistantTurn.toolCalls.length === 0) {
          yield { type: 'message_complete', usage }
          return
        }

        const modelToolResults: ChatContentBlock[] = []
        const persistedToolResults: Array<Record<string, unknown>> = []
        for (const toolCall of assistantTurn.toolCalls) {
          const result = yield* this.executeToolCall({ input, toolCall })
          modelToolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: result.content,
            is_error: result.isError,
          })
          persistedToolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: result.content,
            is_error: result.isError,
            ...(result.metadata ? { metadata: result.metadata } : {}),
          })
        }

        await this.sessionStore.appendUserMessage(input.sessionId, persistedToolResults)
        messages.push({ role: 'user', content: modelToolResults })
      }

      yield {
        type: 'error',
        code: 'TOOL_LOOP_LIMIT',
        message: computerUseRouting
          ? 'Computer Use paused after many desktop actions. Send “继续” to keep going from the current app state.'
          : 'Chat mode paused after too many tool steps. Send “继续” to keep going.',
      }
      yield { type: 'message_complete', usage }
    } finally {
      await Promise.resolve(
        (this.tools as Partial<Pick<ChatToolRuntime, 'cleanupSessionTurn'>>)
          .cleanupSessionTurn?.(input.sessionId),
      ).catch(() => undefined)
    }
  }

  async stop(sessionId: string): Promise<void> {
    ;(this.tools as Partial<Pick<ChatToolRuntime, 'cancelSession'>>)
      .cancelSession?.(sessionId)
  }

  private async *runAssistantTurn(args: {
    input: SendMessageInput
    snapshot: RuntimeProviderSnapshot
    messages: ChatModelMessage[]
    usage: TokenUsage
    toolDefinitions: ToolDefinition[]
    computerUseRouting: ComputerUseRouting | null
    loop: number
  }): AsyncIterable<ServerMessage, {
    blocks: ChatContentBlock[]
    toolCalls: ToolCall[]
    failed: boolean
  }> {
    yield { type: 'status', state: 'thinking' }

    const assistantBlocks: ChatContentBlock[] = []
    const toolCalls: ToolCall[] = []
    const activeToolBlocks = new Map<number, ActiveToolBlock>()
    const activeBlockTypes = new Map<number, 'text' | 'thinking' | 'tool_use'>()
    let currentText = ''
    let failed = false

    const request: ChatModelRequest = {
      model: args.snapshot.model,
      max_tokens: DEFAULT_MAX_TOKENS,
      stream: true,
      messages: cloneModelMessages(args.messages),
      ...(args.toolDefinitions.length > 0
        ? {
            tools: args.toolDefinitions.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.input_schema,
            })),
            tool_choice: { type: 'auto' },
          }
        : {}),
    }
    if (args.computerUseRouting) {
      request.system = args.computerUseRouting.systemHint
      if (args.loop === 0 && args.computerUseRouting.forceInitialToolChoice) {
        request.tool_choice = args.computerUseRouting.forceInitialToolChoice
      }
    }

    for await (const event of this.providerAdapter.stream(
      request,
      args.snapshot,
      args.input.signal,
    )) {
      const out = translateModelEvent(event, {
        snapshot: args.snapshot,
        usage: args.usage,
        activeToolBlocks,
        activeBlockTypes,
        appendText(text) {
          currentText += text
        },
        closeTextBlock() {
          if (!currentText) return
          assistantBlocks.push({ type: 'text', text: currentText })
          currentText = ''
        },
        addToolCall(toolCall) {
          assistantBlocks.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
          })
          toolCalls.push(toolCall)
        },
      })

      for (const message of out) {
        yield message
        if (message.type === 'error') failed = true
      }

      if (failed) {
        return { blocks: assistantBlocks, toolCalls, failed: true }
      }
    }

    if (currentText) {
      assistantBlocks.push({ type: 'text', text: currentText })
    }

    return { blocks: assistantBlocks, toolCalls, failed: false }
  }

  private async loadHistory(sessionId: string): Promise<ChatModelMessage[]> {
    const messages = await this.sessionStore.getSessionMessages(sessionId).catch(() => [])
    return messages
      .map((message) => normalizeHistoryMessage(message))
      .filter((message): message is ChatModelMessage => message !== null)
  }

  private async *runComputerUseDirectIntent(args: {
    input: SendMessageInput
    snapshot: RuntimeProviderSnapshot
    parentUuid: string | null
    directIntent: ComputerUseDirectIntentPlan
  }): AsyncIterable<ServerMessage, DirectIntentRunResult> {
    let parentUuid = args.parentUuid
    const modelMessages: ChatModelMessage[] = []

    const accessResult = yield* this.executeSyntheticToolCall({
      input: args.input,
      snapshot: args.snapshot,
      parentUuid,
      name: args.directIntent.requestAccess.name,
      toolInput: args.directIntent.requestAccess.input,
    })
    parentUuid = accessResult.parentUuid
    modelMessages.push(syntheticAssistantMessage(accessResult), syntheticToolResultMessage(accessResult))
    if (accessResult.isError) {
      parentUuid = await this.emitAndPersistAssistantText({
        sessionId: args.input.sessionId,
        snapshot: args.snapshot,
        parentUuid,
        text: args.directIntent.failureText,
      })
      yield { type: 'content_start', blockType: 'text' }
      yield { type: 'content_delta', text: args.directIntent.failureText }
      return { parentUuid, shouldContinue: false, modelMessages }
    }

    const intentResult = yield* this.executeSyntheticToolCall({
      input: args.input,
      snapshot: args.snapshot,
      parentUuid,
      name: args.directIntent.desktopIntent.name,
      toolInput: args.directIntent.desktopIntent.input,
    })
    parentUuid = intentResult.parentUuid
    modelMessages.push(syntheticAssistantMessage(intentResult), syntheticToolResultMessage(intentResult))

    const completed = !intentResult.isError && toolResultReportsCompleted(intentResult.content)
    if (!completed) {
      return { parentUuid, shouldContinue: true, modelMessages }
    }

    parentUuid = await this.emitAndPersistAssistantText({
      sessionId: args.input.sessionId,
      snapshot: args.snapshot,
      parentUuid,
      text: args.directIntent.successText,
    })
    yield { type: 'content_start', blockType: 'text' }
    yield { type: 'content_delta', text: args.directIntent.successText }

    return { parentUuid, shouldContinue: false, modelMessages }
  }

  private async *executeSyntheticToolCall(args: {
    input: SendMessageInput
    snapshot: RuntimeProviderSnapshot
    parentUuid: string | null
    name: string
    toolInput: Record<string, unknown>
  }): AsyncIterable<ServerMessage, {
    parentUuid: string | null
    toolCall: ToolCall
    content: ToolExecutionResultContent
    isError: boolean
  }> {
    const toolCall: ToolCall = {
      id: `toolu_direct_${crypto.randomUUID()}`,
      name: args.name,
      input: args.toolInput,
    }

    yield {
      type: 'content_start',
      blockType: 'tool_use',
      toolName: toolCall.name,
      toolUseId: toolCall.id,
    }
    yield {
      type: 'tool_use_complete',
      toolName: toolCall.name,
      toolUseId: toolCall.id,
      input: toolCall.input,
    }

    const parentUuid = await this.sessionStore.appendAssistantMessage(
      args.input.sessionId,
      [{
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      }],
      { model: args.snapshot.model, parentUuid: args.parentUuid },
    ) ?? args.parentUuid

    const result = yield* this.executeToolCall({
      input: args.input,
      toolCall,
    })

    await this.sessionStore.appendUserMessage(args.input.sessionId, [{
      type: 'tool_result',
      tool_use_id: toolCall.id,
      content: result.content,
      is_error: result.isError,
      ...(result.metadata ? { metadata: result.metadata } : {}),
    }])

    return {
      parentUuid,
      toolCall,
      content: result.content,
      isError: result.isError,
    }
  }

  private async emitAndPersistAssistantText(args: {
    sessionId: string
    snapshot: RuntimeProviderSnapshot
    parentUuid: string | null
    text: string
  }): Promise<string | null> {
    const nextParentUuid = await this.sessionStore.appendAssistantMessage(
      args.sessionId,
      [{ type: 'text', text: args.text }],
      { model: args.snapshot.model, parentUuid: args.parentUuid },
    ) ?? args.parentUuid

    return nextParentUuid
  }

  private async *executeToolCall(args: {
    input: SendMessageInput
    toolCall: ToolCall
  }): AsyncIterable<ServerMessage, {
    content: ToolExecutionResultContent
    isError: boolean
    metadata?: ToolExecutionMetadata
  }> {
    const risk = this.tools.getRisk(args.toolCall.name)
    if (!risk) {
      const content = `Unknown tool: ${args.toolCall.name}`
      yield {
        type: 'tool_result',
        toolUseId: args.toolCall.id,
        content,
        isError: true,
      }
      return { content, isError: true }
    }

    let toolInput = args.toolCall.input
    const requestId = crypto.randomUUID()
    const permissionRequest = {
      requestId,
      sessionId: args.input.sessionId,
      projectPath: 'chat',
      toolUseId: args.toolCall.id,
      toolName: args.toolCall.name,
      input: toolInput,
      risk,
      description: describeToolCall(args.toolCall.name, toolInput),
    }

    if (this.permissions.shouldAsk(permissionRequest, args.input.settings?.permissionMode)) {
      yield {
        type: 'permission_request',
        requestId,
        toolName: args.toolCall.name,
        toolUseId: args.toolCall.id,
        input: toolInput,
        description: permissionRequest.description,
      }

      const decision = await this.permissions.waitForDecision(
        permissionRequest,
        args.input.signal,
        args.input.settings?.permissionMode,
      )
      if (!decision.allowed) {
        const content = 'User denied this tool call.'
        yield {
          type: 'tool_result',
          toolUseId: args.toolCall.id,
          content,
          isError: true,
        }
        return { content, isError: true }
      }
      if (decision.updatedInput) {
        toolInput = decision.updatedInput
      }
    }

    yield {
      type: 'status',
      state: 'tool_executing',
      verb: describeToolCall(args.toolCall.name, toolInput),
    }
    const result = await this.tools.execute(args.toolCall.name, toolInput, {
      sessionId: args.input.sessionId,
      signal: args.input.signal,
    })
    const isError = result.isError === true
    yield {
      type: 'tool_result',
      toolUseId: args.toolCall.id,
      content: result.content,
      isError,
      metadata: result.metadata,
    }
    return { content: result.content, isError, metadata: result.metadata }
  }
}

function syntheticAssistantMessage(result: SyntheticToolCallResult): ChatModelMessage {
  return {
    role: 'assistant',
    content: [{
      type: 'tool_use',
      id: result.toolCall.id,
      name: result.toolCall.name,
      input: result.toolCall.input,
    }],
  }
}

function syntheticToolResultMessage(result: SyntheticToolCallResult): ChatModelMessage {
  return {
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: result.toolCall.id,
      content: result.content,
      is_error: result.isError,
    }],
  }
}

type TranslateContext = {
  snapshot: RuntimeProviderSnapshot
  usage: TokenUsage
  activeToolBlocks: Map<number, ActiveToolBlock>
  activeBlockTypes: Map<number, 'text' | 'thinking' | 'tool_use'>
  appendText(text: string): void
  closeTextBlock(): void
  addToolCall(toolCall: ToolCall): void
}

function translateModelEvent(
  event: ModelStreamEvent,
  context: TranslateContext,
): ServerMessage[] {
  switch (event.event) {
    case 'message_start': {
      const message = event.data.message as Record<string, unknown> | undefined
      const usage = message?.usage as Record<string, unknown> | undefined
      copyUsage(usage, context.usage)
      return []
    }

    case 'content_block_start': {
      const block = event.data.content_block as Record<string, unknown> | undefined
      if (!block) return []

      if (block.type === 'text') {
        const index = numberFromUnknown(event.data.index) ?? 0
        context.activeBlockTypes.set(index, 'text')
        return [{ type: 'content_start', blockType: 'text' }]
      }

      if (block.type === 'thinking') {
        const index = numberFromUnknown(event.data.index) ?? 0
        context.activeBlockTypes.set(index, 'thinking')
        return []
      }

      if (block.type === 'tool_use') {
        context.closeTextBlock()
        const index = numberFromUnknown(event.data.index) ?? 0
        const id = typeof block.id === 'string' ? block.id : `toolu_${crypto.randomUUID()}`
        const name = typeof block.name === 'string' ? block.name : 'unknown_tool'
        const initialInput = block.input && typeof block.input === 'object'
          ? block.input as Record<string, unknown>
          : {}
        context.activeBlockTypes.set(index, 'tool_use')
        context.activeToolBlocks.set(index, {
          id,
          name,
          inputJson: '',
          initialInput,
        })
        return [{
          type: 'content_start',
          blockType: 'tool_use',
          toolName: name,
          toolUseId: id,
        }]
      }

      return []
    }

    case 'content_block_delta': {
      const delta = event.data.delta as Record<string, unknown> | undefined
      if (!delta) return []

      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        context.appendText(delta.text)
        return [{ type: 'content_delta', text: delta.text }]
      }

      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        return [{ type: 'thinking', text: delta.thinking }]
      }

      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const index = numberFromUnknown(event.data.index) ?? 0
        const tool = context.activeToolBlocks.get(index)
        if (tool) tool.inputJson += delta.partial_json
        return [{ type: 'content_delta', toolInput: delta.partial_json }]
      }

      return []
    }

    case 'content_block_stop': {
      const index = numberFromUnknown(event.data.index) ?? 0
      const blockType = context.activeBlockTypes.get(index)
      context.activeBlockTypes.delete(index)

      if (blockType === 'text') {
        context.closeTextBlock()
        return []
      }

      if (blockType === 'tool_use') {
        const tool = context.activeToolBlocks.get(index)
        context.activeToolBlocks.delete(index)
        if (!tool) return []
        const input = parseToolInput(tool)
        context.addToolCall({ id: tool.id, name: tool.name, input })
        return [{
          type: 'tool_use_complete',
          toolName: tool.name,
          toolUseId: tool.id,
          input,
        }]
      }

      return []
    }

    case 'message_delta': {
      const usage = event.data.usage as Record<string, unknown> | undefined
      copyUsage(usage, context.usage)
      return []
    }

    case 'message_stop':
      return []

    case 'error': {
      const error = event.data.error as Record<string, unknown> | undefined
      return [{
        type: 'error',
        code: typeof error?.type === 'string' ? error.type : 'PROVIDER_ERROR',
        message:
          typeof error?.message === 'string'
            ? error.message
            : `Provider ${context.snapshot.providerName} returned an error.`,
      }]
    }

    default:
      return []
  }
}

function parseToolInput(tool: ActiveToolBlock): Record<string, unknown> {
  if (!tool.inputJson.trim()) return tool.initialInput
  try {
    const parsed = JSON.parse(tool.inputJson)
    return parsed && typeof parsed === 'object'
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return tool.initialInput
  }
}

function copyUsage(
  source: Record<string, unknown> | undefined,
  target: TokenUsage,
): void {
  if (!source) return
  const inputTokens = numberFromUnknown(
    source.input_tokens ?? source.cache_read_input_tokens,
  )
  const outputTokens = numberFromUnknown(source.output_tokens)
  const cacheRead = numberFromUnknown(source.cache_read_input_tokens)
  const cacheCreation = numberFromUnknown(source.cache_creation_input_tokens)

  if (inputTokens !== undefined) target.input_tokens = inputTokens
  if (outputTokens !== undefined) target.output_tokens = outputTokens
  if (cacheRead !== undefined) target.cache_read_tokens = cacheRead
  if (cacheCreation !== undefined) target.cache_creation_tokens = cacheCreation
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function cloneModelMessages(messages: ChatModelMessage[]): ChatModelMessage[] {
  return messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((block) => ({ ...block }))
      : message.content,
  }))
}

function buildUserMessage(
  content: string,
  attachments?: AttachmentRef[],
): ChatModelMessage {
  const blocks: ChatContentBlock[] = []
  if (content.trim()) {
    blocks.push({ type: 'text', text: content })
  }

  for (const attachment of attachments ?? []) {
    if (!attachment.data) continue
    if (attachment.type === 'image') {
      const parsed = parseImageAttachment(attachment)
      if (parsed) blocks.push(parsed)
      continue
    }

    if (attachment.type === 'file') {
      const parsed = parseTextAttachment(attachment)
      if (parsed) blocks.push(parsed)
    }
  }

  return {
    role: 'user',
    content: blocks.length === 1 && blocks[0]?.type === 'text'
      ? blocks[0].text
      : blocks,
  }
}

function parseImageAttachment(
  attachment: AttachmentRef,
): ChatContentBlock | null {
  const dataUrlMatch = attachment.data?.match(/^data:(.+?);base64,(.*)$/)
  const mimeType =
    dataUrlMatch?.[1] ||
    attachment.mimeType ||
    'image/png'
  const data = dataUrlMatch?.[2] || attachment.data
  if (!data) return null

  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mimeType,
      data,
    },
  }
}

function parseTextAttachment(attachment: AttachmentRef): ChatContentBlock | null {
  const data = attachment.data
  if (!data) return null

  const decoded = decodeAttachmentText(data)
  if (!decoded.trim()) return null

  const name = attachment.name || attachment.path || 'attachment'
  const extension = name.includes('.')
    ? name.split('.').pop()?.toLowerCase()
    : ''
  const language = extension && /^[a-z0-9+#-]+$/i.test(extension) ? extension : 'text'
  const truncated = decoded.length > MAX_ATTACHED_TEXT_CHARS
  const text = truncated ? decoded.slice(0, MAX_ATTACHED_TEXT_CHARS) : decoded

  return {
    type: 'text',
    text: [
      `Attached file: ${name}`,
      '```' + language,
      text,
      '```',
      truncated ? '[Attachment truncated]' : '',
    ].filter(Boolean).join('\n'),
  }
}

function decodeAttachmentText(data: string): string {
  const match = data.match(/^data:([^;,]+)?(?:;charset=([^;,]+))?;base64,(.*)$/i)
  if (match) {
    return Buffer.from(match[3] ?? '', 'base64').toString('utf-8')
  }
  return data
}

function normalizeHistoryMessage(message: MessageEntry): ChatModelMessage | null {
  if (message.type === 'user') {
    const content = normalizeHistoryContent(message.content)
    return content ? { role: 'user', content } : null
  }

  if (message.type === 'assistant' || message.type === 'tool_use') {
    const content = normalizeHistoryContent(message.content)
    return content ? { role: 'assistant', content } : null
  }

  if (message.type === 'tool_result') {
    const content = normalizeHistoryContent(message.content)
    return content ? { role: 'user', content } : null
  }

  return null
}

function normalizeHistoryContent(
  content: unknown,
): ChatModelMessage['content'] | null {
  if (typeof content === 'string') return content

  if (!Array.isArray(content)) return null

  const blocks: ChatContentBlock[] = []
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === 'text' && typeof block.text === 'string') {
      blocks.push({ type: 'text', text: block.text })
      continue
    }

    if (
      block.type === 'image' &&
      block.source &&
      typeof block.source === 'object'
    ) {
      const source = block.source as Record<string, unknown>
      if (
        source.type === 'base64' &&
        typeof source.media_type === 'string' &&
        typeof source.data === 'string'
      ) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: source.media_type,
            data: source.data,
          },
        })
      }
      continue
    }

    if (
      block.type === 'tool_use' &&
      typeof block.id === 'string' &&
      typeof block.name === 'string'
    ) {
      blocks.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input && typeof block.input === 'object'
          ? block.input as Record<string, unknown>
          : {},
      })
      continue
    }

    if (
      block.type === 'tool_result' &&
      typeof block.tool_use_id === 'string'
    ) {
      blocks.push({
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: normalizeToolResultContent(block.content),
        is_error: block.is_error === true,
      })
    }
  }

  if (blocks.length === 0) return null
  if (blocks.length === 1 && blocks[0]?.type === 'text') return blocks[0].text
  return blocks
}

function normalizeToolResultContent(content: unknown): string | ChatContentBlock[] {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content ?? '')

  const blocks: ChatContentBlock[] = []
  for (const block of content as Array<Record<string, unknown>>) {
    if (block.type === 'text' && typeof block.text === 'string') {
      blocks.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'image' && block.source && typeof block.source === 'object') {
      const source = block.source as Record<string, unknown>
      if (
        source.type === 'base64' &&
        typeof source.media_type === 'string' &&
        typeof source.data === 'string'
      ) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: source.media_type,
            data: source.data,
          },
        })
      }
    }
  }

  return blocks.length > 0 ? blocks : JSON.stringify(content)
}

function describeToolCall(name: string, input: Record<string, unknown>): string {
  if (name === 'get_weather' && typeof input.location === 'string') {
    return `Get weather for ${input.location}`
  }
  if (name === 'web_search' && typeof input.query === 'string') {
    return `Search the web for ${input.query}`
  }
  if (name === 'web_fetch' && typeof input.url === 'string') {
    return `Fetch ${input.url}`
  }
  return name
}

export const chatEngine = new ChatEngine()
