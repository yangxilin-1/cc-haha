import { create } from 'zustand'
import { adaptersApi } from '../api/adapters'
import type { AdapterFileConfig } from '../types/adapter'

const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const CODE_TTL_MS = 60 * 60 * 1000 // 60 minutes

function generateCode(): string {
  const array = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => SAFE_ALPHABET[b % SAFE_ALPHABET.length]).join('')
}

type AdapterStore = {
  config: AdapterFileConfig
  isLoading: boolean
  error: string | null

  fetchConfig: () => Promise<void>
  updateConfig: (patch: Partial<AdapterFileConfig>) => Promise<void>
  generatePairingCode: () => Promise<string>
  removePairedUser: (platform: 'telegram' | 'feishu', userId: string | number) => Promise<void>
}

export const useAdapterStore = create<AdapterStore>((set, get) => ({
  config: {},
  isLoading: false,
  error: null,

  fetchConfig: async () => {
    set({ isLoading: true, error: null })
    try {
      const config = await adaptersApi.getConfig()
      set({ config, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load config'
      set({ isLoading: false, error: message })
    }
  },

  updateConfig: async (patch) => {
    const config = await adaptersApi.updateConfig(patch)
    set({ config })
  },

  generatePairingCode: async () => {
    const code = generateCode()
    const now = Date.now()
    await get().updateConfig({
      pairing: {
        code,
        expiresAt: now + CODE_TTL_MS,
        createdAt: now,
      },
    })
    return code
  },

  removePairedUser: async (platform, userId) => {
    const { config } = get()
    const platformConfig = config[platform]
    if (!platformConfig) return

    const pairedUsers = (platformConfig.pairedUsers ?? []).filter(
      (u) => String(u.userId) !== String(userId),
    )

    await get().updateConfig({
      [platform]: { ...platformConfig, pairedUsers },
    })
  },
}))
