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
  const { authenticated, refresh, state } = usePlatform()
  return (
    <>
      <span data-testid="authenticated">{String(authenticated)}</span>
      <span data-testid="username">{state.currentUser.username}</span>
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

  it('keeps the login form mounted while one shared bootstrap finishes', async () => {
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
        if (bootstrapCalls === 1) return Promise.reject(new Error('Unauthorized'))
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

    await waitFor(() => expect(bootstrapCalls).toBe(2))
    expect(screen.getByRole('heading', { name: '登录学习工作台' })).toBeInTheDocument()
    expect(screen.queryByText('正在载入工作台')).not.toBeInTheDocument()
    expect(screen.getByLabelText('账号')).toHaveDisplayValue('方老师')

    await act(async () => resolveAuthenticatedBootstrap?.(teacherState()))

    expect(await screen.findByRole('heading', { name: '教学概览' })).toBeInTheDocument()
    expect(invokeFunctionMock.mock.calls.filter(([name]) => name === 'bootstrap')).toHaveLength(2)
  })

  it('starts a fresh read for each ordinary refresh and ignores an older response', async () => {
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

    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    await userEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(bootstrapCalls).toBe(3)

    await act(async () => resolveNewer?.(teacherState('newer')))
    expect(screen.getByTestId('username')).toHaveTextContent('newer')
    await act(async () => resolveOlder?.(teacherState('older')))
    expect(screen.getByTestId('username')).toHaveTextContent('newer')
  })

  it('does not let a stale bootstrap restore an account after sign-out', async () => {
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

  it('shows a bootstrap failure on the login form', async () => {
    let bootstrapCalls = 0
    invokeFunctionMock.mockImplementation((name: string, body?: { action?: string }) => {
      if (name === 'username-login') {
        if (body?.action === 'list_accounts') return Promise.resolve({ accounts: loginAccounts })
        return Promise.resolve({ accessToken: 'access-token', refreshToken: 'refresh-token' })
      }
      if (name === 'bootstrap') {
        bootstrapCalls += 1
        return Promise.reject(new Error(bootstrapCalls === 1 ? 'Unauthorized' : '平台数据加载失败'))
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
