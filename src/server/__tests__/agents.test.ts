import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { handleAgentsApi } from '../api/agents.js'

let tmpDir: string
let originalYcodeConfigDir: string | undefined
let originalClaudeConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-test-'))
  originalYcodeConfigDir = process.env.YCODE_CONFIG_DIR
  originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.YCODE_CONFIG_DIR = tmpDir
  delete process.env.CLAUDE_CONFIG_DIR
})

afterEach(async () => {
  if (originalYcodeConfigDir === undefined) {
    delete process.env.YCODE_CONFIG_DIR
  } else {
    process.env.YCODE_CONFIG_DIR = originalYcodeConfigDir
  }

  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  }

  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('Agents API', () => {
  test('includes Ycode built-in agents by default', async () => {
    const response = await request('GET', '/api/agents')
    const body = await response.json() as AgentListBody

    expect(response.status).toBe(200)
    expect(body.activeAgents.some((agent) => agent.agentType === 'explorer')).toBe(true)
    expect(body.activeAgents.some((agent) => agent.source === 'built-in')).toBe(true)
    expect(body.allAgents.length).toBeGreaterThanOrEqual(8)
  })

  test('lets user agents override built-in agents with the same name', async () => {
    const created = await request('POST', '/api/agents', {
      name: 'explorer',
      description: 'Custom local explorer',
      tools: ['Read'],
    })
    expect(created.status).toBe(201)

    const response = await request('GET', '/api/agents')
    const body = await response.json() as AgentListBody
    const activeExplorer = body.activeAgents.find((agent) => agent.agentType === 'explorer')
    const builtInExplorer = body.allAgents.find(
      (agent) => agent.agentType === 'explorer' && agent.source === 'built-in',
    )

    expect(activeExplorer?.source).toBe('userSettings')
    expect(activeExplorer?.description).toBe('Custom local explorer')
    expect(builtInExplorer?.isActive).toBe(false)
    expect(builtInExplorer?.overriddenBy).toBe('userSettings')

    const detail = await request('GET', '/api/agents/explorer')
    const detailBody = await detail.json() as { agent: { description?: string } }
    expect(detailBody.agent.description).toBe('Custom local explorer')
  })

  test('lets project agents override user and built-in agents for the selected cwd', async () => {
    const projectDir = path.join(tmpDir, 'project')
    const projectAgentsDir = path.join(projectDir, '.ycode', 'agents')
    await fs.mkdir(projectAgentsDir, { recursive: true })
    await fs.writeFile(
      path.join(projectAgentsDir, 'explorer.yaml'),
      [
        'name: explorer',
        'description: Project local explorer',
        'tools:',
        '  - read_file',
        '',
      ].join('\n'),
      'utf-8',
    )

    const created = await request('POST', '/api/agents', {
      name: 'explorer',
      description: 'User local explorer',
      tools: ['read_file'],
    })
    expect(created.status).toBe(201)

    const response = await request(
      'GET',
      `/api/agents?cwd=${encodeURIComponent(projectDir)}`,
    )
    const body = await response.json() as AgentListBody
    const activeExplorer = body.activeAgents.find((agent) => agent.agentType === 'explorer')
    const userExplorer = body.allAgents.find(
      (agent) => agent.agentType === 'explorer' && agent.source === 'userSettings',
    )
    const builtInExplorer = body.allAgents.find(
      (agent) => agent.agentType === 'explorer' && agent.source === 'built-in',
    )

    expect(activeExplorer?.source).toBe('projectSettings')
    expect(activeExplorer?.description).toBe('Project local explorer')
    expect(userExplorer?.isActive).toBe(false)
    expect(userExplorer?.overriddenBy).toBe('projectSettings')
    expect(builtInExplorer?.isActive).toBe(false)
    expect(builtInExplorer?.overriddenBy).toBe('projectSettings')

    const detail = await request(
      'GET',
      `/api/agents/explorer?cwd=${encodeURIComponent(projectDir)}`,
    )
    const detailBody = await detail.json() as { agent: { description?: string } }
    expect(detailBody.agent.description).toBe('Project local explorer')
  })
})

async function request(
  method: string,
  pathName: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const url = new URL(pathName, 'http://localhost')
  return handleAgentsApi(
    new Request(url, {
      method,
      ...(body
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    }),
    url,
    url.pathname.split('/').filter(Boolean),
  )
}

type AgentListBody = {
  activeAgents: AgentBody[]
  allAgents: AgentBody[]
}

type AgentBody = {
  agentType: string
  description?: string
  source: string
  isActive: boolean
  overriddenBy?: string
}
