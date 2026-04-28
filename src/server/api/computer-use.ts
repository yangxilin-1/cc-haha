/**
 * Computer Use API — 环境检测与依赖安装
 *
 * Routes:
 *   GET  /api/computer-use/status  — 检测 Python3、venv、依赖、权限状态
 *   POST /api/computer-use/setup   — 创建 venv 并安装依赖
 */

import { join } from 'path'
import { access, readFile, mkdir, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { homedir } from 'os'
import {
  type AppGrant,
  type CuGrantFlags,
  type CuPermissionRequest,
  type CuPermissionResponse,
} from '../../vendor/computer-use-mcp/index.js'
import { computerUseApprovalService } from '../services/computerUseApprovalService.js'
import { detectPythonRuntime } from './computer-use-python.js'
import { filterAppsForSettings, type SettingsAppLike } from '../../utils/computerUse/appNames.js'
import {
  COMPUTER_WIDE_ACCESS_BUNDLE_ID,
  COMPUTER_WIDE_ACCESS_DISPLAY_NAME,
  DEFAULT_DESKTOP_GRANT_FLAGS,
  normalizeStoredAppKey,
  resolveStoredComputerUseConfig,
  type StoredComputerUseConfig,
} from '../../utils/computerUse/preauthorizedConfig.js'
import { getComputerUseRuntimeRoot } from '../../utils/computerUse/runtimePaths.js'
// Embed helper scripts at compile time so they're available in bundled mode
// @ts-ignore — Bun text import
import MAC_HELPER_CONTENT from '../../../runtime/mac_helper.py' with { type: 'text' }
// @ts-ignore — Bun text import
import WIN_HELPER_CONTENT from '../../../runtime/win_helper.py' with { type: 'text' }
// @ts-ignore — Bun text import
import REQUIREMENTS_DARWIN_CONTENT from '../../../runtime/requirements.txt' with { type: 'text' }
// @ts-ignore — Bun text import
import REQUIREMENTS_WIN_CONTENT from '../../../runtime/requirements-win.txt' with { type: 'text' }

import { getAppDataDir } from '../utils/paths.js'

const runtimeStateRoot = getComputerUseRuntimeRoot()
const venvRoot = join(runtimeStateRoot, 'venv')
const installStampPath = join(runtimeStateRoot, 'requirements.sha256')

const isWindows = process.platform === 'win32'
const REQUIREMENTS_CONTENT = isWindows ? REQUIREMENTS_WIN_CONTENT : REQUIREMENTS_DARWIN_CONTENT

function getPythonCommandEnv(): Record<string, string> | undefined {
  if (!isWindows) return undefined
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  } as Record<string, string>
}

// 清华大学 PyPI 镜像，国内安装速度更快
const PIP_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple/'
const PIP_TRUSTED_HOST = 'pypi.tuna.tsinghua.edu.cn'

// Paths that resolve correctly in both dev and bundled modes
function getRequirementsPath(): string {
  return join(runtimeStateRoot, 'requirements.txt')
}

function getHelperFileName(): string {
  return isWindows ? 'win_helper.py' : 'mac_helper.py'
}

