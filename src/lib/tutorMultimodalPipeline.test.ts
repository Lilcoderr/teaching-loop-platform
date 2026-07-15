import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildSafeSourceAnchors,
  buildTutorRetrievalPromptBlock,
} from '../../supabase/functions/tutor-chat/logic'

const tutorFunction = readFileSync('supabase/functions/tutor-chat/index.ts', 'utf8')

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

  it('locks lower levels to JSON scaffold selection and withholds inline source excerpts', () => {
    expect(tutorFunction).toContain("json: hintLevel !== 'solution'")
    expect(tutorFunction).toContain("const exposeCitationExcerpt = hintLevel === 'solution'")
    expect(tutorFunction).toContain("excerpt: exposeCitationExcerpt ? chunk.content.slice(0, 500) : ''")
  })

  it('routes source context through the level-aware prompt guard and anchor whitelist', () => {
    expect(tutorFunction).toContain('buildTutorRetrievalPromptBlock(hintLevel, sourceAnchors, contextLines)')
    expect(tutorFunction).toContain('safeLevelAnswer(hintLevel, modelResult.text, hasSources, sourceAnchors)')
    expect(tutorFunction).toContain('anchorId 只能从 ${sourceAnchors.map((anchor) => anchor.id).join')
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
      expect(prompt).toContain('[k1] lecture: 数列递推')
      expect(prompt).toContain('[w1] wrong_item: 递推关系')
      expect(prompt).toContain('<untrusted_authorized_retrieval_context>')
      for (const body of sourceBodies) expect(prompt).toContain(body)
    }
    expect(tutorFunction).toContain("json: hintLevel !== 'solution'")
    expect(tutorFunction).toContain('safeLevelAnswer(hintLevel, modelResult.text, hasSources, sourceAnchors)')
  })

  it('retains full authorized source context only for complete solutions', () => {
    const sourceBodies = ['FULL_LECTURE_BODY', 'FULL_TEACHER_NOTE']
    const prompt = buildTutorRetrievalPromptBlock('solution', [], sourceBodies)
    expect(prompt).toContain('<authorized_retrieval_context>')
    expect(prompt).toContain('FULL_LECTURE_BODY')
    expect(prompt).toContain('FULL_TEACHER_NOTE')
    expect(prompt).not.toContain('<authorized_retrieval_metadata>')
  })
})
