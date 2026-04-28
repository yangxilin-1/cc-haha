import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

export type LocalLlamaPublicConfig = {
  available: boolean
  autoStart: boolean
  baseUrl: string
  modelAlias: string
  apiFormat: 'openai_chat'
  configPath: string
  running: boolean
}

type StartOptions = {
  force?: boolean
}

type RuntimeService = {
  getPublicConfig(): Promise<LocalLlamaPublicConfig>
  startConfigured(options?: StartOptions): Promise<void>
}

type RuntimeModule = {
  LocalLlamaService: RuntimeService
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8012'
const DEFAULT_MODEL_ALIAS = 'gemma-4-26B-A4B-it-UD-IQ3_S'

let runtimePromise: Promise<RuntimeModule> | null = null

export class LocalLlamaService {
  static async getPublicConfig(): Promise<LocalLlamaPublicConfig> {
    try {
      const runtime = await loadRuntime()
      return runtime.LocalLlamaService.getPublicConfig()
    } catch {
      return fallbackPublicConfig()
    }
  }

  static async startConfigured(options?: StartOptions): Promise<void> {
    const runtime = await loadRuntime()
    return runtime.LocalLlamaService.startConfigured(options)
  }
}

async function loadRuntime(): Promise<RuntimeModule> {
  if (runtimePromise) return runtimePromise

  runtimePromise = import(pathToFileURL(resolveRuntimePath()).href) as Promise<RuntimeModule>
  return runtimePromise
}

function resolveRuntimePath(): string {
  const explicit = process.env.YCODE_LOCAL_LLAMA_RUNTIME_PATH
  if (explicit) return path.resolve(explicit)

  const candidates = localDirCandidates().map((dir) => path.join(dir, 'runtime', 'localLlamaRuntime.mjs'))
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]!
}

function fallbackPublicConfig(): LocalLlamaPublicConfig {
  return {
    available: false,
    autoStart: false,
    baseUrl: DEFAULT_BASE_URL,
    modelAlias: DEFAULT_MODEL_ALIAS,
    apiFormat: 'openai_chat',
    configPath: path.join(localDirCandidates()[0]!, 'llama.cpp.env'),
    running: false,
  }
}

function localDirCandidates(): string[] {
  const fromEnv = [
    process.env.YCODE_LOCAL_DIR,
    process.env.YCODE_LOCAL_CONFIG_DIR,
    process.env.LOCAL_LLAMA_CONFIG_DIR,
  ].filter((value): value is string => Boolean(value && value.trim()))

  const anchors = [process.cwd(), import.meta.dir]
  const candidates = fromEnv.map((value) => path.resolve(value))

  for (const anchor of anchors) {
    for (let depth = 0; depth <= 6; depth++) {
      const parents = Array.from({ length: depth }, () => '..')
      candidates.push(path.resolve(anchor, ...parents, 'ycode-local'))
    }
  }

  return [...new Set(candidates)]
}
