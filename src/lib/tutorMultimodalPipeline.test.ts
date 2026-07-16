import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildSafeSourceAnchors,
  buildTutorRetrievalPromptBlock,
} from '../../supabase/functions/tutor-chat/logic'

const tutorFunction = readFileSync('supabase/functions/tutor-chat/index.ts', 'utf8')
const modelAdapter = readFileSync('supabase/functions/_shared/model.ts', 'utf8')

describe('tutor multimodal pipeline', () => {
  it('uses one vision pass for transcription and a text pass for the final answer', () => {
    expect(tutorFunction.match(/kind:\s*'vision'/g)).toHaveLength(1)
    expect(tutorFunction).toContain("kind: 'text'")
    expect(tutorFunction).not.toContain("kind: image ? 'vision' : 'text'")
    expect(tutorFunction).toContain('<image_transcription>')
  })

  it('checks both model configurations before accepting an image request', () => {
    expect(tutorFunction).toContain("chatModelConfigured('text', settings.text_model)")
    expect(tutorFunction).toContain("chatModelConfigured('vision', visionModel)")
    expect(tutorFunction).toContain('图片答疑暂未启用，请先输入题目文字')
  })

  it('uses strict question-specific JSON schemas and withholds lower-mode source excerpts', () => {
    expect(tutorFunction).toContain('json: true')
    expect(tutorFunction).toContain('"blocker":"结合本题和学生尝试定位的具体卡点"')
    expect(tutorFunction).toContain('"hint":"针对本题条件、符号或图形关系的一级提示"')
    expect(tutorFunction).toContain('"steps":["关键步骤 1","关键步骤 2"]')
    expect(tutorFunction).not.toContain('所有学生可见文字都由服务端固定模板生成')
    expect(tutorFunction).toContain('maxOutputTokens: LEVEL_MAX_OUTPUT_TOKENS[hintLevel]')
    expect(tutorFunction).toContain("const exposeCitationExcerpt = hintLevel === 'solution'")
    expect(tutorFunction).toContain("excerpt: exposeCitationExcerpt ? chunk.content.slice(0, 500) : ''")
  })

  it('routes source context through validation and saves only model-declared whitelisted citations', () => {
    expect(tutorFunction).toContain('buildTutorRetrievalPromptBlock(hintLevel, sourceAnchors, contextLines)')
    expect(tutorFunction).toContain('validateTutorModelAnswer(hintLevel, modelResult.text, sourceAnchors)')
    expect(tutorFunction).toContain('usedSourceIds 只列出回答中实际使用的白名单来源 ID')
    expect(tutorFunction).toContain('.filter((citation) => usedSourceIds.has(citation.answerSourceId))')
    expect(tutorFunction).toContain("labels: [item.knowledge_points.join('、'), item.title]")
  })

  it('uses authorized source bodies for lower-level classification without unlocking free-form output', () => {
    const anchors = buildSafeSourceAnchors([
      { id: 'k1', labels: ['数列递推'], sourceType: 'lecture' },
      { id: 'w1', labels: ['递推关系'], sourceType: 'wrong_item' },
    ])
    const sourceBodies = [
      'RAW_KNOWLEDGE_CHUNK_CONTENT',
      'RAW_LEARNING_MATERIAL_BODY',
      'RAW_TEACHER_NOTE_AND_WRONG_ITEM_TEXT',
    ]
    for (const level of ['diagnose', 'hint', 'key_step'] as const) {
      const prompt = buildTutorRetrievalPromptBlock(level, anchors, sourceBodies)
      expect(prompt).toContain('[k1] lecture: 讲义方法 1')
      expect(prompt).toContain('[w1] wrong_item: 已确认错题 1')
      expect(prompt).toContain('<untrusted_authorized_retrieval_context>')
      for (const body of sourceBodies) expect(prompt).toContain(body)
    }
    expect(tutorFunction).toContain('json: true')
    expect(tutorFunction).toContain('validateTutorModelAnswer(hintLevel, modelResult.text, sourceAnchors)')
  })

  it('retains full authorized source context only for complete solutions', () => {
    const sourceBodies = ['FULL_LECTURE_BODY', 'FULL_TEACHER_NOTE']
    const prompt = buildTutorRetrievalPromptBlock('solution', [], sourceBodies)
    expect(prompt).toContain('<authorized_retrieval_context>')
    expect(prompt).toContain('FULL_LECTURE_BODY')
    expect(prompt).toContain('FULL_TEACHER_NOTE')
    expect(prompt).not.toContain('<authorized_retrieval_metadata>')
  })

  it('sanitizes lower-mode citation metadata while preserving raw solution metadata', () => {
    expect(tutorFunction.match(/tutorCitationMetadata\(/g)).toHaveLength(3)
    expect(tutorFunction).toContain('exposeCitationExcerpt ? chunk.heading || chunk.relative_path : chunk.heading')
    expect(tutorFunction).toContain('exposeCitationExcerpt ? item.teacher_note : `错题 ${item.question_number}`')
  })

  it('falls back to typed text when image transcription fails, but retries image-only requests', () => {
    expect(tutorFunction).toContain("message === '请分析这张题目图片'")
    expect(tutorFunction).toContain('const imageFallbackUsed = Boolean(aiAllowed && image && !imageTranscriptionResult && hasExplicitMessage)')
    expect(tutorFunction).toContain('if (!hasExplicitMessage && !imageTranscriptionResult)')
    expect(tutorFunction).toContain('本次仅根据你输入的文字回答')
    expect(tutorFunction).toContain("'model_retryable'")
  })

  it('enforces a bounded tutor model budget and validates assigned subjects', () => {
    expect(tutorFunction).toContain('const TUTOR_MODEL_BUDGET_MS = 40_000')
    expect(tutorFunction).toContain('remainingBeforeEmbedding > 18_000')
    expect(tutorFunction).toContain('timeoutMs: modelTimeoutWithin(modelDeadline, 24_000)')
    expect(tutorFunction).toContain('resolveTutorSubjects(body.subject, student.subjects)')
    expect(tutorFunction).toContain("'subject_not_allowed'")
    expect(modelAdapter).toContain('options.timeoutMs ?? 45_000')
    expect(modelAdapter).toContain('options: { timeoutMs?: number } = {}')
  })
})
