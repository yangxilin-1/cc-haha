import { create } from 'zustand'
import { SessionMode, SessionConfig, getDefaultConfig } from '../modes/types'

const MODE_STORAGE_KEY = 'ycode-session-modes'
const CURRENT_MODE_STORAGE_KEY = 'ycode-current-mode'

function loadCurrentMode(): SessionMode {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CURRENT_MODE_STORAGE_KEY) : null
    if (raw === 'chat' || raw === 'code') return raw
  } catch {
    // ignore
  }
  return 'code'
}

interface ModeStore {
  // 每个 session 的模式配置
  sessionModes: Map<string, SessionConfig>

  // 当前全局视图筛选模式（用于 Sidebar 过滤历史会话）
  currentMode: SessionMode

  // 设置当前全局视图筛选模式
  setCurrentMode: (mode: SessionMode) => void

  // 获取 session 模式
  getSessionMode: (sessionId: string) => SessionMode

  // 获取 session 配置
  getSessionConfig: (sessionId: string) => SessionConfig | undefined

  // 设置 session 模式
  setSessionMode: (sessionId: string, config: SessionConfig) => void

  // 切换模式（保留历史消息）
  switchMode: (sessionId: string, newMode: SessionMode) => Promise<void>

  // 初始化 session 模式
  initSessionMode: (sessionId: string, mode: SessionMode, workingDir?: string) => void

  // 从后端 session-meta 同步模式信息
  syncSessionModes: (sessions: Array<{ id: string; mode?: SessionMode; workDir?: string | null }>) => void

  // 从 localStorage 恢复
  restoreModes: () => void

  // 保存到 localStorage
  saveModes: () => void
}

export const useModeStore = create<ModeStore>((set, get) => ({
  sessionModes: new Map(),
  currentMode: loadCurrentMode(),

  setCurrentMode: (mode) => {
    if (get().currentMode === mode) return
    set({ currentMode: mode })
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CURRENT_MODE_STORAGE_KEY, mode)
      }
    } catch (error) {
      console.error('Failed to persist current mode:', error)
    }
  },

  getSessionMode: (sessionId) => {
    return get().sessionModes.get(sessionId)?.mode || 'code'
  },

  getSessionConfig: (sessionId) => {
    return get().sessionModes.get(sessionId)
  },

  setSessionMode: (sessionId, config) => {
    const modes = new Map(get().sessionModes)
    modes.set(sessionId, config)
    set({ sessionModes: modes })
    get().saveModes()
  },

  switchMode: async (sessionId, newMode) => {
    const current = get().sessionModes.get(sessionId)
    if (!current) {
      // 如果没有配置，创建默认配置
      const newConfig = getDefaultConfig(newMode)
      get().setSessionMode(sessionId, newConfig)
      return
    }

    if (current.mode === newMode) return

    const newConfig: SessionConfig = {
      ...current,
      mode: newMode,
      enableTools: newMode === 'code',
      enableMCP: newMode === 'code',
      enableSkills: newMode === 'code',
    }

    get().setSessionMode(sessionId, newConfig)
  },

  initSessionMode: (sessionId, mode, workingDir) => {
    const existing = get().sessionModes.get(sessionId)
    if (existing) return

    const config = getDefaultConfig(mode, workingDir)
    get().setSessionMode(sessionId, config)
  },

  syncSessionModes: (sessions) => {
    const modes = new Map(get().sessionModes)
    let changed = false

    for (const session of sessions) {
      const mode = session.mode === 'chat' ? 'chat' : 'code'
      const existing = modes.get(session.id)
      const workingDirectory =
        mode === 'code'
          ? (session.workDir ?? existing?.workingDirectory)
          : undefined
      const nextConfig: SessionConfig = {
        ...getDefaultConfig(mode, workingDirectory),
        ...existing,
        mode,
        workingDirectory,
        enableTools: mode === 'code',
        enableMCP: mode === 'code',
        enableSkills: mode === 'code',
      }

      if (
        !existing ||
        existing.mode !== nextConfig.mode ||
        existing.workingDirectory !== nextConfig.workingDirectory ||
        existing.enableTools !== nextConfig.enableTools ||
        existing.enableMCP !== nextConfig.enableMCP ||
        existing.enableSkills !== nextConfig.enableSkills
      ) {
        modes.set(session.id, nextConfig)
        changed = true
      }
    }

    if (!changed) return
    set({ sessionModes: modes })
    get().saveModes()
  },

  restoreModes: () => {
    try {
      const raw = localStorage.getItem(MODE_STORAGE_KEY)
      if (!raw) return

      const data = JSON.parse(raw) as Array<[string, SessionConfig]>
      const modes = new Map(data)
      set({ sessionModes: modes })
    } catch (error) {
      console.error('Failed to restore session modes:', error)
    }
  },

  saveModes: () => {
    try {
      const data = Array.from(get().sessionModes.entries())
      localStorage.setItem(MODE_STORAGE_KEY, JSON.stringify(data))
    } catch (error) {
      console.error('Failed to save session modes:', error)
    }
  },
}))
