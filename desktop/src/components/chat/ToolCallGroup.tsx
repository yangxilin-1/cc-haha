import { useEffect, useState } from 'react'
import { ToolCallBlock } from './ToolCallBlock'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { Modal } from '../shared/Modal'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import type { AgentTaskNotification, UIMessage } from '../../types/chat'
import { AGENT_LIFECYCLE_TYPES } from '../../types/team'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type Props = {
  toolCalls: ToolCall[]
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  agentTaskNotifications: Record<string, AgentTaskNotification>
  /** When true, the last tool is still executing — show expanded */
  isStreaming?: boolean
}

const TOOL_VERBS: Record<string, (count: number, t: (key: TranslationKey, params?: Record<string, string | number>) => string) => string> = {
  Read: (n, t) => n === 1 ? t('toolGroup.readOne') : t('toolGroup.readMany', { count: n }),
  read_file: (n, t) => n === 1 ? t('toolGroup.readOne') : t('toolGroup.readMany', { count: n }),
  Write: (n, t) => n === 1 ? t('toolGroup.createdOne') : t('toolGroup.createdMany', { count: n }),
  write_file: (n, t) => n === 1 ? t('toolGroup.createdOne') : t('toolGroup.createdMany', { count: n }),
  Edit: (n, t) => n === 1 ? t('toolGroup.editedOne') : t('toolGroup.editedMany', { count: n }),
  edit_file: (n, t) => n === 1 ? t('toolGroup.editedOne') : t('toolGroup.editedMany', { count: n }),
  apply_patch: (_n, t) => t('toolGroup.appliedPatch'),
  Bash: (n, t) => n === 1 ? t('toolGroup.ranOne') : t('toolGroup.ranMany', { count: n }),
  run_command: (n, t) => n === 1 ? t('toolGroup.ranOne') : t('toolGroup.ranMany', { count: n }),
  Glob: (_n, t) => t('toolGroup.foundFiles'),
  list_files: (_n, t) => t('toolGroup.foundFiles'),
  Grep: (n, t) => n === 1 ? t('toolGroup.searchedOne') : t('toolGroup.searchedMany', { count: n }),
  search_text: (n, t) => n === 1 ? t('toolGroup.searchedOne') : t('toolGroup.searchedMany', { count: n }),
  Agent: (n, t) => n === 1 ? t('toolGroup.agentOne') : t('toolGroup.agentMany', { count: n }),
  Skill: (_n, t) => t('toolGroup.readSkillGeneric'),
  WebSearch: (_n, t) => t('toolGroup.searchedWeb'),
  web_search: (_n, t) => t('toolGroup.searchedWeb'),
  WebFetch: (n, t) => n === 1 ? t('toolGroup.fetchedOne') : t('toolGroup.fetchedMany', { count: n }),
  web_fetch: (n, t) => n === 1 ? t('toolGroup.fetchedOne') : t('toolGroup.fetchedMany', { count: n }),
  get_weather: (_n, t) => t('toolGroup.checkedWeather'),
  calculate: (_n, t) => t('toolGroup.calculated'),
  get_current_time: (_n, t) => t('toolGroup.checkedTime'),
}

function generateSummary(toolCalls: ToolCall[], t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const counts = new Map<string, number>()
  for (const tc of toolCalls) {
    counts.set(tc.toolName, (counts.get(tc.toolName) ?? 0) + 1)
  }

  const parts: string[] = []
  for (const [name, count] of counts) {
    const verbFn = TOOL_VERBS[name]
    parts.push(verbFn ? verbFn(count, t) : `${name} (${count})`)
  }

  return parts.join(', ')
}

function groupHasErrors(toolCalls: ToolCall[], resultMap: Map<string, ToolResult>): boolean {
  return toolCalls.some((tc) => {
    const result = resultMap.get(tc.toolUseId)
    return result?.isError
  })
}

