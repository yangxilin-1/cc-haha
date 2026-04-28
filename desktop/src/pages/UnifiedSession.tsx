import { useModeStore } from '../stores/modeStore'
import { useSessionStore } from '../stores/sessionStore'
import { CodeSession } from '../modes/code/CodeSession'
import { ChatSession } from '../modes/chat/ChatSession'
import { WorkspaceShell } from '../components/workspace/WorkspaceShell'

interface UnifiedSessionProps {
  sessionId: string
}

export function UnifiedSession({ sessionId }: UnifiedSessionProps) {
  const storedMode = useModeStore((s) => s.getSessionMode(sessionId))
  const sessionMode = useSessionStore((s) => s.sessions.find((session) => session.id === sessionId)?.mode)
  const mode = sessionMode ?? storedMode

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 根据模式渲染不同的会话界面 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'code' ? (
          <WorkspaceShell sessionId={sessionId}>
            <CodeSession sessionId={sessionId} />
          </WorkspaceShell>
        ) : (
          <ChatSession sessionId={sessionId} />
        )}
      </div>
    </div>
  )
}
