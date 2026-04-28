import { useState } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useSessionStore } from '../../stores/sessionStore'
import { WorkspacePanel } from './WorkspacePanel'
import { WorkspaceTerminal } from './WorkspaceTerminal'

type Props = {
  sessionId: string
  children: React.ReactNode
}

export function WorkspaceShell({ sessionId, children }: Props) {
  const panels = useUIStore((s) => s.activeWorkspacePanels)
  const openPanel = useUIStore((s) => s.openWorkspacePanel)
  const closePanel = useUIStore((s) => s.closeWorkspacePanel)
  const terminalOpen = useUIStore((s) => s.terminalOpen)
  const session = useSessionStore((s) => s.sessions.find((item) => item.id === sessionId))
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const handleSelectFile = (path: string) => {
    setSelectedFile(path)
    openPanel('preview')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
          {children}
        </div>
        {panels.includes('files') && (
          <WorkspacePanel
            sessionId={sessionId}
            panel="files"
            selectedFile={selectedFile}
            onSelectFile={handleSelectFile}
            onClose={() => closePanel('files')}
          />
        )}
        {panels.includes('preview') && (
          <WorkspacePanel
            sessionId={sessionId}
            panel="preview"
            selectedFile={selectedFile}
            onSelectFile={handleSelectFile}
            onClose={() => closePanel('preview')}
          />
        )}
      </div>
      {terminalOpen && (
        <WorkspaceTerminal sessionId={sessionId} workDir={session?.workDir} />
      )}
    </div>
  )
}
