import type { SessionMode } from '../services/sessionService.js'

export type DesktopSlashCommand = {
  name: string
  description: string
  modes: SessionMode[]
  prompt: string
}

const COMMANDS: DesktopSlashCommand[] = [
  {
    name: 'explain',
    description: 'Turn this into an explanation request',
    modes: ['chat', 'code'],
    prompt: 'Explain this clearly and practically.',
  },
  {
    name: 'summarize',
    description: 'Ask for a concise summary',
    modes: ['chat', 'code'],
    prompt: 'Summarize the important points, decisions, and next steps.',
  },
  {
    name: 'review',
    description: 'Review the current project or supplied code',
    modes: ['code'],
    prompt: 'Review the project for bugs, risky behavior, missing tests, and professional desktop-app quality issues. Start with concrete findings.',
  },
  {
    name: 'fix',
    description: 'Ask the agent to diagnose and fix a problem',
    modes: ['code'],
    prompt: 'Diagnose the issue and make the smallest safe fix. Explain what changed and how it was verified.',
  },
  {
    name: 'test',
    description: 'Ask for relevant tests or verification',
    modes: ['code'],
    prompt: 'Find the relevant test strategy, run or suggest focused verification, and fix failures that are directly related.',
  },
  {
    name: 'read',
    description: 'Ask the agent to inspect files',
    modes: ['code'],
    prompt: 'Inspect the relevant files first, then answer with file references and a concise conclusion.',
  },
  {
    name: 'search',
    description: 'Ask the agent to search the project',
    modes: ['code'],
    prompt: 'Search the project for the relevant implementation points before answering.',
  },
  {
    name: 'commit-message',
    description: 'Draft a commit message from the current change',
    modes: ['code'],
    prompt: 'Draft a professional commit message for the current change. Include a short subject and useful body bullets.',
  },
]

export function getDesktopSlashCommands(mode: SessionMode): Array<{
  name: string
  description: string
}> {
  return COMMANDS
    .filter((command) => command.modes.includes(mode))
    .map(({ name, description }) => ({ name, description }))
}

export function expandDesktopSlashCommand(
  raw: string,
  mode: SessionMode,
): string {
  const trimmed = raw.trim()
  const match = trimmed.match(/^\/([a-zA-Z][\w-]*)(?:\s+([\s\S]*))?$/)
  if (!match) return raw

  const name = match[1] ?? ''
  const rest = match[2]?.trim() ?? ''
  const command = COMMANDS.find(
    (entry) => entry.name === name && entry.modes.includes(mode),
  )
  if (!command) return raw

  return rest ? `${command.prompt}\n\nUser detail:\n${rest}` : command.prompt
}
