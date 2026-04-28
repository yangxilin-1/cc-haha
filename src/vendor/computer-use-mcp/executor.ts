export interface DisplayGeometry {
  id?: number
  displayId?: number
  width: number
  height: number
  scaleFactor: number
  originX: number
  originY: number
  isPrimary?: boolean
  name?: string
  label?: string
}

export interface ScreenshotResult {
  base64: string
  width: number
  height: number
  displayWidth: number
  displayHeight: number
  displayId?: number
  originX: number
  originY: number
}

export interface FrontmostApp {
  bundleId: string
  displayName: string
}

export interface RunningApp {
  bundleId: string
  displayName: string
}

export interface WindowInfo {
  id?: string
  bundleId: string
  displayName: string
  title: string
  bounds: { x: number; y: number; width: number; height: number }
  isFrontmost?: boolean
  isAllowed?: boolean
}

export interface UiElementInfo {
  id: string
  elementId?: string
  element_id?: string
  bundleId: string
  displayName: string
  role: string
  name: string
  value?: string
  automationId?: string
  className?: string
  bounds: { x: number; y: number; width: number; height: number }
  enabled?: boolean
  focused?: boolean
  isAllowed?: boolean
}

export interface DesktopObservation {
  frontmostApp: FrontmostApp | null
  windows: WindowInfo[]
  uiElements: UiElementInfo[]
  semanticUi: 'uia' | 'ax' | 'none'
  elementCount: number
  truncated: boolean
}

export interface OpenApplicationResult {
  opened: boolean
  activated: boolean
  targetBundleId: string
  targetDisplayName?: string
  frontmostApp: FrontmostApp | null
  blockedByHost?: boolean
}

export interface DesktopIntentResult {
  intent: string
  handled: boolean
  appBundleId?: string
  query?: string
  opened?: boolean
  activated?: boolean
  attempted?: boolean
  completed?: boolean
  method?: string
  frontmostApp?: FrontmostApp | null
  verification?: unknown
  notes?: string[]
  guidance?: string
}

export interface InstalledApp {
  bundleId: string
  displayName: string
  path: string
  iconDataUrl?: string
}

export interface ResolvePrepareCaptureResult extends ScreenshotResult {
  hidden: string[]
  display: DisplayGeometry
  resolvedDisplayId?: number
  captureError?: string
}

export interface ComputerExecutor {
  capabilities: {
    screenshotFiltering: 'native' | 'none'
    platform: 'darwin' | 'win32'
    hostBundleId: string
    teachMode?: boolean
  }
  prepareForAction(allowlistBundleIds: string[], displayId?: number): Promise<string[]>
  previewHideSet(allowlistBundleIds: string[], displayId?: number): Promise<Array<{ bundleId: string; displayName: string }>>
  getDisplaySize(displayId?: number): Promise<DisplayGeometry>
  listDisplays(): Promise<DisplayGeometry[]>
  findWindowDisplays(bundleIds: string[]): Promise<Array<{ bundleId: string; displayIds: number[] }>>
  resolvePrepareCapture(opts: {
    allowedBundleIds: string[]
    preferredDisplayId?: number
    autoResolve: boolean
    doHide?: boolean
  }): Promise<ResolvePrepareCaptureResult>
  screenshot(opts: { allowedBundleIds: string[]; displayId?: number }): Promise<ScreenshotResult>
  zoom(
    regionLogical: { x: number; y: number; w: number; h: number },
    allowedBundleIds: string[],
    displayId?: number,
  ): Promise<{ base64: string; width: number; height: number }>
  key(keySequence: string, repeat?: number): Promise<void>
  holdKey(keyNames: string[], durationMs: number): Promise<void>
  type(text: string, opts: { viaClipboard: boolean }): Promise<void>
  click(
    x: number,
    y: number,
    button: 'left' | 'right' | 'middle',
    count: 1 | 2 | 3,
    modifiers?: string[],
  ): Promise<void>
  drag(
    from: { x: number; y: number } | undefined,
    to: { x: number; y: number },
  ): Promise<void>
  moveMouse(x: number, y: number): Promise<void>
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>
  mouseDown(): Promise<void>
  mouseUp(): Promise<void>
  getCursorPosition(): Promise<{ x: number; y: number }>
  getFrontmostApp(): Promise<FrontmostApp | null>
  appUnderPoint(x: number, y: number): Promise<{ bundleId: string; displayName: string } | null>
  observeDesktop(opts: {
    allowedBundleIds: string[]
    displayId?: number
    maxElements?: number
  }): Promise<DesktopObservation>
  clickUiElement(elementId: string): Promise<void>
  focusUiElement(elementId: string): Promise<void>
  setUiElementValue(elementId: string, text: string): Promise<{ usedValuePattern: boolean }>
  listInstalledApps(): Promise<InstalledApp[]>
  getAppIcon?(path: string): Promise<string | undefined>
  listRunningApps(): Promise<RunningApp[]>
  openApp(bundleId: string): Promise<OpenApplicationResult>
  runDesktopIntent(opts: {
    intent: string
    instruction: string
    appBundleId?: string
    query?: string
  }): Promise<DesktopIntentResult>
  readClipboard(): Promise<string>
  writeClipboard(text: string): Promise<void>
}
