import { ActiveSession } from '../../pages/ActiveSession'

interface CodeSessionProps {
  sessionId: string
}

export function CodeSession({ sessionId }: CodeSessionProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 复用现有的 ActiveSession，包含桌面端原生工具能力 */}
      <ActiveSession sessionId={sessionId} />
    </div>
  )
}
