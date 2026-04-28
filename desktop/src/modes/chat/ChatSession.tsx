import { useEffect } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useTranslation } from '../../i18n'
import { MessageList } from '../../components/chat/MessageList'
import { ChatInput } from '../../components/chat/ChatInput'
import { ComputerUsePermissionModal } from '../../components/chat/ComputerUsePermissionModal'

interface ChatSessionProps {
  sessionId: string
}

export function ChatSession({ sessionId }: ChatSessionProps) {
  const connectToSession = useChatStore((s) => s.connectToSession)
  const sessionState = useChatStore((s) => s.sessions[sessionId])
  const pendingComputerUsePermission = sessionState?.pendingComputerUsePermission ?? null

  const t = useTranslation()

  useEffect(() => {
    if (sessionId) {
      connectToSession(sessionId)
    }
  }, [sessionId, connectToSession])

  const messages = sessionState?.messages ?? []
  const streamingText = sessionState?.streamingText ?? ''
  const isEmpty = messages.length === 0 && !streamingText

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-on-surface">
      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 pb-32">
          <div className="flex max-w-md flex-col items-center text-center">
            <img src="/app-icon.jpg" alt="Ycode" className="mb-6 h-24 w-24 rounded-[22px]" style={{ boxShadow: 'var(--shadow-dropdown)' }} />
            <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
              Chat Mode
            </h1>
            <p className="mx-auto max-w-xs text-[var(--color-text-secondary)]" style={{ fontFamily: 'var(--font-body)' }}>
              {t('empty.subtitle')}
            </p>
          </div>
        </div>
      ) : (
        <MessageList />
      )}

      <ChatInput variant={isEmpty ? 'hero' : 'default'} mode="chat" />

      <ComputerUsePermissionModal
        sessionId={sessionId}
        request={pendingComputerUsePermission?.request ?? null}
      />
    </div>
  )
}
