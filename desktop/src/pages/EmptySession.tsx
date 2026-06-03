import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { skillsApi } from '../api/skills'
import { useTranslation } from '../i18n'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../stores/chatStore'
import { usePluginStore } from '../stores/pluginStore'
import { useSessionRuntimeStore, DRAFT_RUNTIME_SELECTION_KEY } from '../stores/sessionRuntimeStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useModeStore } from '../stores/modeStore'
import { SETTINGS_TAB_ID, useTabStore } from '../stores/tabStore'
import { RepositoryLaunchControls } from '../components/shared/RepositoryLaunchControls'
import { DirectoryPicker } from '../components/shared/DirectoryPicker'
import { PermissionModeSelector } from '../components/controls/PermissionModeSelector'
import { ModelSelector } from '../components/controls/ModelSelector'
import { AttachmentGallery } from '../components/chat/AttachmentGallery'
import { ComposerDropOverlay } from '../components/chat/ComposerDropOverlay'
import { ContextUsageIndicator } from '../components/chat/ContextUsageIndicator'
import { FileSearchMenu, type FileSearchMenuHandle } from '../components/chat/FileSearchMenu'
import { LocalSlashCommandPanel, type LocalSlashCommandName } from '../components/chat/LocalSlashCommandPanel'
import { useMobileViewport } from '../hooks/useMobileViewport'
import { isTauriRuntime } from '../lib/desktopRuntime'
import {
  filesToComposerAttachments,
  selectNativeFileAttachments,
  type ComposerAttachment,
} from '../lib/composerAttachments'
import { useComposerFileDrop } from '../components/chat/useComposerFileDrop'
import { shouldSubmitOnEnter } from '../components/chat/sendShortcut'
import {
  getLocalizedFallbackCommands,
  filterSlashCommands,
  findSlashToken,
  insertSlashTrigger,
  mergeSlashCommands,
  replaceSlashCommand,
  resolveSlashUiAction,
} from '../components/chat/composerUtils'
import type { AttachmentRef } from '../types/chat'
import type { PermissionMode } from '../types/settings'
import type { SlashCommandOption } from '../components/chat/composerUtils'

type Attachment = ComposerAttachment

type Translate = ReturnType<typeof useTranslation>

function getPathLabel(path: string | null | undefined, fallback: string): string {
  const normalized = path?.trim()
  if (!normalized) return fallback
  const parts = normalized.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] || fallback
}

function getApiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  const body = error.body
  if (!body || typeof body !== 'object' || !('error' in body)) return null
  return typeof body.error === 'string' ? body.error : null
}

function resolveCreateSessionErrorMessage(error: unknown, t: Translate): string {
  const code = getApiErrorCode(error)
  switch (code) {
    case 'WORKDIR_MISSING':
    case 'WORKDIR_NOT_DIRECTORY':
      return t('empty.createError.workdirMissing')
    case 'REPOSITORY_NOT_GIT':
      return t('empty.createError.notGit')
    case 'REPOSITORY_BRANCH_NOT_FOUND':
      return t('empty.createError.branchNotFound')
    case 'REPOSITORY_DIRTY_WORKTREE':
      return t('empty.createError.dirtyWorktree')
    case 'REPOSITORY_BRANCH_CHECKED_OUT':
      return t('empty.createError.branchCheckedOut')
    case 'REPOSITORY_WORKTREE_CREATE_FAILED':
      return t('empty.createError.worktreeCreateFailed', {
        detail: error instanceof Error ? error.message : t('empty.failedToCreate'),
      })
    case 'REPOSITORY_SWITCH_FAILED':
      return t('empty.createError.switchFailed', {
        detail: error instanceof Error ? error.message : t('empty.failedToCreate'),
      })
    case 'REPOSITORY_CONTEXT_ERROR':
      return t('empty.createError.contextFailed')
    default:
      return error instanceof Error ? error.message : t('empty.failedToCreate')
  }
}

