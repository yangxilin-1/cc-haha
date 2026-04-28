import { describe, expect, it } from 'bun:test'

import {
  getDesktopComputerUseCapabilities,
  isComputerUseSupportedPlatform,
} from './common.js'

describe('computer use platform helpers', () => {
  it('recognizes supported platforms', () => {
    expect(isComputerUseSupportedPlatform('darwin')).toBe(true)
    expect(isComputerUseSupportedPlatform('win32')).toBe(true)
    expect(isComputerUseSupportedPlatform('linux')).toBe(false)
  })

  it('returns macOS capabilities with native screenshot filtering', () => {
    expect(getDesktopComputerUseCapabilities('darwin')).toEqual({
      screenshotFiltering: 'native',
      platform: 'darwin',
    })
  })

  it('returns Windows capabilities with unfiltered screenshots', () => {
    expect(getDesktopComputerUseCapabilities('win32')).toEqual({
      screenshotFiltering: 'none',
      platform: 'win32',
    })
  })
})
