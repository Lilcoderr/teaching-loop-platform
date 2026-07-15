import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Submission } from '../../types/domain'
import { UploadPage, WrongUploadPage } from './UploadPage'

const mocks = vi.hoisted(() => ({
  createSubmission: vi.fn(),
  getState: vi.fn(),
}))

vi.mock('../../context/PlatformContext', () => ({
  usePlatform: () => ({
    state: mocks.getState(),
    createSubmission: mocks.createSubmission,
  }),
}))

function stateWith(submissions: Submission[] = []) {
  return {
    currentUser: { id: 'student-1', role: 'student', displayName: '林同学', username: 'lin', avatarColor: '#000' },
    students: [{ id: 'student-1', role: 'student', displayName: '林同学', username: 'lin', avatarColor: '#000', grade: '高三', subjects: ['math', 'physics'] }],
    settings: { maxUploadMb: 15 },
    submissions,
  }
}

function submission(overrides: Partial<Submission>): Submission {
  return {
    id: 'submission-1',
    studentId: 'student-1',
    mode: 'assignment',
    subject: 'math',
    title: '解析几何周练',
    submittedAt: '2026-07-15T08:00:00.000Z',
    assignmentDate: '2026-07-15T04:00:00.000Z',
    wrongNumbers: [],
    studentErrorTags: [],
    status: 'needs_review',
    attachments: [],
    ...overrides,
  }
}

async function addImage(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  expect(input).not.toBeNull()
  await user.upload(input!, new File(['answer'], 'answer.jpg', { type: 'image/jpeg' }))
}

describe('student submission upload experience', () => {
  beforeEach(() => {
    mocks.createSubmission.mockReset().mockResolvedValue('submission-new')
    mocks.getState.mockReset().mockReturnValue(stateWith())
  })

  it('stays on the upload page, reports success, resets the form, and blocks a double submit', async () => {
    const user = userEvent.setup()
    let finish!: (value: string) => void
    mocks.createSubmission.mockReturnValueOnce(new Promise<string>((resolve) => { finish = resolve }))
    const { container } = render(<UploadPage />)

    await user.type(screen.getByLabelText('作业名称'), '函数作业')
    await addImage(user, container)
    const submit = screen.getByRole('button', { name: '提交给老师' })
    await user.dblClick(submit)

    expect(mocks.createSubmission).toHaveBeenCalledTimes(1)
    expect(submit).toBeDisabled()
    finish('submission-new')

    expect(await screen.findByText('作业提交成功')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '提交今日作业' })).toBeInTheDocument()
    expect(screen.getByLabelText('作业名称')).toHaveValue('')
    expect(screen.getByText('“函数作业”及 1 个附件已交给老师，可在下方记录中查看处理状态。')).toBeInTheDocument()
  })

  it('shows a failed request in place and keeps the entered work for retry', async () => {
    const user = userEvent.setup()
    mocks.createSubmission.mockRejectedValueOnce(new Error('网络暂时不可用'))
    const { container } = render(<WrongUploadPage />)

    await user.type(screen.getByLabelText('错题名称'), '椭圆第 12 题')
    await addImage(user, container)
    await user.click(screen.getByRole('button', { name: '提交给老师' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('网络暂时不可用')
    expect(screen.getByLabelText('错题名称')).toHaveValue('椭圆第 12 题')
    expect(screen.getByText('answer.jpg')).toBeInTheDocument()
    expect(screen.queryByText('题目提交成功')).not.toBeInTheDocument()
  })

  it('rejects a question number longer than 40 characters before creating the submission', async () => {
    const user = userEvent.setup()
    const { container } = render(<WrongUploadPage />)

    await user.type(screen.getByLabelText('错题名称'), '题号边界测试')
    await user.type(screen.getByLabelText(/题号（可选，单个最多 40 字符）/), 'A'.repeat(41))
    await addImage(user, container)
    await user.click(screen.getByRole('button', { name: '提交给老师' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('单个题号最多 40 个字符')
    expect(mocks.createSubmission).not.toHaveBeenCalled()
    expect(screen.getByLabelText('错题名称')).toHaveValue('题号边界测试')
  })

  it('keeps assignment and wrong-item history separate and only shows the current student records', () => {
    const assignment = submission({
      id: 'assignment-own',
      title: '我的数学作业',
      status: 'approved',
      minutesSpent: 50,
      confidence: 4,
      attachments: [{ id: 'file-1', name: 'math-homework.pdf', mimeType: 'application/pdf', size: 1_200_000, previewUrl: 'https://example.test/math.pdf' }],
      teacherFeedback: '整体步骤完整，注意最后一问的范围。',
      teacherScore: 92,
      maxScore: 100,
      questionComments: [{ questionNumber: '8', comment: '符号需要复查。' }],
    })
    const wrongItem = submission({
      id: 'wrong-own',
      mode: 'wrong_item',
      title: '我的不会题',
      status: 'scheduled',
      attachments: [{ id: 'file-2', name: 'question.jpg', mimeType: 'image/jpeg', size: 300_000 }],
      teacherHint: '先设切点，再使用切线斜率关系。',
      teacherEvaluation: '设元方向正确。',
    })
    const otherStudent = submission({ id: 'assignment-other', studentId: 'student-2', title: '其他学生作业' })
    mocks.getState.mockReturnValue(stateWith([wrongItem, otherStudent, assignment]))

    const assignmentView = render(<UploadPage />)
    expect(screen.getByText('我的数学作业')).toBeInTheDocument()
    expect(screen.getByText('math-homework.pdf')).toBeInTheDocument()
    expect(screen.getByText('得分：92 / 100')).toBeInTheDocument()
    expect(screen.getByText('整体步骤完整，注意最后一问的范围。')).toBeInTheDocument()
    expect(screen.getByText('符号需要复查。')).toBeInTheDocument()
    expect(screen.queryByText('我的不会题')).not.toBeInTheDocument()
    expect(screen.queryByText('其他学生作业')).not.toBeInTheDocument()
    assignmentView.unmount()

    render(<WrongUploadPage />)
    expect(screen.getByText('我的不会题')).toBeInTheDocument()
    expect(screen.getByText('question.jpg')).toBeInTheDocument()
    expect(screen.getByText('先设切点，再使用切线斜率关系。')).toBeInTheDocument()
    expect(screen.getByText('设元方向正确。')).toBeInTheDocument()
    expect(screen.queryByText('我的数学作业')).not.toBeInTheDocument()
  })

  it('shows the teacher reason when a submission needs correction', () => {
    mocks.getState.mockReturnValue(stateWith([submission({ status: 'rejected', failureReason: '请补拍第 2 页下半部分。' })]))
    render(<UploadPage />)

    expect(screen.getByText('需要补充')).toBeInTheDocument()
    expect(screen.getByText('请补拍第 2 页下半部分。')).toBeInTheDocument()
    expect(screen.getByText('已驳回')).toBeInTheDocument()
  })
})
