import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TutorPage } from './TutorPage'

const mocks = vi.hoisted(() => ({
  sendTutorMessage: vi.fn(),
  demoMode: true,
  settings: {
    aiEnabled: true,
    textModelConfigured: false,
    visionModelConfigured: false,
    embeddingModelConfigured: false,
  },
  guardianConsentAt: '2026-07-01T12:00:00.000Z',
  tutorTurns: [] as unknown[],
}))

vi.mock('../../context/PlatformContext', () => ({
  usePlatform: () => ({
    state: {
      currentUser: { id: 'student-1', role: 'student', displayName: '林同学', username: 'lin-demo', avatarColor: '#000' },
      students: [{ id: 'student-1', role: 'student', displayName: '林同学', username: 'lin-demo', avatarColor: '#000', grade: '高三', subjects: ['math'], guardianConsentAt: mocks.guardianConsentAt }],
      tutorTurns: mocks.tutorTurns,
      knowledgeDocuments: [],
      learningResources: [],
      settings: mocks.settings,
    },
    sendTutorMessage: mocks.sendTutorMessage,
    demoMode: mocks.demoMode,
  }),
}))

describe('TutorPage multimodal composer', () => {
  beforeEach(() => {
    mocks.sendTutorMessage.mockReset().mockResolvedValue(undefined)
    mocks.demoMode = true
    mocks.settings.aiEnabled = true
    mocks.settings.textModelConfigured = false
    mocks.settings.visionModelConfigured = false
    mocks.settings.embeddingModelConfigured = false
    mocks.guardianConsentAt = '2026-07-01T12:00:00.000Z'
    mocks.tutorTurns = []
    Element.prototype.scrollIntoView = vi.fn()
    URL.createObjectURL = vi.fn(() => 'blob:question-preview')
    URL.revokeObjectURL = vi.fn()
  })

  it('allows one image-only question and passes the image to the selected mode', async () => {
    const user = userEvent.setup()
    const { container } = render(<TutorPage />)
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'ellipse.jpg', { type: 'image/jpeg' })
    await user.upload(fileInput!, file)

    expect(screen.getByAltText('待发送的题目')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '给个提示' }))
    await user.click(screen.getByTitle('发送'))

    await waitFor(() => expect(mocks.sendTutorMessage).toHaveBeenCalledTimes(1))
    const [message, level, attempt, subject, image] = mocks.sendTutorMessage.mock.calls[0]
    expect(message).toBe('')
    expect(level).toBe('hint')
    expect(attempt).toBe('')
    expect(subject).toBe('math')
    expect(image).toMatchObject({ mimeType: 'image/jpeg', name: 'ellipse.jpg', size: file.size })
    expect(image.dataUrl).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('rejects a second file through the single-file input and keeps the complete-solution attempt gate', async () => {
    const user = userEvent.setup()
    const { container } = render(<TutorPage />)
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(fileInput).not.toHaveAttribute('multiple')
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] } })
    expect(screen.getByText('仅支持 JPG、PNG 或 WebP 图片。')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('描述题目和你卡住的位置'), '求这道题的答案')
    await user.click(screen.getByRole('button', { name: '完整解答' }))
    expect(screen.getByTitle('发送')).toBeDisabled()
    const attemptInput = screen.getByPlaceholderText('先写下你已经尝试的公式、设元或步骤……')
    await user.type(attemptInput, '11111111')
    expect(screen.getByTitle('发送')).toBeDisabled()
    await user.clear(attemptInput)
    await user.type(attemptInput, '设直线为 y=kx+b')
    expect(screen.getByTitle('发送')).toBeEnabled()
  })

  it('keeps the selected image when the server reports that vision is unavailable', async () => {
    mocks.sendTutorMessage.mockRejectedValueOnce(new Error('图片答疑暂未启用，请先输入题目文字，或联系老师开启视觉模型。'))
    const user = userEvent.setup()
    const { container } = render(<TutorPage />)
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'question.jpg', { type: 'image/jpeg' })
    await user.upload(fileInput, file)
    await user.click(screen.getByTitle('发送'))

    expect(await screen.findByText('图片答疑暂未启用，请先输入题目文字，或联系老师开启视觉模型。')).toBeInTheDocument()
    expect(screen.getByAltText('待发送的题目')).toBeInTheDocument()
    expect(mocks.sendTutorMessage).toHaveBeenCalledTimes(1)
  })

  it('keeps text answering available but disables images when only the text model is connected', async () => {
    mocks.demoMode = false
    mocks.settings.textModelConfigured = true
    mocks.settings.visionModelConfigured = false
    const user = userEvent.setup()
    render(<TutorPage />)

    expect(screen.getByText('文字已连接 · 图片未连接')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '图片答疑未配置' })).toBeDisabled()
    await user.type(screen.getByPlaceholderText('描述题目和你卡住的位置'), '这道数列题第一步怎么做？')
    await user.click(screen.getByTitle('发送'))

    await waitFor(() => expect(mocks.sendTutorMessage).toHaveBeenCalledTimes(1))
  })

  it('keeps the question and attempted work when a retryable model request fails', async () => {
    mocks.sendTutorMessage.mockRejectedValueOnce(new Error('AI 暂时没有返回回答，你的输入仍保留在页面中，请直接重试。'))
    const user = userEvent.setup()
    render(<TutorPage />)

    const questionInput = screen.getByPlaceholderText('描述题目和你卡住的位置')
    await user.type(questionInput, '求椭圆在给定点处的切线方程')
    await user.click(screen.getByRole('button', { name: '完整解答' }))
    const attemptInput = screen.getByPlaceholderText('先写下你已经尝试的公式、设元或步骤……')
    await user.type(attemptInput, '设切点为 P(x0,y0)，并代入椭圆方程')
    await user.click(screen.getByTitle('发送'))

    expect(await screen.findByText('AI 暂时没有返回回答，你的输入仍保留在页面中，请直接重试。')).toBeInTheDocument()
    expect(questionInput).toHaveValue('求椭圆在给定点处的切线方程')
    expect(attemptInput).toHaveValue('设切点为 P(x0,y0)，并代入椭圆方程')
  })

  it('disables new questions when the text model is not connected in production', async () => {
    mocks.demoMode = false
    mocks.settings.textModelConfigured = false
    const user = userEvent.setup()
    render(<TutorPage />)

    expect(screen.getByText('AI 文本模型未连接')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('描述题目和你卡住的位置'), '请帮我诊断卡点')
    expect(screen.getByTitle('AI 答疑未连接')).toBeDisabled()
    expect(mocks.sendTutorMessage).not.toHaveBeenCalled()
  })

  it('shows a single standardized fallback notice for a general-knowledge response', () => {
    mocks.tutorTurns = [{
      id: 'assistant-general',
      studentId: 'student-1',
      role: 'assistant',
      body: '先使用通用知识梳理这道题。',
      createdAt: new Date().toISOString(),
      usedGeneralKnowledge: true,
      citations: [],
    }]
    render(<TutorPage />)

    expect(screen.getAllByText('未找到可靠匹配的已学资料，本次由 AI 使用通用学科知识回答。')).toHaveLength(1)
  })

  it('blocks AI use for a legacy student without a guardian-consent record', async () => {
    mocks.demoMode = false
    mocks.settings.textModelConfigured = true
    mocks.settings.visionModelConfigured = true
    mocks.guardianConsentAt = ''
    const user = userEvent.setup()
    render(<TutorPage />)

    expect(screen.getByText('等待监护人知情记录')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('描述题目和你卡住的位置'), '请帮我分析这道题')
    expect(screen.getByTitle('等待监护人知情记录')).toBeDisabled()
    expect(mocks.sendTutorMessage).not.toHaveBeenCalled()
  })
})
