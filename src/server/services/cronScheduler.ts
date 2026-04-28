/**
 * CronScheduler — Execution engine for scheduled tasks
 *
 * Periodically checks all scheduled tasks and executes those whose cron
 * expression matches the current time. Tasks are run through the native
 * desktop CodeEngine. Execution history is persisted to
 * Ycode desktop config/scheduled_tasks_log.json.
 */

import * as fs from 'fs/promises'
import { existsSync, statSync } from 'node:fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { CronService, type CronTask } from './cronService.js'
import { SessionService } from './sessionService.js'
import { sendTaskNotification } from './notificationService.js'
import { CodeEngine } from '../runtime/CodeEngine.js'
import { getDesktopConfigDir } from '../utils/paths.js'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TaskRun = {
  id: string // random ID
  taskId: string // references CronTask.id
  taskName: string
  startedAt: string // ISO timestamp
  completedAt?: string
  status: 'running' | 'completed' | 'failed' | 'timeout'
  prompt: string
  output?: string // captured stdout summary
  error?: string
  exitCode?: number
  durationMs?: number
  sessionId?: string // links to a session for rich output rendering
}

// ─── Output extraction ────────────────────────────────────────────────────────

// ─── Cron expression matching ──────────────────────────────────────────────────

/**
 * Check whether a single cron field matches a given numeric value.
 *
 * Supported syntax per field:
 *   *          — any value
 *   5          — exact match
 *   1,3,5      — list
 *   1-5        — inclusive range
 *   *​/2        — step from 0
 *   1-10/3     — step within a range
 */
export function fieldMatches(field: string, value: number): boolean {
  if (field === '*') return true

  // Comma-separated list — each element can be a range or step
  const parts = field.split(',')
  return parts.some((part) => singleFieldMatches(part.trim(), value))
}

function singleFieldMatches(part: string, value: number): boolean {
  // Step: */n or range/n
  if (part.includes('/')) {
    const [rangePart, stepStr] = part.split('/')
    const step = parseInt(stepStr, 10)
    if (isNaN(step) || step <= 0) return false

    if (rangePart === '*') {
      return value % step === 0
    }
    // range/step  e.g. 1-10/3
    if (rangePart.includes('-')) {
      const [startStr, endStr] = rangePart.split('-')
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (value < start || value > end) return false
      return (value - start) % step === 0
    }
    // single/step  e.g. 5/2  — treat as start with step
    const start = parseInt(rangePart, 10)
    if (value < start) return false
    return (value - start) % step === 0
  }

  // Range: a-b
  if (part.includes('-')) {
    const [startStr, endStr] = part.split('-')
    const start = parseInt(startStr, 10)
    const end = parseInt(endStr, 10)
    return value >= start && value <= end
  }

  // Exact number
  return parseInt(part, 10) === value
}

/**
 * Check whether a standard 5-field cron expression matches the given date.
 * Fields: minute hour day-of-month month day-of-week
 */
export function cronMatches(cronExpr: string, date: Date): boolean {
  const fields = cronExpr.trim().split(/\s+/)
  if (fields.length !== 5) return false

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  return (
    fieldMatches(minute, date.getMinutes()) &&
    fieldMatches(hour, date.getHours()) &&
    fieldMatches(dayOfMonth, date.getDate()) &&
    fieldMatches(month, date.getMonth() + 1) &&
    fieldMatches(dayOfWeek, date.getDay())
  )
}

// ─── Log file I/O ──────────────────────────────────────────────────────────────

type RunsFile = { runs: TaskRun[] }

function getLogFilePath(): string {
  return path.join(getDesktopConfigDir(), 'scheduled_tasks_log.json')
}

async function readRunsFile(): Promise<RunsFile> {
  try {
    const raw = await fs.readFile(getLogFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as RunsFile
    if (!Array.isArray(parsed.runs)) return { runs: [] }
    return parsed
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { runs: [] }
    }
    throw err
  }
}

async function writeRunsFile(data: RunsFile): Promise<void> {
  const filePath = getLogFilePath()
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })

  const tmpFile = `${filePath}.tmp.${Date.now()}`
  try {
    await fs.writeFile(tmpFile, JSON.stringify(data, null, 2) + '\n', 'utf-8')
    await fs.rename(tmpFile, filePath)
  } catch (err) {
    await fs.unlink(tmpFile).catch(() => {})
    throw err
  }
}

/** Append a run to the log and trim to keep at most MAX_RUNS_PER_TASK per task. */
async function appendRun(run: TaskRun): Promise<void> {
  const data = await readRunsFile()
  data.runs.push(run)
  trimRuns(data)
  await writeRunsFile(data)
}

/** Update an existing run in the log (matched by run.id). */
async function updateRun(run: TaskRun): Promise<void> {
  const data = await readRunsFile()
  const idx = data.runs.findIndex((r) => r.id === run.id)
  if (idx !== -1) {
    data.runs[idx] = run
  } else {
    data.runs.push(run)
  }
  trimRuns(data)
  await writeRunsFile(data)
}

