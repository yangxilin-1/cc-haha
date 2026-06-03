import { create } from 'zustand'
import { normalizeSessionMode, type SessionMode } from '../modes/types'

const CURRENT_MODE_STORAGE_KEY = 'ycode-current-mode'

function loadCurrentMode(): SessionMode {
  try {
    return normalizeSessionMode(
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(CURRENT_MODE_STORAGE_KEY)
        : null,
    )
  } catch {
    return 'code'
  }
}

type ModeStore = {
  currentMode: SessionMode
  setCurrentMode: (mode: SessionMode) => void
}

export const useModeStore = create<ModeStore>((set, get) => ({
  currentMode: loadCurrentMode(),

  setCurrentMode: (mode) => {
    if (get().currentMode === mode) return
    set({ currentMode: mode })
    try {
      localStorage.setItem(CURRENT_MODE_STORAGE_KEY, mode)
    } catch {
      // Mode is a UI preference; ignore storage failures.
    }
  },
}))
