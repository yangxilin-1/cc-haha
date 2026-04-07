# Provider Preset Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual provider configuration with preset-based system — users pick a provider, enter API key, done.

**Architecture:** Frontend preset definitions hardcoded in a shared config file. Backend stores saved providers in `~/.claude/cc-haha/providers.json` (lightweight index). On activation, backend writes 6 env keys to `~/.claude/settings.json`. Official preset clears those keys.

**Tech Stack:** TypeScript, Zod, Zustand, React, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-07-provider-preset-redesign.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/server/config/providerPresets.ts` | Preset definitions (shared backend) |
| Create | `desktop/src/config/providerPresets.ts` | Preset definitions (frontend copy) |
| Rewrite | `src/server/types/provider.ts` | Simplified schemas — models as record not array |
| Rewrite | `src/server/services/providerService.ts` | New storage path, full env write, official clear |
| Modify | `src/server/api/providers.ts` | Simplified activate (no modelId), add presets endpoint |
| Rewrite | `desktop/src/types/provider.ts` | Simplified frontend types |
| Rewrite | `desktop/src/api/providers.ts` | Updated API calls |
| Rewrite | `desktop/src/stores/providerStore.ts` | Aligned with new API shape |
| Rewrite | `desktop/src/pages/Settings.tsx` (ProviderSettings section) | Preset chips + simplified form |

---

### Task 1: Create Preset Definitions

**Files:**
- Create: `src/server/config/providerPresets.ts`
- Create: `desktop/src/config/providerPresets.ts`

- [ ] **Step 1: Create backend preset file**

```typescript
// src/server/config/providerPresets.ts

// Provider presets inspired by cc-switch (https://github.com/farion1231/cc-switch)
// Original work by Jason Young, MIT License

export type ModelMapping = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

export type ProviderPreset = {
  id: string
  name: string
  baseUrl: string
  defaultModels: ModelMapping
  needsApiKey: boolean
  websiteUrl: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'official',
    name: 'Claude Official',
    baseUrl: '',
    defaultModels: { main: '', haiku: '', sonnet: '', opus: '' },
    needsApiKey: false,
    websiteUrl: 'https://www.anthropic.com/claude-code',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    defaultModels: { main: 'DeepSeek-V3.2', haiku: 'DeepSeek-V3.2', sonnet: 'DeepSeek-V3.2', opus: 'DeepSeek-V3.2' },
    needsApiKey: true,
    websiteUrl: 'https://platform.deepseek.com',
  },
  {
    id: 'zhipuglm',
    name: 'Zhipu GLM',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    defaultModels: { main: 'glm-5', haiku: 'glm-5', sonnet: 'glm-5', opus: 'glm-5' },
    needsApiKey: true,
    websiteUrl: 'https://open.bigmodel.cn',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    defaultModels: { main: 'kimi-k2.5', haiku: 'kimi-k2.5', sonnet: 'kimi-k2.5', opus: 'kimi-k2.5' },
    needsApiKey: true,
    websiteUrl: 'https://platform.moonshot.cn',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    defaultModels: { main: 'MiniMax-M2.7', haiku: 'MiniMax-M2.7', sonnet: 'MiniMax-M2.7', opus: 'MiniMax-M2.7' },
    needsApiKey: true,
    websiteUrl: 'https://platform.minimaxi.com',
  },
  {
    id: 'custom',
    name: 'Custom',
    baseUrl: '',
    defaultModels: { main: '', haiku: '', sonnet: '', opus: '' },
    needsApiKey: true,
    websiteUrl: '',
  },
]
```

- [ ] **Step 2: Create frontend preset file (identical content)**

Copy `src/server/config/providerPresets.ts` to `desktop/src/config/providerPresets.ts`. Same content — the type + array are plain data, no server dependencies.

- [ ] **Step 3: Commit**

```bash
git add src/server/config/providerPresets.ts desktop/src/config/providerPresets.ts
git commit -m "feat: add provider preset definitions (Official, DeepSeek, ZhipuGLM, Kimi, MiniMax, Custom)"
```

---

### Task 2: Rewrite Backend Types

**Files:**
- Rewrite: `src/server/types/provider.ts`

- [ ] **Step 1: Rewrite provider types with simplified model structure**

Replace `src/server/types/provider.ts` entirely:

```typescript
// src/server/types/provider.ts

