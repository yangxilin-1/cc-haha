/**
 * Session Service — desktop session orchestration.
 *
 * SessionService intentionally keeps the public API used by routes/runtime, but
 * storage is split below it:
 *
 * - SessionStore: data directory, project/session file discovery, file lifecycle
 * - TranscriptStore: JSONL transcript read/write and message normalization
 */

import * as fs from 'node:fs/promises'
import { ApiError } from '../middleware/errorHandler.js'
import {
  sessionStore as defaultSessionStore,
  type SessionStore,
} from '../storage/SessionStore.js'
import {
  transcriptStore as defaultTranscriptStore,
  type TranscriptStore,
} from '../storage/TranscriptStore.js'
import type {
  MessageEntry,
  RawSessionEntry,
  SessionDetail,
  SessionLaunchInfo,
  SessionListItem,
  SessionMode,
} from '../storage/sessionTypes.js'

export type {
  MessageEntry,
  RawSessionEntry,
  SessionDetail,
  SessionLaunchInfo,
  SessionListItem,
  SessionMode,
} from '../storage/sessionTypes.js'

type SessionServiceOptions = {
  sessionStore?: SessionStore
  transcriptStore?: TranscriptStore
}

export class SessionService {
  private sessions: SessionStore
  private transcripts: TranscriptStore

  constructor(options?: SessionServiceOptions) {
    this.sessions = options?.sessionStore ?? defaultSessionStore
    this.transcripts = options?.transcriptStore ?? defaultTranscriptStore
  }

  desanitizePath(sanitized: string): string {
    return this.sessions.desanitizePath(sanitized)
  }

  async findSessionFile(
    sessionId: string,
  ): Promise<{ filePath: string; projectDir: string } | null> {
    return this.sessions.findSessionFile(sessionId)
  }

  async listSessions(options?: {
    project?: string
    limit?: number
    offset?: number
  }): Promise<{ sessions: SessionListItem[]; total: number }> {
    const sessionFiles = await this.sessions.discoverSessionFiles(options?.project)
    const items: SessionListItem[] = []

    for (const { filePath, projectDir, sessionId } of sessionFiles) {
      try {
        const stat = await fs.stat(filePath)
        const entries = await this.transcripts.readEntries(filePath)
        const { mode, workDir, isChatSession } = this.resolveSessionContext(entries, projectDir)
        const workDirExists = isChatSession ? true : await this.sessions.pathExists(workDir)

        items.push({
          id: sessionId,
          title: this.transcripts.extractTitle(entries),
          createdAt: this.transcripts.firstTimestamp(entries) ?? stat.birthtime.toISOString(),
          modifiedAt: stat.mtime.toISOString(),
          messageCount: this.transcripts.transcriptMessageCount(entries),
          projectPath: projectDir,
          workDir,
          workDirExists,
          mode,
        })
      } catch {
        // Skip unreadable files.
      }
    }

    items.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())

