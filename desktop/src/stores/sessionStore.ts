import { create } from 'zustand'
import { sessionsApi } from '../api/sessions'
import { useModeStore } from './modeStore'
import type { SessionListItem, SessionMode } from '../types/session'

export type ViewType = 'session' | 'settings' | 'scheduled' | 'empty'

type SessionStore = {
  sessions: SessionListItem[]
  activeSessionId: string | null
  currentView: ViewType
  isLoading: boolean
  error: string | null
  selectedProjects: string[]
  availableProjects: string[]

  fetchSessions: (project?: string) => Promise<void>
  createSession: (workDir?: string, mode?: SessionMode) => Promise<string>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  updateSessionTitle: (id: string, title: string) => void
  setActiveSession: (id: string | null) => void
  setCurrentView: (view: ViewType) => void
  setSelectedProjects: (projects: string[]) => void
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  currentView: 'empty',
  isLoading: false,
  error: null,
  selectedProjects: [],
  availableProjects: [],

  fetchSessions: async (project?: string) => {
    set({ isLoading: true, error: null })
    try {
      const { sessions: raw } = await sessionsApi.list({ project, limit: 100 })
      // Deduplicate by session ID — keep the most recently modified entry
      const byId = new Map<string, SessionListItem>()
      for (const s of raw) {
        const existing = byId.get(s.id)
        if (!existing || new Date(s.modifiedAt) > new Date(existing.modifiedAt)) {
          byId.set(s.id, s)
        }
      }
      const sessions = [...byId.values()]
      const availableProjects = [...new Set(sessions.map((s) => s.projectPath).filter(Boolean))].sort()
      useModeStore.getState().syncSessionModes(sessions)
      set({ sessions, availableProjects, isLoading: false })
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false })
    }
  },

  createSession: async (workDir?: string, mode?: SessionMode) => {
    const { sessionId: id } = await sessionsApi.create(workDir || undefined, mode)
    const now = new Date().toISOString()
    const resolvedMode = mode ?? 'code'
    const optimisticSession: SessionListItem = {
      id,
      title: 'New Session',
      createdAt: now,
      modifiedAt: now,
      messageCount: 0,
      projectPath: '',
      workDir: workDir ?? null,
      workDirExists: true,
      mode: resolvedMode,
    }
    useModeStore.getState().syncSessionModes([optimisticSession])

    set((state) => ({
      sessions: state.sessions.some((session) => session.id === id)
        ? state.sessions
        : [optimisticSession, ...state.sessions],
      activeSessionId: id,
    }))

    void get().fetchSessions()
    return id
  },

  deleteSession: async (id: string) => {
    await sessionsApi.delete(id)
    set((s) => {
      const isActive = s.activeSessionId === id
      return {
        sessions: s.sessions.filter((session) => session.id !== id),
        activeSessionId: isActive ? null : s.activeSessionId,
        currentView: isActive ? 'empty' : s.currentView,
      }
    })
  },

  renameSession: async (id: string, title: string) => {
    await sessionsApi.rename(id, title)
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, title } : session,
      ),
    }))
  },

  updateSessionTitle: (id, title) => {
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id ? { ...session, title } : session,
      ),
    }))
  },

  setActiveSession: (id) => set({ activeSessionId: id }),
  setCurrentView: (view) => set({ currentView: view }),
  setSelectedProjects: (projects) => set({ selectedProjects: projects }),
}))
