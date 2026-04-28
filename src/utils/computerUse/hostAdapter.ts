import type {
  ComputerUseHostAdapter,
  Logger,
} from '../../vendor/computer-use-mcp/types.js'
import { format } from 'util'
import { COMPUTER_USE_MCP_SERVER_NAME } from './common.js'
import { createDesktopExecutor } from './executor.js'
import { getChicagoEnabled, getChicagoSubGates } from './gates.js'
import { normalizeOsPermissions } from './permissions.js'
import { callPythonHelper } from './pythonBridge.js'

class DebugLogger implements Logger {
  silly(message: string, ...args: unknown[]): void {
    desktopDebug('debug', message, ...args)
  }
  debug(message: string, ...args: unknown[]): void {
    desktopDebug('debug', message, ...args)
  }
  info(message: string, ...args: unknown[]): void {
    desktopDebug('info', message, ...args)
  }
  warn(message: string, ...args: unknown[]): void {
    desktopDebug('warn', message, ...args)
  }
  error(message: string, ...args: unknown[]): void {
    desktopDebug('error', message, ...args)
  }
}

let cached: ComputerUseHostAdapter | undefined

export function getComputerUseHostAdapter(): ComputerUseHostAdapter {
  if (cached) return cached
  cached = {
    serverName: COMPUTER_USE_MCP_SERVER_NAME,
    logger: new DebugLogger(),
    executor: createDesktopExecutor({
      getMouseAnimationEnabled: () => getChicagoSubGates().mouseAnimation,
      getHideBeforeActionEnabled: () => getChicagoSubGates().hideBeforeAction,
    }),
    ensureOsPermissions: async () => {
      const rawPerms = await callPythonHelper<{ accessibility: boolean; screenRecording: boolean | null }>('check_permissions', {})
      const perms = normalizeOsPermissions(rawPerms)
      return perms.granted
        ? { granted: true as const }
        : { granted: false as const, accessibility: perms.accessibility, screenRecording: perms.screenRecording }
    },
    isDisabled: () => !getChicagoEnabled(),
    getSubGates: getChicagoSubGates,
    getAutoUnhideEnabled: () => true,
    cropRawPatch: () => null,
  }
  return cached
}

function desktopDebug(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]): void {
  if (!process.env.DEBUG && level === 'debug') return
  const text = format(message, ...args)
  const prefix = '[ComputerUse]'
  if (level === 'error') console.error(prefix, text)
  else if (level === 'warn') console.warn(prefix, text)
  else console.log(prefix, text)
}
