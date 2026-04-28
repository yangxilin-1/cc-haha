import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import picomatch from 'picomatch'
import type { ToolRisk } from './PermissionService.js'
import { computerUseRuntime, type ComputerUseRuntime } from './ComputerUseRuntime.js'
import type { ChatContentBlock } from './types.js'
import { AgentRuntime, type AgentRunInput } from './AgentRuntime.js'
import type { ProviderAdapter } from './ProviderAdapter.js'
import type { AgentService } from '../services/agentService.js'

type ToolSchema = Record<string, unknown>

export type ToolDefinition = {
  name: string
  description: string
  input_schema: ToolSchema
  risk: ToolRisk
}

export type ToolExecutionContext = {
  sessionId: string
  workDir: string
  signal: AbortSignal
}

export type ToolExecutionMetadata = {
  summary?: string
  durationMs?: number
  exitCode?: number
  timedOut?: boolean
  outputTruncated?: boolean
  filePath?: string
  files?: string[]
  additions?: number
  deletions?: number
  patch?: PatchAuditMetadata
  bytes?: number
  lines?: number
  matches?: number
  occurrences?: number
}

export type PatchAuditFile = {
  path: string
  operation: 'create' | 'modify' | 'delete'
  additions: number
  deletions: number
  beforeSha256: string | null
  afterSha256: string | null
}

export type PatchAuditMetadata = {
  forwardPatch: string
  reversePatch: string
  files: PatchAuditFile[]
}

export type ToolExecutionResult = {
  content: string | ChatContentBlock[]
  isError?: boolean
  metadata?: ToolExecutionMetadata
}

type ToolHandler = {
  definition: ToolDefinition
  execute(input: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult>
}

type ToolRuntimeOptions = {
  computerUse?: ComputerUseRuntime
  providerAdapter?: ProviderAdapter
  agentService?: AgentService
}

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  'coverage',
  'target',
  '.venv',
  'venv',
])

const TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsonl',
  '.jsx',
  '.md',
  '.mdx',
  '.py',
  '.rs',
  '.sh',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
])

const MAX_FILE_BYTES = 1_000_000
const MAX_LIST_RESULTS = 500
const MAX_SEARCH_RESULTS = 200
const MAX_COMMAND_OUTPUT = 24_000

type PatchLine = {
  type: 'context' | 'add' | 'remove'
  text: string
}

type PatchHunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: PatchLine[]
}

type ParsedFilePatch = {
  oldPath: string | null
  newPath: string | null
  hunks: PatchHunk[]
}

type PreparedPatchWrite = {
  absolute: string
  relative: string
  originalContent: string | null
  content: string | null
  additions: number
  deletions: number
  operation: PatchAuditFile['operation']
}

export class ToolRuntime {
  private tools: ToolHandler[]
  private computerUse: ComputerUseRuntime
  private agentRuntime: AgentRuntime

  constructor(options: ComputerUseRuntime | ToolRuntimeOptions = {}) {
    const resolvedOptions: ToolRuntimeOptions = isToolRuntimeOptions(options)
      ? options
      : { computerUse: options }
    this.computerUse = resolvedOptions.computerUse ?? computerUseRuntime
    this.tools = [
      this.createListFilesTool(),
      this.createReadFileTool(),
      this.createSearchTextTool(),
      this.createWriteFileTool(),
      this.createEditFileTool(),
      this.createApplyPatchTool(),
      this.createRunCommandTool(),
    ]
    this.agentRuntime = new AgentRuntime({
      providerAdapter: resolvedOptions.providerAdapter,
      agentService: resolvedOptions.agentService,
      toolHost: this,
    })
  }

  getDefinitions(): ToolDefinition[] {
    return [
      ...this.tools.map((tool) => tool.definition),
      this.agentRuntime.getDefinition(),
      ...this.computerUse.getDefinitions(),
    ]
  }

  getRisk(toolName: string): ToolRisk | null {
    if (toolName === this.agentRuntime.getDefinition().name) {
      return this.agentRuntime.getDefinition().risk
    }
    return this.tools.find((tool) => tool.definition.name === toolName)?.definition.risk
      ?? this.computerUse.getRisk(toolName)
  }

