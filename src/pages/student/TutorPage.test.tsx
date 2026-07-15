import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TutorPage } from './TutorPage'

const mocks = vi.hoisted(() => ({ sendTutorMessage: vi.fn() }))

vi.mock('../../context/PlatformContext', () => ({
  usePlatform: () => ({
    state: {
      currentUser: { id: 'student-1', role: 'student', displayName: '林同学', username: 'lin-demo', avatarColor: '#000' },
      students: [{ id: 'student-1', role: 'student', displayName: '林同学', username: 'lin-demo', avatarColor: '#000', grade: '高三', subjects: ['math'] }],
      tutorTurns: [],
      knowledgeDocuments: [],
      learningResources: [],
    },
    sendTutorMessage: mocks.sendTutorMessage,
  }),
}))

describe('TutorPage multimodal composer', () => {
  beforeEach(() => {
    mocks.sendTutorMessage.mockReset().mockResolvedValue(undefined)
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
    await user.type(screen.getByPlaceholderText('先写下你已经尝试的公式、设元或步骤……'), '设直线为 y=kx+b')
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
})