/**
 * Provider types — preset-based provider configuration.
 *
 * Providers are stored in ~/.claude/cc-haha/providers.json as a lightweight index.
 * The active provider's env vars are written to ~/.claude/settings.json.
 */

import { z } from 'zod'

export const ModelMappingSchema = z.object({
  main: z.string(),
  haiku: z.string(),
  sonnet: z.string(),
  opus: z.string(),
})

export const SavedProviderSchema = z.object({
  id: z.string(),
  presetId: z.string(),
  name: z.string().min(1),
  apiKey: z.string(),
  baseUrl: z.string(),
  models: ModelMappingSchema,
  notes: z.string().optional(),
})

export const ProvidersIndexSchema = z.object({
  activeId: z.string().nullable(),
  providers: z.array(SavedProviderSchema),
})

export const CreateProviderSchema = z.object({
  presetId: z.string().min(1),
  name: z.string().min(1),
  apiKey: z.string(),
  baseUrl: z.string(),
  models: ModelMappingSchema,
  notes: z.string().optional(),
})

export const UpdateProviderSchema = z.object({
  name: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  models: ModelMappingSchema.optional(),
  notes: z.string().optional(),
})

export const TestProviderSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  modelId: z.string().min(1),
})

// TypeScript types
export type ModelMapping = z.infer<typeof ModelMappingSchema>
export type SavedProvider = z.infer<typeof SavedProviderSchema>
export type ProvidersIndex = z.infer<typeof ProvidersIndexSchema>
export type CreateProviderInput = z.infer<typeof CreateProviderSchema>
export type UpdateProviderInput = z.infer<typeof UpdateProviderSchema>
export type TestProviderInput = z.infer<typeof TestProviderSchema>

export interface ProviderTestResult {
  success: boolean
  latencyMs: number
  error?: string
  modelUsed?: string
  httpStatus?: number
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/types/provider.ts
git commit -m "refactor: rewrite provider types — simplified model mapping, preset-based structure"
```

---

### Task 3: Rewrite Backend Provider Service

**Files:**
- Rewrite: `src/server/services/providerService.ts`

- [ ] **Step 1: Rewrite providerService.ts**

Replace `src/server/services/providerService.ts` entirely:

```typescript
// src/server/services/providerService.ts

/**
 * Provider Service — preset-based provider configuration
 *
 * Storage: ~/.claude/cc-haha/providers.json (lightweight index)
 * Active provider env vars written to ~/.claude/settings.json
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ApiError } from '../middleware/errorHandler.js'
import type {
  SavedProvider,
  ProvidersIndex,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderInput,
  ProviderTestResult,
} from '../types/provider.js'

/** The 6 env keys we manage in settings.json */
const MANAGED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
] as const

const DEFAULT_INDEX: ProvidersIndex = { activeId: null, providers: [] }

