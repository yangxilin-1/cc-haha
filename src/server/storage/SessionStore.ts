import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { sanitizePath as sanitizePortablePath } from '../../utils/sessionStoragePortable.js'
import { ApiError } from '../middleware/errorHandler.js'
import { getAppDataDir } from '../utils/paths.js'
import type { SessionFileRef, SessionMode } from './sessionTypes.js'

export const CHAT_PROJECT_DIR = '__chat__'

export type NewSessionFile = {
  sessionId: string
  filePath: string
  projectDir: string
  workDir: string | null
  mode: SessionMode
}

export class SessionStore {
  getConfigDir(): string {
    return process.env.YCODE_DATA_DIR || getAppDataDir()
  }

  getProjectsDir(): string {
    return path.join(this.getConfigDir(), 'projects')
  }

  /**
   * Sanitize a path the same way the shared session storage does.
   * This must remain Windows-safe, so reserved characters such as ':' are normalized too.
   */
  sanitizePath(dirPath: string): string {
    return sanitizePortablePath(dirPath)
  }

  isChatProjectDir(projectDir?: string): boolean {
    return projectDir === CHAT_PROJECT_DIR
  }

  /**
   * Convert a sanitized directory name back to the original absolute path.
   * Reverses sanitizePath(): `-Users-nanmi-workspace` -> `/Users/nanmi/workspace`.
   */
  desanitizePath(sanitized: string): string {
    return sanitized.replace(/-/g, path.sep)
  }

  /**
   * Find all .jsonl session files across all project directories.
   */
  async discoverSessionFiles(projectFilter?: string): Promise<SessionFileRef[]> {
    const projectsDir = this.getProjectsDir()
    let projectDirs: string[]

    try {
      projectDirs = await fs.readdir(projectsDir)
    } catch {
      return []
    }

    if (projectFilter) {
      const sanitized = this.sanitizePath(projectFilter)
      projectDirs = projectDirs.filter((dir) => dir === sanitized)
    }

    const results: SessionFileRef[] = []

    for (const dir of projectDirs) {
      const dirPath = path.join(projectsDir, dir)

      try {
        const stat = await fs.stat(dirPath)
        if (!stat.isDirectory()) continue
      } catch {
        continue
      }

      let files: string[]
      try {
        files = await fs.readdir(dirPath)
      } catch {
        continue
      }

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        results.push({
          filePath: path.join(dirPath, file),
          projectDir: dir,
          sessionId: file.replace('.jsonl', ''),
        })
      }
    }

    return results
  }

  /**
   * Find the .jsonl file for a given session ID.
   */
  async findSessionFile(
    sessionId: string,
  ): Promise<{ filePath: string; projectDir: string } | null> {
    if (!this.isValidSessionId(sessionId)) return null

    const projectsDir = this.getProjectsDir()
    let projectDirs: string[]

    try {
      projectDirs = await fs.readdir(projectsDir)
    } catch {
      return null
    }

    for (const dir of projectDirs) {
      const filePath = path.join(projectsDir, dir, `${sessionId}.jsonl`)
      try {
        await fs.access(filePath)
        return { filePath, projectDir: dir }
      } catch {
        continue
      }
    }

    return null
  }

  async prepareNewSessionFile(workDir?: string, mode?: SessionMode): Promise<NewSessionFile> {
    const resolvedMode: SessionMode = mode === 'chat' ? 'chat' : 'code'
    const sessionId = crypto.randomUUID()

    if (resolvedMode === 'chat') {
      const dirPath = path.join(this.getProjectsDir(), CHAT_PROJECT_DIR)
      await fs.mkdir(dirPath, { recursive: true })
      return {
        sessionId,
        filePath: path.join(dirPath, `${sessionId}.jsonl`),
        projectDir: CHAT_PROJECT_DIR,
        workDir: null,
        mode: 'chat',
      }
    }

    const resolvedWorkDir = workDir || os.homedir()
    const absWorkDir = path.resolve(resolvedWorkDir)

    let stat
    try {
      stat = await fs.stat(absWorkDir)
    } catch {
      throw ApiError.badRequest(`Working directory does not exist: ${absWorkDir}`)
    }
    if (!stat.isDirectory()) {
      throw ApiError.badRequest(`Working directory is not a directory: ${absWorkDir}`)
    }

    const projectDir = this.sanitizePath(absWorkDir)
    const dirPath = path.join(this.getProjectsDir(), projectDir)
    await fs.mkdir(dirPath, { recursive: true })

    return {
      sessionId,
      filePath: path.join(dirPath, `${sessionId}.jsonl`),
      projectDir,
      workDir: absWorkDir,
      mode: 'code',
    }
  }

  async deleteSessionFile(sessionId: string): Promise<void> {
    const found = await this.findSessionFile(sessionId)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }
    await fs.unlink(found.filePath)
  }

  async deleteSessionFileIfExists(sessionId: string): Promise<void> {
    const found = await this.findSessionFile(sessionId)
    if (!found) return
    await fs.unlink(found.filePath)
  }

  async pathExists(targetPath: string | null): Promise<boolean> {
    if (!targetPath) return false

    try {
      const stat = await fs.stat(targetPath)
      return stat.isDirectory()
    } catch {
      return false
    }
  }

  private isValidSessionId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  }
}

export const sessionStore = new SessionStore()
