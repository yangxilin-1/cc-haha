import { create } from 'zustand'

// localStorage keys
const ALIASES_KEY = 'ycode-project-aliases'
const HIDDEN_KEY = 'ycode-project-hidden'
const EXPANDED_KEY = 'ycode-project-expanded'

function loadJSON<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveJSON(key: string, value: unknown) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

type ProjectStore = {
  // workDir -> 自定义名
  aliases: Record<string, string>
  // 已从侧边栏隐藏的 workDir 列表（会话文件不删除）
  hidden: string[]
  // 项目是否展开（默认 false）
  expanded: Record<string, boolean>
  // 点击项目行时写入，供 EmptySession 的输入框底部自动填充
  selectedWorkDir: string | null

  setAlias: (workDir: string, name: string) => void
  removeAlias: (workDir: string) => void
  hideProject: (workDir: string) => void
  showProject: (workDir: string) => void
  isHidden: (workDir: string) => boolean
  toggleExpanded: (workDir: string) => void
  setExpanded: (workDir: string, open: boolean) => void
  isExpanded: (workDir: string) => boolean
  setSelectedWorkDir: (workDir: string | null) => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  aliases: loadJSON<Record<string, string>>(ALIASES_KEY, {}),
  hidden: loadJSON<string[]>(HIDDEN_KEY, []),
  expanded: loadJSON<Record<string, boolean>>(EXPANDED_KEY, {}),
  selectedWorkDir: null,

  setAlias: (workDir, name) => {
    const next = { ...get().aliases, [workDir]: name }
    saveJSON(ALIASES_KEY, next)
    set({ aliases: next })
  },

  removeAlias: (workDir) => {
    const next = { ...get().aliases }
    delete next[workDir]
    saveJSON(ALIASES_KEY, next)
    set({ aliases: next })
  },

  hideProject: (workDir) => {
    const current = get().hidden
    if (current.includes(workDir)) return
    const next = [...current, workDir]
    saveJSON(HIDDEN_KEY, next)
    set({ hidden: next })
  },

  showProject: (workDir) => {
    const next = get().hidden.filter((p) => p !== workDir)
    saveJSON(HIDDEN_KEY, next)
    set({ hidden: next })
  },

  isHidden: (workDir) => get().hidden.includes(workDir),

  toggleExpanded: (workDir) => {
    const current = get().expanded
    const next = { ...current, [workDir]: !(current[workDir] ?? false) }
    saveJSON(EXPANDED_KEY, next)
    set({ expanded: next })
  },

  setExpanded: (workDir, open) => {
    const current = get().expanded
    if ((current[workDir] ?? false) === open) return
    const next = { ...current, [workDir]: open }
    saveJSON(EXPANDED_KEY, next)
    set({ expanded: next })
  },

  isExpanded: (workDir) => get().expanded[workDir] ?? false,

  setSelectedWorkDir: (workDir) => set({ selectedWorkDir: workDir }),
}))

/** Take the last path segment from a POSIX or Windows absolute path. */
export function basenameOf(p: string | null | undefined): string {
  if (!p) return 'Unknown'
  const clean = p.replace(/[\\/]+$/, '')
  const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
  return lastSlash === -1 ? clean : clean.slice(lastSlash + 1) || clean
}
