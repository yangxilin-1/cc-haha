import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Folder as FolderIcon } from 'lucide-react'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useModeStore } from '../../stores/modeStore'
import { useTranslation } from '../../i18n'
import type { SessionListItem } from '../../types/session'
import { useTabStore, SETTINGS_TAB_ID, SCHEDULED_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useProjectStore, basenameOf } from '../../stores/projectStore'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

type TimeGroup = 'today' | 'yesterday' | 'last7days' | 'last30days' | 'older'

const TIME_GROUP_ORDER: TimeGroup[] = ['today', 'yesterday', 'last7days', 'last30days', 'older']

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const selectedProjects = useSessionStore((s) => s.selectedProjects)
  const error = useSessionStore((s) => s.error)
  const fetchSessions = useSessionStore((s) => s.fetchSessions)
  const deleteSession = useSessionStore((s) => s.deleteSession)
  const renameSession = useSessionStore((s) => s.renameSession)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const closeTab = useTabStore((s) => s.closeTab)
  const disconnectSession = useChatStore((s) => s.disconnectSession)
  const currentMode = useModeStore((s) => s.currentMode)
  const aliases = useProjectStore((s) => s.aliases)
  const hidden = useProjectStore((s) => s.hidden)
  const expanded = useProjectStore((s) => s.expanded)
  const setAlias = useProjectStore((s) => s.setAlias)
  const hideProject = useProjectStore((s) => s.hideProject)
  const toggleExpanded = useProjectStore((s) => s.toggleExpanded)
  const setExpanded = useProjectStore((s) => s.setExpanded)
  const setSelectedWorkDir = useProjectStore((s) => s.setSelectedWorkDir)
  const [searchQuery, setSearchQuery] = useState('')
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [projectMenu, setProjectMenu] = useState<{ workDir: string; x: number; y: number } | null>(null)
  const [renamingWorkDir, setRenamingWorkDir] = useState<string | null>(null)
  const [projectRenameValue, setProjectRenameValue] = useState('')

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  useEffect(() => {
    if (!contextMenu || sidebarOpen) return
    setContextMenu(null)
  }, [contextMenu, sidebarOpen])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [contextMenu])

  useEffect(() => {
    if (!projectMenu) return
    const close = () => setProjectMenu(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [projectMenu])

  const filteredSessions = useMemo(() => {
    let result = sessions
    // 按当前全局模式过滤（旧会话无 mode 字段时默认视为 code）
    result = result.filter((s) => (s.mode ?? 'code') === currentMode)
    if (selectedProjects.length > 0) {
      result = result.filter((s) => selectedProjects.includes(s.projectPath))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((s) => s.title.toLowerCase().includes(q))
    }
    return result
  }, [sessions, selectedProjects, searchQuery, currentMode])

  const timeGroups = useMemo(() => groupByTime(filteredSessions), [filteredSessions])

  // Code 模式按 workDir 分组
  const projectGroups = useMemo(() => {
    if (currentMode !== 'code') return [] as { workDir: string; items: SessionListItem[]; latest: number }[]
    const map = new Map<string, SessionListItem[]>()
    for (const s of filteredSessions) {
      const key = s.workDir ?? ''
      if (hidden.includes(key)) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return [...map.entries()]
      .map(([workDir, items]) => {
        const sorted = [...items].sort(
          (a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime(),
        )
        const latest = Math.max(...items.map((i) => new Date(i.modifiedAt).getTime()))
        return { workDir, items: sorted, latest }
      })
      .sort((a, b) => b.latest - a.latest)
  }, [filteredSessions, currentMode, hidden])

  // 当前活动会话所在项目自动展开
  useEffect(() => {
    if (currentMode !== 'code' || !activeTabId) return
    const s = sessions.find((x) => x.id === activeTabId)
    if (s && s.workDir) setExpanded(s.workDir, true)
  }, [currentMode, activeTabId, sessions, setExpanded])

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    setContextMenu(null)
    await deleteSession(id)
    disconnectSession(id)
    closeTab(id)
  }, [closeTab, deleteSession, disconnectSession])

  const handleStartRename = useCallback((id: string, currentTitle: string) => {
    setContextMenu(null)
    setRenamingId(id)
    setRenameValue(currentTitle)
  }, [])

  const handleFinishRename = useCallback(async () => {
    if (renamingId && renameValue.trim()) {
      await renameSession(renamingId, renameValue.trim())
    }
    setRenamingId(null)
    setRenameValue('')
  }, [renamingId, renameValue, renameSession])

  const startDraggingRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (!isTauri) return
    import(/* @vite-ignore */ '@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        startDraggingRef.current = () => win.startDragging()
      })
      .catch(() => {})
  }, [])

  const t = useTranslation()

  const handleOpenSession = useCallback((session: SessionListItem) => {
    useTabStore.getState().openTab(session.id, session.title)
    useSessionStore.getState().setActiveSession(session.id)
    useSessionStore.getState().setCurrentView('session')
    useChatStore.getState().connectToSession(session.id)
  }, [])

  const renderSessionRow = useCallback((session: SessionListItem) => (
    <div key={session.id} className="relative">
      {renamingId === session.id ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={handleFinishRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFinishRename()
            if (e.key === 'Escape') {
              setRenamingId(null)
              setRenameValue('')
            }
          }}
          className="ml-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border-focus)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none"
        />
      ) : (
        <button
          onClick={() => handleOpenSession(session)}
          onContextMenu={(e) => handleContextMenu(e, session.id)}
          className={`
            group relative w-full rounded-[var(--radius-md)] py-1.5 pl-4 pr-3 text-left text-sm transition-all duration-150 ease-out
            ${session.id === activeTabId
              ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:translate-x-[1px]'
            }
          `}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[2px] rounded-full bg-[var(--color-brand)] transition-opacity duration-150 ${session.id === activeTabId ? 'opacity-100' : 'opacity-0'}`}
          />
          <span className="flex items-center gap-2">
            <span
              className="h-1 w-1 flex-shrink-0 rounded-full transition-colors duration-150"
              style={{
                backgroundColor: session.id === activeTabId ? 'var(--color-brand)' : 'var(--color-text-tertiary)',
                opacity: session.id === activeTabId ? 1 : 0.5,
              }}
            />
            <span className="flex-1 truncate">{session.title || 'Untitled'}</span>
            {session.mode !== 'chat' && !session.workDirExists && (
              <span
                className="flex-shrink-0 text-[10px] text-[var(--color-warning)]"
                title={session.workDir ?? ''}
              >
                {t('sidebar.missingDir')}
              </span>
            )}
            <span className="flex-shrink-0 text-[10px] text-[var(--color-text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100">
              {formatRelativeTime(session.modifiedAt)}
            </span>
          </span>
        </button>
      )}
    </div>
  ), [activeTabId, handleContextMenu, handleFinishRename, handleOpenSession, renameValue, renamingId, t])

  const handleSidebarDrag = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, textarea, select, a, [role="button"]')) return
    startDraggingRef.current?.()
  }, [])

  const timeGroupLabels: Record<TimeGroup, string> = {
    today: t('sidebar.timeGroup.today'),
    yesterday: t('sidebar.timeGroup.yesterday'),
    last7days: t('sidebar.timeGroup.last7days'),
    last30days: t('sidebar.timeGroup.last30days'),
    older: t('sidebar.timeGroup.older'),
  }

  return (
    <aside
      onMouseDown={handleSidebarDrag}
      className="sidebar-panel relative h-full flex flex-col bg-[var(--color-surface-sidebar)] border-r border-[var(--color-border)] select-none"
      data-state={sidebarOpen ? 'open' : 'closed'}
      aria-label="Sidebar"
    >
      <div className={`px-3 pb-2 ${isTauri && !isWindows ? 'pt-[44px]' : 'pt-3'}`}>
        <div className="flex items-center justify-start">
          <button
            type="button"
            onClick={toggleSidebar}
            data-testid={sidebarOpen ? 'sidebar-collapse-button' : 'sidebar-expand-button'}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            aria-label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
            title={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
          >
            <SidebarPanelIcon />
          </button>
        </div>
      </div>

      <div className={`px-3 pb-3 flex flex-col ${sidebarOpen ? 'gap-0.5' : 'items-center gap-2'}`}>
        <NavItem
          active={false}
          collapsed={!sidebarOpen}
          label={t('sidebar.newSession')}
          onClick={() => {
            // 不预创建 session，仅切回空状态页
            useSessionStore.getState().setActiveSession(null)
            useSessionStore.getState().setCurrentView('empty')
            useTabStore.setState({ activeTabId: null })
            // Chat 模式不带 workDir；Code 模式清空选中的项目让用户自由选择
            if (currentMode === 'chat') {
              setSelectedWorkDir(null)
            }
          }}
          icon={<PlusIcon />}
        >
          {t('sidebar.newSession')}
        </NavItem>
        <NavItem
          active={activeTabId === SCHEDULED_TAB_ID}
          collapsed={!sidebarOpen}
          label={t('sidebar.scheduled')}
          onClick={() => {
            useTabStore.getState().openTab(SCHEDULED_TAB_ID, t('sidebar.scheduled'), 'scheduled')
            useSessionStore.getState().setCurrentView('scheduled')
          }}
          icon={<ClockIcon />}
        >
          {t('sidebar.scheduled')}
        </NavItem>
      </div>

      {sidebarOpen ? (
        <>
          <div className="sidebar-section sidebar-section--visible flex-none px-3 pb-2 pt-1">
            <input
              id="sidebar-search"
              type="text"
              placeholder={t('sidebar.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-8 px-2.5 text-xs rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] outline-none transition-colors focus:border-[var(--color-border-focus)]"
            />
          </div>

          <div
            data-testid="sidebar-session-list-section"
            className="sidebar-section sidebar-section--visible flex flex-1 min-h-0 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-3">
              {error && (
                <div className="mx-1 mt-2 rounded-[var(--radius-md)] border border-[var(--color-error)]/20 bg-[var(--color-error)]/5 px-3 py-2">
                  <div className="text-xs font-medium text-[var(--color-error)]">{t('sidebar.sessionListFailed')}</div>
                  <div className="mt-1 text-[11px] text-[var(--color-text-secondary)] break-words">{error}</div>
                  <button
                    onClick={() => fetchSessions()}
                    className="mt-2 text-[11px] font-medium text-[var(--color-brand)] hover:underline"
                  >
                    {t('common.retry')}
                  </button>
                </div>
              )}
              {filteredSessions.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
                  {searchQuery ? t('sidebar.noMatching') : t('sidebar.noSessions')}
                </div>
              )}
              {currentMode === 'code' ? (
                <>
                  {projectGroups.length === 0 && filteredSessions.length > 0 && (
                    <div className="px-3 py-4 text-center text-xs text-[var(--color-text-tertiary)]">
                      {t('sidebar.noMatching')}
                    </div>
                  )}
                  {projectGroups.map(({ workDir, items }) => {
                    const isOpen = expanded[workDir] ?? false
                    const display = aliases[workDir] || basenameOf(workDir)
                    const isRenaming = renamingWorkDir === workDir
                    return (
                      <div key={workDir || '__none__'} className="mb-2 mt-3">
                        <div className="group flex items-center gap-1.5 rounded-[var(--radius-md)] px-1.5 py-1 hover:bg-[var(--color-surface-hover)]">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(workDir)}
                            className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-[#554741] hover:text-[var(--color-text-primary)]"
                            aria-label={isOpen ? 'Collapse' : 'Expand'}
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                              <path d="M4 2.5 6.5 5 4 7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-[#554741]">
                            <FolderIcon size={14} strokeWidth={2} />
                          </span>
                          {isRenaming ? (
                            <input
                              autoFocus
                              value={projectRenameValue}
                              onChange={(e) => setProjectRenameValue(e.target.value)}
                              onBlur={() => {
                                const v = projectRenameValue.trim()
                                if (v) setAlias(workDir, v)
                                setRenamingWorkDir(null)
                                setProjectRenameValue('')
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                                if (e.key === 'Escape') {
                                  setRenamingWorkDir(null)
                                  setProjectRenameValue('')
                                }
                              }}
                              className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border-focus)] bg-[var(--color-surface)] px-2 py-0.5 text-[12px] text-[var(--color-text-primary)] outline-none"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedWorkDir(workDir || null)
                                useSessionStore.getState().setActiveSession(null)
                                useSessionStore.getState().setCurrentView('empty')
                              }}
                              title={workDir || 'Unknown'}
                              className="flex-1 truncate text-left text-[13px] text-[var(--color-text-primary)]"
                            >
                              {display || 'Unknown'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setProjectMenu({ workDir, x: e.clientX, y: e.clientY })
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] opacity-0 transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
                            aria-label="More"
                            title="More"
                          >
                            <MoreDotsIcon />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              // 不预创建 session，仅记录 workDir 选中 + 切回空状态页
                              setSelectedWorkDir(workDir || null)
                              useSessionStore.getState().setActiveSession(null)
                              useSessionStore.getState().setCurrentView('empty')
                              useTabStore.setState({ activeTabId: null })
                            }}
                            className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] opacity-0 transition hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)] group-hover:opacity-100"
                            aria-label={t('sidebar.newSession')}
                            title={t('sidebar.newSession')}
                          >
                            <EditIcon />
                          </button>
                        </div>
                        <div className="mt-0.5">
                          {isOpen && items.map((session) => renderSessionRow(session))}
                        </div>
                      </div>
                    )
                  })}
                </>
              ) : (
                TIME_GROUP_ORDER.map((group) => {
                  const items = timeGroups.get(group)
                  if (!items || items.length === 0) return null
                  return (
                    <div key={group} className="mb-1">
                      <div className="px-2 pb-1 pt-3 text-[11px] font-semibold tracking-wide text-[var(--color-text-tertiary)]">
                        {timeGroupLabels[group]}
                      </div>
                      {items.map((session) => renderSessionRow(session))}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1" aria-hidden="true" />
      )}

      <div className={`border-t border-[var(--color-border)] p-3 ${sidebarOpen ? '' : 'flex justify-center'}`}>
        <NavItem
          active={activeTabId === SETTINGS_TAB_ID}
          collapsed={!sidebarOpen}
          label={t('sidebar.settings')}
          onClick={() => {
            useTabStore.getState().openTab(SETTINGS_TAB_ID, t('sidebar.settings'), 'settings')
            useSessionStore.getState().setCurrentView('settings')
          }}
          icon={<span className="material-symbols-outlined text-[18px]">settings</span>}
        >
          {t('sidebar.settings')}
        </NavItem>
      </div>

      {contextMenu && sidebarOpen && (
        <div
          className="fixed z-50 min-w-[140px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1"
          style={{ left: contextMenu.x, top: contextMenu.y, boxShadow: 'var(--shadow-dropdown)' }}
        >
          <button
            onClick={() => {
              const session = sessions.find((s) => s.id === contextMenu.id)
              handleStartRename(contextMenu.id, session?.title || '')
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            {t('common.rename')}
          </button>
          <button
            onClick={() => handleDelete(contextMenu.id)}
            className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-error)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            {t('common.delete')}
          </button>
        </div>
      )}
      {projectMenu && sidebarOpen && (
        <div
          className="fixed z-50 min-w-[160px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1"
          style={{ left: projectMenu.x, top: projectMenu.y, boxShadow: 'var(--shadow-dropdown)' }}
        >
          <button
            onClick={() => {
              const wd = projectMenu.workDir
              setRenamingWorkDir(wd)
              setProjectRenameValue(aliases[wd] || basenameOf(wd))
              setProjectMenu(null)
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            {t('common.rename')}
          </button>
          <button
            onClick={() => {
              hideProject(projectMenu.workDir)
              setProjectMenu(null)
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-[var(--color-error)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            移除项目
          </button>
        </div>
      )}
    </aside>
  )
}

function groupByTime(sessions: SessionListItem[]): Map<TimeGroup, SessionListItem[]> {
  const groups = new Map<TimeGroup, SessionListItem[]>()
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 86400000
  const sevenDaysAgo = startOfToday - 7 * 86400000
  const thirtyDaysAgo = startOfToday - 30 * 86400000

  for (const session of sessions) {
    const ts = new Date(session.modifiedAt).getTime()
    let group: TimeGroup
    if (ts >= startOfToday) group = 'today'
    else if (ts >= startOfYesterday) group = 'yesterday'
    else if (ts >= sevenDaysAgo) group = 'last7days'
    else if (ts >= thirtyDaysAgo) group = 'last30days'
    else group = 'older'

    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(session)
  }

  return groups
}

function NavItem({
  active,
  collapsed,
  label,
  onClick,
  icon,
  children,
}: {
  active: boolean
  collapsed: boolean
  label: string
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={collapsed ? label : undefined}
      className={`
        flex items-center rounded-[var(--radius-md)] transition-all duration-200
        ${collapsed ? 'h-10 w-10 justify-center px-0 py-0' : 'w-full gap-2.5 px-3 py-2 text-sm'}
        ${active
          ? 'bg-[var(--color-surface-selected)] font-medium text-[var(--color-text-primary)] shadow-[0_8px_24px_rgba(15,23,42,0.08)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
        }
      `}
    >
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className={`sidebar-copy ${collapsed ? 'sidebar-copy--hidden' : 'sidebar-copy--visible'}`}>
        {children}
      </span>
    </button>
  )
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d`
  return `${Math.floor(day / 30)}mo`
}

function SidebarPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  )
}

function MoreDotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="7" r="1.25" />
      <circle cx="7" cy="7" r="1.25" />
      <circle cx="11" cy="7" r="1.25" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
