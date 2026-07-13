import { describe, expect, it } from 'vitest'

import { parseQuestionBankMarkdown } from './question-bank-import'

const metadata = `- 状态：题面、官方答案均已复核
- 试卷：浙江省测试卷
- 题号：第 18 题
- 题面页：原卷 PDF 第 4 页
- 答案页：答案 PDF 第 2 页
- 原卷：\`题库/测试卷.pdf\`
- 答案：\`题库/测试卷答案.pdf\`
- 考点：椭圆、韦达定理
- 难度：中等`

describe('question bank Markdown parser', () => {
  it('imports only a fully verified entry and preserves source fields', () => {
    const parsed = parseQuestionBankMarkdown({
      source: `# 解析几何\n\n## ZJ2026-TEST-18\n\n${metadata}\n\n### 题目\n\n完整题面。\n\n### 官方答案整理\n\n完整官方答案。`,
      sourceRelativePath: '题库/数学/解析几何/测试.md',
      subject: 'math',
      topic: '解析几何',
    })
    expect(parsed.errors).toEqual([])
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]).toMatchObject({
      externalId: 'ZJ2026-TEST-18',
      paperName: '浙江省测试卷',
      originalFile: '题库/测试卷.pdf',
      answerPage: '答案 PDF 第 2 页',
      verified: true,
    })
    expect(parsed.items[0].questionText).toContain('完整题面')
    expect(parsed.items[0].officialAnswer).toContain('完整官方答案')
  })

  it('skips entries whose official answer has not been transcribed', () => {
    const parsed = parseQuestionBankMarkdown({
      source:
        '# 解析几何\n\n## SD2026-PENDING-18\n\n- 状态：题面和答案页已复核；答案尚未转录\n\n### 题目\n\n题面。',
      sourceRelativePath: '待整理.md',
      subject: 'math',
      topic: '解析几何',
    })
    expect(parsed.items).toEqual([])
    expect(parsed.skipped).toHaveLength(1)
    expect(parsed.errors).toEqual([])
  })

  it('rejects a verified entry with incomplete provenance', () => {
    const parsed = parseQuestionBankMarkdown({
      source:
        '# 解析几何\n\n## ZJ2026-BROKEN-18\n\n- 状态：题面、官方答案均已复核\n\n### 题目\n\n题面。\n\n### 官方答案整理\n\n答案。',
      sourceRelativePath: '错误.md',
      subject: 'math',
      topic: '解析几何',
    })
    expect(parsed.items).toEqual([])
    expect(parsed.errors[0].reason).toContain('缺少')
  })
})
