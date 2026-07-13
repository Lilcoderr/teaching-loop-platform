import { describe, expect, it } from 'vitest'
import { canUseKnowledgeSource, normalizeSearchText } from './knowledge'

describe('knowledge visibility', () => {
  it('allows student-visible material at every hint level', () => {
    expect(canUseKnowledgeSource('student_visible', 'student', 'diagnose', false)).toBe(true)
  })

  it('gates solutions until a student asks for a solution with an attempt', () => {
    expect(canUseKnowledgeSource('solution_gated', 'student', 'hint', true)).toBe(false)
    expect(canUseKnowledgeSource('solution_gated', 'student', 'solution', false)).toBe(false)
    expect(canUseKnowledgeSource('solution_gated', 'student', 'solution', true)).toBe(true)
  })

  it('never exposes teacher-only material to students or parents', () => {
    expect(canUseKnowledgeSource('teacher_only', 'student', 'solution', true)).toBe(false)
    expect(canUseKnowledgeSource('student_visible', 'parent', 'hint', true)).toBe(false)
    expect(canUseKnowledgeSource('teacher_only', 'teacher', 'diagnose', false)).toBe(true)
  })
})

describe('normalizeSearchText', () => {
  it('normalizes Chinese punctuation and whitespace', () => {
    expect(normalizeSearchText('  椭圆（切线）  判别式！ ')).toBe('椭圆 切线 判别式')
  })
})
