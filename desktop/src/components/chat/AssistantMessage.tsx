import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import { MessageActionBar } from './MessageActionBar'
import { InlineImageGallery } from './InlineImageGallery'

type Props = {
  content: string
  isStreaming?: boolean
}

export function AssistantMessage({ content, isStreaming }: Props) {
  return (
    <div className="group mb-6 flex w-full items-start gap-1.5">
      <div className="min-w-0 flex-1 pr-2">
        <div className="w-full overflow-visible px-1 py-1 text-sm leading-relaxed text-[var(--color-text-primary)]">
          {isStreaming ? (
            <div className="w-full max-w-none whitespace-pre-wrap break-words">
              {content}
            </div>
          ) : (
            <MarkdownRenderer
              content={content}
              className="w-full max-w-none break-words [&_*]:max-w-full [&>p]:max-w-none"
            />
          )}
          {!isStreaming && <InlineImageGallery text={content} />}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-shimmer bg-[var(--color-brand)] align-text-bottom" />
          )}
        </div>
      </div>

      <MessageActionBar
        copyText={isStreaming ? undefined : content}
        copyLabel="Copy reply"
      />
    </div>
  )
}
