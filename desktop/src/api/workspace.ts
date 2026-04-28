import { api, getBaseUrl } from './client'

export type WorkspaceEntry = {
  name: string
  relativePath: string
  isDirectory: boolean
  isFile: boolean
}

export type WorkspaceTreeResponse = {
  root: string
  currentPath: string
  relativePath: string
  entries: WorkspaceEntry[]
  truncated?: boolean
  truncatedCount?: number
}

export type WorkspaceFileResponse = {
  root: string
  relativePath: string
  size: number
  mimeType: string
  language?: string
  content?: string
  binary: boolean
}

export type TerminalRunResponse = {
  command: string
  cwd: string
  root: string
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut?: boolean
}

export type WorkspaceChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'changed'

export type WorkspaceChangeFile = {
  path: string
  status: WorkspaceChangeStatus
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  unstaged: boolean
  additions: number
  deletions: number
}

export type WorkspaceChangesResponse = {
  root: string
  files: WorkspaceChangeFile[]
  hasChanges: boolean
  source: 'git' | 'none'
  error?: string
}

export type WorkspaceDiffResponse = {
  root: string
  relativePath: string
  diff: string
  source: 'git' | 'workspace'
  truncated?: boolean
  error?: string
}

export type WorkspaceRevealResponse = {
  ok: boolean
  path: string
  error?: string
}

function encodePathSegments(path: string): string {
  return path
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export const workspaceApi = {
  tree(sessionId: string, path?: string) {
    const q = new URLSearchParams()
    if (path) q.set('path', path)
    const query = q.toString()
    return api.get<WorkspaceTreeResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/workspace/tree${query ? `?${query}` : ''}`,
    )
  },

  file(sessionId: string, path: string) {
    const q = new URLSearchParams({ path })
    return api.get<WorkspaceFileResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/workspace/file?${q}`,
    )
  },

  rawFileUrl(sessionId: string, path: string) {
    return `${getBaseUrl()}/api/sessions/${encodeURIComponent(sessionId)}/workspace/raw/${encodePathSegments(path)}`
  },

  changes(sessionId: string) {
    return api.get<WorkspaceChangesResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/workspace/changes`,
      { timeout: 12_000 },
    )
  },

  diff(sessionId: string, path?: string) {
    const q = new URLSearchParams()
    if (path) q.set('path', path)
    const query = q.toString()
    return api.get<WorkspaceDiffResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/workspace/diff${query ? `?${query}` : ''}`,
      { timeout: 12_000 },
    )
  },

  reveal(sessionId: string, path?: string) {
    return api.post<WorkspaceRevealResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/workspace/reveal`,
      path ? { path } : {},
      { timeout: 8_000 },
    )
  },

  runTerminalCommand(sessionId: string, command: string, cwd?: string) {
    return api.post<TerminalRunResponse>(
      `/api/sessions/${encodeURIComponent(sessionId)}/terminal/run`,
      { command, cwd },
      { timeout: 35_000 },
    )
  },
}