export class ProviderService {
  private getConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  }

  private getCcHahaDir(): string {
    return path.join(this.getConfigDir(), 'cc-haha')
  }

  private getIndexPath(): string {
    return path.join(this.getCcHahaDir(), 'providers.json')
  }

  private getSettingsPath(): string {
    return path.join(this.getConfigDir(), 'settings.json')
  }

  // --- File I/O (atomic write) ---

  private async readIndex(): Promise<ProvidersIndex> {
    try {
      const raw = await fs.readFile(this.getIndexPath(), 'utf-8')
      return JSON.parse(raw) as ProvidersIndex
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...DEFAULT_INDEX, providers: [] }
      }
      throw ApiError.internal(`Failed to read providers index: ${err}`)
    }
  }

  private async writeIndex(index: ProvidersIndex): Promise<void> {
    const filePath = this.getIndexPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(index, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write providers index: ${err}`)
    }
  }

  private async readSettings(): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(this.getSettingsPath(), 'utf-8')
      return JSON.parse(raw) as Record<string, unknown>
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw ApiError.internal(`Failed to read settings.json: ${err}`)
    }
  }

  private async writeSettings(settings: Record<string, unknown>): Promise<void> {
    const filePath = this.getSettingsPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write settings.json: ${err}`)
    }
  }

  // --- CRUD ---

  async listProviders(): Promise<{ providers: SavedProvider[]; activeId: string | null }> {
    const index = await this.readIndex()
    return { providers: index.providers, activeId: index.activeId }
  }

  async getProvider(id: string): Promise<SavedProvider> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)
    return provider
  }

  async addProvider(input: CreateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()

    const provider: SavedProvider = {
      id: crypto.randomUUID(),
      presetId: input.presetId,
      name: input.name,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      models: input.models,
      ...(input.notes !== undefined && { notes: input.notes }),
    }

    index.providers.push(provider)
    await this.writeIndex(index)
    return provider
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    const existing = index.providers[idx]
    const updated: SavedProvider = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.apiKey !== undefined && { apiKey: input.apiKey }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      ...(input.models !== undefined && { models: input.models }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }

    index.providers[idx] = updated
    await this.writeIndex(index)

    // Re-sync if this is the active provider
    if (index.activeId === id) {
      await this.syncToSettings(updated)
    }

    return updated
  }

  async deleteProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    if (index.activeId === id) {
      throw ApiError.conflict('Cannot delete the active provider. Switch to another provider first.')
    }

    index.providers.splice(idx, 1)
    await this.writeIndex(index)
  }

  // --- Activation ---

  async activateProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)

    index.activeId = id
    await this.writeIndex(index)

    if (provider.presetId === 'official') {
      await this.clearProviderFromSettings()
    } else {
      await this.syncToSettings(provider)
    }
  }

  /** Activate official — clear all managed env keys */
  async activateOfficial(): Promise<void> {
    const index = await this.readIndex()
    index.activeId = null
    await this.writeIndex(index)
    await this.clearProviderFromSettings()
  }

  // --- Settings sync ---

  private async syncToSettings(provider: SavedProvider): Promise<void> {
    const settings = await this.readSettings()
    const existingEnv = (settings.env as Record<string, string>) || {}

    settings.env = {
      ...existingEnv,
      ANTHROPIC_BASE_URL: provider.baseUrl,
      ANTHROPIC_AUTH_TOKEN: provider.apiKey,
      ANTHROPIC_MODEL: provider.models.main,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.models.haiku,
      ANTHROPIC_DEFAULT_SONNET_MODEL: provider.models.sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: provider.models.opus,
    }

    await this.writeSettings(settings)
  }

  private async clearProviderFromSettings(): Promise<void> {
    const settings = await this.readSettings()
    const env = (settings.env as Record<string, string>) || {}

    for (const key of MANAGED_ENV_KEYS) {
      delete env[key]
    }

    settings.env = env
    // Clean up empty env object
    if (Object.keys(env).length === 0) {
      delete settings.env
    }

    await this.writeSettings(settings)
  }

  // --- Test ---

  async testProvider(id: string): Promise<ProviderTestResult> {
    const provider = await this.getProvider(id)
    if (!provider.baseUrl || !provider.apiKey) {
      return { success: false, latencyMs: 0, error: 'Missing baseUrl or apiKey' }
    }
    return this.testProviderConfig({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      modelId: provider.models.main,
    })
  }

  async testProviderConfig(input: TestProviderInput): Promise<ProviderTestResult> {
    const url = `${input.baseUrl.replace(/\/+$/, '')}/v1/messages`
    const start = Date.now()

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': input.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: input.modelId,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        signal: AbortSignal.timeout(15000),
      })

      const latencyMs = Date.now() - start

      if (response.ok) {
        return { success: true, latencyMs, modelUsed: input.modelId, httpStatus: response.status }
      }

      let errorMessage = `HTTP ${response.status}`
      try {
        const body = (await response.json()) as Record<string, unknown>
        if (body.error && typeof body.error === 'object') {
          errorMessage = ((body.error as Record<string, unknown>).message as string) || errorMessage
        } else if (typeof body.message === 'string') {
          errorMessage = body.message
        }
      } catch {
        errorMessage = `HTTP ${response.status} ${response.statusText}`
      }

      return { success: false, latencyMs, error: errorMessage, modelUsed: input.modelId, httpStatus: response.status }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { success: false, latencyMs, error: 'Request timed out after 15 seconds', modelUsed: input.modelId }
      }
      return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: input.modelId }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/services/providerService.ts
