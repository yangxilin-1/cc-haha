import { ycodeOAuthService } from '../services/ycodeOAuthService.js'
import { ProviderService } from '../services/providerService.js'
import { SettingsService } from '../services/settingsService.js'
import {
  OfficialClaudeSettingsService,
  officialClaudeSettingsService,
} from '../services/officialClaudeSettingsService.js'
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js'
import { openaiChatStreamToAnthropic } from '../proxy/streaming/openaiChatStreamToAnthropic.js'
import { openaiResponsesStreamToAnthropic } from '../proxy/streaming/openaiResponsesStreamToAnthropic.js'
import type { ApiFormat, SavedProvider } from '../types/provider.js'
import type {
  ChatModelRequest,
  ModelStreamEvent,
  RuntimeProviderSnapshot,
} from './types.js'

const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderConfigError'
  }
}

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly providerCode?: string,
    readonly providerDetail?: string,
  ) {
    super(message)
    this.name = 'ProviderRequestError'
  }
}

type ProviderAdapterOptions = {
  providerService?: ProviderService
  settingsService?: SettingsService
  officialClaudeSettingsService?: OfficialClaudeSettingsService
}

export class ProviderAdapter {
  private providerService: ProviderService
  private settingsService: SettingsService
  private officialSettingsService: OfficialClaudeSettingsService

  constructor(options?: ProviderAdapterOptions) {
    this.providerService = options?.providerService ?? new ProviderService()
    this.settingsService = options?.settingsService ?? new SettingsService()
    this.officialSettingsService =
      options?.officialClaudeSettingsService ?? officialClaudeSettingsService
  }

  async resolveSnapshot(modelOverride?: string): Promise<RuntimeProviderSnapshot> {
    const { providers, activeId } = await this.providerService.listProviders()
    const activeProvider = activeId
      ? providers.find((provider) => provider.id === activeId)
      : null

    if (activeProvider) {
      return this.snapshotFromSavedProvider(activeProvider, modelOverride)
    }

    const settings = await this.settingsService.getUserSettings().catch(() => ({}))
    const officialSettings = await this.officialSettingsService
      .getUserSettings()
      .catch(() => ({}))
    const env = {
      ...process.env,
      ...((officialSettings.env as Record<string, string> | undefined) ?? {}),
      ...((settings.env as Record<string, string> | undefined) ?? {}),
    }

    const envAuth = resolveAnthropicEnvAuth(env)
    if (envAuth) {
      return {
        providerId: 'env-anthropic',
        providerName: 'Anthropic env',
        apiFormat: 'anthropic',
        baseUrl: normalizeBaseUrl(env.ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE_URL),
        model: normalizeModelId(
          modelOverride ||
            env.ANTHROPIC_MODEL ||
            (settings.model as string | undefined) ||
            (officialSettings.model as string | undefined) ||
            DEFAULT_MODEL,
        ),
        auth: envAuth,
        createdAt: new Date().toISOString(),
      }
    }

    const oauthToken = await ycodeOAuthService.ensureFreshAccessToken()
    if (oauthToken) {
      return {
        providerId: 'official-oauth',
        providerName: 'Claude official',
        apiFormat: 'anthropic',
        baseUrl: DEFAULT_ANTHROPIC_BASE_URL,
        model: normalizeModelId(
            modelOverride ||
            (settings.model as string | undefined) ||
            (officialSettings.model as string | undefined) ||
            DEFAULT_MODEL,
        ),
        auth: { type: 'oauth', value: oauthToken },
        createdAt: new Date().toISOString(),
      }
    }

    throw new ProviderConfigError(
      'No usable provider is configured. Add and activate a provider in Settings, or sign in to the official Claude provider.',
    )
  }

  async *stream(
    request: ChatModelRequest,
    snapshot: RuntimeProviderSnapshot,
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    const response = await this.createStreamingResponse(request, snapshot, signal)
    if (!response.body) {
      throw new ProviderRequestError('Provider returned an empty stream body.')
    }

    const anthropicStream =
      snapshot.apiFormat === 'anthropic'
        ? response.body
        : snapshot.apiFormat === 'openai_chat'
          ? openaiChatStreamToAnthropic(response.body, snapshot.model)
          : openaiResponsesStreamToAnthropic(response.body, snapshot.model)

    yield* parseAnthropicSse(anthropicStream)
  }

  private snapshotFromSavedProvider(
    provider: SavedProvider,
    modelOverride?: string,
  ): RuntimeProviderSnapshot {
    return {
      providerId: provider.id,
      providerName: provider.name,
      apiFormat: provider.apiFormat ?? 'anthropic',
      baseUrl: normalizeBaseUrl(provider.baseUrl),
      model: normalizeModelId(modelOverride || provider.models.main),
      auth: { type: 'api-key', value: provider.apiKey },
      createdAt: new Date().toISOString(),
    }
  }

