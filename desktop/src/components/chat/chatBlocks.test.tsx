import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { PermissionDialog } from './PermissionDialog'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'

describe('chat blocks', () => {
  beforeEach(() => {
    useTabStore.setState({ activeTabId: 'active-tab', tabs: [{ sessionId: 'active-tab', title: 'Test', type: 'session' as const, status: 'idle' }] })
    useChatStore.setState({ sessions: {} })
  })

  it('keeps thinking collapsed by default', () => {
    const { container } = render(<ThinkingBlock content="this is a long internal reasoning trace" isActive />)

    expect(screen.getByText(/Thinking/)).toBeTruthy()
    expect(container.textContent).toContain('this is a long internal reasoning trace')
    expect(container.querySelector('.thinking-cursor')).toBeNull()
  })

  it('does not animate inactive historical thinking blocks', () => {
    const { container } = render(<ThinkingBlock content="old reasoning" isActive={false} />)

    expect(container.querySelector('.thinking-inline-cursor')).toBeNull()
  })

  it('keeps read tool details out of the user transcript', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Read"
        input={{ file_path: '/tmp/example.ts', limit: 20 }}
        result={{ content: 'const answer = 42\nconsole.log(answer)', isError: false }}
      />,
    )

    expect(container.textContent).toContain('Read 1 file')
    expect(container.textContent).not.toContain('const answer = 42')
    expect(container.textContent).not.toContain('Tool Input')
  })

  it('does not surface bash stdout in the transcript preview', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'ls -la', description: 'List files' }}
        result={{ content: 'file-a\nfile-b\nfile-c', isError: false }}
      />,
    )

    expect(container.textContent).toContain('ran a command')
    expect(container.textContent).not.toContain('file-a')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('ls -la')
    expect(container.textContent).not.toContain('file-a')
  })

  it('shows a collapsed error summary for failed bash commands', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="Bash"
        input={{ command: 'git show 5016bc0 --no-stat', description: 'Show full diff of latest commit' }}
        result={{ content: 'fatal: unrecognized argument: --no-stat\nExit code 128', isError: true }}
      />,
    )

    expect(container.textContent).toContain('ran a command')
    expect(container.textContent).toContain('fatal: unrecognized argument: --no-stat')
  })

  it('expands tool errors so full Computer Use gate messages are readable', () => {
    const { container } = render(
      <ToolCallBlock
        toolName="mcp__computer-use__left_click"
        input={{ coordinate: [120, 220] }}
        result={{
          content: '"Ycode" is not in the allowed applications and is currently in front. Take a new screenshot — it may have appeared since your last one.',
          isError: true,
        }}
      />,
    )

    expect(container.textContent).toContain('mcp__computer-use__left_click')
    expect(container.textContent).not.toContain('Take a new screenshot')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('Take a new screenshot')
    expect(container.textContent).toContain('allowed applications')
  })

  it('shows a diff preview for edit permission requests', () => {
    useChatStore.setState({
      sessions: {
        'active-tab': {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: {
            requestId: 'perm-1',
            toolName: 'Edit',
            input: {
              file_path: '/tmp/example.ts',
              old_string: 'const count = 1',
              new_string: 'const count = 2',
            },
          },
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    const { container } = render(
      <PermissionDialog
        requestId="perm-1"
        toolName="Edit"
        input={{
          file_path: '/tmp/example.ts',
          old_string: 'const count = 1',
          new_string: 'const count = 2',
        }}
      />,
    )

    expect(container.textContent).toContain('/tmp/example.ts')
    expect(container.textContent).toContain('Allow')
    // react-diff-viewer-continued uses styled-components tables that don't
    // fully render in jsdom, so we verify the DiffViewer wrapper is mounted
    expect(container.querySelector('[class*="rounded-[var(--radius-lg)]"]')).toBeTruthy()
  })

  it('shows unified diff previews for native apply_patch requests', () => {
    const patch = [
      '--- a/example.ts',
      '+++ b/example.ts',
      '@@ -1,1 +1,1 @@',
      '-const count = 1',
      '+const count = 2',
    ].join('\n')

    const { container } = render(
      <ToolCallBlock
        toolName="apply_patch"
        input={{ patch }}
        result={{
          content: 'Applied patch to 1 file.\n- example.ts\n+1 -1',
          isError: false,
          metadata: { summary: '1 file changed · +1 -1', additions: 1, deletions: 1 },
        }}
      />,
    )

    expect(container.textContent).toContain('applied a patch')
    expect(container.textContent).toContain('1 file changed')
    expect(container.textContent).not.toContain('const count = 2')

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('example.ts')
    expect(container.textContent).toContain('const count = 2')
  })

  it('shows a rollback action for successful audited apply_patch results', () => {
    const patch = [
      '--- a/example.ts',
      '+++ b/example.ts',
      '@@ -1,1 +1,1 @@',
      '-const count = 1',
      '+const count = 2',
    ].join('\n')
    const reversePatch = [
      '--- a/example.ts',
      '+++ b/example.ts',
      '@@ -1,1 +1,1 @@',
      '-const count = 2',
      '+const count = 1',
    ].join('\n')

    render(
      <ToolCallBlock
        toolName="apply_patch"
        toolUseId="tool-patch-1"
        input={{ patch }}
        result={{
          content: 'Applied patch to 1 file.\n- example.ts\n+1 -1',
          isError: false,
          metadata: {
            summary: '1 file changed · +1 -1',
            additions: 1,
            deletions: 1,
            patch: {
              forwardPatch: patch,
              reversePatch,
              files: [{
                path: 'example.ts',
                operation: 'modify',
                additions: 1,
                deletions: 1,
                beforeSha256: 'before',
                afterSha256: 'after',
              }],
            },
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button', { name: 'Rollback' })).toBeTruthy()
  })

  it('hides already-responded permission prompts from the transcript', () => {
    useChatStore.setState({
      sessions: {
        'active-tab': {
          messages: [],
          chatState: 'idle',
          connectionState: 'connected',
          streamingText: '',
          streamingToolInput: '',
          activeToolUseId: null,
          activeToolName: null,
          activeThinkingId: null,
          pendingPermission: null,
          pendingComputerUsePermission: null,
          tokenUsage: { input_tokens: 0, output_tokens: 0 },
          elapsedSeconds: 0,
          statusVerb: '',
          slashCommands: [],
          agentTaskNotifications: {},
          elapsedTimer: null,
        },
      },
    })

    const { container } = render(
      <PermissionDialog
        requestId="perm-done"
        toolName="get_weather"
        input={{ location: '西安' }}
      />,
    )

    expect(container.textContent).toBe('')
  })

  it('renders weather results as a friendly panel without raw tool input', () => {
    const weather = [
      'Location: 西安, 陕西, 中国',
      'Time: 2026-04-26T19:30 (Asia/Shanghai)',
      'Weather: Partly cloudy',
      'Temperature: 25.5 °C',
      'Feels like: 26.2 °C',
      'Humidity: 51 %',
      'Precipitation: 0 mm',
      'Wind speed: 5.5 km/h',
    ].join('\n')

    const { container } = render(
      <ToolCallBlock
        toolName="get_weather"
        input={{ location: '西安' }}
        result={{ content: weather, isError: false, metadata: { summary: '西安, 陕西, 中国: 25.5 °C' } }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('西安, 陕西, 中国')
    expect(container.textContent).toContain('25.5 °C')
    expect(container.textContent).not.toContain('Tool Input')
    expect(container.textContent).not.toContain('JSON')
    expect(container.textContent).not.toContain('"location"')
    expect(container.textContent).not.toContain('PLAINTEXT')
  })

  it('renders web search results as a readable list instead of plaintext output', () => {
    const content = [
      '1. 天气预报: 中国气象局',
      '   URL: https://weather.cma.cn/',
      '   城市天气预报信息',
      '',
      '2. 西安天气预报',
      '   URL: https://www.weather.com.cn/weather/101110101.shtml',
      '   西安未来天气趋势',
    ].join('\n')

    const { container } = render(
      <ToolCallBlock
        toolName="web_search"
        input={{ query: '西安天气今天' }}
        result={{ content, isError: false, metadata: { summary: '2 results' } }}
      />,
    )

    fireEvent.click(screen.getByRole('button'))

    expect(container.textContent).toContain('西安天气今天')
    expect(container.textContent).toContain('天气预报: 中国气象局')
    expect(container.textContent).toContain('weather.cma.cn')
    expect(container.textContent).not.toContain('Tool Output')
    expect(container.textContent).not.toContain('PLAINTEXT')
    expect(container.textContent).not.toContain('JSON')
  })
})
