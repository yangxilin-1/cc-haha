import { useRef, useEffect, useMemo, memo } from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n/locales/en'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { ToolCallGroup } from './ToolCallGroup'
import { ToolResultBlock } from './ToolResultBlock'
import { PermissionDialog } from './PermissionDialog'
import { AskUserQuestion } from './AskUserQuestion'
import { StreamingIndicator } from './StreamingIndicator'
import { InlineTaskSummary } from './InlineTaskSummary'
import type { AgentTaskNotification, UIMessage } from '../../types/chat'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type RenderItem =
  | { kind: 'tool_group'; toolCalls: ToolCall[]; id: string }
  | { kind: 'message'; message: UIMessage }

type RenderModel = {
  renderItems: RenderItem[]
  toolResultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
}

const PROVIDER_ERROR_CODES = new Set([
  'INVALID_MODEL_ID',
  'PROVIDER_REQUEST_FAILED',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_AUTH_FAILED',
])

function appendChildToolCall(
  childToolCallsByParent: Map<string, ToolCall[]>,
  parentToolUseId: string,
  toolCall: ToolCall,
) {
  const siblings = childToolCallsByParent.get(parentToolUseId)
  if (siblings) {
    siblings.push(toolCall)
  } else {
    childToolCallsByParent.set(parentToolUseId, [toolCall])
  }
}

export function buildRenderModel(messages: UIMessage[]): RenderModel {
  const items: RenderItem[] = []
  const toolResultMap = new Map<string, ToolResult>()
  const childToolCallsByParent = new Map<string, ToolCall[]>()
  const toolUseIds = new Set<string>()
  let pendingToolCalls: ToolCall[] = []
  const inlineParentToolUseIds = new Set<string>()

  const flushGroup = (resetInlineParents = false) => {
    if (pendingToolCalls.length > 0) {
      items.push({
        kind: 'tool_group',
        toolCalls: [...pendingToolCalls],
        id: `group-${pendingToolCalls[0]!.id}`,
      })
      for (const toolCall of pendingToolCalls) {
        inlineParentToolUseIds.add(toolCall.toolUseId)
      }
      pendingToolCalls = []
    }

    if (resetInlineParents) {
      inlineParentToolUseIds.clear()
    }
  }

  for (const msg of messages) {
    if (msg.type === 'tool_use') {
      toolUseIds.add(msg.toolUseId)
    }
    if (msg.type === 'tool_result') {
      toolResultMap.set(msg.toolUseId, msg)
    }
  }

  for (const msg of messages) {
    if (msg.type === 'tool_result' && toolUseIds.has(msg.toolUseId)) {
      continue
    }

    if (msg.type === 'tool_use') {
      const parentIsPending = msg.parentToolUseId
        ? pendingToolCalls.some((toolCall) => toolCall.toolUseId === msg.parentToolUseId)
        : false

      if (msg.parentToolUseId && (inlineParentToolUseIds.has(msg.parentToolUseId) || parentIsPending)) {
        flushGroup()
        appendChildToolCall(childToolCallsByParent, msg.parentToolUseId, msg)
        inlineParentToolUseIds.add(msg.toolUseId)
        continue
      }
      if (msg.toolName === 'AskUserQuestion') {
        flushGroup(true)
        items.push({ kind: 'message', message: msg })
      } else {
        pendingToolCalls.push(msg)
      }
    } else {
      flushGroup(true)
      items.push({ kind: 'message', message: msg })
    }
  }

  flushGroup()
  return { renderItems: items, toolResultMap, childToolCallsByParent }
}