  private async createStreamingResponse(
    request: ChatModelRequest,
    snapshot: RuntimeProviderSnapshot,
    signal: AbortSignal,
  ): Promise<Response> {
    const body = { ...request, model: snapshot.model, stream: true }
    const baseUrl = normalizeBaseUrl(snapshot.baseUrl)

    let url: string
    let headers: Record<string, string>
    let payload: unknown

    if (snapshot.apiFormat === 'openai_chat') {
      url = `${baseUrl}/v1/chat/completions`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${snapshot.auth.value}`,
      }
      payload = anthropicToOpenaiChat(body)
    } else if (snapshot.apiFormat === 'openai_responses') {
      url = `${baseUrl}/v1/responses`
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${snapshot.auth.value}`,
      }
      payload = anthropicToOpenaiResponses(body)
    } else {
      url = `${baseUrl}/v1/messages`
      headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...buildAnthropicAuthHeaders(snapshot),
      }
      payload = body
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const formatted = formatProviderRequestError({
        status: response.status,
        detail,
        providerName: snapshot.providerName,
        model: snapshot.model,
      })
      throw new ProviderRequestError(
        formatted.message,
        response.status,
        formatted.code,
        detail.slice(0, 1000),
      )
    }

    return response
  }
}

function buildAnthropicAuthHeaders(
  snapshot: RuntimeProviderSnapshot,
): Record<string, string> {
  if (snapshot.auth.type === 'oauth') {
    return {
      Authorization: `Bearer ${snapshot.auth.value}`,
      'anthropic-beta': OAUTH_BETA_HEADER,
    }
  }

  if (snapshot.auth.type === 'bearer') {
    return { Authorization: `Bearer ${snapshot.auth.value}` }
  }

  return { 'x-api-key': snapshot.auth.value }
}

async function* parseAnthropicSse(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<ModelStreamEvent> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''

      for (const frame of frames) {
        const parsed = parseSseFrame(frame)
        if (parsed) yield parsed
      }
    }

    const tail = buffer.trim()
    if (tail) {
      const parsed = parseSseFrame(tail)
      if (parsed) yield parsed
    }
  } finally {
    reader.releaseLock()
  }
}

function parseSseFrame(frame: string): ModelStreamEvent | null {
  let event = ''
  const dataLines: string[] = []

  for (const rawLine of frame.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }

  const dataText = dataLines.join('\n')
  if (!event || !dataText || dataText === '[DONE]') return null

  try {
    return {
      event,
      data: JSON.parse(dataText) as Record<string, unknown>,
    }
  } catch {
    return null
  }
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function resolveAnthropicEnvAuth(
  env: Record<string, string | undefined>,
): RuntimeProviderSnapshot['auth'] | null {
  if (env.ANTHROPIC_API_KEY) {
    return { type: 'api-key', value: env.ANTHROPIC_API_KEY }
  }

  if (env.ANTHROPIC_AUTH_TOKEN) {
    return { type: 'bearer', value: env.ANTHROPIC_AUTH_TOKEN }
  }

  return null
}

function formatProviderRequestError(args: {
  status: number
  detail: string
  providerName: string
  model: string
}): { message: string; code?: string } {
  const providerMessage = extractProviderMessage(args.detail)
  const haystack = `${args.detail}\n${providerMessage ?? ''}`

  if (/\bINVALID_MODEL_ID\b/i.test(haystack) || /\binvalid model\b/i.test(haystack)) {
    return {
      code: 'INVALID_MODEL_ID',
      message: `Model "${args.model}" is not available for ${args.providerName}. Select a supported model in Settings and try again.`,
    }
  }

  if (args.status === 401 || args.status === 403) {
    return {
      code: 'PROVIDER_AUTH_FAILED',
      message: `Provider authentication failed for ${args.providerName}. Check the API key or sign in again.`,
    }
  }

  const suffix = providerMessage
    ? ` ${sanitizeProviderMessage(providerMessage)}`
    : ''
  return {
    message: `Provider request failed (${args.status}).${suffix}`.slice(0, 500),
  }
}

function extractProviderMessage(detail: string): string | null {
  const parsed = parseJsonObject(detail)
  if (parsed) {
    const nested = readNestedMessage(parsed)
    if (nested) return nested
  }

  return detail.trim() || null
}

function readNestedMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  const directMessage = record.message
  if (typeof directMessage === 'string' && directMessage.trim()) {
    return directMessage.trim()
  }

  const error = record.error
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) {
      return message.trim()
    }
  }

  return null
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function sanitizeProviderMessage(message: string): string {
  return message
    .replace(/\s+/g, ' ')
    .replace(/[{}"]/g, '')
    .trim()
    .slice(0, 320)
}

function normalizeModelId(value: string): string {
  const model = value.trim()
  const contextSeparator = model.indexOf(':')
  return contextSeparator >= 0 ? model.slice(0, contextSeparator) : model
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)
}
