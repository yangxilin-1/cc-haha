import { Code2, MessageSquare } from 'lucide-react'
import { useModeStore } from '../stores/modeStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import type { SessionMode } from './types'

export function ModeSelector() {
  const currentMode = useModeStore((s) => s.currentMode)
  const setCurrentMode = useModeStore((s) => s.setCurrentMode)

  const handleSwitch = (newMode: SessionMode) => {
    if (newMode === currentMode) return
    setCurrentMode(newMode)
    // 切换模式同步切换会话：关闭当前会话，回到新模式的空状态页
    useSessionStore.getState().setActiveSession(null)
    useSessionStore.getState().setCurrentView('empty')
    useTabStore.setState({ activeTabId: null })
  }

  return (
    <div
      role="tablist"
      aria-label="Mode switcher"
      className="inline-flex items-center gap-0.5 p-[3px] rounded-full bg-[var(--color-surface-container)]/70 border border-[var(--color-border)]/50 backdrop-blur-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]"
    >
      <ModeButton
        active={currentMode === 'code'}
        onClick={() => handleSwitch('code')}
        icon={<Code2 size={13} strokeWidth={2.25} />}
        label="Code"
      />
      <ModeButton
        active={currentMode === 'chat'}
        onClick={() => handleSwitch('chat')}
        icon={<MessageSquare size={13} strokeWidth={2.25} />}
        label="Chat"
      />
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 h-[24px] px-3 rounded-full',
        'text-[12px] font-medium leading-none tracking-[0.01em]',
        'transition-all duration-150 ease-out',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand)]/40',
        active
          ? 'bg-[var(--color-surface-floating)] text-[var(--color-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_0.5px_rgba(0,0,0,0.04)]'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
      ].join(' ')}
    >
      <span className={active ? 'opacity-90' : 'opacity-70'}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

