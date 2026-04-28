import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export function StreamingIndicator() {
  const t = useTranslation()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const statusVerb = sessionState?.statusVerb ?? ''
  const activeToolName = sessionState?.activeToolName ?? ''
  const streamingToolInput = sessionState?.streamingToolInput ?? ''
  const elapsedSeconds = sessionState?.elapsedSeconds ?? 0
  const tokenUsage = sessionState?.tokenUsage ?? { input_tokens: 0, output_tokens: 0 }
  const label = getStatusLabel({
    chatState,
    statusVerb,
    activeToolName,
    streamingToolInput,
    t,
  })

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 inline-flex min-h-7 max-w-full items-center gap-2 px-1 text-[12px] text-[var(--color-text-tertiary)]"
    >
      <span
        className="relative flex h-4 w-4 shrink-0 items-center justify-center"
        aria-hidden="true"
      >
        <span className="absolute h-4 w-4 rounded-full bg-[var(--color-brand)]/16 animate-ping" />
        <span className="h-2 w-2 rounded-full bg-[var(--color-brand)] ring-4 ring-[var(--color-brand)]/8" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-semibold text-[var(--color-text-primary)]">{label}</span>
        {elapsedSeconds > 0 && (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            {formatElapsed(elapsedSeconds)}
          </span>
        )}
        {tokenUsage.output_tokens > 0 && (
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            · ↓ {tokenUsage.output_tokens}
          </span>
        )}
      </div>
    </div>
  )
}

function getStatusLabel(args: {
  chatState: string
  statusVerb: string
  activeToolName: string
  streamingToolInput: string
  t: ReturnType<typeof useTranslation>
}): string {
  const explicit = args.statusVerb.trim()
  if (explicit && explicit !== 'Thinking') return explicit

  if (args.chatState === 'permission_pending') {
    return args.t('agentStatus.waitingApproval')
  }

  if (args.chatState === 'tool_executing') {
    const toolName = args.activeToolName || extractToolNameFromInput(args.streamingToolInput)
    return args.t('agentStatus.callingTool', {
      toolName: formatToolName(toolName || 'tool', args.t),
    })
  }

  if (args.chatState === 'streaming') return args.t('agentStatus.writing')
  return args.t('agentStatus.thinking')
}

function extractToolNameFromInput(value: string): string {
  if (!value.trim()) return ''
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return typeof parsed.tool === 'string' ? parsed.tool : ''
  } catch {
    return ''
  }
}

function formatToolName(toolName: string, t: ReturnType<typeof useTranslation>): string {
  const known: Record<string, string> = {
    get_current_time: t('toolName.time'),
    calculate: t('toolName.calculator'),
    get_weather: t('toolName.weather'),
    web_search: t('toolName.webSearch'),
    web_fetch: t('toolName.webFetch'),
    read_file: t('toolName.readFile'),
    list_files: t('toolName.listFiles'),
    search_text: t('toolName.search'),
    write_file: t('toolName.writeFile'),
    edit_file: t('toolName.editFile'),
    apply_patch: t('toolName.patch'),
    run_command: t('toolName.shell'),
  }
  return known[toolName] ?? toolName
}
