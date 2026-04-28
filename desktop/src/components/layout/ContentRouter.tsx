import { useTabStore } from '../../stores/tabStore'
import { EmptySession } from '../../pages/EmptySession'
import { UnifiedSession } from '../../pages/UnifiedSession'
import { ScheduledTasks } from '../../pages/ScheduledTasks'
import { Settings } from '../../pages/Settings'

export function ContentRouter() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const activeTabType = useTabStore((s) => s.tabs.find((t) => t.sessionId === s.activeTabId)?.type)

  // No tabs open — show empty session
  if (!activeTabId || !activeTabType) {
    return <EmptySession />
  }

  // Special tabs
  if (activeTabType === 'settings') {
    return <Settings />
  }

  if (activeTabType === 'scheduled') {
    return <ScheduledTasks />
  }

  // Session tab — route through the mode-aware shell.
  return <UnifiedSession sessionId={activeTabId} />
}
