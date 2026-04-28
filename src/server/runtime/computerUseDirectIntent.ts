import type { ToolDefinition } from './ToolRuntime.js'

const COMPUTER_USE_DIRECTIVE_PATTERN = /[@＠]\s*computer[\s_-]*use\b/i

type ToolCallPlan = {
  name: string
  input: Record<string, unknown>
}

export type ComputerUseDirectIntentPlan = {
  requestAccess: ToolCallPlan
  desktopIntent: ToolCallPlan
  successText: string
  failureText: string
}

export function resolveComputerUseDirectIntent(
  content: string,
  toolDefinitions: ToolDefinition[],
): ComputerUseDirectIntentPlan | null {
  if (!COMPUTER_USE_DIRECTIVE_PATTERN.test(content)) return null
  if (!hasTool(toolDefinitions, 'request_access')) return null
  if (!hasTool(toolDefinitions, 'run_desktop_intent')) return null

  const instruction = stripComputerUseDirective(content)
  const music = resolveMusicPlaybackIntent(instruction)
  if (!music) return null

  return {
    requestAccess: {
      name: 'request_access',
      input: {
        apps: [music.app],
        reason: `打开${music.app}并播放《${music.query}》`,
      },
    },
    desktopIntent: {
      name: 'run_desktop_intent',
      input: {
        instruction,
        intent: 'play_music',
        app: music.app,
        query: music.query,
      },
    },
    successText: `已通过${music.app}播放《${music.query}》。`,
    failureText:
      `我已经尝试用${music.app}直接播放《${music.query}》，但工具没有确认播放成功，所以不会报告“已播放”。`,
  }
}

export function toolResultReportsCompleted(content: unknown): boolean {
  const text = toolResultText(content)
  if (!text.trim()) return false

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    return parsed.completed === true
  } catch {
    return false
  }
}

function hasTool(toolDefinitions: ToolDefinition[], name: string): boolean {
  return toolDefinitions.some((tool) => tool.name === name)
}

function stripComputerUseDirective(content: string): string {
  return content.replace(COMPUTER_USE_DIRECTIVE_PATTERN, '').replace(/\s+/g, ' ').trim()
}

function resolveMusicPlaybackIntent(
  instruction: string,
): { app: string; query: string } | null {
  const app = resolveMusicApp(instruction)
  if (!app) return null
  if (!/(播放|播一下|放一下|\bplay\b)/iu.test(instruction)) return null

  const query = extractMusicQuery(instruction)
  if (!query) return null
  return { app, query }
}

function resolveMusicApp(instruction: string): string | null {
  const key = normalizeLookup(instruction)
  if (key.includes('qq音乐') || key.includes('qqmusic')) return 'QQ音乐'
  if (key.includes('网易云音乐') || key.includes('cloudmusic')) return '网易云音乐'
  return null
}

function extractMusicQuery(instruction: string): string | null {
  const compact = instruction
    .replace(/[“”"']/g, '')
    .replace(/[《》]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  const patterns = [/播放一下?/u, /播一下/u, /放一下/u, /播放/u, /\bplay\b/iu]
  for (const pattern of patterns) {
    const match = pattern.exec(compact)
    if (!match || match.index === undefined) continue
    const raw = compact.slice(match.index + match[0].length)
    const cleaned = raw
      .replace(/[，。,.!?！？].*$/u, '')
      .replace(/^(歌曲|音乐|这首歌|一下|下)\s*/u, '')
      .trim()
    if (cleaned) return cleaned
  }

  return null
}

function normalizeLookup(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string'
        ? record.text
        : ''
    })
    .filter(Boolean)
    .join('\n')
}
