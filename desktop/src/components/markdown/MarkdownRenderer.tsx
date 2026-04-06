import { useMemo } from 'react'
import { marked, type Tokens } from 'marked'
import { escapeHtml, highlightCodeLines } from '../chat/highlightCode'

type Props = {
  content: string
}

const renderer = new marked.Renderer()

renderer.code = function ({ text, lang }: Tokens.Code) {
  const languageLabel = escapeHtml(lang || 'code')
  const lines = text.split('\n')
  const highlightedLines = highlightCodeLines(text, lang)

  const body = highlightedLines
    .map((line, index) => `
      <div class="grid grid-cols-[3rem,minmax(0,1fr)] gap-0 hover:bg-[#f6f8fa]/50">
        <span class="select-none border-r border-[#eaeef2] bg-[#fafbfc] px-2 py-px text-right text-[11px] text-[#8b949e]">${index + 1}</span>
        <span class="overflow-hidden bg-white px-3 py-px whitespace-pre-wrap break-words text-[#24292f]">${line || '&nbsp;'}</span>
      </div>
    `)
    .join('')

  return `
    <div class="my-4 overflow-hidden rounded-lg border border-[#d0d7de] bg-[#f6f8fa] text-[#24292f]">
      <div class="flex items-center justify-between border-b border-[#d0d7de] bg-white px-3 py-1.5 text-[11px] text-[#57606a]">
        <div class="flex items-center gap-3">
          <span class="font-semibold uppercase tracking-[0.14em] text-[#57606a]">${languageLabel}</span>
          <span>${lines.length} ${lines.length === 1 ? 'line' : 'lines'}</span>
        </div>
        <button class="rounded-md border border-[#d0d7de] bg-white px-2 py-0.5 text-[11px] text-[#57606a] transition-colors hover:bg-[#f3f4f6] hover:text-[#24292f]" data-copy-code="${escapeHtml(text)}">
          Copy
        </button>
      </div>
      <div class="max-h-[420px] overflow-auto">
        <div class="min-w-full font-[var(--font-mono)] text-[12px] leading-[1.3]">${body}</div>
      </div>
    </div>
  `
}

marked.setOptions({
  breaks: true,
  gfm: true,
})
marked.use({ renderer })

export function MarkdownRenderer({ content }: Props) {
  const html = useMemo(() => {
    try {
      return marked.parse(content) as string
    } catch {
      return content
    }
  }, [content])

  const handleClick = async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null
    const button = target?.closest<HTMLButtonElement>('[data-copy-code]')
    if (!button) return

    const text = button.getAttribute('data-copy-code')
    if (!text) return

    try {
      await navigator.clipboard.writeText(text)
      const original = button.textContent
      button.textContent = 'Copied'
      window.setTimeout(() => {
        button.textContent = original
      }, 1500)
    } catch {
      // Ignore clipboard errors and keep the original label.
    }
  }

  return (
    <div
      className="prose prose-sm max-w-none text-[var(--color-text-primary)]
        prose-headings:text-[var(--color-text-primary)] prose-headings:font-semibold
        prose-p:my-2 prose-p:leading-relaxed
        prose-code:text-[13px] prose-code:font-[var(--font-mono)] prose-code:bg-[var(--color-surface-info)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
        prose-pre:!bg-transparent prose-pre:!p-0 prose-pre:!shadow-none
        prose-a:text-[var(--color-text-accent)] prose-a:no-underline hover:prose-a:underline
        prose-strong:text-[var(--color-text-primary)]
        prose-ul:my-2 prose-ol:my-2
        prose-li:my-0.5
        prose-table:text-sm
        prose-th:bg-[var(--color-surface-info)] prose-th:px-3 prose-th:py-2
        prose-td:px-3 prose-td:py-2 prose-td:border-[var(--color-border)]"
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  )
}
