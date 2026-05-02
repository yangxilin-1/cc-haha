import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { baselineCases, validateBaselineCases } from './cases'

describe('baselineCases', () => {
  test('have valid metadata', () => {
    expect(() => validateBaselineCases()).not.toThrow()
  })

  test('use unique ids', () => {
    const ids = baselineCases.map((testCase) => testCase.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('point at existing fixtures with package manifests', () => {
    for (const testCase of baselineCases) {
      expect(existsSync(testCase.fixture)).toBe(true)
      expect(existsSync(join(testCase.fixture, 'package.json'))).toBe(true)
    }
  })

  test('require real model capability', () => {
    for (const testCase of baselineCases) {
      expect(testCase.requiredCapabilities).toContain('model')
    }
  })
})
