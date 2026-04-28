export type SessionMode = 'code' | 'chat'

export interface SessionConfig {
  mode: SessionMode
  workingDirectory?: string  // Code 模式必需
  enableTools: boolean       // Code=true, Chat=false
  enableMCP: boolean         // Code=true, Chat=false
  enableSkills: boolean      // Code=true, Chat=false
  enableMemory: boolean      // 两者都可选
}

export interface ModeCapabilities {
  fileOperations: boolean
  shellCommands: boolean
  mcpServers: boolean
  skills: boolean
  agents: boolean
  computerUse: boolean
}

export const MODE_CAPABILITIES: Record<SessionMode, ModeCapabilities> = {
  code: {
    fileOperations: true,
    shellCommands: true,
    mcpServers: true,
    skills: true,
    agents: true,
    computerUse: true,
  },
  chat: {
    fileOperations: false,
    shellCommands: false,
    mcpServers: false,
    skills: false,
    agents: false,
    computerUse: true,
  },
}

export function getDefaultConfig(mode: SessionMode, workingDir?: string): SessionConfig {
  return {
    mode,
    workingDirectory: workingDir,
    enableTools: mode === 'code',
    enableMCP: mode === 'code',
    enableSkills: mode === 'code',
    enableMemory: true,
  }
}
