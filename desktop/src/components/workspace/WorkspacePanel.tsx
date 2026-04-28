import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Circle,
  CircleCheck,
  ClipboardCheck,
  FileSearch,
  ListTree,
  Maximize2,
  RefreshCw,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Highlight, type PrismTheme } from 'prism-react-renderer'
import {
  workspaceApi,
  type WorkspaceChangeFile,
  type WorkspaceChangeStatus,
  type WorkspaceChangesResponse,
} from '../../api/workspace'
import { useChatStore } from '../../stores/chatStore'
import { useDesktopTaskStore } from '../../stores/desktopTaskStore'
import type { WorkspacePanel as WorkspacePanelKind } from '../../stores/uiStore'
import type { ToolResultMetadata, UIMessage } from '../../types/chat'
import { FileLineIcon, FolderLineIcon, PreviewLineIcon } from '../shared/LineIcons'
import { WorkspaceFileTree } from './WorkspaceFileTree'

type Props = {
  sessionId: string
  panel: WorkspacePanelKind
  selectedFile: string | null
  onSelectFile: (path: string) => void
  onClose: () => void
}

type ConversationChange = {
  path: string
  patch?: string
  additions?: number
  deletions?: number
}

type DisplayChangeFile = WorkspaceChangeFile & {
  source: 'git' | 'conversation' | 'mixed'
}

type WorkspaceChangeState = {
  changes: WorkspaceChangesResponse | null
  loading: boolean
  error: string | null
  refresh: () => void
}