  async execute(
    toolName: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    if (toolName === this.agentRuntime.getDefinition().name) {
      const startedAt = Date.now()
      try {
        return withDuration(
          await this.agentRuntime.run(input as AgentRunInput, context),
          startedAt,
        )
      } catch (err) {
        return {
          content: err instanceof Error ? err.message : String(err),
          isError: true,
          metadata: {
            summary: 'Agent failed',
            durationMs: Date.now() - startedAt,
          },
        }
      }
    }

    const tool = this.tools.find((entry) => entry.definition.name === toolName)
    if (!tool) {
      if (this.computerUse.hasTool(toolName)) {
        const startedAt = Date.now()
        try {
          return withDuration(
            await this.computerUse.execute(toolName, input, context),
            startedAt,
          )
        } catch (err) {
          return {
            content: err instanceof Error ? err.message : String(err),
            isError: true,
            metadata: {
              summary: 'Computer Use failed',
              durationMs: Date.now() - startedAt,
            },
          }
        }
      }
      return { content: `Unknown tool: ${toolName}`, isError: true }
    }

    const startedAt = Date.now()
    try {
      return withDuration(await tool.execute(input, context), startedAt)
    } catch (err) {
      return {
        content: err instanceof Error ? err.message : String(err),
        isError: true,
        metadata: {
          summary: 'Tool failed',
          durationMs: Date.now() - startedAt,
        },
      }
    }
  }

  async cleanupSessionTurn(sessionId: string): Promise<void> {
    await this.computerUse.cleanupSessionTurn(sessionId)
  }

  cancelSession(sessionId: string): void {
    this.computerUse.cancelSession(sessionId)
  }

