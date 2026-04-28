import { AgentService, type AgentDefinition } from '../services/agentService.js'
import {
  BUILT_IN_AGENTS,
  getBuiltInAgent,
  normalizeAgentName,
} from '../config/builtInAgents.js'
import { ProviderAdapter } from './ProviderAdapter.js'
import type {
  ChatContentBlock,
  ChatModelMessage,
  ChatModelRequest,
  ModelStreamEvent,
  RuntimeProviderSnapshot,
} from './types.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from './ToolRuntime.js'

const DEFAULT_AGENT_TYPE = 'worker'
const DEFAULT_MAX_TURNS = 8
const MAX_AGENT_OUTPUT_CHARS = 80_000

export type AgentRunInput = {
  description?: string
  prompt: string
  subagent_type?: string
  model?: string
}

export type AgentToolHost = {
  getDefinitions(): ToolDefinition[]
  execute(
    toolName: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult>
}

type ToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
}

type ActiveToolBlock = {
  id: string
  name: string
  inputJson: string
  initialInput: Record<string, unknown>
}

type AgentRuntimeOptions = {
  providerAdapter?: ProviderAdapter
  agentService?: AgentService
  toolHost: AgentToolHost
}

export class AgentRuntime {
  private providerAdapter: ProviderAdapter
  private agentService: AgentService
  private toolHost: AgentToolHost

