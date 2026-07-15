import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider, usePlatform } from './PlatformContext'

function DemoWrongItemProbe() {
  const { state, switchDemoUser, createSubmission, approveSubmission, gradeSubmission } = usePlatform()
  const submission = state.submissions.find((item) => item.title === '演示错题上传')
  const wrongItem = state.wrongItems.find((item) => item.submissionId === submission?.id)
  const reviewCount = state.reviewTasks.filter((item) => item.wrongItemId === wrongItem?.id).length

  return (
    <>
      <button type="button" onClick={() => switchDemoUser('student', state.students[0]?.id)}>切换学生</button>
      <button type="button" onClick={() => void createSubmission({
        mode: 'wrong_item', subject: 'math', title: '演示错题上传', assignmentDate: '2026-07-15T04:00:00.000Z',
        wrongNumbers: ['12'], selfReflection: '切线处卡住', studentErrorTags: ['modeling'],
      }, [new File(['question'], 'question.jpg', { type: 'image/jpeg' })])}>上传错题</button>
      <button type="button" disabled={!submission} onClick={() => submission && void approveSubmission(submission.id, ['modeling'], '设元方向正确', [], '先设切点')}>教师确认</button>
      <button type="button" disabled={!submission} onClick={() => submission && void gradeSubmission(
        submission.id,
        '继续检查取值范围',
        [{ questionNumber: '12', comment: '先检查定义域' }],
      )}>补充提示</button>
      <span data-testid="evidence-state">{wrongItem?.evidenceState ?? ''}</span>
      <span data-testid="submission-status">{submission?.status ?? ''}</span>
      <span data-testid="wrong-id">{wrongItem?.id ?? ''}</span>
      <span data-testid="teacher-note">{wrongItem?.teacherNote ?? ''}</span>
      <span data-testid="review-count">{reviewCount}</span>
    </>
  )
}

describe('demo wrong-item business flow', () => {
  beforeEach(() => {
    localStorage.clear()
    URL.createObjectURL = vi.fn(() => 'blob:demo-question')
  })

  it('creates a self-reported item immediately and upgrades that same record after confirmation', async () => {
    const user = userEvent.setup()
    render(<PlatformProvider><DemoWrongItemProbe /></PlatformProvider>)

    await user.click(screen.getByRole('button', { name: '切换学生' }))
    await user.click(screen.getByRole('button', { name: '上传错题' }))

    await waitFor(() => expect(screen.getByTestId('evidence-state')).toHaveTextContent('self_reported'))
    const originalId = screen.getByTestId('wrong-id').textContent
    expect(originalId).toBeTruthy()
    expect(screen.getByTestId('review-count')).toHaveTextContent('0')
    await waitFor(() => expect(screen.getByTestId('submission-status')).toHaveTextContent('needs_review'))

    await user.click(screen.getByRole('button', { name: '教师确认' }))
    await waitFor(() => expect(screen.getByTestId('evidence-state')).toHaveTextContent('teacher_verified'))
    expect(screen.getByTestId('wrong-id')).toHaveTextContent(originalId!)
    expect(screen.getByTestId('teacher-note')).toHaveTextContent('提示：先设切点')
    expect(screen.getByTestId('teacher-note')).toHaveTextContent('评价：设元方向正确')
    expect(screen.getByTestId('review-count')).toHaveTextContent('1')

    await user.click(screen.getByRole('button', { name: '补充提示' }))
    await waitFor(() => expect(screen.getByTestId('teacher-note')).toHaveTextContent('先检查定义域'))
    expect(screen.getByTestId('teacher-note')).toHaveTextContent('继续检查取值范围')
  })
})
