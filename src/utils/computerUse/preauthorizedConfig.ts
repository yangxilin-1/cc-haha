import type { CuGrantFlags } from '../../vendor/computer-use-mcp/types.js'

export type StoredAuthorizedApp = {
  bundleId: string
  displayName: string
}

export type StoredComputerUseConfig = {
  authorizedApps?: StoredAuthorizedApp[]
  grantFlags?: Partial<CuGrantFlags>
  computerWideAccess?: boolean
}

export const COMPUTER_WIDE_ACCESS_BUNDLE_ID = '*'
export const COMPUTER_WIDE_ACCESS_DISPLAY_NAME = 'All applications'

export const DEFAULT_DESKTOP_GRANT_FLAGS: CuGrantFlags = {
  clipboardRead: true,
  clipboardWrite: true,
  systemKeyCombos: true,
}

export function normalizeStoredAppKey(value: string | undefined): string {
  const raw = String(value ?? '').trim()
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '') || raw.toLowerCase()
}

function dedupeAuthorizedApps(
  apps: readonly StoredAuthorizedApp[] | undefined,
): StoredAuthorizedApp[] {
  if (!Array.isArray(apps)) return []
  const seen = new Set<string>()
  const out: StoredAuthorizedApp[] = []
  for (const app of apps) {
    if (typeof app?.bundleId !== 'string' || typeof app?.displayName !== 'string') {
      continue
    }
    const bundleId = app.bundleId.trim()
    const displayName = app.displayName.trim()
    const key = normalizeStoredAppKey(bundleId)
    if (!bundleId || !displayName || !key || seen.has(key)) continue
    seen.add(key)
    out.push({ bundleId, displayName })
  }
  return out
}

export function resolveStoredComputerUseConfig(
  config?: StoredComputerUseConfig,
): {
  authorizedApps: StoredAuthorizedApp[]
  grantFlags: CuGrantFlags
  computerWideAccess: boolean
} {
  return {
    authorizedApps: dedupeAuthorizedApps(config?.authorizedApps),
    grantFlags: {
      ...DEFAULT_DESKTOP_GRANT_FLAGS,
      ...(config?.grantFlags ?? {}),
    },
    computerWideAccess: config?.computerWideAccess === true,
  }
}

