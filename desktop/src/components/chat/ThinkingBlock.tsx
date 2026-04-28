import { useState, useEffect, useRef } from 'react'
import { useTranslation } from '../../i18n'

export function ThinkingBlock({ content, isActive = false }: { content: string; isActive?: boolean }) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (expanded && isActive && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [content, expanded, isActive])

  // Preview: take first meaningful line, not first 140 chars
  const lines = content.split('\n').filter((l) => l.trim())
  const firstLine = lines[0]?.replace(/\s+/g, ' ').trim() || ''
  const preview = firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine

  return (
    <div className="mb-3">
      <style>{thinkingStyles}</style>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)]/45 hover:text-[var(--color-text-secondary)]"
      >
        <span className="relative flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden="true">
          {isActive && <span className="absolute h-3 w-3 rounded-full bg-[var(--color-brand)]/20 animate-ping" />}
          <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-outline)]'}`} />
        </span>
        <span className="shrink-0 font-medium text-[var(--color-text-secondary)]">
          {t('thinking.label')}
          {isActive && <span className="thinking-dots" />}
        </span>
        {!expanded && preview && (
          <span className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-[11px] text-[var(--color-text-tertiary)]">
            {preview}
            {isActive && <span className="thinking-inline-cursor" />}
          </span>
        )}
      </button>
      {expanded && (
        <div
          ref={contentRef}
          className="ml-7 mt-1 max-h-[300px] overflow-y-auto border-l border-[var(--color-border)]/60 px-3 py-2 font-[var(--font-mono)] text-[11px] leading-[1.35] text-[var(--color-text-secondary)] whitespace-pre-wrap break-words"
        >
          {content}
          {isActive && expanded && <span className="thinking-cursor" />}
        </div>
      )}
    </div>
  )
}

const thinkingStyles = `
@keyframes thinking-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes thinking-dots {
  0%, 20% { content: ''; }
  40% { content: '.'; }
  60% { content: '..'; }
  80%, 100% { content: '...'; }
}
.thinking-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--color-text-tertiary);
  vertical-align: middle;
  margin-left: 1px;
  animation: thinking-cursor-blink 1s step-end infinite;
}
.thinking-inline-cursor {
  display: inline-block;
  width: 1px;
  height: 0.95em;
  margin-left: 3px;
  vertical-align: text-bottom;
  background: var(--color-text-tertiary);
  animation: thinking-cursor-blink 1s step-end infinite;
}
.thinking-dots::after {
  content: '';
  animation: thinking-dots 1.4s steps(1, end) infinite;
}
`