  constructor(options: AgentRuntimeOptions) {
    this.providerAdapter = options.providerAdapter ?? new ProviderAdapter()
    this.agentService = options.agentService ?? new AgentService()
    this.toolHost = options.toolHost
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'agent',
      description: [
        'Launch a desktop-native subagent for a focused task.',
        'Use subagent_type to choose one of the available agents, such as explorer, worker, code-reviewer, frontend-designer, test-writer, refactorer, docs-writer, or security-auditor.',
        'Each subagent starts with its own context and returns a concise result to this conversation.',
      ].join(' '),
      risk: 'write',
      input_schema: {
        type: 'object',
        required: ['prompt'],
        properties: {
          description: {
            type: 'string',
            description: 'Short 3-5 word description of the delegated task.',
          },
          prompt: {
            type: 'string',
            description: 'Complete task instructions for the subagent. Include all relevant context because the subagent starts fresh.',
          },
          subagent_type: {
            type: 'string',
            description: 'Agent type to use. If omitted, worker is used.',
          },
          model: {
            type: 'string',
            description: 'Optional model id override for this subagent.',
          },
        },
      },
    }
  }

  async run(input: AgentRunInput | unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const request = toAgentRunInput(input)
    const prompt = request.prompt.trim()
    if (!prompt) {
      return { content: 'Agent prompt is required.', isError: true }
    }

    const agent = await this.resolveAgent(request.subagent_type, context.workDir)
    if (!agent) {
      const available = await this.availableAgentNames(context.workDir)
      return {
        content: `Agent type "${request.subagent_type || DEFAULT_AGENT_TYPE}" not found. Available agents: ${available.join(', ')}`,
        isError: true,
        metadata: { summary: 'Agent not found' },
      }
    }

    const snapshot = await this.providerAdapter.resolveSnapshot(request.model || agent.model)
    const allowedTools = this.resolveAllowedTools(agent)
    const maxTurns = clampInteger(agent.maxTurns, 1, 20, DEFAULT_MAX_TURNS)
    const messages: ChatModelMessage[] = [{
      role: 'user',
      content: buildAgentUserPrompt(request, agent, context.workDir),
    }]

    const transcript: string[] = []
    let totalToolCalls = 0
    let lastText = ''

    for (let turn = 0; turn < maxTurns; turn++) {
      const assistantTurn = await this.runAssistantTurn({
        snapshot,
        messages,
        tools: allowedTools,
        system: buildAgentSystemPrompt(agent, allowedTools),
        signal: context.signal,
      })

      if (assistantTurn.text) {
        lastText = assistantTurn.text
        transcript.push(assistantTurn.text)
      }

      if (assistantTurn.blocks.length > 0) {
        messages.push({ role: 'assistant', content: assistantTurn.blocks })
      }

      if (assistantTurn.toolCalls.length === 0) {
        return {
          content: formatAgentResult(agent, lastText || transcript.join('\n\n')),
          metadata: {
            summary: `${agent.name} completed`,
            matches: totalToolCalls,
          },
        }
      }

      const toolResults: ChatContentBlock[] = []
      for (const toolCall of assistantTurn.toolCalls) {
        totalToolCalls++
        const result = await this.executeAgentTool(toolCall, context, allowedTools)
        transcript.push(formatToolTranscript(toolCall, result))
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: result.content,
          is_error: result.isError === true,
        })
      }
      messages.push({ role: 'user', content: toolResults })
    }

    return {
      content: truncateText(
        formatAgentResult(
          agent,
          [
            lastText || 'Agent reached its turn limit before producing a final answer.',
            '',
            'Recent activity:',
            ...transcript.slice(-6),
          ].join('\n'),
        ),
      ),
      isError: false,
      metadata: {
        summary: `${agent.name} reached turn limit`,
        matches: totalToolCalls,
        outputTruncated: transcript.join('\n').length > MAX_AGENT_OUTPUT_CHARS,
      },
    }
  }

  private async resolveAgent(
    requestedType: string | undefined,
    workDir: string,
  ): Promise<AgentDefinition | null> {
    const agentType = requestedType?.trim() || DEFAULT_AGENT_TYPE
    return await this.agentService.getAgent(agentType, workDir) ?? getBuiltInAgent(agentType)
  }

  private async availableAgentNames(workDir: string): Promise<string[]> {
    const stored = await this.agentService.listStoredAgents(workDir)
    const names = new Set<string>()
    for (const agent of stored) names.add(agent.name)
    for (const agent of BUILT_IN_AGENTS) names.add(agent.name)
    return [...names].sort((a, b) => a.localeCompare(b))
  }

  private resolveAllowedTools(agent: AgentDefinition): ToolDefinition[] {
    const allTools = this.toolHost.getDefinitions()
      .filter((tool) => tool.name !== 'agent')
    const allowed = new Set((agent.tools ?? []).map(normalizeToolName))
    if (allowed.size === 0) return allTools
    return allTools.filter((tool) => allowed.has(normalizeToolName(tool.name)))
  }

  private async runAssistantTurn(args: {
    snapshot: RuntimeProviderSnapshot
    messages: ChatModelMessage[]
    tools: ToolDefinition[]
    system: string
    signal: AbortSignal
  }): Promise<{
    blocks: ChatContentBlock[]
    toolCalls: ToolCall[]
    text: string
  }> {
    const blocks: ChatContentBlock[] = []
    const toolCalls: ToolCall[] = []
    const activeToolBlocks = new Map<number, ActiveToolBlock>()
    const activeBlockTypes = new Map<number, 'text' | 'thinking' | 'tool_use'>()
    let currentText = ''

    const request: ChatModelRequest = {
      model: args.snapshot.model,
      max_tokens: 8192,
      stream: true,
      system: args.system,
      messages: cloneModelMessages(args.messages),
      ...(args.tools.length > 0
        ? {
            tools: args.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.input_schema,
            })),
            tool_choice: { type: 'auto' },
          }
        : {}),
    }

    for await (const event of this.providerAdapter.stream(request, args.snapshot, args.signal)) {
      translateAgentEvent(event, {
        activeToolBlocks,
        activeBlockTypes,
        appendText(text) {
          currentText += text
        },
        closeTextBlock() {
          if (!currentText) return
          blocks.push({ type: 'text', text: currentText })
          currentText = ''
        },
        addToolCall(toolCall) {
          blocks.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.input,
          })
          toolCalls.push(toolCall)
        },
      })
    }

    if (currentText) {
      blocks.push({ type: 'text', text: currentText })
    }

    return {
      blocks,
      toolCalls,
      text: blocks
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('\n'),
    }
  }

  private async executeAgentTool(
    toolCall: ToolCall,
    context: ToolExecutionContext,
    allowedTools: ToolDefinition[],
  ): Promise<ToolExecutionResult> {
    if (!allowedTools.some((tool) => tool.name === toolCall.name)) {
      return {
        content: `Tool "${toolCall.name}" is not available to this agent.`,
        isError: true,
      }
    }

    return await this.toolHost.execute(toolCall.name, toolCall.input, {
      sessionId: `${context.sessionId}:agent`,
      workDir: context.workDir,
      signal: context.signal,
    })
  }
}

type TranslateContext = {
  activeToolBlocks: Map<number, ActiveToolBlock>
  activeBlockTypes: Map<number, 'text' | 'thinking' | 'tool_use'>
  appendText(text: string): void
  closeTextBlock(): void
  addToolCall(toolCall: ToolCall): void
}

