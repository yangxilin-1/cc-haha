import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

const OFFICIAL_CLAUDE_CONFIG_DIR_ENV = 'CC_HAHA_OFFICIAL_CLAUDE_CONFIG_DIR'

const OFFICIAL_CLAUDE_ENV_KEYS = new Set([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  'CLAUDE_CODE_ATTRIBUTION_HEADER',
  'CLAUDE_CODE_MODEL_CONTEXT_WINDOWS',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function getOfficialClaudeConfigDir(): string {
  const override = process.env[OFFICIAL_CLAUDE_CONFIG_DIR_ENV]?.trim()
  return override || path.join(os.homedir(), '.claude')
}

function getOfficialClaudeSettingsPath(): string {
  return path.join(getOfficialClaudeConfigDir(), 'settings.json')
}

function normalizeOfficialClaudeRuntimeEnv(
  settings: Record<string, unknown>,
): Record<string, string> {
  const env: Record<string, string> = {}
  const rawEnv = isRecord(settings.env) ? settings.env : {}

  for (const [key, value] of Object.entries(rawEnv)) {
    if (typeof value === 'string' && OFFICIAL_CLAUDE_ENV_KEYS.has(key)) {
      env[key] = value
    }
  }

  if (!env.ANTHROPIC_MODEL && typeof settings.model === 'string') {
    env.ANTHROPIC_MODEL = settings.model
  }

  return env
}

export function readOfficialClaudeSettingsSync(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(getOfficialClaudeSettingsPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function readOfficialClaudeRuntimeEnvSync(): Record<string, string> {
  return normalizeOfficialClaudeRuntimeEnv(readOfficialClaudeSettingsSync())
}

export class OfficialClaudeSettingsService {
  async getUserSettings(): Promise<Record<string, unknown>> {
    try {
      const raw = await fsp.readFile(getOfficialClaudeSettingsPath(), 'utf-8')
      const parsed = JSON.parse(raw)
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  async getRuntimeEnv(): Promise<Record<string, string>> {
    return normalizeOfficialClaudeRuntimeEnv(await this.getUserSettings())
  }
}

export const officialClaudeSettingsService = new OfficialClaudeSettingsService()
