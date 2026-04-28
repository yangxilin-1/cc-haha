import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ChatEngine } from '../runtime/ChatEngine.js'
import { SessionService } from '../services/sessionService.js'
import type { ChatModelRequest, RuntimeProviderSnapshot } from '../runtime/types.js'

describe('ChatEngine', () => {
  let tmpDir: string
  let originalYcodeDataDir: string | undefined
  let sessionService: SessionService

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ycode-chat-engine-'))
    originalYcodeDataDir = process.env.YCODE_DATA_DIR
    process.env.YCODE_DATA_DIR = tmpDir
    sessionService = new SessionService()
  })

  afterEach(async () => {
    if (originalYcodeDataDir === undefined) delete process.env.YCODE_DATA_DIR
    else process.env.YCODE_DATA_DIR = originalYcodeDataDir

    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('streams native chat responses and persists desktop-owned transcript entries', async () => {
    const { sessionId } = await sessionService.createSession(undefined, 'chat')
    let requestSeen: ChatModelRequest | null = null

    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test-provider',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'test-model',
      auth: { type: 'api-key', value: 'sk-test' },
      createdAt: new Date().toISOString(),
    }

    const providerAdapter = {
      async resolveSnapshot() {
        return snapshot
      },
      async *stream(request: ChatModelRequest) {
        requestSeen = request
        yield {
          event: 'message_start',
          data: {
            message: {
              usage: { input_tokens: 7, output_tokens: 0 },
            },
          },
        }
        yield {
          event: 'content_block_start',
          data: { content_block: { type: 'text', text: '' } },
        }
        yield {
          event: 'content_block_delta',
          data: { delta: { type: 'text_delta', text: 'Hello' } },
        }
        yield {
          event: 'content_block_delta',
          data: { delta: { type: 'text_delta', text: ' desktop' } },
        }
        yield { event: 'content_block_stop', data: {} }
        yield {
          event: 'message_delta',
          data: { usage: { output_tokens: 3 } },
        }
        yield { event: 'message_stop', data: {} }
      },
    }

    const engine = new ChatEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
    })

    const events = []
    for await (const event of engine.sendMessage({
      sessionId,
      content: '你好',
      signal: new AbortController().signal,
      settings: { mode: 'chat' },
    })) {
      events.push(event)
    }

    expect(requestSeen?.messages).toHaveLength(1)
    expect(requestSeen?.messages[0]).toMatchObject({
      role: 'user',
      content: '你好',
    })

    expect(events).toContainEqual({ type: 'content_start', blockType: 'text' })
    expect(events).toContainEqual({ type: 'content_delta', text: 'Hello' })
    expect(events).toContainEqual({ type: 'content_delta', text: ' desktop' })
    expect(events.at(-1)).toEqual({
      type: 'message_complete',
      usage: { input_tokens: 7, output_tokens: 3 },
    })

    const persisted = await sessionService.getSessionMessages(sessionId)
    expect(persisted).toHaveLength(2)
    expect(persisted[0]).toMatchObject({ type: 'user', content: '你好' })
    expect(persisted[1]).toMatchObject({
      type: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text: 'Hello desktop' }],
    })
  })

  test('does not inject desktop identity or slash prompt text into chat requests', async () => {
    const { sessionId } = await sessionService.createSession(undefined, 'chat')
    let requestSeen: ChatModelRequest | null = null

    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test-provider',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'test-model',
      auth: { type: 'api-key', value: 'sk-test' },
      createdAt: new Date().toISOString(),
    }

    const providerAdapter = {
      async resolveSnapshot() {
        return snapshot
      },
      async *stream(request: ChatModelRequest) {
        requestSeen = request
        yield { event: 'message_start', data: { message: { usage: { input_tokens: 1 } } } }
        yield { event: 'message_stop', data: {} }
      },
    }

    const engine = new ChatEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
    })

    for await (const _event of engine.sendMessage({
      sessionId,
      content: '/explain 你好',
      signal: new AbortController().signal,
      settings: { mode: 'chat' },
    })) {
      // drain
    }

    expect(requestSeen?.system).toBeUndefined()
    expect(requestSeen?.messages[0]).toMatchObject({
      role: 'user',
      content: '/explain 你好',
    })
  })

  test('routes explicit @ Computer Use chat requests to the desktop control tool', async () => {
    const { sessionId } = await sessionService.createSession(undefined, 'chat')
    let requestSeen: ChatModelRequest | null = null

    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test-provider',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'test-model',
      auth: { type: 'api-key', value: 'sk-test' },
      createdAt: new Date().toISOString(),
    }

    const providerAdapter = {
      async resolveSnapshot() {
        return snapshot
      },
      async *stream(request: ChatModelRequest) {
        requestSeen = request
        yield { event: 'message_start', data: { message: { usage: { input_tokens: 1 } } } }
        yield { event: 'message_stop', data: {} }
      },
    }

    const chatToolRuntime = {
      getDefinitions() {
        return [{
          name: 'request_access',
          description: 'Request desktop access',
          risk: 'read',
          input_schema: {
            type: 'object',
            required: ['apps', 'reason'],
            properties: {
              apps: { type: 'array', items: { type: 'string' } },
              reason: { type: 'string' },
            },
          },
        }]
      },
      getRisk() {
        return 'read'
      },
      async execute() {
        return { content: 'ok' }
      },
    }

    const engine = new ChatEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
      chatToolRuntime: chatToolRuntime as any,
    })

    for await (const _event of engine.sendMessage({
      sessionId,
      content: '@ Computer Use 打开 QQ音乐播放晴天',
      signal: new AbortController().signal,
      settings: { mode: 'chat' },
    })) {
      // drain
    }

    expect(requestSeen?.system).toContain('The user explicitly selected @ Computer Use')
    expect(requestSeen?.system).toContain('complete the requested desktop action')
    expect(requestSeen?.system).toContain('visual action loop')
    expect(requestSeen?.system).toContain('screenshots are the source of truth')
    expect(requestSeen?.system).toContain('Keep the loop fast')
    expect(requestSeen?.tool_choice).toEqual({ type: 'tool', name: 'request_access' })
    expect(requestSeen?.tools?.map((tool) => tool.name)).toEqual(['request_access'])
    expect(requestSeen?.messages[0]).toMatchObject({
      role: 'user',
      content: '@ Computer Use 打开 QQ音乐播放晴天',
    })
  })

  test('returns to auto desktop control after Computer Use access for generic requests', async () => {
    const { sessionId } = await sessionService.createSession(undefined, 'chat')
    const requests: ChatModelRequest[] = []

    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test-provider',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'test-model',
      auth: { type: 'api-key', value: 'sk-test' },
      createdAt: new Date().toISOString(),
    }

    const providerAdapter = {
      async resolveSnapshot() {
        return snapshot
      },
      async *stream(request: ChatModelRequest) {
        requests.push(request)
        yield { event: 'message_start', data: { message: { usage: { input_tokens: 1 } } } }
        if (requests.length === 1) {
          yield {
            event: 'content_block_start',
            data: {
              index: 0,
              content_block: { type: 'tool_use', id: 'toolu_access', name: 'request_access', input: {} },
            },
          }
          yield {
            event: 'content_block_delta',
            data: {
              index: 0,
              delta: {
                type: 'input_json_delta',
                partial_json: '{"apps":["浏览器"],"reason":"打开浏览器预览项目"}',
              },
            },
          }
          yield { event: 'content_block_stop', data: { index: 0 } }
        }
        yield { event: 'message_stop', data: {} }
      },
    }

    const chatToolRuntime = {
      getDefinitions() {
        return [
          {
            name: 'request_access',
            description: 'Request desktop access',
            risk: 'read',
            input_schema: {
              type: 'object',
              required: ['apps', 'reason'],
              properties: {
                apps: { type: 'array', items: { type: 'string' } },
                reason: { type: 'string' },
              },
            },
          },
          {
            name: 'run_desktop_intent',
            description: 'Run a desktop intent',
            risk: 'read',
            input_schema: {
              type: 'object',
              required: ['instruction'],
              properties: { instruction: { type: 'string' } },
            },
          },
        ]
      },
      getRisk() {
        return 'read'
      },
      async execute(toolName: string) {
        return { content: `${toolName} ok` }
      },
    }

    const engine = new ChatEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
      chatToolRuntime: chatToolRuntime as any,
    })

    for await (const _event of engine.sendMessage({
      sessionId,
      content: '@ Computer Use 打开浏览器预览项目',
      signal: new AbortController().signal,
      settings: { mode: 'chat' },
    })) {
      // drain
    }

    expect(requests[0]?.tool_choice).toEqual({ type: 'tool', name: 'request_access' })
    expect(requests[1]?.tool_choice).toEqual({ type: 'auto' })
    expect(requests[1]?.system).toContain('visual action loop')
    expect(requests[1]?.system).toContain('screenshot or observe_desktop')
  })

  test('runs recognized Computer Use music playback without asking the model to choose tools', async () => {
    const { sessionId } = await sessionService.createSession(undefined, 'chat')
    const executed: Array<{ toolName: string; input: unknown }> = []

    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test-provider',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'test-model',
      auth: { type: 'api-key', value: 'sk-test' },
      createdAt: new Date().toISOString(),
    }

    const providerAdapter = {
      async resolveSnapshot() {
        return snapshot
      },
      async *stream() {
        throw new Error('direct Computer Use intent should not call the model')
      },
    }

    const chatToolRuntime = {
      getDefinitions() {
        return [
          {
            name: 'request_access',
            description: 'Request desktop access',
            risk: 'read',
            input_schema: {
              type: 'object',
              required: ['apps', 'reason'],
              properties: {
                apps: { type: 'array', items: { type: 'string' } },
                reason: { type: 'string' },
              },
            },
          },
          {
            name: 'run_desktop_intent',
            description: 'Run a desktop intent',
            risk: 'read',
            input_schema: {
              type: 'object',
              required: ['instruction'],
              properties: { instruction: { type: 'string' } },
            },
          },
        ]
      },
      getRisk() {
        return 'read'
      },
      async execute(toolName: string, input: unknown) {
        executed.push({ toolName, input })
        if (toolName === 'request_access') {
          return { content: '{"granted":[{"bundleId":"QQMusic","displayName":"QQ音乐","tier":"full"}]}' }
        }
        return { content: '{"intent":"play_music","handled":true,"completed":true,"query":"晴天"}' }
      },
      async cleanupSessionTurn() {},
    }

    const engine = new ChatEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
      chatToolRuntime: chatToolRuntime as any,
    })

    const events = []
    for await (const event of engine.sendMessage({
      sessionId,
      content: '@ Computer Use 帮我打开qq 音乐 播放晴天',
      signal: new AbortController().signal,
      settings: { mode: 'chat' },
    })) {
      events.push(event)
    }

    expect(executed.map((call) => call.toolName)).toEqual([
      'request_access',
      'run_desktop_intent',
    ])
    expect(executed[1]?.input).toMatchObject({
      intent: 'play_music',
      app: 'QQ音乐',
      query: '晴天',
    })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_use_complete',
      toolName: 'run_desktop_intent',
    }))
    expect(events).toContainEqual({ type: 'content_delta', text: '已通过QQ音乐播放《晴天》。' })

    const persisted = await sessionService.getSessionMessages(sessionId)
    expect(persisted.map((message) => message.type)).toEqual([
      'user',
      'tool_use',
      'tool_result',
      'tool_use',
      'tool_result',
      'assistant',
    ])
  })

  test('continues Computer Use loop when direct desktop intent is not completed', async () => {
    const { sessionId } = await sessionService.createSession(undefined, 'chat')
    const executed: Array<{ toolName: string; input: unknown }> = []
    const requests: ChatModelRequest[] = []

    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test-provider',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'test-model',
      auth: { type: 'api-key', value: 'sk-test' },
      createdAt: new Date().toISOString(),
    }

    const providerAdapter = {
      async resolveSnapshot() {
        return snapshot
      },
      async *stream(request: ChatModelRequest) {
        requests.push(request)
        yield { event: 'message_start', data: { message: { usage: { input_tokens: 1 } } } }
        yield {
          event: 'content_block_start',
          data: { index: 0, content_block: { type: 'text', text: '' } },
        }
        yield {
          event: 'content_block_delta',
          data: { index: 0, delta: { type: 'text_delta', text: '继续用截图和低层控制完成。' } },
        }
        yield { event: 'content_block_stop', data: { index: 0 } }
        yield { event: 'message_stop', data: {} }
      },
    }

    const chatToolRuntime = {
      getDefinitions() {
        return [
          {
            name: 'request_access',
            description: 'Request desktop access',
            risk: 'read',
            input_schema: {
              type: 'object',
              required: ['apps', 'reason'],
              properties: {
                apps: { type: 'array', items: { type: 'string' } },
                reason: { type: 'string' },
              },
            },
          },
          {
            name: 'run_desktop_intent',
            description: 'Run a desktop intent',
            risk: 'read',
            input_schema: {
              type: 'object',
              required: ['instruction'],
              properties: { instruction: { type: 'string' } },
            },
          },
        ]
      },
      getRisk() {
        return 'read'
      },
      async execute(toolName: string, input: unknown) {
        executed.push({ toolName, input })
        if (toolName === 'request_access') {
          return { content: '{"granted":[{"bundleId":"QQMusic","displayName":"QQ音乐","tier":"full"}]}' }
        }
        return {
          content: '{"intent":"play_music","handled":true,"completed":false,"query":"晴天"}',
          isError: true,
        }
      },
      async cleanupSessionTurn() {},
    }

    const engine = new ChatEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
      chatToolRuntime: chatToolRuntime as any,
    })

    const events = []
    for await (const event of engine.sendMessage({
      sessionId,
      content: '@ Computer Use 帮我打开qq 音乐 播放晴天',
      signal: new AbortController().signal,
      settings: { mode: 'chat' },
    })) {
      events.push(event)
    }

    expect(executed.map((call) => call.toolName)).toEqual([
      'request_access',
      'run_desktop_intent',
    ])
    expect(requests).toHaveLength(1)
    expect(requests[0]?.tool_choice).toEqual({ type: 'auto' })
    const lastMessage = requests[0]?.messages.at(-1)
    const lastBlock = Array.isArray(lastMessage?.content) ? lastMessage.content[0] : null
    expect(lastBlock).toMatchObject({
      type: 'tool_result',
      is_error: true,
    })
    expect((lastBlock as { content?: string } | null)?.content).toContain('"completed":false')
    expect(events).toContainEqual({ type: 'content_delta', text: '继续用截图和低层控制完成。' })
  })

  test('allows longer Computer Use action chains in chat mode', async () => {
    const { sessionId } = await sessionService.createSession(undefined, 'chat')
    const requests: ChatModelRequest[] = []

    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test-provider',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'test-model',
      auth: { type: 'api-key', value: 'sk-test' },
      createdAt: new Date().toISOString(),
    }

    const providerAdapter = {
      async resolveSnapshot() {
        return snapshot
      },
      async *stream(request: ChatModelRequest) {
        requests.push(request)
        const turn = requests.length
        yield { event: 'message_start', data: { message: { usage: { input_tokens: turn } } } }

        if (turn <= 7) {
          const name = turn === 1 ? 'request_access' : 'key'
          yield {
            event: 'content_block_start',
            data: {
              index: 0,
              content_block: { type: 'tool_use', id: `toolu_${turn}`, name, input: {} },
            },
          }
          const input = turn === 1
            ? '{"apps":["QQ音乐"],"reason":"打开 QQ 音乐并播放用户指定的歌曲"}'
            : '{"text":"return"}'
          yield {
            event: 'content_block_delta',
            data: { index: 0, delta: { type: 'input_json_delta', partial_json: input } },
          }
          yield { event: 'content_block_stop', data: { index: 0 } }
          yield { event: 'message_stop', data: {} }
          return
        }

        yield { event: 'content_block_start', data: { index: 0, content_block: { type: 'text', text: '' } } }
        yield {
          event: 'content_block_delta',
          data: { index: 0, delta: { type: 'text_delta', text: '已开始播放。' } },
        }
        yield { event: 'content_block_stop', data: { index: 0 } }
        yield { event: 'message_stop', data: {} }
      },
    }

    const chatToolRuntime = {
      getDefinitions() {
        return [
          {
            name: 'request_access',
            description: 'Request desktop access',
            risk: 'read',
            input_schema: {
              type: 'object',
              required: ['apps', 'reason'],
              properties: {
                apps: { type: 'array', items: { type: 'string' } },
                reason: { type: 'string' },
              },
            },
          },
          {
            name: 'key',
            description: 'Press key',
            risk: 'read',
            input_schema: {
              type: 'object',
              required: ['text'],
              properties: { text: { type: 'string' } },
            },
          },
        ]
      },
      getRisk() {
        return 'read'
      },
      async execute(toolName: string) {
        return { content: `${toolName} ok` }
      },
    }

    const engine = new ChatEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
      chatToolRuntime: chatToolRuntime as any,
    })

    const events = []
    for await (const event of engine.sendMessage({
      sessionId,
      content: '@ Computer Use 打开 QQ音乐播放晴天',
      signal: new AbortController().signal,
      settings: { mode: 'chat' },
    })) {
      events.push(event)
    }

    expect(requests).toHaveLength(8)
    expect(events).not.toContainEqual(expect.objectContaining({
      type: 'error',
      code: 'TOOL_LOOP_LIMIT',
    }))
    expect(events).toContainEqual({ type: 'content_delta', text: '已开始播放。' })
    expect(events.at(-1)).toEqual({
      type: 'message_complete',
      usage: { input_tokens: 8, output_tokens: 0 },
    })
  })

  test('exposes chat and Computer Use tools without project filesystem tools', async () => {
    const { sessionId } = await sessionService.createSession(undefined, 'chat')
    let requestSeen: ChatModelRequest | null = null

    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test-provider',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'test-model',
      auth: { type: 'api-key', value: 'sk-test' },
      createdAt: new Date().toISOString(),
    }

    const providerAdapter = {
      async resolveSnapshot() {
        return snapshot
      },
      async *stream(request: ChatModelRequest) {
        requestSeen = request
        yield { event: 'message_start', data: { message: { usage: { input_tokens: 1 } } } }
        yield { event: 'message_stop', data: {} }
      },
    }

    const engine = new ChatEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
    })

    for await (const _event of engine.sendMessage({
      sessionId,
      content: '今天上海天气怎么样？',
      signal: new AbortController().signal,
      settings: { mode: 'chat' },
    })) {
      // drain
    }

    const names = requestSeen?.tools?.map((tool) => tool.name).sort()
    expect(names).toEqual(expect.arrayContaining([
      'calculate',
      'get_current_time',
      'get_weather',
      'request_access',
      'screenshot',
      'type',
      'web_fetch',
      'web_search',
    ]))
    expect(requestSeen?.tool_choice).toEqual({ type: 'auto' })
    expect(names).not.toContain('read_file')
    expect(names).not.toContain('write_file')
    expect(names).not.toContain('edit_file')
    expect(names).not.toContain('apply_patch')
    expect(names).not.toContain('run_command')
  })

  test('keeps input code and attached text files as user-visible chat content', async () => {
    const { sessionId } = await sessionService.createSession(undefined, 'chat')
    let requestSeen: ChatModelRequest | null = null

    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test-provider',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'test-model',
      auth: { type: 'api-key', value: 'sk-test' },
      createdAt: new Date().toISOString(),
    }

    const providerAdapter = {
      async resolveSnapshot() {
        return snapshot
      },
      async *stream(request: ChatModelRequest) {
        requestSeen = request
        yield { event: 'message_start', data: { message: { usage: { input_tokens: 1 } } } }
        yield { event: 'message_stop', data: {} }
      },
    }

    const engine = new ChatEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
    })

    const pastedCode = '  function add(a: number, b: number) {\n    return a + b\n  }\n'
    const attachedCode = 'export const answer = 42\n'

    for await (const _event of engine.sendMessage({
      sessionId,
      content: pastedCode,
      attachments: [{
        type: 'file',
        name: 'answer.ts',
        mimeType: 'text/typescript',
        data: `data:text/plain;base64,${Buffer.from(attachedCode, 'utf-8').toString('base64')}`,
      }],
      signal: new AbortController().signal,
      settings: { mode: 'chat' },
    })) {
      // drain
    }

    const content = requestSeen?.messages[0]?.content
    expect(Array.isArray(content)).toBe(true)
    expect(content).toEqual([
      { type: 'text', text: pastedCode },
      {
        type: 'text',
        text: expect.stringContaining('Attached file: answer.ts'),
      },
    ])
    expect((content as Array<{ text?: string }>)[1]?.text).toContain('```ts')
    expect((content as Array<{ text?: string }>)[1]?.text).toContain(attachedCode)

    const persisted = await sessionService.getSessionMessages(sessionId)
    expect(persisted[0]?.content).toEqual(content)
  })

  test('runs chat tools and persists visible tool call history', async () => {
    const { sessionId } = await sessionService.createSession(undefined, 'chat')
    const requests: ChatModelRequest[] = []

    const snapshot: RuntimeProviderSnapshot = {
      providerId: 'test-provider',
      providerName: 'Test Provider',
      apiFormat: 'anthropic',
      baseUrl: 'https://example.invalid',
      model: 'test-model',
      auth: { type: 'api-key', value: 'sk-test' },
      createdAt: new Date().toISOString(),
    }

    const providerAdapter = {
      async resolveSnapshot() {
        return snapshot
      },
      async *stream(request: ChatModelRequest) {
        requests.push(request)

        if (requests.length === 1) {
          yield { event: 'message_start', data: { message: { usage: { input_tokens: 4 } } } }
          yield {
            event: 'content_block_start',
            data: {
              index: 0,
              content_block: { type: 'tool_use', id: 'toolu_weather', name: 'get_weather', input: {} },
            },
          }
          yield {
            event: 'content_block_delta',
            data: { index: 0, delta: { type: 'input_json_delta', partial_json: '{"location":"Shanghai"}' } },
          }
          yield { event: 'content_block_stop', data: { index: 0 } }
          yield { event: 'message_stop', data: {} }
          return
        }

        yield { event: 'message_start', data: { message: { usage: { output_tokens: 8 } } } }
        yield { event: 'content_block_start', data: { index: 0, content_block: { type: 'text', text: '' } } }
        yield {
          event: 'content_block_delta',
          data: { index: 0, delta: { type: 'text_delta', text: '上海现在晴，25°C。' } },
        }
        yield { event: 'content_block_stop', data: { index: 0 } }
        yield { event: 'message_stop', data: {} }
      },
    }

    const chatToolRuntime = {
      getDefinitions() {
        return [{
          name: 'get_weather',
          description: 'Get weather',
          risk: 'read',
          input_schema: {
            type: 'object',
            required: ['location'],
            properties: { location: { type: 'string' } },
          },
        }]
      },
      getRisk(toolName: string) {
        return toolName === 'get_weather' ? 'read' : null
      },
      async execute(toolName: string, input: unknown) {
        expect(toolName).toBe('get_weather')
        expect(input).toEqual({ location: 'Shanghai' })
        return {
          content: 'Location: Shanghai\nWeather: Clear sky\nTemperature: 25 °C',
          metadata: { summary: 'Shanghai: 25 °C' },
        }
      },
    }

    const engine = new ChatEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
      chatToolRuntime: chatToolRuntime as any,
    })

    const events = []
    for await (const event of engine.sendMessage({
      sessionId,
      content: '帮我查一下上海天气',
      signal: new AbortController().signal,
      settings: { mode: 'chat' },
    })) {
      events.push(event)
    }

    expect(requests).toHaveLength(2)
    expect(requests[0]!.tools).toContainEqual(
      expect.objectContaining({ name: 'get_weather' }),
    )
    expect(requests[1]!.messages.at(-2)).toMatchObject({
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: 'toolu_weather',
        name: 'get_weather',
        input: { location: 'Shanghai' },
      }],
    })
    expect(requests[1]!.messages.at(-1)).toMatchObject({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'toolu_weather',
        content: expect.stringContaining('Temperature'),
      }],
    })

    expect(events).toContainEqual({
      type: 'content_start',
      blockType: 'tool_use',
      toolName: 'get_weather',
      toolUseId: 'toolu_weather',
    })
    expect(events).toContainEqual({
      type: 'tool_use_complete',
      toolName: 'get_weather',
      toolUseId: 'toolu_weather',
      input: { location: 'Shanghai' },
    })
    expect(events).toContainEqual({
      type: 'tool_result',
      toolUseId: 'toolu_weather',
      content: expect.stringContaining('Temperature'),
      isError: false,
      metadata: expect.objectContaining({ summary: 'Shanghai: 25 °C' }),
    })

    const persisted = await sessionService.getSessionMessages(sessionId)
    expect(persisted.map((message) => message.type)).toEqual([
      'user',
      'tool_use',
      'tool_result',
      'assistant',
    ])
  })
})
