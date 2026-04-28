import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from '../../i18n'
import { useChatStore } from '../../stores/chatStore'
import { useTabStore } from '../../stores/tabStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTeamStore } from '../../stores/teamStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { sessionsApi } from '../../api/sessions'
import { PermissionModeSelector } from '../controls/PermissionModeSelector'
import { ModelSelector } from '../controls/ModelSelector'
import type { AttachmentRef } from '../../types/chat'
import { AttachmentGallery } from './AttachmentGallery'
import { ProjectContextChip } from '../shared/ProjectContextChip'
import { DirectoryPicker } from '../shared/DirectoryPicker'
import { FileSearchMenu, type FileSearchMenuAction, type FileSearchMenuHandle } from './FileSearchMenu'
import {
  filterSlashCommands,
  findAtTrigger,
  findSlashTrigger,
  getFallbackSlashCommands,
  mergeSlashCommands,
  replaceAtToken,
  replaceSlashToken,
} from './composerUtils'

type GitInfo = { branch: string | null; repoName: string | null; workDir: string; changedFiles: number }

type Attachment = {
  id: string
  name: string
  type: 'image' | 'file'
  mimeType?: string
  previewUrl?: string
  data?: string
}

type ChatInputProps = {
  variant?: 'default' | 'hero'
  mode?: 'chat' | 'code'
}

