import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Folder, FolderOpen, PanelLeft, SquareTerminal } from 'lucide-react'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { UpdateChecker } from '../shared/UpdateChecker'
import { ModeSelector } from '../../modes/ModeSelector'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore, type SettingsTab } from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import {
  H5ConnectionRequiredError,
  initializeDesktopServerUrl,
  isH5ConnectionRequiredError,
  isTauriRuntime,
} from '../../lib/desktopRuntime'
import { StartupErrorView } from './StartupErrorView'
import { useTabStore, SETTINGS_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { H5ConnectionView } from './H5ConnectionView'
import { useMobileViewport } from '../../hooks/useMobileViewport'
import type { Tab } from '../../stores/tabStore'
import { WindowControls } from './WindowControls'
import { useWorkspacePanelStore } from '../../stores/workspacePanelStore'
import { useTerminalPanelStore } from '../../stores/terminalPanelStore'

function isChatTab(tab: Tab | undefined) {
  return tab?.type === 'session'
}

export function AppShell() {
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)
  const [h5StartupError, setH5StartupError] = useState<H5ConnectionRequiredError | null>(null)
  const [bootstrapNonce, setBootstrapNonce] = useState(0)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const t = useTranslation()
  const tauriRuntime = isTauriRuntime()
  const isMobileShell = useMobileViewport() && !tauriRuntime
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const setActiveTab = useTabStore((s) => s.setActiveTab)
  const activeSession = useSessionStore((s) =>
    activeTabId ? s.sessions.find((session) => session.id === activeTabId) ?? null : null,
  )
  const wasMobileShellRef = useRef(false)
  const effectiveSidebarOpen = isMobileShell ? mobileSidebarOpen : sidebarOpen
  const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
  const isActiveChatTab = isChatTab(activeTab)
  const activeSessionMode = activeSession?.mode ?? 'code'
  const showCodeSessionTools = !isMobileShell && isActiveChatTab && activeSessionMode === 'code' && !!activeTabId
  const isWorkbenchOpen = useWorkspacePanelStore((state) =>
    showCodeSessionTools && activeTabId ? state.isPanelOpen(activeTabId) : false,
  )
  const workbenchMode = useWorkspacePanelStore((state) =>
    showCodeSessionTools && activeTabId ? state.getMode(activeTabId) : 'workspace',
  )
  const isWorkspacePanelOpen = isWorkbenchOpen && workbenchMode === 'workspace'
  const isTerminalPanelOpen = useTerminalPanelStore((state) =>
    showCodeSessionTools && activeTabId ? state.isPanelOpen(activeTabId) : false,
  )
  const mobileSessionTitle = activeSession?.title || activeTab?.title || t('session.untitled')
  const mobileSessionUpdated = (() => {
    if (!activeSession?.modifiedAt) return ''
    const diff = Date.now() - new Date(activeSession.modifiedAt).getTime()
    if (diff < 60000) return t('session.timeJustNow')
    if (diff < 3600000) return t('session.timeMinutes', { n: Math.floor(diff / 60000) })
    if (diff < 86400000) return t('session.timeHours', { n: Math.floor(diff / 3600000) })
    return t('session.timeDays', { n: Math.floor(diff / 86400000) })
  })()
  const sidebarHiddenProps: HTMLAttributes<HTMLDivElement> & { inert?: '' } =
    isMobileShell && !effectiveSidebarOpen
      ? { 'aria-hidden': true, inert: '' }
      : {}

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      if (!cancelled) {
        setReady(false)
        setStartupError(null)
        setH5StartupError(null)
      }

      try {
        await initializeDesktopServerUrl()
        await fetchSettings()

        if (!cancelled) {
          setReady(true)
        }

        void (async () => {
          await useTabStore.getState().restoreTabs()
          if (cancelled) return
          const { activeTabId: activeId, tabs } = useTabStore.getState()
          const activeTab = tabs.find((tab) => tab.sessionId === activeId)
          if (activeId && activeTab?.type === 'session') {
            useChatStore.getState().connectToSession(activeId)
          }
        })().catch(() => {})
      } catch (error) {
        if (!cancelled) {
          if (!tauriRuntime && isH5ConnectionRequiredError(error)) {
            setH5StartupError(error)
            setStartupError(null)
          } else {
            setStartupError(error instanceof Error ? error.message : String(error))
            setH5StartupError(null)
          }
          setReady(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [bootstrapNonce, fetchSettings, tauriRuntime])

  // Listen for macOS native menu navigation events (About / Settings)
  useEffect(() => {
    if (!tauriRuntime) return
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<string>('native-menu-navigate', (event) => {
          const target = event.payload as SettingsTab | 'settings'
          if (target === 'about') {
            useUIStore.getState().setPendingSettingsTab('about')
          }
          useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
        }),
      )
      .then((fn) => { unlisten = fn })
      .catch(() => {})
    return () => { unlisten?.() }
  }, [])

  useKeyboardShortcuts()

  useEffect(() => {
    if (isMobileShell && !wasMobileShellRef.current) {
      setMobileSidebarOpen(false)
      setSidebarOpen(false)
    }
    if (!isMobileShell && wasMobileShellRef.current) {
      setMobileSidebarOpen(false)
    }
    wasMobileShellRef.current = isMobileShell
  }, [isMobileShell, setSidebarOpen])

  useEffect(() => {
    if (!ready || !isMobileShell) return
    if (isChatTab(activeTab) || (!activeTab && !activeTabId)) return
    const nextChatTab = tabs.find(isChatTab)
    if (nextChatTab) {
      setActiveTab(nextChatTab.sessionId)
      return
    }
    useTabStore.setState({ activeTabId: null })
  }, [activeTab, activeTabId, isMobileShell, ready, setActiveTab, tabs])

  const setEffectiveSidebarOpen = (open: boolean) => {
    if (isMobileShell) {
      setMobileSidebarOpen(open)
      setSidebarOpen(open)
      return
    }
    setSidebarOpen(open)
  }

  const toggleEffectiveSidebar = () => {
    if (isMobileShell) {
      setEffectiveSidebarOpen(!mobileSidebarOpen)
      return
    }
    toggleSidebar()
  }

  if (!tauriRuntime && h5StartupError) {
    return (
      <H5ConnectionView
        initialServerUrl={h5StartupError.serverUrl}
        error={h5StartupError.message}
        onConnected={() => setBootstrapNonce((value) => value + 1)}
      />
    )
  }

  if (startupError) {
    return <StartupErrorView error={startupError} />
  }

  if (!ready) {
    return (
      <div className="app-shell-viewport flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
        {t('app.launching')}
      </div>
    )
  }

  return (
    <div className={`app-shell app-shell-viewport flex overflow-hidden bg-[var(--color-surface-sidebar)]${isMobileShell ? ' app-shell--mobile' : ''}`}>
      {!isMobileShell ? (
        <DesktopTopBar
          sidebarOpen={effectiveSidebarOpen}
          onToggleSidebar={toggleEffectiveSidebar}
          t={t}
        />
      ) : null}
      {isMobileShell && effectiveSidebarOpen ? (
        <button
          type="button"
          data-testid="sidebar-backdrop"
          className="app-shell-backdrop fixed inset-0 z-40 border-0 p-0"
          aria-label={t('sidebar.collapse')}
          onClick={() => setEffectiveSidebarOpen(false)}
        />
      ) : null}
      <div
        id="sidebar-shell"
        data-testid="sidebar-shell"
        data-state={effectiveSidebarOpen ? 'open' : 'closed'}
        data-mobile={isMobileShell ? 'true' : 'false'}
        className={`sidebar-shell${isMobileShell ? ' sidebar-shell--mobile' : ' sidebar-shell--desktop'}`}
        {...sidebarHiddenProps}
      >
        {!isMobileShell || effectiveSidebarOpen ? (
          <Sidebar isMobile={isMobileShell} onRequestClose={() => setEffectiveSidebarOpen(false)} />
        ) : null}
      </div>
      <main
        id="content-area"
        data-sidebar-state={effectiveSidebarOpen ? 'open' : 'closed'}
        className={`min-w-0 flex-1 flex flex-col overflow-hidden${isMobileShell ? ' app-shell-main--mobile' : ' app-shell-main--desktop'}`}
      >
        {isMobileShell ? (
          <div
            data-testid="mobile-session-header"
            className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          >
            <button
              type="button"
              data-testid="mobile-sidebar-toggle"
              aria-controls="sidebar-shell"
              aria-expanded={effectiveSidebarOpen}
              aria-label={effectiveSidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
              onClick={toggleEffectiveSidebar}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
            >
              <span className="material-symbols-outlined text-[20px]">
                {effectiveSidebarOpen ? 'close' : 'menu'}
              </span>
            </button>
            {isActiveChatTab ? (
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[15px] font-bold leading-tight text-[var(--color-text-primary)]">
                  {mobileSessionTitle}
                </h1>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[10px] font-medium text-[var(--color-text-tertiary)]">
                  {activeTab?.status === 'running' ? (
                    <span className="flex shrink-0 items-center gap-1 text-[var(--color-text-secondary)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] animate-pulse-dot" />
                      {t('session.active')}
                    </span>
                  ) : null}
                  {activeSession?.messageCount !== undefined && activeSession.messageCount > 0 ? (
                    <>
                      {activeTab?.status === 'running' ? <span aria-hidden="true">·</span> : null}
                      <span>{t('session.messages', { count: activeSession.messageCount })}</span>
                    </>
                  ) : null}
                  {mobileSessionUpdated ? (
                    <>
                      {(activeTab?.status === 'running') || ((activeSession?.messageCount ?? 0) > 0) ? <span aria-hidden="true">·</span> : null}
                      <span className="truncate">{t('session.lastUpdated', { time: mobileSessionUpdated })}</span>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {!isMobileShell ? (
          <ContentSurfaceHeader
            activeSessionId={showCodeSessionTools ? activeTabId : null}
            isWorkspacePanelOpen={isWorkspacePanelOpen}
            isTerminalPanelOpen={isTerminalPanelOpen}
            t={t}
          />
        ) : null}
        <ContentRouter />
      </main>
      <ToastContainer />
      <UpdateChecker />
    </div>
  )
}

function DesktopTopBar({
  sidebarOpen,
  onToggleSidebar,
  t,
}: {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  t: ReturnType<typeof useTranslation>
}) {
  return (
    <div
      data-tauri-drag-region
      className="desktop-topbar absolute inset-x-0 top-0 z-50 flex h-[var(--app-topbar-height)] items-center justify-center select-none"
    >
      <div className="absolute left-3 top-0 flex h-full items-center gap-2">
        <TopBarIconButton
          label={sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')}
          onClick={onToggleSidebar}
          icon={<PanelLeft size={17} strokeWidth={1.8} />}
        />
        <TopBarIconButton
          label="Back"
          disabled
          onClick={() => undefined}
          icon={<ArrowLeft size={18} strokeWidth={1.75} />}
        />
        <TopBarIconButton
          label="Forward"
          disabled
          onClick={() => undefined}
          icon={<ArrowRight size={18} strokeWidth={1.75} />}
        />
      </div>
      <ModeSelector />
      <div className="desktop-window-controls-host absolute right-0 top-0 flex h-full items-stretch">
        <WindowControls />
      </div>
    </div>
  )
}

function ContentSurfaceHeader({
  activeSessionId,
  isWorkspacePanelOpen,
  isTerminalPanelOpen,
  t,
}: {
  activeSessionId: string | null
  isWorkspacePanelOpen: boolean
  isTerminalPanelOpen: boolean
  t: ReturnType<typeof useTranslation>
}) {
  const toggleWorkspacePanel = () => {
    if (!activeSessionId) return
    const workbench = useWorkspacePanelStore.getState()
    if (workbench.isPanelOpen(activeSessionId) && workbench.getMode(activeSessionId) === 'workspace') {
      workbench.closePanel(activeSessionId)
      return
    }
    workbench.setMode(activeSessionId, 'workspace')
    workbench.openPanel(activeSessionId)
  }

  const toggleTerminalPanel = () => {
    if (!activeSessionId) return
    useTerminalPanelStore.getState().togglePanel(activeSessionId)
  }

  return (
    <div
      data-tauri-drag-region
      className="content-surface-header relative flex h-10 shrink-0 items-center justify-end select-none"
    >
      {activeSessionId ? (
        <div className="absolute right-4 top-0 flex h-full items-center gap-3">
          <HeaderIconButton
            label={t('tabs.openTerminal')}
            onClick={toggleTerminalPanel}
            active={isTerminalPanelOpen}
            icon={<SquareTerminal size={16} strokeWidth={2} />}
          />
          <HeaderIconButton
            label={t(isWorkspacePanelOpen ? 'tabs.hideWorkspace' : 'tabs.showWorkspace')}
            onClick={toggleWorkspacePanel}
            active={isWorkspacePanelOpen}
            icon={isWorkspacePanelOpen
              ? <FolderOpen size={16} strokeWidth={2} />
              : <Folder size={16} strokeWidth={2} />}
          />
        </div>
      ) : null}
    </div>
  )
}

function TopBarIconButton({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        disabled
          ? 'cursor-default text-[var(--color-text-tertiary)]/45'
          : active
            ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] shadow-sm'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {icon}
    </button>
  )
}

function HeaderIconButton({
  icon,
  label,
  onClick,
  active = false,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-active={active ? 'true' : 'false'}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] ${
        active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] shadow-sm'
          : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {icon}
    </button>
  )
}
