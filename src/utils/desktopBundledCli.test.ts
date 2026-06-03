import { describe, expect, test } from 'bun:test'
import {
  buildClaudeCliArgs,
  resolveBundledCliPathFromExecPath,
  resolveClaudeCliLauncher,
} from './desktopBundledCli.js'

describe('desktop bundled CLI launcher', () => {
  test('treats the renamed Ycode sidecar as a CLI sidecar', () => {
    const sidecarPath = 'C:\\Program Files\\Ycode\\ycode-sidecar-x86_64-pc-windows-msvc.exe'

    expect(resolveBundledCliPathFromExecPath(sidecarPath)).toBe(sidecarPath)

    const launcher = resolveClaudeCliLauncher({ cliPath: sidecarPath })
    expect(launcher).toEqual({
      command: sidecarPath,
      kind: 'sidecar',
      requiresAppRoot: true,
    })
    expect(buildClaudeCliArgs(launcher!, ['--print'], 'C:\\Program Files\\Ycode')).toEqual([
      sidecarPath,
      'cli',
      '--app-root',
      'C:\\Program Files\\Ycode',
      '--print',
    ])
  })
})
