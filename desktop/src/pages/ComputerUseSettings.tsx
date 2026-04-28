import { useState, useEffect, useCallback, useMemo } from 'react'
import { computerUseApi, type ComputerUseStatus, type SetupResult, type InstalledApp, type AuthorizedApp } from '../api/computerUse'
import { useTranslation } from '../i18n'

type CheckState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const PYTHON_DOWNLOAD_URLS: Record<string, string> = {
  darwin: 'https://www.python.org/downloads/macos/',
  win32: 'https://www.python.org/downloads/windows/',
}

const CATEGORY_ICONS: Record<string, string> = {
  浏览器: 'public',
  办公: 'article',
  沟通: 'forum',
  音乐: 'music_note',
  笔记: 'edit_note',
  开发: 'terminal',
  Python: 'data_object',
  Windows: 'desktop_windows',
  工具: 'construction',
  设计: 'design_services',
  系统: 'settings_applications',
  应用: 'apps',
}

const FALLBACK_ICON_COLORS = [
  { bg: '#2563eb', fg: '#ffffff' },
  { bg: '#0f766e', fg: '#ffffff' },
  { bg: '#7c3aed', fg: '#ffffff' },
  { bg: '#be123c', fg: '#ffffff' },
  { bg: '#b45309', fg: '#ffffff' },
  { bg: '#475569', fg: '#ffffff' },
  { bg: '#15803d', fg: '#ffffff' },
]

const COMMON_APP_RULES: Array<{ category: string; keys: string[] }> = [
  { category: '开发', keys: ['qoder', 'visual studio code', 'vscode', 'code.exe', 'cursor', 'windsurf', 'trae'] },
  { category: 'Python', keys: ['python', 'pythonw', 'py.exe', 'idle', 'anaconda', 'conda', 'jupyter', 'pycharm', 'spyder'] },
  { category: 'Windows', keys: ['powershell', 'pwsh', 'windowsterminal', 'windows terminal', 'cmd.exe', 'command prompt', 'powertoys'] },
  { category: '浏览器', keys: ['chrome', 'google chrome', 'msedge', 'microsoft edge', 'edge', 'firefox', 'safari'] },
  { category: '音乐', keys: ['qqmusic', 'qq音乐', 'qq 音乐', 'cloudmusic', '网易云音乐', 'spotify'] },
  { category: '沟通', keys: ['wechat', '微信', 'weixin', 'wxwork', '企业微信', 'dingtalk', '钉钉', 'feishu', '飞书', 'lark', 'slack', 'teams', 'zoom'] },
  { category: '办公', keys: ['winword', 'word', 'excel', 'powerpnt', 'powerpoint', 'wps', 'wpsoffice', 'et.exe', 'wpp.exe'] },
  { category: '笔记', keys: ['notion', 'obsidian', 'onenote', 'notes'] },
  { category: '设计', keys: ['figma', 'photoshop', 'illustrator'] },
  { category: '系统', keys: ['explorer', 'finder'] },
]

