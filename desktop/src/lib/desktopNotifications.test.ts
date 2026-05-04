import { beforeEach, describe, expect, it, vi } from 'vitest'

const notificationPluginMock = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}))
const requestUserAttentionMock = vi.hoisted(() => vi.fn())
const windowApiMock = vi.hoisted(() => ({
  requestUserAttention: requestUserAttentionMock,
  getCurrentWindow: vi.fn(() => ({
    requestUserAttention: requestUserAttentionMock,
  })),
  UserAttentionType: {
    Critical: 1,
    Informational: 2,
  },
}))

vi.mock('@tauri-apps/plugin-notification', () => notificationPluginMock)
vi.mock('@tauri-apps/api/window', () => windowApiMock)

import {
  getDesktopNotificationPermission,
  notifyDesktop,
  requestDesktopNotificationPermission,
  resetDesktopNotificationsForTests,
  setNativeNotificationSenderForTests,
} from './desktopNotifications'
import { useSettingsStore } from '../stores/settingsStore'

describe('desktopNotifications', () => {
  beforeEach(() => {
    vi.useRealTimers()
    resetDesktopNotificationsForTests()
    notificationPluginMock.isPermissionGranted.mockReset()
    notificationPluginMock.requestPermission.mockReset()
    notificationPluginMock.sendNotification.mockReset()
    windowApiMock.getCurrentWindow.mockClear()
    windowApiMock.requestUserAttention.mockReset()
    useSettingsStore.setState({ desktopNotificationsEnabled: true })
  })

  it('requests native notification permission before sending through the Tauri plugin', async () => {
    notificationPluginMock.isPermissionGranted.mockResolvedValue(false)
    notificationPluginMock.requestPermission.mockResolvedValue('granted')

    notifyDesktop({
      dedupeKey: 'permission:1',
      title: 'Permission required',
      body: 'Approve command execution',
    })

    await vi.waitFor(() => expect(notificationPluginMock.sendNotification).toHaveBeenCalledTimes(1))
    expect(notificationPluginMock.isPermissionGranted).toHaveBeenCalledTimes(1)
    expect(notificationPluginMock.requestPermission).toHaveBeenCalledTimes(1)
    expect(notificationPluginMock.sendNotification).toHaveBeenCalledWith({
      title: 'Permission required',
      body: 'Approve command execution',
    })
  })

  it('does not fall back to sound when native notification permission is denied', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    notificationPluginMock.isPermissionGranted.mockResolvedValue(false)
    notificationPluginMock.requestPermission.mockResolvedValue('denied')

    notifyDesktop({ title: 'Permission required' })

    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled())
    expect(notificationPluginMock.sendNotification).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      '[desktopNotifications] native notification permission was not granted',
    )
    warnSpy.mockRestore()
  })

  it('does not send or consume dedupe keys when desktop notifications are disabled', async () => {
    const sender = vi.fn(async () => true)
    setNativeNotificationSenderForTests(sender)
    useSettingsStore.setState({ desktopNotificationsEnabled: false })

    notifyDesktop({ dedupeKey: 'permission:1', title: 'Permission required' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sender).not.toHaveBeenCalled()

    useSettingsStore.setState({ desktopNotificationsEnabled: true })
    notifyDesktop({ dedupeKey: 'permission:1', title: 'Permission required' })
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1))
  })

  it('does not consume dedupe keys when native notification delivery fails', async () => {
    const sender = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setNativeNotificationSenderForTests(sender)

    await expect(notifyDesktop({ dedupeKey: 'permission:retry', title: 'Permission required' })).resolves.toBe(false)
    await expect(notifyDesktop({ dedupeKey: 'permission:retry', title: 'Permission required' })).resolves.toBe(true)

    expect(sender).toHaveBeenCalledTimes(2)
    warnSpy.mockRestore()
  })

  it('reports and requests native notification permission', async () => {
    notificationPluginMock.isPermissionGranted.mockResolvedValueOnce(false).mockResolvedValueOnce(false)
    notificationPluginMock.requestPermission.mockResolvedValue('granted')
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default' },
    })

    await expect(getDesktopNotificationPermission()).resolves.toBe('default')
    await expect(requestDesktopNotificationPermission()).resolves.toBe('granted')
    expect(notificationPluginMock.requestPermission).toHaveBeenCalledTimes(1)
  })

  it('sends a native notification once for a dedupe key', async () => {
    const sender = vi.fn(async () => true)
    setNativeNotificationSenderForTests(sender)

    void notifyDesktop({
      dedupeKey: 'permission:1',
      title: 'Permission required',
      body: 'Approve command execution',
    })
    void notifyDesktop({
      dedupeKey: 'permission:1',
      title: 'Permission required',
      body: 'Approve command execution',
    })
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1))

    expect(sender).toHaveBeenCalledWith({
      title: 'Permission required',
      body: 'Approve command execution',
    })
  })

  it('requests OS-level window attention for blocking prompts', async () => {
    const sender = vi.fn(async () => true)
    setNativeNotificationSenderForTests(sender)

    notifyDesktop({
      requestAttention: true,
      title: 'Permission required',
      body: 'Approve command execution',
    })

    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(windowApiMock.requestUserAttention).toHaveBeenCalledTimes(1))
    expect(windowApiMock.requestUserAttention).toHaveBeenCalledWith(windowApiMock.UserAttentionType.Critical)
  })

  it('throttles bursts within the same cooldown scope', async () => {
    vi.useFakeTimers()
    const sender = vi.fn(async () => true)
    setNativeNotificationSenderForTests(sender)

    notifyDesktop({ dedupeKey: 'permission:1', cooldownScope: 'permission', title: 'One' })
    notifyDesktop({ dedupeKey: 'permission:2', cooldownScope: 'permission', title: 'Two' })
    await vi.runAllTimersAsync()
    expect(sender).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(751)
    notifyDesktop({ dedupeKey: 'permission:3', cooldownScope: 'permission', title: 'Three' })
    await vi.runAllTimersAsync()
    expect(sender).toHaveBeenCalledTimes(2)
  })
})
