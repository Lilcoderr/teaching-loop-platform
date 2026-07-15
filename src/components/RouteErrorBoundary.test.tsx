import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteErrorBoundary, chunkReloadStorageKey, isChunkLoadError } from './RouteErrorBoundary'

function AlwaysThrows({ error }: { error: Error }): never {
  throw error
}

describe('RouteErrorBoundary', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('reloads a failed dynamic import at most once for the same chunk', async () => {
    const error = new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/Page-abc123.js')
    const reload = vi.fn()
    const first = render(<RouteErrorBoundary reload={reload}><AlwaysThrows error={error} /></RouteErrorBoundary>)

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(sessionStorage.getItem(chunkReloadStorageKey(error))).toBeTruthy()
    first.unmount()

    render(<RouteErrorBoundary reload={reload}><AlwaysThrows error={error} /></RouteErrorBoundary>)

    expect(await screen.findByRole('heading', { name: '页面资源加载失败' })).toBeInTheDocument()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('offers retry and refresh for an ordinary render error', async () => {
    let shouldThrow = true
    const reload = vi.fn()
    function FlakyPage() {
      if (shouldThrow) throw new Error('render failed')
      return <h1>页面已恢复</h1>
    }

    render(<RouteErrorBoundary reload={reload}><FlakyPage /></RouteErrorBoundary>)

    expect(await screen.findByRole('heading', { name: '这个页面暂时无法显示' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(reload).toHaveBeenCalledTimes(1)

    shouldThrow = false
    fireEvent.click(screen.getByRole('button', { name: '重试页面' }))
    expect(await screen.findByRole('heading', { name: '页面已恢复' })).toBeInTheDocument()
  })

  it('distinguishes chunk failures from ordinary errors', () => {
    expect(isChunkLoadError(new Error('ChunkLoadError: Loading chunk 42 failed'))).toBe(true)
    expect(isChunkLoadError(new Error('ordinary render failure'))).toBe(false)
  })
})