  private createListFilesTool(): ToolHandler {
    return {
      definition: {
        name: 'list_files',
        description: 'List project files. Supports an optional glob pattern such as "src/**/*.ts".',
        risk: 'read',
        input_schema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Optional glob pattern relative to the project root.' },
            max_results: { type: 'number', description: 'Maximum number of files to return.' },
          },
        },
      },
      execute: async (input, context) => {
        const obj = asObject(input)
        const pattern = typeof obj.pattern === 'string' && obj.pattern.trim()
          ? obj.pattern.trim()
          : '**/*'
        const maxResults = clampNumber(obj.max_results, 1, MAX_LIST_RESULTS, 120)
        const matcher = picomatch(pattern, { dot: true })
        const files = await collectProjectFiles(context.workDir, maxResults, (relative) => matcher(relative))
        return {
          content: files.length > 0 ? files.join('\n') : 'No matching files found.',
          metadata: {
            summary: files.length === 1 ? '1 file' : `${files.length} files`,
            matches: files.length,
          },
        }
      },
    }
  }

  private createReadFileTool(): ToolHandler {
    return {
      definition: {
        name: 'read_file',
        description: 'Read a UTF-8 text file inside the current project.',
        risk: 'read',
        input_schema: {
          type: 'object',
          required: ['file_path'],
          properties: {
            file_path: { type: 'string', description: 'Path relative to the project root.' },
            offset: { type: 'number', description: 'Optional 1-based line offset.' },
            limit: { type: 'number', description: 'Optional maximum number of lines.' },
          },
        },
      },
      execute: async (input, context) => {
        const obj = asObject(input)
        const filePath = requireString(obj.file_path, 'file_path')
        const absolute = await resolveInsideProject(context.workDir, filePath, { mustExist: true })
        await ensureTextFile(absolute)
        const text = await fs.readFile(absolute, 'utf-8')
        const lines = text.split(/\r?\n/)
        const offset = clampNumber(obj.offset, 1, Math.max(lines.length, 1), 1)
        const limit = clampNumber(obj.limit, 1, 2000, 240)
        const selected = lines.slice(offset - 1, offset - 1 + limit)
        const numbered = selected
          .map((line, index) => `${String(offset + index).padStart(4, ' ')} | ${line}`)
          .join('\n')
        return {
          content: numbered || '(empty file)',
          metadata: {
            summary: selected.length === 1
              ? '1 line read'
              : `${selected.length} lines read`,
            filePath: toProjectRelative(context.workDir, absolute),
            lines: selected.length,
          },
        }
      },
    }
  }

  private createSearchTextTool(): ToolHandler {
    return {
      definition: {
        name: 'search_text',
        description: 'Search text in project files. Uses a literal case-insensitive search by default.',
        risk: 'read',
        input_schema: {
          type: 'object',
          required: ['pattern'],
          properties: {
            pattern: { type: 'string', description: 'Text or regex pattern to search for.' },
            path: { type: 'string', description: 'Optional glob limiting files, for example "src/**/*.ts".' },
            regex: { type: 'boolean', description: 'Treat pattern as a JavaScript regular expression.' },
            case_sensitive: { type: 'boolean' },
          },
        },
      },
      execute: async (input, context) => {
        const obj = asObject(input)
        const pattern = requireString(obj.pattern, 'pattern')
        const pathPattern = typeof obj.path === 'string' && obj.path.trim()
          ? obj.path.trim()
          : '**/*'
        const matcher = picomatch(pathPattern, { dot: true })
        const files = await collectProjectFiles(context.workDir, 2000, (relative) => matcher(relative))
        const flags = obj.case_sensitive === true ? 'g' : 'gi'
        const re = obj.regex === true
          ? new RegExp(pattern, flags)
          : new RegExp(escapeRegExp(pattern), flags)

        const results: string[] = []
        for (const relative of files) {
          if (results.length >= MAX_SEARCH_RESULTS) break
          const absolute = await resolveInsideProject(context.workDir, relative, { mustExist: true })
          if (!(await isLikelyTextFile(absolute))) continue
          const text = await fs.readFile(absolute, 'utf-8').catch(() => '')
          const lines = text.split(/\r?\n/)
          for (let i = 0; i < lines.length; i++) {
            if (results.length >= MAX_SEARCH_RESULTS) break
            if (re.test(lines[i] ?? '')) {
              results.push(`${relative}:${i + 1}: ${lines[i]}`)
            }
            re.lastIndex = 0
          }
        }

        return {
          content: results.length > 0
            ? results.join('\n')
            : 'No matches found.',
          metadata: {
            summary: results.length === 1 ? '1 match' : `${results.length} matches`,
            matches: results.length,
          },
        }
      },
    }
  }

  private createWriteFileTool(): ToolHandler {
    return {
      definition: {
        name: 'write_file',
        description: 'Create or overwrite a text file inside the current project.',
        risk: 'write',
        input_schema: {
          type: 'object',
          required: ['file_path', 'content'],
          properties: {
            file_path: { type: 'string' },
            content: { type: 'string' },
          },
        },
      },
      execute: async (input, context) => {
        const obj = asObject(input)
        const filePath = requireString(obj.file_path, 'file_path')
        const content = requireString(obj.content, 'content')
        const absolute = await resolveInsideProject(context.workDir, filePath, { mustExist: false })
        await fs.mkdir(path.dirname(absolute), { recursive: true })
        await fs.writeFile(absolute, content, 'utf-8')
        const bytes = Buffer.byteLength(content, 'utf-8')
        const lineCount = countLines(content)
        return {
          content: `Wrote ${bytes} bytes to ${toProjectRelative(context.workDir, absolute)}.`,
          metadata: {
            summary: lineCount === 1 ? '1 line written' : `${lineCount} lines written`,
            filePath: toProjectRelative(context.workDir, absolute),
            bytes,
            lines: lineCount,
          },
        }
      },
    }
  }

  private createEditFileTool(): ToolHandler {
    return {
      definition: {
        name: 'edit_file',
        description: 'Replace text inside an existing project file.',
        risk: 'write',
        input_schema: {
          type: 'object',
          required: ['file_path', 'old_string', 'new_string'],
          properties: {
            file_path: { type: 'string' },
            old_string: { type: 'string' },
            new_string: { type: 'string' },
            replace_all: { type: 'boolean' },
          },
        },
      },
      execute: async (input, context) => {
        const obj = asObject(input)
        const filePath = requireString(obj.file_path, 'file_path')
        const oldString = requireString(obj.old_string, 'old_string')
        const newString = requireString(obj.new_string, 'new_string')
        const absolute = await resolveInsideProject(context.workDir, filePath, { mustExist: true })
        await ensureTextFile(absolute)
        const current = await fs.readFile(absolute, 'utf-8')
        if (!current.includes(oldString)) {
          return { content: `Could not find old_string in ${filePath}.`, isError: true }
        }
        const occurrences = obj.replace_all === true
          ? current.split(oldString).length - 1
          : 1
        const updated = obj.replace_all === true
          ? current.split(oldString).join(newString)
          : current.replace(oldString, newString)
        await fs.writeFile(absolute, updated, 'utf-8')
        return {
          content: `Updated ${filePath} (${occurrences} replacement${occurrences === 1 ? '' : 's'}).`,
          metadata: {
            summary: occurrences === 1 ? '1 replacement' : `${occurrences} replacements`,
            filePath: toProjectRelative(context.workDir, absolute),
            occurrences,
          },
        }
      },
    }
  }

  private createApplyPatchTool(): ToolHandler {
    return {
      definition: {
        name: 'apply_patch',
        description: [
          'Apply a unified diff patch inside the current project.',
          'Use this for multi-line or multi-file edits after reading the target files.',
          'The patch is validated for all files before any file is written.',
        ].join(' '),
        risk: 'write',
        input_schema: {
          type: 'object',
          required: ['patch'],
          properties: {
            patch: {
              type: 'string',
              description: 'Unified diff text with ---/+++ file headers and @@ hunks.',
            },
          },
        },
      },
      execute: async (input, context) => {
        const obj = asObject(input)
        const patchText = requireString(obj.patch, 'patch')
        const parsedPatches = parseUnifiedPatch(patchText)
        if (parsedPatches.length === 0) {
          throw new Error('Patch did not contain any file changes.')
        }

        const prepared: PreparedPatchWrite[] = []
        let additions = 0
        let deletions = 0

        for (const filePatch of parsedPatches) {
          const targetPath = filePatch.newPath ?? filePatch.oldPath
          if (!targetPath) throw new Error('Patch file path is required.')

          const absolute = await resolveInsideProject(context.workDir, targetPath, {
            mustExist: filePatch.oldPath !== null,
          })
          if (filePatch.oldPath !== null) {
            await ensureTextFile(absolute)
          }

          const originalText = filePatch.oldPath === null
            ? ''
            : await fs.readFile(absolute, 'utf-8')
          const originalLines = textToPatchLines(originalText)
          const applied = applyFilePatch(originalLines, filePatch)
          const nextContent = filePatch.newPath === null
            ? null
            : patchLinesToText(applied.lines)

          additions += applied.additions
          deletions += applied.deletions
          prepared.push({
            absolute,
            relative: toProjectRelative(context.workDir, absolute),
            originalContent: filePatch.oldPath === null ? null : originalText,
            content: nextContent,
            additions: applied.additions,
            deletions: applied.deletions,
            operation: filePatch.oldPath === null
              ? 'create'
              : filePatch.newPath === null
                ? 'delete'
                : 'modify',
          })
        }

        const patchAudit = buildPatchAudit(patchText, prepared)

        for (const write of prepared) {
          if (write.content === null) {
            await fs.unlink(write.absolute)
          } else {
            await fs.mkdir(path.dirname(write.absolute), { recursive: true })
            await fs.writeFile(write.absolute, write.content, 'utf-8')
          }
        }

        const fileSummary = prepared.length === 1 ? '1 file' : `${prepared.length} files`
        const content = [
          `Applied patch to ${fileSummary}.`,
          ...prepared.map((write) => `- ${write.relative}${write.content === null ? ' deleted' : ''}`),
          `+${additions} -${deletions}`,
        ].join('\n')

        return {
          content,
          metadata: {
            summary: `${fileSummary} changed · +${additions} -${deletions}`,
            files: prepared.map((write) => write.relative),
            additions,
            deletions,
            patch: patchAudit,
          },
        }
      },
    }
  }

  private createRunCommandTool(): ToolHandler {
    return {
      definition: {
        name: 'run_command',
        description: 'Run a shell command in the current project. Requires user approval.',
        risk: 'execute',
        input_schema: {
          type: 'object',
          required: ['command'],
          properties: {
            command: { type: 'string' },
            description: { type: 'string' },
            timeout_ms: { type: 'number' },
          },
        },
      },
      execute: async (input, context) => {
        const obj = asObject(input)
        const command = requireString(obj.command, 'command')
        const timeoutMs = clampNumber(obj.timeout_ms, 1000, 120_000, 30_000)
        const shellArgs = process.platform === 'win32'
          ? ['powershell.exe', '-NoProfile', '-Command', command]
          : ['/bin/sh', '-lc', command]
        const proc = Bun.spawn(shellArgs, {
          cwd: context.workDir,
          stdout: 'pipe',
          stderr: 'pipe',
          signal: context.signal,
        })

        let timedOut = false
        const timeout = setTimeout(() => {
          timedOut = true
          proc.kill()
        }, timeoutMs)
        try {
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ])
          const normalizedExitCode = typeof exitCode === 'number' ? exitCode : -1
          const output = [
            `exit code: ${normalizedExitCode}`,
            timedOut ? `timed out after ${timeoutMs}ms` : '',
            stdout ? `stdout:\n${stdout.trimEnd()}` : '',
            stderr ? `stderr:\n${stderr.trimEnd()}` : '',
          ].filter(Boolean).join('\n\n')
          const outputTruncated = output.length > MAX_COMMAND_OUTPUT
          return {
            content: outputTruncated
              ? `${output.slice(0, MAX_COMMAND_OUTPUT)}\n\n[output truncated]`
              : output,
            isError: normalizedExitCode !== 0 || timedOut,
            metadata: {
              summary: timedOut
                ? `Timed out after ${timeoutMs}ms`
                : `Exit ${normalizedExitCode}`,
              exitCode: normalizedExitCode,
              timedOut,
              outputTruncated,
            },
          }
        } finally {
          clearTimeout(timeout)
        }
      },
    }
  }
}

