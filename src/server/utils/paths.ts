import path from 'path'
import os from 'os'

export function getAppDataDir(): string {
  return (
    process.env.YCODE_DATA_DIR ||
    process.env.YCODE_CONFIG_DIR ||
    process.env.CLAUDE_CONFIG_DIR ||
    path.join(os.homedir(), '.ycode')
  )
}

export function getDesktopConfigDir(): string {
  return (
    process.env.YCODE_CONFIG_DIR ||
    process.env.CLAUDE_CONFIG_DIR ||
    process.env.YCODE_DATA_DIR ||
    getAppDataDir()
  )
}

export function getOfficialClaudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

export function getProjectsDir(): string {
  return path.join(getDesktopConfigDir(), 'projects')
}
