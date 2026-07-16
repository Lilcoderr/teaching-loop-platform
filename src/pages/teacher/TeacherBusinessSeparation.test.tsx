import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Submission, WrongItem } from '../../types/domain'
import { StudentsPage } from './StudentsPage'
import { TeacherDashboard } from './TeacherDashboard'
import { ReviewPage } from './ReviewPage'

const mocks = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  markMessagesRead: vi.fn(),
  approveSubmission: vi.fn(),
  gradeSubmission: vi.fn(),
  gradeAndApproveSubmission: vi.fn(),
  rejectSubmission: vi.fn(),
}))

vi.mock('../../context/PlatformContext', () => ({
  usePlatform: () => mocks.getPlatform(),
}))

const student = {
  id: 'student-1',
  role: 'student' as const,
  displayName: '林同学',
  username: 'lin',
  avatarColor: '#2563eb',
  grade: '高三',
  subjects: ['math' as const],
  targetScore: 120,
}

function wrongItem(overrides: Partial<WrongItem>): WrongItem {
  return {
    id: 'wrong-verified',
    studentId: student.id,
    submissionId: 'assignment-source',
    subject: 'math',
    questionNumber: '8',
    title: '教师确认题',
    knowledgePoints: ['函数单调性'],
    errorTags: ['concept'],
    evidenceState: 'teacher_verified',
    teacherNote: '先检查定义域。',
    occurredAt: '2026-07-15T04:00:00.000Z',
    recurrenceCount: 1,
    reviewStage: 0,
    resolved: false,
    ...overrides,
  }
}

function submission(id: string, mode: Submission['mode'], status: Submission['status']): Submission {
  return {
    id,
    studentId: student.id,
    mode,
    subject: 'math',
    title: id,
    submittedAt: '2026-07-15T08:00:00.000Z',
    assignmentDate: '2026-07-15T04:00:00.000Z',
    wrongNumbers: [],
    studentErrorTags: [],
    status,
    attachments: [],
  }
}

function platformState(overrides: Record<string, unknown> = {}) {
  return {
    currentUser: { id: 'teacher-1', role: 'teacher', displayName: '陈老师', username: 'teacher', avatarColor: '#000' },
    students: [student],
    submissions: [],
    wrongItems: [],
    messages: [],
    reviewTasks: [],
    knowledgeDocuments: [],
    dailyEvaluations: [],
    analysisDrafts: [],
    ...overrides,
  }
}

function setPlatform(state: ReturnType<typeof platformState>) {
  mocks.getPlatform.mockReturnValue({
    state,
    activeStudent: student,
    activeStudentId: student.id,
    setActiveStudentId: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    markMessagesRead: mocks.markMessagesRead,
    saveDailyEvaluation: vi.fn().mockResolvedValue(undefined),
    approveSubmission: mocks.approveSubmission,
    gradeSubmission: mocks.gradeSubmission,
    gradeAndApproveSubmission: mocks.gradeAndApproveSubmission,
    rejectSubmission: mocks.rejectSubmission,
  })
}