async function collectProjectFiles(
  workDir: string,
  maxResults: number,
  predicate: (relative: string) => boolean,
): Promise<string[]> {
  const root = await fs.realpath(workDir)
  const results: string[] = []

  async function walk(dir: string): Promise<void> {
    if (results.length >= maxResults) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (results.length >= maxResults) return
      if (entry.name.startsWith('.') && entry.name !== '.github') {
        if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
      }
      const absolute = path.join(dir, entry.name)
      const relative = toProjectRelative(root, absolute)
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        await walk(absolute)
      } else if (entry.isFile() && predicate(relative)) {
        results.push(relative)
      }
    }
  }

  await walk(root)
  return results.sort((a, b) => a.localeCompare(b))
}

function parseUnifiedPatch(patchText: string): ParsedFilePatch[] {
  const lines = patchText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const patches: ParsedFilePatch[] = []
  let current: ParsedFilePatch | null = null
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (line.startsWith('diff --git ')) {
      index++
      continue
    }

    if (line.startsWith('--- ')) {
      const oldPath = parsePatchHeaderPath(line.slice(4))
      index++
      const nextLine = lines[index] ?? ''
      if (!nextLine.startsWith('+++ ')) {
        throw new Error('Invalid unified diff: expected +++ file header.')
      }
      const newPath = parsePatchHeaderPath(nextLine.slice(4))
      current = { oldPath, newPath, hunks: [] }
      patches.push(current)
      index++
      continue
    }

    if (line.startsWith('@@ ')) {
      if (!current) {
        throw new Error('Invalid unified diff: hunk appears before file headers.')
      }

      const hunk = parseHunkHeader(line)
      index++
      let oldSeen = 0
      let newSeen = 0

      while (oldSeen < hunk.oldCount || newSeen < hunk.newCount) {
        if (index >= lines.length) {
          throw new Error('Invalid unified diff: hunk ended before expected line counts.')
        }

        const hunkLine = lines[index] ?? ''
        index++
        if (hunkLine.startsWith('\\')) continue

        const prefix = hunkLine[0]
        const text = hunkLine.slice(1)
        if (prefix === ' ') {
          hunk.lines.push({ type: 'context', text })
          oldSeen++
          newSeen++
        } else if (prefix === '-') {
          hunk.lines.push({ type: 'remove', text })
          oldSeen++
        } else if (prefix === '+') {
          hunk.lines.push({ type: 'add', text })
          newSeen++
        } else {
          throw new Error('Invalid unified diff: hunk line must start with space, +, or -.')
        }
      }

      if (oldSeen !== hunk.oldCount || newSeen !== hunk.newCount) {
        throw new Error('Invalid unified diff: hunk line counts do not match header.')
      }

      current.hunks.push(hunk)
      continue
    }

    index++
  }

  for (const filePatch of patches) {
    if (filePatch.hunks.length === 0) {
      throw new Error(`Patch for ${filePatch.newPath ?? filePatch.oldPath ?? 'unknown file'} has no hunks.`)
    }
  }

  return patches
}

