import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registerSW: vi.fn(),
  render: vi.fn(),
  updateServiceWorker: vi.fn(() => Promise.resolve()),
}))

vi.mock('virtual:pwa-register', () => ({ registerSW: mocks.registerSW }))
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: mocks.render }) }))
vi.mock('./App', () => ({ default: () => null }))
vi.mock('./context/PlatformContext', () => ({ PlatformProvider: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('./styles.css', () => ({}))

describe('service worker registration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.registerSW.mockReturnValue(mocks.updateServiceWorker)
    document.body.innerHTML = '<div id="root"></div>'
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
  })

  afterEach(() => vi.useRealTimers())

  it('waits for load and browser idle time before registering', async () => {
    const requestIdleCallback = vi.fn()
    Object.defineProperty(window, 'requestIdleCallback', { configurable: true, writable: true, value: requestIdleCallback })

    await import('./main')
    expect(mocks.registerSW).not.toHaveBeenCalled()

    act(() => window.dispatchEvent(new Event('load')))
    expect(requestIdleCallback).toHaveBeenCalledOnce()
    expect(mocks.registerSW).not.toHaveBeenCalled()

    act(() => requestIdleCallback.mock.calls[0][0]())
    expect(mocks.registerSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: false }))
  })

  it('uses a short fallback delay when browser idle callbacks are unavailable', async () => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'requestIdleCallback', { configurable: true, writable: true, value: undefined })

    await import('./main')
    act(() => window.dispatchEvent(new Event('load')))
    expect(mocks.registerSW).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1_499))
    expect(mocks.registerSW).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(mocks.registerSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: false }))
  })

  it('announces an update without applying it until explicitly requested', async () => {
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' })
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      callback({ didTimeout: false, timeRemaining: () => 10 })
      return 1
    })
    Object.defineProperty(window, 'requestIdleCallback', { configurable: true, writable: true, value: requestIdleCallback })
    const updateEvent = new Promise<CustomEvent<{ applyUpdate: () => Promise<void> }>>((resolve) => {
      window.addEventListener('teaching-loop:pwa-update-available', (event) => resolve(event as CustomEvent<{ applyUpdate: () => Promise<void> }>), { once: true })
    })

    await import('./main')
    const options = mocks.registerSW.mock.calls[0][0]
    options.onNeedRefresh()
    const event = await updateEvent

    expect(mocks.updateServiceWorker).not.toHaveBeenCalled()
    await event.detail.applyUpdate()
    expect(mocks.updateServiceWorker).toHaveBeenCalledWith(true)
  })
})
