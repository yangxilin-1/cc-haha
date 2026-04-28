import { useEffect } from 'react'
import { useTabStore } from '../stores/tabStore'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'
import { useDesktopTaskStore } from '../stores/desktopTaskStore'
import { useTeamStore } from '../stores/teamStore'
import { useTranslation } from '../i18n'
import { MessageList } from '../components/chat/MessageList'
import { ChatInput } from '../components/chat/ChatInput'
import { ComputerUsePermissionModal } from '../components/chat/ComputerUsePermissionModal'
import { TeamStatusBar } from '../components/teams/TeamStatusBar'
import { SessionTaskBar } from '../components/chat/SessionTaskBar'

const TASK_POLL_INTERVAL_MS = 1000

type ActiveSessionProps = {
  sessionId?: string
}

export function ActiveSession({ sessionId }: ActiveSessionProps = {}) {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const currentSessionId = sessionId ?? activeTabId
  const sessions = useSessionStore((s) => s.sessions)
  const connectToSession = useChatStore((s) => s.connectToSession)
  const sessionState = useChatStore((s) => currentSessionId ? s.sessions[currentSessionId] : undefined)
  const pendingComputerUsePermission = sessionState?.pendingComputerUsePermission ?? null
  const fetchSessionTasks = useDesktopTaskStore((s) => s.fetchSessionTasks)
  const trackedTaskSessionId = useDesktopTaskStore((s) => s.sessionId)
  const hasIncompleteTasks = useDesktopTaskStore((s) => s.tasks.some((task) => task.status !== 'completed'))
  const chatState = sessionState?.chatState ?? 'idle'

  const session = sessions.find((s) => s.id === currentSessionId)
  const memberInfo = useTeamStore((s) => currentSessionId ? s.getMemberBySessionId(currentSessionId) : null)
  const activeTeam = useTeamStore((s) => s.activeTeam)
  const isMemberSession = !!memberInfo

  useEffect(() => {
    if (currentSessionId && !isMemberSession) {
      connectToSession(currentSessionId)
    }
  }, [currentSessionId, isMemberSession, connectToSession])

  useEffect(() => {
    if (!currentSessionId || isMemberSession) return

    const shouldPollTasks =
      chatState !== 'idle' ||
      (trackedTaskSessionId === currentSessionId && hasIncompleteTasks)

    if (!shouldPollTasks) return

    void fetchSessionTasks(currentSessionId)

    const timer = setInterval(() => {
      void fetchSessionTasks(currentSessionId)
    }, TASK_POLL_INTERVAL_MS)

    return () => clearInterval(timer)
  }, [
    currentSessionId,
    isMemberSession,
    chatState,
    trackedTaskSessionId,
    hasIncompleteTasks,
    fetchSessionTasks,
  ])

  const t = useTranslation()
  const messages = sessionState?.messages ?? []
  const streamingText = sessionState?.streamingText ?? ''
  const isEmpty = messages.length === 0 && !streamingText && chatState === 'idle'

  if (!currentSessionId) return null

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-on-surface">
      {isMemberSession && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-container)]">
          <div className="mx-auto max-w-[860px] flex items-center justify-between gap-4 px-8 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                {memberInfo?.status === 'running' && (
                  <span className="flex h-2 w-2 rounded-full bg-[var(--color-warning)] animate-pulse-dot" />
                )}
                {memberInfo?.status === 'completed' && (
                  <span className="material-symbols-outlined text-[14px] text-[var(--color-success)]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                )}
                <span className="material-symbols-outlined text-[14px] text-[var(--color-text-tertiary)]">smart_toy</span>
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {memberInfo?.role}
                </span>
                {activeTeam && (
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">
                    @ {activeTeam.name}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                {t('teams.memberSessionHint')}
              </p>
            </div>
            <button
              onClick={() => {
                if (activeTeam?.leadSessionId) {
                  useTabStore.getState().openTab(
                    activeTeam.leadSessionId,
                    t('teams.leader'),
                    'session',
                  )
                }
              }}
              disabled={!activeTeam?.leadSessionId}
              className="flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-50 disabled:hover:text-[var(--color-text-secondary)]"
            >
              <span className="material-symbols-outlined text-[14px]">arrow_back</span>
              {t('teams.backToLeader')}
            </button>
          </div>
        </div>
      )}

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 pb-32">
          <div className="flex max-w-md flex-col items-center text-center">
            {isMemberSession ? (
              <>
                <span className="material-symbols-outlined text-[48px] mb-4 text-[var(--color-text-tertiary)]">smart_toy</span>
                <p className="text-[var(--color-text-secondary)]">
                  {memberInfo?.status === 'running'
                    ? `${memberInfo.role} ${t('teams.working')}`
                    : t('teams.noMessages')}
                </p>
              </>
            ) : (
              <>
                <img src="/app-icon.jpg" alt="Ycode" className="mb-6 h-24 w-24 rounded-[22px]" style={{ boxShadow: 'var(--shadow-dropdown)' }} />
                <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
                  {t('empty.title')}
                </h1>
                <p className="mx-auto max-w-xs text-[var(--color-text-secondary)]" style={{ fontFamily: 'var(--font-body)' }}>
                  {t('empty.subtitle')}
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          {!isMemberSession && session?.mode !== 'chat' && session?.workDirExists === false && (
            <div className="mx-auto mt-3 flex w-full max-w-[860px] items-center gap-2 rounded-lg border border-[var(--color-error)]/20 px-3 py-1.5 text-[11px] text-[var(--color-error)]">
              <span className="material-symbols-outlined text-[14px]">warning</span>
              <span className="truncate">
                {t('session.workspaceUnavailable', { dir: session.workDir || 'directory no longer exists' })}
              </span>
            </div>
          )}
          <MessageList />
        </>
      )}

      {!isMemberSession && <SessionTaskBar />}

      <TeamStatusBar />

      <ChatInput variant={isEmpty && !isMemberSession ? 'hero' : 'default'} mode={session?.mode ?? 'code'} />

      {!isMemberSession && currentSessionId ? (
        <ComputerUsePermissionModal
          sessionId={currentSessionId}
          request={pendingComputerUsePermission?.request ?? null}
        />
      ) : null}
    </div>
  )
}
