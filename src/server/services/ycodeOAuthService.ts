/**
 * YcodeOAuthService — 桌面端自管 Claude OAuth token
 *
 * 为什么存在: macOS Keychain ACL 在 .app 被打上 quarantine 属性后
 * 对无 UI sidecar 静默拒绝,导致 CLI 读不到 OAuth token → 403。
 * 这个 service 把 token 存到 Ycode 自己的目录,并通过 env 注入给 CLI。
 *
 * 桌面端只保留 OAuth 必要协议逻辑，不再依赖 CLI auth/settings 栈。
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { createHash, randomBytes } from 'crypto'
import { getAppDataDir } from '../utils/paths.js'

const DESKTOP_OAUTH_CONFIG = {
  BASE_API_URL: 'https://api.anthropic.com',
  CLAUDE_AI_AUTHORIZE_URL: 'https://claude.com/cai/oauth/authorize',
  TOKEN_URL: 'https://platform.claude.com/v1/oauth/token',
  CLIENT_ID: process.env.CLAUDE_CODE_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
}

const CLAUDE_AI_OAUTH_SCOPES = [
  'user:profile',
  'user:inference',
  'user:sessions:claude_code',
  'user:mcp_servers',
  'user:file_upload',
] as const

const ALL_OAUTH_SCOPES = Array.from(new Set([
  'org:create_api_key',
  ...CLAUDE_AI_OAUTH_SCOPES,
]))

type SubscriptionType = 'pro' | 'max' | 'team' | 'enterprise'

type OAuthTokenExchangeResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

type OAuthTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scopes: string[]
  subscriptionType: SubscriptionType | null
}

type OAuthProfileResponse = {
  organization?: {
    organization_type?: string | null
  } | null
}

export type StoredOAuthTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scopes: string[]
  subscriptionType: SubscriptionType | null
}

export type OAuthSession = {
  state: string
  codeVerifier: string
  authorizeUrl: string
  serverPort: number
  createdAt: number
}

type RefreshFn = (refreshToken: string, opts?: { scopes?: string[] }) => Promise<OAuthTokens>
type FetchProfileFn = (
  accessToken: string,
) => Promise<{ subscriptionType: SubscriptionType | null }>

const SESSION_TTL_MS = 5 * 60 * 1000
const OAUTH_CALLBACK_PATH = '/callback'

export class YcodeOAuthService {
  private sessions = new Map<string, OAuthSession>()
  private refreshFn: RefreshFn = refreshOAuthToken
  private fetchProfileFn: FetchProfileFn = fetchProfileInfo

  setRefreshFn(fn: RefreshFn): void {
    this.refreshFn = fn
  }

  setFetchProfileFn(fn: FetchProfileFn): void {
    this.fetchProfileFn = fn
  }

  private getOAuthFilePath(): string {
    return path.join(getAppDataDir(), 'oauth.json')
  }

  async loadTokens(): Promise<StoredOAuthTokens | null> {
    try {
      const raw = await fs.readFile(this.getOAuthFilePath(), 'utf-8')
      return JSON.parse(raw) as StoredOAuthTokens
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    const filePath = this.getOAuthFilePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    // 写临时文件再 rename,防止写到一半被其他读者读到残缺 JSON。
    // 单进程 desktop 下 pid 后缀足够隔离。
    const tmp = `${filePath}.tmp.${process.pid}`
    await fs.writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 })
    await fs.rename(tmp, filePath)
  }

  async deleteTokens(): Promise<void> {
    try {
      await fs.unlink(this.getOAuthFilePath())
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  startSession({ serverPort }: { serverPort: number }): OAuthSession {
    this.pruneExpiredSessions()

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)
    const state = generateState()

    const authorizeUrl = buildAuthUrl({
      codeChallenge,
      state,
      port: serverPort,
    })

    const session: OAuthSession = {
      state,
      codeVerifier,
      authorizeUrl,
      serverPort,
      createdAt: Date.now(),
    }
    this.sessions.set(state, session)
    return session
  }

  getSession(state: string): OAuthSession | null {
    const s = this.sessions.get(state)
    if (!s) return null
    if (Date.now() - s.createdAt > SESSION_TTL_MS) {
      this.sessions.delete(state)
      return null
    }
    return s
  }

  consumeSession(state: string): OAuthSession | null {
    const s = this.getSession(state)
    if (s) this.sessions.delete(state)
    return s
  }

  private pruneExpiredSessions(): void {
    const now = Date.now()
    for (const [state, s] of this.sessions.entries()) {
      if (now - s.createdAt > SESSION_TTL_MS) this.sessions.delete(state)
    }
  }

  async completeSession(
    authorizationCode: string,
    state: string,
  ): Promise<StoredOAuthTokens> {
    const session = this.consumeSession(state)
    if (!session) {
      throw new Error('OAuth session not found or expired')
    }

    const response = await this.exchangeWithCustomCallback(
      authorizationCode,
      state,
      session.codeVerifier,
      session.serverPort,
    )
    const profile = await this.fetchProfileFn(response.access_token)

    const tokens: StoredOAuthTokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? null,
      expiresAt: Date.now() + response.expires_in * 1000,
      scopes: parseScopes(response.scope),
      subscriptionType: profile.subscriptionType,
    }
    await this.saveTokens(tokens)
    return tokens
  }

  private async exchangeWithCustomCallback(
    code: string,
    state: string,
    verifier: string,
    port: number,
  ): Promise<OAuthTokenExchangeResponse> {
    const requestBody = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: `http://localhost:${port}${OAUTH_CALLBACK_PATH}`,
      client_id: DESKTOP_OAUTH_CONFIG.CLIENT_ID,
      code_verifier: verifier,
      state,
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15_000)
    let res: Response
    try {
      res = await fetch(DESKTOP_OAUTH_CONFIG.TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }
    if (!res.ok) {
      throw new Error(
        `Token exchange failed (${res.status}): ${await res.text()}`,
      )
    }
    return (await res.json()) as OAuthTokenExchangeResponse
  }

  async ensureFreshTokens(): Promise<StoredOAuthTokens | null> {
    const tokens = await this.loadTokens()
    if (!tokens) return null

    if (tokens.expiresAt === null) return tokens

    if (!isOAuthTokenExpired(tokens.expiresAt)) return tokens

    if (!tokens.refreshToken) return null

    try {
      const refreshed = await this.refreshFn(tokens.refreshToken, {
        scopes: tokens.scopes,
      })
      const updated: StoredOAuthTokens = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
        expiresAt: refreshed.expiresAt,
        scopes: refreshed.scopes,
        subscriptionType: refreshed.subscriptionType ?? tokens.subscriptionType,
      }
      await this.saveTokens(updated)
      return updated
    } catch (err) {
      console.error(
        '[YcodeOAuthService] token refresh failed:',
        err instanceof Error ? err.message : err,
      )
      return null
    }
  }

  async ensureFreshAccessToken(): Promise<string | null> {
    const tokens = await this.ensureFreshTokens()
    return tokens?.accessToken ?? null
  }
}

export const ycodeOAuthService = new YcodeOAuthService()

function buildAuthUrl({
  codeChallenge,
  state,
  port,
}: {
  codeChallenge: string
  state: string
  port: number
}): string {
  const authUrl = new URL(DESKTOP_OAUTH_CONFIG.CLAUDE_AI_AUTHORIZE_URL)
  authUrl.searchParams.append('code', 'true')
  authUrl.searchParams.append('client_id', DESKTOP_OAUTH_CONFIG.CLIENT_ID)
  authUrl.searchParams.append('response_type', 'code')
  authUrl.searchParams.append('redirect_uri', `http://localhost:${port}${OAUTH_CALLBACK_PATH}`)
  authUrl.searchParams.append('scope', ALL_OAUTH_SCOPES.join(' '))
  authUrl.searchParams.append('code_challenge', codeChallenge)
  authUrl.searchParams.append('code_challenge_method', 'S256')
  authUrl.searchParams.append('state', state)
  return authUrl.toString()
}

async function refreshOAuthToken(
  refreshToken: string,
  { scopes: requestedScopes }: { scopes?: string[] } = {},
): Promise<OAuthTokens> {
  const response = await postJson<OAuthTokenExchangeResponse>(DESKTOP_OAUTH_CONFIG.TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: DESKTOP_OAUTH_CONFIG.CLIENT_ID,
    scope: (requestedScopes?.length ? requestedScopes : CLAUDE_AI_OAUTH_SCOPES).join(' '),
  })

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? refreshToken,
    expiresAt: Date.now() + response.expires_in * 1000,
    scopes: parseScopes(response.scope),
    subscriptionType: null,
  }
}

async function fetchProfileInfo(
  accessToken: string,
): Promise<{ subscriptionType: SubscriptionType | null }> {
  const profile = await getJson<OAuthProfileResponse>(
    `${DESKTOP_OAUTH_CONFIG.BASE_API_URL}/api/oauth/profile`,
    {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  ).catch(() => null)

  switch (profile?.organization?.organization_type) {
    case 'claude_max':
      return { subscriptionType: 'max' }
    case 'claude_pro':
      return { subscriptionType: 'pro' }
    case 'claude_enterprise':
      return { subscriptionType: 'enterprise' }
    case 'claude_team':
      return { subscriptionType: 'team' }
    default:
      return { subscriptionType: null }
  }
}

function parseScopes(scopeString?: string): string[] {
  return scopeString?.split(' ').filter(Boolean) ?? []
}

function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32))
}

function generateCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash('sha256').update(verifier).digest())
}

function generateState(): string {
  return base64UrlEncode(randomBytes(32))
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function isOAuthTokenExpired(expiresAt: number | null): boolean {
  if (expiresAt === null) return false
  return Date.now() + 5 * 60 * 1000 >= expiresAt
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`OAuth request failed (${res.status}): ${await res.text()}`)
    }
    return await res.json() as T
  } finally {
    clearTimeout(timeoutId)
  }
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) {
      throw new Error(`OAuth profile request failed (${res.status}): ${await res.text()}`)
    }
    return await res.json() as T
  } finally {
    clearTimeout(timeoutId)
  }
}
