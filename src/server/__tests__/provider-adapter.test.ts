import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  ProviderAdapter,
  ProviderRequestError,
} from '../runtime/ProviderAdapter.js'
import type { ChatModelRequest, RuntimeProviderSnapshot } from '../runtime/types.js'

const originalFetch = globalThis.fetch
const ENV_KEYS = [
  'YCODE_DATA_DIR',
  'YCODE_CONFIG_DIR',
  'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
] as const

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>>
let tmpDir: string

beforeEach(async () => {
  originalEnv = {}
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key]
    delete process.env[key]
  }

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-adapter-'))
  process.env.YCODE_DATA_DIR = path.join(tmpDir, 'ycode-data')
  process.env.YCODE_CONFIG_DIR = path.join(tmpDir, 'ycode-config')
  process.env.CLAUDE_CONFIG_DIR = path.join(tmpDir, 'official-claude')
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  for (const key of ENV_KEYS) {
    const original = originalEnv[key]
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('ProviderAdapter', () => {
  test('reads official Claude settings.json when no Ycode provider is active', async () => {
    const officialDir = process.env.CLAUDE_CONFIG_DIR!
    await fs.mkdir(officialDir, { recursive: true })
    await fs.writeFile(
      path.join(officialDir, 'settings.json'),
      JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'official-bearer-token',
          ANTHROPIC_BASE_URL: 'https://official.example.com/',
          ANTHROPIC_MODEL: 'claude-from-official-settings',
        },
      }),
      'utf-8',
    )

    const snapshot = await new ProviderAdapter().resolveSnapshot()

    expect(snapshot.providerId).toBe('env-anthropic')
    expect(snapshot.baseUrl).toBe('https://official.example.com')
    expect(snapshot.model).toBe('claude-from-official-settings')
    expect(snapshot.auth).toEqual({
      type: 'bearer',
      value: 'official-bearer-token',
    })
  })

  test('sends ANTHROPIC_AUTH_TOKEN style auth as Authorization Bearer', async () => {
    let capturedHeaders: Record<string, string> | undefined
    globalThis.fetch = async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode('event: message_stop\ndata: {}\n\n'),
            )
            controller.close()
          },
        }),
        { status: 200 },
      )
    }

    const adapter = new ProviderAdapter()
    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'claude-test',
      auth: { type: 'bearer', value: 'bearer-token' },
      createdAt: new Date().toISOString(),
    }
    const request: ChatModelRequest = {
      model: 'placeholder',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 100,
    }

    const stream = adapter.stream(request, snapshot, new AbortController().signal)
    await stream.next()

    expect(capturedHeaders?.Authorization).toBe('Bearer bearer-token')
    expect(capturedHeaders?.['x-api-key']).toBeUndefined()
  })

  test('classifies invalid model HTTP errors before they reach the desktop UI', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            type: '<nil>',
            message:
              '上游 API 调用失败: 流式 API 请求失败: 400 Bad Request {"message":"Invalid model. Please select a different model to continue.","reason":"INVALID_MODEL_ID"}',
          },
          type: 'error',
        }),
        { status: 502 },
      )

    const adapter = new ProviderAdapter()
    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'bad-model',
      auth: { type: 'api-key', value: 'sk-test' },
      createdAt: new Date().toISOString(),
    }
    const request: ChatModelRequest = {
      model: 'placeholder',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 100,
    }

    const stream = adapter.stream(request, snapshot, new AbortController().signal)

    try {
      await stream.next()
      throw new Error('Expected ProviderRequestError')
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderRequestError)
      expect((error as ProviderRequestError).providerCode).toBe('INVALID_MODEL_ID')
      expect((error as ProviderRequestError).message).toContain('bad-model')
      expect((error as ProviderRequestError).message).not.toContain('上游 API 调用失败')
    }
  })
})
