import type { Locale } from '../../i18n'

export type SlashCommandOption = {
  name: string
  description: string
  aliases?: string[]
}

type SessionModeName = 'chat' | 'code'

export const FALLBACK_SLASH_COMMANDS: SlashCommandOption[] = [
  { name: 'explain', description: 'Turn this into an explanation request', aliases: ['解释'] },
  { name: 'summarize', description: 'Ask for a concise summary', aliases: ['总结', '摘要'] },
  { name: 'review', description: 'Review the current project or supplied code', aliases: ['审查', '评审'] },
  { name: 'fix', description: 'Ask the agent to diagnose and fix a problem', aliases: ['修复'] },
  { name: 'test', description: 'Ask for relevant tests or verification', aliases: ['测试', '验证'] },
  { name: 'read', description: 'Ask the agent to inspect files', aliases: ['读取', '查看'] },
  { name: 'search', description: 'Ask the agent to search the project', aliases: ['搜索', '查找'] },
  { name: 'commit-message', description: 'Draft a commit message from the current change', aliases: ['提交信息'] },
]

const ZH_FALLBACK_SLASH_COMMANDS: SlashCommandOption[] = [
  { name: '解释', description: '把这段内容变成解释请求', aliases: ['explain'] },
  { name: '总结', description: '请求生成简洁总结', aliases: ['summarize', '摘要'] },
  { name: '审查', description: '审查当前项目或输入的代码', aliases: ['review', '评审'] },
  { name: '修复', description: '让 agent 诊断并修复问题', aliases: ['fix'] },
  { name: '测试', description: '请求补充相关测试或验证步骤', aliases: ['test', '验证'] },
  { name: '读取', description: '让 agent 查看项目文件', aliases: ['read', '查看'] },
  { name: '搜索', description: '让 agent 搜索项目内容', aliases: ['search', '查找'] },
  { name: '提交信息', description: '根据当前改动起草提交信息', aliases: ['commit-message'] },
]

export const CHAT_FALLBACK_SLASH_COMMANDS = FALLBACK_SLASH_COMMANDS.filter((command) =>
  command.name === 'explain' || command.name === 'summarize',
)

const ZH_CHAT_FALLBACK_SLASH_COMMANDS = ZH_FALLBACK_SLASH_COMMANDS.filter((command) =>
  command.name === '解释' || command.name === '总结',
)

export function getFallbackSlashCommands(
  locale: Locale,
  mode: SessionModeName,
): SlashCommandOption[] {
  if (locale === 'zh') {
    return mode === 'chat' ? ZH_CHAT_FALLBACK_SLASH_COMMANDS : ZH_FALLBACK_SLASH_COMMANDS
  }
  return mode === 'chat' ? CHAT_FALLBACK_SLASH_COMMANDS : FALLBACK_SLASH_COMMANDS
}

export function mergeSlashCommands(
  preferred: ReadonlyArray<SlashCommandOption>,
  fallback: ReadonlyArray<SlashCommandOption> = FALLBACK_SLASH_COMMANDS,
): SlashCommandOption[] {
  const merged = new Map<string, SlashCommandOption>()

  for (const command of preferred) {
    if (!command?.name) continue
    merged.set(command.name, {
      name: command.name,
      description: command.description?.trim() || '',
      aliases: command.aliases,
    })
  }

  for (const command of fallback) {
    if (!command?.name) continue
    const existing = merged.get(command.name)
    if (existing) {
      if (!existing.description && command.description) {
        merged.set(command.name, {
          ...existing,
          description: command.description,
        })
      }
      continue
    }
    merged.set(command.name, command)
  }

  return [...merged.values()]
}

export function filterSlashCommands(
  commands: ReadonlyArray<SlashCommandOption>,
  filter: string,
): SlashCommandOption[] {
  const query = filter.trim().toLowerCase()
  if (!query) return [...commands]

  return commands.filter((command) => {
    const haystack = [
      command.name,
      command.description,
      ...(command.aliases ?? []),
    ].join('\n').toLowerCase()
    return haystack.includes(query)
  })
}

