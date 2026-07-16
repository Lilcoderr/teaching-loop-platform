import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileDropzone } from './FileDropzone'

function sizedFile(name: string, size: number, type = 'image/jpeg') {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

function addFiles(files: File[], existing: File[] = [], maxMb = 15) {
  const onChange = vi.fn()
  const { container } = render(
    <FileDropzone files={existing} onChange={onChange} maxMb={maxMb} />,
  )
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')
  if (!input) throw new Error('file input missing')
  fireEvent.change(input, { target: { files } })
  return onChange
}

describe('FileDropzone upload limits', () => {
  it('rejects a zero-byte file', () => {
    const onChange = addFiles([new File([], 'empty.jpg', { type: 'image/jpeg' })])

    expect(screen.getByRole('paragraph')).toHaveTextContent('empty.jpg 是空文件')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects additions that would exceed twelve files without truncating silently', () => {
    const existing = Array.from({ length: 12 }, (_, index) => sizedFile(`old-${index}.jpg`, 1))
    const onChange = addFiles([sizedFile('extra.jpg', 1)], existing)

    expect(screen.getByText('一次最多上传 12 个文件')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('rejects a combined payload over 100 MiB', () => {
    const existing = Array.from({ length: 4 }, (_, index) => (
      sizedFile(`part-${index}.pdf`, 20 * 1024 * 1024, 'application/pdf')
    ))
    const onChange = addFiles(
      [sizedFile('part-final.pdf', 21 * 1024 * 1024, 'application/pdf')],
      existing,
      25,
    )

    expect(screen.getByText('本次文件总大小不能超过 100 MB')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('caps a configured single-file limit at the storage limit of 25 MiB', () => {
    const onChange = addFiles([sizedFile('large.pdf', 26 * 1024 * 1024, 'application/pdf')], [], 80)

    expect(screen.getByText('large.pdf 超过 25 MB')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('deduplicates both existing and same-batch files before applying limits', () => {
    const duplicate = sizedFile('same.jpg', 1024)
    const onChange = addFiles([duplicate, duplicate], [duplicate])

    expect(onChange).toHaveBeenCalledWith([duplicate])
    expect(screen.queryByText(/最多上传|总大小不能超过/)).not.toBeInTheDocument()
  })
})
