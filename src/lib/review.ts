import { addDays } from 'date-fns'
import type { ErrorTag } from '../types/domain'

export const REVIEW_INTERVALS = [1, 3, 7, 14] as const

export const ERROR_TAG_OPTIONS: Array<{ value: ErrorTag; label: string; tone: string }> = [
  { value: 'concept', label: '概念', tone: 'indigo' },
  { value: 'reading', label: '审题', tone: 'amber' },
  { value: 'modeling', label: '建模', tone: 'teal' },
  { value: 'calculation', label: '运算', tone: 'red' },
  { value: 'writing', label: '书写', tone: 'blue' },
  { value: 'speed', label: '速度', tone: 'orange' },
  { value: 'avoidance', label: '未作答/畏难', tone: 'stone' },
]

export function nextReviewDate(from: Date, completedStage: number, passed: boolean) {
  const nextStage = passed ? Math.min(completedStage + 1, REVIEW_INTERVALS.length - 1) : 0
  return { nextStage, dueAt: addDays(from, REVIEW_INTERVALS[nextStage]).toISOString() }
}
