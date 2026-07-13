import type { HintLevel, KnowledgeVisibility, Role } from '../types/domain'

export function canUseKnowledgeSource(
  visibility: KnowledgeVisibility,
  role: Role,
  hintLevel: HintLevel,
  hasAttempt: boolean,
) {
  if (role === 'teacher') return true
  if (role === 'parent') return false
  if (visibility === 'teacher_only') return false
  if (visibility === 'student_visible') return true
  return hintLevel === 'solution' && hasAttempt
}

export function normalizeSearchText(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\p{P}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
