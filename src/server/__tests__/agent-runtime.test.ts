import { describe, expect, test } from 'bun:test'
import { AgentRuntime } from '../runtime/AgentRuntime.js'
import type { ChatModelRequest, RuntimeProviderSnapshot } from '../runtime/types.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from '../runtime/ToolRuntime.js'

const snapshot: RuntimeProviderSnapshot = {
  providerId: 'test-provider',
  providerName: 'Test Provider',
  apiFormat: 'anthropic',
  baseUrl: 'https://example.invalid',
  model: 'test-model',
  auth: { type: 'api-key', value: 'sk-test' },
  createdAt: new Date().toISOString(),
}

describe('AgentRuntime', () => {
  test('runs a desktop-native subagent with isolated provider turns and allowed tools', async () => {
    const requests: ChatModelRequest[] = []
    const executedTools: Array<{ name: string; input: unknown; context: ToolExecutionContext }> = []
    const providerAdapter = {
      async resolveSnapshot() {
        return snapshot
      },
      async *stream(request: ChatModelRequest) {
        requests.push(request)
        if (requests.length === 1) {
          yield {
            event: 'content_block_start',
            data: {
              index: 0,
              content_block: {
                type: 'tool_use',
                id: 'toolu_agent_read_1',
                name: 'read_file',
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
                partial_json: '{"file_path":"README.md"}',
              },
            },
          }
          yield { event: 'content_block_stop', data: { index: 0 } }
          yield { event: 'message_stop', data: {} }
          return
        }

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
              text: 'README confirms the desktop subagent runtime.',
            },
          },
        }
        yield { event: 'content_block_stop', data: { index: 0 } }
        yield { event: 'message_stop', data: {} }
      },
    }
    const readFileTool: ToolDefinition = {
      name: 'read_file',
      description: 'Read a project file.',
      risk: 'read',
      input_schema: { type: 'object' },
    }
    const recursiveAgentTool: ToolDefinition = {
      name: 'agent',
      description: 'Recursive agent should not be exposed.',
      risk: 'write',
      input_schema: { type: 'object' },
    }
    const writeTool: ToolDefinition = {
      name: 'apply_patch',
      description: 'Patch files.',
      risk: 'write',
      input_schema: { type: 'object' },
    }
    const toolHost = {
      getDefinitions() {
        return [readFileTool, recursiveAgentTool, writeTool]
      },
      async execute(
        name: string,
        input: unknown,
        context: ToolExecutionContext,
      ): Promise<ToolExecutionResult> {
        executedTools.push({ name, input, context })
        return {
          content: 'README.md says native desktop agents are enabled.',
          metadata: { summary: 'file read' },
        }
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

    const runtime = new AgentRuntime({
      providerAdapter: providerAdapter as any,
      agentService: agentService as any,
      toolHost,
    })
    const result = await runtime.run({
      prompt: 'Inspect the README.',
      subagent_type: 'explorer',
    }, {
      sessionId: 'session-1',
      workDir: 'D:/project',
      signal: new AbortController().signal,
    })

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Agent explorer completed.')
    expect(result.content).toContain('README confirms the desktop subagent runtime.')
    expect(result.metadata).toMatchObject({
      summary: 'explorer completed',
      matches: 1,
    })
    expect(requests).toHaveLength(2)
    expect(requests[0].system).toContain('independent subagent')
    expect(requests[0].tools?.map((tool) => tool.name)).toEqual(['read_file'])
    expect(requests[1].messages.at(-1)).toMatchObject({
      role: 'user',
      content: [
        expect.objectContaining({
          type: 'tool_result',
          tool_use_id: 'toolu_agent_read_1',
        }),
      ],
    })
    expect(executedTools).toHaveLength(1)
    expect(executedTools[0]).toMatchObject({
      name: 'read_file',
      input: { file_path: 'README.md' },
      context: {
        sessionId: 'session-1:agent',
        workDir: 'D:/project',
      },
    })
  })

  test('reports available agents when the requested subagent does not exist', async () => {
    const runtime = new AgentRuntime({
      providerAdapter: {
        async resolveSnapshot() {
          throw new Error('should not resolve provider for missing agents')
        },
        async *stream() {
          throw new Error('should not stream for missing agents')
        },
      } as any,
      agentService: {
        async getAgent() {
          return null
        },
        async listStoredAgents() {
          return [{ name: 'custom-helper' }]
        },
      } as any,
      toolHost: {
        getDefinitions() {
          return []
        },
        async execute() {
          return { content: 'unused' }
        },
      },
    })

    const result = await runtime.run({
      prompt: 'Do work.',
      subagent_type: 'does-not-exist',
    }, {
      sessionId: 'session-1',
      workDir: 'D:/project',
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Agent type "does-not-exist" not found.')
    expect(result.content).toContain('custom-helper')
    expect(result.content).toContain('worker')
  })
})
