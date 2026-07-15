import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { PlatformProvider, usePlatform } from './PlatformContext'

function DemoTutorProbe() {
  const { state, switchDemoUser, sendTutorMessage } = usePlatform()
  const latestAssistant = [...state.tutorTurns].reverse().find((turn) => turn.role === 'assistant')

  return (
    <>
      <button type="button" onClick={() => switchDemoUser('student', state.students[0]?.id)}>切换学生</button>
      <button type="button" onClick={() => void sendTutorMessage('椭圆切线下一步怎么做？', 'hint', undefined, 'math')}>匹配资料</button>
      <button type="button" onClick={() => void sendTutorMessage('拉格朗日乘子如何处理？', 'hint', undefined, 'math')}>无匹配资料</button>
      <span data-testid="general-knowledge">{String(latestAssistant?.usedGeneralKnowledge ?? '')}</span>
      <span data-testid="citation-count">{latestAssistant?.citations?.length ?? 0}</span>
      <span data-testid="answer">{latestAssistant?.body ?? ''}</span>
    </>
  )
}

describe('demo tutor retrieval parity', () => {
  beforeEach(() => localStorage.clear())

  it('uses matching authorized material and falls back clearly when nothing matches', async () => {
    const user = userEvent.setup()
    render(<PlatformProvider><DemoTutorProbe /></PlatformProvider>)

    await user.click(screen.getByRole('button', { name: '切换学生' }))
    await user.click(screen.getByRole('button', { name: '匹配资料' }))
    await waitFor(() => expect(screen.getByTestId('citation-count')).toHaveTextContent('1'))
    expect(screen.getByTestId('general-knowledge')).toHaveTextContent('false')

    await user.click(screen.getByRole('button', { name: '无匹配资料' }))
    await waitFor(() => expect(screen.getByTestId('general-knowledge')).toHaveTextContent('true'))
    expect(screen.getByTestId('citation-count')).toHaveTextContent('0')
    expect(screen.getByTestId('answer')).toHaveTextContent('本次未在已学资料中找到对应内容')
  })
})
