import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AttachmentGallery } from './AttachmentGallery'

describe('AttachmentGallery', () => {
  it('opens images inside the page, supports paging, and closes with Escape', async () => {
    const user = userEvent.setup()
    render(<AttachmentGallery title="函数作业" attachments={[
      { id: 'a', name: '第一页.jpg', mimeType: 'image/jpeg', size: 100, previewUrl: 'https://example.test/a.jpg' },
      { id: 'b', name: '第二页.jpg', mimeType: 'image/jpeg', size: 100, previewUrl: 'https://example.test/b.jpg' },
    ]} />)

    await user.click(screen.getByRole('button', { name: '放大查看 第一页.jpg' }))
    expect(screen.getByRole('dialog', { name: '第一页.jpg' })).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开原图' })).toHaveAttribute('href', 'https://example.test/a.jpg')

    await user.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByRole('dialog', { name: '第二页.jpg' })).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('pages through images only when a submission also contains a PDF', async () => {
    const user = userEvent.setup()
    render(<AttachmentGallery title="综合作业" attachments={[
      { id: 'image-a', name: '题面.jpg', mimeType: 'image/jpeg', size: 100, previewUrl: 'https://example.test/a.jpg' },
      { id: 'pdf', name: '补充.pdf', mimeType: 'application/pdf', size: 300, previewUrl: 'https://example.test/file.pdf' },
      { id: 'image-b', name: '过程.png', mimeType: 'image/png', size: 120, previewUrl: 'https://example.test/b.png' },
    ]} />)

    expect(screen.getByRole('link', { name: /打开附件/ })).toHaveAttribute('href', 'https://example.test/file.pdf')
    await user.click(screen.getByRole('button', { name: '放大查看 题面.jpg' }))
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '下一页' }))

    expect(screen.getByRole('dialog', { name: '过程.png' })).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '过程.png' })).toHaveAttribute('src', 'https://example.test/b.png')
  })
})
