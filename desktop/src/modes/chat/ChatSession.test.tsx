import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('../../components/chat/MessageList', () => ({
  MessageList: () => <div data-testid="message-list" />,
}))

vi.mock('../../components/chat/ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}))

vi.mock('../../api/computerUse', () => ({
  computerUseApi: {
    openSettings: vi.fn(),
  },
}))

vi.mock('../../api/websocket', () => ({
  wsManager: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    clearHandlers: vi.fn(),
    send: vi.fn(),
  },
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: {
    getMessages: vi.fn(async () => ({ messages: [] })),
    getSlashCommands: vi.fn(async () => ({ commands: [] })),
  },
}))

vi.mock('../../stores/teamStore', () => ({
  useTeamStore: {
    getState: () => ({
      getMemberBySessionId: vi.fn(() => null),
      sendMessageToMember: vi.fn(),
      handleTeamCreated: vi.fn(),
      handleTeamUpdate: vi.fn(),
      handleTeamDeleted: vi.fn(),
    }),
  },
}))

vi.mock('../../stores/tabStore', () => ({
  useTabStore: {
    getState: () => ({
      updateTabStatus: vi.fn(),
      updateTabTitle: vi.fn(),
    }),
  },
}))

vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      updateSessionTitle: vi.fn(),
    }),
  },
}))

vi.mock('../../stores/desktopTaskStore', () => ({
  useDesktopTaskStore: {
    getState: () => ({
      fetchSessionTasks: vi.fn(),
      tasks: [],
      clearTasks: vi.fn(),
      setTasksFromTodos: vi.fn(),
      markCompletedAndDismissed: vi.fn(),
      resetCompletedTasks: vi.fn(),
      refreshTasks: vi.fn(),
    }),
  },
}))

import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { ChatSession } from './ChatSession'

describe('ChatSession', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    useChatStore.setState({ sessions: {} })
  })

  it('renders Computer Use approval requests in chat mode', () => {
    useChatStore.setState({
      sessions: {
        'chat-1': {
          messages: [{ id: 'm1', type: 'user_text', content: 'hello', timestamp: Date.now() }],
          chatState: 'permission_pending',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: {
            requestId: 'cu-1',
            request: {
              requestId: 'cu-1',
              reason: 'Open QQ Music',
              apps: [{
                requestedName: 'QQ音乐',
                resolved: {
                  bundleId: 'QQMusic',
                  displayName: 'QQ Music',
                },
                isSentinel: false,
                alreadyGranted: false,
                proposedTier: 'full',
              }],
              requestedFlags: {},
              screenshotFiltering: 'none',
            },
          },
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    } as any)

    render(<ChatSession sessionId="chat-1" />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Computer Use wants to control these apps')).toBeInTheDocument()
    expect(screen.getByText('QQ Music')).toBeInTheDocument()
  })
})
