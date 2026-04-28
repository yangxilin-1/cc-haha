import type { ToolDefinition } from './ToolRuntime.js'

const COMPUTER_USE_DIRECTIVE_PATTERN = /[@＠]\s*computer[\s_-]*use\b/i

const COMPUTER_USE_ROUTING_HINT = [
  'The user explicitly selected @ Computer Use for this turn.',
  'Use the Computer Use tools for local desktop or application control.',
  'First call request_access for every application needed for the task with a short user-facing reason.',
  'After access is granted, complete the requested desktop action; do not stop after merely opening the app.',
  'Use direct app intents only for recognized fast paths. For all other desktop work, use the visual action loop: open_application, wait briefly, screenshot or observe_desktop, then act on the visible UI.',
  'For playback tasks, report success only when a tool result explicitly says completed:true or playback was otherwise verified. If the app merely opened, keep working.',
  'For self-drawn apps where UI elements are missing, screenshots are the source of truth: visually locate search boxes, tabs, result rows, play/save/submit buttons, and click the visible target.',
  'Prefer computer_batch for predictable sequences of click/type/key/wait actions so one user request becomes one completed app action instead of many tiny steps.',
  'Keep the loop fast: after opening an app, do one short wait, capture once, then batch the next visible actions; recapture only after state changes or if verification fails.',
  'For any app, infer the task intent from the user request and continue until that intent is attempted or a tool error blocks progress.',
  'Do not answer that you cannot open or control local applications while these tools are available.',
  'If access is denied or the task cannot be completed safely, explain that result after the tool call.',
].join(' ')

export type ComputerUseRouting = {
  systemHint: string
  forceInitialToolChoice?: { type: 'tool'; name: string }
}

export function resolveComputerUseRouting(
  content: string,
  toolDefinitions: ToolDefinition[],
): ComputerUseRouting | null {
  if (!COMPUTER_USE_DIRECTIVE_PATTERN.test(content)) return null
  if (!toolDefinitions.some((tool) => tool.name === 'request_access')) return null

  return {
    systemHint: COMPUTER_USE_ROUTING_HINT,
    forceInitialToolChoice: { type: 'tool', name: 'request_access' },
  }
}
