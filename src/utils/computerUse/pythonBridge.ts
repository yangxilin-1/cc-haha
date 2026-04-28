import { createHash } from 'node:crypto'
import { readFile, mkdir, access, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getComputerUseRuntimeRoot } from './runtimePaths.js'
// @ts-ignore - Bun text import
import MAC_HELPER_CONTENT from '../../../runtime/mac_helper.py' with { type: 'text' }
// @ts-ignore - Bun text import
import WIN_HELPER_CONTENT from '../../../runtime/win_helper.py' with { type: 'text' }
// @ts-ignore - Bun text import
import REQUIREMENTS_DARWIN_CONTENT from '../../../runtime/requirements.txt' with { type: 'text' }
// @ts-ignore - Bun text import
import REQUIREMENTS_WIN_CONTENT from '../../../runtime/requirements-win.txt' with { type: 'text' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../../..')

// Desktop Computer Use owns its runtime. Do not reuse legacy runtime caches:
// they can belong to older builds and leave the Python helper out of sync with
// the bundled TypeScript sidecar.
const runtimeStateRoot = getComputerUseRuntimeRoot()
const venvRoot = path.join(runtimeStateRoot, 'venv')
const installStampPath = path.join(runtimeStateRoot, 'requirements.sha256')

const PIP_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple/'
const PIP_TRUSTED_HOST = 'pypi.tuna.tsinghua.edu.cn'

const isWindows = process.platform === 'win32'
const embeddedRequirements = isWindows ? REQUIREMENTS_WIN_CONTENT : REQUIREMENTS_DARWIN_CONTENT
const embeddedHelper = isWindows ? WIN_HELPER_CONTENT : MAC_HELPER_CONTENT

const requirementsPath = path.join(runtimeStateRoot, 'requirements.txt')
const helperFileName = isWindows ? 'win_helper.py' : 'mac_helper.py'
const helperPath = path.join(runtimeStateRoot, helperFileName)

let bootstrapPromise: Promise<void> | undefined

function getPythonCommandEnv(): NodeJS.ProcessEnv | undefined {
  if (!isWindows) return undefined
  return {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
  }
}

function pythonBinPath(): string {
  return isWindows
    ? path.join(venvRoot, 'Scripts', 'python.exe')
    : path.join(venvRoot, 'bin', 'python3')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function readFirstExisting(paths: string[]): Promise<string | undefined> {
  for (const candidate of paths) {
    try {
      return await readFile(candidate, 'utf8')
    } catch {}
  }
  return undefined
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of paths) {
    if (!raw) continue
    const normalized = path.resolve(raw).normalize('NFC')
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function runtimeSourceRoots(): string[] {
  return uniquePaths([
    process.env.YCODE_SOURCE_ROOT,
    process.env.CLAUDE_APP_ROOT,
    process.cwd(),
    projectRoot,
    path.resolve(__dirname, '../../..'),
  ])
}

async function runOrThrow(
  file: string,
  args: string[],
  label: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  const { code, stdout, stderr } = await runProcess(file, args, env)
  if (code !== 0) {
    throw new Error(`${label} failed with code ${code}: ${stderr || stdout || 'unknown error'}`)
  }
  return stdout
}

/**
 * Ensure runtime source files exist in the desktop-owned runtime directory.
 * Dev mode prefers the repo runtime/ files so edits hot-sync. Bundled mode
 * falls back to Bun's embedded text imports, so setup is not required before
 * the first helper call.
 */
async function ensureRuntimeFiles(): Promise<void> {
  await mkdir(runtimeStateRoot, { recursive: true })

  const devReqFile = isWindows ? 'requirements-win.txt' : 'requirements.txt'
  const roots = runtimeSourceRoots()
  const devRequirements = roots.map(root => path.join(root, 'runtime', devReqFile))
  const devHelpers = roots.map(root => path.join(root, 'runtime', helperFileName))

  await writeFile(
    requirementsPath,
    await readFirstExisting(devRequirements) ?? embeddedRequirements,
    'utf8',
  )
  await writeFile(
    helperPath,
    await readFirstExisting(devHelpers) ?? embeddedHelper,
    'utf8',
  )
}

export async function ensureBootstrapped(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise
  bootstrapPromise = (async () => {
    // Extract runtime files (requirements.txt and platform helper) to state dir.
    await ensureRuntimeFiles()

    if (!(await pathExists(pythonBinPath()))) {
      desktopDebug('creating runtime venv at %s', venvRoot)
      const pythonCmd = isWindows ? 'python' : 'python3'
      await runOrThrow(pythonCmd, ['-m', 'venv', venvRoot], 'python venv creation', getPythonCommandEnv())
    }

    const pipBin = isWindows
      ? path.join(venvRoot, 'Scripts', 'pip.exe')
      : path.join(venvRoot, 'bin', 'pip')
    if (!(await pathExists(pipBin))) {
      desktopDebug('bootstrapping pip with ensurepip')
      await runOrThrow(pythonBinPath(), ['-m', 'ensurepip', '--upgrade'], 'ensurepip', getPythonCommandEnv())
    }

    const requirements = await readFile(requirementsPath, 'utf8')
    const digest = createHash('sha256').update(requirements).digest('hex')
    let installedDigest = ''
    try {
      installedDigest = (await readFile(installStampPath, 'utf8')).trim()
    } catch {}

    if (installedDigest !== digest) {
      desktopDebug('installing python runtime dependencies')
      await runOrThrow(pythonBinPath(), [
        '-m', 'pip', 'install', '--upgrade', 'pip',
        '-i', PIP_INDEX_URL, '--trusted-host', PIP_TRUSTED_HOST,
      ], 'pip upgrade', getPythonCommandEnv())
      await runOrThrow(
        pythonBinPath(),
        ['-m', 'pip', 'install', '-r', requirementsPath,
         '-i', PIP_INDEX_URL, '--trusted-host', PIP_TRUSTED_HOST],
        'python dependency install',
        getPythonCommandEnv(),
      )
      await writeFile(installStampPath, `${digest}\n`, 'utf8')
    }
  })()

  try {
    await bootstrapPromise
  } catch (error) {
    bootstrapPromise = undefined
    throw error
  }
}

async function runPythonHelper<T>(
  command: string,
  payload: Record<string, unknown>,
): Promise<{ result?: T; error?: { code?: string; message?: string }; stderr?: string; stdout?: string }> {
  await ensureBootstrapped()
  const { code, stdout, stderr } = await runProcess(
    pythonBinPath(),
    [helperPath, command, '--payload', JSON.stringify(payload)],
    getPythonCommandEnv(),
  )

  if (code !== 0 && !stdout.trim()) {
    throw new Error(stderr || `Python helper ${command} failed with code ${code}`)
  }

  let parsed: { ok: boolean; result?: T; error?: { code?: string; message?: string } }
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error(stderr || stdout || `Python helper ${command} returned invalid JSON`)
  }

  if (parsed.ok) {
    return { result: parsed.result }
  }

  return { error: parsed.error, stderr, stdout }
}

export async function callPythonHelper<T>(command: string, payload: Record<string, unknown> = {}): Promise<T> {
  let first = await runPythonHelper<T>(command, payload)
  if (!first.error) return first.result as T

  // The desktop process can outlive edits to runtime/win_helper.py. If a newly
  // added helper command is missing from the runtime cache, resync and retry
  // once instead of making the user clear files manually.
  if (first.error.code === 'bad_command') {
    bootstrapPromise = undefined
    await ensureBootstrapped()
    const second = await runPythonHelper<T>(command, payload)
    if (!second.error) return second.result as T
    first = second
  }

  throw new Error(first.error?.message || `Python helper ${command} failed`)
}

export function getRuntimePaths(): { projectRoot: string; runtimeStateRoot: string; venvRoot: string } {
  return { projectRoot, runtimeStateRoot, venvRoot }
}

async function runProcess(
  file: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn([file, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return {
    stdout,
    stderr,
    code: typeof code === 'number' ? code : 1,
  }
}

function desktopDebug(message: string, ...args: unknown[]): void {
  if (!process.env.DEBUG) return
  console.log('[ComputerUse]', message.replace(/%s/g, () => String(args.shift() ?? '')))
}