describe('teacher assignment and verified-evidence boundaries', () => {
  beforeEach(() => {
    mocks.getPlatform.mockReset()
    mocks.markMessagesRead.mockReset().mockResolvedValue(undefined)
    mocks.approveSubmission.mockReset().mockResolvedValue(undefined)
    mocks.gradeSubmission.mockReset().mockResolvedValue(undefined)
    mocks.gradeAndApproveSubmission.mockReset().mockResolvedValue(undefined)
    mocks.rejectSubmission.mockReset().mockResolvedValue(undefined)
  })

  it('keeps self-reported wrong items out of the confirmed student profile and prep evidence', () => {
    const verified = wrongItem({})
    const selfReported = wrongItem({
      id: 'wrong-self-reported',
      title: '学生自报题',
      knowledgePoints: ['待确认知识点'],
      errorTags: ['calculation'],
      evidenceState: 'self_reported',
      teacherNote: '',
    })
    setPlatform(platformState({ wrongItems: [selfReported, verified] }))

    render(<StudentsPage />)

    expect(screen.getByText('教师确认题')).toBeInTheDocument()
    expect(screen.queryByText('学生自报题')).not.toBeInTheDocument()
    const pendingMetric = screen.getByText('待巩固').closest('div')
    expect(pendingMetric).not.toBeNull()
    expect(within(pendingMetric!).getByText('1')).toBeInTheDocument()
    expect(screen.getByText('优先处理“概念”类问题，并在完整题目中检查步骤落地。')).toBeInTheDocument()
    expect(screen.queryByText('优先处理“运算”类问题，并在完整题目中检查步骤落地。')).not.toBeInTheDocument()
  })

  it('matches the assignment review status set and excludes wrong-item uploads from the queue', () => {
    const submissions = [
      submission('assignment-uploaded', 'assignment', 'uploaded'),
      submission('assignment-analyzing', 'assignment', 'analyzing'),
      submission('assignment-needs-review', 'assignment', 'needs_review'),
      submission('assignment-failed', 'assignment', 'failed'),
      submission('assignment-approved', 'assignment', 'approved'),
      submission('wrong-item-needs-review', 'wrong_item', 'needs_review'),
    ]
    setPlatform(platformState({ submissions }))

    render(<MemoryRouter><TeacherDashboard /></MemoryRouter>)

    const pendingCard = screen.getByText('待批改作业').closest('article')
    expect(pendingCard).not.toBeNull()
    expect(within(pendingCard!).getByText('4')).toBeInTheDocument()
    expect(screen.getByText('assignment-uploaded')).toBeInTheDocument()
    expect(screen.getByText('assignment-analyzing')).toBeInTheDocument()
    expect(screen.getByText('assignment-needs-review')).toBeInTheDocument()
    expect(screen.getByText('assignment-failed')).toBeInTheDocument()
    expect(screen.queryByText('assignment-approved')).not.toBeInTheDocument()
    expect(screen.queryByText('wrong-item-needs-review')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '全部 4' })).toHaveAttribute('href', '/teacher/review')
    expect(screen.getByText('assignment-uploaded').closest('a')).toHaveAttribute('href', '/teacher/review?submission=assignment-uploaded')
  })

  it('uses only teacher-verified wrong items in dashboard counts and error distributions', () => {
    const verified = wrongItem({})
    const selfReported = wrongItem({
      id: 'wrong-self-reported',
      title: '学生自报题',
      errorTags: ['calculation'],
      evidenceState: 'self_reported',
    })
    setPlatform(platformState({ wrongItems: [selfReported, verified] }))

    const { container } = render(<MemoryRouter><TeacherDashboard /></MemoryRouter>)

    const overview = container.querySelector<HTMLElement>('.student-overview')
    expect(overview).not.toBeNull()
    const pending = within(overview!).getByText('待巩固').closest('div') as HTMLElement | null
    expect(pending).not.toBeNull()
    expect(within(pending!).getByText('1')).toBeInTheDocument()
    const conceptBar = screen.getByText('概念').closest('.metric-bar') as HTMLElement | null
    const calculationBar = screen.getByText('运算').closest('.metric-bar') as HTMLElement | null
    expect(conceptBar).not.toBeNull()
    expect(calculationBar).not.toBeNull()
    expect(within(conceptBar!).getByText('1')).toBeInTheDocument()
    expect(within(calculationBar!).getByText('0')).toBeInTheDocument()
    expect(screen.getByText('来自 1 次提交、1 条已确认错题')).toBeInTheDocument()
  })

  it('keeps analyzing submissions out of the review queue but allows manual review before AI claims an upload', () => {
    setPlatform(platformState({
      submissions: [
        submission('assignment-analyzing', 'assignment', 'analyzing'),
        submission('assignment-uploaded', 'assignment', 'uploaded'),
        submission('assignment-needs-review', 'assignment', 'needs_review'),
      ],
    }))

    render(<MemoryRouter><ReviewPage /></MemoryRouter>)

    expect(screen.queryByText('assignment-analyzing')).not.toBeInTheDocument()
    expect(screen.getAllByText('assignment-uploaded')).toHaveLength(2)
    expect(screen.getByText('assignment-needs-review')).toBeInTheDocument()
    expect(screen.getByText('AI 初批尚未启动，可以直接人工核对和批改。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认批改并反馈' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '退回补交' })).toBeEnabled()
  })

  it('rejects an oversized confirmed question number before saving any grade', async () => {
    const user = userEvent.setup()
    setPlatform(platformState({
      submissions: [submission('assignment-needs-review', 'assignment', 'needs_review')],
    }))

    render(<MemoryRouter><ReviewPage /></MemoryRouter>)

    await user.type(screen.getByLabelText('总体反馈'), '整体完成情况良好。')
    await user.type(screen.getByLabelText(/确认归入错题库的题号（可选）/), 'A'.repeat(41))
    await user.click(screen.getByRole('button', { name: '确认批改并反馈' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('单个题号最多 40 个字符')
    expect(mocks.gradeSubmission).not.toHaveBeenCalled()
    expect(mocks.approveSubmission).not.toHaveBeenCalled()
    expect(mocks.gradeAndApproveSubmission).not.toHaveBeenCalled()
  })

  it('rejects more than 50 confirmed question numbers before the atomic review request', async () => {
    const user = userEvent.setup()
    setPlatform(platformState({
      submissions: [submission('assignment-needs-review', 'assignment', 'needs_review')],
    }))
    render(<MemoryRouter><ReviewPage /></MemoryRouter>)

    await user.type(screen.getByLabelText('总体反馈'), '整体完成情况良好。')
    await user.type(
      screen.getByLabelText(/确认归入错题库的题号（可选）/),
      Array.from({ length: 51 }, (_, index) => String(index + 1)).join(','),
    )
    await user.click(screen.getByRole('button', { name: '确认批改并反馈' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('一次最多确认 50 个错题题号')
    expect(mocks.gradeAndApproveSubmission).not.toHaveBeenCalled()
  })

  it('saves an assignment grade and approval through one context operation', async () => {
    const user = userEvent.setup()
    setPlatform(platformState({
      submissions: [submission('assignment-needs-review', 'assignment', 'needs_review')],
    }))
    render(<MemoryRouter><ReviewPage /></MemoryRouter>)

    await user.type(screen.getByLabelText('逐题反馈（可选）'), '第 3 题：第二步符号错误。')
    await user.type(screen.getByLabelText('总体反馈'), '整体完成情况良好。')
    await user.type(screen.getByLabelText(/确认归入错题库的题号（可选）/), '3')
    await user.click(screen.getByRole('button', { name: '确认批改并反馈' }))

    await waitFor(() => expect(mocks.gradeAndApproveSubmission).toHaveBeenCalledWith(
      'assignment-needs-review', [], '整体完成情况良好。',
      [{ questionNumber: '3', comment: '第二步符号错误。' }], ['3'], undefined, 100,
    ))
    expect(mocks.gradeSubmission).not.toHaveBeenCalled()
    expect(mocks.approveSubmission).not.toHaveBeenCalled()
  })
})
