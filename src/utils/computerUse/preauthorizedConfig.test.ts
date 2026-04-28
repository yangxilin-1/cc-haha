import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_DESKTOP_GRANT_FLAGS,
  resolveStoredComputerUseConfig,
} from './preauthorizedConfig.js'

describe('resolveStoredComputerUseConfig', () => {
  test('keeps desktop grant flags enabled by default even without authorized apps', () => {
    expect(resolveStoredComputerUseConfig()).toEqual({
      authorizedApps: [],
      grantFlags: DEFAULT_DESKTOP_GRANT_FLAGS,
      computerWideAccess: false,
    })
  })

  test('merges stored grant flags without discarding unspecified defaults', () => {
    expect(
      resolveStoredComputerUseConfig({
        grantFlags: {
          clipboardRead: false,
        },
      }),
    ).toEqual({
      authorizedApps: [],
      grantFlags: {
        clipboardRead: false,
        clipboardWrite: true,
        systemKeyCombos: true,
      },
      computerWideAccess: false,
    })
  })

  test('preserves computer-wide access setting', () => {
    expect(
      resolveStoredComputerUseConfig({
        computerWideAccess: true,
      }).computerWideAccess,
    ).toBe(true)
  })

  test('deduplicates authorized apps case-insensitively', () => {
    expect(
      resolveStoredComputerUseConfig({
        authorizedApps: [
          { bundleId: 'Qoder', displayName: 'Qoder' },
          { bundleId: 'qoder', displayName: 'qoder' },
          { bundleId: 'QQMusic', displayName: 'QQMusic' },
          { bundleId: 'qqmusic', displayName: 'QQ音乐' },
        ],
      }).authorizedApps,
    ).toEqual([
      { bundleId: 'Qoder', displayName: 'Qoder' },
      { bundleId: 'QQMusic', displayName: 'QQMusic' },
    ])
  })
})
