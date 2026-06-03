export type SessionMode = 'code' | 'chat'

export function normalizeSessionMode(value: unknown): SessionMode {
  return value === 'chat' ? 'chat' : 'code'
}
