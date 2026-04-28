// desktop/src/api/providers.ts

import { api } from './client'
import type {
  SavedProvider,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderConfigInput,
  ProviderTestResult,
  LocalLlamaConfig,
} from '../types/provider'
import type { ProviderPreset } from '../config/providerPresets'

type ProvidersResponse = { providers: SavedProvider[]; activeId: string | null }
type ProviderResponse = { provider: SavedProvider }
type PresetsResponse = { presets: ProviderPreset[] }
type TestResultResponse = { result: ProviderTestResult }
type LocalLlamaResponse = { config: LocalLlamaConfig }
type AuthStatusResponse = {
  hasAuth: boolean
  source: 'ycode-provider' | 'desktop-settings' | 'official-settings' | 'env' | 'none'
  activeProvider?: string
}

export const providersApi = {
  list() {
    return api.get<ProvidersResponse>('/api/providers')
  },

  presets() {
    return api.get<PresetsResponse>('/api/providers/presets')
  },

  authStatus() {
    return api.get<AuthStatusResponse>('/api/providers/auth-status')
  },

  localLlamaConfig() {
    return api.get<LocalLlamaResponse>('/api/providers/local-llama')
  },

  startLocalLlama() {
    return api.post<LocalLlamaResponse>('/api/providers/local-llama/start')
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

  test(id: string, overrides?: { baseUrl?: string; modelId?: string; apiFormat?: string }) {
    return api.post<TestResultResponse>(`/api/providers/${id}/test`, overrides)
  },

  testConfig(input: TestProviderConfigInput) {
    return api.post<TestResultResponse>('/api/providers/test', input)
  },
}
