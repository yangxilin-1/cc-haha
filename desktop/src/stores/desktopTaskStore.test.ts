import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { desktopTasksApi } from '../api/desktopTasks'
import type { DesktopTask, TaskStatus } from '../types/desktopTask'
import { useDesktopTaskStore } from './desktopTaskStore'

vi.mock('../api/desktopTasks', () => ({
  desktopTasksApi: {
    getTasksForList: vi.fn(),
    resetTaskList: vi.fn(),
  },
}))

function makeTask(taskListId: string, status: TaskStatus = 'in_progress'): DesktopTask {
  return {
    id: '1',
    subject: 'Keep current session isolated',
    description: '',
    status,
    blocks: [],
    blockedBy: [],
    taskListId,
  }
}

describe('DesktopTaskStore', () => {
  beforeEach(() => {
    useDesktopTaskStore.getState().clearTasks()
    vi.clearAllMocks()
  })

  afterEach(() => {
    useDesktopTaskStore.getState().clearTasks()
  })

  it('clears stale tasks immediately when switching tracked sessions', async () => {
    let resolveRequest: ((value: { tasks: ReturnType<typeof makeTask>[] }) => void) | null = null

    vi.mocked(desktopTasksApi.getTasksForList).mockImplementation(
      (sessionId: string) =>
        new Promise<{ tasks: ReturnType<typeof makeTask>[] }>((resolve) => {
          if (sessionId === 'session-2') resolveRequest = resolve
        }),
    )

    useDesktopTaskStore.setState({
      sessionId: 'session-1',
      tasks: [makeTask('session-1')],
      expanded: true,
      completedAndDismissed: true,
      dismissedCompletionKey: 'session-1::done',
    })

    const fetchPromise = useDesktopTaskStore.getState().fetchSessionTasks('session-2')

    expect(useDesktopTaskStore.getState()).toMatchObject({
      sessionId: 'session-2',
      tasks: [],
      expanded: false,
      completedAndDismissed: false,
      dismissedCompletionKey: null,
    })

    expect(resolveRequest).not.toBeNull()
    resolveRequest!({ tasks: [makeTask('session-2', 'completed')] })
    await fetchPromise

    expect(useDesktopTaskStore.getState().tasks).toMatchObject([
      { taskListId: 'session-2', status: 'completed' },
    ])
  })

  it('resets a completed task list locally before clearing it remotely', async () => {
    let resolveReset: ((value: { ok: true }) => void) | null = null

    vi.mocked(desktopTasksApi.resetTaskList).mockImplementation(
      () => new Promise<{ ok: true }>((resolve) => {
        resolveReset = resolve
      }),
    )

    useDesktopTaskStore.setState({
      sessionId: 'session-1',
      tasks: [
        makeTask('session-1', 'completed'),
        { ...makeTask('session-1', 'completed'), id: '2', subject: 'Second completed task' },
      ],
      expanded: true,
      completedAndDismissed: true,
      dismissedCompletionKey: 'session-1::done',
    })

    const resetPromise = useDesktopTaskStore.getState().resetCompletedTasks()

    expect(vi.mocked(desktopTasksApi.resetTaskList)).toHaveBeenCalledWith('session-1')
    expect(useDesktopTaskStore.getState()).toMatchObject({
      tasks: [],
      resetting: true,
      completedAndDismissed: false,
      dismissedCompletionKey: null,
      expanded: false,
    })

    expect(resolveReset).not.toBeNull()
    resolveReset!({ ok: true })
    await resetPromise

    expect(useDesktopTaskStore.getState().resetting).toBe(false)
  })
})
