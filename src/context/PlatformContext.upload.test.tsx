import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoState } from '../data/demo'
import type { PlatformState, UploadMode } from '../types/domain'
import { PlatformProvider, usePlatform } from './PlatformContext'

const serviceMocks = vi.hoisted(() => ({
  invokeFunction: vi.fn(),
  getSession: vi.fn(),
  submissionInsert: vi.fn(),
  attachmentInsert: vi.fn(),
  submissionDelete: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../lib/runtime', () => ({
  runtime: {
    demoMode: false,
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'test-anon-key',
  },
}))

vi.mock('../lib/supabase', () => ({
  invokeFunction: serviceMocks.invokeFunction,
  supabase: {
    auth: {
      getSession: serviceMocks.getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: (table: string) => {
      if (table === 'submissions') {
        return {
          insert: serviceMocks.submissionInsert,
          delete: () => ({ eq: () => ({ eq: serviceMocks.submissionDelete }) }),
        }
      }
      if (table === 'submission_attachments') return { insert: serviceMocks.attachmentInsert }
      throw new Error(`Unexpected table: ${table}`)
    },
    storage: {
      from: () => ({ upload: serviceMocks.upload, remove: serviceMocks.remove }),
    },
  },
}))

function teacherState(): PlatformState {
  return structuredClone(demoState)
}

function UploadProbe({
  files,
  mode = 'assignment',
  onProgress,
}: {
  files: File[]
  mode?: UploadMode
  onProgress?: (completed: number, total: number) => void
}) {
  const { authenticated, createSubmission, state } = usePlatform()
  const [result, setResult] = useState('')
  const [progress, setProgress] = useState('')
  const submit = async () => {
    try {
      const id = await createSubmission({
        mode, subject: 'math', title: mode === 'wrong_item' ? '错题即时状态测试' : '并行上传测试',
        assignmentDate: '2026-07-15T04:00:00.000Z', wrongNumbers: mode === 'wrong_item' ? ['12'] : [],
        studentErrorTags: [],
      }, files, (completed, total) => {
        setProgress(`${completed}/${total}`)
        onProgress?.(completed, total)
      })
      setResult(`ok:${id}`)
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'unknown error')
    }
  }
  return <>
    <span data-testid="ready">{String(authenticated)}</span>
    <button type="button" onClick={() => void submit()}>执行上传</button>
    <span data-testid="upload-result">{result}</span>
    <span data-testid="upload-progress">{progress}</span>
    <span data-testid="wrong-item-state">{state.wrongItems
      .filter((item) => item.title === '错题即时状态测试')
      .map((item) => `${item.id}|${item.submissionId}|${item.evidenceState}`)
      .join(',')}</span>
    <span data-testid="submission-preview">{state.submissions
      .find((item) => item.title === '错题即时状态测试')
      ?.attachments[0]?.previewUrl ?? ''}</span>
    <span data-testid="created-submission-state">{state.submissions
      .filter((item) => item.title === '并行上传测试' || item.title === '错题即时状态测试')
      .map((item) => item.id)
      .join(',')}</span>
  </>
}

async function renderReady(
  files: File[],
  mode: UploadMode = 'assignment',
  onProgress?: (completed: number, total: number) => void,
) {
  const user = userEvent.setup()
  const view = render(<PlatformProvider><UploadProbe files={files} mode={mode} onProgress={onProgress} /></PlatformProvider>)
  await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'))
  await user.click(screen.getByRole('button', { name: '执行上传' }))
  return view
}

