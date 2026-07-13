import { describe, expect, it } from 'vitest'

import {
  choosePreferredFiles,
  createSyncPlan,
  inferDocumentPolicy,
  KnowledgeSyncConfigSchema,
  parseHtmlDocument,
  parseMarkdownDocument,
  type KnowledgeDocumentPayload,
  type KnowledgeSyncState,
} from './knowledge-sync'

function document(externalId: string, contentHash: string): KnowledgeDocumentPayload {
  return {
    externalId,
    studentId: 'student-1',
    subject: 'math',
    title: '测试讲义',
    documentType: 'lecture',
    visibility: 'student_visible',
    relativePath: `学生/数学/${externalId}.md`,
    contentHash,
    sourceModifiedAt: '2026-07-12T00:00:00.000Z',
    chunks: [],
  }
}

describe('knowledge sync parsing', () => {
  it('validates config and applies conservative defaults', () => {
    const parsed = KnowledgeSyncConfigSchema.parse({
      sources: [{ studentId: 'student-1', subject: 'math', root: '../学生A/数学' }],
    })
    expect(parsed.batchSize).toBe(20)
    expect(parsed.sources[0].defaultVisibility).toBe('teacher_only')
  })

  it('prefers Markdown over same-stem HTML', () => {
    expect(
      choosePreferredFiles([
        '第01次/讲义.html',
        '第01次/讲义.md',
        '第01次/教案.html',
      ]),
    ).toEqual(['第01次/讲义.md', '第01次/教案.html'])
  })

  it('builds heading-aware Markdown chunks and keeps LaTeX source', () => {
    const parsed = parseMarkdownDocument(
      '# 导数讲义\n\n## 单调性方法\n\n由 \\(f\'(x)>0\\) 可知函数递增。\n\n## 典例\n\n完整题目。',
      '讲义',
      500,
    )
    expect(parsed.title).toBe('导数讲义')
    expect(parsed.chunks.map((chunk) => chunk.section)).toContain('导数讲义 > 单调性方法')
    expect(parsed.chunks.some((chunk) => chunk.content.includes("\\(f'(x)>0\\)"))).toBe(true)
  })

  it('extracts semantic HTML sections without scripts', () => {
    const parsed = parseHtmlDocument(
      '<html><body><h1>解析几何</h1><h2>弦长</h2><p>联立后使用韦达定理。</p><script>secret()</script></body></html>',
      '讲义',
    )
    expect(parsed.title).toBe('解析几何')
    expect(parsed.chunks.some((chunk) => chunk.section === '解析几何 > 弦长')).toBe(true)
    expect(parsed.chunks.every((chunk) => !chunk.content.includes('secret'))).toBe(true)
  })

  it('maps document names to the required visibility gates', () => {
    expect(
      inferDocumentPolicy('第01次/题目与解析.md', {
        documentType: 'lesson_plan',
        visibility: 'teacher_only',
      }),
    ).toEqual({ documentType: 'solution', visibility: 'solution_gated' })
    expect(
      inferDocumentPolicy('第01次/教案.html', {
        documentType: 'lecture',
        visibility: 'student_visible',
      }),
    ).toEqual({ documentType: 'lesson_plan', visibility: 'teacher_only' })
  })
})

describe('knowledge sync incremental plan', () => {
  it('upserts changed documents and deactivates removed documents', () => {
    const state: KnowledgeSyncState = {
      version: 1,
      documents: {
        current: {
          contentHash: 'old-hash',
          relativePath: 'old.md',
          active: true,
          syncedAt: '2026-07-11T00:00:00.000Z',
        },
        removed: {
          contentHash: 'removed-hash',
          relativePath: 'removed.md',
          active: true,
          syncedAt: '2026-07-11T00:00:00.000Z',
        },
      },
    }
    const plan = createSyncPlan([document('current', 'new-hash')], state)
    expect(plan.upserts.map((item) => item.externalId)).toEqual(['current'])
    expect(plan.deactivations).toEqual(['removed'])
    expect(plan.unchanged).toHaveLength(0)
  })
})
