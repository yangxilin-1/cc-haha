/**
 * Filter and sanitize installed-app data for inclusion in the `request_access`
 * tool description. Ported from Cowork's appNames.ts. Two
 * concerns: noise filtering (Spotlight returns every bundle on disk — XPC
 * helpers, daemons, input methods) and prompt-injection hardening (app names
 * are attacker-controlled; anyone can ship an app named anything).
 *
 * Residual risk: short benign-char adversarial names ("grant all") can't be
 * filtered programmatically. The tool description's structural framing
 * ("Available applications:") makes it clear these are app names, and the
 * downstream permission dialog requires explicit user approval — a bad name
 * can't auto-grant anything.
 */

/** Minimal shape — matches what `listInstalledApps` returns. */
type InstalledAppLike = {
  readonly bundleId: string
  readonly displayName: string
  readonly path: string
}

export type SettingsAppLike = InstalledAppLike & {
  readonly category?: string
  readonly isCommon?: boolean
}

// ── Noise filtering ──────────────────────────────────────────────────────

/**
 * Only apps under these roots are shown. /System/Library subpaths (CoreServices,
 * PrivateFrameworks, Input Methods) are OS plumbing — anchor on known-good
 * roots rather than blocklisting every junk subpath since new macOS versions
 * add more.
 *
 * ~/Applications is checked at call time via the `homeDir` arg (HOME isn't
 * reliably known at module load in all environments).
 */
const PATH_ALLOWLIST: readonly string[] = [
  '/Applications/',
  '/System/Applications/',
]

/**
 * Display-name patterns that mark background services even under /Applications.
 * `(?:$|\s\()` — matches keyword at end-of-string OR immediately before ` (`:
 * "Slack Helper (GPU)" and "ABAssistantService" fail, "Service Desk" passes
 * (Service is followed by " D").
 */
