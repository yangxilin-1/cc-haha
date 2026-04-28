import * as fs from 'fs/promises'
import * as path from 'path'
import { getOfficialClaudeConfigDir } from '../utils/paths.js'

export class OfficialClaudeSettingsService {
  private getSettingsPath(): string {
    return path.join(getOfficialClaudeConfigDir(), 'settings.json')
  }

  async getUserSettings(): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(this.getSettingsPath(), 'utf-8')
      return JSON.parse(raw) as Record<string, unknown>
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      console.warn(
        '[OfficialClaudeSettingsService] failed to read official Claude settings:',
        err instanceof Error ? err.message : err,
      )
      return {}
    }
  }
}

export const officialClaudeSettingsService = new OfficialClaudeSettingsService()
