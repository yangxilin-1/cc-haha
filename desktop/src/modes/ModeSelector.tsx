import type { ReactNode } from 'react'
import { Code2, MessagesSquare } from 'lucide-react'
import { useModeStore } from '../stores/modeStore'
import { useSessionStore } from '../stores/sessionStore'
import { useTabStore } from '../stores/tabStore'
import type { SessionMode } from './types'

const MODE_ITEMS: Array<{ mode: SessionMode; label: string; Icon: typeof Code2 }> = [
  { mode: 'chat', label: 'Chat', Icon: MessagesSquare },
  { mode: 'code', label: 'Code', Icon: Code2 },
]

export function ModeSelector() {
  const currentMode = useModeStore((s) => s.currentMode)
  const setCurrentMode = useModeStore((s) => s.setCurrentMode)

  const switchMode = (mode: SessionMode) => {
    if (mode === currentMode) return
    setCurrentMode(mode)
    useSessionStore.getState().setActiveSession(null)
    useTabStore.setState({ activeTabId: null })
  }

  return (
    <div
      role="tablist"
      aria-label="Mode switcher"
      className="mode-switcher"
    >
      <span
        aria-hidden="true"
        className="mode-switcher-indicator pointer-events-none"
        style={{ transform: currentMode === 'code' ? 'translateX(calc(100% + 8px))' : 'translateX(0)' }}
      />
      {MODE_ITEMS.map(({ mode, label, Icon }) => (
        <ModeTab
          key={mode}
          active={currentMode === mode}
          onClick={() => switchMode(mode)}
          label={label}
          icon={<Icon size={14} strokeWidth={1.9} />}
        />
      ))}
    </div>
  )
}

function ModeTab({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-active={active}
      onClick={onClick}
      className="mode-switcher-tab focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]/35"
    >
      {icon}
      {label}
    </button>
  )
}
