import { useState } from 'react'
import { Code2, MessageSquare } from 'lucide-react'
import { Modal } from '../shared/Modal'
import { Button } from '../shared/Button'
import { useModeStore } from '../../stores/modeStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useChatStore } from '../../stores/chatStore'
import { SessionMode } from '../../modes/types'
import { FolderLineIcon } from '../shared/LineIcons'

interface NewSessionModalProps {
  isOpen: boolean
  onClose: () => void
  defaultWorkDir?: string
}

export function NewSessionModal({ isOpen, onClose, defaultWorkDir }: NewSessionModalProps) {
  const [selectedMode, setSelectedMode] = useState<SessionMode>('code')
  const [workDir, setWorkDir] = useState(defaultWorkDir || '')
  const [creating, setCreating] = useState(false)

  const createSession = useSessionStore((s) => s.createSession)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const setCurrentView = useSessionStore((s) => s.setCurrentView)
  const initSessionMode = useModeStore((s) => s.initSessionMode)
  const setCurrentMode = useModeStore((s) => s.setCurrentMode)
  const connectToSession = useChatStore((s) => s.connectToSession)

  const handleSelectFolder = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Working Directory',
      })
      if (selected && typeof selected === 'string') {
        setWorkDir(selected)
      }
    } catch (error) {
      console.error('Failed to select folder:', error)
    }
  }

  const handleCreate = async () => {
    setCreating(true)
    try {
      const finalWorkDir = selectedMode === 'code' ? workDir || undefined : undefined
      const sessionId = await createSession(finalWorkDir, selectedMode)

      // Initialize mode
      initSessionMode(sessionId, selectedMode, finalWorkDir)

      // 同步全局视图筛选模式，避免创建后在当前视图中看不到新会话
      setCurrentMode(selectedMode)

      // Set as active session and connect
      setActiveSession(sessionId)
      setCurrentView('session')
      connectToSession(sessionId)

      onClose()
    } catch (error) {
      console.error('Failed to create session:', error)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Modal open={isOpen} onClose={onClose} title="New Session">
      <div className="space-y-4">
        {/* Mode Selection */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
            Select Mode
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setSelectedMode('code')}
              className={`
                flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all
                ${selectedMode === 'code'
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'
                }
              `}
            >
              <Code2 size={24} className={selectedMode === 'code' ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]'} />
              <div className="text-center">
                <div className="font-semibold text-sm text-[var(--color-text-primary)]">Code</div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Project tools, files, MCP
                </div>
              </div>
            </button>

            <button
              onClick={() => setSelectedMode('chat')}
              className={`
                flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all
                ${selectedMode === 'chat'
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'
                }
              `}
            >
              <MessageSquare size={24} className={selectedMode === 'chat' ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]'} />
              <div className="text-center">
                <div className="font-semibold text-sm text-[var(--color-text-primary)]">Chat</div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  Pure conversation, no tools
                </div>
              </div>
            </button>
          </div>
        </div>

        {/* Working Directory (Code mode only) */}
        {selectedMode === 'code' && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-2">
              Working Directory (Optional)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={workDir}
                onChange={(e) => setWorkDir(e.target.value)}
                placeholder="/path/to/project"
                className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              />
              <Button
                onClick={handleSelectFolder}
                variant="secondary"
                className="shrink-0"
              >
                <FolderLineIcon size={16} />
              </Button>
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              Select a project directory for file operations
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} variant="secondary" disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'Create Session'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
