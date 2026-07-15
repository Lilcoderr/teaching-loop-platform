import { describe, expect, it } from 'vitest'
import {
  buildSafeSourceAnchors,
  buildTutorRetrievalPromptBlock,
  resolveAnswerMode,
  safeLevelAnswer,
  sanitizeTutorSourceLabel,
  selectRelevantChunks,
  selectRelevantWrongItems,
  validateTutorImage,
} from '../../supabase/functions/tutor-chat/logic'

function dataUrl(mimeType: string, bytes: number[]) {
  return `data:${mimeType};base64,${btoa(String.fromCharCode(...bytes))}`
}

describe('tutor answer modes', () => {
  it('maps the four explicit UI modes to stored hint levels', () => {
    expect(resolveAnswerMode('diagnose', undefined)).toEqual({ answerMode: 'diagnose', hintLevel: 'diagnose' })
    expect(resolveAnswerMode('hint', undefined)).toEqual({ answerMode: 'hint', hintLevel: 'hint' })
    expect(resolveAnswerMode('steps', undefined)).toEqual({ answerMode: 'steps', hintLevel: 'key_step' })
    expect(resolveAnswerMode('solution', undefined)).toEqual({ answerMode: 'solution', hintLevel: 'solution' })
  })

  it('keeps legacy key_step requests compatible but rejects unknown modes', () => {
    expect(resolveAnswerMode(undefined, 'key_step')).toEqual({ answerMode: 'steps', hintLevel: 'key_step' })
    expect(resolveAnswerMode('override', 'hint')).toBeNull()
  })

  it('replaces an accidental full solution in a lower mode', () => {
    expect(safeLevelAnswer('hint', '完整解答如下：第一步……', false)).not.toContain('完整解答如下')
  })

  it('only accepts a whitelisted scaffold selection in lower modes', () => {
    const modelSelection = JSON.stringify({ scaffold: 'relation' })
    expect(safeLevelAnswer('diagnose', modelSelection, false)).toContain('设什么量')
    expect(safeLevelAnswer('hint', modelSelection, false)).toContain('只建立一条')
    expect(safeLevelAnswer('key_step', modelSelection, false)).toContain('必要未知量')
    expect(safeLevelAnswer('hint', JSON.stringify({ scaffold: 'invented', answer: '2' }), false)).not.toContain('2')
    expect(safeLevelAnswer('hint', JSON.stringify({ scaffold: 'relation', answer: 'x=2，选择 B' }), false)).not.toMatch(/x=2|选择\s*B/)
  })

  it('does not return otherwise normal free-form hints in a locked lower mode', () => {
    const steps = '先建立方程，再检查定义域。'
    expect(safeLevelAnswer('key_step', steps, false)).not.toBe(steps)
    expect(safeLevelAnswer('key_step', '最终答案为 2。', false)).not.toContain('最终答案')
    expect(safeLevelAnswer('diagnose', steps, false)).not.toBe(steps)
  })

  it('keeps lower-mode personalization through the selected learning stage', () => {
    const conditions = safeLevelAnswer('hint', JSON.stringify({ scaffold: 'conditions' }), false)
    const calculation = safeLevelAnswer('hint', JSON.stringify({ scaffold: 'calculation' }), false)
    expect(conditions).toContain('显式条件')
    expect(calculation).toContain('等价步骤')
    expect(conditions).not.toBe(calculation)
  })

  it('personalizes a locked lower mode with a server-whitelisted source anchor', () => {
    const anchors = buildSafeSourceAnchors([
      { id: 'k1', labels: ['椭圆切线', '解析几何讲义'], sourceType: 'lecture' },
      { id: 'w1', labels: ['焦点弦', '历史错题'], sourceType: 'wrong_item' },
    ])
    const answer = safeLevelAnswer(
      'hint',
      JSON.stringify({ scaffold: 'method', anchorId: 'w1' }),
      true,
      anchors,
    )
    expect(answer).toContain('优先参考「焦点弦」')
    expect(answer).toContain('核对它的使用条件')
    expect(answer).not.toContain('椭圆切线')
  })

  it('never echoes a forged anchor or extra answer field', () => {
    const anchors = buildSafeSourceAnchors([
      { id: 'k1', labels: ['椭圆切线'], sourceType: 'lecture' },
    ])
    const forged = safeLevelAnswer(
      'key_step',
      JSON.stringify({ scaffold: 'relation', anchorId: '伪造来源：x=2', answer: '选择 B' }),
      true,
      anchors,
    )
    expect(forged).toContain('优先参考「椭圆切线」')
    expect(forged).not.toMatch(/伪造来源|x=2|选择\s*B/)

    const unknownId = safeLevelAnswer(
      'diagnose',
      JSON.stringify({ scaffold: 'conditions', anchorId: 'k99' }),
      true,
      anchors,
    )
    expect(unknownId).toContain('优先参考「椭圆切线」')
    expect(unknownId).not.toContain('k99')
  })

  it.each([
    '2',
    'x = 2。',
    '选择 B。',
    '由方程可得：\\\\boxed{2}',
    'The answer is B.',
    '计算后解得 x=2，因此答案完成。',
  ])('blocks a bare or disguised final result in every lower mode: %s', (unsafeAnswer) => {
    for (const level of ['diagnose', 'hint', 'key_step'] as const) {
      expect(safeLevelAnswer(level, unsafeAnswer, false)).not.toBe(unsafeAnswer)
    }
  })

  it('blocks a worked derivation without relying on final-answer keywords', () => {
    const derivation = '先代入得到 \\(x^2-3x+2=0\\)，化简得 \\(x^2=3x-2\\)，再移项 \\(x^2-3x=-2\\)，然后继续计算。'
    expect(safeLevelAnswer('hint', derivation, true)).toContain('已找到与你的问题相关的已学资料')
    expect(safeLevelAnswer('key_step', derivation, false)).not.toBe(derivation)
  })

  it('does not alter a complete solution when the server has unlocked solution mode', () => {
    const solution = '完整解答：由方程解得 \\(x=2\\)，所以最终答案为 2。'
    expect(safeLevelAnswer('solution', solution, false)).toBe(solution)
  })
})