export function EmptySession() {
  const t = useTranslation()
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workDir, setWorkDir] = useState('')
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)
  const [useWorktree, setUseWorktree] = useState(false)
  const [repositoryLaunchReady, setRepositoryLaunchReady] = useState(true)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [localSlashPanel, setLocalSlashPanel] = useState<LocalSlashCommandName | null>(null)
  const [atFilter, setAtFilter] = useState('')
  const [atCursorPos, setAtCursorPos] = useState(-1)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const [slashCommands, setSlashCommands] = useState<SlashCommandOption[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const fileSearchRef = useRef<FileSearchMenuHandle>(null)
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const createSession = useSessionStore((state) => state.createSession)
  const sendMessage = useChatStore((state) => state.sendMessage)
  const connectToSession = useChatStore((state) => state.connectToSession)
  const setActiveView = useUIStore((state) => state.setActiveView)
  const addToast = useUIStore((state) => state.addToast)
  const currentMode = useModeStore((state) => state.currentMode)
  const isChatMode = currentMode === 'chat'
  const currentModel = useSettingsStore((state) => state.currentModel)
  const chatSendBehavior = useSettingsStore((state) => state.chatSendBehavior)
  const defaultPermissionMode = useSettingsStore((state) => state.permissionMode)
  const [draftPermissionMode, setDraftPermissionMode] = useState<PermissionMode>(defaultPermissionMode)
  const lastPluginReloadSummary = usePluginStore((state) => state.lastReloadSummary)
  const draftRuntimeSelection = useSessionRuntimeStore((state) => state.selections[DRAFT_RUNTIME_SELECTION_KEY])
  const draftRuntimeSelectionKey = draftRuntimeSelection
    ? `${draftRuntimeSelection.providerId ?? 'official'}:${draftRuntimeSelection.modelId}:${draftRuntimeSelection.effortLevel ?? 'auto'}`
    : undefined
  const draftModelLabel = draftRuntimeSelection?.modelId ?? currentModel?.name ?? currentModel?.id
  const isMobileComposer = useMobileViewport() && !isTauriRuntime()

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!plusMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(event.target as Node)) {
        setPlusMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [plusMenuOpen])

  useEffect(() => {
    if (!slashMenuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setSlashMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [slashMenuOpen])

  useEffect(() => {
    if (!localSlashPanel) return
    const handleClick = (event: MouseEvent) => {
      if (
        slashMenuRef.current &&
        !slashMenuRef.current.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setLocalSlashPanel(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [localSlashPanel])

  useEffect(() => {
    if (!isChatMode) return
    setWorkDir('')
    setSelectedBranch(null)
    setUseWorktree(false)
    setRepositoryLaunchReady(true)
    setFileSearchOpen(false)
    setAtFilter('')
    setAtCursorPos(-1)
  }, [isChatMode])

  useEffect(() => {
    if (!fileSearchOpen) return
    const handleClick = (event: MouseEvent) => {
      const menu = document.getElementById('file-search-menu')
      if (
        menu &&
        !menu.contains(event.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setFileSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [fileSearchOpen])

  useEffect(() => {
    let cancelled = false

    if (isChatMode) {
      setSlashCommands([])
      return () => {
        cancelled = true
      }
    }

    skillsApi.list(workDir || undefined)
      .then(({ skills }) => {
        if (cancelled) return
        setSlashCommands(
          skills
            .filter((skill) => skill.userInvocable)
            .map((skill) => ({
              name: skill.name,
              description: skill.description,
            })),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setSlashCommands([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [isChatMode, workDir, lastPluginReloadSummary])

  const allSlashCommands = useMemo(
    () => mergeSlashCommands(slashCommands, getLocalizedFallbackCommands(t)),
    [slashCommands, t],
  )

  const handleWorkDirChange = (newWorkDir: string) => {
    setWorkDir(newWorkDir)
    setSelectedBranch(null)
    setUseWorktree(false)
    setRepositoryLaunchReady(!newWorkDir)
  }

  const filteredCommands = useMemo(() => {
    return filterSlashCommands(allSlashCommands, slashFilter)
  }, [allSlashCommands, slashFilter])

  const exactSlashCommand = useMemo(() => {
    const normalized = slashFilter.trim().toLowerCase()
    if (!normalized) return null
    return filteredCommands.find((command) => command.name.toLowerCase() === normalized) ?? null
  }, [filteredCommands, slashFilter])
  const canSubmit = (
    input.trim().length > 0 ||
    attachments.length > 0 ||
    isChatMode ||
    !!workDir
  ) && !isSubmitting && (isChatMode || repositoryLaunchReady)

  useEffect(() => {
    setSlashSelectedIndex(0)
  }, [slashFilter])

  useEffect(() => {
    const activeItem = slashMenuOpen ? slashItemRefs.current[slashSelectedIndex] : null
    if (activeItem && typeof activeItem.scrollIntoView === 'function') {
      activeItem.scrollIntoView({ block: 'nearest' })
    }
  }, [slashMenuOpen, slashSelectedIndex])

  const handleSubmit = async () => {
    const text = input.trim()
    if (!canSubmit) return

    const slashUiAction = text.startsWith('/') ? resolveSlashUiAction(text.slice(1)) : null
    if (slashUiAction?.type === 'panel') {
      setLocalSlashPanel(slashUiAction.command as LocalSlashCommandName)
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    if (slashUiAction?.type === 'settings') {
      useUIStore.getState().setPendingSettingsTab(slashUiAction.tab)
      useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
      setInput('')
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      setPlusMenuOpen(false)
      return
    }

    setIsSubmitting(true)
    try {
      const explicitDraftSelection = useSessionRuntimeStore.getState().selections[DRAFT_RUNTIME_SELECTION_KEY]
      const sessionId = await createSession(
        isChatMode ? undefined : (workDir || undefined),
        {
          mode: currentMode,
          ...(!isChatMode && selectedBranch
            ? { repository: { branch: selectedBranch, worktree: useWorktree } }
            : {}),
          permissionMode: draftPermissionMode,
        },
      )
      if (explicitDraftSelection) {
        useSessionRuntimeStore.getState().setSelection(sessionId, explicitDraftSelection)
        useSessionRuntimeStore.getState().clearSelection(DRAFT_RUNTIME_SELECTION_KEY)
      }
      setActiveView('code')
      useTabStore.getState().openTab(sessionId, 'New Session')
      connectToSession(sessionId)
      const attachmentPayload: AttachmentRef[] = attachments.map((attachment) => ({
        type: attachment.type,
        name: attachment.name,
        path: attachment.path,
        data: attachment.data,
        mimeType: attachment.mimeType,
      }))
      if (text || attachmentPayload.length > 0) {
        sendMessage(sessionId, text, attachmentPayload)
      }
      setInput('')
      setAttachments([])
    } catch (error) {
      addToast({
        type: 'error',
        message: resolveCreateSessionErrorMessage(error, t),
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleInputChange = (value: string, cursorPos: number) => {
    setInput(value)
    const token = findSlashToken(value, cursorPos)
    if (!token) {
      setSlashMenuOpen(false)
    } else {
      setSlashFilter(token.filter)
      setSlashMenuOpen(true)
    }

    // Detect @ trigger for file search
    const textBeforeCursor = value.slice(0, cursorPos)
    let pos = -1
    for (let i = textBeforeCursor.length - 1; i >= 0; i--) {
      const ch = textBeforeCursor[i]!
      if (ch === '@') {
        if (i === 0 || /\s/.test(textBeforeCursor[i - 1]!)) {
          pos = i
          break
        }
        break
      }
      if (/\s/.test(ch)) {
        break
      }
    }
    if (pos < 0) {
      setFileSearchOpen(false)
      setAtFilter('')
      setAtCursorPos(-1)
    } else if (!isChatMode && workDir) {
      setAtFilter(textBeforeCursor.slice(pos + 1))
      setAtCursorPos(pos)
      setSlashMenuOpen(false)
      setFileSearchOpen(true)
    } else {
      setFileSearchOpen(false)
      setAtFilter('')
      setAtCursorPos(-1)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Ignore key events during IME composition (e.g. Chinese input method)
    if (event.nativeEvent.isComposing) return

    // Route file search navigation keys to FileSearchMenu
    if (fileSearchOpen) {
      const key = event.key
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === 'Tab' || key === 'Escape') {
        event.preventDefault()
        if (key === 'Escape') {
          setFileSearchOpen(false)
          setAtFilter('')
          setAtCursorPos(-1)
          return
        }
        fileSearchRef.current?.handleKeyDown(event.nativeEvent)
        return
      }
      return
    }

    if (slashMenuOpen && filteredCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlashSelectedIndex((prev) => (prev + 1) % filteredCommands.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlashSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (
          event.key === 'Enter' &&
          exactSlashCommand &&
          slashFilter.trim().toLowerCase() === exactSlashCommand.name.toLowerCase() &&
          shouldSubmitOnEnter(event, chatSendBehavior)
        ) {
          event.preventDefault()
          void handleSubmit()
          return
        }
        event.preventDefault()
        const selected = filteredCommands[slashSelectedIndex]
        if (selected) selectSlashCommand(selected.name)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlashMenuOpen(false)
        return
      }
    }

    if (shouldSubmitOnEnter(event, chatSendBehavior)) {
      event.preventDefault()
      handleSubmit()
    }
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items
    if (!items) return

    let hasImage = false
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!item || !item.type.startsWith('image/')) continue

      hasImage = true
      event.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: `pasted-image-${Date.now()}.png`,
            type: 'image',
            mimeType: file.type || undefined,
            previewUrl: reader.result as string,
            data: reader.result as string,
          },
        ])
      }
      reader.readAsDataURL(file)
    }

    if (!hasImage) return
  }

  const appendFiles = useCallback((files: FileList | File[]) => {
    void filesToComposerAttachments(files)
      .then((nextAttachments) => {
        if (nextAttachments.length === 0) return
        setAttachments((prev) => [...prev, ...nextAttachments])
      })
      .catch((error) => {
        console.warn('[attachments] Failed to read selected files', error)
      })
  }, [])

  const appendAttachments = useCallback((nextAttachments: Attachment[]) => {
    if (nextAttachments.length === 0) return
    setAttachments((prev) => [...prev, ...nextAttachments])
  }, [])

  const { isDragActive, dragHandlers } = useComposerFileDrop({
    panelRef,
    onAttachments: appendAttachments,
    onError: (error) => {
      console.warn('[attachments] Failed to read dropped files', error)
    },
  })

  const openAttachmentPicker = useCallback(() => {
    if (!isTauriRuntime()) {
      fileInputRef.current?.click()
      setPlusMenuOpen(false)
      return
    }

    void selectNativeFileAttachments()
      .then((nativeAttachments) => {
        if (nativeAttachments) {
          if (nativeAttachments.length > 0) {
            setAttachments((prev) => [...prev, ...nativeAttachments])
          }
          return
        }
        fileInputRef.current?.click()
      })
      .finally(() => setPlusMenuOpen(false))
  }, [])

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return

    appendFiles(files)
    event.target.value = ''
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }

  const selectSlashCommand = (command: string) => {
    const el = textareaRef.current
    if (!el) return
    const cursorPos = el.selectionStart ?? input.length
    const replacement = replaceSlashCommand(input, cursorPos, command)
    if (!replacement) return
    setInput(replacement.value)
    setSlashMenuOpen(false)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  const insertSlashCommand = () => {
    const el = textareaRef.current
    const cursorPos = el?.selectionStart ?? input.length
    const replacement = insertSlashTrigger(input, cursorPos)
    setInput(replacement.value)
    setPlusMenuOpen(false)
    setSlashFilter('')
    setSlashMenuOpen(true)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  const heroProjectName = getPathLabel(workDir, 'Ycode')
  const heroTitle = isChatMode ? t('empty.title') : t('empty.heroQuestion', { project: heroProjectName })
  const heroSubtitle = isChatMode ? t('empty.subtitle') : t('empty.codeSubtitle')
  const projectContextBar = !isChatMode && !isMobileComposer ? (
    <div className="empty-session-project-bar flex min-h-11 flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-xs text-[var(--color-text-tertiary)]">
      <DirectoryPicker value={workDir} onChange={handleWorkDirChange} />
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <span className="material-symbols-outlined text-[15px]">computer</span>
        {t('composer.localMode')}
      </span>
    </div>
  ) : null

  return (
    <div className={`empty-session-shell relative flex flex-1 flex-col overflow-hidden bg-background ${
      isMobileComposer ? 'empty-session-shell--mobile' : ''
    }`}>
      <div className={`relative z-10 flex flex-1 flex-col items-center justify-center ${
        isMobileComposer ? 'px-6 pb-[230px] pt-10' : 'px-8 pb-24 pt-14'
      }`}>
        <div className={`flex w-full flex-col items-center text-center ${
          isMobileComposer ? 'max-w-[300px]' : 'max-w-[920px]'
        }`}>
          <h1
            className={`font-extrabold tracking-normal text-[var(--color-text-primary)] ${
              isMobileComposer ? 'text-2xl' : 'text-[36px] leading-[1.16]'
            }`}
            style={{ fontFamily: 'var(--font-headline)' }}
          >
            {heroTitle}
          </h1>
          <p
            className={`mx-auto mt-4 text-[var(--color-text-secondary)] ${
              isMobileComposer ? 'max-w-[280px] text-sm leading-6' : 'max-w-[640px] text-[15px] leading-7'
            }`}
            style={{ fontFamily: 'var(--font-body)' }}
          >
            {heroSubtitle}
          </p>
        </div>

        <div
          data-testid="empty-session-composer-shell"
          className={`z-30 mt-8 flex w-full justify-center ${
            isMobileComposer ? 'fixed bottom-0 left-0 right-0 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)]' : ''
          }`}
        >
        <div className={`flex w-full flex-col ${isMobileComposer ? 'max-w-none' : 'max-w-[780px]'}`}>
          <div
            ref={panelRef}
            data-testid="empty-session-composer-panel"
            className={`empty-session-composer-panel relative flex flex-col overflow-visible ${
              isMobileComposer ? 'rounded-2xl p-3 shadow-[0_-12px_36px_rgba(54,35,28,0.12)]' : 'p-0'
            } ${isDragActive ? 'composer-drop-target-active' : ''}`}
            {...dragHandlers}
          >
            {isDragActive && (
              <ComposerDropOverlay
                testId="empty-session-drop-overlay"
                title={t('chat.dropFilesTitle')}
                description={t('chat.dropFilesHint')}
              />
            )}

            <div className={isMobileComposer ? 'contents' : 'flex flex-col'}>
              {!isChatMode && workDir && fileSearchOpen && (
                <FileSearchMenu
                  ref={fileSearchRef}
                  cwd={workDir || ''}
                  filter={atFilter}
                  onNavigate={(relativePath) => {
                    if (atCursorPos < 0) return
                    const replacement = `@${relativePath}`
                    const tokenEnd = atCursorPos + 1 + atFilter.length
                    const newValue = `${input.slice(0, atCursorPos)}${replacement}${input.slice(tokenEnd)}`
                    const newCursorPos = atCursorPos + replacement.length
                    setInput(newValue)
                    setAtFilter(relativePath)
                    requestAnimationFrame(() => {
                      textareaRef.current?.focus()
                      textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos)
                    })
                  }}
                  onSelect={(path, name) => {
                    if (atCursorPos >= 0) {
                      const attachmentName = name.split('/').filter(Boolean).pop() ?? name
                      const tokenEnd = atCursorPos + 1 + atFilter.length
                      const beforeToken = input.slice(0, atCursorPos)
                      const afterToken = beforeToken ? input.slice(tokenEnd) : input.slice(tokenEnd).replace(/^\s+/, '')
                      const spacer = beforeToken && afterToken && !/\s$/.test(beforeToken) && !/^\s/.test(afterToken) ? ' ' : ''
                      const newValue = `${beforeToken}${spacer}${afterToken}`
                      const newCursorPos = atCursorPos + spacer.length
                      setAttachments((prev) => [
                        ...prev,
                        {
                          id: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                          name: attachmentName,
                          type: 'file',
                          path,
                        },
                      ])
                      setInput(newValue)
                      setFileSearchOpen(false)
                      setAtFilter('')
                      setAtCursorPos(-1)
                      void textareaRef.current?.focus()
                      requestAnimationFrame(() => {
                        textareaRef.current?.setSelectionRange(newCursorPos, newCursorPos)
                      })
                    }
                  }}
                />
              )}

              {localSlashPanel && (
                <div ref={slashMenuRef}>
                  <LocalSlashCommandPanel
                    command={localSlashPanel}
                    cwd={isChatMode ? undefined : workDir || undefined}
                    commands={allSlashCommands}
                    onClose={() => setLocalSlashPanel(null)}
                  />
                </div>
              )}

              {slashMenuOpen && filteredCommands.length > 0 && (
                <div
                  ref={slashMenuRef}
                  className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]"
                >
                  <div className="max-h-[260px] overflow-y-auto py-1">
                    {filteredCommands.map((command, index) => (
                      <button
                        key={command.name}
                        ref={(el) => { slashItemRefs.current[index] = el }}
                        onClick={() => selectSlashCommand(command.name)}
                        onMouseEnter={() => setSlashSelectedIndex(index)}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          index === slashSelectedIndex ? 'bg-[var(--color-surface-hover)]' : 'hover:bg-[var(--color-surface-hover)]'
                        }`}
                      >
                        <span className="flex min-w-0 max-w-[52%] shrink-0 items-baseline gap-1.5">
                          <span className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">/{command.name}</span>
                          {command.argumentHint ? (
                            <span className="min-w-0 truncate font-mono text-[11px] text-[var(--color-text-tertiary)]">
                              {command.argumentHint}
                            </span>
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-tertiary)]">{command.description}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {attachments.length > 0 && (
                <div className="px-5 pt-4">
                  <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
                </div>
              )}

              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => handleInputChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className={`w-full resize-none border-none bg-transparent text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] ${
                  isMobileComposer ? 'max-h-[132px] min-h-[72px] py-1.5 text-base' : 'min-h-[92px] px-5 pb-2 pt-4 text-[15px] leading-7'
                }`}
                style={{ fontFamily: 'var(--font-body)' }}
                placeholder={t('empty.placeholder')}
                rows={2}
              />

              <div className={`${
                isMobileComposer ? 'flex flex-wrap items-center gap-2 border-t border-[var(--color-border-separator)] pt-3' : 'flex items-center justify-between px-4 pb-3 pt-1'
              }`}>
                <div className="flex shrink-0 items-center gap-2">
                  <div ref={plusMenuRef} className="relative">
                    <button
                      onClick={() => setPlusMenuOpen((prev) => !prev)}
                      aria-label="Open composer tools"
                      className={`text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] ${
                        isMobileComposer ? 'inline-flex h-11 w-11 items-center justify-center rounded-xl' : 'inline-flex h-8 w-8 items-center justify-center rounded-lg'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">add</span>
                    </button>

                    {plusMenuOpen && (
                      <div className={`absolute bottom-full left-0 mb-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)] ${
                        isMobileComposer ? 'w-[min(240px,calc(100vw-32px))]' : 'w-[240px]'
                      }`}>
                        <button
                          onClick={openAttachmentPicker}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <span className="material-symbols-outlined text-[18px] text-[var(--color-text-secondary)]">attach_file</span>
                          {t('empty.addFiles')}
                        </button>
                        <button
                          onClick={insertSlashCommand}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <span className="w-5 text-center text-[18px] font-bold text-[var(--color-text-secondary)]">/</span>
                          {t('empty.slashCommands')}
                        </button>
                      </div>
                    )}
                  </div>

                  <PermissionModeSelector
                    workDir={isChatMode ? undefined : workDir}
                    compact={isMobileComposer}
                    value={draftPermissionMode}
                    onChange={setDraftPermissionMode}
                  />
                </div>

                <div className={`${isMobileComposer ? 'flex min-w-0 flex-1 items-center justify-end gap-2' : 'flex items-center gap-3'}`}>
                  <ContextUsageIndicator
                    chatState="idle"
                    messageCount={0}
                    runtimeSelectionKey={draftRuntimeSelectionKey}
                    fallbackModelLabel={draftModelLabel}
                    draft
                    compact={isMobileComposer}
                  />
                  <ModelSelector runtimeKey={DRAFT_RUNTIME_SELECTION_KEY} disabled={isSubmitting} compact={isMobileComposer} />
                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    aria-label={t('common.run')}
                    title={isMobileComposer ? t('common.run') : undefined}
                    className={`flex shrink-0 items-center justify-center gap-1 rounded-lg bg-[image:var(--gradient-btn-primary)] text-xs font-semibold text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)] transition-all hover:brightness-105 disabled:opacity-30 ${
                      isMobileComposer ? 'h-11 w-11 rounded-xl px-0 py-0' : 'h-8 w-8 rounded-lg px-0 py-0'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                  </button>
                </div>
              </div>
            </div>

            {projectContextBar}

            {!isChatMode && !isMobileComposer && workDir && (
              <RepositoryLaunchControls
                workDir={workDir}
                onWorkDirChange={handleWorkDirChange}
                branch={selectedBranch}
                onBranchChange={setSelectedBranch}
                useWorktree={useWorktree}
                onUseWorktreeChange={setUseWorktree}
                onLaunchReadyChange={setRepositoryLaunchReady}
                disabled={isSubmitting}
                placement="composer"
                showDirectoryPicker={false}
              />
            )}
          </div>

          {!isChatMode && isMobileComposer && (
            <RepositoryLaunchControls
              workDir={workDir}
              onWorkDirChange={handleWorkDirChange}
              branch={selectedBranch}
              onBranchChange={setSelectedBranch}
              useWorktree={useWorktree}
              onUseWorktreeChange={setUseWorktree}
              onLaunchReadyChange={setRepositoryLaunchReady}
              disabled={isSubmitting}
            />
          )}
        </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
    </div>
  )
}
