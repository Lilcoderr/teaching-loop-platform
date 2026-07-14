import { describe, expect, it } from 'vitest'
import {
  resolveAnswerMode,
  safeLevelAnswer,
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