const MAX_RUNS_PER_TASK = 100

/** Keep only the latest MAX_RUNS_PER_TASK entries per task. */
function trimRuns(data: RunsFile): void {
  const countByTask = new Map<string, number>()
  // Count from the end (newest first) and mark for removal
  const keep = new Array<boolean>(data.runs.length).fill(false)
  for (let i = data.runs.length - 1; i >= 0; i--) {
    const taskId = data.runs[i].taskId
    const count = countByTask.get(taskId) || 0
    if (count < MAX_RUNS_PER_TASK) {
      keep[i] = true
      countByTask.set(taskId, count + 1)
    }
  }
  data.runs = data.runs.filter((_, i) => keep[i])
}

// ─── Scheduler ─────────────────────────────────────────────────────────────────

const TASK_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

export class CronScheduler {
  private intervalId: Timer | null = null
  private runningTasks = new Map<
    string,
    { abortController: AbortController; startedAt: number; runId: string }
  >()
  /** Track which minute each task last fired (prevents same-process duplicate within a minute). */
  private lastFiredMinuteKey = new Map<string, string>()
  private cronService: CronService
  private sessionService: SessionService
  private engine: CodeEngine

  constructor(cronService?: CronService, engine?: CodeEngine) {
    this.cronService = cronService || new CronService()
    this.sessionService = new SessionService()
    this.engine = engine || new CodeEngine()
  }

