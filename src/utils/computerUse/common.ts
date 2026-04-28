export const COMPUTER_USE_MCP_SERVER_NAME = 'computer-use'
export const DESKTOP_HOST_PLATFORM_BUNDLE_ID = 'com.ycode.desktop.no-window'

export function isComputerUseSupportedPlatform(
  platform: NodeJS.Platform = process.platform,
): platform is 'darwin' | 'win32' {
  return platform === 'darwin' || platform === 'win32'
}

/**
 * Sentinel bundle ID for desktop server-side control. It intentionally does
 * not match the real WebView window, so Computer Use will not type into the
 * app's own chat box if focus was not moved away first.
 */
export const DESKTOP_HOST_BUNDLE_ID = DESKTOP_HOST_PLATFORM_BUNDLE_ID

/**
 * Fallback `env.terminal` → bundleId map for when `__CFBundleIdentifier` is
 * unset. Covers the macOS terminals we can distinguish. On Windows the host is
 * always the desktop sentinel above, so this table remains macOS-specific.
 */
const TERMINAL_BUNDLE_ID_FALLBACK: Readonly<Record<string, string>> = {
  'iTerm.app': 'com.googlecode.iterm2',
  Apple_Terminal: 'com.apple.Terminal',
  ghostty: 'com.mitchellh.ghostty',
  kitty: 'net.kovidgoyal.kitty',
  WarpTerminal: 'dev.warp.Warp-Stable',
  vscode: 'com.microsoft.VSCode',
}

/**
 * Bundle ID of the terminal emulator we're running inside, so `prepareDisplay`
 * can exempt it from hiding and `captureExcluding` can keep it out of
 * screenshots. Returns null when undetectable (ssh, cleared env, unknown
 * terminal) — caller must handle the null case.
 *
 * `__CFBundleIdentifier` is set by LaunchServices when a .app bundle spawns a
 * process and is inherited by children. It's the exact bundleId, no lookup
 * needed — handles terminals the fallback table doesn't know about. Under
 * tmux/screen it reflects the terminal that started the SERVER, which may
 * differ from the attached client. That's harmless here: we exempt A
 * terminal window, and the screenshots exclude it regardless.
 */
export function getTerminalBundleId(): string | null {
  const cfBundleId = process.env.__CFBundleIdentifier
  if (cfBundleId) return cfBundleId
  const terminalName = process.env.TERM_PROGRAM || process.env.TERMINAL_EMULATOR
  return TERMINAL_BUNDLE_ID_FALLBACK[terminalName ?? ''] ?? null
}

/**
 * Desktop computer-use capabilities by platform. `hostBundleId` is not here;
 * it is added by `executor.ts` per `ComputerExecutor.capabilities`.
 */
export function getDesktopComputerUseCapabilities(
  platform: NodeJS.Platform = process.platform,
): {
  screenshotFiltering: 'native' | 'none'
  platform: 'darwin' | 'win32'
} {
  if (platform === 'darwin') {
    return {
      screenshotFiltering: 'native',
      platform: 'darwin',
    }
  }

  if (platform !== 'win32') {
    throw new Error(
      `Computer Use is only supported on macOS and Windows (received ${platform}).`,
    )
  }

  return {
    screenshotFiltering: 'none',
    platform: 'win32',
  }
}

export function isComputerUseMCPServer(name: string): boolean {
  return normalizeNameForMCP(name) === COMPUTER_USE_MCP_SERVER_NAME
}

function normalizeNameForMCP(name: string): string {
  let normalized = name.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (name.startsWith('claude.ai ')) {
    normalized = normalized.replace(/_+/g, '_').replace(/^_|_$/g, '')
  }
  return normalized
}
