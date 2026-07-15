import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MistakesPage } from './MistakesPage'

vi.mock('../../context/PlatformContext', () => ({
  usePlatform: () => ({
    state: {
      currentUser: { id: 'student-1', role: 'student', displayName: '沈同学', username: 'shen', avatarColor: '#2563eb' },
      submissions: [{
        id: 'submission-1', studentId: 'student-1', mode: 'wrong_item', subject: 'math', title: '椭圆切线',
        submittedAt: '2026-07-15T08:00:00.000Z', assignmentDate: '2026-07-15T04:00:00.000Z',
        wrongNumbers: ['12'], studentErrorTags: [], status: 'needs_review', attachments: [],
        teacherHint: '先设切点，再写出切线斜率关系。',
      }],
      wrongItems: [{
        id: 'wrong-1', studentId: 'student-1', submissionId: 'submission-1', subject: 'math', questionNumber: '12',
        title: '椭圆切线', knowledgePoints: [], errorTags: [], evidenceState: 'self_reported', teacherNote: '',
        occurredAt: '2026-07-15', recurrenceCount: 1, reviewStage: 0, resolved: false,
      }],
      reviewTasks: [],
    },
    completeReview: vi.fn(),
  }),
}))

describe('student wrong-item feedback', () => {
  it('shows a separately saved teacher hint before the item is confirmed', () => {
    render(<MistakesPage />)

    expect(screen.getByText(/待老师确认 · 7月15日/)).toBeInTheDocument()
    expect(screen.getByText('提示：先设切点，再写出切线斜率关系。')).toBeInTheDocument()
    expect(screen.getByText('尚未安排复习')).toBeInTheDocument()
  })
})
