// Source: src/server/services/taskService.ts (Ycode Desktop runtime tasks)

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type DesktopTask = {
  id: string
  subject: string
  description: string
  activeForm?: string
  owner?: string
  status: TaskStatus
  blocks: string[]
  blockedBy: string[]
  metadata?: Record<string, unknown>
  taskListId: string
}

export type TaskListSummary = {
  id: string
  taskCount: number
  completedCount: number
  inProgressCount: number
  pendingCount: number
}