function parsePatchHeaderPath(rawHeader: string): string | null {
  const trimmed = rawHeader.trim()
  if (!trimmed || trimmed === '/dev/null') return null

  let headerPath = trimmed
  if (trimmed.startsWith('"')) {
    const endQuote = findClosingQuote(trimmed)
    const quoted = endQuote >= 0 ? trimmed.slice(0, endQuote + 1) : trimmed
    try {
      headerPath = JSON.parse(quoted) as string
    } catch {
      headerPath = quoted.slice(1, quoted.endsWith('"') ? -1 : undefined)
    }
  } else {
    headerPath = trimmed.split('\t')[0] ?? trimmed
  }

  if (headerPath.startsWith('a/') || headerPath.startsWith('b/')) {
    headerPath = headerPath.slice(2)
  }
  if (!headerPath.trim()) return null
  return headerPath
}

function findClosingQuote(value: string): number {
  for (let i = 1; i < value.length; i++) {
    if (value[i] === '\\') {
      i++
      continue
    }
    if (value[i] === '"') return i
  }
  return -1
}

function parseHunkHeader(header: string): PatchHunk {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header)
  if (!match) throw new Error(`Invalid unified diff hunk header: ${header}`)
  return {
    oldStart: Number(match[1]),
    oldCount: match[2] === undefined ? 1 : Number(match[2]),
    newStart: Number(match[3]),
    newCount: match[4] === undefined ? 1 : Number(match[4]),
    lines: [],
  }
}