export function ToolCallGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  agentTaskNotifications,
  isStreaming,
}: Props) {
  const allAgents = toolCalls.every((toolCall) => toolCall.toolName === 'Agent')

  if (allAgents) {
    return (
      <AgentToolGroup
        toolCalls={toolCalls}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
        agentTaskNotifications={agentTaskNotifications}
        isStreaming={isStreaming}
      />
    )
  }

  // Single tool call — render directly without group wrapper
  if (toolCalls.length === 1) {
    const tc = toolCalls[0]!
    return (
      <ToolCallTree
        toolCall={tc}
        resultMap={resultMap}
        childToolCallsByParent={childToolCallsByParent}
      />
    )
  }

  return (
    <ToolCallGroupMulti
      toolCalls={toolCalls}
      resultMap={resultMap}
      childToolCallsByParent={childToolCallsByParent}
      agentTaskNotifications={agentTaskNotifications}
      isStreaming={isStreaming}
    />
  )
}

function AgentToolGroup({
  toolCalls,
  resultMap,
  childToolCallsByParent,
  agentTaskNotifications,
  isStreaming,
}: Props) {
  const [expanded, setExpanded] = useState(true)
  const t = useTranslation()
  const statuses = toolCalls.map((toolCall) =>
    getAgentStatus({
      hasResult: resultMap.has(toolCall.toolUseId),
      isError: !!resultMap.get(toolCall.toolUseId)?.isError,
      isLaunchResult: isAgentLaunchResult(resultMap.get(toolCall.toolUseId)?.content),
      isStreaming: !!isStreaming && !resultMap.has(toolCall.toolUseId),
      childCount: (childToolCallsByParent.get(toolCall.toolUseId) ?? []).length,
      taskStatus: agentTaskNotifications[toolCall.toolUseId]?.status,
    }),
  )
  const isAnyRunning = statuses.some((status) => status === 'running' || status === 'starting')
  const errorPresent = statuses.some((status) => status === 'failed')
  const allComplete = statuses.every((status) => status === 'done')
  const anyStopped = statuses.some((status) => status === 'stopped')

  useEffect(() => {
    if (isStreaming) {
      setExpanded(true)
    }
  }, [isStreaming])

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-0.5 py-1.5 text-left text-[12px] transition-colors hover:text-[var(--color-text-primary)]"
      >
        <svg className="w-[14px] h-[14px] text-[var(--color-outline)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {expanded ? (<polyline points="18 15 12 9 6 15" />) : (<polyline points="6 9 12 15 18 9" />)}
        </svg>
        <span className="flex-1 truncate text-[12px] text-[var(--color-text-secondary)]">
          {toolCalls.length === 1 ? t('toolGroup.agentOne') : t('toolGroup.agentMany', { count: toolCalls.length })}
        </span>
        {isAnyRunning && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-warning)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)] animate-pulse-dot" />
            {t('agentStatus.running')}
          </span>
        )}
        {!isAnyRunning && errorPresent && (
          <svg className="w-[14px] h-[14px] text-[var(--color-error)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
        )}
        {!isAnyRunning && !errorPresent && allComplete && (
          <svg className="w-[14px] h-[14px] text-[var(--color-success)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        )}
        {!isAnyRunning && !errorPresent && !allComplete && !anyStopped && (
          <svg className="w-[14px] h-[14px] text-[var(--color-outline)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        )}
        {!isAnyRunning && !errorPresent && !allComplete && anyStopped && (
          <svg className="w-[14px] h-[14px] text-[var(--color-outline)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
        )}
      </button>

      {expanded && (
        <div className="relative mt-3 pl-5">
          <div className="absolute bottom-6 left-[11px] top-4 w-px rounded-full bg-[var(--color-border)]/45" />
          <div className="space-y-2">
            {toolCalls.map((toolCall) => (
              <div key={toolCall.id} className="relative pl-7">
                <div className="absolute left-0 top-1/2 -translate-y-1/2">
                  <div className="absolute left-[11px] top-1/2 h-px w-4 -translate-y-1/2 bg-[var(--color-border)]/45" />
                  <div className="absolute left-[8px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-[var(--color-border)]/65 bg-[var(--color-surface-container-lowest)] shadow-[0_0_0_2px_var(--color-surface)]" />
                </div>
                <AgentCallCard
                  toolCall={toolCall}
                  resultMap={resultMap}
                  childToolCallsByParent={childToolCallsByParent}
                  agentTaskNotification={agentTaskNotifications[toolCall.toolUseId]}
                  isStreaming={isStreaming && !resultMap.has(toolCall.toolUseId)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Separated so the useState hook is never called conditionally. */
function ToolCallGroupMulti({ toolCalls, resultMap, childToolCallsByParent, isStreaming }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()
  const summary = generateSummary(toolCalls, t)
  const errorPresent = groupHasErrors(toolCalls, resultMap)
  const allComplete = toolCalls.every((tc) => resultMap.has(tc.toolUseId))
  const hasNestedToolCalls = toolCalls.some((tc) => (childToolCallsByParent.get(tc.toolUseId)?.length ?? 0) > 0)

  useEffect(() => {
    if (isStreaming || hasNestedToolCalls) {
      setExpanded(true)
    }
  }, [hasNestedToolCalls, isStreaming])

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-0.5 py-1.5 text-left text-[12px] transition-colors hover:text-[var(--color-text-primary)]"
      >
        <svg className="w-[14px] h-[14px] text-[var(--color-outline)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {expanded ? (<polyline points="18 15 12 9 6 15" />) : (<polyline points="6 9 12 15 18 9" />)}
        </svg>
        <span className="flex-1 truncate text-[12px] text-[var(--color-text-secondary)]">
          {summary}
        </span>
        {!isStreaming && allComplete && !errorPresent && (
          <svg className="w-[14px] h-[14px] text-[var(--color-success)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        )}
        {!isStreaming && errorPresent && (
          <svg className="w-[14px] h-[14px] text-[var(--color-error)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
        )}
        {!isStreaming && !allComplete && !errorPresent && (
          <svg className="w-[14px] h-[14px] text-[var(--color-outline)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        )}
        {isStreaming && (
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-brand)] animate-pulse-dot" />
        )}
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-1">
          {toolCalls.map((tc) => {
            return (
              <ToolCallTree
                key={tc.id}
                toolCall={tc}
                resultMap={resultMap}
                childToolCallsByParent={childToolCallsByParent}
                compact
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function AgentCallCard({
  toolCall,
  resultMap,
  childToolCallsByParent,
  agentTaskNotification,
  isStreaming = false,
}: {
  toolCall: ToolCall
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  agentTaskNotification?: AgentTaskNotification
  isStreaming?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const t = useTranslation()
  const input = toolCall.input && typeof toolCall.input === 'object'
    ? toolCall.input as Record<string, unknown>
    : {}
  const result = resultMap.get(toolCall.toolUseId)
  const childToolCalls = childToolCallsByParent.get(toolCall.toolUseId) ?? []
  const isLaunchResult = isAgentLaunchResult(result?.content)
  const recentToolCalls = childToolCalls.slice(-2)
  const status = getAgentStatus({
    hasResult: !!result,
    isError: !!result?.isError,
    isLaunchResult,
    isStreaming,
    childCount: childToolCalls.length,
    taskStatus: agentTaskNotification?.status,
  })
  const statusClassName = getAgentStatusClassName(status)
  const statusLabel = getAgentStatusLabel(status, t)
  const taskSummary = agentTaskNotification?.summary?.trim() || ''
  const errorText =
    status === 'failed'
      ? taskSummary || (result?.isError ? getAgentErrorSummary(result.content) : '')
      : result?.isError
        ? getAgentErrorSummary(result.content)
        : ''
  const fullOutputText =
    result && !result.isError && !isLaunchResult && !isAgentLifecycleResult(result.content)
      ? extractTextContent(result.content).trim()
      : ''
  const previewText = fullOutputText || (status === 'done' || status === 'stopped' ? taskSummary : '')
  const outputSummary = previewText ? getAgentOutputSummary(previewText) : ''
  const description = typeof input.description === 'string' ? input.description : ''

  return (
    <div className="py-1">
      <div className="flex w-full items-center gap-3 px-1 py-2 text-left transition-colors hover:text-[var(--color-text-primary)]">
        <svg className="w-[18px] h-[18px] text-[var(--color-outline)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">Agent</span>
            {description && (
              <span className="truncate text-[12px] text-[var(--color-text-secondary)]">
                {description}
              </span>
            )}
          </div>
          {!expanded && outputSummary && (
            <div className="mt-1 line-clamp-2 text-[11px] text-[var(--color-text-tertiary)]">
              {outputSummary}
            </div>
          )}
          {!expanded && !outputSummary && recentToolCalls.length > 0 && (
            <div className="mt-1 space-y-1">
              {recentToolCalls.map((recentToolCall) => (
                <div
                  key={recentToolCall.id}
                  className="truncate text-[11px] text-[var(--color-text-tertiary)]"
                >
                  {formatRecentToolUseSummary(recentToolCall, resultMap)}
                </div>
              ))}
            </div>
          )}
          {!expanded && !outputSummary && !recentToolCalls.length && errorText && (
            <div className="mt-1 truncate text-[11px] text-[var(--color-error)]">
              {errorText}
            </div>
          )}
        </div>
        {outputSummary && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setPreviewOpen(true)
            }}
            className="shrink-0 text-[11px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            {t('agentStatus.viewResult')}
          </button>
        )}
        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${statusClassName}`}>
          {status === 'running' || status === 'starting' ? (
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot" />
          ) : null}
          {statusLabel}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--color-outline)] transition-colors hover:text-[var(--color-text-primary)]"
          aria-label={expanded ? 'Collapse agent' : 'Expand agent'}
        >
          <svg className="w-[16px] h-[16px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {expanded ? (<polyline points="18 15 12 9 6 15" />) : (<polyline points="6 9 12 15 18 9" />)}
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="ml-6 border-l border-[var(--color-border)]/60 px-3 py-2">
          {errorText && (
            <div className="mb-3 border-l border-[var(--color-error)]/45 px-3 py-1.5 text-[11px] text-[var(--color-error)]">
              {errorText}
            </div>
          )}
          {childToolCalls.length > 0 ? (
            <div className="space-y-1">
              {childToolCalls.map((childToolCall) => (
                <ToolCallTree
                  key={childToolCall.id}
                  toolCall={childToolCall}
                  resultMap={resultMap}
                  childToolCallsByParent={childToolCallsByParent}
                  compact
                />
              ))}
            </div>
          ) : outputSummary ? (
            <div className="border-l border-[var(--color-border)]/70 px-3 py-1.5">
              <div className="line-clamp-3 text-[11px] leading-[1.55] text-[var(--color-text-secondary)]">
                {outputSummary}
              </div>
              <div className="mt-3 flex justify-end">
                <span className="text-[10px] text-[var(--color-text-tertiary)]">
                  {t('agentStatus.viewResult')}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-[var(--color-text-tertiary)]">
              {status === 'starting' ? t('agentStatus.starting') : t('agentStatus.noActivity')}
            </div>
          )}
        </div>
      )}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={description || t('agentStatus.resultTitle')}
        width={900}
      >
        <div className="max-h-[70vh] overflow-y-auto">
          <MarkdownRenderer content={previewText || errorText} />
        </div>
      </Modal>
    </div>
  )
}

function ToolCallTree({
  toolCall,
  resultMap,
  childToolCallsByParent,
  compact = false,
}: {
  toolCall: ToolCall
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  compact?: boolean
}) {
  const result = resultMap.get(toolCall.toolUseId)
  const childToolCalls = childToolCallsByParent.get(toolCall.toolUseId) ?? []

  return (
    <div className={compact ? 'space-y-1' : ''}>
      <ToolCallBlock
        toolName={toolCall.toolName}
        toolUseId={toolCall.toolUseId}
        input={toolCall.input}
        result={result ? { content: result.content, isError: result.isError, metadata: result.metadata } : null}
        compact={compact}
      />
      {childToolCalls.length > 0 && (
        <div className={compact ? 'ml-4 border-l border-[var(--color-border)]/60 pl-3' : 'mb-2 ml-16 border-l border-[var(--color-border)]/60 pl-3'}>
          <div className="space-y-1">
            {childToolCalls.map((childToolCall) => (
              <ToolCallTree
                key={childToolCall.id}
                toolCall={childToolCall}
                resultMap={resultMap}
                childToolCallsByParent={childToolCallsByParent}
                compact
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type AgentStatus = 'starting' | 'running' | 'done' | 'failed' | 'stopped'
type AgentTaskStatus = AgentTaskNotification['status']

function getAgentStatus({
  hasResult,
  isError,
  isLaunchResult,
  isStreaming,
  childCount,
  taskStatus,
}: {
  hasResult: boolean
  isError: boolean
  isLaunchResult: boolean
  isStreaming: boolean
  childCount: number
  taskStatus?: AgentTaskStatus
}): AgentStatus {
  if (taskStatus === 'failed') return 'failed'
  if (taskStatus === 'stopped') return 'stopped'
  if (taskStatus === 'completed') return 'done'
  if (hasResult && isError && !isLaunchResult) return 'failed'
  if (hasResult && !isLaunchResult) return 'done'
  if (isStreaming || childCount > 0 || isLaunchResult) return 'running'
  return 'starting'
}

function getAgentStatusLabel(
  status: AgentStatus,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
  switch (status) {
    case 'failed':
      return t('agentStatus.failed')
    case 'stopped':
      return t('agentStatus.stopped')
    case 'done':
      return t('agentStatus.done')
    case 'running':
      return t('agentStatus.running')
    case 'starting':
    default:
      return t('agentStatus.starting')
  }
}

function getAgentStatusClassName(status: AgentStatus): string {
  switch (status) {
    case 'failed':
      return 'text-[var(--color-error)]'
    case 'stopped':
      return 'text-[var(--color-text-secondary)]'
    case 'done':
      return 'text-[var(--color-success)]'
    case 'running':
      return 'text-[var(--color-warning)]'
    case 'starting':
    default:
      return 'text-[var(--color-text-secondary)]'
  }
}

function formatRecentToolUseSummary(
  toolCall: ToolCall,
  resultMap: Map<string, ToolResult>,
): string {
  const input = toolCall.input && typeof toolCall.input === 'object'
    ? toolCall.input as Record<string, unknown>
    : {}
  const result = resultMap.get(toolCall.toolUseId)
  const suffix = result?.isError ? ' • failed' : result ? ' • done' : ' • running'

  switch (toolCall.toolName) {
    case 'Bash':
      return `Bash · ${typeof input.command === 'string' ? input.command : ''}${suffix}`
    case 'Read':
      return `Read · ${typeof input.file_path === 'string' ? input.file_path.split('/').pop() : 'file'}${suffix}`
    case 'Glob':
      return `Glob · ${typeof input.pattern === 'string' ? input.pattern : ''}${suffix}`
    case 'Grep':
      return `Grep · ${typeof input.pattern === 'string' ? input.pattern : ''}${suffix}`
    case 'Agent':
      return `Agent · ${typeof input.description === 'string' ? input.description : ''}${suffix}`
    default:
      return `${toolCall.toolName}${suffix}`
  }
}

function getAgentErrorSummary(content: unknown): string {
  const text = extractTextContent(content).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (text.includes(`Agent type 'Explore' not found`)) {
    return 'Explore agent unavailable in this session'
  }
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
}

function getAgentOutputSummary(content: string): string {
  const text = content.replace(/\s+\n/g, '\n').trim()
  if (!text) return ''
  return text.length > 220 ? `${text.slice(0, 220)}...` : text
}

function isAgentLaunchResult(content: unknown): boolean {
  const text = extractTextContent(content).trim()
  if (!text) return false

  return (
    text.startsWith('Async agent launched successfully.') ||
    text.startsWith('Remote agent launched in CCR.') ||
    (text.startsWith('Spawned successfully.') &&
      text.includes('The agent is now running and will receive instructions via mailbox.')) ||
    text.includes('The agent is working in the background. You will be notified automatically when it completes.') ||
    text.includes('The agent is running remotely. You will be notified automatically when it completes.')
  )
}

/**
 * Check if agent result content is a lifecycle notification (shutdown, terminated, etc.)
 * rather than actual agent output. These should not be shown to the user as results.
 */
function isAgentLifecycleResult(content: unknown): boolean {
  const text = extractTextContent(content).trim()
  if (!text) return false
  // Detect JSON lifecycle messages: shutdown_approved, shutdown_rejected, teammate_terminated
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (typeof parsed.type === 'string' && AGENT_LIFECYCLE_TYPES.has(parsed.type)) {
        return true
      }
    } catch {
      // Not valid JSON, not a lifecycle message
    }
  }
  return false
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((chunk) => {
        if (typeof chunk === 'string') return chunk
        if (chunk && typeof chunk === 'object' && 'text' in chunk) {
          return typeof chunk.text === 'string' ? chunk.text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    if (
      'status' in content &&
      (content as Record<string, unknown>).status === 'completed' &&
      Array.isArray((content as Record<string, unknown>).content)
    ) {
      return extractTextContent((content as Record<string, unknown>).content)
    }
    }
  if (content && typeof content === 'object') {
    return JSON.stringify(content)
  }
  return ''
}