export type SlashTrigger = {
  slashPos: number
  filter: string
}

export function findSlashTrigger(value: string, cursorPos: number): SlashTrigger | null {
  const textBeforeCursor = value.slice(0, cursorPos)
  let slashPos = -1

  for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
    const ch = textBeforeCursor[i]!
    if (ch === '/') {
      if (i === 0 || /\s/.test(textBeforeCursor[i - 1]!)) {
        slashPos = i
        break
      }
      break
    }
    if (/\s/.test(ch)) {
      break
    }
  }

  if (slashPos < 0) return null

  const filter = textBeforeCursor.slice(slashPos + 1)
  if (/\s/.test(filter)) return null

  return { slashPos, filter }
}

export function replaceSlashToken(
  input: string,
  cursorPos: number,
  command: string,
  options?: { trailingSpace?: boolean },
): { value: string; cursorPos: number } {
  const trigger = findSlashTrigger(input, cursorPos)
  if (!trigger) {
    const prefix = input && !/\s$/.test(input) ? `${input} ` : input
    const token = `/${command}`
    const suffix = options?.trailingSpace !== false ? ' ' : ''
    const value = `${prefix}${token}${suffix}`
    return { value, cursorPos: value.length }
  }

  const before = input.slice(0, trigger.slashPos)
  const after = input.slice(cursorPos)
  const token = `/${command}`
  const suffix = options?.trailingSpace !== false ? ' ' : ''
  const value = `${before}${token}${suffix}${after}`
  const nextCursorPos = before.length + token.length + suffix.length
  return { value, cursorPos: nextCursorPos }
}

export type SlashToken = {
  start: number
  filter: string
}

export function findSlashToken(value: string, cursorPos: number): SlashToken | null {
  const trigger = findSlashTrigger(value, cursorPos)
  if (!trigger) return null
  return { start: trigger.slashPos, filter: trigger.filter }
}

export function replaceSlashCommand(
  value: string,
  cursorPos: number,
  command: string,
): { value: string; cursorPos: number } | null {
  const trigger = findSlashTrigger(value, cursorPos)
  if (!trigger) return null

  return replaceSlashToken(value, cursorPos, command, { trailingSpace: true })
}

export function insertSlashTrigger(
  value: string,
  cursorPos: number,
): { value: string; cursorPos: number } {
  const before = value.slice(0, cursorPos)
  const after = value.slice(cursorPos)
  const needsLeadingSpace = before.length > 0 && !/\s$/.test(before)
  const token = `${needsLeadingSpace ? ' ' : ''}/`
  return {
    value: `${before}${token}${after}`,
    cursorPos: before.length + token.length,
  }
}

export type AtTrigger = {
  start: number
  filter: string
}

export function findAtTrigger(value: string, cursorPos: number): AtTrigger | null {
  const textBeforeCursor = value.slice(0, cursorPos)
  let atPos = -1

  for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
    const ch = textBeforeCursor[i]!
    if (ch === '@' || ch === '＠') {
      if (i === 0 || /\s/.test(textBeforeCursor[i - 1]!)) {
        atPos = i
        break
      }
      break
    }
    if (/\s/.test(ch)) break
  }

  if (atPos < 0) return null

  const filter = textBeforeCursor.slice(atPos + 1)
  if (/\s/.test(filter)) return null
  return { start: atPos, filter }
}

export function replaceAtToken(
  value: string,
  cursorPos: number,
  label: string,
  options?: { trailingSpace?: boolean },
): { value: string; cursorPos: number } | null {
  const trigger = findAtTrigger(value, cursorPos)
  if (!trigger) return null

  const cleanLabel = label.trim()
  if (!cleanLabel) return null

  const token = cleanLabel.startsWith('@') ? cleanLabel : `@ ${cleanLabel}`
  const suffix = options?.trailingSpace === false ? '' : ' '
  const before = value.slice(0, trigger.start)
  const after = value.slice(cursorPos)
  const nextValue = `${before}${token}${suffix}${after}`

  return {
    value: nextValue,
    cursorPos: before.length + token.length + suffix.length,
  }
}
