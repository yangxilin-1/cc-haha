import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { ToolRuntime } from '../runtime/ToolRuntime.js'

describe('ToolRuntime', () => {
  let tmpDir: string
  let runtime: ToolRuntime
  let signal: AbortSignal

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ycode-tool-runtime-'))
    runtime = new ToolRuntime()
    signal = new AbortController().signal
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('returns metadata for read and edit tools', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), 'hello\nworld\n', 'utf-8')

    const read = await runtime.execute('read_file', { file_path: 'README.md' }, {
      sessionId: 'session-1',
      workDir: tmpDir,
      signal,
    })
    expect(read.isError).toBeUndefined()
    expect(read.metadata).toMatchObject({
      filePath: 'README.md',
      lines: 3,
    })
    expect(read.metadata?.durationMs).toBeGreaterThanOrEqual(0)

    const edit = await runtime.execute('edit_file', {
      file_path: 'README.md',
      old_string: 'hello',
      new_string: 'hi',
    }, {
      sessionId: 'session-1',
      workDir: tmpDir,
      signal,
    })
    expect(edit.isError).toBeUndefined()
    expect(edit.content).toContain('1 replacement')
    expect(edit.metadata).toMatchObject({
      filePath: 'README.md',
      occurrences: 1,
      summary: '1 replacement',
    })
  })

  test('exposes the desktop-native agent tool', () => {
    const definitions = runtime.getDefinitions()

    expect(definitions.map((tool) => tool.name)).toContain('agent')
    expect(runtime.getRisk('agent')).toBe('write')
  })

  test('blocks project path escapes', async () => {
    await fs.writeFile(path.join(tmpDir, 'outside.txt'), 'secret', 'utf-8')
    const projectDir = path.join(tmpDir, 'project')
    await fs.mkdir(projectDir)

    const result = await runtime.execute('read_file', { file_path: '../outside.txt' }, {
      sessionId: 'session-1',
      workDir: projectDir,
      signal,
    })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Path escapes the project workspace')
    expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('applies unified diff patches across multiple files atomically', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), 'hello\nworld\n', 'utf-8')

    const patch = [
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1,2 +1,2 @@',
      ' hello',
      '-world',
      '+desktop',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+export const value = 1',
      '+',
      '',
    ].join('\n')

    const result = await runtime.execute('apply_patch', { patch }, {
      sessionId: 'session-1',
      workDir: tmpDir,
      signal,
    })

    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('Applied patch to 2 files')
    expect(result.metadata).toMatchObject({
      files: ['README.md', 'src/new.ts'],
      additions: 3,
      deletions: 1,
    })
    expect(result.metadata?.patch?.files).toEqual([
      expect.objectContaining({
        path: 'README.md',
        operation: 'modify',
        additions: 1,
        deletions: 1,
      }),
      expect.objectContaining({
        path: 'src/new.ts',
        operation: 'create',
        additions: 2,
        deletions: 0,
        beforeSha256: null,
      }),
    ])
    expect(result.metadata?.patch?.forwardPatch).toBe(patch)
    expect(result.metadata?.patch?.reversePatch).toContain('--- a/README.md')
    expect(result.metadata?.patch?.reversePatch).toContain('+++ /dev/null')
    await expect(fs.readFile(path.join(tmpDir, 'README.md'), 'utf-8')).resolves.toBe('hello\ndesktop\n')
    await expect(fs.readFile(path.join(tmpDir, 'src', 'new.ts'), 'utf-8')).resolves.toBe('export const value = 1\n')

    const rollback = await runtime.execute('apply_patch', {
      patch: result.metadata?.patch?.reversePatch,
    }, {
      sessionId: 'session-1',
      workDir: tmpDir,
      signal,
    })
    expect(rollback.isError).toBeUndefined()
    await expect(fs.readFile(path.join(tmpDir, 'README.md'), 'utf-8')).resolves.toBe('hello\nworld\n')
    await expect(fs.access(path.join(tmpDir, 'src', 'new.ts'))).rejects.toThrow()
  })

  test('does not write partial patch results when a later hunk fails', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), 'hello\nworld\n', 'utf-8')
    await fs.writeFile(path.join(tmpDir, 'other.md'), 'real\n', 'utf-8')

    const patch = [
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1,2 +1,2 @@',
      ' hello',
      '-world',
      '+desktop',
      '--- a/other.md',
      '+++ b/other.md',
      '@@ -1,1 +1,1 @@',
      '-missing',
      '+changed',
      '',
    ].join('\n')

    const result = await runtime.execute('apply_patch', { patch }, {
      sessionId: 'session-1',
      workDir: tmpDir,
      signal,
    })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Patch failed for other.md')
    await expect(fs.readFile(path.join(tmpDir, 'README.md'), 'utf-8')).resolves.toBe('hello\nworld\n')
    await expect(fs.readFile(path.join(tmpDir, 'other.md'), 'utf-8')).resolves.toBe('real\n')
  })

  test('blocks patch paths that escape the project workspace', async () => {
    const patch = [
      '--- /dev/null',
      '+++ b/../outside.txt',
      '@@ -0,0 +1,1 @@',
      '+outside',
      '',
    ].join('\n')

    const result = await runtime.execute('apply_patch', { patch }, {
      sessionId: 'session-1',
      workDir: tmpDir,
      signal,
    })

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Path escapes the project workspace')
  })

  test('returns command exit metadata', async () => {
    if (process.platform === 'win32') {
      return
    }

    const command = process.platform === 'win32'
      ? 'Write-Output ycode'
      : 'printf ycode'

    const result = await runtime.execute('run_command', { command }, {
      sessionId: 'session-1',
      workDir: tmpDir,
      signal,
    })

    expect(result.isError).toBe(false)
    expect(result.content).toContain('exit code: 0')
    expect(result.content).toContain('ycode')
    expect(result.metadata).toMatchObject({
      exitCode: 0,
      summary: 'Exit 0',
      timedOut: false,
      outputTruncated: false,
    })
  })
})
