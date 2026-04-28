/**
 * Session REST API Routes
 *
 * 提供会话的 CRUD 操作接口，数据由桌面端原生 runtime 管理。
 *
 * Routes:
 *   GET    /api/sessions            — 列出会话
 *   GET    /api/sessions/:id        — 获取会话详情
 *   GET    /api/sessions/:id/messages — 获取会话消息
 *   POST   /api/sessions            — 创建新会话
 *   DELETE /api/sessions/:id        — 删除会话
 *   PATCH  /api/sessions/:id        — 重命名会话
 */

import { sessionService } from '../services/sessionService.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { getDesktopSlashCommands } from '../runtime/DesktopSlashCommands.js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export async function handleSessionsApi(
  req: Request,
  url: URL,
  segments: string[]
): Promise<Response> {
  try {
    // segments: ['api', 'sessions', ...rest]
    const sessionId = segments[2] // may be undefined
    const subResource = segments[3] // e.g. 'messages'

    // -----------------------------------------------------------------------
    // Collection routes: /api/sessions
    // -----------------------------------------------------------------------
    if (!sessionId) {
      switch (req.method) {
        case 'GET':
          return await listSessions(url)
        case 'POST':
          return await createSession(req)
        default:
          return Response.json(
            { error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` },
            { status: 405 }
          )
      }
    }

    // Special collection route: /api/sessions/recent-projects
    if (sessionId === 'recent-projects' && req.method === 'GET') {
      return await getRecentProjects(url)
    }

    // -----------------------------------------------------------------------
    // Sub-resource routes: /api/sessions/:id/messages
    // -----------------------------------------------------------------------
    if (subResource === 'messages') {
      if (req.method !== 'GET') {
        return Response.json(
          { error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` },
          { status: 405 }
        )
      }
      return await getSessionMessages(sessionId)
    }

    if (subResource === 'git-info') {
      if (req.method !== 'GET') {
        return Response.json(
          { error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` },
          { status: 405 }
        )
      }
      return await getGitInfo(sessionId)
    }

    if (subResource === 'slash-commands') {
      if (req.method !== 'GET') {
        return Response.json(
          { error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` },
          { status: 405 }
        )
      }
      return await getSessionSlashCommands(sessionId)
    }

    if (subResource === 'workspace') {
      return await handleWorkspaceRoute(req, url, segments, sessionId)
    }

    if (subResource === 'terminal') {
      return await handleTerminalRoute(req, segments, sessionId)
    }

    // Route to conversations handler if sub-resource is 'chat'
    if (subResource === 'chat') {
      // This is handled by the conversations API, but in case the router
      // forwards it here, we delegate to the conversations module.
      // Normally the router should route /api/sessions/:id/chat/* to conversations.
      return Response.json(
        { error: 'NOT_FOUND', message: 'Use /api/sessions/:id/chat via conversations API' },
        { status: 404 }
      )
    }

    // -----------------------------------------------------------------------
    // Item routes: /api/sessions/:id
    // -----------------------------------------------------------------------
    switch (req.method) {
      case 'GET':
        return await getSession(sessionId)
      case 'DELETE':
        return await deleteSession(sessionId)
      case 'PATCH':
        return await patchSession(req, sessionId)
      default:
        return Response.json(
          { error: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` },
          { status: 405 }
        )
    }
  } catch (error) {
    return errorResponse(error)
  }
}

// ============================================================================
// Handler implementations
// ============================================================================

async function listSessions(url: URL): Promise<Response> {
  const project = url.searchParams.get('project') || undefined
  const limit = parseInt(url.searchParams.get('limit') || '20', 10)
  const offset = parseInt(url.searchParams.get('offset') || '0', 10)

  if (isNaN(limit) || limit < 0) {
    throw ApiError.badRequest('Invalid limit parameter')
  }
  if (isNaN(offset) || offset < 0) {
    throw ApiError.badRequest('Invalid offset parameter')
  }

  const result = await sessionService.listSessions({ project, limit, offset })
  return Response.json(result)
}

async function getSession(sessionId: string): Promise<Response> {
  const detail = await sessionService.getSession(sessionId)
  if (!detail) {
    throw ApiError.notFound(`Session not found: ${sessionId}`)
  }
  return Response.json(detail)
}

async function getSessionMessages(sessionId: string): Promise<Response> {
  const messages = await sessionService.getSessionMessages(sessionId)
  return Response.json({ messages })
}

async function createSession(req: Request): Promise<Response> {
  let body: { workDir?: string; mode?: string }
  try {
    body = (await req.json()) as { workDir?: string; mode?: string }
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }

  if (body.workDir && typeof body.workDir !== 'string') {
    throw ApiError.badRequest('workDir must be a string')
  }

  const mode = body.mode === 'chat' || body.mode === 'code' ? body.mode : undefined
  const result = await sessionService.createSession(body.workDir, mode)
  return Response.json(result, { status: 201 })
}

async function deleteSession(sessionId: string): Promise<Response> {
  await sessionService.deleteSession(sessionId)
  return Response.json({ ok: true })
}

async function getSessionSlashCommands(sessionId: string): Promise<Response> {
  const session = await sessionService.getSession(sessionId)
  if (!session) {
    throw ApiError.notFound(`Session not found: ${sessionId}`)
  }

  return Response.json({ commands: getDesktopSlashCommands(session.mode) })
}

const MAX_WORKSPACE_ENTRIES = 5_000
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024
const MAX_DIFF_BYTES = 512 * 1024
const TERMINAL_TIMEOUT_MS = 30_000

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

const TEXT_EXTENSIONS = new Set([
  '.bat', '.c', '.cmd', '.conf', '.cpp', '.cs', '.css', '.csv', '.env', '.go',
  '.h', '.html', '.java', '.js', '.json', '.jsx', '.lock', '.log', '.md',
  '.mjs', '.ps1', '.py', '.rs', '.scss', '.sh', '.sql', '.svg', '.toml',
  '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml',
])

async function handleWorkspaceRoute(
  req: Request,
  url: URL,
  segments: string[],
  sessionId: string,
): Promise<Response> {
  const action = segments[4]

  if (action === 'tree' && req.method === 'GET') {
    return await getWorkspaceTree(sessionId, url)
  }

  if (action === 'file' && req.method === 'GET') {
    return await getWorkspaceFile(sessionId, url)
  }

  if (action === 'changes' && req.method === 'GET') {
    return await getWorkspaceChanges(sessionId)
  }

  if (action === 'diff' && req.method === 'GET') {
    return await getWorkspaceDiff(sessionId, url)
  }

  if (action === 'reveal' && req.method === 'POST') {
    return await revealWorkspacePath(req, sessionId)
  }

  if (action === 'raw' && req.method === 'GET') {
    const rawPath = segments.slice(5).map((part) => decodeURIComponent(part)).join('/')
    return await getWorkspaceRawFile(sessionId, rawPath)
  }

  return Response.json(
    { error: 'NOT_FOUND', message: 'Unknown workspace route' },
    { status: 404 },
  )
}

async function handleTerminalRoute(
  req: Request,
  segments: string[],
  sessionId: string,
): Promise<Response> {
  const action = segments[4]
  if (action !== 'run' || req.method !== 'POST') {
    return Response.json(
      { error: 'NOT_FOUND', message: 'Unknown terminal route' },
      { status: 404 },
    )
  }

  let body: { command?: string; cwd?: string }
  try {
    body = (await req.json()) as { command?: string; cwd?: string }
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }

  if (!body.command || typeof body.command !== 'string') {
    throw ApiError.badRequest('command is required')
  }

  const { root, target } = await resolveWorkspacePath(sessionId, body.cwd)
  const cwd = target
  const startedAt = Date.now()
  const shell = process.platform === 'win32'
    ? { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', body.command] }
    : { command: process.env.SHELL || '/bin/sh', args: ['-lc', body.command] }

  const proc = Bun.spawn([shell.command, ...shell.args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdoutPromise = new Response(proc.stdout).text()
  const stderrPromise = new Response(proc.stderr).text()
  const exitedPromise = proc.exited
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Command timed out')), TERMINAL_TIMEOUT_MS)
  })

  try {
    const [exitCode, stdout, stderr] = await Promise.race([
      Promise.all([exitedPromise, stdoutPromise, stderrPromise]),
      timeoutPromise,
    ])
    return Response.json({
      command: body.command,
      cwd,
      root,
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    proc.kill()
    return Response.json({
      command: body.command,
      cwd,
      root,
      exitCode: null,
      stdout: await stdoutPromise.catch(() => ''),
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
      durationMs: Date.now() - startedAt,
      timedOut: true,
    })
  }
}

async function getWorkspaceTree(sessionId: string, url: URL): Promise<Response> {
  const requestedPath = url.searchParams.get('path') || undefined
  const { root, target, relativePath } = await resolveWorkspacePath(sessionId, requestedPath)

  const stat = await fs.stat(target)
  if (!stat.isDirectory()) {
    throw ApiError.badRequest('path must be a directory')
  }

  const entries = await fs.readdir(target, { withFileTypes: true })
  const sorted = entries
    .filter((entry) => entry.name !== '.git')
    .map((entry) => {
      const absolutePath = path.join(target, entry.name)
      const entryRelativePath = toPosixPath(path.relative(root, absolutePath))
      return {
        name: entry.name,
        relativePath: entryRelativePath,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }
    })
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  const visible = sorted.slice(0, MAX_WORKSPACE_ENTRIES)

  return Response.json({
    root,
    currentPath: target,
    relativePath,
    entries: visible,
    truncated: sorted.length > MAX_WORKSPACE_ENTRIES,
    truncatedCount: Math.max(0, sorted.length - MAX_WORKSPACE_ENTRIES),
  })
}

async function getWorkspaceFile(sessionId: string, url: URL): Promise<Response> {
  const requestedPath = url.searchParams.get('path')
  if (!requestedPath) throw ApiError.badRequest('path is required')

  const { root, target, relativePath } = await resolveWorkspacePath(sessionId, requestedPath)
  const stat = await fs.stat(target)
  if (!stat.isFile()) throw ApiError.badRequest('path must be a file')
  if (stat.size > MAX_TEXT_FILE_BYTES) throw ApiError.badRequest('file is too large to preview')

  const ext = path.extname(target).toLowerCase()
  const isText = TEXT_EXTENSIONS.has(ext) || (MIME_TYPES[ext] || '').startsWith('text/')
  if (!isText) {
    return Response.json({
      root,
      relativePath,
      size: stat.size,
      mimeType: MIME_TYPES[ext] || 'application/octet-stream',
      binary: true,
    })
  }

  const content = await fs.readFile(target, 'utf-8')
  return Response.json({
    root,
    relativePath,
    size: stat.size,
    mimeType: MIME_TYPES[ext] || 'text/plain; charset=utf-8',
    language: languageFromExtension(ext),
    content,
    binary: false,
  })
}

async function getWorkspaceRawFile(sessionId: string, requestedPath: string): Promise<Response> {
  if (!requestedPath) throw ApiError.badRequest('path is required')

  const { target } = await resolveWorkspacePath(sessionId, requestedPath)
  const stat = await fs.stat(target)
  if (!stat.isFile()) throw ApiError.badRequest('path must be a file')

  const ext = path.extname(target).toLowerCase()
  const file = Bun.file(target)
  return new Response(file, {
    headers: {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'SAMEORIGIN',
    },
  })
}

async function getWorkspaceChanges(sessionId: string): Promise<Response> {
  const { root } = await resolveWorkspacePath(sessionId)
  const repo = await getGitRepositoryRoot(root)
  if (!repo) {
    return Response.json({
      root,
      files: [],
      hasChanges: false,
      source: 'none',
    })
  }

  const statusResult = await runGit(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'])
  if (statusResult.exitCode !== 0) {
    return Response.json({
      root,
      files: [],
      hasChanges: false,
      source: 'git',
      error: statusResult.stderr.trim() || 'Unable to read git status',
    })
  }

  const files = new Map<string, WorkspaceChangeFile>()
  for (const entry of parseGitStatus(statusResult.stdout)) {
    const workspacePath = gitPathToWorkspacePath(repo, root, entry.path)
    if (!workspacePath) continue
    const status = classifyGitStatus(entry.xy)
    files.set(workspacePath, {
      path: workspacePath,
      status,
      indexStatus: entry.xy[0] || ' ',
      worktreeStatus: entry.xy[1] || ' ',
      staged: entry.xy[0] !== ' ' && entry.xy[0] !== '?',
      unstaged: entry.xy[1] !== ' ' || entry.xy === '??',
      additions: 0,
      deletions: 0,
    })
  }

  const unstagedStats = await getGitNumstat(repo, root, ['diff', '--numstat', '--'])
  const stagedStats = await getGitNumstat(repo, root, ['diff', '--cached', '--numstat', '--'])
  for (const stat of [...unstagedStats, ...stagedStats]) {
    const existing = files.get(stat.path)
    if (existing) {
      existing.additions += stat.additions
      existing.deletions += stat.deletions
    } else {
      files.set(stat.path, {
        path: stat.path,
        status: 'modified',
        indexStatus: ' ',
        worktreeStatus: 'M',
        staged: false,
        unstaged: true,
        additions: stat.additions,
        deletions: stat.deletions,
      })
    }
  }

  const visible = [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
  return Response.json({
    root,
    files: visible,
    hasChanges: visible.length > 0,
    source: 'git',
  })
}

async function getWorkspaceDiff(sessionId: string, url: URL): Promise<Response> {
  const requestedPath = url.searchParams.get('path') || undefined
  const { root, target, relativePath } = await resolveWorkspacePath(sessionId, requestedPath)
  const repo = await getGitRepositoryRoot(root)

  if (!repo) {
    const fallback = requestedPath ? await buildCurrentFileDiff(root, target, relativePath) : ''
    return Response.json({
      root,
      relativePath,
      diff: fallback,
      source: 'workspace',
      truncated: byteLength(fallback) > MAX_DIFF_BYTES,
    })
  }

  const args = ['diff', '--no-ext-diff', '--find-renames', '--unified=80', 'HEAD', '--']
  if (requestedPath) {
    args.push(toGitPath(path.relative(repo, target)))
  }

  const diffResult = await runGit(repo, args)
  let diff = diffResult.stdout

  if (requestedPath && !diff.trim()) {
    const status = await runGit(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', toGitPath(path.relative(repo, target))])
    if (status.stdout.startsWith('?? ')) {
      diff = await buildCurrentFileDiff(root, target, relativePath)
    }
  }

  const truncated = byteLength(diff) > MAX_DIFF_BYTES
  if (truncated) {
    diff = truncateUtf8(diff, MAX_DIFF_BYTES) + '\n\n# Diff 过大，已截断显示。'
  }

  return Response.json({
    root,
    relativePath,
    diff,
    source: 'git',
    truncated,
    error: diffResult.exitCode === 0 ? undefined : diffResult.stderr.trim(),
  })
}

async function revealWorkspacePath(req: Request, sessionId: string): Promise<Response> {
  let body: { path?: string } = {}
  try {
    body = (await req.json()) as { path?: string }
  } catch {
    body = {}
  }

  if (body.path !== undefined && typeof body.path !== 'string') {
    throw ApiError.badRequest('path must be a string')
  }

  const { target } = await resolveWorkspacePath(sessionId, body.path)
  await fs.stat(target)
  const opened = await openPathInFileManager(target)

  if (!opened.ok) {
    return Response.json(
      { ok: false, path: target, error: opened.error || 'Unable to open folder' },
      { status: 500 },
    )
  }

  return Response.json({ ok: true, path: target })
}

async function openPathInFileManager(target: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const command = process.platform === 'win32'
      ? 'explorer.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open'
    const args = process.platform === 'win32'
      ? [`/select,${target}`]
      : process.platform === 'darwin'
        ? ['-R', target]
        : [(await fs.stat(target)).isDirectory() ? target : path.dirname(target)]

    Bun.spawn([command, ...args], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

type WorkspaceChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'changed'

type WorkspaceChangeFile = {
  path: string
  status: WorkspaceChangeStatus
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  unstaged: boolean
  additions: number
  deletions: number
}

type GitResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

async function runGit(cwd: string, args: string[], timeoutMs = 8_000): Promise<GitResult> {
  let proc: ReturnType<typeof Bun.spawn> | null = null
  try {
    proc = Bun.spawn(['git', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
    })
  } catch (error) {
    return {
      exitCode: null,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  }

  const stdoutPromise = new Response(proc.stdout).text()
  const stderrPromise = new Response(proc.stderr).text()
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('git command timed out')), timeoutMs)
  })

  try {
    const [exitCode, stdout, stderr] = await Promise.race([
      Promise.all([proc.exited, stdoutPromise, stderrPromise]),
      timeoutPromise,
    ])
    return { exitCode, stdout, stderr }
  } catch (error) {
    proc.kill()
    return {
      exitCode: null,
      stdout: await stdoutPromise.catch(() => ''),
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

async function getGitRepositoryRoot(workspaceRoot: string): Promise<string | null> {
  const result = await runGit(workspaceRoot, ['rev-parse', '--show-toplevel'])
  if (result.exitCode !== 0) return null
  const repoRoot = result.stdout.trim()
  return repoRoot ? path.resolve(repoRoot) : null
}

function parseGitStatus(stdout: string): Array<{ xy: string; path: string }> {
  const parts = stdout.split('\0').filter(Boolean)
  const entries: Array<{ xy: string; path: string }> = []
  for (let index = 0; index < parts.length; index++) {
    const record = parts[index] ?? ''
    if (record.length < 4) continue
    const xy = record.slice(0, 2)
    const filePath = record.slice(3)
    entries.push({ xy, path: filePath })
    if (xy.includes('R') || xy.includes('C')) index += 1
  }
  return entries
}

function classifyGitStatus(xy: string): WorkspaceChangeStatus {
  if (xy === '??') return 'untracked'
  if (xy.includes('R')) return 'renamed'
  if (xy.includes('C')) return 'copied'
  if (xy.includes('D')) return 'deleted'
  if (xy.includes('A')) return 'added'
  if (xy.includes('M')) return 'modified'
  return 'changed'
}

async function getGitNumstat(
  repoRoot: string,
  workspaceRoot: string,
  args: string[],
): Promise<Array<{ path: string; additions: number; deletions: number }>> {
  const result = await runGit(repoRoot, args)
  if (result.exitCode !== 0) return []
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, filePath] = line.split('\t')
      if (!filePath) return null
      const workspacePath = gitPathToWorkspacePath(repoRoot, workspaceRoot, normalizeNumstatPath(filePath))
      if (!workspacePath) return null
      return {
        path: workspacePath,
        additions: Number.parseInt(added ?? '0', 10) || 0,
        deletions: Number.parseInt(deleted ?? '0', 10) || 0,
      }
    })
    .filter((item): item is { path: string; additions: number; deletions: number } => Boolean(item))
}

function normalizeNumstatPath(value: string): string {
  const renameMatch = value.match(/^(.*)\{.* => (.*)\}(.*)$/)
  if (!renameMatch) return value
  return `${renameMatch[1] ?? ''}${renameMatch[2] ?? ''}${renameMatch[3] ?? ''}`
}

function gitPathToWorkspacePath(repoRoot: string, workspaceRoot: string, gitPath: string): string | null {
  const absolute = path.resolve(repoRoot, fromGitPath(gitPath))
  const relative = path.relative(workspaceRoot, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  return toPosixPath(relative)
}

function fromGitPath(value: string): string {
  return value.split('/').join(path.sep)
}

function toGitPath(value: string): string {
  return value.split(path.sep).join('/')
}

async function buildCurrentFileDiff(root: string, target: string, relativePath: string): Promise<string> {
  try {
    const stat = await fs.stat(target)
    if (!stat.isFile()) return ''
    if (stat.size > MAX_DIFF_BYTES) {
      return `--- /dev/null\n+++ b/${relativePath}\n@@ -0,0 +1 @@\n+文件过大，审查视图已省略内容。`
    }
    const ext = path.extname(target).toLowerCase()
    const isText = TEXT_EXTENSIONS.has(ext) || (MIME_TYPES[ext] || '').startsWith('text/')
    if (!isText) {
      return `--- /dev/null\n+++ b/${relativePath}\n@@ -0,0 +1 @@\n+二进制文件，无法在审查视图中显示内容。`
    }
    const content = await fs.readFile(target, 'utf-8')
    const lines = content.split(/\r?\n/)
    const body = lines.map((line) => `+${line}`).join('\n')
    return `--- /dev/null\n+++ b/${toPosixPath(path.relative(root, target))}\n@@ -0,0 +1,${lines.length} @@\n${body}`
  } catch {
    return ''
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  let bytes = 0
  let output = ''
  for (const char of value) {
    const length = encoder.encode(char).byteLength
    if (bytes + length > maxBytes) break
    output += char
    bytes += length
  }
  return output
}

async function resolveWorkspacePath(
  sessionId: string,
  requestedPath?: string | null,
): Promise<{ root: string; target: string; relativePath: string }> {
  const workDir = await sessionService.getSessionWorkDir(sessionId)
  if (!workDir) {
    throw ApiError.notFound(`Session not found: ${sessionId}`)
  }

  const root = path.resolve(workDir)
  const target = requestedPath
    ? path.resolve(path.isAbsolute(requestedPath) ? requestedPath : path.join(root, requestedPath))
    : root
  const relative = path.relative(root, target)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw ApiError.badRequest('path is outside the workspace')
  }

  return {
    root,
    target,
    relativePath: toPosixPath(relative),
  }
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/')
}

function languageFromExtension(ext: string): string {
  const normalized = ext.replace(/^\./, '')
  const known: Record<string, string> = {
    htm: 'html',
    js: 'javascript',
    mjs: 'javascript',
    ts: 'typescript',
    tsx: 'tsx',
    jsx: 'jsx',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    sh: 'bash',
    ps1: 'powershell',
    yml: 'yaml',
  }
  return known[normalized] || normalized || 'text'
}

async function getGitInfo(sessionId: string): Promise<Response> {
  const workDir = await sessionService.getSessionWorkDir(sessionId)
  if (!workDir) {
    throw ApiError.notFound(`Session not found: ${sessionId}`)
  }

  try {
    // Get branch name
    const branchProc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const branchText = await new Response(branchProc.stdout).text()
    const branch = branchText.trim()

    // Get repo name from remote or directory
    let repoName = ''
    try {
      const remoteProc = Bun.spawn(['git', 'remote', 'get-url', 'origin'], {
        cwd: workDir,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const remoteText = await new Response(remoteProc.stdout).text()
      const remote = remoteText.trim()
      // Extract repo name from URL: git@github.com:user/repo.git or https://...repo.git
      const match = remote.match(/\/([^/]+?)(?:\.git)?$/) || remote.match(/:([^/]+\/[^/]+?)(?:\.git)?$/)
      repoName = match ? match[1]! : ''
    } catch {
      // No remote, use directory name
      const parts = workDir.split('/')
      repoName = parts[parts.length - 1] || ''
    }

    // Get short status
    const statusProc = Bun.spawn(['git', 'status', '--porcelain'], {
      cwd: workDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const statusText = await new Response(statusProc.stdout).text()
    const changedFiles = statusText.trim().split('\n').filter(Boolean).length

    return Response.json({
      branch,
      repoName,
      workDir,
      changedFiles,
    })
  } catch {
    // Not a git repo or git not available
    return Response.json({
      branch: null,
      repoName: null,
      workDir,
      changedFiles: 0,
    })
  }
}

async function patchSession(req: Request, sessionId: string): Promise<Response> {
  let body: { title?: string }
  try {
    body = (await req.json()) as { title?: string }
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }

  if (!body.title || typeof body.title !== 'string') {
    throw ApiError.badRequest('title (string) is required in request body')
  }

  await sessionService.renameSession(sessionId, body.title)
  return Response.json({ ok: true })
}

type RecentProjectEntry = {
  projectPath: string
  realPath: string
  projectName: string
  isGit: boolean
  repoName: string | null
  branch: string | null
  modifiedAt: string
  sessionCount: number
}

// In-memory cache for recent projects (TTL: 30s)
let recentProjectsCache: { projects: RecentProjectEntry[]; timestamp: number } | null = null
const RECENT_PROJECTS_CACHE_TTL = 30_000

async function getRecentProjects(url: URL): Promise<Response> {
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 1), 500)

  // Return cached response if fresh
  if (recentProjectsCache && Date.now() - recentProjectsCache.timestamp < RECENT_PROJECTS_CACHE_TTL) {
    return Response.json({ projects: recentProjectsCache.projects.slice(0, limit) })
  }

  const { sessions } = await sessionService.listSessions({ limit: 200 })
  const validSessions = sessions.filter((session) => session.workDirExists && session.workDir)

  // First pass: resolve realPath for each session and group by realPath to dedup
  const realPathMap = new Map<string, { projectPath: string; modifiedAt: string; sessionCount: number; sessionId: string }>()
  for (const s of validSessions) {
    let realPath: string
    try {
      const workDir = await sessionService.getSessionWorkDir(s.id)
      realPath = workDir || sessionService.desanitizePath(s.projectPath)
    } catch {
      realPath = sessionService.desanitizePath(s.projectPath)
    }

    const existing = realPathMap.get(realPath)
    if (!existing || s.modifiedAt > existing.modifiedAt) {
      realPathMap.set(realPath, {
        projectPath: s.projectPath,
        modifiedAt: s.modifiedAt,
        sessionCount: (existing?.sessionCount ?? 0) + 1,
        sessionId: s.id,
      })
    } else {
      existing.sessionCount++
    }
  }

  // Build project list with git info — parallelize git operations
  const entries = Array.from(realPathMap.entries())
  const projects = await Promise.all(
    entries.map(async ([realPath, info]) => {
      const projectName = realPath.split('/').filter(Boolean).pop() || info.projectPath

      let isGit = false
      let repoName: string | null = null
      let branch: string | null = null
      try {
        const proc = Bun.spawn(['git', 'rev-parse', '--is-inside-work-tree'], {
          cwd: realPath, stdout: 'pipe', stderr: 'pipe',
        })
        const out = await new Response(proc.stdout).text()
        isGit = out.trim() === 'true'

        if (isGit) {
          // Run branch + remote in parallel
          const [branchResult, remoteResult] = await Promise.all([
            (async () => {
              const branchProc = Bun.spawn(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
                cwd: realPath, stdout: 'pipe', stderr: 'pipe',
              })
              return (await new Response(branchProc.stdout).text()).trim() || null
            })(),
            (async () => {
              try {
                const remoteProc = Bun.spawn(['git', 'remote', 'get-url', 'origin'], {
                  cwd: realPath, stdout: 'pipe', stderr: 'pipe',
                })
                const remote = (await new Response(remoteProc.stdout).text()).trim()
                const match = remote.match(/:([^/]+\/[^/]+?)(?:\.git)?$/) || remote.match(/\/([^/]+\/[^/]+?)(?:\.git)?$/)
                return match ? match[1]! : null
              } catch { return null }
            })(),
          ])
          branch = branchResult
          repoName = remoteResult
        }
      } catch { /* not a git repo or dir doesn't exist */ }

      return {
        projectPath: info.projectPath, realPath, projectName, isGit, repoName, branch,
        modifiedAt: info.modifiedAt, sessionCount: info.sessionCount,
      }
    })
  )

  // Sort by most recent
  projects.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))

  recentProjectsCache = { projects, timestamp: Date.now() }
  return Response.json({ projects: projects.slice(0, limit) })
}
