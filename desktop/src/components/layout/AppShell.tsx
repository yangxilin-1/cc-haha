import { useEffect, useState, type ReactNode } from 'react'
import {
  Folder as FolderIcon,
  PanelRight,
  SquareTerminal,
} from 'lucide-react'
import { Sidebar } from './Sidebar'
import { ContentRouter } from './ContentRouter'
import { ToastContainer } from '../shared/Toast'
import { UpdateChecker } from '../shared/UpdateChecker'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { initializeDesktopServerUrl } from '../../lib/desktopRuntime'
import { ModeSelector } from '../../modes/ModeSelector'
import { useModeStore } from '../../stores/modeStore'
import { useTabStore, SETTINGS_TAB_ID } from '../../stores/tabStore'
import { useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTranslation } from '../../i18n'
import { workspaceApi } from '../../api/workspace'

const isTauri = typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)

export function AppShell() {
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const activeWorkspacePanels = useUIStore((s) => s.activeWorkspacePanels)
  const terminalOpen = useUIStore((s) => s.terminalOpen)
  const toggleWorkspacePanel = useUIStore((s) => s.toggleWorkspacePanel)
  const toggleTerminal = useUIStore((s) => s.toggleTerminal)
  const addToast = useUIStore((s) => s.addToast)
  const tabs = useTabStore((s) => s.tabs)
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessions = useSessionStore((s) => s.sessions)
  const currentMode = useModeStore((s) => s.currentMode)
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string | null>(null)
  const t = useTranslation()
  const activeTab = tabs.find((tab) => tab.sessionId === activeTabId)
  const activeSession = sessions.find((session) => session.id === activeTabId)
  const isSessionSurface = !activeTab || activeTab.type === 'session'
  const surfaceMode = activeSession?.mode ?? currentMode
  const isCodeSurface = isSessionSurface && surfaceMode === 'code'
  const isChatSurface = isSessionSurface && surfaceMode === 'chat'
  const topToolCount = isCodeSurface ? 3 : isChatSurface ? 2 : 0

  const handleNewSession = () => {
    // 新建会话不预创建 session，仅切回空状态页；用户发送文本后才创建会话并出现在历史
    useSessionStore.setState({ activeSessionId: null, currentView: 'empty' })
    useTabStore.setState({ activeTabId: null })
  }

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        await initializeDesktopServerUrl()
        await fetchSettings()
        useModeStore.getState().restoreModes()

        // Restore tabs from localStorage
        await useTabStore.getState().restoreTabs()
        const activeId = useTabStore.getState().activeTabId
        if (activeId) {
          useChatStore.getState().connectToSession(activeId)
        }
        if (!cancelled) {
          setReady(true)
        }
      } catch (error) {
        if (!cancelled) {
          setStartupError(error instanceof Error ? error.message : String(error))
          setReady(false)
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [fetchSettings])

  // Listen for native menu navigation events.
  useEffect(() => {
    let unlisten: (() => void) | undefined
    import(/* @vite-ignore */ '@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<string>('native-menu-navigate', () => {
          useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
        }),
      )
      .then((fn) => { unlisten = fn })
      .catch(() => {})
    return () => { unlisten?.() }
  }, [])

  useKeyboardShortcuts()

  if (startupError) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-surface)] px-6">
        <div className="max-w-xl rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-container-low)] p-6">
          <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t('app.serverFailed')}
          </h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            {startupError}
          </p>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="h-screen flex items-center justify-center bg-[var(--color-surface)] text-[var(--color-text-secondary)]">
        {t('app.launching')}
      </div>
    )
  }

  return (
    <div className="relative h-screen overflow-hidden bg-[var(--color-surface)]">
      <div
        data-testid="sidebar-shell"
        data-state={sidebarOpen ? 'open' : 'closed'}
        className="sidebar-shell absolute inset-y-0 left-0 z-10"
        aria-hidden={!sidebarOpen}
      >
        <Sidebar />
      </div>
      <main
        id="content-area"
        data-sidebar-state={sidebarOpen ? 'open' : 'closed'}
        className="absolute inset-y-0 right-0 z-20 flex flex-col overflow-hidden bg-[var(--color-surface)] transition-[left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ left: sidebarOpen ? 'var(--sidebar-width)' : '0px' }}
      >
        <div
          data-tauri-drag-region
          className="relative h-[34px] flex-shrink-0 bg-[var(--color-surface)] select-none"
        >
          <div className="absolute inset-0 flex items-center justify-center" data-tauri-drag-region>
            <ModeSelector />
          </div>
          {isTauri && !isMac && <WindowControls />}
        </div>
        <div
          data-tauri-drag-region
          className="relative h-[40px] flex items-center justify-center flex-shrink-0 border-t border-[var(--color-border)]/20 bg-[var(--color-surface)]/70 backdrop-blur-sm select-none"
        >
          {!sidebarOpen && (
            <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label={t('sidebar.expand')}
                title={t('sidebar.expand')}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <line x1="9" y1="4" x2="9" y2="20" />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleNewSession}
                aria-label={t('sidebar.newSession')}
                title={t('sidebar.newSession')}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            </div>
          )}
          <div
            data-tauri-drag-region
            className="absolute top-0 flex h-full min-w-0 items-center"
            style={{
              left: sidebarOpen ? 18 : 74,
              right: topToolCount > 0 ? 18 + topToolCount * 36 : 16,
            }}
          >
            <SessionHeaderTitle
              title={activeSession?.title || activeTab?.title || ''}
              workDir={isCodeSurface ? activeSession?.workDir : null}
              onOpenFolder={() => {
                if (!activeSession?.id || !activeSession.workDir) return
                void revealProjectFolder(activeSession.id, activeSession.workDir, (message) => {
                  addToast({ type: 'error', message })
                })
              }}
            />
          </div>
          {topToolCount > 0 && (
            <div className="absolute right-4 top-0 flex h-full items-center gap-3">
              <HeaderIconButton
                icon={<SquareTerminal size={16} strokeWidth={2} />}
                active={terminalOpen}
                label="终端"
                onClick={toggleTerminal}
              />
              {isCodeSurface && (
                <HeaderIconButton
                  icon={<FolderIcon size={16} strokeWidth={2} />}
                  active={activeWorkspacePanels.includes('files')}
                  label="文件"
                  onClick={() => toggleWorkspacePanel('files')}
                />
              )}
              <HeaderIconButton
                icon={<PanelRight size={16} strokeWidth={2} />}
                active={activeWorkspacePanels.includes('preview')}
                label="预览"
                onClick={() => toggleWorkspacePanel('preview')}
              />
            </div>
          )}
        </div>
        <ContentRouter />
      </main>
      <ToastContainer />
      <UpdateChecker />
    </div>
  )
}