function applyFilePatch(
  originalLines: string[],
  filePatch: ParsedFilePatch,
): { lines: string[]; additions: number; deletions: number } {
  const output: string[] = []
  let cursor = 0
  let additions = 0
  let deletions = 0

  for (const hunk of filePatch.hunks) {
    const targetIndex = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1
    if (targetIndex < cursor) {
      throw new Error(`Patch hunks overlap in ${filePatch.newPath ?? filePatch.oldPath ?? 'file'}.`)
    }

    output.push(...originalLines.slice(cursor, targetIndex))
    let readIndex = targetIndex

    for (const line of hunk.lines) {
      if (line.type === 'context') {
        assertPatchLine(originalLines, readIndex, line.text, filePatch)
        output.push(line.text)
        readIndex++
      } else if (line.type === 'remove') {
        assertPatchLine(originalLines, readIndex, line.text, filePatch)
        readIndex++
        deletions++
      } else {
        output.push(line.text)
        additions++
      }
    }

    cursor = readIndex
  }

  output.push(...originalLines.slice(cursor))
  return { lines: output, additions, deletions }
}

function assertPatchLine(
  originalLines: string[],
  index: number,
  expected: string,
  filePatch: ParsedFilePatch,
): void {
  const actual = originalLines[index]
  if (actual !== expected) {
    const fileName = filePatch.newPath ?? filePatch.oldPath ?? 'file'
    throw new Error(
      `Patch failed for ${fileName}: expected line ${index + 1} to be ${JSON.stringify(expected)}, found ${JSON.stringify(actual ?? '')}.`,
    )
  }
}

