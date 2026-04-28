import { useMemo, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { CodeViewer } from './CodeViewer'
import { DiffViewer } from './DiffViewer'
import { TerminalChrome } from './TerminalChrome'
import { CopyButton } from '../shared/CopyButton'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { InlineImageGallery } from './InlineImageGallery'
import type { AgentTaskNotification, ToolResultMetadata } from '../../types/chat'

type Props = {
  toolName: string
  toolUseId?: string
  input: unknown
  result?: { content: unknown; isError: boolean; metadata?: ToolResultMetadata } | null
  agentTaskNotification?: AgentTaskNotification
  compact?: boolean
}

const TOOL_ICONS: Record<string, string> = {
  Bash: 'terminal',
  run_command: 'terminal',
  Read: 'description',
  read_file: 'description',
  Write: 'edit_document',
  write_file: 'edit_document',
  Edit: 'edit_note',
  edit_file: 'edit_note',
  apply_patch: 'edit_note',
  Glob: 'search',
  list_files: 'search',
  Grep: 'find_in_page',
  search_text: 'find_in_page',
  Agent: 'smart_toy',
  WebSearch: 'travel_explore',
  web_search: 'travel_explore',
  WebFetch: 'cloud_download',
  web_fetch: 'cloud_download',
  get_weather: 'travel_explore',
  get_current_time: 'schedule',
  calculate: 'calculate',
  request_access: 'shield',
  screenshot: 'image',
  zoom: 'image',
  left_click: 'mouse',
  double_click: 'mouse',
  triple_click: 'mouse',
  right_click: 'mouse',
  middle_click: 'mouse',
  mouse_move: 'mouse',
  left_click_drag: 'mouse',
  scroll: 'mouse',
  type: 'keyboard',
  key: 'keyboard',
  hold_key: 'keyboard',
  open_application: 'apps',
  run_desktop_intent: 'auto_awesome',
  switch_display: 'desktop_windows',
  cursor_position: 'mouse',
  wait: 'schedule',
  computer_batch: 'mouse',
  NotebookEdit: 'note',
  Skill: 'auto_awesome',
}

function ToolIcon({ name }: { name: string }) {
  const className = "w-[14px] h-[14px] text-[var(--color-outline)]"
  switch (name) {
    case 'terminal':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>)
    case 'description':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>)
    case 'edit_document':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" /></svg>)
    case 'edit_note':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>)
    case 'search':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>)
    case 'find_in_page':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><circle cx="10" cy="15" r="2" /></svg>)
    case 'smart_toy':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg>)
    case 'travel_explore':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="3" /><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 6.9 8 11.7z" /></svg>)
    case 'cloud_download':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>)
    case 'note':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>)
    case 'auto_awesome':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>)
    case 'schedule':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>)
    case 'calculate':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><line x1="8" y1="7" x2="16" y2="7" /><line x1="8" y1="11" x2="10" y2="11" /><line x1="14" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="10" y2="15" /><line x1="14" y1="15" x2="16" y2="15" /></svg>)
    case 'shield':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-5" /></svg>)
    case 'image':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>)
    case 'mouse':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h8l4 4v11a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3Z" /><path d="M14 3v5h5" /><path d="M10 12h4" /></svg>)
    case 'keyboard':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h.01M11 10h.01M15 10h.01M19 10h.01M7 14h10" /></svg>)
    case 'apps':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>)
    case 'desktop_windows':
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" /></svg>)
    default:
      return (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>)
  }
}
export function ToolCallBlock({ toolName, toolUseId, input, result, compact = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()
  const activeSessionId = useTabStore((s) => s.activeTabId)
  const chatState = useChatStore((s) => activeSessionId ? s.sessions[activeSessionId]?.chatState : undefined)
  const rollbackPatch = useChatStore((s) => s.rollbackPatch)
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const icon = TOOL_ICONS[toolName] || 'build'
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
  const summary = getToolSummary(toolName, obj, t)
  const outputSummary = getToolResultSummary(
    toolName,
    result?.content,
    result?.isError ?? false,
    t,
    result?.metadata,
  )

  const preview = useMemo(() => renderPreview(toolName, obj, result, t), [obj, result, toolName, t])
  const details = useMemo(() => renderDetails(), [])
  const hasResultDetails = Boolean(
    result &&
    extractTextContent(result.content) &&
    !isQuietTool(toolName),
  )
  const expandable =
    Boolean(preview) ||
    Boolean(details) ||
    toolName === 'Edit' ||
    toolName === 'Write' ||
    toolName === 'apply_patch' ||
    hasResultDetails
  const reversePatch = typeof result?.metadata?.patch?.reversePatch === 'string'
    ? result.metadata.patch.reversePatch
    : ''
  const canRollback = Boolean(
    toolName === 'apply_patch' &&
    toolUseId &&
    result &&
    !result.isError &&
    reversePatch.trim(),
  )
  const rollbackDisabled = !activeSessionId ||
    chatState === 'thinking' ||
    chatState === 'streaming' ||
    chatState === 'tool_executing' ||
    chatState === 'permission_pending'

  const handleRollback = () => {
    if (!activeSessionId || !toolUseId || !reversePatch.trim()) return
    rollbackPatch(activeSessionId, toolUseId, reversePatch)
  }
  const actionLabel = getToolActionLabel(toolName, result?.isError === true, Boolean(result), t, obj)

  return (
    <div className={compact ? 'mb-0' : 'mb-2'}>
      <button
        type="button"
        onClick={() => {
          if (expandable) {
            setExpanded((value) => !value)
          }
        }}
        className="group/tool inline-flex min-h-7 max-w-full items-center gap-2 px-0.5 py-1 text-left text-[12px] transition-colors hover:text-[var(--color-text-primary)]"
      >
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          result?.isError
            ? 'text-[var(--color-error)]'
            : result
              ? 'text-[var(--color-success)]'
              : 'text-[var(--color-brand)]'
        }`}>
          {result ? (
            result.isError ? (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            ) : (
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            )
          ) : (
            <ToolIcon name={icon} />
          )}
        </span>
        <span className="shrink-0 font-medium text-[var(--color-text-secondary)]">
          {actionLabel}
        </span>
        {filePath ? (
          <span className="min-w-0 max-w-[360px] truncate text-[11px] text-[var(--color-text-tertiary)]">
            {filePath.split('/').pop()}
          </span>
        ) : summary ? (
          <span className="min-w-0 max-w-[360px] truncate text-[11px] text-[var(--color-text-tertiary)]">
            {summary}
          </span>
        ) : (
          null
        )}
        {result && outputSummary && (
          <span
            className={`shrink-0 text-[10px] ${
              result.isError
                ? 'text-[var(--color-error)]'
                : 'text-[var(--color-outline)]'
            }`}
          >
            {outputSummary}
          </span>
        )}
        {expandable && (
          <svg className="h-3.5 w-3.5 text-[var(--color-outline)] opacity-70 transition-opacity group-hover/tool:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{expanded ? (<polyline points="18 15 12 9 6 15" />) : (<polyline points="6 9 12 15 18 9" />)}</svg>
        )}
      </button>

      {expandable && expanded && (
        <div className="ml-7 space-y-2.5 border-l border-[var(--color-border)]/60 px-3 py-2.5">
          {canRollback && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleRollback}
                disabled={rollbackDisabled}
                title={t('tool.rollbackPatch')}
                aria-label={t('tool.rollbackPatch')}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t('tool.rollbackPatch')}</span>
              </button>
            </div>
          )}
          {preview}
          {details}
        </div>
      )}
    </div>
  )
}

function renderPreview(
  toolName: string,
  obj: Record<string, unknown>,
  result?: { content: unknown; isError: boolean } | null,
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : 'file'

  if ((toolName === 'Edit' || toolName === 'edit_file') && typeof obj.old_string === 'string' && typeof obj.new_string === 'string') {
    return <DiffViewer filePath={filePath} oldString={obj.old_string} newString={obj.new_string} />
  }

  if ((toolName === 'Write' || toolName === 'write_file') && typeof obj.content === 'string') {
    return <DiffViewer filePath={filePath} oldString="" newString={obj.content} />
  }

  if (toolName === 'apply_patch' && typeof obj.patch === 'string') {
    return <CodeViewer code={obj.patch} language="diff" maxLines={36} />
  }

  if ((toolName === 'Bash' || toolName === 'run_command') && typeof obj.command === 'string') {
    return (
      <TerminalChrome title={typeof obj.description === 'string' ? obj.description : filePath}>
        <div className="px-3 py-2.5 font-[var(--font-mono)] text-[11px] leading-[1.3] text-[var(--color-terminal-fg)]">
          <span className="text-[var(--color-terminal-accent)]">$</span> {obj.command}
        </div>
      </TerminalChrome>
    )
  }

  if (toolName === 'Read' || toolName === 'read_file') {
    return null
  }

  if (result && isFriendlyResultTool(toolName)) {
    const text = extractTextContent(result.content)
    if (!text) return null
    if (result.isError) return <ReadableTextPreview text={text} />

    if (toolName === 'get_weather') {
      return <WeatherResultPreview text={text} fallbackLocation={typeof obj.location === 'string' ? obj.location : ''} />
    }

    if (toolName === 'web_search' || toolName === 'WebSearch') {
      return <WebSearchResultPreview text={text} query={typeof obj.query === 'string' ? obj.query : ''} />
    }

    if (toolName === 'web_fetch' || toolName === 'WebFetch') {
      return <ReadableTextPreview title={typeof obj.url === 'string' ? getHost(obj.url) || obj.url : ''} text={text} />
    }

    if (toolName === 'calculate') {
      return <SimpleResultPreview text={text} />
    }

    if (toolName === 'get_current_time') {
      return <SimpleResultPreview text={text} />
    }

    if (toolName === 'Skill') {
      return <SimpleResultPreview text={text} maxLines={4} />
    }
  }

  if (result) {
    const images = extractImageSources(result.content)
    const text = extractTextContent(result.content)
    if (images.length > 0) {
      return (
        <div className="max-w-[720px] space-y-2 border-l border-[var(--color-border)]/70 px-3 py-1.5">
          <div className="grid gap-2">
            {images.map((src, index) => (
              <img
                key={`${src.slice(0, 48)}-${index}`}
                src={src}
                alt=""
                className="max-h-[420px] max-w-full rounded-md border border-[var(--color-border)] object-contain"
              />
            ))}
          </div>
          {text && <ReadableTextPreview text={text} maxLines={4} />}
        </div>
      )
    }
    if (text) {
      return (
        <>
          <InlineImageGallery text={text} />
          <div className={`max-w-[720px] border-l px-3 py-1.5 ${
            result.isError
              ? 'border-[var(--color-error)]/45'
              : 'border-[var(--color-border)]/70'
          }`}>
            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-[var(--color-outline)]">
              <span>{result.isError ? t?.('tool.errorOutput') ?? 'Error Output' : t?.('tool.toolOutput') ?? 'Tool Output'}</span>
              <CopyButton
                text={text}
                className="px-1 py-0.5 text-[10px] normal-case tracking-normal text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-primary)]"
              />
            </div>
            <CodeViewer code={text} language="plaintext" maxLines={18} />
          </div>
        </>
      )
    }
  }

  return null
}

function renderDetails() {
  return null
}

const QUIET_TOOLS = new Set([
  'Read',
  'read_file',
  'Glob',
  'list_files',
  'Grep',
  'search_text',
  'get_weather',
  'web_search',
  'WebSearch',
  'web_fetch',
  'WebFetch',
  'get_current_time',
  'calculate',
  'Skill',
])

function isQuietTool(toolName: string): boolean {
  return QUIET_TOOLS.has(toolName)
}

function isFriendlyResultTool(toolName: string): boolean {
  return (
    toolName === 'get_weather' ||
    toolName === 'web_search' ||
    toolName === 'WebSearch' ||
    toolName === 'web_fetch' ||
    toolName === 'WebFetch' ||
    toolName === 'get_current_time' ||
    toolName === 'calculate' ||
    toolName === 'Skill'
  )
}

function WeatherResultPreview({
  text,
  fallbackLocation,
}: {
  text: string
  fallbackLocation: string
}) {
  const fields = parseKeyValueLines(text)
  const location = fields.Location || fallbackLocation
  const temperature = fields.Temperature || ''
  const weather = fields.Weather || ''
  const details = [
    ['Feels like', fields['Feels like']],
    ['Humidity', fields.Humidity],
    ['Precipitation', fields.Precipitation],
    ['Wind speed', fields['Wind speed']],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))

  return (
    <div className="max-w-[620px] border-l border-[var(--color-border)]/70 px-3 py-1.5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-[var(--color-text-primary)]">
            {location || 'Weather'}
          </div>
          {weather && (
            <div className="mt-0.5 text-[11px] text-[var(--color-text-secondary)]">
              {weather}
            </div>
          )}
        </div>
        {temperature && (
          <div className="shrink-0 text-[15px] font-semibold text-[var(--color-text-primary)]">
            {temperature}
          </div>
        )}
      </div>
      {details.length > 0 && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {details.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <div className="text-[10px] text-[var(--color-text-tertiary)]">{label}</div>
              <div className="truncate text-[12px] text-[var(--color-text-secondary)]">{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WebSearchResultPreview({
  text,
  query,
}: {
  text: string
  query: string
}) {
  const results = parseSearchResults(text)
  if (results.length === 0) {
    return <ReadableTextPreview title={query} text={text} />
  }

  return (
    <div className="max-w-[720px] border-l border-[var(--color-border)]/70 px-3 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-4">
        <div className="min-w-0 truncate text-[12px] text-[var(--color-text-secondary)]">
          {query || 'Search results'}
        </div>
        <div className="shrink-0 text-[11px] text-[var(--color-text-tertiary)]">
          {results.length} results
        </div>
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {results.map((result) => (
          <div key={`${result.title}-${result.url}`} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 py-1.5 text-[12px]">
            <div className="min-w-0 truncate font-medium text-[var(--color-text-primary)]">
              {result.title}
            </div>
            <div className="max-w-[190px] truncate text-[11px] text-[var(--color-text-tertiary)]">
              {getHost(result.url)}
            </div>
            {result.snippet && (
              <div className="col-span-2 line-clamp-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">
                {result.snippet}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function ReadableTextPreview({
  title,
  text,
  maxLines = 8,
}: {
  title?: string
  text: string
  maxLines?: number
}) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)

  return (
    <div className="max-w-[680px] border-l border-[var(--color-border)]/70 px-3 py-1.5">
      {title && (
        <div className="mb-2 truncate text-[12px] font-medium text-[var(--color-text-secondary)]">
          {title}
        </div>
      )}
      <div className="space-y-1.5 text-[12px] leading-5 text-[var(--color-text-secondary)]">
        {lines.map((line, index) => (
          <p key={`${index}-${line}`} className="m-0 line-clamp-2">{line}</p>
        ))}
      </div>
    </div>
  )
}

function SimpleResultPreview({
  text,
  maxLines = 6,
}: {
  text: string
  maxLines?: number
}) {
  return <ReadableTextPreview text={text} maxLines={maxLines} />
}

function getToolResultSummary(
  toolName: string,
  content: unknown,
  isError: boolean,
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string,
  metadata?: ToolResultMetadata,
): string {
  const metadataSummary = typeof metadata?.summary === 'string' ? metadata.summary : ''
  const duration = typeof metadata?.durationMs === 'number'
    ? formatDuration(metadata.durationMs)
    : ''
  const metadataLine = [metadataSummary, duration].filter(Boolean).join(' · ')
  if (metadataLine && (toolName === 'Bash' || toolName === 'run_command' || !content)) {
    return metadataLine
  }

  const text = extractTextContent(content)
  if (!text) return metadataLine

  if (isError) {
    if (metadataLine) return metadataLine

    const firstLine = text
      .split('\n')
      .map((line) => stripAnsi(line).replace(/\s+/g, ' ').trim())
      .find(Boolean)

    if (!firstLine) {
      return t?.('tool.error') ?? 'Error'
    }

    return firstLine.length <= 72 ? firstLine : `${firstLine.slice(0, 72)}…`
  }

  if (toolName === 'Bash' || toolName === 'run_command') return ''
  if (metadataLine) return metadataLine

  const lineCount = text.split('\n').length
  if (lineCount > 1) {
    return t?.('tool.linesOutput', { count: lineCount }) ?? `${lineCount} lines output`
  }

  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  if (compact.length <= 36) return compact
  return `${compact.slice(0, 36)}…`
}

type SearchPreviewResult = {
  title: string
  url: string
  snippet: string
}

function parseKeyValueLines(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^([^:]+):\s*(.+)$/.exec(line.trim())
    if (!match) continue
    result[match[1]!.trim()] = match[2]!.trim()
  }
  return result
}

function parseSearchResults(text: string): SearchPreviewResult[] {
  const results: SearchPreviewResult[] = []
  let current: SearchPreviewResult | null = null

  const pushCurrent = () => {
    if (!current?.title) return
    results.push({
      title: current.title,
      url: current.url,
      snippet: current.snippet.trim(),
    })
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    const titleMatch = /^\d+\.\s+(.+)$/.exec(line)
    if (titleMatch) {
      pushCurrent()
      current = { title: titleMatch[1]!.trim(), url: '', snippet: '' }
      continue
    }

    const urlMatch = /^URL:\s*(.+)$/.exec(line)
    if (urlMatch && current) {
      current.url = urlMatch[1]!.trim()
      continue
    }

    if (current) {
      current.snippet = `${current.snippet}${current.snippet ? ' ' : ''}${line}`
    }
  }

  pushCurrent()
  return results
}

function getHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, '')
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

function getToolSummary(toolName: string, obj: Record<string, unknown>, t?: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  switch (toolName) {
    case 'Bash':
    case 'run_command':
      return typeof obj.command === 'string' ? obj.command : ''
    case 'Read':
    case 'read_file':
      return t?.('tool.readFileContents') ?? 'Read file contents'
    case 'Write':
    case 'write_file':
      return typeof obj.content === 'string'
        ? (t?.('tool.linesCreated', { count: obj.content.split('\n').length }) ?? `${obj.content.split('\n').length} lines created`)
        : (t?.('tool.createFile') ?? 'Create file')
    case 'Edit':
    case 'edit_file':
      return typeof obj.old_string === 'string' && typeof obj.new_string === 'string'
        ? changedLineSummary(obj.old_string, obj.new_string, t)
        : (t?.('tool.updateFileContents') ?? 'Update file contents')
    case 'apply_patch':
      return typeof obj.patch === 'string'
        ? summarizePatchInput(obj.patch)
        : (t?.('tool.updateFileContents') ?? 'Update file contents')
    case 'Glob':
    case 'list_files':
      return typeof obj.pattern === 'string' ? obj.pattern : ''
    case 'Grep':
    case 'search_text':
      return typeof obj.pattern === 'string' ? obj.pattern : ''
    case 'Agent':
      return typeof obj.description === 'string' ? obj.description : ''
    case 'Skill':
      return typeof obj.skill === 'string' ? obj.skill : ''
    case 'get_weather':
      return typeof obj.location === 'string' ? obj.location : ''
    case 'web_search':
    case 'WebSearch':
      return typeof obj.query === 'string' ? obj.query : ''
    case 'web_fetch':
    case 'WebFetch':
      return typeof obj.url === 'string' ? obj.url : ''
    case 'get_current_time':
      return typeof obj.time_zone === 'string' ? obj.time_zone : 'local'
    case 'calculate':
      return typeof obj.expression === 'string' ? obj.expression : ''
    case 'request_access':
      return Array.isArray(obj.apps) ? obj.apps.join(', ') : ''
    case 'open_application':
      return typeof obj.app === 'string' ? obj.app : ''
    case 'run_desktop_intent':
      return typeof obj.query === 'string'
        ? obj.query
        : typeof obj.instruction === 'string'
          ? obj.instruction
          : ''
    case 'switch_display':
      return typeof obj.display === 'string' ? obj.display : ''
    case 'type':
      return typeof obj.text === 'string' ? `${obj.text.length} chars` : ''
    case 'key':
    case 'hold_key':
      return typeof obj.text === 'string' ? obj.text : ''
    case 'scroll':
      return typeof obj.scroll_direction === 'string' ? obj.scroll_direction : ''
    case 'computer_batch':
      return Array.isArray(obj.actions) ? `${obj.actions.length} actions` : ''
    default:
      return ''
  }
}

function getToolActionLabel(
  toolName: string,
  isError: boolean,
  hasResult: boolean,
  t?: (key: TranslationKey, params?: Record<string, string | number>) => string,
  input?: Record<string, unknown>,
): string {
  if (isError) return t?.('tool.error') ?? 'Error'
  switch (toolName) {
    case 'Read':
    case 'read_file':
      return t?.('toolGroup.readOne') ?? 'Read 1 file'
    case 'Write':
    case 'write_file':
      return t?.('toolGroup.createdOne') ?? 'created a file'
    case 'Edit':
    case 'edit_file':
      return t?.('toolGroup.editedOne') ?? 'edited a file'
    case 'apply_patch':
      return t?.('toolGroup.appliedPatch') ?? 'applied a patch'
    case 'Bash':
    case 'run_command':
      return t?.('toolGroup.ranOne') ?? 'ran a command'
    case 'Glob':
    case 'list_files':
      return t?.('toolGroup.foundFiles') ?? 'found files'
    case 'Grep':
    case 'search_text':
      return t?.('toolGroup.searchedOne') ?? 'searched code'
    case 'Agent':
      return t?.('toolGroup.agentOne') ?? 'dispatched an agent'
    case 'Skill': {
      const skill = typeof input?.skill === 'string' ? input.skill.trim() : ''
      return skill
        ? t?.('toolGroup.readSkill', { skill }) ?? `Read ${skill} skill`
        : t?.('toolGroup.readSkillGeneric') ?? 'Read skill'
    }
    case 'get_weather':
      return hasResult ? t?.('toolGroup.checkedWeather') ?? 'checked weather' : 'weather'
    case 'web_search':
    case 'WebSearch':
      return hasResult ? t?.('toolGroup.searchedWeb') ?? 'searched the web' : 'web search'
    case 'web_fetch':
    case 'WebFetch':
      return hasResult ? t?.('toolGroup.fetchedOne') ?? 'fetched a page' : 'web fetch'
    case 'calculate':
      return hasResult ? t?.('toolGroup.calculated') ?? 'calculated' : 'calculate'
    case 'get_current_time':
      return hasResult ? t?.('toolGroup.checkedTime') ?? 'checked time' : 'time'
    case 'request_access':
      return hasResult ? 'checked computer access' : 'request computer access'
    case 'screenshot':
      return hasResult ? 'captured screen' : 'capture screen'
    case 'zoom':
      return hasResult ? 'inspected screen detail' : 'zoom screen'
    case 'left_click':
      return hasResult ? 'clicked' : 'click'
    case 'double_click':
      return hasResult ? 'double-clicked' : 'double click'
    case 'triple_click':
      return hasResult ? 'triple-clicked' : 'triple click'
    case 'right_click':
      return hasResult ? 'right-clicked' : 'right click'
    case 'middle_click':
      return hasResult ? 'middle-clicked' : 'middle click'
    case 'mouse_move':
      return hasResult ? 'moved pointer' : 'move pointer'
    case 'left_click_drag':
      return hasResult ? 'dragged' : 'drag'
    case 'scroll':
      return hasResult ? 'scrolled' : 'scroll'
    case 'type':
      return hasResult ? 'typed text' : 'type text'
    case 'key':
      return hasResult ? 'pressed key' : 'press key'
    case 'hold_key':
      return hasResult ? 'held key' : 'hold key'
    case 'open_application':
      return hasResult ? 'opened app' : 'open app'
    case 'run_desktop_intent':
      return hasResult ? 'ran desktop intent' : 'run desktop intent'
    case 'switch_display':
      return hasResult ? 'switched display' : 'switch display'
    case 'cursor_position':
      return hasResult ? 'checked pointer' : 'pointer position'
    case 'wait':
      return hasResult ? 'waited' : 'wait'
    case 'computer_batch':
      return hasResult ? 'used computer' : 'use computer'
    default:
      return toolName
  }
}

function summarizePatchInput(patch: string): string {
  const fileCount = new Set(
    patch
      .split(/\r?\n/)
      .filter((line) => line.startsWith('+++ ') && !line.includes('/dev/null'))
      .map((line) => line.replace(/^\+\+\+\s+/, '').replace(/^[ab]\//, '').trim()),
  ).size
  if (fileCount <= 0) return 'Apply patch'
  return fileCount === 1 ? '1 file patch' : `${fileCount} file patch`
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((chunk: any) => (typeof chunk === 'string' ? chunk : chunk?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content, null, 2)
  }
  return null
}

function extractImageSources(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content
    .map((chunk: any) => {
      if (chunk?.type !== 'image') return ''
      if (chunk.source?.type === 'base64' && chunk.source?.data) {
        const mime = chunk.source.media_type || 'image/png'
        return `data:${mime};base64,${chunk.source.data}`
      }
      if (chunk.data) {
        return `data:${chunk.mimeType || 'image/png'};base64,${chunk.data}`
      }
      return ''
    })
    .filter(Boolean)
}

function changedLineSummary(oldString: string, newString: string, t?: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const oldLines = oldString.split('\n')
  const newLines = newString.split('\n')
  let changed = 0
  const max = Math.max(oldLines.length, newLines.length)

  for (let index = 0; index < max; index += 1) {
    if ((oldLines[index] ?? '') !== (newLines[index] ?? '')) {
      changed += 1
    }
  }

  return t?.('tool.linesChanged', { count: changed }) ?? `${changed} lines changed`
}
