import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { PlatformProvider } from './context/PlatformContext'
import { demoState } from './data/demo'

describe('application shell', () => {
  beforeEach(() => localStorage.clear())

  it('opens the teacher workspace with fictional demo data', async () => {
    render(
      <MemoryRouter initialEntries={['/teacher']}>
        <PlatformProvider><App /></PlatformProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '教学概览' })).toBeInTheDocument()
    expect(screen.getByText('林晓舟')).toBeInTheDocument()
    expect(screen.getByText('周予安')).toBeInTheDocument()
  })

  it('redirects a teacher away from a student-only route', async () => {
    render(
      <MemoryRouter initialEntries={['/student/upload']}>
        <PlatformProvider><App /></PlatformProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '教学概览' })).toBeInTheDocument()
  })

  it('keeps the login form available in local demo mode', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <PlatformProvider><App /></PlatformProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '登录学习工作台' })).toBeInTheDocument()
  })

  it('fills new model-readiness fields when loading an older persisted demo state', async () => {
    const staleState = structuredClone(demoState)
    const staleSettings = staleState.settings as unknown as Record<string, unknown>
    for (const field of [
      'textModel',
      'visionModel',
      'embeddingModel',
      'textModelConfigured',
      'visionModelConfigured',
      'embeddingModelConfigured',
    ]) delete staleSettings[field]
    localStorage.setItem('teaching-loop-demo-v1', JSON.stringify({ version: 4, state: staleState }))

    render(
      <MemoryRouter initialEntries={['/teacher/settings']}>
        <PlatformProvider><App /></PlatformProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '平台设置' })).toBeInTheDocument()
    expect(screen.getByText('演示响应')).toBeInTheDocument()
    expect(screen.getByText('演示图片流程')).toBeInTheDocument()
    expect(screen.getAllByText('演示模式')).toHaveLength(3)
  })
})
