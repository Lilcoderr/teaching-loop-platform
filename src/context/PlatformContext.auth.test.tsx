import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { demoState } from '../data/demo'
import type { PlatformState } from '../types/domain'
import { PlatformProvider, usePlatform } from './PlatformContext'

const authMock = vi.hoisted(() => ({
  listener: undefined as ((event: string) => void) | undefined,
  getSession: vi.fn(),
  setSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}))

const invokeFunctionMock = vi.hoisted(() => vi.fn())
const loginAccounts = [{ id: '11111111-1111-4111-8111-111111111111', role: 'teacher', label: '方老师' }]

function teacherState(username = 'teacher-demo') {
  const state = structuredClone(demoState)
  state.currentUser = { ...state.currentUser, username }
  return state
}

function ContextProbe() {
  const { authenticated, initialSyncPending, initialDataReady, refresh, state, syncError } = usePlatform()
  return (
    <>
      <span data-testid="authenticated">{String(authenticated)}</span>
      <span data-testid="initial-sync-pending">{String(initialSyncPending)}</span>
      <span data-testid="initial-data-ready">{String(initialDataReady)}</span>
      <span data-testid="username">{state.currentUser.username}</span>
      <span data-testid="sync-error">{syncError}</span>
      <button type="button" onClick={() => void refresh()}>刷新</button>
    </>
  )
}

vi.mock('../lib/runtime', () => ({
  runtime: {
    demoMode: false,
    supabaseUrl: 'https://example.supabase.co',
    supabaseAnonKey: 'test-anon-key',
  },
}))

vi.mock('../lib/supabase', () => ({
  invokeFunction: invokeFunctionMock,
  supabase: {
    auth: {
      getSession: authMock.getSession,
      setSession: authMock.setSession,
      signInWithPassword: authMock.signInWithPassword,
      signOut: authMock.signOut,
      onAuthStateChange: (listener: (event: string) => void) => {
        authMock.listener = listener
        return { data: { subscription: { unsubscribe: authMock.unsubscribe } } }
      },
    },
  },
}))