function translateAgentEvent(
  event: ModelStreamEvent,
  context: TranslateContext,
): void {
  switch (event.event) {
    case 'content_block_start': {
      const index = numberFromUnknown(event.data.index) ?? 0
      const block = event.data.content_block as Record<string, unknown> | undefined
      if (!block) return

      if (block.type === 'text') {
        context.activeBlockTypes.set(index, 'text')
        return
      }

      if (block.type === 'thinking') {
        context.activeBlockTypes.set(index, 'thinking')
        return
      }

      if (block.type === 'tool_use') {
        context.closeTextBlock()
        context.activeBlockTypes.set(index, 'tool_use')
        context.activeToolBlocks.set(index, {
          id: typeof block.id === 'string' ? block.id : `toolu_agent_${crypto.randomUUID()}`,
          name: typeof block.name === 'string' ? block.name : 'unknown_tool',
          inputJson: '',
          initialInput: block.input && typeof block.input === 'object'
            ? block.input as Record<string, unknown>
            : {},
        })
      }
      return
    }

    case 'content_block_delta': {
      const index = numberFromUnknown(event.data.index) ?? 0
      const delta = event.data.delta as Record<string, unknown> | undefined
      if (!delta) return

      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        context.appendText(delta.text)
        return
      }

      if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        const tool = context.activeToolBlocks.get(index)
        if (tool) tool.inputJson += delta.partial_json
      }
      return
    }

    case 'content_block_stop': {
      const index = numberFromUnknown(event.data.index) ?? 0
      const blockType = context.activeBlockTypes.get(index)
      context.activeBlockTypes.delete(index)
      if (blockType === 'text') {
        context.closeTextBlock()
        return
      }
      if (blockType === 'tool_use') {
        const tool = context.activeToolBlocks.get(index)
        context.activeToolBlocks.delete(index)
        if (!tool) return
        context.addToolCall({
          id: tool.id,
          name: tool.name,
          input: parseToolInput(tool),
        })
      }
      return
    }
  }
}

function buildAgentSystemPrompt(agent: AgentDefinition, tools: ToolDefinition[]): string {
  return [
    agent.systemPrompt || `You are the ${agent.name} agent.`,
    '',
    'You are running inside Ycode Desktop as an independent subagent.',
    'You start with no parent conversation context except the task prompt below.',
    'Use tools when needed, keep work focused, and return a concise final result.',
    'Do not claim success for edits or commands unless you used tools or have direct evidence.',
    '',
    'Available tools:',
    ...tools.map((tool) => `- ${tool.name}: ${tool.description}`),
  ].join('\n')
}

function buildAgentUserPrompt(
  input: AgentRunInput,
  agent: AgentDefinition,
  workDir: string,
): string {
  return [
    `Agent: ${agent.name}`,
    input.description ? `Task summary: ${input.description}` : '',
    `Workspace: ${workDir}`,
    '',
    'Task:',
    input.prompt,
  ].filter(Boolean).join('\n')
}

function formatAgentResult(agent: AgentDefinition, text: string): string {
  return truncateText([
    `Agent ${agent.name} completed.`,
    '',
    text.trim() || '(no text result)',
  ].join('\n'))
}

function formatToolTranscript(toolCall: ToolCall, result: ToolExecutionResult): string {
  const status = result.isError ? 'failed' : 'completed'
  const summary = result.metadata?.summary ? ` (${result.metadata.summary})` : ''
  return `Tool ${toolCall.name} ${status}${summary}.`
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

function cloneModelMessages(messages: ChatModelMessage[]): ChatModelMessage[] {
  return messages.map((message) => ({
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((block) => ({ ...block }))
      : message.content,
  }))
}

function toAgentRunInput(input: AgentRunInput | unknown): AgentRunInput {
  const obj = input && typeof input === 'object'
    ? input as Record<string, unknown>
    : {}
  return {
    prompt: typeof obj.prompt === 'string' ? obj.prompt : '',
    description: typeof obj.description === 'string' ? obj.description : undefined,
    subagent_type: typeof obj.subagent_type === 'string' ? obj.subagent_type : undefined,
    model: typeof obj.model === 'string' ? obj.model : undefined,
  }
}

function normalizeToolName(value: string): string {
  const normalized = normalizeAgentName(value).replace(/\s+/g, '_')
  const aliases: Record<string, string> = {
    read: 'read_file',
    file_read: 'read_file',
    grep: 'search_text',
    glob: 'list_files',
    bash: 'run_command',
    powershell: 'run_command',
    edit: 'edit_file',
    write: 'write_file',
  }
  return aliases[normalized] ?? normalized
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function truncateText(value: string): string {
  if (value.length <= MAX_AGENT_OUTPUT_CHARS) return value
  return `${value.slice(0, MAX_AGENT_OUTPUT_CHARS)}\n\n[agent output truncated]`
}
