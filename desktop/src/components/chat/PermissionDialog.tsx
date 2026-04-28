import { useState } from 'react'
import {
  BadgeCheck,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  CloudDownload,
  FileText,
  Folder,
  Globe,
  NotebookPen,
  PencilLine,
  Search,
  Shield,
  Sparkles,
  SquareTerminal,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { Button } from '../shared/Button'
import { DiffViewer } from './DiffViewer'
import { CodeViewer } from './CodeViewer'

type Props = {
  requestId: string
  toolName: string
  input: unknown
  description?: string
}

const TOOL_META: Record<string, { icon: LucideIcon; label: string; color: string }> = {
  Bash: { icon: SquareTerminal, label: 'Bash', color: 'var(--color-warning)' },
  run_command: { icon: SquareTerminal, label: 'Run Command', color: 'var(--color-warning)' },
  Edit: { icon: PencilLine, label: 'Edit File', color: 'var(--color-brand)' },
  edit_file: { icon: PencilLine, label: 'Edit File', color: 'var(--color-brand)' },
  apply_patch: { icon: PencilLine, label: 'Apply Patch', color: 'var(--color-brand)' },
  Write: { icon: FileText, label: 'Write File', color: 'var(--color-success)' },
  write_file: { icon: FileText, label: 'Write File', color: 'var(--color-success)' },
  Read: { icon: FileText, label: 'Read File', color: 'var(--color-secondary)' },
  read_file: { icon: FileText, label: 'Read File', color: 'var(--color-secondary)' },
  Glob: { icon: Search, label: 'Glob Search', color: 'var(--color-secondary)' },
  list_files: { icon: Search, label: 'List Files', color: 'var(--color-secondary)' },
  Grep: { icon: Search, label: 'Grep Search', color: 'var(--color-secondary)' },
  search_text: { icon: Search, label: 'Search Text', color: 'var(--color-secondary)' },
  Agent: { icon: Bot, label: 'Agent', color: 'var(--color-tertiary)' },
  WebSearch: { icon: Globe, label: 'Web Search', color: 'var(--color-secondary)' },
  WebFetch: { icon: CloudDownload, label: 'Web Fetch', color: 'var(--color-secondary)' },
  NotebookEdit: { icon: NotebookPen, label: 'Notebook Edit', color: 'var(--color-brand)' },
  Skill: { icon: Sparkles, label: 'Skill', color: 'var(--color-tertiary)' },
}

/**
 * Extract human-readable detail lines from tool input.
 */
function extractToolDetails(toolName: string, input: unknown, t: (key: TranslationKey, params?: Record<string, string | number>) => string): { primary: string; secondary?: string } {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}

  switch (toolName) {
    case 'Bash':
    case 'run_command': {
      const cmd = typeof obj.command === 'string' ? obj.command : ''
      const desc = typeof obj.description === 'string' ? obj.description : undefined
      return { primary: cmd, secondary: desc }
    }
    case 'Edit':
    case 'edit_file': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath, secondary: obj.old_string ? t('permission.replacingContent') : undefined }
    }
    case 'apply_patch':
      return { primary: summarizePatchFiles(typeof obj.patch === 'string' ? obj.patch : '') }
    case 'Write':
    case 'write_file': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath }
    }
    case 'Read':
    case 'read_file': {
      const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
      return { primary: filePath }
    }
    case 'Glob':
    case 'list_files':
      return { primary: typeof obj.pattern === 'string' ? obj.pattern : '' }
    case 'Grep':
    case 'search_text':
      return { primary: typeof obj.pattern === 'string' ? obj.pattern : '' }
    case 'Agent':
      return { primary: typeof obj.description === 'string' ? obj.description : '' }
    case 'WebSearch':
      return { primary: typeof obj.query === 'string' ? obj.query : '' }
    case 'WebFetch':
      return { primary: typeof obj.url === 'string' ? obj.url : '' }
    default:
      return { primary: typeof input === 'string' ? input : JSON.stringify(input, null, 2) }
  }
}

function getPermissionTitle(toolName: string, input: unknown, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : ''
  const fileName = filePath ? filePath.split('/').pop() || filePath : ''

  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'edit_file':
    case 'write_file':
    case 'apply_patch':
      return fileName ? t('permission.allowEditFile', { toolName, fileName }) : t('permission.allowEditFileGeneric', { toolName: toolName.toLowerCase() })
    case 'Bash':
    case 'run_command':
      return t('permission.allowBash')
    default:
      return t('permission.allowTool', { toolName })
  }
}

