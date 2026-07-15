import { describe, expect, it } from 'vitest'
import {
  buildSafeSourceAnchors,
  buildTutorRetrievalPromptBlock,
  resolveAnswerMode,
  safeLevelAnswer,
  safeTutorCitationMetadata,
  sanitizeTutorSourceLabel,
  selectRelevantChunks,
  selectRelevantWrongItems,
  TUTOR_FOCUS_CODES,
  tutorCitationMetadata,
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

  it('renders every focus code in every lower mode using distinct server-owned templates', () => {
    for (const level of ['diagnose', 'hint', 'key_step'] as const) {
      const answers = TUTOR_FOCUS_CODES.map((focus) => safeLevelAnswer(
        level,
        JSON.stringify({ scaffold: 'unclear', focusCodes: [focus] }),
        false,
      ))
      expect(new Set(answers).size).toBe(TUTOR_FOCUS_CODES.length)
      for (const [index, answer] of answers.entries()) {
        expect(answer).not.toContain(TUTOR_FOCUS_CODES[index])
        expect(answer).not.toContain('focusCodes')
      }
    }
  })

  it('combines a whitelisted scaffold and at most two whitelisted focus codes', () => {
    const conditions = safeLevelAnswer(
      'hint',
      JSON.stringify({ scaffold: 'conditions', focusCodes: ['extract_conditions'] }),
      false,
    )
    const calculation = safeLevelAnswer(
      'hint',
      JSON.stringify({ scaffold: 'calculation', focusCodes: ['audit_last_step', 'verify_constraints'] }),
      false,
    )
    expect(conditions).toContain('显式条件')
    expect(conditions).toContain('隐藏限制')
    expect(calculation).toContain('等价步骤')
    expect(calculation).toContain('最后一个确认正确的步骤')
    expect(calculation).toContain('定义域、范围、单位')
    expect(conditions).not.toBe(calculation)
  })

  it('personalizes a lower mode only through a server-whitelisted source anchor', () => {
    const anchors = buildSafeSourceAnchors([
      { id: 'k1', labels: ['椭圆切线', '解析几何讲义'], sourceType: 'lecture' },
      { id: 'w1', labels: ['焦点弦', '历史错题'], sourceType: 'wrong_item' },
    ])
    const answer = safeLevelAnswer(
      'hint',
      JSON.stringify({
        scaffold: 'method',
        anchorId: 'w1',
        focusCodes: ['transfer_source'],
      }),
      true,
      anchors,
    )
    expect(answer).toContain('优先参考「已确认错题 1」')
    expect(answer).toContain('资料方法的适用条件')
    expect(answer).not.toContain('椭圆切线')
  })

  it('keeps no-source AI classification useful without accepting model prose', () => {
    const answer = safeLevelAnswer(
      'hint',
      JSON.stringify({ scaffold: 'relation', focusCodes: ['work_backward'] }),
      false,
    )
    expect(answer).toContain('只建立一条连接已知与目标的关系')
    expect(answer).toContain('从目标量倒推一个必要的中间关系')
    expect(answer).not.toContain('已找到与你的问题相关')
  })

  it('uses only a safe generic template when sources matched but no safe anchor exists', () => {
    const answer = safeLevelAnswer(
      'hint',
      JSON.stringify({ scaffold: 'relation', focusCodes: ['work_backward'] }),
      true,
      [],
    )
    expect(answer).toContain('已找到与你的问题相关')
    expect(answer).toContain('从目标量倒推一个必要的中间关系')
    expect(answer).not.toContain('优先参考「')
  })

  it('never echoes a forged anchor, prose field, or answer field', () => {
    const anchors = buildSafeSourceAnchors([
      { id: 'k1', labels: ['椭圆切线'], sourceType: 'lecture' },
    ])
    const forged = safeLevelAnswer(
      'key_step',
      JSON.stringify({
        scaffold: 'relation',
        anchorId: '伪造来源：x=2',
        focusCodes: ['work_backward'],
        answer: '选择 B',
      }),
      true,
      anchors,
    )
    expect(forged).toContain('优先参考「讲义方法 1」')
    expect(forged).not.toMatch(/伪造来源|x=2|选择\s*B/)

    const unknownId = safeLevelAnswer(
      'diagnose',
      JSON.stringify({ scaffold: 'conditions', anchorId: 'k99', focusCodes: ['extract_conditions'] }),
      true,
      anchors,
    )
    expect(unknownId).toContain('优先参考「讲义方法 1」')
    expect(unknownId).not.toContain('k99')

    const missingId = safeLevelAnswer(
      'hint',
      JSON.stringify({ scaffold: 'relation', focusCodes: ['work_backward'] }),
      true,
      anchors,
    )
    expect(missingId).toContain('优先参考「讲义方法 1」')
    expect(missingId).not.toContain('从目标量倒推一个必要的中间关系')
  })

  it.each([
    '正确选项应取 C',
    '本题取 C 项',
    '保留 C 项',
    '参数范围 (-1,2)',
    '取值范围锁定在((-1,2))',
    '确定 x>2',
    '圆的半径取二',
    '半径为 π',
    '斜率为 √2',
    '参数可取任意实数',
    '唯一符合条件的是第三个',
  ])('rejects model prose even when it avoids common answer keywords: %s', (unsafeProse) => {
    const answer = safeLevelAnswer(
      'hint',
      JSON.stringify({ scaffold: 'method', focusCodes: ['compare_methods'], guidance: unsafeProse }),
      false,
    )
    expect(answer).not.toContain(unsafeProse)
  })

  it.each([
    { scaffold: 'relation' },
    { scaffold: 'relation', focusCodes: [] },
    { scaffold: 'relation', focusCodes: ['work_backward', 'audit_last_step', 'verify_constraints'] },
    { scaffold: 'relation', focusCodes: ['work_backward', 'work_backward'] },
    { scaffold: 'relation', focusCodes: ['invented'] },
    { scaffold: 'relation', focusCodes: 'work_backward' },
    { scaffold: 'relation', focusCodes: ['work_backward'], answer: 'x=2' },
  ])('rejects malformed or expanded lower-mode JSON: %j', (payload) => {
    const answer = safeLevelAnswer('hint', JSON.stringify(payload), false)
    expect(answer).not.toContain('从目标量倒推一个必要的中间关系')
    expect(answer).not.toMatch(/x=2|invented|focusCodes/)
  })

  it('does not return any raw free-form model text in a lower mode', () => {
    for (const unsafeAnswer of [
      '先建立方程，再检查定义域。',
      '正确选项应取 C。',
      '取值范围锁定在((-1,2))。',
      '先代入得到 \\(x^2-3x+2=0\\)，然后继续计算。',
    ]) {
      for (const level of ['diagnose', 'hint', 'key_step'] as const) {
        expect(safeLevelAnswer(level, unsafeAnswer, false)).not.toContain(unsafeAnswer)
      }
    }
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
    '正确选项应取 C',
    '本题取 C 项',
    '保留 C 项',
    '参数范围 (-1,2)',
    '取值范围锁定在((-1,2))',
    '确定 x>2',
    '圆的半径取二',
    'C 项正确',
    'x ∈ {1,2}',
    'x 不小于 2',
    '参数取负一',
    String.raw`\\frac{1}{2}`,
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
    expect(anchors).toEqual([{ id: 'k1', label: '讲义方法 1', sourceType: 'lecture' }])
  })

  it('replaces answer-shaped citation metadata with server-owned labels', () => {
    expect(safeTutorCitationMetadata(
      '答案为 x=2',
      '最终结果：2',
      '已学资料 1',
      '相关章节',
    )).toEqual({ label: '已学资料 1', section: '相关章节' })
    expect(safeTutorCitationMetadata(
      '圆的半径为 2',
      '斜率等于 -1',
      '已学资料 2',
      '相关章节',
    )).toEqual({ label: '已学资料 2', section: '相关章节' })
    expect(safeTutorCitationMetadata(
      '<b>椭圆讲义</b>',
      '**切线方法**',
      '已学资料 1',
      '相关章节',
    )).toEqual({ label: '椭圆讲义', section: '切线方法' })
  })

  it.each([
    '正确选项应取 C',
    '本题取 C 项',
    '保留 C 项',
    '参数范围 (-1,2)',
    '取值范围锁定在((-1,2))',
    '确定 x>2',
    '圆的半径取二',
    '半径为 π',
    '斜率为 √2',
    '参数可取任意实数',
    '唯一符合条件的是第三个',
  ])('never exposes an answer-shaped lower-mode citation field: %s', (unsafeMetadata) => {
    expect(tutorCitationMetadata(
      'key_step', unsafeMetadata, unsafeMetadata, '已学资料 1', '相关章节',
    )).toEqual({ label: '已学资料 1', section: '相关章节' })
  })

  it('preserves raw citation metadata only for a complete solution', () => {
    const unsafeLabel = '答案为 x=2'
    const unsafeSection = '最终结果：2'
    expect(tutorCitationMetadata(
      'hint', unsafeLabel, unsafeSection, '已学资料 1', '相关章节',
    )).toEqual({ label: '已学资料 1', section: '相关章节' })
    expect(tutorCitationMetadata(
      'hint', '椭圆讲义', '切线方法', '已学资料 1', '相关章节',
    )).toEqual({ label: '已学资料 1', section: '相关章节' })
    expect(tutorCitationMetadata(
      'solution', unsafeLabel, unsafeSection, '已学资料 1', '相关章节',
    )).toEqual({ label: unsafeLabel, section: unsafeSection })
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
      expect(block).toContain('[m1] method: 方法技巧 1')
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
