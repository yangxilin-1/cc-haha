import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { workspaceApi, type WorkspaceEntry } from '../../api/workspace'
import {
  CodeLineIcon,
  FileLineIcon,
  FolderLineIcon,
  ImageLineIcon,
} from '../shared/LineIcons'

type Props = {
  sessionId: string
  selectedPath?: string | null
  onSelectFile?: (path: string) => void
}

type EntryState = {
  entries: WorkspaceEntry[]
  loading: boolean
  loaded: boolean
  error: string | null
  truncated?: boolean
  truncatedCount?: number
}

const EMPTY_STATE: EntryState = { entries: [], loading: false, loaded: false, error: null }

export function WorkspaceFileTree({ sessionId, selectedPath, onSelectFile }: Props) {
  const [rootState, setRootState] = useState<EntryState>({ ...EMPTY_STATE, loading: true })

  useEffect(() => {
    let cancelled = false
    setRootState({ ...EMPTY_STATE, loading: true })
    workspaceApi.tree(sessionId)
      .then((result) => {
        if (!cancelled) {
          setRootState({
            entries: result.entries,
            loading: false,
            loaded: true,
            error: null,
            truncated: result.truncated,
            truncatedCount: result.truncatedCount,
          })
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRootState({
            entries: [],
            loading: false,
            loaded: true,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => { cancelled = true }
  }, [sessionId])

  if (rootState.loading) {
    return <TreeHint text="加载文件中..." />
  }

  if (rootState.error) {
    return <TreeHint text="无法读取项目文件" />
  }

  if (rootState.entries.length === 0) {
    return <TreeHint text="项目目录为空" />
  }

  return (
    <div className="space-y-0.5">
      {rootState.entries.map((entry) => (
        <TreeNode
          key={entry.relativePath || entry.name}
          sessionId={sessionId}
          entry={entry}
          depth={0}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
        />
      ))}
      {rootState.truncated && (
        <TreeHint
          text={`当前目录较大，已先显示 ${rootState.entries.length} 项${rootState.truncatedCount ? `，还有 ${rootState.truncatedCount} 项未显示` : ''}`}
          compact
        />
      )}
    </div>
  )
}

function TreeNode({
  sessionId,
  entry,
  depth,
  selectedPath,
  onSelectFile,
}: {
  sessionId: string
  entry: WorkspaceEntry
  depth: number
  selectedPath?: string | null
  onSelectFile?: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [state, setState] = useState<EntryState>(EMPTY_STATE)
  const isSelected = selectedPath === entry.relativePath
  const canExpand = entry.isDirectory

  useEffect(() => {
    if (!expanded || !canExpand || state.loaded || state.loading) return
    let cancelled = false
    setState({ ...EMPTY_STATE, loading: true })
    workspaceApi.tree(sessionId, entry.relativePath)
      .then((result) => {
        if (!cancelled) {
          setState({
            entries: result.entries,
            loading: false,
            loaded: true,
            error: null,
            truncated: result.truncated,
            truncatedCount: result.truncatedCount,
          })
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            entries: [],
            loading: false,
            loaded: true,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => { cancelled = true }
  }, [canExpand, entry.relativePath, expanded, sessionId])

  const icon = useMemo(() => <EntryIcon entry={entry} />, [entry])

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (entry.isDirectory) {
            setExpanded((value) => !value)
          } else {
            onSelectFile?.(entry.relativePath)
          }
        }}
        className={`group flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-[13px] transition-colors ${
          isSelected
            ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
        }`}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        title={entry.relativePath}
      >
        {entry.isDirectory ? (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-text-tertiary)]">
            {expanded ? <ChevronDown size={15} strokeWidth={2} /> : <ChevronRight size={15} strokeWidth={2} />}
          </span>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}
        <span className="shrink-0 text-[var(--color-text-tertiary)]">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>

      {expanded && (
        <div className="mt-0.5">
          {state.loading && <TreeHint text="读取中..." compact depth={depth + 1} />}
          {state.error && <TreeHint text={`无法展开：${state.error}`} compact depth={depth + 1} />}
          {!state.loading && !state.error && state.entries.map((child) => (
            <TreeNode
              key={child.relativePath || child.name}
              sessionId={sessionId}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          ))}
          {!state.loading && !state.error && state.truncated && (
            <TreeHint
              text={`已显示 ${state.entries.length} 项${state.truncatedCount ? `，还有 ${state.truncatedCount} 项未显示` : ''}`}
              compact
              depth={depth + 1}
            />
          )}
        </div>
      )}
    </div>
  )
}

function TreeHint({ text, compact = false, depth = 0 }: { text: string; compact?: boolean; depth?: number }) {
  return (
    <div
      className={`text-[12px] text-[var(--color-text-tertiary)] ${compact ? 'py-1' : 'px-2 py-6'}`}
      style={{ paddingLeft: compact ? `${28 + depth * 18}px` : undefined }}
    >
      {text}
    </div>
  )
}

function EntryIcon({ entry }: { entry: WorkspaceEntry }) {
  if (entry.isDirectory) return <FolderLineIcon size={18} />
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  if (['tsx', 'jsx', 'ts', 'js', 'mjs', 'html', 'htm', 'css'].includes(ext)) {
    return <CodeLineIcon size={18} />
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return <ImageLineIcon size={18} />
  }
  return <FileLineIcon size={18} />
}