    const total = items.length
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 50
    return { sessions: items.slice(offset, offset + limit), total }
  }

  async getSession(sessionId: string): Promise<SessionDetail | null> {
    const found = await this.sessions.findSessionFile(sessionId)
    if (!found) return null

    const stat = await fs.stat(found.filePath)
    const entries = await this.transcripts.readEntries(found.filePath)
    const messages = this.transcripts.entriesToMessages(entries)
    const { mode, workDir, isChatSession } = this.resolveSessionContext(entries, found.projectDir)

    return {
      id: sessionId,
      title: this.transcripts.extractTitle(entries),
      createdAt: this.transcripts.firstTimestamp(entries) ?? stat.birthtime.toISOString(),
      modifiedAt: stat.mtime.toISOString(),
      messageCount: messages.length,
      projectPath: found.projectDir,
      workDir,
      workDirExists: isChatSession ? true : await this.sessions.pathExists(workDir),
      mode,
      messages,
    }
  }

  async getSessionMessages(sessionId: string): Promise<MessageEntry[]> {
    const found = await this.sessions.findSessionFile(sessionId)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    const entries = await this.transcripts.readEntries(found.filePath)
    return this.transcripts.entriesToMessages(entries)
  }

  async createSession(workDir?: string, mode?: SessionMode): Promise<{ sessionId: string }> {
    const sessionFile = await this.sessions.prepareNewSessionFile(workDir, mode)
    await this.transcripts.initializeSessionFile(sessionFile.filePath, {
      mode: sessionFile.mode,
      workDir: sessionFile.workDir,
    })
    return { sessionId: sessionFile.sessionId }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sessions.deleteSessionFile(sessionId)
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    if (!title || typeof title !== 'string') {
      throw ApiError.badRequest('title is required')
    }

    const found = await this.sessions.findSessionFile(sessionId)
    if (!found) {
      throw ApiError.notFound(`Session not found: ${sessionId}`)
    }

    await this.transcripts.appendCustomTitle(found.filePath, title)
  }

  async appendAiTitle(sessionId: string, title: string): Promise<void> {
    const found = await this.sessions.findSessionFile(sessionId)
    if (!found) return
    await this.transcripts.appendAiTitle(found.filePath, title)
  }

  async appendUserMessage(
    sessionId: string,
    content: string | Array<Record<string, unknown>>,
  ): Promise<string | null> {
    const found = await this.sessions.findSessionFile(sessionId)
    if (!found) return null
    return this.transcripts.appendUserMessage(found.filePath, sessionId, content)
  }

  async appendAssistantMessage(
    sessionId: string,
    content: string | Array<Record<string, unknown>>,
    options?: { model?: string; parentUuid?: string | null },
  ): Promise<string | null> {
    const found = await this.sessions.findSessionFile(sessionId)
    if (!found) return null
    return this.transcripts.appendAssistantMessage(found.filePath, content, options)
  }

  async getSessionWorkDir(sessionId: string): Promise<string | null> {
    const found = await this.sessions.findSessionFile(sessionId)
    if (!found) return null

    const entries = await this.transcripts.readEntries(found.filePath)
    const { workDir } = this.resolveSessionContext(entries, found.projectDir)
    return workDir
  }

  async getSessionLaunchInfo(sessionId: string): Promise<SessionLaunchInfo | null> {
    const found = await this.sessions.findSessionFile(sessionId)
    if (!found) return null

    const entries = await this.transcripts.readEntries(found.filePath)
    const { mode, workDir, isChatSession } = this.resolveSessionContext(entries, found.projectDir)
    let customTitle: string | null = null

    for (const entry of entries) {
      if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
        customTitle = entry.customTitle
      }
    }

    return {
      filePath: found.filePath,
      projectDir: found.projectDir,
      workDir: isChatSession ? null : workDir || process.cwd(),
      mode,
      transcriptMessageCount: this.transcripts.transcriptMessageCount(entries),
      customTitle,
    }
  }

  async deleteSessionFile(sessionId: string): Promise<void> {
    await this.sessions.deleteSessionFileIfExists(sessionId)
  }

  async appendSessionMetadata(
    sessionId: string,
    metadata: { workDir: string | null; customTitle?: string | null; mode?: SessionMode },
  ): Promise<void> {
    const found = await this.sessions.findSessionFile(sessionId)
    if (!found) return
    await this.transcripts.appendSessionMetadata(found.filePath, metadata)
  }

  private resolveSessionContext(
    entries: RawSessionEntry[],
    projectDir: string,
  ): { mode: SessionMode; workDir: string | null; isChatSession: boolean } {
    const resolvedMode = this.transcripts.resolveModeFromEntries(entries)
    const isChatSession =
      resolvedMode === 'chat' || this.sessions.isChatProjectDir(projectDir)
    const mode: SessionMode = isChatSession ? 'chat' : resolvedMode
    const workDir = isChatSession
      ? null
      : this.transcripts.resolveWorkDirFromEntries(entries, projectDir, {
          isChatProjectDir: (dir) => this.sessions.isChatProjectDir(dir),
          desanitizePath: (dir) => this.sessions.desanitizePath(dir),
        })

    return { mode, workDir, isChatSession }
  }
}

export const sessionService = new SessionService()