export function WorkspacePanel({
  sessionId,
  panel,
  selectedFile,
  onSelectFile,
  onClose,
}: Props) {
  const messages = useChatStore((s) => s.sessions[sessionId]?.messages ?? [])
  const conversationChanges = useMemo(() => extractConversationChanges(messages), [messages])
  const conversationKey = useMemo(
    () => conversationChanges.map((change) => change.path).join('|'),
    [conversationChanges],
  )
  const workspaceChanges = useWorkspaceChanges(sessionId, conversationKey)
  const changedFiles = useMemo(
    () => mergeChangedFiles(workspaceChanges.changes?.files ?? [], conversationChanges),
    [workspaceChanges.changes?.files, conversationChanges],
  )
  const conversationPatches = useMemo(() => {
    const patches = new Map<string, string>()
    for (const change of conversationChanges) {
      if (change.patch) patches.set(change.path, change.patch)
    }
    return patches
  }, [conversationChanges])

  return (
    <aside className="w-[390px] shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border)]/60 px-4">
          <span className="text-[var(--color-text-tertiary)]">
            {panel === 'files' ? <FolderLineIcon size={18} /> : <PreviewLineIcon size={18} />}
          </span>
          <span className="flex-1 text-sm font-semibold text-[var(--color-text-primary)]">
            {panel === 'files' ? (changedFiles.length > 0 ? '项目文件' : '所有文件') : '预览'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            aria-label="关闭面板"
            title="关闭面板"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {panel === 'files' ? (
          <FilesPanel
            sessionId={sessionId}
            selectedFile={selectedFile}
            changedFiles={changedFiles}
            changesState={workspaceChanges}
            onSelectFile={onSelectFile}
          />
        ) : (
          <PreviewPanel
            sessionId={sessionId}
            selectedFile={selectedFile}
            changedFiles={changedFiles}
            changesState={workspaceChanges}
            conversationPatches={conversationPatches}
            onSelectFile={onSelectFile}
          />
        )}
      </div>
    </aside>
  )
}

function FilesPanel({
  sessionId,
  selectedFile,
  changedFiles,
  changesState,
  onSelectFile,
}: {
  sessionId: string
  selectedFile: string | null
  changedFiles: DisplayChangeFile[]
  changesState: WorkspaceChangeState
  onSelectFile: (path: string) => void
}) {
  const [view, setView] = useState<'changed' | 'all'>(changedFiles.length > 0 ? 'changed' : 'all')

  useEffect(() => {
    setView(changedFiles.length > 0 ? 'changed' : 'all')
  }, [sessionId, changedFiles.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {changedFiles.length > 0 && (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)]/50 px-3">
          <PanelTab active={view === 'changed'} onClick={() => setView('changed')} icon={<ClipboardCheck size={15} />}>
            已更改
          </PanelTab>
          <PanelTab active={view === 'all'} onClick={() => setView('all')} icon={<ListTree size={15} />}>
            所有文件
          </PanelTab>
          <div className="flex-1" />
          <IconButton
            label="刷新"
            onClick={changesState.refresh}
            disabled={changesState.loading}
            icon={<RefreshCw size={14} className={changesState.loading ? 'animate-spin' : ''} />}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {view === 'changed' && changedFiles.length > 0 ? (
          <ChangedFilesList
            files={changedFiles}
            selectedPath={selectedFile}
            loading={changesState.loading}
            error={changesState.error}
            onSelectFile={onSelectFile}
            onRefresh={changesState.refresh}
          />
        ) : (
          <WorkspaceFileTree
            sessionId={sessionId}
            selectedPath={selectedFile}
            onSelectFile={onSelectFile}
          />
        )}
      </div>
    </div>
  )
}

function PreviewPanel({
  sessionId,
  selectedFile,
  changedFiles,
  changesState,
  conversationPatches,
  onSelectFile,
}: {
  sessionId: string
  selectedFile: string | null
  changedFiles: DisplayChangeFile[]
  changesState: WorkspaceChangeState
  conversationPatches: Map<string, string>
  onSelectFile: (path: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'review' | 'overview' | 'file'>(
    changedFiles.length > 0 ? 'review' : 'overview',
  )

  useEffect(() => {
    setActiveTab(changedFiles.length > 0 ? 'review' : 'overview')
  }, [sessionId, changedFiles.length])

  useEffect(() => {
    if (selectedFile) setActiveTab('file')
  }, [selectedFile])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)]/50 px-3">
        {changedFiles.length > 0 && (
          <PanelTab active={activeTab === 'review'} onClick={() => setActiveTab('review')} icon={<ClipboardCheck size={15} />}>
            审查
          </PanelTab>
        )}
        <PanelTab active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={<ListTree size={15} />}>
          概览
        </PanelTab>
        {selectedFile && (
          <PanelTab active={activeTab === 'file'} onClick={() => setActiveTab('file')} icon={<FileSearch size={15} />}>
            {selectedFile.split('/').pop()}
          </PanelTab>
        )}
        <div className="flex-1" />
        <span className="text-[var(--color-text-tertiary)]">
          <Maximize2 size={15} strokeWidth={2} />
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'review' ? (
          <ReviewContent
            sessionId={sessionId}
            changedFiles={changedFiles}
            changesState={changesState}
            conversationPatches={conversationPatches}
            onSelectFile={onSelectFile}
          />
        ) : activeTab === 'overview' ? (
          <OverviewContent sessionId={sessionId} onSelectFile={onSelectFile} />
        ) : selectedFile ? (
          <FilePreview sessionId={sessionId} path={selectedFile} />
        ) : (
          <div className="px-4 py-6 text-sm text-[var(--color-text-tertiary)]">
            从文件列表选择一个文件进行预览。
          </div>
        )}
      </div>

      {activeTab === 'overview' && (
        <div className="shrink-0 border-t border-[var(--color-border)]/50 p-3">
          <div className="mb-2 text-[12px] font-medium text-[var(--color-text-secondary)]">快速打开</div>
          <div className="max-h-[210px] overflow-y-auto">
            <WorkspaceFileTree
              sessionId={sessionId}
              selectedPath={selectedFile}
              onSelectFile={onSelectFile}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function ReviewContent({
  sessionId,
  changedFiles,
  changesState,
  conversationPatches,
  onSelectFile,
}: {
  sessionId: string
  changedFiles: DisplayChangeFile[]
  changesState: WorkspaceChangeState
  conversationPatches: Map<string, string>
  onSelectFile: (path: string) => void
}) {
  const [activePath, setActivePath] = useState<string | null>(changedFiles[0]?.path ?? null)

  useEffect(() => {
    if (changedFiles.length === 0) {
      setActivePath(null)
      return
    }
    if (!activePath || !changedFiles.some((file) => file.path === activePath)) {
      setActivePath(changedFiles[0]?.path ?? null)
    }
  }, [activePath, changedFiles])

  if (changesState.loading && changedFiles.length === 0) {
    return <PanelHint text="正在读取工作区修改..." />
  }

  if (changedFiles.length === 0) {
    return (
      <div className="px-5 py-6">
        <PanelHint text={changesState.error ? `无法读取修改：${changesState.error}` : '当前没有检测到代码修改。'} />
      </div>
    )
  }

  const activeFile = changedFiles.find((file) => file.path === activePath) ?? changedFiles[0]

  return (
    <div className="flex min-h-full flex-col">
      <div className="shrink-0 border-b border-[var(--color-border)]/50 px-3 py-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[12px] font-medium text-[var(--color-text-secondary)]">
            {changedFiles.length} 个文件有改动
          </span>
          <div className="flex-1" />
          <IconButton
            label="刷新"
            onClick={changesState.refresh}
            disabled={changesState.loading}
            icon={<RefreshCw size={14} className={changesState.loading ? 'animate-spin' : ''} />}
          />
        </div>
        {changesState.error && (
          <div className="mb-2 flex items-center gap-1.5 text-[12px] text-[var(--color-warning)]">
            <TriangleAlert size={14} />
            <span className="truncate">{changesState.error}</span>
          </div>
        )}
        <div className="max-h-[160px] overflow-y-auto">
          <ChangedFilesList
            files={changedFiles}
            selectedPath={activeFile?.path ?? null}
            compact
            onSelectFile={(path) => setActivePath(path)}
            onOpenFile={onSelectFile}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activeFile ? (
          <ReviewDiff
            sessionId={sessionId}
            path={activeFile.path}
            fallbackPatch={conversationPatches.get(activeFile.path)}
          />
        ) : (
          <PanelHint text="选择一个已更改文件查看审查内容。" />
        )}
      </div>
    </div>
  )
}

function ChangedFilesList({
  files,
  selectedPath,
  loading = false,
  error = null,
  compact = false,
  onSelectFile,
  onOpenFile,
  onRefresh,
}: {
  files: DisplayChangeFile[]
  selectedPath?: string | null
  loading?: boolean
  error?: string | null
  compact?: boolean
  onSelectFile: (path: string) => void
  onOpenFile?: (path: string) => void
  onRefresh?: () => void
}) {
  return (
    <div className="space-y-0.5">
      {error && !compact && (
        <button
          type="button"
          onClick={onRefresh}
          className="mb-2 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] text-[var(--color-warning)] transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          <TriangleAlert size={15} />
          <span className="min-w-0 flex-1 truncate">无法刷新 Git 状态，点击重试</span>
        </button>
      )}
      {files.map((file) => (
        <button
          type="button"
          key={file.path}
          onClick={() => onSelectFile(file.path)}
          onDoubleClick={() => onOpenFile?.(file.path)}
          className={`group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors ${
            selectedPath === file.path
              ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
          }`}
          title={file.path}
        >
          <span className="shrink-0 text-[var(--color-text-tertiary)]"><FileLineIcon size={17} /></span>
          <span className="min-w-0 flex-1 truncate">{file.path}</span>
          <ChangeBadge status={file.status} />
          {(file.additions > 0 || file.deletions > 0) && (
            <span className="shrink-0 font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
              {formatStats(file)}
            </span>
          )}
        </button>
      ))}
      {loading && files.length > 0 && (
        <div className="px-2 py-2 text-[12px] text-[var(--color-text-tertiary)]">正在刷新...</div>
      )}
    </div>
  )
}

function PanelTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors ${
        active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
    </button>
  )
}

function IconButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string
  icon: ReactNode
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] disabled:cursor-wait disabled:opacity-60"
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  )
}