export function MessageList() {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const messages = sessionState?.messages ?? []
  const chatState = sessionState?.chatState ?? 'idle'
  const streamingText = sessionState?.streamingText ?? ''
  const activeThinkingId = sessionState?.activeThinkingId ?? null
  const agentTaskNotifications = sessionState?.agentTaskNotifications ?? {}
  const bottomRef = useRef<HTMLDivElement>(null)
  const previousMessageCountRef = useRef(messages.length)
  const showActivityIndicator = chatState !== 'idle'

  useEffect(() => {
    const messageCountChanged = previousMessageCountRef.current !== messages.length
    previousMessageCountRef.current = messages.length
    bottomRef.current?.scrollIntoView?.({
      behavior: messageCountChanged ? 'smooth' : 'auto',
      block: 'end',
    })
  }, [messages.length, streamingText, chatState, activeThinkingId])

  const { toolResultMap, childToolCallsByParent, renderItems } = useMemo(
    () => buildRenderModel(messages),
    [messages],
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-[860px]">
        {renderItems.map((item) => {
          if (item.kind === 'tool_group') {
            return (
              <ToolCallGroup
                key={item.id}
                toolCalls={item.toolCalls}
                resultMap={toolResultMap}
                childToolCallsByParent={childToolCallsByParent}
                agentTaskNotifications={agentTaskNotifications}
                isStreaming={
                  chatState === 'tool_executing' &&
                  item.toolCalls.some((tc) => !toolResultMap.has(tc.toolUseId))
                }
              />
            )
          }

          const msg = item.message
          return (
            <MessageBlock
              key={msg.id}
              message={msg}
              activeThinkingId={activeThinkingId}
              agentTaskNotifications={agentTaskNotifications}
              toolResult={
                msg.type === 'tool_use'
                  ? (() => {
                      const r = toolResultMap.get(msg.toolUseId)
                      return r ? { content: r.content, isError: r.isError } : null
                    })()
                  : null
              }
            />
          )
        })}

        {showActivityIndicator && (
          <StreamingIndicator />
        )}

        {streamingText && (
          <AssistantMessage content={streamingText} isStreaming={chatState === 'streaming'} />
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  )
}

export const MessageBlock = memo(function MessageBlock({
  message,
  activeThinkingId,
  agentTaskNotifications,
  toolResult,
}: {
  message: UIMessage
  activeThinkingId: string | null
  agentTaskNotifications: Record<string, AgentTaskNotification>
  toolResult?: { content: unknown; isError: boolean } | null
}) {
  const t = useTranslation()

  switch (message.type) {
    case 'user_text':
      return <UserMessage content={message.content} attachments={message.attachments} />
    case 'assistant_text':
      return <AssistantMessage content={message.content} />
    case 'thinking':
      return <ThinkingBlock content={message.content} isActive={message.id === activeThinkingId} />
    case 'tool_use':
      if (message.toolName === 'AskUserQuestion') {
        return (
          <AskUserQuestion
            toolUseId={message.toolUseId}
            input={message.input}
            result={toolResult?.content}
          />
        )
      }
      return (
        <ToolCallBlock
          toolName={message.toolName}
          input={message.input}
          result={toolResult}
          agentTaskNotification={
            message.toolName === 'Agent'
              ? agentTaskNotifications[message.toolUseId]
              : undefined
          }
        />
      )
    case 'tool_result':
      return (
        <ToolResultBlock
          content={message.content}
          isError={message.isError}
          standalone
        />
      )
    case 'permission_request':
      return (
        <PermissionDialog
          requestId={message.requestId}
          toolName={message.toolName}
          input={message.input}
          description={message.description}
        />
      )
    case 'error': {
      const normalizedCode = normalizeErrorCode(message.code, message.message)
      const errorKey = normalizedCode ? `error.${normalizedCode}` as TranslationKey : null
      const errorText = errorKey ? t(errorKey) : null
      const displayMessage = (errorText && errorText !== errorKey) ? errorText : message.message
      const showRawDetail = shouldShowRawErrorDetail(
        normalizedCode,
        message.message,
        displayMessage,
      )
      return (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-lg border border-[var(--color-error)]/20 bg-[var(--color-error-container)]/28 px-4 py-3 text-sm text-[var(--color-error)]"
        >
          <span
            className="material-symbols-outlined mt-0.5 text-[18px]"
            aria-hidden="true"
          >
            error
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold leading-6">{displayMessage}</div>
            {showRawDetail && (
              <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[var(--color-on-error-container)]/85">
                {message.message}
              </div>
            )}
          </div>
        </div>
      )
    }
    case 'task_summary':
      return <InlineTaskSummary tasks={message.tasks} />
    case 'system':
      return (
        <div className="mb-3 text-center text-xs text-[var(--color-text-tertiary)]">
          {message.content}
        </div>
      )
  }
})

function normalizeErrorCode(code: string | undefined, message: string): string | null {
  if (code === 'INVALID_MODEL_ID' || isInvalidModelError(message)) {
    return 'INVALID_MODEL_ID'
  }
  return code || null
}

function isInvalidModelError(message: string): boolean {
  return /\bINVALID_MODEL_ID\b/i.test(message) || /\binvalid model\b/i.test(message)
}

function shouldShowRawErrorDetail(
  normalizedCode: string | null,
  message: string,
  displayMessage: string,
): boolean {
  const trimmed = message.trim()
  if (!trimmed || trimmed === displayMessage) return false

  if (normalizedCode && PROVIDER_ERROR_CODES.has(normalizedCode)) {
    return false
  }

  if (looksLikeProviderPayload(trimmed)) {
    return false
  }

  return true
}

function looksLikeProviderPayload(message: string): boolean {
  return (
    message.includes('Provider request failed') ||
    message.includes('"error"') ||
    message.includes('上游 API 调用失败') ||
    message.includes('流式 API 请求失败')
  )
}
