/**
 * Agents REST API
 *
 * GET    /api/agents        — 获取 Agent 列表
 * GET    /api/agents/:name  — 获取 Agent 详情
 * POST   /api/agents        — 创建 Agent
 * PUT    /api/agents/:name  — 更新 Agent
 * DELETE /api/agents/:name  — 删除 Agent
 *
 * GET    /api/tasks         — 获取后台任务列表
 * GET    /api/tasks/:id     — 获取任务详情
 */

import { AgentService } from '../services/agentService.js'
import { taskService } from '../services/taskService.js'
import {
  BUILT_IN_AGENTS,
  getBuiltInAgent,
  normalizeAgentName,
} from '../config/builtInAgents.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import type {
  AgentDefinition,
  AgentSource,
  StoredAgentDefinition,
} from '../services/agentService.js'

const agentService = new AgentService()

export async function handleAgentsApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const resource = segments[1] // 'agents' | 'tasks'

    if (resource === 'tasks') {
      return await handleTasksApi(req, segments)
    }

    return await handleAgents(req, url, segments)
  } catch (error) {
    return errorResponse(error)
  }
}

// ─── Agent CRUD ─────────────────────────────────────────────────────────────

async function handleAgents(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  const method = req.method
  const agentName = segments[2] ? decodeURIComponent(segments[2]) : undefined
  const cwd = url.searchParams.get('cwd') || undefined

  // ── GET /api/agents ──────────────────────────────────────────────────
  if (method === 'GET' && !agentName) {
    const storedAgents = await agentService.listStoredAgents(cwd)
    const overrideByName = new Map<string, AgentSource>()
    for (const agent of storedAgents) {
      overrideByName.set(normalizeAgentName(agent.name), agent.source)
    }

    const storedSerialized = storedAgents.map((agent) => {
      const normalized = normalizeAgentName(agent.name)
      const overriddenBy = agent.source === 'userSettings' && overrideByName.get(normalized) === 'projectSettings'
        ? 'projectSettings'
        : undefined
      return serializeAgent(agent, {
        source: agent.source,
        isActive: !overriddenBy,
        baseDir: agent.baseDir,
        overriddenBy,
      })
    })
    const builtInSerialized = BUILT_IN_AGENTS.map((agent) => {
      const overriddenBy = overrideByName.get(normalizeAgentName(agent.name))
      return serializeAgent(agent, {
        source: 'built-in',
        isActive: !overriddenBy,
        baseDir: 'Ycode built-in',
        overriddenBy,
      })
    })

    return Response.json({
      activeAgents: [...storedSerialized, ...builtInSerialized]
        .filter((agent) => agent.isActive),
      allAgents: [...storedSerialized, ...builtInSerialized],
    })
  }

  // ── GET /api/agents/:name ────────────────────────────────────────────
  if (method === 'GET' && agentName) {
    const agent = await agentService.getAgent(agentName, cwd) ?? getBuiltInAgent(agentName)
    if (!agent) {
      throw ApiError.notFound(`Agent not found: ${agentName}`)
    }
    return Response.json({ agent })
  }

  // ── POST /api/agents ─────────────────────────────────────────────────
  if (method === 'POST' && !agentName) {
    const body = await parseJsonBody(req)
    if (!body.name || typeof body.name !== 'string') {
      throw ApiError.badRequest('Missing or invalid "name" in request body')
    }
    await agentService.createAgent({
      name: body.name as string,
      description: body.description as string | undefined,
      model: body.model as string | undefined,
      tools: body.tools as string[] | undefined,
      systemPrompt: body.systemPrompt as string | undefined,
      color: body.color as string | undefined,
      maxTurns: typeof body.maxTurns === 'number' ? body.maxTurns : undefined,
    })
    return Response.json({ ok: true }, { status: 201 })
  }

  // ── PUT /api/agents/:name ────────────────────────────────────────────
  if (method === 'PUT' && agentName) {
    const body = await parseJsonBody(req)
    await agentService.updateAgent(agentName, body as Record<string, unknown>)
    const updated = await agentService.getAgent(agentName)
    return Response.json({ agent: updated })
  }

  // ── DELETE /api/agents/:name ─────────────────────────────────────────
  if (method === 'DELETE' && agentName) {
    await agentService.deleteAgent(agentName)
    return Response.json({ ok: true })
  }

  throw new ApiError(
    405,
    `Method ${method} not allowed on /api/agents${agentName ? `/${agentName}` : ''}`,
    'METHOD_NOT_ALLOWED',
  )
}

// ─── Tasks API ─────────────────────────────────────────────────────────────
//
// GET /api/tasks                         → list all tasks (across all task lists)
// GET /api/tasks/lists                   → list all task lists with summaries
// GET /api/tasks/lists/:taskListId       → get all tasks for a specific task list
// GET /api/tasks/lists/:taskListId/:id   → get a single task
// POST /api/tasks/lists/:taskListId/reset → clear a completed task list

async function handleTasksApi(
  req: Request,
  segments: string[],
): Promise<Response> {
  const sub = segments[2] // 'lists' or undefined

  if (sub === 'lists') {
    const taskListId = segments[3]
    const taskId = segments[4]

    if (req.method === 'POST' && taskListId && taskId === 'reset') {
      await taskService.resetTaskList(taskListId)
      return Response.json({ ok: true })
    }

    if (req.method !== 'GET') {
      throw new ApiError(
        405,
        `Method ${req.method} not allowed on /api/tasks/lists`,
        'METHOD_NOT_ALLOWED',
      )
    }

    if (taskListId && taskId) {
      // GET /api/tasks/lists/:taskListId/:taskId
      const task = await taskService.getTask(taskListId, taskId)
      if (!task) throw ApiError.notFound(`Task not found: ${taskListId}/${taskId}`)
      return Response.json({ task })
    }

    if (taskListId) {
      // GET /api/tasks/lists/:taskListId
      const tasks = await taskService.getTasksForList(taskListId)
      return Response.json({ tasks })
    }

    // GET /api/tasks/lists
    const lists = await taskService.listTaskLists()
    return Response.json({ lists })
  }

  if (req.method !== 'GET') {
    throw new ApiError(
      405,
      `Method ${req.method} not allowed on /api/tasks`,
      'METHOD_NOT_ALLOWED',
    )
  }

  // GET /api/tasks — list all tasks
  const tasks = await taskService.listTasks()
  return Response.json({ tasks })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

type ApiAgentDefinition = {
  agentType: string
  description?: string
  model?: string
  modelDisplay?: string
  tools?: string[]
  systemPrompt?: string
  color?: string
  source: AgentSource | 'built-in'
  baseDir?: string
  isActive: boolean
  overriddenBy?: AgentSource
}

type SerializeAgentOptions = {
  source: ApiAgentDefinition['source']
  isActive: boolean
  baseDir?: string
  overriddenBy?: ApiAgentDefinition['overriddenBy']
}

function serializeAgent(
  agent: AgentDefinition,
  options: SerializeAgentOptions,
): ApiAgentDefinition {
  return {
    agentType: agent.name,
    description: agent.description,
    model: agent.model,
    modelDisplay: agent.model || undefined,
    tools: agent.tools,
    systemPrompt: agent.systemPrompt,
    color: agent.color,
    source: options.source,
    baseDir: options.baseDir,
    isActive: options.isActive,
    overriddenBy: options.overriddenBy,
  }
}