describe('production submission attachment upload', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:test-upload-preview'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
    serviceMocks.invokeFunction.mockReset().mockImplementation((name: string) => {
      if (name === 'bootstrap') return Promise.resolve(teacherState())
      if (name === 'analyze-submission') return Promise.resolve({ ok: true })
      return Promise.reject(new Error(`Unexpected function: ${name}`))
    })
    serviceMocks.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'teacher-1' } } } })
    serviceMocks.submissionInsert.mockReset().mockResolvedValue({ error: null })
    serviceMocks.attachmentInsert.mockReset().mockResolvedValue({ error: null })
    serviceMocks.submissionDelete.mockReset().mockResolvedValue({ error: null })
    serviceMocks.upload.mockReset().mockResolvedValue({ error: null })
    serviceMocks.remove.mockReset().mockResolvedValue({ error: null })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('uploads files concurrently and writes ordered attachment metadata in one batch', async () => {
    await renderReady([
      new File(['a'], 'first.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'second.jpg', { type: 'image/jpeg' }),
      new File(['c'], 'third.pdf', { type: 'application/pdf' }),
    ])

    await waitFor(() => expect(screen.getByTestId('upload-result')).toHaveTextContent(/^ok:submission-/))
    expect(serviceMocks.upload).toHaveBeenCalledTimes(3)
    expect(serviceMocks.attachmentInsert).toHaveBeenCalledTimes(1)
    const rows = serviceMocks.attachmentInsert.mock.calls[0][0] as Array<{ file_name: string; page_order: number }>
    expect(rows.map((row) => [row.file_name, row.page_order])).toEqual([
      ['first.jpg', 0], ['second.jpg', 1], ['third.pdf', 2],
    ])
  })

  it('limits active uploads to four, preserves metadata order, and reports monotonic progress', async () => {
    const releases: Array<() => void> = []
    const progress: Array<[number, number]> = []
    let activeUploads = 0
    let peakUploads = 0
    serviceMocks.upload.mockImplementation(() => new Promise<{ error: null }>((resolve) => {
      activeUploads += 1
      peakUploads = Math.max(peakUploads, activeUploads)
      let released = false
      releases.push(() => {
        if (released) return
        released = true
        activeUploads -= 1
        resolve({ error: null })
      })
    }))
    const files = Array.from({ length: 9 }, (_, index) => (
      new File([String(index)], `page-${index + 1}.jpg`, { type: 'image/jpeg' })
    ))

    await renderReady(files, 'assignment', (completed, total) => progress.push([completed, total]))
    await waitFor(() => expect(serviceMocks.upload).toHaveBeenCalledTimes(4))
    expect(activeUploads).toBe(4)
    expect(peakUploads).toBe(4)
    expect(screen.getByTestId('upload-progress')).toHaveTextContent('0/9')

    await act(async () => releases.slice(0, 4).forEach((release) => release()))
    await waitFor(() => expect(serviceMocks.upload).toHaveBeenCalledTimes(8))
    expect(activeUploads).toBe(4)
    expect(screen.getByTestId('upload-progress')).toHaveTextContent('4/9')

    await act(async () => releases.slice(4, 8).forEach((release) => release()))
    await waitFor(() => expect(serviceMocks.upload).toHaveBeenCalledTimes(9))
    expect(activeUploads).toBe(1)
    expect(screen.getByTestId('upload-progress')).toHaveTextContent('8/9')

    await act(async () => releases[8]())
    await waitFor(() => expect(screen.getByTestId('upload-result')).toHaveTextContent(/^ok:submission-/))
    expect(activeUploads).toBe(0)
    expect(peakUploads).toBeLessThanOrEqual(4)
    expect(progress).toEqual(Array.from({ length: 10 }, (_, completed) => [completed, 9]))
    const rows = serviceMocks.attachmentInsert.mock.calls[0][0] as Array<{ file_name: string; page_order: number }>
    expect(rows.map((row) => [row.file_name, row.page_order])).toEqual(
      files.map((file, index) => [file.name, index]),
    )
  })

  it('removes successful files and the submission when one parallel upload fails', async () => {
    serviceMocks.upload.mockImplementation(async (path: string) => ({
      error: path.includes('bad.jpg') ? new Error('storage failed') : null,
    }))
    await renderReady([
      new File(['a'], 'first.jpg', { type: 'image/jpeg' }),
      new File(['b'], 'bad.jpg', { type: 'image/jpeg' }),
      new File(['c'], 'third.jpg', { type: 'image/jpeg' }),
    ])

    await waitFor(() => expect(screen.getByTestId('upload-result')).toHaveTextContent('storage failed'))
    expect(serviceMocks.attachmentInsert).not.toHaveBeenCalled()
    expect(serviceMocks.remove).toHaveBeenCalledTimes(1)
    expect(serviceMocks.remove.mock.calls[0][0]).toHaveLength(2)
    expect(serviceMocks.submissionDelete).toHaveBeenCalledWith('status', 'uploaded')
  })

  it('keeps the submission for tracing and skips deletion when storage rollback fails', async () => {
    serviceMocks.attachmentInsert.mockResolvedValueOnce({ error: new Error('metadata failed') })
    serviceMocks.remove.mockResolvedValueOnce({ error: new Error('cleanup failed') })
    await renderReady([new File(['a'], 'first.jpg', { type: 'image/jpeg' })])

    await waitFor(() => expect(screen.getByTestId('upload-result')).toHaveTextContent('附件清理失败'))
    expect(screen.getByTestId('upload-result')).toHaveTextContent(/提交编号 submission-/)
    expect(screen.getByTestId('upload-result')).toHaveTextContent('请勿重复提交')
    expect(serviceMocks.submissionDelete).not.toHaveBeenCalled()
    expect(screen.getByTestId('created-submission-state')).toBeEmptyDOMElement()
  })

  it('keeps the submission for tracing when storage rollback throws', async () => {
    serviceMocks.attachmentInsert.mockResolvedValueOnce({ error: new Error('metadata failed') })
    serviceMocks.remove.mockRejectedValueOnce(new Error('storage unavailable'))
    await renderReady([new File(['a'], 'first.jpg', { type: 'image/jpeg' })])

    await waitFor(() => expect(screen.getByTestId('upload-result')).toHaveTextContent('附件清理失败'))
    expect(screen.getByTestId('upload-result')).toHaveTextContent(/提交编号 submission-/)
    expect(serviceMocks.submissionDelete).not.toHaveBeenCalled()
    expect(screen.getByTestId('created-submission-state')).toBeEmptyDOMElement()
  })

  it('reports a database cleanup failure only after storage cleanup succeeds', async () => {
    serviceMocks.attachmentInsert.mockResolvedValueOnce({ error: new Error('metadata failed') })
    serviceMocks.submissionDelete.mockResolvedValueOnce({ error: new Error('delete failed') })
    await renderReady([new File(['a'], 'first.jpg', { type: 'image/jpeg' })])

    await waitFor(() => expect(screen.getByTestId('upload-result')).toHaveTextContent('提交记录清理失败'))
    expect(serviceMocks.remove).toHaveBeenCalledTimes(1)
    expect(serviceMocks.submissionDelete).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('upload-result')).toHaveTextContent('请勿重复提交')
    expect(screen.getByTestId('created-submission-state')).toBeEmptyDOMElement()
  })

  it('retries a transient background analysis failure without blocking upload success', async () => {
    let analyzeCalls = 0
    serviceMocks.invokeFunction.mockImplementation((name: string) => {
      if (name === 'bootstrap') return Promise.resolve(teacherState())
      if (name === 'analyze-submission') {
        analyzeCalls += 1
        return analyzeCalls === 1 ? Promise.reject(new Error('temporary network error')) : Promise.resolve({ ok: true })
      }
      return Promise.reject(new Error(`Unexpected function: ${name}`))
    })
    await renderReady([new File(['a'], 'first.jpg', { type: 'image/jpeg' })])

    await waitFor(() => expect(screen.getByTestId('upload-result')).toHaveTextContent(/^ok:submission-/))
    await waitFor(() => expect(analyzeCalls).toBe(2), { timeout: 3000 })
  })

  it('shows a production wrong-item upload immediately and replaces it with bootstrap state', async () => {
    vi.mocked(URL.createObjectURL).mockReturnValue('blob:optimistic-question-preview')
    let finishAnalysis!: () => void
    const analysis = new Promise<{ ok: true }>((resolve) => {
      finishAnalysis = () => resolve({ ok: true })
    })
    let bootstrapCalls = 0
    serviceMocks.invokeFunction.mockImplementation((name: string) => {
      if (name === 'bootstrap') {
        bootstrapCalls += 1
        if (bootstrapCalls === 1) return Promise.resolve(teacherState())
        const submissionRow = serviceMocks.submissionInsert.mock.calls[0][0] as {
          id: string
          student_id: string
          assignment_date: string
        }
        const refreshed = teacherState()
        refreshed.wrongItems = [{
          id: 'canonical-wrong-item',
          studentId: submissionRow.student_id,
          submissionId: submissionRow.id,
          subject: 'math',
          questionNumber: '12',
          title: '错题即时状态测试',
          knowledgePoints: [],
          errorTags: [],
          evidenceState: 'self_reported',
          teacherNote: '',
          occurredAt: submissionRow.assignment_date,
          recurrenceCount: 1,
          reviewStage: 0,
          resolved: false,
        }]
        return Promise.resolve(refreshed)
      }
      if (name === 'analyze-submission') return analysis
      return Promise.reject(new Error(`Unexpected function: ${name}`))
    })

    const view = await renderReady([new File(['question'], 'question.jpg', { type: 'image/jpeg' })], 'wrong_item')

    await waitFor(() => expect(screen.getByTestId('upload-result')).toHaveTextContent(/^ok:submission-/))
    const optimisticState = screen.getByTestId('wrong-item-state').textContent ?? ''
    expect(optimisticState).toMatch(/^wrong-[^|]+\|submission-[^|]+\|self_reported$/)
    expect(screen.getByTestId('submission-preview')).toHaveTextContent('blob:optimistic-question-preview')
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ name: 'question.jpg' }))
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    expect(bootstrapCalls).toBe(1)

    finishAnalysis()
    await waitFor(() => expect(screen.getByTestId('wrong-item-state')).toHaveTextContent(
      /^canonical-wrong-item\|submission-[^|]+\|self_reported$/,
    ))
    expect(screen.getByTestId('wrong-item-state')).not.toHaveTextContent(optimisticState)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:optimistic-question-preview')
    expect(bootstrapCalls).toBe(2)
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('revokes an optimistic image URL exactly once when the provider unmounts', async () => {
    vi.mocked(URL.createObjectURL).mockReturnValue('blob:unmounted-question-preview')
    serviceMocks.invokeFunction.mockImplementation((name: string) => {
      if (name === 'bootstrap') return Promise.resolve(teacherState())
      if (name === 'analyze-submission') return new Promise(() => undefined)
      return Promise.reject(new Error(`Unexpected function: ${name}`))
    })

    const view = await renderReady([new File(['question'], 'question.jpg', { type: 'image/jpeg' })], 'wrong_item')
    await waitFor(() => expect(screen.getByTestId('upload-result')).toHaveTextContent(/^ok:submission-/))
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()

    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:unmounted-question-preview')
  })
})
