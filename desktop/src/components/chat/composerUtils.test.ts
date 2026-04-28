import { describe, expect, it } from 'vitest'
import {
  filterSlashCommands,
  findAtTrigger,
  findSlashToken,
  getFallbackSlashCommands,
  insertSlashTrigger,
  mergeSlashCommands,
  replaceAtToken,
  replaceSlashCommand,
} from './composerUtils'

describe('composerUtils', () => {
  it('finds slash token without trailing space', () => {
    expect(findSlashToken('/rev', 4)).toEqual({ start: 0, filter: 'rev' })
    expect(findSlashToken('hello /rev', 10)).toEqual({ start: 6, filter: 'rev' })
  })

  it('does not treat slash followed by a space as an active token', () => {
    expect(findSlashToken('/ review', 8)).toBeNull()
  })

  it('inserts a slash trigger without appending a trailing space', () => {
    expect(insertSlashTrigger('', 0)).toEqual({ value: '/', cursorPos: 1 })
    expect(insertSlashTrigger('hello', 5)).toEqual({ value: 'hello /', cursorPos: 7 })
  })

  it('replaces the current slash token with a command and one trailing separator', () => {
    expect(replaceSlashCommand('/rev', 4, 'review')).toEqual({
      value: '/review ',
      cursorPos: 8,
    })
  })

  it('merges fallback commands so built-in entries remain visible', () => {
    expect(
      mergeSlashCommands([
        { name: 'help', description: '' },
      ]),
    ).toEqual(
      expect.arrayContaining([
        { name: 'help', description: '' },
        expect.objectContaining({ name: 'explain' }),
      ]),
    )
  })

  it('keeps server-provided descriptions when they exist', () => {
    expect(
      mergeSlashCommands([
        { name: 'explain', description: 'Server description' },
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'explain', description: 'Server description' }),
      ]),
    )
  })

  it('switches fallback slash commands between Chinese and English', () => {
    expect(getFallbackSlashCommands('en', 'chat').map((command) => command.name)).toEqual([
      'explain',
      'summarize',
    ])
    expect(getFallbackSlashCommands('zh', 'chat').map((command) => command.name)).toEqual([
      '解释',
      '总结',
    ])
  })

  it('filters slash commands by localized aliases', () => {
    expect(filterSlashCommands(getFallbackSlashCommands('zh', 'code'), 'review')[0]?.name).toBe('审查')
    expect(filterSlashCommands(getFallbackSlashCommands('en', 'code'), '审查')[0]?.name).toBe('review')
  })

  it('finds and replaces @ mention tokens', () => {
    expect(findAtTrigger('@Com', 4)).toEqual({ start: 0, filter: 'Com' })
    expect(replaceAtToken('@Com', 4, 'Computer Use')).toEqual({
      value: '@ Computer Use ',
      cursorPos: 15,
    })
  })
})
