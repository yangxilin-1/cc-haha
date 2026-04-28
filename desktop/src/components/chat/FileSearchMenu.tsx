import { forwardRef, useState, useEffect, useRef, useCallback, useImperativeHandle } from 'react'
import { ApiError } from '../../api/client'
import { filesystemApi } from '../../api/filesystem'
import { useTranslation } from '../../i18n'
import type { TranslationKey } from '../../i18n'
import { ComputerUseLineIcon, FileLineIcon, FolderLineIcon } from '../shared/LineIcons'

type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

export type FileSearchMenuHandle = {
  handleKeyDown: (e: KeyboardEvent) => void
}

export type FileSearchMenuAction = {
  id: string
  label: string
  description: string
  insertText: string
  aliases?: string[]
}

type Props = {
  cwd: string
  filter?: string
  enableFileSearch?: boolean
  actions?: FileSearchMenuAction[]
  onSelect: (
    path: string,
    relativePath: string,
    item?: { type: 'action' | 'file' | 'directory'; id?: string },
  ) => void
}

export const FileSearchMenu = forwardRef<FileSearchMenuHandle, Props>(({
  cwd,
  filter = '',
  enableFileSearch = true,
  actions = [],
  onSelect,
}, ref) => {
  const t = useTranslation()
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null)
  const [currentPath, setCurrentPath] = useState(cwd)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const currentPathRef = useRef(cwd)
  const canBrowseFiles = enableFileSearch && cwd.trim().length > 0

  const getErrorState = (error: unknown): { errorKey: TranslationKey | null; errorMessage: string | null } => {
    if (error instanceof ApiError) {
      if (error.status === 403) {
        return { errorKey: 'fileSearch.accessDenied', errorMessage: null }
      }

      const apiMessage =
        typeof error.body === 'string'
          ? error.body
          : typeof error.body === 'object' &&
              error.body !== null &&
              'error' in error.body &&
              typeof error.body.error === 'string'
            ? error.body.error
            : null

      if (apiMessage) {
        return { errorKey: null, errorMessage: apiMessage }
      }
    }

    return { errorKey: 'fileSearch.loadFailed', errorMessage: null }
  }

  // Parse filter: if it contains '/', navigate to that subdir and search the rest
  // Uses currentPathRef as base so nested paths navigate from current depth
  const parseFilter = (rawFilter: string): { navigateTo: string; searchQuery: string } => {
    const base = currentPathRef.current
    if (!rawFilter || !rawFilter.includes('/')) {
      return { navigateTo: base, searchQuery: rawFilter }
    }
    const lastSlash = rawFilter.lastIndexOf('/')
    const dirPart = rawFilter.slice(0, lastSlash + 1)
    const searchPart = rawFilter.slice(lastSlash + 1)
    const navigateTo = dirPart === '' ? base : `${base}/${dirPart}`
    return { navigateTo, searchQuery: searchPart }
  }

  // Load directory entries
  const loadDir = useCallback(async (dirPath: string, searchQuery: string) => {
    if (!canBrowseFiles) {
      setEntries([])
      setLoading(false)
      setErrorMessage(null)
      setErrorKey(null)
      setSelectedIndex(0)
      return
    }

    setLoading(true)
    setErrorMessage(null)
    setErrorKey(null)
    // Only update currentPath if actually navigating to a different directory
    if (dirPath !== currentPathRef.current) {
      setCurrentPath(dirPath)
      currentPathRef.current = dirPath
    }
    try {
      if (searchQuery) {
        const result = await filesystemApi.search(searchQuery, dirPath)
        setEntries(result.entries)
      } else {
        const result = await filesystemApi.browse(dirPath, { includeFiles: true })
        setEntries(result.entries)
      }
      setSelectedIndex(0)
    } catch (error) {
      setEntries([])
      const nextError = getErrorState(error)
      setErrorKey(nextError.errorKey)
      setErrorMessage(nextError.errorMessage)
    }
    setLoading(false)
  }, [canBrowseFiles])

  // Initial load: parse filter path and navigate accordingly
  useEffect(() => {
    currentPathRef.current = cwd
    const { navigateTo, searchQuery } = parseFilter(filter)
    void loadDir(navigateTo, searchQuery)
  }, [cwd, filter, loadDir])

  const visibleActions = actions.filter((action) => {
    const query = filter.trim().toLowerCase()
    if (!query) return true
    return [
      action.label,
      action.description,
      action.insertText,
      ...(action.aliases ?? []),
    ].join('\n').toLowerCase().includes(query)
  })
  const orderedEntries = [
    ...entries.filter((entry) => entry.isDirectory),
    ...entries.filter((entry) => !entry.isDirectory),
  ]

  // Keyboard navigation handler exposed via ref
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const selectableCount = visibleActions.length + orderedEntries.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, Math.max(selectableCount - 1, 0)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const action = visibleActions[selectedIndex]
      if (action) {
        onSelect('', action.insertText, { type: 'action', id: action.id })
        return
      }

      const entry = orderedEntries[selectedIndex - visibleActions.length]
      if (entry) {
        onSelect(entry.path, entry.name, {
          type: entry.isDirectory ? 'directory' : 'file',
        })
      }
      return
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedEntries, selectedIndex, visibleActions])

  useImperativeHandle(ref, () => ({ handleKeyDown }), [handleKeyDown])

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLButtonElement | null
    if (typeof el?.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  // Build breadcrumb segments from current path relative to cwd
  const breadcrumbs: string[] = []
  if (currentPath !== cwd && currentPath.startsWith(cwd)) {
    const rel = currentPath.slice(cwd.length).replace(/^\//, '')
    if (rel) breadcrumbs.push(...rel.split('/'))
  }

  const dirs = entries.filter((e) => e.isDirectory)
  const files = entries.filter((e) => !e.isDirectory)
  const showFileHeader = canBrowseFiles
  const showEmptyState =
    !loading &&
    !errorKey &&
    !errorMessage &&
    visibleActions.length === 0 &&
    entries.length === 0

  return (
    <div
      id="file-search-menu"
      className="absolute left-0 bottom-full mb-2 z-50 w-full min-w-[480px] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {showFileHeader && (
        <div className="flex items-center gap-1.5 border-b border-[var(--color-border)] px-3 py-2 text-[11px]">
          <FolderLineIcon size={14} className="text-[var(--color-text-tertiary)]" />
          <span className="text-[var(--color-text-tertiary)] font-mono">{cwd.split('/').pop() || cwd}</span>
          {breadcrumbs.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-[var(--color-text-tertiary)]">/</span>
              <span className="text-[var(--color-text-primary)] font-mono">{seg}</span>
            </span>
          ))}
          {loading && (
            <span className="material-symbols-outlined text-[12px] text-[var(--color-text-tertiary)] animate-spin ml-1">progress_activity</span>
          )}
        </div>
      )}

      {/* File list */}
      <div ref={listRef} className="max-h-[300px] overflow-y-auto py-1">
        {visibleActions.map((action, index) => (
          <button
            key={action.id}
            data-index={index}
            onClick={() => onSelect('', action.insertText, { type: 'action', id: action.id })}
            onMouseEnter={() => setSelectedIndex(index)}
            className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
              selectedIndex === index ? 'bg-[var(--color-surface-hover)]' : 'hover:bg-[var(--color-surface-hover)]'
            }`}
          >
            <ComputerUseLineIcon size={16} className="shrink-0 text-[var(--color-brand)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{action.label}</span>
              <span className="block truncate text-xs text-[var(--color-text-tertiary)]">{action.description}</span>
            </span>
          </button>
        ))}

        {loading && entries.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">{t('fileSearch.searching')}</div>
        ) : (errorKey || errorMessage) ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--color-error)]">
            {errorKey ? t(errorKey) : errorMessage}
          </div>
        ) : showEmptyState ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--color-text-tertiary)]">
            {!canBrowseFiles && enableFileSearch
              ? t('fileSearch.noDirectory')
              : filter ? t('fileSearch.noMatch') : t('fileSearch.noFiles')}
          </div>
        ) : (
          <>
            {/* Directories */}
            {dirs.map((entry, i) => {
              const idx = visibleActions.length + i
              return (
              <button
                key={entry.path}
                data-index={idx}
                onClick={() => {
                  void loadDir(entry.path, filter)
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                  selectedIndex === idx ? 'bg-[var(--color-surface-hover)]' : 'hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <FolderLineIcon size={16} className="text-[var(--color-brand)]" />
                <span className="text-sm text-[var(--color-text-primary)] truncate">{entry.name}</span>
              </button>
              )
            })}

            {/* Files */}
            {files.map((entry, i) => {
              const idx = visibleActions.length + dirs.length + i
              return (
                <button
                  key={entry.path}
                  data-index={idx}
                  onClick={() => onSelect(entry.path, entry.name, { type: 'file' })}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                    selectedIndex === idx ? 'bg-[var(--color-surface-hover)]' : 'hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  <FileLineIcon size={16} className="text-[var(--color-text-secondary)]" />
                  <span className="text-sm text-[var(--color-text-primary)] truncate">{entry.name}</span>
                </button>
              )
            })}
          </>
        )}
      </div>

      {/* Footer hint */}
      <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-3 py-1.5 text-[10px] text-[var(--color-text-tertiary)]">
        <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1 py-0.5 font-mono">↑↓</kbd>
        <span>{t('fileSearch.navigate')}</span>
        <kbd className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1 py-0.5 font-mono">Enter</kbd>
        <span>{t('common.select')}</span>
        <kbd className="ml-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-1 py-0.5 font-mono">Esc</kbd>
        <span>{t('fileSearch.close')}</span>
      </div>
    </div>
  )
})

FileSearchMenu.displayName = 'FileSearchMenu'
