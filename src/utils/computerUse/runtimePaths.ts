import path from 'node:path'
import { getAppDataDir } from '../../server/utils/paths.js'

export function getComputerUseRuntimeRoot(): string {
  const override = process.env.YCODE_COMPUTER_USE_RUNTIME_DIR?.trim()
  const root = override || path.join(getAppDataDir(), 'computer-use-runtime')
  return path.resolve(root).normalize('NFC')
}