const NOISY_APP_NAME_PATTERNS = [
  /\$\{\{/,
  /^\{[0-9a-f-]{20,}/i,
  /^KB\d+/i,
  /\b(aggregatorhost|administrative tools|control panel|host process)\b/i,
  /\b(uninstall|uninstaller|installer|setup|update|updater|helper|agent|service|runtime|redistributable|component|driver|sdk|framework|webview|language pack|documentation|telemetry|crash|diagnostic)\b/i,
  /(卸载|安装程序|更新|运行库|驱动|组件|服务)/,
]

const HARD_BLOCK_APP_PATTERNS = [
  /\$\{\{/,
  /^\{[0-9a-f-]{20,}/i,
  /\b(uninstall|uninstaller|installer|setup|update|updater|repair|maintenance)\b/i,
  /(卸载|安装程序|更新|修复|维护)/,
]

const CATEGORY_ORDER = [
  '开发',
  'Python',
  'Windows',
  '浏览器',
  '办公',
  '沟通',
  '音乐',
  '笔记',
  '设计',
  '工具',
  '系统',
  '应用',
]

function StatusIcon({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return <span className="material-symbols-outlined text-[18px] text-[var(--color-text-tertiary)]">help</span>
  }
  return ok ? (
    <span className="material-symbols-outlined text-[18px] text-green-500" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
  ) : (
    <span className="material-symbols-outlined text-[18px] text-red-400" style={{ fontVariationSettings: "'FILL' 1" }}>cancel</span>
  )
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md bg-[var(--color-surface-container-low)] px-3 py-2">
      <StatusIcon ok={ok} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--color-text-primary)]">{label}</div>
        <div className="truncate text-xs text-[var(--color-text-tertiary)]">{detail}</div>
      </div>
    </div>
  )
}

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 flex-shrink-0 overflow-hidden rounded-full border transition-colors ${
        checked
          ? 'border-[var(--color-brand)] bg-[var(--color-brand)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface-container-high)]'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-[left] ${
          checked ? 'left-[22px]' : 'left-[4px]'
        }`}
      />
    </button>
  )
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

function appInitials(name: string): string {
  const chars = Array.from(name.trim()).filter(ch => /[\p{L}\p{N}]/u.test(ch))
  if (chars.length === 0) return 'APP'
  return chars.slice(0, 2).join('').toUpperCase()
}

function normalizeLookup(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function appKey(value: string | undefined): string {
  return normalizeLookup(value ?? '')
}

function authorizedKeys(apps: AuthorizedApp[]): Set<string> {
  return new Set(apps.map(app => appKey(app.bundleId)).filter(Boolean))
}

function authorizedHas(keys: Set<string>, bundleId: string | undefined): boolean {
  const key = appKey(bundleId)
  return Boolean(key && keys.has(key))
}

function normalizePath(value: string | undefined): string {
  return String(value ?? '').replace(/\\/g, '/').toLowerCase()
}

function isHardBlockedApp(app: InstalledApp): boolean {
  const text = `${app.displayName} ${app.bundleId} ${app.path}`
  return HARD_BLOCK_APP_PATTERNS.some(re => re.test(text))
}

function classifyCommonApp(app: InstalledApp): { isCommon: boolean; category?: string } {
  if (app.isCommon) return { isCommon: true, category: app.category ?? '应用' }
  const haystack = [
    app.bundleId,
    app.displayName,
    app.path,
  ].map(normalizeLookup).join(' ')

  for (const rule of COMMON_APP_RULES) {
    if (rule.keys.some(key => {
      const normalized = normalizeLookup(key)
      return normalized && haystack.includes(normalized)
    })) {
      return { isCommon: true, category: rule.category }
    }
  }

  return { isCommon: false, category: app.category }
}

function isNoisyApp(app: InstalledApp): boolean {
  const name = `${app.displayName} ${app.bundleId}`
  if (NOISY_APP_NAME_PATTERNS.some(re => re.test(name))) return true
  const path = normalizePath(app.path)
  if (!path) return true
  if (path.includes('/windows/system32/') || path.includes('/windows/syswow64/')) return true
  if (path.includes('/node_modules/') || path.includes('/src-tauri/target/') || path.includes('/.codex/')) return true
  if (path.includes('/uninstall') || path.includes('/installer') || path.includes('/setup')) return true
  return false
}

function isUserFacingPath(app: InstalledApp): boolean {
  const path = normalizePath(app.path)
  if (!path) return false
  if (path.includes('/microsoft/windows/start menu/programs/')) return true
  if (path.includes('/program files/')) return true
  if (path.includes('/program files (x86)/')) return true
  if (path.includes('/appdata/local/programs/')) return true
  if (path.includes('/windowsapps/')) return true
  if (path.includes('/desktop/') || path.includes('/桌面/')) return true
  if (path.includes('/applications/')) return true
  return false
}

function normalizeAppsForSettings(rawApps: InstalledApp[]): InstalledApp[] {
  const seen = new Set<string>()
  const normalized: InstalledApp[] = []

  for (const rawApp of rawApps) {
    const displayName = String(rawApp.displayName ?? '').trim()
    const bundleId = String(rawApp.bundleId ?? '').trim()
    if (!displayName || !bundleId) continue
    if (displayName.length > 80 || /[\r\n\t]/.test(displayName)) continue

    const baseApp = { ...rawApp, displayName, bundleId }
    if (isHardBlockedApp(baseApp)) continue

    const classified = classifyCommonApp(baseApp)
    const candidate = {
      ...baseApp,
      displayName,
      bundleId,
      category: classified.category ?? rawApp.category ?? '应用',
      isCommon: classified.isCommon,
    }

    if (!candidate.isCommon && (isNoisyApp(candidate) || !isUserFacingPath(candidate))) {
      continue
    }

    const key = normalizeLookup(candidate.bundleId) || normalizeLookup(candidate.displayName)
    if (!key || seen.has(key)) continue
    seen.add(key)
    normalized.push(candidate)
  }

  return normalized.sort((a, b) => {
    const commonDelta = Number(b.isCommon) - Number(a.isCommon)
    if (commonDelta !== 0) return commonDelta
    return a.displayName.localeCompare(b.displayName)
  })
}

function categoryLabel(category: string | undefined, t: ReturnType<typeof useTranslation>): string {
  switch (category) {
    case '开发':
      return t('settings.computerUse.categoryDevelopment')
    case 'Python':
      return t('settings.computerUse.categoryPython')
    case 'Windows':
      return t('settings.computerUse.categoryWindows')
    case '浏览器':
      return t('settings.computerUse.categoryBrowser')
    case '办公':
      return t('settings.computerUse.categoryOffice')
    case '沟通':
      return t('settings.computerUse.categoryCommunication')
    case '音乐':
      return t('settings.computerUse.categoryMusic')
    case '笔记':
      return t('settings.computerUse.categoryNotes')
    case '设计':
      return t('settings.computerUse.categoryDesign')
    case '工具':
      return t('settings.computerUse.categoryTools')
    case '系统':
      return t('settings.computerUse.categorySystem')
    default:
      return t('settings.computerUse.categoryOther')
  }
}

function groupAppsByCategory(apps: InstalledApp[]) {
  const grouped = new Map<string, InstalledApp[]>()
  for (const app of apps) {
    const category = app.category || '应用'
    grouped.set(category, [...(grouped.get(category) ?? []), app])
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => {
      const ai = CATEGORY_ORDER.indexOf(a)
      const bi = CATEGORY_ORDER.indexOf(b)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })
    .map(([category, apps]) => ({ category, apps }))
}

function AppIcon({ app }: { app: InstalledApp }) {
  const [failed, setFailed] = useState(false)
  if (app.iconDataUrl && !failed) {
    return (
      <img
        src={app.iconDataUrl}
        alt=""
        className="h-9 w-9 rounded-md object-contain"
        onError={() => setFailed(true)}
      />
    )
  }

  const color = FALLBACK_ICON_COLORS[hashString(app.bundleId) % FALLBACK_ICON_COLORS.length]
  const icon = CATEGORY_ICONS[app.category ?? '应用'] ?? CATEGORY_ICONS.应用
  return (
    <div
      className="flex h-9 w-9 items-center justify-center rounded-md text-[11px] font-semibold"
      style={{ backgroundColor: color.bg, color: color.fg }}
    >
      {app.isCommon ? (
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      ) : (
        appInitials(app.displayName)
      )}
    </div>
  )
}

async function openSystemSettings(pane: 'Privacy_ScreenCapture' | 'Privacy_Accessibility') {
  await computerUseApi.openSettings(pane)
}

async function openExternalUrl(url: string) {
  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export function ComputerUseSettings() {
  const t = useTranslation()
  const [status, setStatus] = useState<ComputerUseStatus | null>(null)
  const [checkState, setCheckState] = useState<CheckState>('loading')
  const [setupRunning, setSetupRunning] = useState(false)
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null)

  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([])
  const [authorizedBundleIds, setAuthorizedBundleIds] = useState<Set<string>>(new Set())
  const [authorizedApps, setAuthorizedApps] = useState<AuthorizedApp[]>([])
  const [appsLoading, setAppsLoading] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [clipboardAccess, setClipboardAccess] = useState(true)
  const [systemKeys, setSystemKeys] = useState(true)
  const [computerWideAccess, setComputerWideAccess] = useState(false)

  const fetchStatus = useCallback(async () => {
    setCheckState('loading')
    try {
      const s = await computerUseApi.getStatus()
      setStatus(s)
      setCheckState('ready')
    } catch {
      setCheckState('error')
    }
  }, [])

  const fetchApps = useCallback(async () => {
    setAppsLoading(true)
    try {
      const [appsResult, configResult] = await Promise.all([
        computerUseApi.getInstalledApps(),
        computerUseApi.getAuthorizedApps(),
      ])
      setInstalledApps(normalizeAppsForSettings(appsResult.apps))
      setAuthorizedApps(configResult.authorizedApps)
      setAuthorizedBundleIds(authorizedKeys(configResult.authorizedApps))
      setClipboardAccess(configResult.grantFlags.clipboardRead)
      setSystemKeys(configResult.grantFlags.systemKeyCombos)
      setComputerWideAccess(configResult.computerWideAccess === true)
    } catch {
      // API not ready yet.
    } finally {
      setAppsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const envReady = status?.venv.created && status?.dependencies.installed
  useEffect(() => {
    if (envReady) fetchApps()
  }, [envReady, fetchApps])

  const markSaved = useCallback(() => {
    setSaveState('saved')
    setSaveError(null)
    window.setTimeout(() => {
      setSaveState(current => current === 'saved' ? 'idle' : current)
    }, 1500)
  }, [])

  const normalizeAuthorizedIds = (apps: AuthorizedApp[]) =>
    apps.map(app => app.bundleId).sort().join('\n')

  const verifySavedConfig = (
    saved: Awaited<ReturnType<typeof computerUseApi.getAuthorizedApps>>,
    expected: {
      authorizedApps: AuthorizedApp[]
      clipboardAccess: boolean
      systemKeys: boolean
      computerWideAccess: boolean
    },
  ) => (
    saved.computerWideAccess === expected.computerWideAccess &&
    saved.grantFlags.clipboardRead === expected.clipboardAccess &&
    saved.grantFlags.clipboardWrite === expected.clipboardAccess &&
    saved.grantFlags.systemKeyCombos === expected.systemKeys &&
    normalizeAuthorizedIds(saved.authorizedApps) === normalizeAuthorizedIds(expected.authorizedApps)
  )

  const applyConfigState = (
    config: Awaited<ReturnType<typeof computerUseApi.getAuthorizedApps>>,
  ) => {
    setAuthorizedApps(config.authorizedApps)
    setAuthorizedBundleIds(authorizedKeys(config.authorizedApps))
    setClipboardAccess(config.grantFlags.clipboardRead)
    setSystemKeys(config.grantFlags.systemKeyCombos)
    setComputerWideAccess(config.computerWideAccess === true)
  }

  const persistConfig = useCallback((
    next: {
      authorizedApps?: AuthorizedApp[]
      clipboardAccess?: boolean
      systemKeys?: boolean
      computerWideAccess?: boolean
    } = {},
  ) => {
    const nextAuthorizedApps = next.authorizedApps ?? authorizedApps
    const nextClipboardAccess = next.clipboardAccess ?? clipboardAccess
    const nextSystemKeys = next.systemKeys ?? systemKeys
    const nextComputerWideAccess = next.computerWideAccess ?? computerWideAccess

    const expected = {
      authorizedApps: nextAuthorizedApps,
      clipboardAccess: nextClipboardAccess,
      systemKeys: nextSystemKeys,
      computerWideAccess: nextComputerWideAccess,
    }

    setSaveState('saving')
    setSaveError(null)

    return computerUseApi.setAuthorizedApps({
      authorizedApps: nextAuthorizedApps,
      computerWideAccess: nextComputerWideAccess,
      grantFlags: {
        clipboardRead: nextClipboardAccess,
        clipboardWrite: nextClipboardAccess,
        systemKeyCombos: nextSystemKeys,
      },
    })
      .then(() => computerUseApi.getAuthorizedApps())
      .then(saved => {
        if (!verifySavedConfig(saved, expected)) {
          applyConfigState(saved)
          throw new Error(t('settings.computerUse.appsSaveVerifyFailed'))
        }
        markSaved()
        return true
      })
      .catch(error => {
        setSaveState('error')
        setSaveError(error instanceof Error ? error.message : t('settings.computerUse.appsSaveFailed'))
        return false
      })
  }, [authorizedApps, clipboardAccess, computerWideAccess, markSaved, systemKeys, t])

  const handleSetup = async () => {
    setSetupRunning(true)
    setSetupResult(null)
    try {
      const result = await computerUseApi.runSetup()
      setSetupResult(result)
      await fetchStatus()
      if (result.success) await fetchApps()
    } catch {
      setSetupResult({ success: false, steps: [{ name: 'error', ok: false, message: 'Request failed' }] })
    } finally {
      setSetupRunning(false)
    }
  }

  const toggleApp = (app: InstalledApp) => {
    if (computerWideAccess) return

    const previousSet = authorizedBundleIds
    const previousAuthorized = authorizedApps
    const newSet = new Set(authorizedBundleIds)
    let newAuthorized = [...authorizedApps]
    const key = appKey(app.bundleId)
    if (authorizedHas(newSet, app.bundleId)) {
      newSet.delete(key)
      newAuthorized = newAuthorized.filter(a => appKey(a.bundleId) !== key)
    } else {
      newSet.add(key)
      newAuthorized.push({
        bundleId: app.bundleId,
        displayName: app.displayName,
        authorizedAt: new Date().toISOString(),
      })
    }

    setAuthorizedBundleIds(newSet)
    setAuthorizedApps(newAuthorized)
    void persistConfig({ authorizedApps: newAuthorized }).then(ok => {
      if (!ok) {
        setAuthorizedBundleIds(previousSet)
        setAuthorizedApps(previousAuthorized)
      }
    })
  }

  const toggleComputerWideAccess = (value: boolean) => {
    const previous = computerWideAccess
    setComputerWideAccess(value)
    void persistConfig({ computerWideAccess: value }).then(ok => {
      if (!ok) setComputerWideAccess(previous)
    })
  }

  const toggleFlag = (flag: 'clipboard' | 'systemKeys', value: boolean) => {
    if (flag === 'clipboard') {
      const previous = clipboardAccess
      setClipboardAccess(value)
      void persistConfig({ clipboardAccess: value }).then(ok => {
        if (!ok) setClipboardAccess(previous)
      })
    } else {
      const previous = systemKeys
      setSystemKeys(value)
      void persistConfig({ systemKeys: value }).then(ok => {
        if (!ok) setSystemKeys(previous)
      })
    }
  }

  const allReady =
    status?.supported &&
    status.python.installed &&
    status.venv.created &&
    status.dependencies.installed

  const accessibilityNeedsAttention = status?.permissions.accessibility === false
  const screenRecordingNeedsAttention = status?.permissions.screenRecording === false
  const screenRecordingReady = status ? status.permissions.screenRecording !== false : null
  const pythonDownloadUrl = status
    ? PYTHON_DOWNLOAD_URLS[status.platform] ?? 'https://www.python.org/downloads/'
    : 'https://www.python.org/downloads/'

  const defaultApps = useMemo(() => {
    const authorized = installedApps.filter(app => authorizedHas(authorizedBundleIds, app.bundleId))
    const rest = installedApps.filter(app => !authorizedHas(authorizedBundleIds, app.bundleId))
    const seen = new Set<string>()
    return [...authorized, ...rest]
      .filter(app => {
        const key = normalizeLookup(app.bundleId)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 160)
  }, [authorizedBundleIds, installedApps])

  const visibleApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return defaultApps
    return installedApps.filter(app =>
      app.displayName.toLowerCase().includes(q) ||
      app.bundleId.toLowerCase().includes(q) ||
      app.category?.toLowerCase().includes(q),
    ).slice(0, 80)
  }, [defaultApps, installedApps, searchQuery])

  const visibleSections = useMemo(() => groupAppsByCategory(visibleApps), [visibleApps])
  const commonAppCount = installedApps.filter(app => app.isCommon).length

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t('settings.computerUse.title')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--color-text-secondary)]">
            {t('settings.computerUse.description')}
          </p>
        </div>
        <button
          onClick={fetchStatus}
          className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span>
          {t('settings.computerUse.recheckBtn')}
        </button>
      </div>

      {checkState === 'loading' ? (
        <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
          {t('common.loading')}
        </div>
      ) : checkState === 'error' ? (
        <div className="py-8 text-center text-sm text-red-400">
          Failed to check status.
          <button onClick={fetchStatus} className="ml-2 underline">{t('common.retry')}</button>
        </div>
      ) : status ? (
        <>
          {!status.supported && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-600">
              {t('settings.computerUse.notSupported')}
            </div>
          )}

          <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {t('settings.computerUse.environmentTitle')}
                </h3>
                <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
                  {allReady ? t('settings.computerUse.allReady') : t('settings.computerUse.environmentDescription')}
                </p>
              </div>
              {allReady && (
                <span className="inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2 py-1 text-xs font-medium text-green-600">
                  <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                  {t('settings.computerUse.readyBadge')}
                </span>
              )}
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <StatusRow
                label={t('settings.computerUse.python')}
                ok={status.python.installed}
                detail={
                  status.python.installed
                    ? `${t('settings.computerUse.pythonFound')} - ${status.python.version} (${status.python.path})`
                    : t('settings.computerUse.pythonNotFound')
                }
              />
              <StatusRow
                label={t('settings.computerUse.venv')}
                ok={status.venv.created}
                detail={status.venv.created ? `${t('settings.computerUse.venvReady')} - ${status.venv.path}` : t('settings.computerUse.venvNotReady')}
              />
              <StatusRow
                label={t('settings.computerUse.deps')}
                ok={status.dependencies.installed}
                detail={status.dependencies.installed ? t('settings.computerUse.depsReady') : t('settings.computerUse.depsNotReady')}
              />
            </div>

            {envReady && status.platform === 'darwin' && (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <StatusRow
                  label={t('settings.computerUse.accessibility')}
                  ok={status.permissions.accessibility}
                  detail={
                    status.permissions.accessibility === null ? t('settings.computerUse.permUnknown')
                      : status.permissions.accessibility ? t('settings.computerUse.permGranted')
                        : t('settings.computerUse.permDenied')
                  }
                />
                <StatusRow
                  label={t('settings.computerUse.screenRecording')}
                  ok={screenRecordingReady}
                  detail={
                    status.permissions.screenRecording === true ? t('settings.computerUse.permGranted')
                      : status.permissions.screenRecording === false ? t('settings.computerUse.permDenied')
                        : t('settings.computerUse.permScreenRecordingUnknownSoft')
                  }
                />
              </div>
            )}

            {envReady && status.platform === 'darwin' && (accessibilityNeedsAttention || screenRecordingNeedsAttention) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
                <p className="mr-auto text-xs text-[var(--color-text-tertiary)]">{t('settings.computerUse.permRestartHint')}</p>
                {accessibilityNeedsAttention && (
                  <button
                    onClick={() => openSystemSettings('Privacy_Accessibility')}
                    className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-accent)] hover:bg-[var(--color-surface-hover)]"
                  >
                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    {t('settings.computerUse.openAccessibility')}
                  </button>
                )}
                {screenRecordingNeedsAttention && (
                  <button
                    onClick={() => openSystemSettings('Privacy_ScreenCapture')}
                    className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-accent)] hover:bg-[var(--color-surface-hover)]"
                  >
                    <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                    {t('settings.computerUse.openScreenRecording')}
                  </button>
                )}
              </div>
            )}

            {setupResult && (
              <div className={`mt-3 rounded-md border p-3 ${setupResult.success ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                <div className={`text-sm font-medium ${setupResult.success ? 'text-green-600' : 'text-red-400'}`}>
                  {setupResult.success ? t('settings.computerUse.setupSuccess') : t('settings.computerUse.setupFail')}
                </div>
                <div className="mt-2 space-y-1">
                  {setupResult.steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                      <StatusIcon ok={step.ok} />
                      <span>{step.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!status.python.installed || (!envReady && status.python.installed)) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {!status.python.installed && (
                  <button
                    onClick={() => openExternalUrl(pythonDownloadUrl)}
                    className="flex items-center gap-2 rounded-md bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                  >
                    <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                    {t('settings.computerUse.downloadPython')}
                  </button>
                )}
                {!envReady && status.python.installed && (
                  <button
                    onClick={handleSetup}
                    disabled={setupRunning}
                    className="flex items-center gap-2 rounded-md bg-[var(--color-brand)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[18px]">{setupRunning ? 'hourglass_empty' : 'download'}</span>
                    {setupRunning ? t('settings.computerUse.setupRunning') : t('settings.computerUse.setupBtn')}
                  </button>
                )}
              </div>
            )}
          </section>

          {envReady && (
            <>
              <section className={`rounded-lg border p-4 transition-colors ${
                computerWideAccess
                  ? 'border-[var(--color-brand)]/50 bg-[var(--color-brand)]/5'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]'
              }`}>
                <div className="flex items-start gap-4">
                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md ${
                    computerWideAccess
                      ? 'bg-[var(--color-brand)] text-white'
                      : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)]'
                  }`}>
                    <span className="material-symbols-outlined text-[22px]">
                      {computerWideAccess ? 'admin_panel_settings' : 'shield_lock'}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                          {t('settings.computerUse.computerWideTitle')}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">
                          {computerWideAccess
                            ? t('settings.computerUse.computerWideDescriptionOn')
                            : t('settings.computerUse.computerWideDescriptionOff')}
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={computerWideAccess}
                        disabled={saveState === 'saving'}
                        onChange={toggleComputerWideAccess}
                        label={t('settings.computerUse.computerWideTitle')}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                        <input
                          type="checkbox"
                          checked={clipboardAccess}
                          disabled={saveState === 'saving'}
                          onChange={e => toggleFlag('clipboard', e.target.checked)}
                          className="rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                        />
                        {t('settings.computerUse.flagClipboard')}
                      </label>
                      <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                        <input
                          type="checkbox"
                          checked={systemKeys}
                          disabled={saveState === 'saving'}
                          onChange={e => toggleFlag('systemKeys', e.target.checked)}
                          className="rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                        />
                        {t('settings.computerUse.flagSystemKeys')}
                      </label>
                      {saveState === 'saving' && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-text-tertiary)]">
                          <span className="material-symbols-outlined text-[14px]">sync</span>
                          {t('settings.computerUse.appsSaving')}
                        </span>
                      )}
                      {saveState === 'saved' && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                          <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                          {t('settings.computerUse.appsSaved')}
                        </span>
                      )}
                      {saveState === 'error' && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
                          <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>error</span>
                          {saveError ?? t('settings.computerUse.appsSaveFailed')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)]">
                <div className="border-b border-[var(--color-border)] px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                        {t('settings.computerUse.appsTitle')}
                      </h3>
                      <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
                        {t('settings.computerUse.appsDescription', {
                          common: commonAppCount,
                          total: installedApps.length,
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
                      <span className="rounded-md bg-[var(--color-surface-container-low)] px-2 py-1">
                        {t('settings.computerUse.authorizedCount', { count: authorizedBundleIds.size })}
                      </span>
                      {computerWideAccess && (
                        <span className="rounded-md bg-[var(--color-brand)]/10 px-2 py-1 font-medium text-[var(--color-brand)]">
                          {t('settings.computerUse.computerWideEnabled')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative mt-3">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[var(--color-text-tertiary)]">search</span>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder={t('settings.computerUse.appsSearch')}
                      className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] py-2 pl-9 pr-4 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-brand)] focus:outline-none"
                    />
                  </div>
                </div>

                {appsLoading ? (
                  <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
                    {t('settings.computerUse.appsLoading')}
                  </div>
                ) : installedApps.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
                    {t('settings.computerUse.appsEmpty')}
                  </div>
                ) : visibleApps.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">
                    {searchQuery.trim()
                      ? t('settings.computerUse.appsNoResults')
                      : t('settings.computerUse.appsNoCommon')}
                  </div>
                ) : (
                  <div className="max-h-[520px] overflow-y-auto">
                    {visibleSections.map(section => (
                      <div key={section.category} className="border-b border-[var(--color-border)] last:border-b-0">
                        <div className="sticky top-0 z-[1] flex items-center justify-between bg-[var(--color-surface-container-lowest)] px-4 py-2">
                          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
                            <span className="material-symbols-outlined text-[15px] text-[var(--color-text-tertiary)]">
                              {CATEGORY_ICONS[section.category] ?? CATEGORY_ICONS.应用}
                            </span>
                            {categoryLabel(section.category, t)}
                          </div>
                          <span className="text-[11px] text-[var(--color-text-tertiary)]">
                            {section.apps.length}
                          </span>
                        </div>
                        <div className="divide-y divide-[var(--color-border)]">
                          {section.apps.map(app => {
                            const explicitAuthorized = authorizedHas(authorizedBundleIds, app.bundleId)
                            const effectivelyAuthorized = computerWideAccess || explicitAuthorized
                            return (
                              <button
                                key={app.bundleId}
                                type="button"
                                aria-pressed={effectivelyAuthorized}
                                aria-disabled={computerWideAccess}
                                onClick={() => toggleApp(app)}
                                className={`group flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition-colors ${
                                  computerWideAccess
                                    ? 'cursor-default'
                                    : 'hover:bg-[var(--color-surface-hover)]'
                                } ${explicitAuthorized && !computerWideAccess ? 'bg-[var(--color-brand)]/5' : ''}`}
                              >
                                <AppIcon app={app} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                                      {app.displayName}
                                    </div>
                                    <span className="flex-shrink-0 rounded-md bg-[var(--color-surface-container-low)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                                      {categoryLabel(app.category, t)}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 truncate text-[11px] text-[var(--color-text-tertiary)]">
                                    {app.bundleId}
                                  </div>
                                </div>
                                <div className="flex flex-shrink-0 items-center gap-2">
                                  <span className={`text-xs ${
                                    effectivelyAuthorized
                                      ? 'text-[var(--color-brand)]'
                                      : 'text-[var(--color-text-tertiary)]'
                                  }`}>
                                    {computerWideAccess
                                      ? t('settings.computerUse.computerWideAllowed')
                                      : explicitAuthorized
                                        ? t('settings.computerUse.appAuthorized')
                                        : t('settings.computerUse.appNeedsPrompt')}
                                  </span>
                                  <span
                                    className={`flex h-5 w-5 items-center justify-center rounded border ${
                                      effectivelyAuthorized
                                        ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white'
                                        : 'border-[var(--color-border)] text-transparent group-hover:text-[var(--color-text-tertiary)]'
                                    }`}
                                  >
                                    <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                                  </span>
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </>
      ) : null}
    </div>
  )
}
