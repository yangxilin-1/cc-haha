export type ToolRisk = 'read' | 'write' | 'execute' | 'external'

export type PermissionRequest = {
  requestId: string
  sessionId: string
  projectPath: string
  toolUseId: string
  toolName: string
  input: unknown
  risk: ToolRisk
  description?: string
}

export type PermissionDecision = {
  allowed: boolean
  rule?: string
  updatedInput?: Record<string, unknown>
}

type PendingPermission = {
  request: PermissionRequest
  resolve: (decision: PermissionDecision) => void
  reject: (error: Error) => void
  cleanup: () => void
}

export class PermissionService {
  private pending = new Map<string, PendingPermission>()
  private sessionAllowRules = new Set<string>()

  shouldAsk(request: PermissionRequest, permissionMode?: string): boolean {
    if (permissionMode === 'bypassPermissions' || permissionMode === 'dontAsk') {
      return false
    }
    if (permissionMode === 'acceptEdits' && request.risk === 'write') {
      return false
    }
    if (request.risk === 'read' || request.risk === 'external') return false
    if (request.risk === 'execute' && !looksLikeFileOperation(request)) return false
    return !this.sessionAllowRules.has(this.ruleKey(request))
  }

  async waitForDecision(
    request: PermissionRequest,
    signal: AbortSignal,
    permissionMode?: string,
  ): Promise<PermissionDecision> {
    if (!this.shouldAsk(request, permissionMode)) {
      return { allowed: true }
    }

    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(request.requestId)
        reject(new Error('Permission request was cancelled.'))
      }

      signal.addEventListener('abort', abort, { once: true })
      this.pending.set(request.requestId, {
        request,
        resolve,
        reject,
        cleanup: () => signal.removeEventListener('abort', abort),
      })
    })
  }

  respond(
    requestId: string,
    decision: PermissionDecision,
  ): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false

    this.pending.delete(requestId)
    pending.cleanup()

    if (decision.allowed && decision.rule === 'always') {
      this.sessionAllowRules.add(this.ruleKey(pending.request))
    }

    pending.resolve(decision)
    return true
  }

  cancelSession(sessionId: string): void {
    for (const [requestId, pending] of this.pending.entries()) {
      if (pending.request.sessionId !== sessionId) continue
      this.pending.delete(requestId)
      pending.cleanup()
      pending.reject(new Error('Permission request was cancelled.'))
    }
  }

  private ruleKey(request: PermissionRequest): string {
    return `${request.sessionId}:${request.projectPath}:${request.toolName}`
  }
}

export const permissionService = new PermissionService()

function looksLikeFileOperation(request: PermissionRequest): boolean {
  if (request.risk === 'write') return true
  if (request.risk !== 'execute') return false

  const command = extractCommand(request.input)
  if (!command) return false

  const normalized = command.toLowerCase()
  if (/(^|[^0-9])>{1,2}\s*[^&|]/.test(normalized)) return true
  if (/\b(?:rm|del|erase|rmdir|remove-item|ri|mv|move|ren|rename|cp|copy|xcopy|robocopy|touch|mkdir|md|new-item|ni|set-content|add-content|out-file|tee-object)\b/.test(normalized)) {
    return true
  }
  if (/\b(?:sed\s+-i|perl\s+-pi|truncate|chmod|chown|icacls|attrib)\b/.test(normalized)) {
    return true
  }
  if (/\bgit\s+(?:checkout|restore|reset|clean|apply|am|merge|rebase)\b/.test(normalized)) {
    return true
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade|dlx)\b/.test(normalized)) {
    return true
  }

  return false
}

function extractCommand(input: unknown): string {
  if (typeof input === 'string') return input.trim()
  if (!input || typeof input !== 'object') return ''
  const command = (input as Record<string, unknown>).command
  return typeof command === 'string' ? command.trim() : ''
}
