import { CodeViewer } from './CodeViewer'
import { useState } from 'react'
import { useTranslation } from '../../i18n'
import { InlineImageGallery } from './InlineImageGallery'

type Props = {
  content: unknown
  isError: boolean
  toolName?: string
  standalone?: boolean
}

/**
 * Standalone tool result block — only shown when not already rendered
 * inline within ToolCallBlock (i.e., when the tool_use and tool_result
 * are NOT grouped together by MessageList).
 */
export function ToolResultBlock({ content, isError, toolName, standalone = true }: Props) {
  const [expanded, setExpanded] = useState(false)
  const t = useTranslation()

  // Don't render standalone if this result is already rendered inline
  if (!standalone) return null

  const text = extractText(content)
  const images = extractImageSources(content)
  const preview = text.slice(0, 200)
  const hasMore = text.length > 200

  return (
    <div className={`mb-3 overflow-hidden rounded-md border ${
      isError
        ? 'border-[var(--color-error)]/20'
        : 'border-[var(--color-outline-variant)]/20'
    }`}>
      {/* Status header */}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={`flex w-full items-center justify-between px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider ${
        isError
          ? 'bg-[var(--color-error-container)] text-[var(--color-error)]'
          : 'bg-[var(--color-surface-container-high)] text-[var(--color-outline)]'
      }`}
      >
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[12px]">
            {isError ? 'error' : 'check_circle'}
          </span>
          {toolName ? t('tool.result', { toolName }) : t('tool.resultGeneric')}
        </span>
        <span className={`px-2 py-0.5 rounded-full text-[9px] ${
          isError
            ? 'bg-[var(--color-error)]/10'
            : 'bg-[var(--color-diff-added-bg)] text-[var(--color-diff-added-text)]'
        }`}>
          {isError ? t('tool.error') : t('tool.success')}
        </span>
      </button>

      {/* Inline image gallery from detected paths */}
      <InlineImageGallery text={text} />
      {images.length > 0 && (
        <div className="grid gap-2 bg-[var(--color-surface-container-lowest)] px-3 py-2">
          {images.map((src, index) => (
            <img
              key={`${src.slice(0, 48)}-${index}`}
              src={src}
              alt=""
              className="max-h-[420px] max-w-full rounded-md border border-[var(--color-border)] object-contain"
            />
          ))}
        </div>
      )}

      {/* Content */}
      {expanded ? (
        isError ? (
          <div className="bg-[var(--color-error-container)]/50 px-3 py-2.5 font-[var(--font-mono)] text-[11px] leading-[1.5] whitespace-pre-wrap break-words text-[var(--color-error)]">
            {text}
          </div>
        ) : (
          <CodeViewer
            code={text}
            language="plaintext"
            maxLines={12}
          />
        )
      ) : (
        <div className="bg-[var(--color-surface-container-lowest)] px-3 py-2 font-[var(--font-mono)] text-[10px] leading-[1.35] text-[var(--color-text-tertiary)]">
          {preview}
          {hasMore ? '…' : ''}
        </div>
      )}

      {hasMore && (
        <button
          onClick={() => setExpanded((value) => !value)}
          className="w-full py-1 text-[10px] font-medium text-[var(--color-text-accent)] hover:underline bg-[var(--color-surface-container-low)] border-t border-[var(--color-outline-variant)]/10"
        >
          {expanded ? t('tool.showLess') : t('tool.showMore', { count: text.length - 200 })}
        </button>
      )}
    </div>
  )
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : c?.text || ''))
      .filter(Boolean)
      .join('\n')
  }
  if (content && typeof content === 'object') {
    return JSON.stringify(content, null, 2)
  }
  return String(content ?? '')
}

function extractImageSources(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  return content
    .map((chunk: any) => {
      if (chunk?.type !== 'image') return ''
      if (chunk.source?.type === 'base64' && chunk.source?.data) {
        const mime = chunk.source.media_type || 'image/png'
        return `data:${mime};base64,${chunk.source.data}`
      }
      if (chunk.data) {
        return `data:${chunk.mimeType || 'image/png'};base64,${chunk.data}`
      }
      return ''
    })
    .filter(Boolean)
}