  /** Return a string key representing the calendar minute of `date`. */
  private static minuteKey(date: Date): string {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`
  }

  /** Start the scheduler (called on server boot). */
  start(): void {
    if (this.intervalId) return // already running
    console.log('[CronScheduler] Starting — checking every 60 s')
    // Clean up stale "running" entries left by previously crashed processes
    this.cleanupStaleRuns().catch((err) =>
      console.error('[CronScheduler] Error cleaning up stale runs:', err),
    )
    this.intervalId = setInterval(() => this.tick(), 60_000)
    // Immediate first check
    this.tick()
  }

  /** Stop the scheduler and kill any running task processes. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    for (const [taskId, entry] of this.runningTasks) {
      entry.abortController.abort()
      this.runningTasks.delete(taskId)
    }
    console.log('[CronScheduler] Stopped')
  }

  /** One tick of the scheduler — evaluate all tasks against the current time. */
  async tick(): Promise<void> {
    try {
      const tasks = await this.cronService.listTasks()
      const now = new Date()
      const currentKey = CronScheduler.minuteKey(now)

      for (const task of tasks) {
        // Skip disabled tasks
        if (task.enabled === false) continue

        // Skip if already running (in-memory guard — same process)
        if (this.runningTasks.has(task.id)) continue

        // Skip if this process already fired the task in the current minute
        if (this.lastFiredMinuteKey.get(task.id) === currentKey) continue

        // Skip if ANY process already fired the task in the current minute
        // (cross-process guard via file-persisted lastFiredAt)
        if (task.lastFiredAt) {
          const lastFiredKey = CronScheduler.minuteKey(new Date(task.lastFiredAt))
          if (lastFiredKey === currentKey) continue
        }

        if (cronMatches(task.cron, now)) {
          // Record the minute key BEFORE firing to prevent double-fire
          this.lastFiredMinuteKey.set(task.id, currentKey)
          // Fire and forget — don't await; we want all matching tasks to start
          this.executeTask(task).catch((err) => {
            console.error(
              `[CronScheduler] Unhandled error executing task ${task.id}:`,
              err,
            )
          })
        }
      }
    } catch (err) {
      console.error('[CronScheduler] Error during tick:', err)
    }
  }

  /**
   * Execute a single task through the native desktop runtime.
   * @param task The task to execute
   * @param options.createSession Kept for API compatibility; native execution always creates a session so the transcript can be inspected.
   */
  async executeTask(task: CronTask, options?: { createSession?: boolean }): Promise<TaskRun> {
    void options

    // Prevent concurrent executions of the same task
    const existing = this.runningTasks.get(task.id)
    if (existing) {
      console.log(
        `[CronScheduler] Task ${task.id} is already running (runId=${existing.runId}), skipping`,
      )
      return {
        id: existing.runId,
        taskId: task.id,
        taskName: task.name || task.prompt.slice(0, 60),
        startedAt: new Date(existing.startedAt).toISOString(),
        status: 'running',
        prompt: task.prompt,
      }
    }

    const runId = crypto.randomBytes(6).toString('hex')
    const startedAt = new Date().toISOString()
    let workDir = task.folderPath || os.homedir()
    if (task.folderPath && (!existsSync(task.folderPath) || !statSync(task.folderPath).isDirectory())) {
      console.warn(`[cron] task ${task.id}: folderPath "${task.folderPath}" is not a valid directory, falling back to homedir`)
      workDir = os.homedir()
    }

    let sessionId: string | undefined

    const run: TaskRun = {
      id: runId,
      taskId: task.id,
      taskName: task.name || task.prompt.slice(0, 60),
      startedAt,
      status: 'running',
      prompt: task.prompt,
      sessionId,
    }

    // Update lastFiredAt IMMEDIATELY so other scheduler processes see it
    // and skip this task in the current minute (cross-process dedup).
    await this.cronService.updateLastFired(task.id, startedAt)

    // Persist the "running" state
    await appendRun(run)

    const abortController = new AbortController()
    this.runningTasks.set(task.id, {
      abortController,
      startedAt: Date.now(),
      runId,
    })

    // Set up a timeout
    const timeoutId = setTimeout(() => {
      if (this.runningTasks.has(task.id)) abortController.abort()
    }, TASK_TIMEOUT_MS)

    try {
      const result = await this.sessionService.createSession(workDir, 'code')
      sessionId = result.sessionId
      run.sessionId = sessionId
      await updateRun(run)

      const outputParts: string[] = []
      let runtimeError: string | undefined
      let completed = false

      for await (const event of this.engine.sendMessage({
        sessionId,
        content: task.prompt,
        settings: {
          permissionMode: task.permissionMode || 'dontAsk',
          model: task.model,
          mode: 'code',
        },
        signal: abortController.signal,
      })) {
        if (event.type === 'content_delta' && event.text) {
          outputParts.push(event.text)
        }
        if (event.type === 'error') {
          runtimeError = event.message
        }
        if (event.type === 'message_complete') {
          completed = true
        }
      }

      clearTimeout(timeoutId)
      this.runningTasks.delete(task.id)

      const completedAt = new Date().toISOString()
      const durationMs =
        new Date(completedAt).getTime() - new Date(startedAt).getTime()

      const status = abortController.signal.aborted
        ? 'timeout'
        : runtimeError || !completed
          ? 'failed'
          : 'completed'

      const completedRun: TaskRun = {
        ...run,
        completedAt,
        status,
        output: outputParts.join('').trim().slice(0, 50_000),
        exitCode: status === 'completed' ? 0 : 1,
        durationMs,
        ...(runtimeError ? { error: runtimeError.slice(0, 5_000) } : {}),
      }

      await updateRun(completedRun)

      // Send IM notification if configured
      if (task.notification?.enabled && task.notification.channels.length > 0) {
        sendTaskNotification(completedRun, task.notification).catch((err) => {
          console.error(`[CronScheduler] Notification error for task ${task.id}:`, err)
        })
      }

      // If non-recurring, disable after first run
      if (!task.recurring) {
        await this.cronService.updateTask(task.id, { enabled: false }).catch(() => {
          // Task may have been deleted
        })
      }

      return completedRun
    } catch (err) {
      clearTimeout(timeoutId)
      this.runningTasks.delete(task.id)

      const completedAt = new Date().toISOString()
      const failedRun: TaskRun = {
        ...run,
        ...(sessionId ? { sessionId } : {}),
        completedAt,
        status: abortController.signal.aborted ? 'timeout' : 'failed',
        error: (err as Error).message,
        exitCode: 1,
        durationMs:
          new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      }

      await updateRun(failedRun)

      if (task.notification?.enabled && task.notification.channels.length > 0) {
        sendTaskNotification(failedRun, task.notification).catch((notifyErr) => {
          console.error(`[CronScheduler] Notification error for task ${task.id}:`, notifyErr)
        })
      }

      if (!task.recurring) {
        await this.cronService.updateTask(task.id, { enabled: false }).catch(() => {
          // Task may have been deleted
        })
      }

      return failedRun
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  /**
   * Mark stale "running" entries as "failed" on startup.
   * These are leftover from previous process instances that crashed or were
   * killed before they could update the run log.
   */
  private async cleanupStaleRuns(): Promise<void> {
    const data = await readRunsFile()
    let changed = false
    const now = Date.now()

    for (const run of data.runs) {
      if (run.status !== 'running') continue
      const startedAt = new Date(run.startedAt).getTime()
      // If "running" for longer than the task timeout + 1-minute buffer,
      // the owning process is certainly dead.
      if (now - startedAt > TASK_TIMEOUT_MS + 60_000) {
        run.status = 'failed'
        run.error = 'Process terminated before task could complete'
        run.completedAt = new Date().toISOString()
        run.durationMs = now - startedAt
        changed = true
        console.log(
          `[CronScheduler] Cleaned up stale run ${run.id} for task ${run.taskId}`,
        )
      }
    }

    if (changed) {
      await writeRunsFile(data)
    }
  }

  // ─── Query helpers ─────────────────────────────────────────────────────────

  /** Get execution history for a specific task. */
  async getTaskRuns(taskId: string): Promise<TaskRun[]> {
    const data = await readRunsFile()
    return data.runs
      .filter((r) => r.taskId === taskId)
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      )
  }

  /** Get recent runs across all tasks. */
  async getRecentRuns(limit = 50): Promise<TaskRun[]> {
    const data = await readRunsFile()
    return data.runs
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      )
      .slice(0, limit)
  }
}

// ─── Singleton export ──────────────────────────────────────────────────────────

export const cronScheduler = new CronScheduler()
