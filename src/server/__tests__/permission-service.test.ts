import { describe, expect, test } from 'bun:test'
import {
  PermissionService,
  type PermissionRequest,
} from '../runtime/PermissionService.js'

function permissionRequest(
  risk: PermissionRequest['risk'],
  input: unknown = {},
): PermissionRequest {
  return {
    requestId: `req-${risk}`,
    sessionId: 'session-1',
    projectPath: '/project',
    toolUseId: `tool-${risk}`,
    toolName: `${risk}_tool`,
    input,
    risk,
  }
}

describe('PermissionService', () => {
  test('honors native desktop permission modes', () => {
    const service = new PermissionService()

    expect(service.shouldAsk(permissionRequest('read'))).toBe(false)
    expect(service.shouldAsk(permissionRequest('write'))).toBe(true)
    expect(service.shouldAsk(permissionRequest('execute'))).toBe(false)
    expect(service.shouldAsk(permissionRequest('execute', { command: 'git status --short' }))).toBe(false)
    expect(service.shouldAsk(permissionRequest('execute', { command: 'python --version' }))).toBe(false)
    expect(service.shouldAsk(permissionRequest('execute', { command: 'rm -rf dist' }))).toBe(true)
    expect(service.shouldAsk(permissionRequest('execute', { command: 'mkdir dist' }))).toBe(true)
    expect(service.shouldAsk(permissionRequest('execute', { command: "sed -i 's/a/b/g' file.ts" }))).toBe(true)
    expect(service.shouldAsk(permissionRequest('execute', { command: 'echo hi > notes.txt' }))).toBe(true)
    expect(service.shouldAsk(permissionRequest('external'))).toBe(false)

    expect(service.shouldAsk(permissionRequest('write'), 'acceptEdits')).toBe(false)
    expect(service.shouldAsk(permissionRequest('execute', { command: 'git status --short' }), 'acceptEdits')).toBe(false)
    expect(service.shouldAsk(permissionRequest('external'), 'bypassPermissions')).toBe(false)
    expect(service.shouldAsk(permissionRequest('execute', { command: 'rm -rf dist' }), 'dontAsk')).toBe(false)
  })
})