function textToPatchLines(value: string): string[] {
  if (!value) return []
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function patchLinesToText(lines: string[]): string {
  return lines.join('\n')
}

function buildPatchAudit(
  forwardPatch: string,
  writes: PreparedPatchWrite[],
): PatchAuditMetadata {
  return {
    forwardPatch,
    reversePatch: buildReversePatch(writes),
    files: writes.map((write) => ({
      path: write.relative,
      operation: write.operation,
      additions: write.additions,
      deletions: write.deletions,
      beforeSha256: hashContent(write.originalContent),
      afterSha256: hashContent(write.content),
    })),
  }
}

function buildReversePatch(writes: PreparedPatchWrite[]): string {
  return writes
    .map((write) => {
      if (write.operation === 'create') {
        return buildWholeFilePatch({
          oldPath: write.relative,
          oldContent: write.content ?? '',
          newPath: null,
          newContent: null,
        })
      }

      if (write.operation === 'delete') {
        return buildWholeFilePatch({
          oldPath: null,
          oldContent: null,
          newPath: write.relative,
          newContent: write.originalContent ?? '',
        })
      }

      return buildWholeFilePatch({
        oldPath: write.relative,
        oldContent: write.content ?? '',
        newPath: write.relative,
        newContent: write.originalContent ?? '',
      })
    })
    .join('\n')
}

function buildWholeFilePatch(args: {
  oldPath: string | null
  oldContent: string | null
  newPath: string | null
  newContent: string | null
}): string {
  const oldLines = textToPatchLines(args.oldContent ?? '')
  const newLines = textToPatchLines(args.newContent ?? '')
  const oldStart = oldLines.length > 0 ? 1 : 0
  const newStart = newLines.length > 0 ? 1 : 0
  const header = [
    `--- ${args.oldPath === null ? '/dev/null' : `a/${args.oldPath}`}`,
    `+++ ${args.newPath === null ? '/dev/null' : `b/${args.newPath}`}`,
    `@@ -${oldStart},${oldLines.length} +${newStart},${newLines.length} @@`,
  ]
  const body = [
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
  ]
  return [...header, ...body, ''].join('\n')
}

function hashContent(value: string | null): string | null {
  if (value === null) return null
  return createHash('sha256').update(value, 'utf-8').digest('hex')
}

async function resolveInsideProject(
  workDir: string,
  inputPath: string,
  options: { mustExist: boolean },
): Promise<string> {
  if (!inputPath.trim()) throw new Error('Path is required.')
  const root = await fs.realpath(workDir)
  const absolute = path.resolve(root, inputPath)
  const targetForBoundary = options.mustExist
    ? await fs.realpath(absolute)
    : await resolveExistingParent(absolute)
  const relative = path.relative(root, targetForBoundary)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the project workspace: ${inputPath}`)
  }
  return absolute
}

async function resolveExistingParent(filePath: string): Promise<string> {
  let current = path.dirname(filePath)
  while (true) {
    try {
      const stat = await fs.stat(current)
      if (stat.isDirectory()) return await fs.realpath(current)
    } catch {
      const next = path.dirname(current)
      if (next === current) throw new Error(`No existing parent directory for ${filePath}`)
      current = next
    }
  }
}

async function ensureTextFile(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error(`${filePath} is not a file.`)
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`${filePath} is too large to read safely.`)
  }
  if (!(await isLikelyTextFile(filePath))) {
    throw new Error(`${filePath} does not look like a text file.`)
  }
}

async function isLikelyTextFile(filePath: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) return true
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat || stat.size > MAX_FILE_BYTES) return false
  const handle = await fs.open(filePath, 'r').catch(() => null)
  if (!handle) return false
  try {
    const buffer = Buffer.alloc(Math.min(512, stat.size))
    await handle.read(buffer, 0, buffer.length, 0)
    return !buffer.includes(0)
  } finally {
    await handle.close()
  }
}

function toProjectRelative(workDir: string, absolute: string): string {
  return path.relative(workDir, absolute).replace(/\\/g, '/')
}

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {}
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`)
  return value
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isToolRuntimeOptions(
  value: ComputerUseRuntime | ToolRuntimeOptions,
): value is ToolRuntimeOptions {
  return !(
    value &&
    typeof value === 'object' &&
    'getDefinitions' in value &&
    'getRisk' in value &&
    'hasTool' in value &&
    'execute' in value
  )
}

function withDuration(
  result: ToolExecutionResult,
  startedAt: number,
): ToolExecutionResult {
  return {
    ...result,
    metadata: {
      ...result.metadata,
      durationMs: Date.now() - startedAt,
    },
  }
}

function countLines(value: string): number {
  if (!value) return 0
  return value.split(/\r?\n/).length
}

export const toolRuntime = new ToolRuntime()