function getHelperPath(): string {
  return join(runtimeStateRoot, getHelperFileName())
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function runCommand(
  cmd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  try {
    const proc = Bun.spawn([cmd, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: getPythonCommandEnv(),
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    return { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code }
  } catch {
    return { ok: false, stdout: '', stderr: `Failed to run ${cmd}`, code: -1 }
  }
}

/**
 * Ensure runtime source files (requirements.txt, platform helper) exist in
 * the desktop-owned Computer Use runtime directory.
 */
async function ensureRuntimeFiles(): Promise<void> {
  await mkdir(runtimeStateRoot, { recursive: true })

  // requirements.txt — always write from embedded constant (authoritative)
  await writeFile(getRequirementsPath(), REQUIREMENTS_CONTENT, 'utf8')

  // helper script — write the platform-appropriate version
  const helperContent = isWindows ? WIN_HELPER_CONTENT : MAC_HELPER_CONTENT
  await writeFile(getHelperPath(), helperContent, 'utf8')
}

type EnvStatus = {
  platform: string
  supported: boolean
  python: {
    installed: boolean
    version: string | null
    path: string | null
  }
  venv: {
    created: boolean
    path: string
  }
  dependencies: {
    installed: boolean
    requirementsFound: boolean
  }
  permissions: {
    accessibility: boolean | null
    screenRecording: boolean | null
  }
}

async function checkStatus(): Promise<EnvStatus> {
  const platform = process.platform
  const supported = platform === 'darwin' || platform === 'win32'

  // Check venv — different paths on Windows vs Unix
  const venvPython = isWindows
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python3')
  const venvCreated = await pathExists(venvPython)

  const pythonRuntime = await detectPythonRuntime(platform, runCommand, venvCreated ? venvPython : undefined)

  // Check dependencies — use the state dir copy
  const reqPath = getRequirementsPath()
  const requirementsFound = await pathExists(reqPath)
  let depsInstalled = false
  if (requirementsFound && venvCreated) {
    try {
      const requirements = await readFile(reqPath, 'utf8')
      const digest = createHash('sha256').update(requirements).digest('hex')
      const stamp = (await readFile(installStampPath, 'utf8')).trim()
      depsInstalled = stamp === digest
    } catch {
      depsInstalled = false
    }
  }

  // Check macOS permissions without triggering a system prompt. The helper
  // uses preflight + visible-window metadata as a passive fallback because
  // plain preflight can misreport child processes launched by the desktop app.
  let accessibility: boolean | null = null
  let screenRecording: boolean | null = null
  if (supported && venvCreated && depsInstalled) {
    try { await ensureRuntimeFiles() } catch {}
    const helperPath = getHelperPath()
    if (await pathExists(helperPath)) {
      const permResult = await runCommand(venvPython, [helperPath, 'check_permissions'])
      if (permResult.ok) {
        try {
          const parsed = JSON.parse(permResult.stdout)
          if (parsed.ok && parsed.result) {
            accessibility = parsed.result.accessibility ?? null
            screenRecording = parsed.result.screenRecording ?? null
          }
        } catch {}
      }
    }
  }

  return {
    platform,
    supported,
    python: {
      installed: pythonRuntime.installed,
      version: pythonRuntime.version,
      path: pythonRuntime.path,
    },
    venv: { created: venvCreated, path: venvRoot },
    dependencies: { installed: depsInstalled, requirementsFound: requirementsFound || true },
    permissions: { accessibility, screenRecording },
  }
}

type SetupResult = {
  success: boolean
  steps: { name: string; ok: boolean; message: string }[]
}

async function runSetup(): Promise<SetupResult> {
  const steps: SetupResult['steps'] = []

  const venvPython = isWindows
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python3')
  const venvExists = await pathExists(venvPython)

  // Step 1: Check python
  const pythonRuntime = await detectPythonRuntime(
    process.platform,
    runCommand,
    venvExists ? venvPython : undefined,
  )
  if (!pythonRuntime.installed) {
    steps.push({
      name: 'python_check',
      ok: false,
      message: 'Python 3 未安装，请先安装 Python 3',
    })
    return { success: false, steps }
  }
  steps.push({
    name: 'python_check',
    ok: true,
    message: pythonRuntime.source === 'venv'
      ? `Python ${pythonRuntime.version}（使用现有虚拟环境）`
      : `Python ${pythonRuntime.version}`,
  })

  // Step 2: Extract runtime files to the desktop-owned runtime directory
  try {
    await ensureRuntimeFiles()
    steps.push({ name: 'runtime_files', ok: true, message: '运行时文件已就绪' })
  } catch (err) {
    steps.push({
      name: 'runtime_files',
      ok: false,
      message: `提取运行时文件失败: ${err}`,
    })
    return { success: false, steps }
  }

  // Step 3: Create venv
  if (!venvExists) {
    if (!pythonRuntime.command) {
      steps.push({
        name: 'venv',
        ok: false,
        message: '未找到可用于创建虚拟环境的 Python 命令',
      })
      return { success: false, steps }
    }
    const venvResult = await runCommand(pythonRuntime.command, [
      ...pythonRuntime.prefixArgs,
      '-m',
      'venv',
      venvRoot,
    ])
    if (!venvResult.ok) {
      steps.push({
        name: 'venv',
        ok: false,
        message: `创建虚拟环境失败: ${venvResult.stderr}`,
      })
      return { success: false, steps }
    }
    steps.push({ name: 'venv', ok: true, message: '虚拟环境已创建' })
  } else {
    steps.push({ name: 'venv', ok: true, message: '虚拟环境已存在' })
  }

  // Step 4: Ensure pip
  const pipPath = isWindows
    ? join(venvRoot, 'Scripts', 'pip.exe')
    : join(venvRoot, 'bin', 'pip')
  if (!(await pathExists(pipPath))) {
    const pipResult = await runCommand(venvPython, [
      '-m',
      'ensurepip',
      '--upgrade',
    ])
    if (!pipResult.ok) {
      steps.push({
        name: 'pip',
        ok: false,
        message: `安装 pip 失败: ${pipResult.stderr}`,
      })
      return { success: false, steps }
    }
  }
  steps.push({ name: 'pip', ok: true, message: 'pip 已就绪' })

  // Step 5: Install requirements
  const reqPath = getRequirementsPath()
  const requirements = await readFile(reqPath, 'utf8')
  const digest = createHash('sha256').update(requirements).digest('hex')

  let installedDigest = ''
  try {
    installedDigest = (await readFile(installStampPath, 'utf8')).trim()
  } catch {}

  if (installedDigest !== digest) {
    // Upgrade pip first (using China mirror)
    await runCommand(venvPython, [
      '-m', 'pip', 'install', '--upgrade', 'pip',
      '-i', PIP_INDEX_URL, '--trusted-host', PIP_TRUSTED_HOST,
    ])

    // Install deps (using China mirror)
    const installResult = await runCommand(venvPython, [
      '-m', 'pip', 'install',
      '-r', reqPath,
      '-i', PIP_INDEX_URL, '--trusted-host', PIP_TRUSTED_HOST,
    ])
    if (!installResult.ok) {
      steps.push({
        name: 'deps',
        ok: false,
        message: `安装依赖失败: ${installResult.stderr.slice(0, 500)}`,
      })
      return { success: false, steps }
    }
    await writeFile(installStampPath, `${digest}\n`, 'utf8')
    steps.push({ name: 'deps', ok: true, message: '依赖已安装' })
  } else {
    steps.push({ name: 'deps', ok: true, message: '依赖已是最新' })
  }

  return { success: true, steps }
}

// ============================================================================
// Authorized Apps configuration — stored in Ycode data dir computer-use-config.json
// ============================================================================

const configPath = join(getAppDataDir(), 'computer-use-config.json')

type AuthorizedApp = {
  bundleId: string
  displayName: string
  authorizedAt: string
}

type ComputerUseConfig = {
  authorizedApps: AuthorizedApp[]
  grantFlags: CuGrantFlags
  computerWideAccess: boolean
}

type RequestAccessBody = {
  sessionId?: string
  request?: CuPermissionRequest
}

const DEFAULT_CONFIG: ComputerUseConfig = {
  authorizedApps: [],
  grantFlags: DEFAULT_DESKTOP_GRANT_FLAGS,
  computerWideAccess: false,
}

function normalizeAuthorizedApps(apps: unknown): AuthorizedApp[] {
  if (!Array.isArray(apps)) return []
  const seen = new Set<string>()
  const out: AuthorizedApp[] = []
  for (const item of apps) {
    if (typeof item !== 'object' || item === null) continue
    const app = item as Partial<AuthorizedApp>
    const bundleId = String(app.bundleId ?? '').trim()
    const displayName = String(app.displayName ?? '').trim()
    const key = normalizeStoredAppKey(bundleId)
    if (!bundleId || !displayName || !key || seen.has(key)) continue
    seen.add(key)
    out.push({
      bundleId,
      displayName,
      authorizedAt:
        typeof app.authorizedAt === 'string'
          ? app.authorizedAt
          : new Date(0).toISOString(),
    })
  }
  return out
}

async function loadConfig(): Promise<ComputerUseConfig> {
  let parsed: StoredComputerUseConfig | undefined
  try {
    const raw = await readFile(configPath, 'utf8')
    parsed = JSON.parse(raw) as StoredComputerUseConfig
  } catch {
    parsed = undefined
  }

  const resolved = resolveStoredComputerUseConfig(parsed)
  const authorizedApps = normalizeAuthorizedApps(parsed?.authorizedApps)

  return {
    ...DEFAULT_CONFIG,
    authorizedApps,
    grantFlags: resolved.grantFlags,
    computerWideAccess: resolved.computerWideAccess,
  }
}

async function saveConfig(config: ComputerUseConfig): Promise<void> {
  await mkdir(getAppDataDir(), { recursive: true })
  await writeFile(
    configPath,
    JSON.stringify({
      ...config,
      authorizedApps: normalizeAuthorizedApps(config.authorizedApps),
    }, null, 2),
    'utf8',
  )
}

type InstalledAppForSettings = SettingsAppLike & {
  iconDataUrl?: string
}

async function runHelperCommand<T>(
  command: string,
  payload: Record<string, unknown> = {},
): Promise<T | undefined> {
  const helperPath = getHelperPath()
  const pythonBin = isWindows
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python3')

  if (!(await pathExists(pythonBin)) || !(await pathExists(helperPath))) {
    return undefined
  }

  const args = [helperPath, command]
  if (Object.keys(payload).length > 0) {
    args.push('--payload', JSON.stringify(payload))
  }
  const result = await runCommand(pythonBin, args)
  if (!result.ok) return undefined

  try {
    const parsed = JSON.parse(result.stdout)
    return parsed.ok ? parsed.result as T : undefined
  } catch {
    return undefined
  }
}

async function listInstalledApps(): Promise<InstalledAppForSettings[]> {
  await ensureRuntimeFiles().catch(() => undefined)

  const raw = await runHelperCommand<Array<{ bundleId: string; displayName: string; path: string }>>(
    'list_installed_apps',
  )
  if (!raw) return []

  const apps = filterAppsForSettings(raw, homedir())
  const iconTargets = apps
    .filter(app => app.path)
    .slice(0, 80)
    .map(app => ({ bundleId: app.bundleId, path: app.path }))

  if (iconTargets.length === 0) return apps

  const icons = await runHelperCommand<Record<string, string>>(
    'get_app_icons',
    { apps: iconTargets },
  ).catch(() => undefined)
  if (!icons) return apps

  return apps.map(app => {
    const iconDataUrl = icons[app.bundleId]
    return iconDataUrl ? { ...app, iconDataUrl } : app
  })
}

function autoGrantComputerWideAccess(
  request: CuPermissionRequest,
  flags: CuGrantFlags,
): CuPermissionResponse {
  const now = Date.now()
  const universalGrant: AppGrant = {
    bundleId: COMPUTER_WIDE_ACCESS_BUNDLE_ID,
    displayName: COMPUTER_WIDE_ACCESS_DISPLAY_NAME,
    grantedAt: now,
    tier: 'full',
  }
  const resolvedGrants: AppGrant[] = request.apps
    .filter(app => app.resolved)
    .map(app => ({
      bundleId: app.resolved!.bundleId,
      displayName: app.resolved!.displayName,
      grantedAt: now,
      tier: app.proposedTier,
    }))
  const denied = request.apps
    .filter(app => !app.resolved)
    .map(app => ({
      bundleId: app.requestedName,
      reason: 'not_installed' as const,
    }))

  return {
    granted: [universalGrant, ...resolvedGrants],
    denied,
    flags,
  }
}

// ============================================================================
// Route handler
// ============================================================================

export async function handleComputerUseApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  const action = segments[2]

  if (action === 'status' && req.method === 'GET') {
    const status = await checkStatus()
    return Response.json(status)
  }

  if (action === 'setup' && req.method === 'POST') {
    const result = await runSetup()
    return Response.json(result)
  }

  // GET /api/computer-use/apps — list installed macOS apps
  if (action === 'apps' && req.method === 'GET') {
    const apps = await listInstalledApps()
    return Response.json({ apps })
  }

  // GET /api/computer-use/authorized-apps — current authorized app config
  if (action === 'authorized-apps' && req.method === 'GET') {
    const config = await loadConfig()
    return Response.json(config)
  }

  // PUT /api/computer-use/authorized-apps — update authorized apps
  if (action === 'authorized-apps' && req.method === 'PUT') {
    try {
      const body = (await req.json()) as Partial<ComputerUseConfig>
      const config = await loadConfig()
      if (body.authorizedApps) config.authorizedApps = normalizeAuthorizedApps(body.authorizedApps)
      if (body.grantFlags) config.grantFlags = { ...config.grantFlags, ...body.grantFlags }
      if (typeof body.computerWideAccess === 'boolean') {
        config.computerWideAccess = body.computerWideAccess
      }
      await saveConfig(config)
      return Response.json({ ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save Computer Use config'
      return Response.json({ error: 'SAVE_FAILED', message }, { status: 500 })
    }
  }

  // POST /api/computer-use/open-settings — open system settings pane
  if (action === 'open-settings' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { pane?: string }
    const pane = body.pane ?? 'Privacy_ScreenCapture'
    const allowed = ['Privacy_ScreenCapture', 'Privacy_Accessibility']
    if (!allowed.includes(pane)) {
      return Response.json({ error: 'Invalid pane' }, { status: 400 })
    }

    if (process.platform === 'darwin') {
      const url = `x-apple.systempreferences:com.apple.preference.security?${pane}`
      await runCommand('open', [url])
    } else if (process.platform === 'win32') {
      // Windows doesn't need privacy settings like macOS TCC, but we can
      // open the general privacy page if requested
      await runCommand('cmd', ['/c', 'start', 'ms-settings:privacy'])
    } else {
      return Response.json({ error: 'Unsupported platform' }, { status: 400 })
    }
    return Response.json({ ok: true })
  }

  if (action === 'request-access' && req.method === 'POST') {
    try {
      const body = (await req.json()) as RequestAccessBody
      if (!body.sessionId || !body.request?.requestId) {
        return Response.json(
          { error: 'BAD_REQUEST', message: 'sessionId and request are required' },
          { status: 400 },
        )
      }

      const config = await loadConfig()
      if (config.computerWideAccess) {
        return Response.json(autoGrantComputerWideAccess(body.request, config.grantFlags))
      }

      const response = await computerUseApprovalService.requestApproval(
        body.sessionId,
        body.request,
      )
      return Response.json(response)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Computer Use approval failed'
      const status = message.includes('not connected') ? 409 : 500
      return Response.json({ error: 'COMPUTER_USE_APPROVAL_FAILED', message }, { status })
    }
  }

  return Response.json(
    { error: 'NOT_FOUND', message: `Unknown computer-use action: ${action}` },
    { status: 404 },
  )
}
