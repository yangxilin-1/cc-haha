import { FormEvent, useEffect, useRef, useState } from 'react'
import { workspaceApi } from '../../api/workspace'
import { TerminalLineIcon } from '../shared/LineIcons'

type Props = {
  sessionId: string
  workDir?: string | null
}

type TerminalEntry = {
  id: string
  kind: 'command' | 'output' | 'error'
  text: string
}

export function WorkspaceTerminal({ sessionId, workDir }: Props) {
  const [command, setCommand] = useState('')
  const [running, setRunning] = useState(false)
  const [entries, setEntries] = useState<TerminalEntry[]>(() => [
    {
      id: 'welcome',
      kind: 'output',
      text: `${typeof navigator !== 'undefined' && navigator.platform.includes('Win') ? 'Windows PowerShell' : 'Shell'}\n${workDir || ''}`,
    },
  ])
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [entries, running])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = command.trim()
    if (!trimmed || running) return

    setCommand('')
    setRunning(true)
    const id = `${Date.now()}`
    setEntries((current) => [
      ...current,
      { id: `${id}-cmd`, kind: 'command', text: trimmed },
    ])

    try {
      const result = await workspaceApi.runTerminalCommand(sessionId, trimmed)
      const output = [result.stdout, result.stderr].filter(Boolean).join('')
      setEntries((current) => [
        ...current,
        {
          id: `${id}-out`,
          kind: result.exitCode === 0 ? 'output' : 'error',
          text: output || `(exit ${result.exitCode ?? 'timeout'})`,
        },
      ])
    } catch (error) {
      setEntries((current) => [
        ...current,
        {
          id: `${id}-err`,
          kind: 'error',
          text: error instanceof Error ? error.message : String(error),
        },
      ])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="h-[260px] shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex h-9 items-center gap-2 border-b border-[var(--color-border)]/60 px-4">
        <span className="text-[var(--color-text-tertiary)]"><TerminalLineIcon size={17} /></span>
        <span className="min-w-0 truncate text-[12px] text-[var(--color-text-secondary)]">
          {workDir || 'Terminal'}
        </span>
      </div>
      <div className="flex h-[calc(100%-36px)] flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-[var(--font-mono)] text-[12px] leading-6 text-[var(--color-text-primary)]">
          {entries.map((entry) => (
            <pre
              key={entry.id}
              className={`m-0 whitespace-pre-wrap break-words ${
                entry.kind === 'command'
                  ? 'text-[var(--color-brand)]'
                  : entry.kind === 'error'
                    ? 'text-[var(--color-error)]'
                    : 'text-[var(--color-text-secondary)]'
              }`}
            >
              {entry.kind === 'command' ? `PS ${shortPath(workDir)} > ${entry.text}` : entry.text}
            </pre>
          ))}
          {running && (
            <div className="text-[var(--color-text-tertiary)]">
              running...
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form onSubmit={handleSubmit} className="flex h-10 items-center gap-2 border-t border-[var(--color-border)]/60 px-4">
          <span className="font-[var(--font-mono)] text-[12px] text-[var(--color-text-tertiary)]">&gt;</span>
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            disabled={running}
            className="min-w-0 flex-1 bg-transparent font-[var(--font-mono)] text-[12px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:opacity-60"
            placeholder="输入命令后回车"
            spellCheck={false}
          />
        </form>
      </div>
    </div>
  )
}

function shortPath(path?: string | null): string {
  if (!path) return ''
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 2) return path
  return `${parts[0]}/.../${parts[parts.length - 1]}`
}
