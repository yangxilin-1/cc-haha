export type SessionMode = 'chat' | 'code'

export type SessionListItem = {
  id: string
  title: string
  createdAt: string
  modifiedAt: string
  messageCount: number
  projectPath: string
  workDir: string | null
  workDirExists: boolean
  mode: SessionMode
}

export type SessionDetail = SessionListItem & {
  messages: MessageEntry[]
}

export type SessionLaunchInfo = {
  filePath: string
  projectDir: string
  workDir: string | null
  mode: SessionMode
  transcriptMessageCount: number
  customTitle: string | null
}

export type MessageEntry = {
  id: string
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result'
  content: unknown
  timestamp: string
  model?: string
  parentUuid?: string
  parentToolUseId?: string
  isSidechain?: boolean
}

export type RawSessionEntry = {
  type?: string
  uuid?: string
  parentUuid?: string | null
  parent_tool_use_id?: string | null
  isSidechain?: boolean
  isMeta?: boolean
  cwd?: string
  message?: {
    role?: string
    content?: unknown
    model?: string
    id?: string
    type?: string
  }
  timestamp?: string
  customTitle?: string
  title?: string
  [key: string]: unknown
}

export type SessionFileRef = {
  filePath: string
  projectDir: string
  sessionId: string
}

