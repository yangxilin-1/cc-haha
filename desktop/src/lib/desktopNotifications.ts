import { useSettingsStore } from '../stores/settingsStore'

const DEFAULT_COOLDOWN_MS = 750

export type DesktopNotificationOptions = {
  title: string
  body?: string
  dedupeKey?: string
  cooldownScope?: string
  cooldownMs?: number
  requestAttention?: boolean
}

type NativeNotificationSender = (options: { title: string; body?: string }) => Promise<boolean> | boolean
export type DesktopNotificationPermission = NotificationPermission | 'unsupported'

const notifiedKeys = new Set<string>()
const pendingKeys = new Set<string>()
const lastNotificationAtByScope = new Map<string, number>()
const pendingCooldownScopes = new Set<string>()
let overrideNativeNotificationSender: NativeNotificationSender | null = null

function readBrowserNotificationPermission(): DesktopNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  return window.Notification.permission
}

function detectPlatform(): 'darwin' | 'win32' | 'linux' | 'unknown' {
  const platform = typeof navigator !== 'undefined' ? navigator.platform.toLowerCase() : ''
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : ''
  const raw = `${platform} ${userAgent}`
  if (raw.includes('mac')) return 'darwin'
  if (raw.includes('win')) return 'win32'
  if (raw.includes('linux')) return 'linux'
  return 'unknown'
}

function getNotificationSettingsUrl(): string | null {
  switch (detectPlatform()) {
    case 'darwin':
      return 'x-apple.systempreferences:com.apple.preference.notifications'
    case 'win32':
      return 'ms-settings:notifications'
    default:
      return null
  }
}

export async function getDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  try {
    const { isPermissionGranted } = await import('@tauri-apps/plugin-notification')
    if (await isPermissionGranted()) return 'granted'
  } catch {
    // Fall back to the Web Notification permission state below.
  }
  return readBrowserNotificationPermission()
}

export async function requestDesktopNotificationPermission(): Promise<DesktopNotificationPermission> {
  try {
    const {
      isPermissionGranted,
      requestPermission,
    } = await import('@tauri-apps/plugin-notification')

    if (await isPermissionGranted()) return 'granted'
    return await requestPermission()
  } catch {
    return readBrowserNotificationPermission()
  }
}

export async function openDesktopNotificationSettings(): Promise<boolean> {
  const url = getNotificationSettingsUrl()
  if (!url) return false

  try {
    const { open } = await import('@tauri-apps/plugin-shell')
    await open(url)
    return true
  } catch {
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
      return true
    } catch {
      return false
    }
  }
}

async function sendNativeNotification(options: { title: string; body?: string }): Promise<boolean> {
  const {
    isPermissionGranted,
    requestPermission,
    sendNotification,
  } = await import('@tauri-apps/plugin-notification')

  let permissionGranted = await isPermissionGranted()
  if (!permissionGranted) {
    const permission = await requestPermission()
    permissionGranted = permission === 'granted'
  }

  if (!permissionGranted) {
    return false
  }

  sendNotification(options)
  return true
}

async function requestWindowAttention(): Promise<boolean> {
  try {
    const { getCurrentWindow, UserAttentionType } = await import('@tauri-apps/api/window')
    await getCurrentWindow().requestUserAttention(UserAttentionType.Critical)
    return true
  } catch {
    return false
  }
}

export async function notifyDesktop(options: DesktopNotificationOptions): Promise<boolean> {
  if (!useSettingsStore.getState().desktopNotificationsEnabled) {
    return false
  }

  if (options.dedupeKey && (notifiedKeys.has(options.dedupeKey) || pendingKeys.has(options.dedupeKey))) {
    return false
  }

  const cooldownScope = options.cooldownScope
  if (cooldownScope) {
    const now = Date.now()
    const lastNotificationAt = lastNotificationAtByScope.get(cooldownScope) ?? 0
    if (pendingCooldownScopes.has(cooldownScope) || now - lastNotificationAt < (options.cooldownMs ?? DEFAULT_COOLDOWN_MS)) {
      return false
    }
    pendingCooldownScopes.add(cooldownScope)
  }

  if (options.dedupeKey) {
    pendingKeys.add(options.dedupeKey)
  }

  if (options.requestAttention) {
    void requestWindowAttention()
  }

  const sender = overrideNativeNotificationSender ?? sendNativeNotification
  try {
    const sent = await Promise.resolve(sender({ title: options.title, body: options.body }))
    if (options.dedupeKey) {
      pendingKeys.delete(options.dedupeKey)
      if (sent) notifiedKeys.add(options.dedupeKey)
    }
    if (sent && cooldownScope) {
      lastNotificationAtByScope.set(cooldownScope, Date.now())
    }
    if (cooldownScope) pendingCooldownScopes.delete(cooldownScope)
    if (!sent && typeof console !== 'undefined') {
      console.warn('[desktopNotifications] native notification permission was not granted')
    }
    return sent
  } catch (err) {
    if (options.dedupeKey) pendingKeys.delete(options.dedupeKey)
    if (cooldownScope) pendingCooldownScopes.delete(cooldownScope)
    if (typeof console !== 'undefined') {
      console.warn('[desktopNotifications] failed to send native notification:', err)
    }
    return false
  }
}

export function resetDesktopNotificationsForTests(): void {
  notifiedKeys.clear()
  pendingKeys.clear()
  lastNotificationAtByScope.clear()
  pendingCooldownScopes.clear()
  overrideNativeNotificationSender = null
}

export function setNativeNotificationSenderForTests(sender: NativeNotificationSender | null): void {
  overrideNativeNotificationSender = sender
}