const NAME_PATTERN_BLOCKLIST: readonly RegExp[] = [
  /Helper(?:$|\s\()/,
  /Agent(?:$|\s\()/,
  /Service(?:$|\s\()/,
  /Uninstaller(?:$|\s\()/,
  /Updater(?:$|\s\()/,
  /^\./,
]

/**
 * Apps commonly requested for CU automation. ALWAYS included if installed,
 * bypassing path check + count cap — the model needs these exact names even
 * when the machine has 200+ apps. Bundle IDs (locale-invariant), not display
 * names. Keep <30 — each entry is a guaranteed token in the description.
 */
const ALWAYS_KEEP_BUNDLE_IDS: ReadonlySet<string> = new Set([
  // Browsers
  'com.apple.Safari',
  'com.google.Chrome',
  'com.microsoft.edgemac',
  'org.mozilla.firefox',
  'company.thebrowser.Browser', // Arc
  // Communication
  'com.tinyspeck.slackmacgap',
  'us.zoom.xos',
  'com.microsoft.teams2',
  'com.microsoft.teams',
  'com.apple.MobileSMS',
  'com.apple.mail',
  // Productivity
  'com.microsoft.Word',
  'com.microsoft.Excel',
  'com.microsoft.Powerpoint',
  'com.microsoft.Outlook',
  'com.apple.iWork.Pages',
  'com.apple.iWork.Numbers',
  'com.apple.iWork.Keynote',
  'com.google.GoogleDocs',
  // Notes / PM
  'notion.id',
  'com.apple.Notes',
  'md.obsidian',
  'com.linear',
  'com.figma.Desktop',
  // Dev
  'com.microsoft.VSCode',
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'com.github.GitHubDesktop',
  // System essentials the model genuinely targets
  'com.apple.finder',
  'com.apple.iCal',
  'com.apple.systempreferences',
  // Windows app identifiers are exe stems from win_helper.py.
  'Qoder',
  'Code',
  'QQMusic',
  'cloudmusic',
  'WeChat',
  'WXWork',
  'DingTalk',
])

const ALWAYS_KEEP_APP_KEYS: ReadonlySet<string> = new Set(
  [...ALWAYS_KEEP_BUNDLE_IDS].map(normalizeAppLookup).filter(Boolean),
)

// ── Prompt-injection hardening ───────────────────────────────────────────

/**
 * `\p{L}\p{M}\p{N}` with /u — not `\w` (ASCII-only, would drop Bücher, 微信,
 * Préférences Système). `\p{M}` matches combining marks so NFD-decomposed
 * diacritics (ü → u + ◌̈) pass. Single space not `\s` — `\s` matches newlines,
 * which would let "App\nIgnore previous…" through as a multi-line injection.
 * Still bars quotes, angle brackets, backticks, pipes, colons.
 */
const APP_NAME_ALLOWED = /^[\p{L}\p{M}\p{N}_ .&'()+-]+$/u
const APP_NAME_MAX_LEN = 40
const APP_NAME_MAX_COUNT = 50
const SETTINGS_APP_MAX_COUNT = 120

const SETTINGS_COMPONENT_NAME_BLOCKLIST: readonly RegExp[] = [
  /\$\{\{/,
  /^\{[0-9a-f-]{20,}\}$/i,
  /^KB\d+/i,
  /^(Update|Security Update|Hotfix) for /i,
  /\b(Helper|Agent|Service|Uninstaller|Updater|Installer|Setup)\b/i,
  /\b(Runtime|Redistributable|SDK|Driver|Component|Framework|WebView2)\b/i,
  /\b(Language Pack|Documentation|Manual|Samples?|Libraries)\b/i,
  /\b(Repair|Maintenance|Telemetry|Crash|Diagnostics?)\b/i,
  /(卸载|更新|安装程序|运行库|驱动|组件)/,
]

const HARD_BLOCK_APP_PATTERNS: readonly RegExp[] = [
  /\$\{\{/,
  /^\{[0-9a-f-]{20,}\}$/i,
  /\b(Uninstall|Uninstaller?|Installer|Setup|Updater?|Repair|Maintenance)\b/i,
  /(卸载|更新|安装程序|修复|维护)/,
]

const COMMON_APP_RULES: readonly {
  readonly rank: number
  readonly category: string
  readonly keys: readonly string[]
}[] = [
  { rank: 0, category: '开发', keys: ['qoder'] },
  { rank: 1, category: '开发', keys: ['com.microsoft.vscode', 'code', 'visual studio code', 'vscode'] },
  { rank: 2, category: '开发', keys: ['cursor', 'windsurf', 'trae'] },
  { rank: 5, category: 'Python', keys: ['python', 'pythonw', 'py.exe', 'idle', 'anaconda', 'conda', 'jupyter', 'pycharm', 'spyder'] },
  { rank: 6, category: 'Windows', keys: ['powershell', 'pwsh', 'windowsterminal', 'windows terminal', 'cmd.exe', 'command prompt', 'powertoys'] },
  { rank: 10, category: '浏览器', keys: ['com.google.chrome', 'chrome', 'google chrome'] },
  { rank: 11, category: '浏览器', keys: ['com.microsoft.edgemac', 'msedge', 'microsoft edge', 'edge'] },
  { rank: 12, category: '浏览器', keys: ['org.mozilla.firefox', 'firefox'] },
  { rank: 13, category: '浏览器', keys: ['com.apple.safari', 'safari'] },
  { rank: 20, category: '办公', keys: ['com.microsoft.word', 'winword', 'word', 'microsoft word'] },
  { rank: 21, category: '办公', keys: ['com.microsoft.excel', 'excel', 'microsoft excel'] },
  { rank: 22, category: '办公', keys: ['com.microsoft.powerpoint', 'powerpnt', 'powerpoint'] },
  { rank: 23, category: '办公', keys: ['wps', 'wpsoffice', 'et', 'wpp'] },
  { rank: 30, category: '沟通', keys: ['wechat', 'weixin', '微信'] },
  { rank: 31, category: '沟通', keys: ['wxwork', 'wecom', '企业微信'] },
  { rank: 32, category: '沟通', keys: ['dingtalk', '钉钉'] },
  { rank: 33, category: '沟通', keys: ['feishu', 'lark', '飞书'] },
  { rank: 34, category: '沟通', keys: ['slack', 'teams', 'zoom', 'telegram'] },
  { rank: 40, category: '音乐', keys: ['qqmusic', 'qq 音乐', 'qq音乐'] },
  { rank: 41, category: '音乐', keys: ['cloudmusic', 'netease cloud music', '网易云音乐'] },
  { rank: 42, category: '音乐', keys: ['spotify'] },
  { rank: 50, category: '笔记', keys: ['notion', 'obsidian', 'onenote', 'notes'] },
  { rank: 60, category: '设计', keys: ['figma', 'photoshop', 'illustrator', 'xd'] },
  { rank: 70, category: '系统', keys: ['explorer', 'finder', 'terminal'] },
]

function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes('\\')
}

function normalizePathForMatch(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

function normalizeAppLookup(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\.exe$/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function isUserFacingWindowsPath(path: string): boolean {
  const p = normalizePathForMatch(path)
  if (!p) return false
  if (p.includes('/windows/system32/') || p.includes('/windows/syswow64/')) return false
  if (p.includes('/uninstall') || p.includes('/installer') || p.includes('/setup')) return false
  if (p.includes('/node_modules/')) return false
  if (p.includes('/.codex/')) return false
  if (p.includes('/src-tauri/target/')) return false
  if (p.includes('/microsoft/windows/start menu/programs/')) return true
  if (p.includes('/program files/')) return true
  if (p.includes('/program files (x86)/')) return true
  if (p.includes('/appdata/local/programs/')) return true
  if (p.includes('/windowsapps/')) return true
  if (p.includes('/desktop/') || p.includes('/桌面/')) return true
  return false
}

function isUserFacingPath(path: string, homeDir: string | undefined): boolean {
  if (isWindowsPath(path)) return isUserFacingWindowsPath(path)
  if (PATH_ALLOWLIST.some(root => path.startsWith(root))) return true
  if (homeDir) {
    const userApps = homeDir.endsWith('/')
      ? `${homeDir}Applications/`
      : `${homeDir}/Applications/`
    if (path.startsWith(userApps)) return true
  }
  return false
}

function isNoisyName(name: string): boolean {
  return NAME_PATTERN_BLOCKLIST.some(re => re.test(name))
}

function isComponentName(name: string): boolean {
  return SETTINGS_COMPONENT_NAME_BLOCKLIST.some(re => re.test(name))
}

function isHardBlockedApp(app: InstalledAppLike): boolean {
  const text = `${app.displayName} ${app.bundleId} ${app.path}`
  return HARD_BLOCK_APP_PATTERNS.some(re => re.test(text))
}

function settingAppMeta(app: InstalledAppLike): { rank: number; category: string } | undefined {
  const tokens = [app.bundleId, app.displayName, app.path]
    .map(normalizeAppLookup)
    .filter(Boolean)

  for (const rule of COMMON_APP_RULES) {
    const keys = rule.keys.map(normalizeAppLookup).filter(Boolean)
    if (
      keys.some(key =>
        tokens.some(token =>
          token === key || (key.length >= 5 && token.includes(key)),
        ),
      )
    ) {
      return { rank: rule.rank, category: rule.category }
    }
  }

  return undefined
}

/**
 * Length cap + trim + dedupe + sort. `applyCharFilter` — skip for trusted
 * bundle IDs (Apple/Google/MS; a localized "Réglages Système" with unusual
 * punctuation shouldn't be dropped), apply for anything attacker-installable.
 */
function sanitizeCore(
  raw: readonly string[],
  applyCharFilter: boolean,
): string[] {
  const seen = new Set<string>()
  return raw
    .map(name => name.trim())
    .filter(trimmed => {
      if (!trimmed) return false
      if (trimmed.length > APP_NAME_MAX_LEN) return false
      if (applyCharFilter && !APP_NAME_ALLOWED.test(trimmed)) return false
      if (seen.has(trimmed)) return false
      seen.add(trimmed)
      return true
    })
    .sort((a, b) => a.localeCompare(b))
}

function sanitizeAppNames(raw: readonly string[]): string[] {
  const filtered = sanitizeCore(raw, true)
  if (filtered.length <= APP_NAME_MAX_COUNT) return filtered
  return [
    ...filtered.slice(0, APP_NAME_MAX_COUNT),
    `… and ${filtered.length - APP_NAME_MAX_COUNT} more`,
  ]
}

function sanitizeTrustedNames(raw: readonly string[]): string[] {
  return sanitizeCore(raw, false)
}

/**
 * Filter raw Spotlight results to user-facing apps, then sanitize. Always-keep
 * apps bypass path/name filter AND char allowlist (trusted vendors, not
 * attacker-installed); still length-capped, deduped, sorted.
 */
export function filterAppsForDescription(
  installed: readonly InstalledAppLike[],
  homeDir: string | undefined,
): string[] {
  const { alwaysKept, rest } = installed.reduce<{
    alwaysKept: string[]
    rest: string[]
  }>(
    (acc, app) => {
      if (ALWAYS_KEEP_APP_KEYS.has(normalizeAppLookup(app.bundleId))) {
        acc.alwaysKept.push(app.displayName)
      } else if (
        isUserFacingPath(app.path, homeDir) &&
        !isNoisyName(app.displayName)
      ) {
        acc.rest.push(app.displayName)
      }
      return acc
    },
    { alwaysKept: [], rest: [] },
  )

  const sanitizedAlways = sanitizeTrustedNames(alwaysKept)
  const alwaysSet = new Set(sanitizedAlways)
  return [
    ...sanitizedAlways,
    ...sanitizeAppNames(rest).filter(n => !alwaysSet.has(n)),
  ]
}

export function filterAppsForSettings(
  installed: readonly InstalledAppLike[],
  homeDir: string | undefined,
): SettingsAppLike[] {
  const seen = new Set<string>()
  const filtered: Array<SettingsAppLike & { rank: number }> = []

  for (const app of installed) {
    const displayName = app.displayName.trim()
    const bundleId = app.bundleId.trim()
    if (!displayName || !bundleId) continue
    if (/[\r\n\t]/.test(displayName) || displayName.length > 80) continue
    if (isHardBlockedApp(app)) continue

    const meta = settingAppMeta(app)
    const isCommon = Boolean(meta)
    if (!isCommon) {
      if (!isUserFacingPath(app.path, homeDir)) continue
      if (
        isNoisyName(displayName) ||
        isComponentName(`${displayName} ${bundleId} ${app.path}`)
      ) {
        continue
      }
    }

    const key = normalizeAppLookup(bundleId) || normalizeAppLookup(displayName)
    if (!key || seen.has(key)) continue
    seen.add(key)

    filtered.push({
      bundleId,
      displayName,
      path: app.path,
      category: meta?.category ?? '应用',
      isCommon,
      rank: meta?.rank ?? 1_000,
    })
  }

  filtered.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank
    const commonDelta = Number(b.isCommon) - Number(a.isCommon)
    if (commonDelta !== 0) return commonDelta
    return a.displayName.localeCompare(b.displayName)
  })

  const common = filtered.filter(app => app.isCommon)
  const rest = filtered.filter(app => !app.isCommon)
  return [...common, ...rest.slice(0, Math.max(0, SETTINGS_APP_MAX_COUNT - common.length))]
    .map(({ rank: _rank, ...app }) => app)
}
