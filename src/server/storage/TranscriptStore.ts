import * as fs from 'node:fs/promises'
import type {
  MessageEntry,
  RawSessionEntry,
  SessionMode,
} from './sessionTypes.js'

export type WorkDirResolver = {
  isChatProjectDir(projectDir?: string): boolean
  desanitizePath(projectDir: string): string
}

export class TranscriptStore {
  async readEntries(filePath: string): Promise<RawSessionEntry[]> {
    let content: string
    try {
      content = await fs.readFile(filePath, 'utf-8')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }

    const entries: RawSessionEntry[] = []
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        entries.push(JSON.parse(trimmed) as RawSessionEntry)
      } catch {
        // Skip malformed lines.
      }
    }
    return entries
  }

  async appendEntry(filePath: string, entry: Record<string, unknown>): Promise<void> {
    await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf-8')
  }

  async initializeSessionFile(
    filePath: string,
    metadata: { mode: SessionMode; workDir: string | null; timestamp?: string },
  ): Promise<void> {
    const timestamp = metadata.timestamp ?? new Date().toISOString()
    const initialEntry = {
      type: 'file-history-snapshot',
      messageId: crypto.randomUUID(),
      snapshot: {
        messageId: crypto.randomUUID(),
        trackedFileBackups: {},
        timestamp,
      },
      isSnapshotUpdate: false,
    }
    const metaEntry = {
      type: 'session-meta',
      isMeta: true,
      workDir: metadata.workDir,
      mode: metadata.mode,
      timestamp,
    }

    await fs.writeFile(
      filePath,
      `${JSON.stringify(initialEntry)}\n${JSON.stringify(metaEntry)}\n`,
      'utf-8',
    )
  }

  resolveModeFromEntries(entries: RawSessionEntry[]): SessionMode {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as Record<string, unknown> | undefined
      if (entry?.type === 'session-meta') {
        const mode = entry.mode
        if (mode === 'chat' || mode === 'code') return mode
      }
    }
    return 'code'
  }

  resolveWorkDirFromEntries(
    entries: RawSessionEntry[],
    fallbackProjectDir: string | undefined,
    resolver: WorkDirResolver,
  ): string | null {
    for (const entry of entries) {
      if (
        entry.type === 'session-meta' &&
        typeof (entry as Record<string, unknown>).workDir === 'string'
      ) {
        return (entry as Record<string, unknown>).workDir as string
      }
    }

    for (let i = entries.length - 1; i >= 0; i--) {
      const cwd = entries[i]?.cwd
      if (typeof cwd === 'string' && cwd.trim()) return cwd
    }

    if (resolver.isChatProjectDir(fallbackProjectDir)) return null
    return fallbackProjectDir ? resolver.desanitizePath(fallbackProjectDir) : null
  }

  extractTitle(entries: RawSessionEntry[]): string {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!
      if (entry.type === 'custom-title' && entry.customTitle) {
        return entry.customTitle
      }
    }

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]!
      if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') {
        return entry.aiTitle
      }
    }

    for (const entry of entries) {
      if (entry.type !== 'user' || entry.isMeta || entry.message?.role !== 'user') {
        continue
      }

      const content = entry.message.content
      let text: string | undefined
      if (typeof content === 'string') {
        text = content
      } else if (Array.isArray(content)) {
        const textBlock = content.find(
          (block: Record<string, unknown>) =>
            block.type === 'text' && typeof block.text === 'string',
        )
        if (textBlock) text = textBlock.text as string
      }

      if (text) return text.length > 80 ? `${text.slice(0, 80)}...` : text
    }

    return 'Untitled Session'
  }

  firstTimestamp(entries: RawSessionEntry[]): string | null {
    for (const entry of entries) {
      if (entry.timestamp) return entry.timestamp
    }
    return null
  }

  transcriptMessageCount(entries: RawSessionEntry[]): number {
    return entries.filter(
      (entry) =>
        !entry.isMeta &&
        Boolean(entry.message?.role) &&
        (entry.type === 'user' || entry.type === 'assistant' || entry.type === 'system'),
    ).length
  }

  entriesToMessages(entries: RawSessionEntry[]): MessageEntry[] {
    const messages: MessageEntry[] = []
    const entriesByUuid = new Map<string, RawSessionEntry>()
    const parentToolUseIdCache = new Map<string, string | undefined>()

    for (const entry of entries) {
      if (typeof entry.uuid === 'string' && entry.uuid.length > 0) {
        entriesByUuid.set(entry.uuid, entry)
      }
    }

    for (const entry of entries) {
      if (!entry.message?.role || entry.isMeta) continue
      if (
        entry.type !== 'user' &&
        entry.type !== 'assistant' &&
        entry.type !== 'system'
      ) {
        continue
      }

      const parentToolUseId = this.resolveParentToolUseId(
        entry,
        entriesByUuid,
        parentToolUseIdCache,
      )
      const message = this.entryToMessage(entry, parentToolUseId)
      if (message) messages.push(message)
    }

    return messages
  }

  async appendCustomTitle(filePath: string, title: string): Promise<void> {
    await this.appendEntry(filePath, {
      type: 'custom-title',
      customTitle: title,
      timestamp: new Date().toISOString(),
    })
  }

  async appendAiTitle(filePath: string, title: string): Promise<void> {
    await this.appendEntry(filePath, {
      type: 'ai-title',
      aiTitle: title,
      timestamp: new Date().toISOString(),
    })
  }

  async appendUserMessage(
    filePath: string,
    sessionId: string,
    content: string | Array<Record<string, unknown>>,
  ): Promise<string> {
    const uuid = crypto.randomUUID()
    await this.appendEntry(filePath, {
      parentUuid: null,
      isSidechain: false,
      type: 'user',
      message: { role: 'user', content },
      uuid,
      timestamp: new Date().toISOString(),
      userType: 'external',
      sessionId,
    })
    return uuid
  }

  async appendAssistantMessage(
    filePath: string,
    content: string | Array<Record<string, unknown>>,
    options?: { model?: string; parentUuid?: string | null },
  ): Promise<string> {
    const normalizedContent =
      typeof content === 'string' ? [{ type: 'text', text: content }] : content
    const uuid = crypto.randomUUID()

    await this.appendEntry(filePath, {
      parentUuid: options?.parentUuid ?? null,
      isSidechain: false,
      type: 'assistant',
      message: {
        model: options?.model,
        id: `msg_${uuid.replace(/-/g, '').slice(0, 24)}`,
        type: 'message',
        role: 'assistant',
        content: normalizedContent,
      },
      uuid,
      timestamp: new Date().toISOString(),
    })

    return uuid
  }

  async appendSessionMetadata(
    filePath: string,
    metadata: { workDir: string | null; customTitle?: string | null; mode?: SessionMode },
  ): Promise<void> {
    const metaEntry: Record<string, unknown> = {
      type: 'session-meta',
      isMeta: true,
      workDir: metadata.workDir,
      timestamp: new Date().toISOString(),
    }
    if (metadata.mode === 'chat' || metadata.mode === 'code') {
      metaEntry.mode = metadata.mode
    }
    await this.appendEntry(filePath, metaEntry)

    if (metadata.customTitle) {
      await this.appendCustomTitle(filePath, metadata.customTitle)
    }
  }

  private entryToMessage(
    entry: RawSessionEntry,
    parentToolUseId?: string,
  ): MessageEntry | null {
    const msg = entry.message
    if (!msg || !msg.role) return null

    let type: MessageEntry['type']
    if (msg.role === 'user') {
      if (
        Array.isArray(msg.content) &&
        msg.content.some((block: Record<string, unknown>) => block.type === 'tool_result')
      ) {
        type = 'tool_result'
      } else {
        type = 'user'
      }
    } else if (msg.role === 'assistant') {
      if (
        Array.isArray(msg.content) &&
        msg.content.some((block: Record<string, unknown>) => block.type === 'tool_use')
      ) {
        type = 'tool_use'
      } else {
        type = 'assistant'
      }
    } else {
      type = 'system'
    }

    return {
      id: entry.uuid || crypto.randomUUID(),
      type,
      content: msg.content,
      timestamp: entry.timestamp || new Date().toISOString(),
      model: msg.model,
      parentUuid: entry.parentUuid ?? undefined,
      parentToolUseId,
      isSidechain: entry.isSidechain,
    }
  }

  private extractAgentToolUseId(entry: RawSessionEntry): string | undefined {
    const content = entry.message?.content
    if (!Array.isArray(content)) return undefined

    for (const block of content as Array<Record<string, unknown>>) {
      if (
        block.type === 'tool_use' &&
        block.name === 'Agent' &&
        typeof block.id === 'string'
      ) {
        return block.id
      }
    }

    return undefined
  }

  private resolveParentToolUseId(
    entry: RawSessionEntry,
    entriesByUuid: Map<string, RawSessionEntry>,
    cache: Map<string, string | undefined>,
  ): string | undefined {
    if (
      typeof entry.parent_tool_use_id === 'string' &&
      entry.parent_tool_use_id.length > 0
    ) {
      return entry.parent_tool_use_id
    }

    if (entry.isSidechain !== true) return undefined

    const cacheKey = entry.uuid
    if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey)

    let resolved: string | undefined
    let currentParentUuid =
      typeof entry.parentUuid === 'string' ? entry.parentUuid : undefined
    const visited = new Set<string>()

    while (currentParentUuid && !visited.has(currentParentUuid)) {
      visited.add(currentParentUuid)
      const parentEntry = entriesByUuid.get(currentParentUuid)
      if (!parentEntry) break

      const directAgentToolUseId = this.extractAgentToolUseId(parentEntry)
      if (directAgentToolUseId) {
        resolved = directAgentToolUseId
        break
      }

      if (parentEntry.uuid && cache.has(parentEntry.uuid)) {
        resolved = cache.get(parentEntry.uuid)
        break
      }

      currentParentUuid =
        typeof parentEntry.parentUuid === 'string'
          ? parentEntry.parentUuid
          : undefined
    }

    if (cacheKey) cache.set(cacheKey, resolved)
    return resolved
  }
}

export const transcriptStore = new TranscriptStore()

