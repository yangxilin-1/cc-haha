import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { sanitizePath } from '../../utils/sessionStoragePortable.js'
import { CHAT_PROJECT_DIR, SessionStore } from '../storage/SessionStore.js'
import { TranscriptStore } from '../storage/TranscriptStore.js'
import type { RawSessionEntry } from '../storage/sessionTypes.js'

describe('SessionStore', () => {
  let tmpDir: string
  let originalYcodeDataDir: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ycode-session-store-'))
    originalYcodeDataDir = process.env.YCODE_DATA_DIR
    process.env.YCODE_DATA_DIR = tmpDir
  })

  afterEach(async () => {
    if (originalYcodeDataDir === undefined) delete process.env.YCODE_DATA_DIR
    else process.env.YCODE_DATA_DIR = originalYcodeDataDir

    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('prepares chat and code sessions in the Ycode data directory', async () => {
    const store = new SessionStore()
    const workDir = path.join(tmpDir, 'workspace', 'app')
    await fs.mkdir(workDir, { recursive: true })

    const chat = await store.prepareNewSessionFile(undefined, 'chat')
    expect(chat.mode).toBe('chat')
    expect(chat.projectDir).toBe(CHAT_PROJECT_DIR)
    expect(chat.workDir).toBeNull()
    expect(chat.filePath.startsWith(path.join(tmpDir, 'projects', CHAT_PROJECT_DIR))).toBe(true)

    const code = await store.prepareNewSessionFile(workDir, 'code')
    expect(code.mode).toBe('code')
    expect(code.workDir).toBe(path.resolve(workDir))
    expect(code.projectDir).toBe(sanitizePath(path.resolve(workDir)))
    expect(code.filePath.startsWith(path.join(tmpDir, 'projects', code.projectDir))).toBe(true)
  })

  test('discovers session files and filters by project path', async () => {
    const store = new SessionStore()
    const projectA = path.join(tmpDir, 'workspace', 'a')
    const projectB = path.join(tmpDir, 'workspace', 'b')
    const dirA = path.join(tmpDir, 'projects', sanitizePath(projectA))
    const dirB = path.join(tmpDir, 'projects', sanitizePath(projectB))
    await fs.mkdir(dirA, { recursive: true })
    await fs.mkdir(dirB, { recursive: true })

    await fs.writeFile(path.join(dirA, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), '{}\n')
    await fs.writeFile(path.join(dirA, 'not-a-session.txt'), '{}\n')
    await fs.writeFile(path.join(dirB, 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl'), '{}\n')

    const all = await store.discoverSessionFiles()
    expect(all.map((file) => file.sessionId).sort()).toEqual([
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee',
    ])

    const filtered = await store.discoverSessionFiles(projectA)
    expect(filtered).toHaveLength(1)
    expect(filtered[0]!.projectDir).toBe(sanitizePath(projectA))
  })

  test('rejects invalid session ids before scanning storage', async () => {
    const store = new SessionStore()
    await fs.mkdir(path.join(tmpDir, 'projects', 'any'), { recursive: true })

    await expect(store.findSessionFile('../not-a-session')).resolves.toBeNull()
  })
})

describe('TranscriptStore', () => {
  let tmpDir: string
  let filePath: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ycode-transcript-store-'))
    filePath = path.join(tmpDir, 'session.jsonl')
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('initializes desktop transcript metadata and skips malformed JSONL lines', async () => {
    const store = new TranscriptStore()

    await store.initializeSessionFile(filePath, {
      mode: 'code',
      workDir: tmpDir,
      timestamp: '2026-01-01T00:00:00.000Z',
    })
    await fs.appendFile(filePath, '{not-json}\n', 'utf-8')

    const entries = await store.readEntries(filePath)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.type).toBe('file-history-snapshot')
    expect(entries[1]).toMatchObject({
      type: 'session-meta',
      isMeta: true,
      mode: 'code',
      workDir: tmpDir,
    })
  })

  test('extracts titles, mode, workDir, and normalized messages', async () => {
    const store = new TranscriptStore()
    const userUuid = crypto.randomUUID()
    const assistantUuid = crypto.randomUUID()
    const entries: RawSessionEntry[] = [
      {
        type: 'session-meta',
        isMeta: true,
        mode: 'chat',
        workDir: null,
        timestamp: '2026-01-01T00:00:00.000Z',
      },
      {
        type: 'session-meta',
        isMeta: true,
        mode: 'code',
        workDir: tmpDir,
        timestamp: '2026-01-01T00:00:01.000Z',
      },
      {
        type: 'ai-title',
        aiTitle: 'AI title',
        timestamp: '2026-01-01T00:00:02.000Z',
      },
      {
        type: 'custom-title',
        customTitle: 'Custom title',
        timestamp: '2026-01-01T00:00:03.000Z',
      },
      {
        type: 'user',
        uuid: userUuid,
        timestamp: '2026-01-01T00:00:04.000Z',
        message: { role: 'user', content: 'Hello storage' },
      },
      {
        type: 'assistant',
        uuid: assistantUuid,
        parentUuid: userUuid,
        timestamp: '2026-01-01T00:00:05.000Z',
        message: {
          role: 'assistant',
          model: 'test-model',
          content: [{ type: 'text', text: 'Hello back' }],
        },
      },
    ]

    expect(store.extractTitle(entries)).toBe('Custom title')
    expect(store.resolveModeFromEntries(entries)).toBe('code')
    expect(store.resolveWorkDirFromEntries(entries, 'fallback', {
      isChatProjectDir: () => false,
      desanitizePath: (value) => value,
    })).toBe(tmpDir)

    const messages = store.entriesToMessages(entries)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ type: 'user', content: 'Hello storage' })
    expect(messages[1]).toMatchObject({
      type: 'assistant',
      parentUuid: userUuid,
      model: 'test-model',
    })
  })

  test('appends native user, assistant, metadata, and title entries', async () => {
    const store = new TranscriptStore()
    await store.initializeSessionFile(filePath, { mode: 'chat', workDir: null })

    const userUuid = await store.appendUserMessage(filePath, 'session-1', 'Hi')
    const assistantUuid = await store.appendAssistantMessage(filePath, 'Hello', {
      model: 'model-a',
      parentUuid: userUuid,
    })
    await store.appendSessionMetadata(filePath, {
      mode: 'chat',
      workDir: null,
      customTitle: 'Saved chat',
    })

    const entries = await store.readEntries(filePath)
    expect(entries.some((entry) => entry.uuid === userUuid)).toBe(true)
    expect(entries.some((entry) => entry.uuid === assistantUuid)).toBe(true)
    expect(store.extractTitle(entries)).toBe('Saved chat')
    expect(store.transcriptMessageCount(entries)).toBe(2)

    const messages = store.entriesToMessages(entries)
    expect(messages.map((message) => message.type)).toEqual(['user', 'assistant'])
  })
})
