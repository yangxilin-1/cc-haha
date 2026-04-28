import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { CodeEngine } from '../runtime/CodeEngine.js'
import { ToolRuntime } from '../runtime/ToolRuntime.js'
import { SessionService } from '../services/sessionService.js'
import type { ChatModelRequest, RuntimeProviderSnapshot } from '../runtime/types.js'

describe('CodeEngine', () => {
  let tmpDir: string
  let originalYcodeDataDir: string | undefined
  let sessionService: SessionService

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ycode-code-engine-'))
    originalYcodeDataDir = process.env.YCODE_DATA_DIR
    process.env.YCODE_DATA_DIR = path.join(tmpDir, 'data')
    sessionService = new SessionService()
  })

  afterEach(async () => {
    if (originalYcodeDataDir === undefined) delete process.env.YCODE_DATA_DIR
    else process.env.YCODE_DATA_DIR = originalYcodeDataDir

    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('runs a native read_file tool loop and persists transcript entries', async () => {
    const workDir = path.join(tmpDir, 'project')
    await fs.mkdir(workDir, { recursive: true })
    await fs.writeFile(path.join(workDir, 'README.md'), '# Hello\nNative desktop runtime\n')
    const { sessionId } = await sessionService.createSession(workDir, 'code')

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
          yield { event: 'message_start', data: { message: { usage: { input_tokens: 10 } } } }
          yield {
            event: 'content_block_start',
            data: {
              index: 0,
              content_block: { type: 'tool_use', id: 'toolu_read_1', name: 'read_file', input: {} },
            },
          }
          yield {
            event: 'content_block_delta',
            data: { index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":"README.md"}' } },
          }
          yield { event: 'content_block_stop', data: { index: 0 } }
          yield { event: 'message_delta', data: { usage: { output_tokens: 3 } } }
          yield { event: 'message_stop', data: {} }
          return
        }

        yield { event: 'message_start', data: { message: { usage: { input_tokens: 20 } } } }
        yield { event: 'content_block_start', data: { index: 0, content_block: { type: 'text', text: '' } } }
        yield {
          event: 'content_block_delta',
          data: { index: 0, delta: { type: 'text_delta', text: 'README confirms the native desktop runtime.' } },
        }
        yield { event: 'content_block_stop', data: { index: 0 } }
        yield { event: 'message_delta', data: { usage: { output_tokens: 8 } } }
        yield { event: 'message_stop', data: {} }
      },
    }

    const engine = new CodeEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
    })

    const events = []
    for await (const event of engine.sendMessage({
      sessionId,
      content: 'Read the README',
      signal: new AbortController().signal,
      settings: { mode: 'code' },
    })) {
      events.push(event)
    }

    expect(requests).toHaveLength(2)
    expect(requests[0].system).toBeUndefined()
    expect(requests[0].messages[0]).toMatchObject({
      role: 'user',
      content: 'Read the README',
    })
    expect(requests[0].tools?.map((tool) => tool.name)).toContain('read_file')
    expect(requests[0].tools?.map((tool) => tool.name)).toContain('apply_patch')
    expect(requests[0].tools?.map((tool) => tool.name)).toContain('agent')
    expect(requests[1].messages.at(-1)).toMatchObject({
      role: 'user',
      content: [
        expect.objectContaining({
          type: 'tool_result',
          tool_use_id: 'toolu_read_1',
        }),
      ],
    })
    expect(
      ((requests[1].messages.at(-1)?.content as Array<Record<string, unknown>>)[0] as Record<string, unknown>).metadata,
    ).toBeUndefined()

    expect(events).toContainEqual({
      type: 'tool_use_complete',
      toolName: 'read_file',
      toolUseId: 'toolu_read_1',
      input: { file_path: 'README.md' },
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_result',
        toolUseId: 'toolu_read_1',
        isError: false,
        metadata: expect.objectContaining({
          filePath: 'README.md',
          summary: expect.stringContaining('lines read'),
        }),
      }),
    )
    expect(events.at(-1)).toEqual({
      type: 'message_complete',
      usage: { input_tokens: 20, output_tokens: 8 },
    })

    const persisted = await sessionService.getSessionMessages(sessionId)
    expect(persisted.map((message) => message.type)).toEqual([
      'user',
      'tool_use',
      'tool_result',
      'assistant',
    ])
    expect(persisted[2]!.content).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        tool_use_id: 'toolu_read_1',
        metadata: expect.objectContaining({
          filePath: 'README.md',
        }),
      }),
    ])
  })

  test('routes explicit @ Computer Use code requests to the desktop control tool', async () => {
    const workDir = path.join(tmpDir, 'project')
    await fs.mkdir(workDir, { recursive: true })
    const { sessionId } = await sessionService.createSession(workDir, 'code')

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

    const toolRuntime = {
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

    const engine = new CodeEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
      toolRuntime: toolRuntime as any,
    })

    for await (const _event of engine.sendMessage({
      sessionId,
      content: '@ Computer Use 打开浏览器预览项目',
      signal: new AbortController().signal,
      settings: { mode: 'code' },
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
      content: '@ Computer Use 打开浏览器预览项目',
    })
  })

  test('executes the desktop-native agent tool without the CLI agent runtime', async () => {
    const workDir = path.join(tmpDir, 'project')
    await fs.mkdir(workDir, { recursive: true })
    const { sessionId } = await sessionService.createSession(workDir, 'code')

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
          yield { event: 'message_start', data: { message: { usage: { input_tokens: 5 } } } }
          yield {
            event: 'content_block_start',
            data: {
              index: 0,
              content_block: {
                type: 'tool_use',
                id: 'toolu_agent_1',
                name: 'agent',
                input: {},
              },
            },
          }
          yield {
            event: 'content_block_delta',
            data: {
              index: 0,
              delta: {
                type: 'input_json_delta',
                partial_json: JSON.stringify({
                  prompt: 'Inspect the project at a high level.',
                  subagent_type: 'explorer',
                  description: 'Inspect project',
                }),
              },
            },
          }
          yield { event: 'content_block_stop', data: { index: 0 } }
          yield { event: 'message_delta', data: { usage: { output_tokens: 2 } } }
          yield { event: 'message_stop', data: {} }
          return
        }

        if (requests.length === 2) {
          yield {
            event: 'content_block_start',
            data: { index: 0, content_block: { type: 'text', text: '' } },
          }
          yield {
            event: 'content_block_delta',
            data: {
              index: 0,
              delta: {
                type: 'text_delta',
                text: 'This result came from the independent desktop subagent.',
              },
            },
          }
          yield { event: 'content_block_stop', data: { index: 0 } }
          yield { event: 'message_stop', data: {} }
          return
        }

        yield { event: 'message_start', data: { message: { usage: { input_tokens: 12 } } } }
        yield {
          event: 'content_block_start',
          data: { index: 0, content_block: { type: 'text', text: '' } },
        }
        yield {
          event: 'content_block_delta',
          data: {
            index: 0,
            delta: {
              type: 'text_delta',
              text: 'The explorer subagent completed successfully.',
            },
          },
        }
        yield { event: 'content_block_stop', data: { index: 0 } }
        yield { event: 'message_delta', data: { usage: { output_tokens: 6 } } }
        yield { event: 'message_stop', data: {} }
      },
    }
    const agentService = {
      async getAgent() {
        return null
      },
      async listStoredAgents() {
        return []
      },
    }
    const toolRuntime = new ToolRuntime({
      providerAdapter: providerAdapter as any,
      agentService: agentService as any,
    })
    const engine = new CodeEngine({
      providerAdapter: providerAdapter as any,
      sessionStore: sessionService as any,
      toolRuntime,
    })

    const events = []
    for await (const event of engine.sendMessage({
      sessionId,
      content: 'Use an explorer agent to inspect this project',
      signal: new AbortController().signal,
      settings: { mode: 'code', permissionMode: 'acceptEdits' },
    })) {
      events.push(event)
    }

    expect(requests).toHaveLength(3)
    expect(requests[0].tools?.map((tool) => tool.name)).toContain('agent')
    expect(requests[1].system).toContain('independent subagent')
    expect(requests[1].tools?.map((tool) => tool.name)).not.toContain('agent')
    expect(events).toContainEqual({
      type: 'tool_use_complete',
      toolName: 'agent',
      toolUseId: 'toolu_agent_1',
      input: {
        prompt: 'Inspect the project at a high level.',
        subagent_type: 'explorer',
        description: 'Inspect project',
      },
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'tool_result',
        toolUseId: 'toolu_agent_1',
        isError: false,
        content: expect.stringContaining('Agent explorer completed.'),
      }),
    )
    expect(events.at(-1)).toEqual({
      type: 'message_complete',
      usage: { input_tokens: 12, output_tokens: 6 },
    })
  })
})
