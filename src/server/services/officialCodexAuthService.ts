import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

const OFFICIAL_CODEX_CONFIG_DIR_ENV = 'CC_HAHA_OFFICIAL_CODEX_CONFIG_DIR'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function getOfficialCodexConfigDir(): string {
  const override = process.env[OFFICIAL_CODEX_CONFIG_DIR_ENV]?.trim()
  return override || path.join(os.homedir(), '.codex')
}

function getOfficialCodexAuthPath(): string {
  return path.join(getOfficialCodexConfigDir(), 'auth.json')
}

function normalizeOfficialCodexRuntimeEnv(
  auth: Record<string, unknown>,
): Record<string, string> {
  const apiKey = auth.OPENAI_API_KEY
  return typeof apiKey === 'string' && apiKey.trim()
    ? { OPENAI_API_KEY: apiKey }
    : {}
}

export function readOfficialCodexAuthSync(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(getOfficialCodexAuthPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function readOfficialCodexRuntimeEnvSync(): Record<string, string> {
  return normalizeOfficialCodexRuntimeEnv(readOfficialCodexAuthSync())
}

export class OfficialCodexAuthService {
  async getAuth(): Promise<Record<string, unknown>> {
    try {
      const raw = await fsp.readFile(getOfficialCodexAuthPath(), 'utf-8')
      const parsed = JSON.parse(raw)
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  async getRuntimeEnv(): Promise<Record<string, string>> {
    return normalizeOfficialCodexRuntimeEnv(await this.getAuth())
  }
}

export const officialCodexAuthService = new OfficialCodexAuthService()
