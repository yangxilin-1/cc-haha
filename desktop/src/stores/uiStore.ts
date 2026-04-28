import { create } from 'zustand'
import type { ThemeMode } from '../types/settings'

const THEME_STORAGE_KEY = 'ycode-theme'

function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* localStorage unavailable */ }
  return 'light'
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

export function initializeTheme() {
  applyTheme(getStoredTheme())
}

export type Toast = {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

export type SettingsTab = 'providers' | 'permissions' | 'general' | 'adapters' | 'agents' | 'skills' | 'computerUse'

type ActiveView = 'code' | 'scheduled' | 'terminal' | 'history' | 'settings'
export type WorkspacePanel = 'files' | 'preview'

type UIStore = {
  theme: ThemeMode
  sidebarOpen: boolean
  activeView: ActiveView
  activeWorkspacePanel: WorkspacePanel | null
  activeWorkspacePanels: WorkspacePanel[]
  terminalOpen: boolean
  pendingSettingsTab: SettingsTab | null
  activeModal: string | null
  toasts: Toast[]

  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setActiveView: (view: ActiveView) => void
  toggleWorkspacePanel: (panel: WorkspacePanel) => void
  openWorkspacePanel: (panel: WorkspacePanel) => void
  closeWorkspacePanel: (panel: WorkspacePanel) => void
  setWorkspacePanel: (panel: WorkspacePanel | null) => void
  toggleTerminal: () => void
  setTerminalOpen: (open: boolean) => void
  setPendingSettingsTab: (tab: SettingsTab | null) => void
  openModal: (id: string) => void
  closeModal: () => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

let toastCounter = 0

export const useUIStore = create<UIStore>((set) => ({
  theme: getStoredTheme(),
  sidebarOpen: true,
  activeView: 'code',
  activeWorkspacePanel: null,
  activeWorkspacePanels: [],
  terminalOpen: false,
  pendingSettingsTab: null,
  activeModal: null,
  toasts: [],

  setTheme: (theme) => {
    applyTheme(theme)
    try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* noop */ }
    set({ theme })
  },

  toggleTheme: () => {
    set((state) => {
      const next = state.theme === 'light' ? 'dark' : 'light'
      applyTheme(next)
      try { localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* noop */ }
      return { theme: next }
    })
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setActiveView: (view) => set({ activeView: view }),
  toggleWorkspacePanel: (panel) => set((s) => {
    const nextPanels = s.activeWorkspacePanels.includes(panel)
      ? s.activeWorkspacePanels.filter((item) => item !== panel)
      : [...s.activeWorkspacePanels, panel]
    return {
      activeWorkspacePanels: nextPanels,
      activeWorkspacePanel: resolveActivePanel(s.activeWorkspacePanel, panel, nextPanels),
    }
  }),
  openWorkspacePanel: (panel) => set((s) => ({
    activeWorkspacePanels: s.activeWorkspacePanels.includes(panel)
      ? s.activeWorkspacePanels
      : [...s.activeWorkspacePanels, panel],
    activeWorkspacePanel: panel,
  })),
  closeWorkspacePanel: (panel) => set((s) => {
    const nextPanels = s.activeWorkspacePanels.filter((item) => item !== panel)
    return {
      activeWorkspacePanels: nextPanels,
      activeWorkspacePanel: s.activeWorkspacePanel === panel
        ? nextPanels[nextPanels.length - 1] ?? null
        : s.activeWorkspacePanel,
    }
  }),
  setWorkspacePanel: (panel) => set((s) => {
    if (!panel) return { activeWorkspacePanel: null, activeWorkspacePanels: [] }
    return {
      activeWorkspacePanels: s.activeWorkspacePanels.includes(panel)
        ? s.activeWorkspacePanels
        : [...s.activeWorkspacePanels, panel],
      activeWorkspacePanel: panel,
    }
  }),
  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),
  setTerminalOpen: (open) => set({ terminalOpen: open }),
  setPendingSettingsTab: (tab) => set({ pendingSettingsTab: tab }),
  openModal: (id) => set({ activeModal: id }),
  closeModal: () => set({ activeModal: null }),

  addToast: (toast) => {
    const id = `toast-${++toastCounter}`
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    // Auto-remove after duration
    const duration = toast.duration ?? 4000
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, duration)
    }
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

function resolveActivePanel(
  current: WorkspacePanel | null,
  toggled: WorkspacePanel,
  nextPanels: WorkspacePanel[],
): WorkspacePanel | null {
  if (nextPanels.includes(toggled)) return toggled
  if (current === toggled) return nextPanels[nextPanels.length - 1] ?? null
  return current && nextPanels.includes(current) ? current : nextPanels[nextPanels.length - 1] ?? null
}
