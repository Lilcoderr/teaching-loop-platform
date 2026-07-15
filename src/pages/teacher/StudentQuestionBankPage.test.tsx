import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformState, Submission, WrongItem } from '../../types/domain'
import { StudentQuestionBankPage } from './StudentQuestionBankPage'

const mocks = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  approveSubmission: vi.fn(),
  gradeSubmission: vi.fn(),
  rejectSubmission: vi.fn(),
}))

vi.mock('../../context/PlatformContext', () => ({
  usePlatform: () => mocks.getPlatform(),
}))

const student = {
  id: 'student-1', role: 'student' as const, displayName: '沈同学', username: 'shen', avatarColor: '#2563eb',
  grade: '高三', subjects: ['math' as const],
}

function upload(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'wrong-upload', studentId: student.id, mode: 'wrong_item', subject: 'math', title: '椭圆切线不会题',
    submittedAt: '2026-07-15T08:00:00.000Z', assignmentDate: '2026-07-15T04:00:00.000Z',
    wrongNumbers: ['12'], studentErrorTags: ['modeling'], status: 'needs_review', selfReflection: '设点后不会继续',
    attachments: [{ id: 'image-1', name: 'question.jpg', mimeType: 'image/jpeg', size: 100, previewUrl: 'https://example.test/question.jpg' }],
    ...overrides,
  }
}

function wrongItem(overrides: Partial<WrongItem> = {}): WrongItem {
  return {
    id: 'wrong-1', studentId: student.id, submissionId: 'wrong-upload', subject: 'math', questionNumber: '12',
    title: '椭圆切线不会题', knowledgePoints: [], errorTags: ['modeling'], evidenceState: 'self_reported',
    teacherNote: '', occurredAt: '2026-07-15', recurrenceCount: 1, reviewStage: 0, resolved: false,
    ...overrides,
  }
}

function state(submissions: Submission[], wrongItems: WrongItem[]): PlatformState {
  return {
    currentUser: { id: 'teacher-1', role: 'teacher', displayName: '陈老师', username: 'teacher', avatarColor: '#000' },
    students: [student], accounts: [], submissions, analysisDrafts: [], dailyEvaluations: [], wrongItems, reviewTasks: [],
    messages: [], tutorTurns: [], reports: [], knowledgeDocuments: [], learningResources: [], questionBankItems: [], syncTokens: [], syncRuns: [],
    settings: { aiEnabled: false, textProvider: '', visionProvider: '', embeddingProvider: '', dailyStudentMessageLimit: 0, maxUploadMb: 25 },
  }
}

function setState(value: PlatformState) {
  mocks.getPlatform.mockReturnValue({
    state: value,
    approveSubmission: mocks.approveSubmission,
    gradeSubmission: mocks.gradeSubmission,
    rejectSubmission: mocks.rejectSubmission,
  })
}

describe('student question bank review workflow', () => {
  beforeEach(() => {
    mocks.getPlatform.mockReset()
    mocks.approveSubmission.mockReset().mockResolvedValue(undefined)
    mocks.gradeSubmission.mockReset().mockResolvedValue(undefined)
    mocks.rejectSubmission.mockReset().mockResolvedValue(undefined)
  })

  it('keeps hint and evaluation separate when confirming a report', async () => {
    const user = userEvent.setup()
    setState(state([upload()], [wrongItem()]))
    render(<MemoryRouter><StudentQuestionBankPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '查看、提示与确认' }))
    await user.type(screen.getByLabelText('给学生的提示（可单独保存）'), '先设切点')
    await user.type(screen.getByLabelText('教师评价（可选）'), '设元方向正确')
    await user.click(screen.getByRole('button', { name: '确认并纳入长期错题' }))

    await waitFor(() => expect(mocks.approveSubmission).toHaveBeenCalledWith(
      'wrong-upload', ['modeling'], '设元方向正确', [], '先设切点',
    ))
    expect(mocks.gradeSubmission).not.toHaveBeenCalled()
  })

  it('returns an incomplete upload with a visible reason and does not confirm it', async () => {
    const user = userEvent.setup()
    setState(state([upload()], [wrongItem()]))
    render(<MemoryRouter><StudentQuestionBankPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '查看、提示与确认' }))
    await user.click(screen.getByRole('button', { name: '退回补充' }))
    const reason = screen.getByLabelText('退回原因')
    await user.clear(reason)
    await user.type(reason, '请补拍题目右侧条件。')
    await user.click(screen.getByRole('button', { name: '确认退回' }))

    await waitFor(() => expect(mocks.rejectSubmission).toHaveBeenCalledWith('wrong-upload', '请补拍题目右侧条件。'))
    expect(mocks.approveSubmission).not.toHaveBeenCalled()
  })

  it('reopens and enlarges the original attachment after confirmation', async () => {
    const user = userEvent.setup()
    setState(state(
      [upload({ status: 'scheduled', archivedToWrongBook: true })],
      [wrongItem({ evidenceState: 'teacher_verified', teacherNote: '提示：先设切点', nextReviewAt: '2026-07-16T08:00:00.000Z' })],
    ))
    render(<MemoryRouter><StudentQuestionBankPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '查看原始上传' }))
    await user.click(screen.getByRole('button', { name: '放大查看 question.jpg' }))
    expect(screen.getByRole('dialog', { name: 'question.jpg' })).toBeInTheDocument()
  })
})
