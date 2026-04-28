/**
 * Removed legacy CLI bridge.
 *
 * Ycode Desktop no longer starts a legacy subprocess for chat/code sessions.
 * The active message path is:
 *
 *   WebSocket -> ChatEngine / CodeEngine -> ProviderAdapter / ToolRuntime
 *
 * This file is kept as a short-lived tombstone so stale imports fail loudly
 * instead of silently reintroducing the old runtime.
 */

const REMOVED_MESSAGE =
  'ConversationService was removed from Ycode Desktop runtime. Use ChatEngine or CodeEngine instead.'

export class ConversationService {
  startSession(): never {
    throw new Error(REMOVED_MESSAGE)
  }

  restartSession(): never {
    throw new Error(REMOVED_MESSAGE)
  }

  stopSession(): void {
    // No-op tombstone for shutdown paths that may still be cleaned up.
  }

  stopAllSessions(): void {
    // No-op tombstone for shutdown paths that may still be cleaned up.
  }

  hasSession(): false {
    return false
  }

  getSessionWorkDir(): undefined {
    return undefined
  }

  getSessionPermissionMode(): undefined {
    return undefined
  }

  setPermissionMode(): false {
    return false
  }

  sendInterrupt(): false {
    return false
  }

  registerSdkSocket(): false {
    return false
  }

  unregisterSdkSocket(): void {
    // SDK bridge removed.
  }

  handleSdkMessage(): false {
    return false
  }

  sendControlResponse(): false {
    return false
  }
}

export const conversationService = new ConversationService()