function SessionHeaderTitle({
  title,
  workDir,
  onOpenFolder,
}: {
  title: string
  workDir?: string | null
  onOpenFolder: () => void
}) {
  if (!title && !workDir) return null

  return (
    <div className="flex min-w-0 items-center gap-2" data-tauri-drag-region>
      {title && (
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {title}
        </span>
      )}
      {workDir && (
        <button
          type="button"
          onClick={onOpenFolder}
          className="inline-flex min-w-0 max-w-[190px] items-center gap-1 truncate rounded px-1 py-0.5 text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
          title={`打开所在文件夹：${workDir}`}
        >
          <span className="truncate">{folderName(workDir)}</span>
        </button>
      )}
    </div>
  )
}

function HeaderIconButton({
  icon,
  active,
  label,
  onClick,
}: {
  icon: ReactNode
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-[var(--color-surface-selected)] text-[var(--color-text-primary)] shadow-sm'
          : 'text-[#554741] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]'
      }`}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  )
}

function folderName(workDir: string): string {
  const normalized = workDir.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || workDir
}

async function revealProjectFolder(
  sessionId: string,
  workDir: string,
  fallback: (message: string) => void,
) {
  try {
    const result = await workspaceApi.reveal(sessionId)
    if (!result.ok) throw new Error(result.error || '无法打开文件夹')
  } catch (error) {
    try {
      const { open } = await import(/* @vite-ignore */ '@tauri-apps/plugin-shell')
      await open(workDir)
      return
    } catch { /* fallback below */ }
    fallback(error instanceof Error ? error.message : `无法打开文件夹：${workDir}`)
  }
}

function WindowControls() {
  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import(/* @vite-ignore */ '@tauri-apps/api/window')
      await getCurrentWindow().minimize()
    } catch { /* noop */ }
  }
  const handleToggleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import(/* @vite-ignore */ '@tauri-apps/api/window')
      await getCurrentWindow().toggleMaximize()
    } catch { /* noop */ }
  }
  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import(/* @vite-ignore */ '@tauri-apps/api/window')
      await getCurrentWindow().close()
    } catch { /* noop */ }
  }
  return (
    <div className="absolute right-0 top-0 h-full flex items-stretch">
      <button
        type="button"
        onClick={handleMinimize}
        aria-label="Minimize"
        title="Minimize"
        className="flex h-full w-11 items-center justify-center text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <line x1="2" y1="6" x2="10" y2="6" />
        </svg>
      </button>
      <button
        type="button"
        onClick={handleToggleMaximize}
        aria-label="Maximize"
        title="Maximize"
        className="flex h-full w-11 items-center justify-center text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="2.5" y="2.5" width="7" height="7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={handleClose}
        aria-label="Close"
        title="Close"
        className="flex h-full w-11 items-center justify-center text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-error)] hover:text-white"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
          <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
        </svg>
      </button>
    </div>
  )
}