git commit -m "refactor: rewrite providerService — cc-haha storage, full env sync, official clear"
```

---

### Task 4: Update Backend API Routes

**Files:**
- Modify: `src/server/api/providers.ts`

- [ ] **Step 1: Rewrite providers API**

Replace `src/server/api/providers.ts` entirely:

```typescript
// src/server/api/providers.ts

/**
 * Providers REST API
 *
 * GET    /api/providers              — list all saved providers + activeId
 * GET    /api/providers/presets       — list available presets
 * POST   /api/providers              — add a provider
 * PUT    /api/providers/:id          — update a provider
 * DELETE /api/providers/:id          — delete a provider
 * POST   /api/providers/:id/activate — activate a saved provider
 * POST   /api/providers/official     — activate official (clear env)
 * POST   /api/providers/:id/test     — test a saved provider
 * POST   /api/providers/test         — test unsaved config
 */

import { z } from 'zod'
import { ProviderService } from '../services/providerService.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import {
  CreateProviderSchema,
  UpdateProviderSchema,
  TestProviderSchema,
} from '../types/provider.js'
import { ApiError, errorResponse } from '../middleware/errorHandler.js'

const providerService = new ProviderService()

function maskApiKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

function sanitizeProvider(provider: Record<string, unknown>): Record<string, unknown> {
  if (typeof provider.apiKey === 'string') {
    return { ...provider, apiKey: maskApiKey(provider.apiKey) }
  }
  return provider
}

export async function handleProvidersApi(
  req: Request,
  _url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const id = segments[2]
    const action = segments[3]

    // POST /api/providers/test
    if (id === 'test' && req.method === 'POST') {
      return await handleTestUnsaved(req)
    }

    // GET /api/providers/presets
    if (id === 'presets' && req.method === 'GET') {
      return Response.json({ presets: PROVIDER_PRESETS })
    }

    // POST /api/providers/official
    if (id === 'official' && req.method === 'POST') {
      await providerService.activateOfficial()
      return Response.json({ ok: true })
    }

    // /api/providers (no ID)
    if (!id) {
      if (req.method === 'GET') {
        const { providers, activeId } = await providerService.listProviders()
        return Response.json({ providers: providers.map(sanitizeProvider), activeId })
      }
      if (req.method === 'POST') {
        return await handleCreate(req)
      }
      throw methodNotAllowed(req.method)
    }

    // /api/providers/:id/activate
    if (action === 'activate') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      await providerService.activateProvider(id)
      return Response.json({ ok: true })
    }

    // /api/providers/:id/test
    if (action === 'test') {
      if (req.method !== 'POST') throw methodNotAllowed(req.method)
      const result = await providerService.testProvider(id)
      return Response.json({ result })
    }

    // /api/providers/:id
    if (req.method === 'GET') {
      const provider = await providerService.getProvider(id)
      return Response.json({ provider: sanitizeProvider(provider) })
    }
    if (req.method === 'PUT') {
      return await handleUpdate(req, id)
    }
    if (req.method === 'DELETE') {
      await providerService.deleteProvider(id)
      return Response.json({ ok: true })
    }

    throw methodNotAllowed(req.method)
  } catch (error) {
    return errorResponse(error)
  }
}

async function handleCreate(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = CreateProviderSchema.parse(body)
    const provider = await providerService.addProvider(input)
    return Response.json({ provider }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
}

async function handleUpdate(req: Request, id: string): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = UpdateProviderSchema.parse(body)
    const provider = await providerService.updateProvider(id, input)
    return Response.json({ provider })
  } catch (err) {
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
}

