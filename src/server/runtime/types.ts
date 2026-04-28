import type { AttachmentRef, ServerMessage } from '../ws/events.js'
import type { SessionMode } from '../services/sessionService.js'
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  AnthropicRequest,
} from '../proxy/transform/types.js'
import type { ApiFormat } from '../types/provider.js'

export type RuntimeSettings = {
  permissionMode?: string
  model?: string
  effort?: string
  mode?: SessionMode
}

export type SendMessageInput = {
  sessionId: string
  content: string
  attachments?: AttachmentRef[]
  settings?: RuntimeSettings
  signal: AbortSignal
}

export interface ConversationEngine {
  sendMessage(input: SendMessageInput): AsyncIterable<ServerMessage>
  stop(sessionId: string): Promise<void>
}

export type ProviderAuth =
  | { type: 'api-key'; value: string }
  | { type: 'bearer'; value: string }
  | { type: 'oauth'; value: string }

export type RuntimeProviderSnapshot = {
  providerId: string
  providerName: string
  apiFormat: ApiFormat
  baseUrl: string
  model: string
  auth: ProviderAuth
  createdAt: string
}

export type ModelStreamEvent = {
  event: string
  data: Record<string, unknown>
}

export type ChatModelMessage = AnthropicMessage
export type ChatContentBlock = AnthropicContentBlock
export type ChatModelRequest = AnthropicRequest