export function ChatInput({ variant = 'default', mode }: ChatInputProps) {
  const t = useTranslation()
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [fileSearchOpen, setFileSearchOpen] = useState(false)
  const [atFilter, setAtFilter] = useState('')
  const [atCursorPos, setAtCursorPos] = useState(-1)
  const [slashFilter, setSlashFilter] = useState('')
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)
  const composingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const slashMenuRef = useRef<HTMLDivElement>(null)
  const fileSearchRef = useRef<FileSearchMenuHandle>(null)
  const slashItemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const { sendMessage, stopGeneration } = useChatStore()
  const activeTabId = useTabStore((s) => s.activeTabId)
  const locale = useSettingsStore((s) => s.locale)
  const sessionState = useChatStore((s) => activeTabId ? s.sessions[activeTabId] : undefined)
  const chatState = sessionState?.chatState ?? 'idle'
  const slashCommands = sessionState?.slashCommands ?? []
  const activeSession = useSessionStore((state) => activeTabId ? state.sessions.find((session) => session.id === activeTabId) ?? null : null)
  const memberInfo = useTeamStore((s) => activeTabId ? s.getMemberBySessionId(activeTabId) : null)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const hasMessages = useChatStore((s) => activeTabId ? (s.sessions[activeTabId]?.messages?.length ?? 0) > 0 : false)

  const isMemberSession = !!memberInfo
  const isChatSession = mode === 'chat' || activeSession?.mode === 'chat'
  const canUseSessionTools = !isMemberSession
  const canUseProjectTools = canUseSessionTools && !isChatSession
  const canUseAtMentions = canUseSessionTools
  const canUseAttachments = canUseSessionTools
  const canUseSlashCommands = canUseSessionTools
  const isActive = chatState !== 'idle'
  const isWorkspaceMissing = activeSession?.mode !== 'chat' && activeSession?.workDirExists === false
  const canSubmit = !isWorkspaceMissing && (input.trim().length > 0 || (canUseAttachments && attachments.length > 0))
  const isHeroComposer = variant === 'hero' && !isMemberSession

  useEffect(() => {
    textareaRef.current?.focus()
  }, [isActive])

  useEffect(() => {
    if (!activeTabId) {
      setGitInfo(null)
      return
    }
    if (!canUseProjectTools) {
      setGitInfo(null)
      return
    }
    sessionsApi.getGitInfo(activeTabId).then(setGitInfo).catch(() => setGitInfo(null))
  }, [activeTabId, canUseProjectTools])

  useEffect(() => {
    if (isMemberSession) {
      setAttachments([])
      setPlusMenuOpen(false)
      setSlashMenuOpen(false)
    }
    if (canUseAtMentions) return
    setFileSearchOpen(false)
    setAtFilter('')
    setAtCursorPos(-1)
  }, [isMemberSession, canUseAtMentions, activeTabId])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

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

  const filteredCommands = useMemo(() => {
    const fallback = getFallbackSlashCommands(locale, isChatSession ? 'chat' : 'code')
    const source = mergeSlashCommands(slashCommands, fallback)
    return filterSlashCommands(source, slashFilter)
  }, [isChatSession, locale, slashCommands, slashFilter])

  const atActions: FileSearchMenuAction[] = useMemo(() => [
    {
      id: 'computer-use',
      label: 'Computer Use',
      description: locale === 'zh'
        ? '控制本机应用、屏幕、键盘和鼠标'
        : 'Control local apps, screen, keyboard, and mouse',
      insertText: 'Computer Use',
      aliases: ['computer', 'use', 'desktop', '电脑', '桌面', '控制', '应用'],
    },
  ], [locale])

  useEffect(() => {
    setSlashSelectedIndex(0)
  }, [slashFilter])

  useEffect(() => {
    if (slashMenuOpen && slashItemRefs.current[slashSelectedIndex]) {
      slashItemRefs.current[slashSelectedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [slashMenuOpen, slashSelectedIndex])

  const detectSlashTrigger = useCallback((value: string, cursorPos: number) => {
    const token = findSlashTrigger(value, cursorPos)
    if (!token) {
      setSlashMenuOpen(false)
      return
    }

    setFileSearchOpen(false)
    setSlashFilter(token.filter)
    setSlashMenuOpen(true)
  }, [])

  // Detect @ trigger (Computer Use and, in Code mode, file mentions)
  const detectAtTrigger = useCallback((value: string, cursorPos: number) => {
    const token = findAtTrigger(value, cursorPos)
    if (!token) {
      setFileSearchOpen(false)
      setAtFilter('')
      setAtCursorPos(-1)
      return
    }

    setAtFilter(token.filter)
    setAtCursorPos(cursorPos)
    setSlashMenuOpen(false)
    setFileSearchOpen(true)
  }, [])

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value
    if (!canUseSessionTools) {
      setInput(value)
      setSlashMenuOpen(false)
      setFileSearchOpen(false)
      return
    }
    const cursorPos = event.target.selectionStart ?? value.length
    setInput(value)
    if (canUseSlashCommands) {
      detectSlashTrigger(value, cursorPos)
    } else {
      setSlashMenuOpen(false)
    }
    if (canUseAtMentions) {
      detectAtTrigger(value, cursorPos)
    } else {
      setFileSearchOpen(false)
      setAtFilter('')
      setAtCursorPos(-1)
    }
  }

  const selectSlashCommand = useCallback((command: string) => {
    const el = textareaRef.current
    if (!el) return
    const cursorPos = el.selectionStart ?? input.length
    const replacement = replaceSlashToken(input, cursorPos, command)
    setInput(replacement.value)
    setSlashMenuOpen(false)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }, [input])

  const handleSubmit = () => {
    const hasText = input.trim().length > 0
    if ((!hasText && (!attachments.length || !canUseAttachments)) || isWorkspaceMissing) return

    const attachmentPayload: AttachmentRef[] = canUseAttachments
      ? attachments.map((attachment) => ({
          type: attachment.type,
          name: attachment.name,
          data: attachment.data,
          mimeType: attachment.mimeType,
        }))
      : []

    sendMessage(activeTabId!, input, attachmentPayload)
    setInput('')
    setAttachments([])
    setPlusMenuOpen(false)
    setSlashMenuOpen(false)
    setFileSearchOpen(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Ignore key events during IME composition (e.g. Chinese input method)
    if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return

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
      // Other keys (typing) should go to the textarea - let it propagate
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

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    if (!canUseAttachments) return
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
            mimeType: file.type || 'image/png',
            previewUrl: reader.result as string,
            data: reader.result as string,
          },
        ])
      }
      reader.readAsDataURL(file)
    }

    if (!hasImage) return
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canUseAttachments) return
    const files = event.target.files
    if (!files) return

    Array.from(files).forEach((file) => {
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const isImage = file.type.startsWith('image/')
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments((prev) => [
          ...prev,
          {
            id,
            name: file.name,
            type: isImage ? 'image' : 'file',
            mimeType: file.type || undefined,
            previewUrl: isImage ? (reader.result as string) : undefined,
            data: reader.result as string,
          },
        ])
      }
      reader.readAsDataURL(file)
    })

    event.target.value = ''
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    if (!canUseAttachments) return
    const files = event.dataTransfer.files
    if (files.length > 0) {
      const fakeEvent = { target: { files } } as React.ChangeEvent<HTMLInputElement>
      handleFileSelect(fakeEvent)
    }
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id))
  }

  const insertSlashCommand = () => {
    if (!canUseSlashCommands) return
    const el = textareaRef.current
    const cursorPos = el?.selectionStart ?? input.length
    const replacement = replaceSlashToken(input, cursorPos, '', { trailingSpace: false })
    setInput(replacement.value)
    setPlusMenuOpen(false)
    setSlashFilter('')
    setSlashMenuOpen(true)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
    })
  }

  const composerPlaceholder =
    isHeroComposer
      ? t('empty.placeholder')
      : isWorkspaceMissing
        ? t('chat.placeholderMissing')
        : isMemberSession
          ? t('teams.memberPlaceholder')
          : isChatSession
            ? t('chat.placeholderChat')
            : t('chat.placeholder')

  const addFilesLabel = isHeroComposer ? t('empty.addFiles') : t('chat.addFiles')
  const slashCommandsLabel = isHeroComposer ? t('empty.slashCommands') : t('chat.slashCommands')

  return (
    <div className={isHeroComposer ? 'shrink-0 bg-[var(--color-surface)] px-8 pb-4' : 'shrink-0 bg-[var(--color-surface)] px-4 py-4'}>
      <div className={isHeroComposer ? 'mx-auto flex w-full max-w-3xl flex-col gap-2' : 'mx-auto max-w-[860px]'}>
        <div
          className={isHeroComposer
            ? 'glass-panel relative flex flex-col gap-3 rounded-[24px] px-5 py-4 transition-colors'
            : 'glass-panel relative rounded-[24px] px-5 py-4 transition-colors'}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {canUseAtMentions && fileSearchOpen && (
            <FileSearchMenu
              ref={fileSearchRef}
              cwd={gitInfo?.workDir || activeSession?.workDir || ''}
              enableFileSearch={canUseProjectTools}
              actions={atActions}
              filter={atFilter}
              onSelect={(_path, name) => {
                if (atCursorPos >= 0) {
                  const replacement = replaceAtToken(input, atCursorPos, name)
                  if (!replacement) return
                  setInput(replacement.value)
                  setFileSearchOpen(false)
                  setAtFilter('')
                  setAtCursorPos(-1)
                  void textareaRef.current?.focus()
                  requestAnimationFrame(() => {
                    textareaRef.current?.setSelectionRange(replacement.cursorPos, replacement.cursorPos)
                  })
                }
              }}
            />
          )}

          {canUseSlashCommands && slashMenuOpen && filteredCommands.length > 0 && (
            <div
              ref={slashMenuRef}
              className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]"
            >
              <div className="max-h-[300px] overflow-y-auto py-1">
                {filteredCommands.map((command, index) => (
                  <button
                    key={command.name}
                    ref={(el) => { slashItemRefs.current[index] = el }}
                    onClick={() => selectSlashCommand(command.name)}
                    onMouseEnter={() => setSlashSelectedIndex(index)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      index === slashSelectedIndex
                        ? 'bg-[var(--color-surface-hover)]'
                        : 'hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    <span className="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]">
                      /{command.name}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-tertiary)]">
                      {command.description}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-tertiary)]">
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Up/Down</kbd>
                <span>{t('chat.navigate')}</span>
                <kbd className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
                <span>{t('chat.select')}</span>
                <kbd className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1.5 py-0.5 font-mono text-[10px]">Esc</kbd>
                <span>{t('chat.dismiss')}</span>
              </div>
            </div>
          )}

          {attachments.length > 0 && (
            isHeroComposer ? (
              <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
            ) : (
              <div className="px-3 pt-3">
                <AttachmentGallery attachments={attachments} variant="composer" onRemove={removeAttachment} />
              </div>
            )
          )}

          {isHeroComposer ? (
            <div className="flex items-start gap-3">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => { composingRef.current = true }}
                onCompositionEnd={() => { composingRef.current = false }}
                onPaste={handlePaste}
                placeholder={composerPlaceholder}
                disabled={isWorkspaceMissing}
                rows={2}
                className="flex-1 resize-none border-none bg-transparent py-2 leading-relaxed text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:opacity-50"
              />
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={() => { composingRef.current = false }}
              onPaste={handlePaste}
              placeholder={composerPlaceholder}
              disabled={isWorkspaceMissing}
              rows={1}
              className="w-full resize-none bg-transparent py-2 pb-12 text-sm leading-relaxed text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-tertiary)] disabled:opacity-50"
            />
          )}

          <div className={isHeroComposer
            ? 'flex items-center justify-between pt-2'
            : 'absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-3'}>
            <div className="flex items-center gap-2">
              {canUseSessionTools && (
                <>
                  <div ref={plusMenuRef} className="relative">
                    <button
                      onClick={() => setPlusMenuOpen((value) => !value)}
                      aria-label="Open composer tools"
                      className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)]"
                    >
                      <span className="material-symbols-outlined text-[18px]">add</span>
                    </button>

                    {plusMenuOpen && (
                      <div className="absolute bottom-full left-0 z-50 mb-2 w-[240px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] py-1 shadow-[var(--shadow-dropdown)]">
                        <button
                          onClick={() => {
                            fileInputRef.current?.click()
                            setPlusMenuOpen(false)
                          }}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <span className="material-symbols-outlined text-[18px] text-[var(--color-text-secondary)]">attach_file</span>
                          <span className="text-sm text-[var(--color-text-primary)]">{addFilesLabel}</span>
                        </button>
                        <button
                          onClick={insertSlashCommand}
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
                        >
                          <span className="w-[24px] text-center text-[18px] font-bold text-[var(--color-text-secondary)]">/</span>
                          <span className="text-sm text-[var(--color-text-primary)]">{slashCommandsLabel}</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <PermissionModeSelector />
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!isMemberSession && <ModelSelector />}
              <button
                onClick={!isMemberSession && isActive ? () => stopGeneration(activeTabId!) : handleSubmit}
                disabled={!isMemberSession && isActive ? false : !canSubmit}
                title={!isMemberSession && isActive ? t('chat.stopTitle') : undefined}
                className={`flex w-[112px] items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all hover:brightness-105 disabled:opacity-30 ${
                  !isMemberSession && isActive
                    ? 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
                    : 'bg-[image:var(--gradient-btn-primary)] text-[var(--color-btn-primary-fg)] shadow-[var(--shadow-button-primary)]'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">
                  {!isMemberSession && isActive ? 'stop' : 'arrow_forward'}
                </span>
                {!isMemberSession && isActive ? t('common.stop') : (isMemberSession || isChatSession) ? t('common.send') : t('common.run')}
              </button>
            </div>
          </div>
        </div>

        {canUseAttachments && (
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
        )}

        {canUseProjectTools && (
          <div className="mt-3 px-1">
            {hasMessages ? (
              <ProjectContextChip
                workDir={gitInfo?.workDir || activeSession?.workDir}
                repoName={gitInfo?.repoName || null}
                branch={gitInfo?.branch || null}
              />
            ) : (
              <DirectoryPicker
                value={gitInfo?.workDir || activeSession?.workDir || ''}
                onChange={async (newWorkDir) => {
                  if (!activeTabId) return
                  const oldId = activeTabId
                  const { deleteSession, createSession } = useSessionStore.getState()
                  const { replaceTabSession } = useTabStore.getState()
                  const { disconnectSession, connectToSession } = useChatStore.getState()
                  const newId = await createSession(newWorkDir)
                  disconnectSession(oldId)
                  replaceTabSession(oldId, newId)
                  connectToSession(newId)
                  deleteSession(oldId).catch(() => {})
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
