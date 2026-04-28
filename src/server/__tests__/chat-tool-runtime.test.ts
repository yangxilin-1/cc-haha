import { describe, expect, test } from 'bun:test'
import { ChatToolRuntime } from '../runtime/ChatToolRuntime.js'

describe('ChatToolRuntime', () => {
  test('registers conversation and Computer Use tools without project filesystem access', () => {
    const runtime = new ChatToolRuntime()
    const definitions = runtime.getDefinitions()
    const names = definitions.map((tool) => tool.name).sort()

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
    expect(names).not.toContain('read_file')
    expect(names).not.toContain('write_file')
    expect(names).not.toContain('apply_patch')
    expect(names).not.toContain('run_command')
    expect(runtime.getRisk('get_weather')).toBe('external')
    expect(runtime.getRisk('web_search')).toBe('external')
    expect(runtime.getRisk('calculate')).toBe('read')
    expect(runtime.getRisk('request_access')).toBe('read')
  })

  test('evaluates arithmetic without shell access', async () => {
    const runtime = new ChatToolRuntime()
    const result = await runtime.execute(
      'calculate',
      { expression: '(2 + 3) ^ 2 + 4 / 2' },
      {
        sessionId: 'chat-session',
        signal: new AbortController().signal,
      },
    )

    expect(result.isError).toBeUndefined()
    expect(result.content).toBe('(2 + 3) ^ 2 + 4 / 2 = 27')
    expect(result.metadata).toMatchObject({
      summary: '27',
    })
    expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('reports invalid arithmetic as a tool error', async () => {
    const runtime = new ChatToolRuntime()
    const result = await runtime.execute(
      'calculate',
      { expression: '2 + process.exit()' },
      {
        sessionId: 'chat-session',
        signal: new AbortController().signal,
      },
    )

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Unsupported character')
  })
})
