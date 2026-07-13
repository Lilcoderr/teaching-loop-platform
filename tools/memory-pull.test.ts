import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  assertMemoryOutputDirectory,
  buildExportFileName,
  safeFileComponent,
} from './memory-pull'

describe('memory pull path safety', () => {
  it('accepts only the dedicated memory-bank export directory', () => {
    const expected = resolve('..', 'memory-bank', '网站同步')
    expect(assertMemoryOutputDirectory(expected)).toBe(expected)
    expect(() => assertMemoryOutputDirectory(resolve('..', 'memory-bank'))).toThrow(/网站同步/)
  })

  it('removes path control characters from server-provided names', () => {
    expect(safeFileComponent('../学生A:数学')).toBe('.._学生A_数学')
    const name = buildExportFileName('student/1', '../学生A', '2026-07-12T10:20:30.000Z')
    expect(name).not.toMatch(/[\\/:*?"<>|]/)
    expect(name.endsWith('.md')).toBe(true)
  })
})