function OverviewContent({ sessionId, onSelectFile }: { sessionId: string; onSelectFile: (path: string) => void }) {
  const tasks = useDesktopTaskStore((s) => s.sessionId === sessionId ? s.tasks : [])
  const messages = useChatStore((s) => s.sessions[sessionId]?.messages ?? [])
  const generatedFiles = useMemo(() => extractConversationChanges(messages).map((change) => change.path), [messages])
  const completed = tasks.filter((task) => task.status === 'completed').length

  return (
    <div className="space-y-7 px-5 py-5">
      <section>
        <h3 className="mb-3 text-[13px] font-medium text-[var(--color-text-secondary)]">进度</h3>
        {tasks.length > 0 ? (
          <div className="space-y-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-border)]">
              <div
                className="h-full rounded-full bg-[var(--color-success)] transition-all"
                style={{ width: `${Math.round((completed / tasks.length) * 100)}%` }}
              />
            </div>
            {tasks.map((task) => (
              <div key={task.id} className="flex items-start gap-2 text-[13px]">
                <span className={`mt-1 ${
                  task.status === 'completed'
                    ? 'text-[var(--color-success)]'
                    : task.status === 'in_progress'
                      ? 'text-[var(--color-warning)]'
                      : 'text-[var(--color-text-tertiary)]'
                }`}>
                  {task.status === 'completed'
                    ? <CircleCheck size={15} />
                    : task.status === 'in_progress'
                      ? <Circle size={15} />
                      : <Circle size={15} />}
                </span>
                <span className="leading-6 text-[var(--color-text-secondary)]">{task.subject}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-text-tertiary)]">暂无明确任务进度。</p>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-[13px] font-medium text-[var(--color-text-secondary)]">生成结果</h3>
        {generatedFiles.length > 0 ? (
          <div className="space-y-1">
            {generatedFiles.map((file) => (
              <button
                type="button"
                key={file}
                onClick={() => onSelectFile(file)}
                className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-[13px] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                title={file}
              >
                <span className="text-[var(--color-text-tertiary)]"><FileLineIcon size={17} /></span>
                <span className="min-w-0 flex-1 truncate">{file}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-text-tertiary)]">还没有检测到新生成或编辑的文件。</p>
        )}
      </section>

      <section>
        <h3 className="mb-3 text-[13px] font-medium text-[var(--color-text-secondary)]">来源</h3>
        <p className="text-[13px] text-[var(--color-text-tertiary)]">跟踪所用来源会在工具调用完成后显示。</p>
      </section>
    </div>
  )
}

function FilePreview({ sessionId, path }: { sessionId: string; path: string }) {
  const [content, setContent] = useState<string>('')
  const [language, setLanguage] = useState<string>(inferLanguageFromPath(path))
  const [binary, setBinary] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'source' | 'preview'>('source')
  const isHtml = /\.(html|htm)$/i.test(path)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent('')
    setLanguage(inferLanguageFromPath(path))
    setBinary(false)
    setMode(isHtml ? 'preview' : 'source')
    workspaceApi.file(sessionId, path)
      .then((result) => {
        if (cancelled) return
        setContent(result.content || '')
        setLanguage(result.language || inferLanguageFromPath(path))
        setBinary(result.binary)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [isHtml, path, sessionId])

  if (loading) {
    return <div className="px-5 py-6 text-sm text-[var(--color-text-tertiary)]">加载预览中...</div>
  }

  if (error) {
    return <div className="px-5 py-6 text-sm text-[var(--color-error)]">无法预览：{error}</div>
  }

  if (binary) {
    return (
      <div className="px-5 py-6 text-sm text-[var(--color-text-tertiary)]">
        这个文件不是文本格式，暂不支持直接预览。
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      {isHtml && (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--color-border)]/50 px-3">
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={`rounded-md px-2 py-1 text-[12px] ${mode === 'preview' ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
          >
            预览
          </button>
          <button
            type="button"
            onClick={() => setMode('source')}
            className={`rounded-md px-2 py-1 text-[12px] ${mode === 'source' ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}
          >
            源码
          </button>
        </div>
      )}

      {isHtml && mode === 'preview' ? (
        <iframe
          title={path}
          src={workspaceApi.rawFileUrl(sessionId, path)}
          className="min-h-[520px] flex-1 bg-white"
          sandbox="allow-scripts allow-forms allow-modals"
        />
      ) : (
        <CodePreview code={content} language={language} />
      )}
    </div>
  )
}

function ReviewDiff({
  sessionId,
  path,
  fallbackPatch,
}: {
  sessionId: string
  path: string
  fallbackPatch?: string
}) {
  const [diff, setDiff] = useState<string>(fallbackPatch ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setDiff(fallbackPatch ?? '')
    workspaceApi.diff(sessionId, path)
      .then((result) => {
        if (cancelled) return
        setDiff(result.diff.trim() ? result.diff : fallbackPatch ?? '')
        if (result.error) setError(result.error)
      })
      .catch((err) => {
        if (cancelled) return
        if (!fallbackPatch) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [fallbackPatch, path, sessionId])

  if (loading && !diff) {
    return <PanelHint text="正在生成审查内容..." />
  }

  if (!diff) {
    return <PanelHint text={error ? `无法读取 diff：${error}` : '这个文件暂时没有可显示的 diff。'} />
  }

  return (
    <div className="min-h-full">
      {error && (
        <div className="border-b border-[var(--color-border)]/50 px-4 py-2 text-[12px] text-[var(--color-warning)]">
          {error}
        </div>
      )}
      <DiffCodePreview code={diff} />
    </div>
  )
}

const workspaceSyntaxTheme: PrismTheme = {
  plain: {
    color: 'var(--color-code-fg)',
    backgroundColor: 'transparent',
  },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: 'var(--color-code-comment)', fontStyle: 'italic' as const } },
    { types: ['string', 'attr-value', 'template-string'], style: { color: 'var(--color-code-string)' } },
    { types: ['keyword', 'selector', 'important', 'atrule'], style: { color: 'var(--color-code-keyword)' } },
    { types: ['function'], style: { color: 'var(--color-code-function)' } },
    { types: ['tag'], style: { color: 'var(--color-code-keyword)' } },
    { types: ['number', 'boolean'], style: { color: 'var(--color-code-number)' } },
    { types: ['operator'], style: { color: 'var(--color-code-fg)' } },
    { types: ['punctuation'], style: { color: 'var(--color-code-punctuation)' } },
    { types: ['variable', 'parameter'], style: { color: 'var(--color-code-fg)' } },
    { types: ['property', 'attr-name'], style: { color: 'var(--color-code-property)' } },
    { types: ['builtin', 'class-name', 'constant', 'symbol'], style: { color: 'var(--color-code-type)' } },
    { types: ['regex'], style: { color: 'var(--color-primary-container)' } },
    { types: ['inserted'], style: { color: 'var(--color-code-inserted)' } },
    { types: ['deleted'], style: { color: 'var(--color-code-deleted)' } },
  ],
}

function CodePreview({ code, language }: { code: string; language: string }) {
  const safeCode = code || ' '
  const normalizedLanguage = normalizeHighlightLanguage(language)
  return (
    <Highlight theme={workspaceSyntaxTheme} code={safeCode} language={normalizedLanguage}>
      {({ tokens, getTokenProps }) => (
        <pre className="m-0 min-w-full bg-[var(--color-code-bg)] px-4 py-3 font-[var(--font-mono)] text-[12px] leading-6 text-[var(--color-code-fg)]">
          {tokens.map((line, index) => (
            <div key={index} className="grid grid-cols-[42px_minmax(0,1fr)] gap-3">
              <span className="select-none text-right text-[var(--color-text-tertiary)]">{index + 1}</span>
              <code className="min-w-0 whitespace-pre-wrap break-words">
                {line.length > 0
                  ? line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))
                  : ' '}
              </code>
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  )
}

function DiffCodePreview({ code }: { code: string }) {
  const lines = code.split('\n')
  return (
    <pre className="m-0 min-w-full py-3 font-[var(--font-mono)] text-[12px] leading-5 text-[var(--color-text-primary)]">
      {lines.map((line, index) => {
        const type = getDiffLineType(line)
        return (
          <div
            key={index}
            className={`grid grid-cols-[38px_22px_minmax(0,1fr)] gap-2 px-3 ${
              type === 'add'
                ? 'bg-[var(--color-diff-added-bg)]'
                : type === 'remove'
                  ? 'bg-[var(--color-diff-removed-bg)]'
                  : ''
            }`}
          >
            <span className="select-none text-right text-[var(--color-text-tertiary)]">{index + 1}</span>
            <span className={`select-none ${
              type === 'add'
                ? 'text-[var(--color-diff-added-text)]'
                : type === 'remove'
                  ? 'text-[var(--color-diff-removed-text)]'
                  : 'text-[var(--color-text-tertiary)]'
            }`}>
              {line.startsWith('+') || line.startsWith('-') ? line[0] : ' '}
            </span>
            <code className="min-w-0 whitespace-pre-wrap break-words">{line || ' '}</code>
          </div>
        )
      })}
    </pre>
  )
}

function PanelHint({ text }: { text: string }) {
  return (
    <div className="px-5 py-6 text-sm text-[var(--color-text-tertiary)]">
      {text}
    </div>
  )
}

function ChangeBadge({ status }: { status: WorkspaceChangeStatus }) {
  const label = statusLabel(status)
  return (
    <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-text-tertiary)]">
      {label}
    </span>
  )
}

function statusLabel(status: WorkspaceChangeStatus): string {
  switch (status) {
    case 'added':
      return '新增'
    case 'deleted':
      return '删除'
    case 'renamed':
      return '重命名'
    case 'copied':
      return '复制'
    case 'untracked':
      return '未跟踪'
    case 'modified':
      return '修改'
    default:
      return '变更'
  }
}

function formatStats(file: WorkspaceChangeFile): string {
  const additions = file.additions > 0 ? `+${file.additions}` : ''
  const deletions = file.deletions > 0 ? `-${file.deletions}` : ''
  return [additions, deletions].filter(Boolean).join(' ')
}

function getDiffLineType(line: string): 'add' | 'remove' | 'meta' | 'normal' {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'remove'
  return 'normal'
}

function inferLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const languages: Record<string, string> = {
    bat: 'batch',
    c: 'c',
    cmd: 'batch',
    cpp: 'cpp',
    cs: 'csharp',
    css: 'css',
    go: 'go',
    h: 'c',
    html: 'html',
    htm: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'jsx',
    md: 'markdown',
    mjs: 'javascript',
    ps1: 'powershell',
    py: 'python',
    rs: 'rust',
    scss: 'scss',
    sh: 'bash',
    sql: 'sql',
    svg: 'svg',
    toml: 'toml',
    ts: 'typescript',
    tsx: 'tsx',
    vue: 'vue',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  }
  return languages[ext] ?? 'text'
}

function normalizeHighlightLanguage(language: string): string {
  const normalized = language.toLowerCase()
  if (normalized === 'html' || normalized === 'htm' || normalized === 'xml' || normalized === 'svg') {
    return 'markup'
  }
  if (normalized === 'shell') return 'bash'
  if (normalized === 'text' || normalized === 'plaintext') return 'text'
  return normalized
}

function useWorkspaceChanges(sessionId: string, refreshKey: string): WorkspaceChangeState {
  const [changes, setChanges] = useState<WorkspaceChangesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const refresh = useCallback(() => setRefreshCount((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    workspaceApi.changes(sessionId)
      .then((result) => {
        if (cancelled) return
        setChanges(result)
        setError(result.error ?? null)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setChanges(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [refreshCount, refreshKey, sessionId])

  return { changes, loading, error, refresh }
}

function mergeChangedFiles(
  gitFiles: WorkspaceChangeFile[],
  conversationChanges: ConversationChange[],
): DisplayChangeFile[] {
  const files = new Map<string, DisplayChangeFile>()
  for (const file of gitFiles) {
    files.set(file.path, { ...file, source: 'git' })
  }
  for (const change of conversationChanges) {
    const existing = files.get(change.path)
    if (existing) {
      existing.source = 'mixed'
      existing.additions = existing.additions || change.additions || 0
      existing.deletions = existing.deletions || change.deletions || 0
      continue
    }
    files.set(change.path, {
      path: change.path,
      status: 'changed',
      indexStatus: ' ',
      worktreeStatus: 'M',
      staged: false,
      unstaged: true,
      additions: change.additions ?? 0,
      deletions: change.deletions ?? 0,
      source: 'conversation',
    })
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path)).slice(0, 200)
}

function extractConversationChanges(messages: UIMessage[]): ConversationChange[] {
  const changes = new Map<string, ConversationChange>()
  const toolNames = new Map<string, string>()

  for (const message of messages) {
    if (message.type === 'tool_use') {
      toolNames.set(message.toolUseId, message.toolName)
      collectToolUseChange(message.toolName, message.input, changes)
    }
  }

  for (const message of messages) {
    if (message.type !== 'tool_result') continue
    const toolName = toolNames.get(message.toolUseId)
    if (!toolName || !isWriteTool(toolName)) continue
    collectMetadataChange(message.metadata, changes)
  }

  return [...changes.values()].slice(-50)
}

function collectToolUseChange(
  toolName: string,
  input: unknown,
  changes: Map<string, ConversationChange>,
) {
  if (!isWriteTool(toolName)) return
  const obj = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const patch = typeof obj.patch === 'string' ? obj.patch : undefined

  if (patch) {
    for (const filePath of pathsFromPatch(patch)) addConversationChange(changes, filePath, { patch })
  }

  const directPath = typeof obj.file_path === 'string'
    ? obj.file_path
    : typeof obj.path === 'string'
      ? obj.path
      : ''
  if (!directPath) return

  if ((toolName === 'Write' || toolName === 'write_file') && typeof obj.content === 'string') {
    addConversationChange(changes, directPath, {
      patch: buildNewFilePatch(directPath, obj.content),
      additions: obj.content.split(/\r?\n/).length,
    })
    return
  }

  addConversationChange(changes, directPath, {})
}

function collectMetadataChange(
  metadata: ToolResultMetadata | undefined,
  changes: Map<string, ConversationChange>,
) {
  if (!metadata) return
  if (metadata.patch) {
    for (const file of metadata.patch.files) {
      addConversationChange(changes, file.path, {
        patch: metadata.patch.forwardPatch,
        additions: file.additions,
        deletions: file.deletions,
      })
    }
    return
  }
  if (metadata.filePath) {
    addConversationChange(changes, metadata.filePath, {
      additions: metadata.additions,
      deletions: metadata.deletions,
    })
  }
  for (const filePath of metadata.files ?? []) {
    addConversationChange(changes, filePath, {
      additions: metadata.additions,
      deletions: metadata.deletions,
    })
  }
}

function addConversationChange(
  changes: Map<string, ConversationChange>,
  filePath: string,
  next: Omit<ConversationChange, 'path'>,
) {
  const normalized = normalizeWorkspacePath(filePath)
  if (!normalized) return
  const existing = changes.get(normalized)
  changes.set(normalized, {
    path: normalized,
    patch: next.patch ?? existing?.patch,
    additions: next.additions ?? existing?.additions,
    deletions: next.deletions ?? existing?.deletions,
  })
}

function isWriteTool(toolName: string): boolean {
  return [
    'Edit',
    'MultiEdit',
    'Write',
    'NotebookEdit',
    'edit_file',
    'write_file',
    'apply_patch',
  ].includes(toolName)
}

function pathsFromPatch(patch: string): string[] {
  const files = new Set<string>()
  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith('+++ ') && !line.startsWith('--- ')) continue
    if (line.includes('/dev/null')) continue
    const filePath = line
      .replace(/^(?:\+\+\+|---)\s+/, '')
      .replace(/^[ab]\//, '')
      .trim()
    if (filePath) files.add(filePath)
  }
  return [...files]
}

function buildNewFilePatch(filePath: string, content: string): string {
  const normalized = normalizeWorkspacePath(filePath)
  const lines = content.split(/\r?\n/)
  return [
    '--- /dev/null',
    `+++ b/${normalized}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join('\n')
}

function normalizeWorkspacePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim()
}