function renderPermissionPreview(toolName: string, input: unknown) {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
  const filePath = typeof obj.file_path === 'string' ? obj.file_path : 'file'

  if ((toolName === 'Edit' || toolName === 'edit_file') && typeof obj.old_string === 'string' && typeof obj.new_string === 'string') {
    return <DiffViewer filePath={filePath} oldString={obj.old_string} newString={obj.new_string} />
  }

  if ((toolName === 'Write' || toolName === 'write_file') && typeof obj.content === 'string') {
    return <DiffViewer filePath={filePath} oldString="" newString={obj.content} />
  }

  if (toolName === 'apply_patch' && typeof obj.patch === 'string') {
    return <CodeViewer code={obj.patch} language="diff" maxLines={40} />
  }

  if ((toolName === 'Bash' || toolName === 'run_command') && typeof obj.command === 'string') {
    return (
      <div className="overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-terminal-bg)] px-3 py-2.5">
        <pre className="font-[var(--font-mono)] text-[11px] leading-[1.3] text-[var(--color-terminal-fg)] whitespace-pre-wrap break-words">
          <span className="text-[var(--color-terminal-accent)] select-none">$ </span>{obj.command}
        </pre>
      </div>
    )
  }

  return null
}

function summarizePatchFiles(patch: string): string {
  const files = patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+++ ') && !line.includes('/dev/null'))
    .map((line) => line.replace(/^\+\+\+\s+/, '').replace(/^[ab]\//, '').trim())
    .filter(Boolean)
  if (files.length === 0) return ''
  if (files.length === 1) return files[0]!
  return `${files.length} files`
}

export function PermissionDialog({ requestId, toolName, input, description }: Props) {
  const { respondToPermission } = useChatStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const pendingPermission = useChatStore((s) => activeTabId ? s.sessions[activeTabId]?.pendingPermission : undefined)
  const t = useTranslation()
  const isPending = pendingPermission?.requestId === requestId
  const [showRaw, setShowRaw] = useState(false)

  if (!isPending) return null

  const meta = TOOL_META[toolName] || { icon: Shield, label: toolName, color: 'var(--color-text-tertiary)' }
  const MetaIcon = meta.icon
  const details = extractToolDetails(toolName, input, t)
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input, null, 2)
  const preview = renderPermissionPreview(toolName, input)
  const title = getPermissionTitle(toolName, input, t)
  const allowRawToggle = !preview

  return (
    <div className="mb-4 ml-10 border-l-2 border-[var(--color-warning)] py-2 pl-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-7 w-7 items-center justify-center"
        >
          <MetaIcon size={18} strokeWidth={2} style={{ color: meta.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">
              {title}
            </span>
            {isPending && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-warning)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] animate-pulse-dot" />
                {t('permission.awaitingApproval')}
              </span>
            )}
            {!isPending && (
              <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                {t('permission.responded')}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] truncate">{description}</p>
          )}
        </div>
      </div>

      {/* Tool details */}
      <div className="mt-3">
        {preview ? (
          <div className="space-y-2">
            {details.primary && toolName !== 'Bash' ? (
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                <Folder size={14} strokeWidth={2} className="flex-shrink-0 text-[#554741]" />
                <span className="truncate">{details.primary}</span>
              </div>
            ) : null}
            {preview}
          </div>
        ) : details.primary ? (
          <div className="mb-2">
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              {toolName === 'Glob' || toolName === 'Grep' ? (
                <Search size={14} strokeWidth={2} className="flex-shrink-0 text-[#554741]" />
              ) : (
                <Folder size={14} strokeWidth={2} className="flex-shrink-0 text-[#554741]" />
              )}
              <span className="truncate">{details.primary}</span>
            </div>
          </div>
        ) : null}

        {/* Secondary detail */}
        {details.secondary && (
          <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">{details.secondary}</p>
        )}

        {allowRawToggle && (
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="mt-2 flex cursor-pointer items-center gap-1 text-[11px] text-[var(--color-text-accent)] hover:underline"
          >
            {showRaw ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
            {showRaw ? t('permission.hideDetails') : t('permission.showFullInput')}
          </button>
        )}

        {allowRawToggle && showRaw && (
          <pre className="mt-2 max-h-[220px] overflow-y-auto overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-terminal-bg)] px-3 py-2.5 font-[var(--font-mono)] text-[11px] leading-[1.3] text-[var(--color-terminal-fg)] whitespace-pre-wrap break-words">
            {rawInput}
          </pre>
        )}
      </div>

      {/* Action buttons */}
      {isPending && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => activeTabId && respondToPermission(activeTabId, requestId, true)}
            icon={
              <Check size={14} strokeWidth={2} />
            }
          >
            {t('permission.allow')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => activeTabId && respondToPermission(activeTabId, requestId, true, { rule: 'always' })}
            icon={
              <BadgeCheck size={14} strokeWidth={2} />
            }
          >
            {t('permission.allowForSession')}
          </Button>
          <div className="flex-1" />
          <Button
            variant="danger"
            size="sm"
            onClick={() => activeTabId && respondToPermission(activeTabId, requestId, false)}
            icon={
              <X size={14} strokeWidth={2} />
            }
          >
            {t('permission.deny')}
          </Button>
        </div>
      )}
    </div>
  )
}