async function handleTestUnsaved(req: Request): Promise<Response> {
  const body = await parseJsonBody(req)
  try {
    const input = TestProviderSchema.parse(body)
    const result = await providerService.testProviderConfig(input)
    return Response.json({ result })
  } catch (err) {
    if (err instanceof z.ZodError) throw ApiError.badRequest(err.issues.map((i) => i.message).join('; '))
    throw err
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}

function methodNotAllowed(method: string): ApiError {
  return new ApiError(405, `Method ${method} not allowed`, 'METHOD_NOT_ALLOWED')
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/api/providers.ts
git commit -m "refactor: update provider API — add presets endpoint, simplify activate, add official route"
```

---

### Task 5: Rewrite Frontend Types + API + Store

**Files:**
- Rewrite: `desktop/src/types/provider.ts`
- Rewrite: `desktop/src/api/providers.ts`
- Rewrite: `desktop/src/stores/providerStore.ts`

- [ ] **Step 1: Rewrite frontend types**

Replace `desktop/src/types/provider.ts`:

```typescript
// desktop/src/types/provider.ts

export type ModelMapping = {
  main: string
  haiku: string
  sonnet: string
  opus: string
}

export type SavedProvider = {
  id: string
  presetId: string
  name: string
  apiKey: string  // masked from server
  baseUrl: string
  models: ModelMapping
  notes?: string
}

export type CreateProviderInput = {
  presetId: string
  name: string
  apiKey: string
  baseUrl: string
  models: ModelMapping
  notes?: string
}

export type UpdateProviderInput = {
  name?: string
  apiKey?: string
  baseUrl?: string
  models?: ModelMapping
  notes?: string
}

export type TestProviderConfigInput = {
  baseUrl: string
  apiKey: string
  modelId: string
}

export type ProviderTestResult = {
  success: boolean
  latencyMs: number
  error?: string
  modelUsed?: string
  httpStatus?: number
}
```

- [ ] **Step 2: Rewrite frontend API client**

Replace `desktop/src/api/providers.ts`:

```typescript
// desktop/src/api/providers.ts

import { api } from './client'
import type {
  SavedProvider,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderConfigInput,
  ProviderTestResult,
} from '../types/provider'
import type { ProviderPreset } from '../config/providerPresets'

type ProvidersResponse = { providers: SavedProvider[]; activeId: string | null }
type ProviderResponse = { provider: SavedProvider }
type PresetsResponse = { presets: ProviderPreset[] }
type TestResultResponse = { result: ProviderTestResult }

export const providersApi = {
  list() {
    return api.get<ProvidersResponse>('/api/providers')
  },

  presets() {
    return api.get<PresetsResponse>('/api/providers/presets')
  },

  create(input: CreateProviderInput) {
    return api.post<ProviderResponse>('/api/providers', input)
  },

  update(id: string, input: UpdateProviderInput) {
    return api.put<ProviderResponse>(`/api/providers/${id}`, input)
  },

  delete(id: string) {
    return api.delete<{ ok: true }>(`/api/providers/${id}`)
  },

  activate(id: string) {
    return api.post<{ ok: true }>(`/api/providers/${id}/activate`)
  },

  activateOfficial() {
    return api.post<{ ok: true }>('/api/providers/official')
  },

  test(id: string) {
    return api.post<TestResultResponse>(`/api/providers/${id}/test`)
  },

  testConfig(input: TestProviderConfigInput) {
    return api.post<TestResultResponse>('/api/providers/test', input)
  },
}
```

- [ ] **Step 3: Rewrite frontend store**

Replace `desktop/src/stores/providerStore.ts`:

```typescript
// desktop/src/stores/providerStore.ts

import { create } from 'zustand'
import { providersApi } from '../api/providers'
import type {
  SavedProvider,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderConfigInput,
  ProviderTestResult,
} from '../types/provider'

type ProviderStore = {
  providers: SavedProvider[]
  activeId: string | null
  isLoading: boolean

  fetchProviders: () => Promise<void>
  createProvider: (input: CreateProviderInput) => Promise<SavedProvider>
  updateProvider: (id: string, input: UpdateProviderInput) => Promise<SavedProvider>
  deleteProvider: (id: string) => Promise<void>
  activateProvider: (id: string) => Promise<void>
  activateOfficial: () => Promise<void>
  testProvider: (id: string) => Promise<ProviderTestResult>
  testConfig: (input: TestProviderConfigInput) => Promise<ProviderTestResult>
}

export const useProviderStore = create<ProviderStore>((set, get) => ({
  providers: [],
  activeId: null,
  isLoading: false,

  fetchProviders: async () => {
    set({ isLoading: true })
    try {
      const { providers, activeId } = await providersApi.list()
      set({ providers, activeId, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  createProvider: async (input) => {
    const { provider } = await providersApi.create(input)
    await get().fetchProviders()
    return provider
  },

  updateProvider: async (id, input) => {
    const { provider } = await providersApi.update(id, input)
    await get().fetchProviders()
    return provider
  },

  deleteProvider: async (id) => {
    await providersApi.delete(id)
    await get().fetchProviders()
  },

  activateProvider: async (id) => {
    await providersApi.activate(id)
    await get().fetchProviders()
  },

  activateOfficial: async () => {
    await providersApi.activateOfficial()
    await get().fetchProviders()
  },

  testProvider: async (id) => {
    const { result } = await providersApi.test(id)
    return result
  },

  testConfig: async (input) => {
    const { result } = await providersApi.testConfig(input)
    return result
  },
}))
```

- [ ] **Step 4: Commit**

```bash
git add desktop/src/types/provider.ts desktop/src/api/providers.ts desktop/src/stores/providerStore.ts
git commit -m "refactor: rewrite frontend provider types, API client, and store for preset system"
```

---

### Task 6: Rewrite ProviderSettings UI in Settings.tsx

**Files:**
- Rewrite: `desktop/src/pages/Settings.tsx` (ProviderSettings + ProviderFormModal sections only, lines 65-396)

- [ ] **Step 1: Rewrite ProviderSettings and ProviderFormModal**

Replace the `ProviderSettings` function and `ProviderFormModal` function in `desktop/src/pages/Settings.tsx`. Keep the imports, `Settings` component, `TabButton`, `PermissionSettings`, and `GeneralSettings` unchanged.

Update the imports at the top of the file:

```typescript
import { useState, useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useProviderStore } from '../stores/providerStore'
import { useUIStore } from '../stores/uiStore'
import { Modal } from '../components/shared/Modal'
import { Input } from '../components/shared/Input'
import { Button } from '../components/shared/Button'
import { PROVIDER_PRESETS } from '../config/providerPresets'
import type { PermissionMode, EffortLevel } from '../types/settings'
import type { SavedProvider, UpdateProviderInput, ProviderTestResult, ModelMapping } from '../types/provider'
```

New `ProviderSettings`:

```typescript
function ProviderSettings() {
  const { providers, activeId, isLoading, fetchProviders, deleteProvider, activateProvider, activateOfficial, testProvider } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)
  const [editingProvider, setEditingProvider] = useState<SavedProvider | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [testResults, setTestResults] = useState<Record<string, { loading: boolean; result?: ProviderTestResult }>>({})

  useEffect(() => { fetchProviders() }, [fetchProviders])

  const handleDelete = async (provider: SavedProvider) => {
    if (activeId === provider.id) return
    if (!window.confirm(`Delete provider "${provider.name}"? This cannot be undone.`)) return
    await deleteProvider(provider.id).catch(console.error)
  }

  const handleTest = async (provider: SavedProvider) => {
    setTestResults((r) => ({ ...r, [provider.id]: { loading: true } }))
    try {
      const result = await testProvider(provider.id)
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result } }))
    } catch {
      setTestResults((r) => ({ ...r, [provider.id]: { loading: false, result: { success: false, latencyMs: 0, error: 'Request failed' } } }))
    }
  }

  const handleActivate = async (id: string) => {
    await activateProvider(id)
    await fetchSettings()
  }

  const handleActivateOfficial = async () => {
    await activateOfficial()
    await fetchSettings()
  }

  const isOfficialActive = activeId === null

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Providers</h2>
          <p className="text-sm text-[var(--color-text-tertiary)] mt-0.5">Manage API providers for model access.</p>
        </div>
        <Button size="sm" onClick={() => setShowCreateModal(true)}>
          <span className="material-symbols-outlined text-[16px]">add</span>
          Add Provider
        </Button>
      </div>

      {/* Official provider card */}
      <div
        className={`relative flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all mb-2 ${
          isOfficialActive
            ? 'border-[var(--color-brand)] bg-[var(--color-primary-fixed)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)] cursor-pointer'
        }`}
        onClick={() => !isOfficialActive && handleActivateOfficial()}
      >
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isOfficialActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--color-text-primary)]">Claude Official</span>
            {isOfficialActive && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[var(--color-brand)] text-white leading-none">ACTIVE</span>
            )}
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Anthropic native — no API key required</div>
        </div>
      </div>

      {/* Saved providers */}
      {isLoading && providers.length === 0 ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-5 h-5 border-2 border-[var(--color-brand)] border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {providers.map((provider) => {
            const isActive = activeId === provider.id
            const test = testResults[provider.id]
            const preset = PROVIDER_PRESETS.find((p) => p.id === provider.presetId)
            return (
              <div
                key={provider.id}
                className={`relative flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all group ${
                  isActive
                    ? 'border-[var(--color-brand)] bg-[var(--color-primary-fixed)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-focus)]'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isActive ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{provider.name}</span>
                    {preset && preset.id !== 'custom' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-surface-container-high)] text-[var(--color-text-tertiary)] leading-none">{preset.name}</span>
                    )}
                    {isActive && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-[var(--color-brand)] text-white leading-none">ACTIVE</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-text-tertiary)] truncate mt-0.5">
                    {provider.baseUrl} &middot; {provider.models.main}
                  </div>
                  {test && !test.loading && test.result && (
                    <div className={`text-xs mt-1 ${test.result.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
                      {test.result.success ? `Connected (${test.result.latencyMs}ms)` : `Failed: ${test.result.error}`}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {!isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleActivate(provider.id)}>Activate</Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleTest(provider)} loading={test?.loading}>Test</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingProvider(provider)}>Edit</Button>
                  {!isActive && (
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(provider)} className="text-[var(--color-error)] hover:text-[var(--color-error)]">Delete</Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Create Modal */}
      <ProviderFormModal open={showCreateModal} onClose={() => setShowCreateModal(false)} mode="create" />

      {/* Edit Modal */}
      {editingProvider && (
        <ProviderFormModal key={editingProvider.id} open={true} onClose={() => setEditingProvider(null)} mode="edit" provider={editingProvider} />
      )}
    </div>
  )
}
```

New `ProviderFormModal`:

```typescript
type ProviderFormProps = {
  open: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  provider?: SavedProvider
}

function ProviderFormModal({ open, onClose, mode, provider }: ProviderFormProps) {
  const { createProvider, updateProvider, testConfig } = useProviderStore()
  const fetchSettings = useSettingsStore((s) => s.fetchAll)

  // Exclude 'official' from create presets — it has its own card
  const availablePresets = PROVIDER_PRESETS.filter((p) => p.id !== 'official')
  const initialPreset = provider ? availablePresets.find((p) => p.id === provider.presetId) || availablePresets.at(-1)! : availablePresets[0]

  const [selectedPreset, setSelectedPreset] = useState(initialPreset)
  const [name, setName] = useState(provider?.name ?? initialPreset.name)
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? initialPreset.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [notes, setNotes] = useState(provider?.notes ?? '')
  const [models, setModels] = useState<ModelMapping>(provider?.models ?? { ...initialPreset.defaultModels })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
  const [isTesting, setIsTesting] = useState(false)

  const handlePresetChange = (preset: typeof initialPreset) => {
    setSelectedPreset(preset)
    setName(preset.name)
    setBaseUrl(preset.baseUrl)
    setModels({ ...preset.defaultModels })
    setTestResult(null)
  }

  const isCustom = selectedPreset.id === 'custom'
  const canSubmit = name.trim() && baseUrl.trim() && (mode === 'edit' || apiKey.trim()) && models.main.trim()

  const handleSubmit = async () => {
    if (!canSubmit) return
    setIsSubmitting(true)
    try {
      if (mode === 'create') {
        await createProvider({
          presetId: selectedPreset.id,
          name: name.trim(),
          apiKey: apiKey.trim(),
          baseUrl: baseUrl.trim(),
          models,
          notes: notes.trim() || undefined,
        })
      } else if (provider) {
        const input: UpdateProviderInput = {
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          models,
          notes: notes.trim() || undefined,
        }
        if (apiKey.trim()) input.apiKey = apiKey.trim()
        await updateProvider(provider.id, input)
        if (useProviderStore.getState().activeId === provider.id) await fetchSettings()
      }
      onClose()
    } catch (err) {
      console.error('Failed to save provider:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleTest = async () => {
    if (!baseUrl.trim() || !models.main.trim()) return
    setIsTesting(true)
    setTestResult(null)
    try {
      let result: ProviderTestResult
      if (mode === 'edit' && provider && !apiKey.trim()) {
        result = await useProviderStore.getState().testProvider(provider.id)
      } else {
        if (!apiKey.trim()) return
        result = await testConfig({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), modelId: models.main.trim() })
      }
      setTestResult(result)
    } catch {
      setTestResult({ success: false, latencyMs: 0, error: 'Request failed' })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'create' ? 'Add Provider' : 'Edit Provider'}
      width={600}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={isSubmitting}>
            {mode === 'create' ? 'Add' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Preset chips (create mode only) */}
        {mode === 'create' && (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-2 block">Preset</label>
            <div className="flex flex-wrap gap-2">
              {availablePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handlePresetChange(preset)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                    selectedPreset.id === preset.id
                      ? 'bg-[var(--color-brand)] text-white border-[var(--color-brand)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)]'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Provider name" />

        {/* Base URL — always visible for custom, read-only hint for presets */}
        {isCustom || mode === 'edit' ? (
          <Input label="Base URL" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/anthropic" />
        ) : (
          <div>
            <label className="text-sm font-medium text-[var(--color-text-primary)] mb-1 block">Base URL</label>
            <div className="text-xs text-[var(--color-text-tertiary)] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--color-surface-container-low)] border border-[var(--color-border)]">
              {baseUrl}
            </div>
          </div>
        )}

        <Input
          label={mode === 'edit' ? 'API Key (leave blank to keep current)' : 'API Key'}
          required={mode === 'create'}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={mode === 'edit' ? '****' : 'sk-...'}
        />

        <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes..." />

        {/* Advanced: Model Mapping */}
        <div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]" style={{ transform: showAdvanced ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 150ms' }}>
              chevron_right
            </span>
            Model Mapping
          </button>
          {showAdvanced && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input label="Main Model" required value={models.main} onChange={(e) => setModels({ ...models, main: e.target.value })} placeholder="Model ID" />
              <Input label="Haiku Model" value={models.haiku} onChange={(e) => setModels({ ...models, haiku: e.target.value })} placeholder="Same as main" />
              <Input label="Sonnet Model" value={models.sonnet} onChange={(e) => setModels({ ...models, sonnet: e.target.value })} placeholder="Same as main" />
              <Input label="Opus Model" value={models.opus} onChange={(e) => setModels({ ...models, opus: e.target.value })} placeholder="Same as main" />
            </div>
          )}
        </div>

        {/* Test connection */}
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={handleTest} loading={isTesting} disabled={!baseUrl.trim() || !models.main.trim()}>
            Test Connection
          </Button>
          {testResult && (
            <span className={`text-xs ${testResult.success ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'}`}>
              {testResult.success ? `Connected (${testResult.latencyMs}ms)` : `Failed: ${testResult.error}`}
            </span>
          )}
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/pages/Settings.tsx
git commit -m "feat: rewrite ProviderSettings UI — preset chips, simplified form, official card"
```

---

### Task 7: Clean Up Unused Code

**Files:**
- Modify: `desktop/src/pages/Settings.tsx` (remove unused imports)

- [ ] **Step 1: Verify no unused imports**

Check that the imports at the top of Settings.tsx match what's used. The old `Provider`, `ProviderModel` imports should be removed, replaced with `SavedProvider`, `ModelMapping`. `ProviderTestResult` and `UpdateProviderInput` should remain.

Remove `ProviderModel` from type imports if still present (it no longer exists).

- [ ] **Step 2: Remove old `~/.claude/providers.json`**

No code change needed — the old file is just ignored. The new storage path is `~/.claude/cc-haha/providers.json`.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/pages/Settings.tsx
git commit -m "chore: clean up unused imports after provider preset migration"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-04-07-provider-preset-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session, batch execution with checkpoints

Which approach?