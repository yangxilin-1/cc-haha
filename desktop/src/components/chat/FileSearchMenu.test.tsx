import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { FileSearchMenu } from './FileSearchMenu'
import { ApiError } from '../../api/client'
import { filesystemApi } from '../../api/filesystem'

vi.mock('../../api/filesystem', () => ({
  filesystemApi: {
    browse: vi.fn(),
    search: vi.fn(),
  },
}))

describe('FileSearchMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows an explicit error when directory browsing is denied', async () => {
    vi.mocked(filesystemApi.browse).mockRejectedValueOnce(
      new ApiError(403, { error: 'Access denied: path outside allowed directory' }),
    )

    render(
      <FileSearchMenu
        cwd="/private/tmp"
        onSelect={() => {}}
      />,
    )

    expect(await screen.findByText('Cannot access this directory')).toBeInTheDocument()
    expect(screen.queryByText('No files in this directory')).not.toBeInTheDocument()
  })

  it('renders returned files when browsing succeeds', async () => {
    vi.mocked(filesystemApi.browse).mockResolvedValueOnce({
      currentPath: '/tmp',
      parentPath: '/',
      entries: [
        { name: 'preview.png', path: '/tmp/preview.png', isDirectory: false },
      ],
    })

    render(
      <FileSearchMenu
        cwd="/tmp"
        onSelect={() => {}}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('preview.png')).toBeInTheDocument()
    })
  })

  it('renders action mentions without browsing the filesystem', () => {
    const onSelect = vi.fn()

    render(
      <FileSearchMenu
        cwd=""
        enableFileSearch={false}
        actions={[{
          id: 'computer-use',
          label: 'Computer Use',
          description: 'Control local apps',
          insertText: 'Computer Use',
        }]}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByText('Computer Use')).toBeInTheDocument()
    expect(filesystemApi.browse).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Computer Use'))
    expect(onSelect).toHaveBeenCalledWith('', 'Computer Use', {
      type: 'action',
      id: 'computer-use',
    })
  })
})