describe('production authentication flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
    invokeFunctionMock.mockReset()
    authMock.getSession.mockReset()
    authMock.setSession.mockReset()
    authMock.signInWithPassword.mockReset()
    authMock.signOut.mockReset()
    authMock.unsubscribe.mockReset()
    authMock.listener = undefined
    authMock.getSession.mockResolvedValue({ data: { session: null } })
    authMock.signOut.mockResolvedValue({ error: null })
  })

  it('enters the shell while keeping empty routes unmounted until the shared bootstrap finishes', async () => {
    let bootstrapCalls = 0
    let resolveAuthenticatedBootstrap: ((state: PlatformState) => void) | undefined
    const authenticatedBootstrap = new Promise<PlatformState>((resolve) => {
      resolveAuthenticatedBootstrap = resolve
    })

    invokeFunctionMock.mockImplementation((name: string, body?: { action?: string }) => {
      if (name === 'username-login') {
        if (body?.action === 'list_accounts') return Promise.resolve({ accounts: loginAccounts })
        return Promise.resolve({ accessToken: 'access-token', refreshToken: 'refresh-token' })
      }
      if (name === 'bootstrap') {
        bootstrapCalls += 1
        return authenticatedBootstrap
      }
      return Promise.reject(new Error(`Unexpected function: ${name}`))
    })
    authMock.setSession.mockImplementation(async () => {
      authMock.listener?.('SIGNED_IN')
      return { error: null }
    })

    render(
      <MemoryRouter initialEntries={['/login']}>
        <PlatformProvider><App /></PlatformProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '登录学习工作台' })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: '方老师' })).toBeInTheDocument()
    expect(screen.getByLabelText('账号')).toHaveDisplayValue('方老师')
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'private-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(bootstrapCalls).toBe(1))
    expect(await screen.findByText('正在同步学习数据', {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '教学概览' })).not.toBeInTheDocument()
    expect(screen.queryByText('正在载入工作台')).not.toBeInTheDocument()

    await act(async () => resolveAuthenticatedBootstrap?.(teacherState()))

    expect(await screen.findByRole('heading', { name: '教学概览' }, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.queryByText('正在同步学习数据')).not.toBeInTheDocument()
    expect(invokeFunctionMock.mock.calls.filter(([name]) => name === 'bootstrap')).toHaveLength(1)
  })

  it('clears the initial sync state when a delayed bootstrap fails', async () => {
    let rejectAuthenticatedBootstrap: ((error: Error) => void) | undefined
    const authenticatedBootstrap = new Promise<PlatformState>((_, reject) => {
      rejectAuthenticatedBootstrap = reject
    })
    let resolveRetryBootstrap: ((state: PlatformState) => void) | undefined
    const retryBootstrap = new Promise<PlatformState>((resolve) => {
      resolveRetryBootstrap = resolve
    })
    let bootstrapCalls = 0
    authMock.getSession
      .mockResolvedValueOnce({ data: { session: null } })
      .mockResolvedValue({ data: { session: { user: { id: 'teacher' } } } })
    invokeFunctionMock.mockImplementation((name: string, body?: { action?: string }) => {
      if (name === 'username-login') {
        if (body?.action === 'list_accounts') return Promise.resolve({ accounts: loginAccounts })
        return Promise.resolve({ accessToken: 'access-token', refreshToken: 'refresh-token' })
      }
      if (name === 'bootstrap') {
        bootstrapCalls += 1
        return bootstrapCalls === 1 ? authenticatedBootstrap : retryBootstrap
      }
      return Promise.reject(new Error(`Unexpected function: ${name}`))
    })
    authMock.setSession.mockImplementation(async () => {
      authMock.listener?.('SIGNED_IN')
      return { error: null }
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <MemoryRouter initialEntries={['/login']}>
        <PlatformProvider><App /></PlatformProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('option', { name: '方老师' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'private-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('正在同步学习数据', {}, { timeout: 10_000 })).toBeInTheDocument()

    await act(async () => rejectAuthenticatedBootstrap?.(new Error('temporary bootstrap failure')))

    expect(await screen.findByRole('heading', { name: '首次数据同步失败' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('平台数据同步失败')
    expect(screen.queryByText('正在同步学习数据')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '教学概览' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新同步' }))
    expect(screen.getByRole('button', { name: '正在重试' })).toBeDisabled()
    expect(screen.queryByRole('heading', { name: '教学概览' })).not.toBeInTheDocument()

    await act(async () => resolveRetryBootstrap?.(teacherState('recovered')))
    expect(await screen.findByRole('heading', { name: '教学概览' }, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '首次数据同步失败' })).not.toBeInTheDocument()
  })

  it('clears the initial sync state on sign-out and ignores the stale bootstrap', async () => {
    let resolveAuthenticatedBootstrap: ((state: PlatformState) => void) | undefined
    const authenticatedBootstrap = new Promise<PlatformState>((resolve) => {
      resolveAuthenticatedBootstrap = resolve
    })
    invokeFunctionMock.mockImplementation((name: string, body?: { action?: string }) => {
      if (name === 'username-login') {
        if (body?.action === 'list_accounts') return Promise.resolve({ accounts: loginAccounts })
        return Promise.resolve({ accessToken: 'access-token', refreshToken: 'refresh-token' })
      }
      if (name === 'bootstrap') return authenticatedBootstrap
      return Promise.reject(new Error(`Unexpected function: ${name}`))
    })
    authMock.setSession.mockImplementation(async () => {
      authMock.listener?.('SIGNED_IN')
      return { error: null }
    })

    render(
      <MemoryRouter initialEntries={['/login']}>
        <PlatformProvider><App /></PlatformProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('option', { name: '方老师' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'private-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByText('正在同步学习数据', {}, { timeout: 10_000 })).toBeInTheDocument()

    act(() => authMock.listener?.('SIGNED_OUT'))
    expect(await screen.findByRole('heading', { name: '登录学习工作台' })).toBeInTheDocument()
    expect(screen.queryByText('正在同步学习数据')).not.toBeInTheDocument()

    await act(async () => resolveAuthenticatedBootstrap?.(teacherState('stale')))
    expect(screen.getByRole('heading', { name: '登录学习工作台' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '教学概览' })).not.toBeInTheDocument()
  })

  it('starts a fresh read for each ordinary refresh and ignores an older response', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: { user: { id: 'teacher' } } } })
    let bootstrapCalls = 0
    let resolveOlder: ((state: PlatformState) => void) | undefined
    let resolveNewer: ((state: PlatformState) => void) | undefined
    const older = new Promise<PlatformState>((resolve) => { resolveOlder = resolve })
    const newer = new Promise<PlatformState>((resolve) => { resolveNewer = resolve })

    invokeFunctionMock.mockImplementation((name: string) => {
      if (name !== 'bootstrap') return Promise.reject(new Error(`Unexpected function: ${name}`))
      bootstrapCalls += 1
      if (bootstrapCalls === 1) return Promise.resolve(teacherState('initial'))
      if (bootstrapCalls === 2) return older
      return newer
    })

    render(<PlatformProvider><ContextProbe /></PlatformProvider>)
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('initial'))
    expect(screen.getByTestId('initial-data-ready')).toHaveTextContent('true')

    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(bootstrapCalls).toBe(3)

    await act(async () => resolveNewer?.(teacherState('newer')))
    expect(screen.getByTestId('username')).toHaveTextContent('newer')
    await act(async () => resolveOlder?.(teacherState('older')))
    expect(screen.getByTestId('username')).toHaveTextContent('newer')
  })

  it('does not let a stale bootstrap restore an account after sign-out', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: { user: { id: 'teacher' } } } })
    let bootstrapCalls = 0
    let resolveStale: ((state: PlatformState) => void) | undefined
    const stale = new Promise<PlatformState>((resolve) => { resolveStale = resolve })
    invokeFunctionMock.mockImplementation((name: string) => {
      if (name !== 'bootstrap') return Promise.reject(new Error(`Unexpected function: ${name}`))
      bootstrapCalls += 1
      return bootstrapCalls === 1 ? Promise.resolve(teacherState()) : stale
    })

    render(<PlatformProvider><ContextProbe /></PlatformProvider>)
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'))
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(bootstrapCalls).toBe(2)

    act(() => authMock.listener?.('SIGNED_OUT'))
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
    expect(screen.getByTestId('username')).toBeEmptyDOMElement()

    await act(async () => resolveStale?.(teacherState('stale')))
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false')
    expect(screen.getByTestId('username')).toBeEmptyDOMElement()
  })

  it('keeps an authenticated workspace on a transient refresh failure and clears the warning after retry', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: { user: { id: 'teacher' } } } })
    let bootstrapCalls = 0
    invokeFunctionMock.mockImplementation((name: string) => {
      if (name !== 'bootstrap') return Promise.reject(new Error(`Unexpected function: ${name}`))
      bootstrapCalls += 1
      if (bootstrapCalls === 1) return Promise.resolve(teacherState('initial'))
      if (bootstrapCalls === 2) return Promise.reject(new Error('temporary network error'))
      return Promise.resolve(teacherState('recovered'))
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(<PlatformProvider><ContextProbe /></PlatformProvider>)
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('initial'))

    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(screen.getByTestId('sync-error')).toHaveTextContent('平台数据同步失败'))
    expect(screen.getByTestId('authenticated')).toHaveTextContent('true')
    expect(screen.getByTestId('username')).toHaveTextContent('initial')
    expect(screen.getByTestId('initial-data-ready')).toHaveTextContent('true')

    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(screen.getByTestId('username')).toHaveTextContent('recovered'))
    expect(screen.getByTestId('sync-error')).toBeEmptyDOMElement()
  })

  it('shows a bootstrap failure on the login form', async () => {
    invokeFunctionMock.mockImplementation((name: string, body?: { action?: string }) => {
      if (name === 'username-login') {
        if (body?.action === 'list_accounts') return Promise.resolve({ accounts: loginAccounts })
        return Promise.resolve({ accessToken: 'access-token', refreshToken: 'refresh-token' })
      }
      if (name === 'bootstrap') {
        return Promise.reject(new Error('平台数据加载失败'))
      }
      return Promise.reject(new Error(`Unexpected function: ${name}`))
    })
    authMock.setSession.mockImplementation(async () => {
      authMock.listener?.('SIGNED_IN')
      return { error: null }
    })

    render(
      <MemoryRouter initialEntries={['/login']}>
        <PlatformProvider><App /></PlatformProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '登录学习工作台' })).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: '方老师' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'private-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByText('平台数据加载失败')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '登录学习工作台' })).toBeInTheDocument()
  })
})
