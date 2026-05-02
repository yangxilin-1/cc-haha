import type { BaselineCase } from '../types'

export const baselineCases: BaselineCase[] = [
  {
    id: 'failing-unit',
    title: 'Fix a failing unit test',
    description: 'A tiny TypeScript project has a broken arithmetic function. The Agent must inspect the failing test, patch the implementation, and rerun the test.',
    fixture: 'scripts/quality-gate/baseline/fixtures/failing-unit',
    prompt: 'Run the tests, inspect the failing assertion, fix the implementation bug, and rerun the tests until they pass. Only modify the fixture source files needed for the fix.',
    mode: 'websocket',
    requiredCapabilities: ['model', 'file-edit', 'shell'],
    timeoutMs: 180_000,
    verify: {
      commands: [['bun', 'test']],
      expectedFiles: ['src/math.ts'],
      forbiddenFiles: ['package.json'],
      transcriptAssertions: ['bun test', 'src/math.ts'],
    },
  },
  {
    id: 'multi-file-api',
    title: 'Update a multi-file API contract',
    description: 'A small app exposes a user display API. The Agent must change the contract and update callers plus tests coherently.',
    fixture: 'scripts/quality-gate/baseline/fixtures/multi-file-api',
    prompt: 'Change the user display contract so it returns "Ada Lovelace <ada@example.com>" instead of only the name. Update the implementation, caller, and tests, then run the tests.',
    mode: 'websocket',
    requiredCapabilities: ['model', 'file-edit', 'shell'],
    timeoutMs: 240_000,
    verify: {
      commands: [['bun', 'test']],
      expectedFiles: ['src/api.ts', 'src/app.ts', 'src/app.test.ts'],
      forbiddenFiles: ['package.json'],
      transcriptAssertions: ['bun test', 'src/api.ts', 'src/app.ts'],
    },
  },
]

export function validateBaselineCases(cases = baselineCases) {
  const ids = new Set<string>()

  for (const testCase of cases) {
    if (ids.has(testCase.id)) {
      throw new Error(`Duplicate baseline case id: ${testCase.id}`)
    }
    ids.add(testCase.id)

    if (!testCase.fixture) {
      throw new Error(`Baseline case ${testCase.id} is missing a fixture`)
    }
    if (testCase.verify.commands.length === 0) {
      throw new Error(`Baseline case ${testCase.id} is missing verification commands`)
    }
    if (testCase.timeoutMs < 30_000) {
      throw new Error(`Baseline case ${testCase.id} timeout is too low`)
    }
  }
}