describe('safe tutor source metadata', () => {
  it('removes markup and control characters from student-visible labels', () => {
    const sanitized = sanitizeTutorSourceLabel('<b>椭圆</b>\n**切线方法**\u200b')
    expect(sanitized).toBe('椭圆 切线方法')
    expect(sanitized).not.toMatch(/[<>*\n]/)
  })

  it.each([
    '答案为 x=2',
    '最终结果：2',
    '由方程解得两个根',
    '本题故选 B',
    '半径=2',
    String.raw`结果为 \\boxed{2}`,
  ])('rejects answer-shaped metadata: %s', (label) => {
    expect(sanitizeTutorSourceLabel(label)).toBeNull()
  })

  it('uses a safe fallback label and rejects invalid or duplicate ephemeral ids', () => {
    const anchors = buildSafeSourceAnchors([
      { id: 'k1', labels: ['答案为 x=2', '圆锥曲线方法'], sourceType: 'lecture' },
      { id: 'k1', labels: ['重复来源'], sourceType: 'exercise' },
      { id: 'database-row-id', labels: ['不应暴露'], sourceType: 'wrong_item' },
    ])
    expect(anchors).toEqual([{ id: 'k1', label: '圆锥曲线方法', sourceType: 'lecture' }])
  })

  it('lets the model classify against authorized source bodies while keeping lower-mode output locked', () => {
    const anchors = buildSafeSourceAnchors([
      { id: 'm1', labels: ['椭圆切线'], sourceType: 'method' },
    ])
    const sensitive = [
      '讲义正文：先使用切线公式。',
      '教师提醒：学生上次在这里算错。',
      '错题题面：已知椭圆方程……',
    ]
    for (const level of ['diagnose', 'hint', 'key_step'] as const) {
      const block = buildTutorRetrievalPromptBlock(level, anchors, sensitive)
      expect(block).toContain('<authorized_retrieval_metadata>')
      expect(block).toContain('[m1] method: 椭圆切线')
      expect(block).toContain('<untrusted_authorized_retrieval_context>')
      for (const line of sensitive) expect(block).toContain(line)
    }
    const solutionBlock = buildTutorRetrievalPromptBlock('solution', anchors, sensitive)
    expect(solutionBlock).toContain('<authorized_retrieval_context>')
    for (const line of sensitive) expect(solutionBlock).toContain(line)
  })
})

describe('tutor image validation', () => {
  it('accepts one genuine JPEG data URL', () => {
    const bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]
    const result = validateTutorImage({
      dataUrl: dataUrl('image/jpeg', bytes),
      mimeType: 'image/jpeg',
      name: 'question.jpg',
      size: bytes.length,
    })
    expect(result.error).toBeUndefined()
    expect(result.image?.mimeType).toBe('image/jpeg')
  })

  it('rejects arrays, MIME mismatches, and forged file content', () => {
    expect(validateTutorImage([]).error).toBeTruthy()
    expect(validateTutorImage({
      dataUrl: dataUrl('image/png', [0x89, 0x50, 0x4e, 0x47]),
      mimeType: 'image/jpeg',
      size: 4,
    }).error).toContain('不匹配')
    expect(validateTutorImage({
      dataUrl: dataUrl('image/png', [0x00, 0x00, 0x00, 0x00]),
      mimeType: 'image/png',
      size: 4,
    }).error).toContain('内容无效')
  })
})

describe('reliable tutor retrieval', () => {
  const relatedChunk = {
    score: 0.16,
    title: '圆锥曲线讲义',
    heading: '椭圆切线',
    content: '椭圆切线问题先验证切点，再使用切线方程。',
  }
  const unrelatedChunk = {
    score: 0.18,
    title: '数列复习',
    heading: '等差数列',
    content: '使用通项公式和前 n 项和公式。',
  }

  it('keeps lexically relevant teacher material', () => {
    expect(selectRelevantChunks([unrelatedChunk, relatedChunk], '椭圆切线应该如何处理', false))
      .toEqual([relatedChunk])
  })

  it('does not treat weak semantic or trigram similarity as a source match', () => {
    expect(selectRelevantChunks([unrelatedChunk], '椭圆离心率怎么求', true)).toEqual([])
  })

  it('accepts a strong semantic match when wording differs', () => {
    const semanticMatch = { ...unrelatedChunk, score: 0.31 }
    expect(selectRelevantChunks([semanticMatch], '圆锥曲线参数范围', true)).toEqual([semanticMatch])
  })

  it('only includes verified wrong-item candidates related to the current question', () => {
    const ellipseMistake = { title: '椭圆焦点弦', question_text: '求椭圆离心率', knowledge_points: ['椭圆'], teacher_note: '注意焦点位置' }
    const sequenceMistake = { title: '等差数列', question_text: '求前 n 项和', knowledge_points: ['数列'], teacher_note: '检查下标' }
    expect(selectRelevantWrongItems([sequenceMistake, ellipseMistake], '椭圆离心率如何计算'))
      .toEqual([ellipseMistake])
  })
})
