import { describe, expect, test } from 'bun:test'
import { renderUser } from './app'

describe('renderUser', () => {
  test('renders name and email', () => {
    expect(renderUser({ name: 'Ada Lovelace', email: 'ada@example.com' })).toBe('User: Ada Lovelace <ada@example.com>')
  })
})
