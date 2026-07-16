import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  demoMode: false,
  settings: {
    aiEnabled: false,
    textProvider: 'openai-compatible',
    visionProvider: 'openai-compatible',
    embeddingProvider: 'openai-compatible',
    textModel: 'deepseek-chat',
    visionModel: 'qwen-vl-plus',
    embeddingModel: 'text-embedding-v3',
    textModelConfigured: true,
    visionModelConfigured: false,
    embeddingModelConfigured: false,
    dailyStudentMessageLimit: 30,
    maxUploadMb: 15,
  },
  invokeFunction: vi.fn(),
}))

vi.mock('../../context/PlatformContext', () => ({
  usePlatform: () => ({
    state: { settings: mocks.settings },
    updateSettings: mocks.updateSettings,
    demoMode: mocks.demoMode,
    resetDemo: vi.fn(),
  }),
}))

vi.mock('../../lib/supabase', () => ({ invokeFunction: mocks.invokeFunction }))

describe('AI provider status', () => {
  beforeEach(() => {
    mocks.demoMode = false
    mocks.settings.aiEnabled = false
    mocks.settings.textModelConfigured = true
    mocks.settings.visionModelConfigured = false
    mocks.settings.embeddingModelConfigured = false
    mocks.invokeFunction.mockReset()
  })

  it('shows effective model names and server-computed readiness', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)

    expect(screen.getByText(/deepseek-chat/)).toBeInTheDocument()
    expect(screen.getByText(/qwen-vl-plus/)).toBeInTheDocument()
    expect(screen.getAllByText('未启用')).toHaveLength(3)

    await user.click(screen.getByRole('checkbox', { name: /启用 AI 分析与答疑/ }))

    expect(screen.getByText('配置已检测')).toBeInTheDocument()
    expect(screen.getByText('缺少服务端密钥')).toBeInTheDocument()
    expect(screen.getByText('未配置（关键词检索）')).toBeInTheDocument()
    expect(screen.queryByText('待服务端验证')).not.toBeInTheDocument()
  })

  it('labels all model rows as demonstration-only in demo mode', () => {
    mocks.demoMode = true
    mocks.settings.aiEnabled = true
    render(<SettingsPage />)

    expect(screen.getAllByText('演示模式')).toHaveLength(3)
  })

  it('runs a real server-side text model health check without exposing a key field', async () => {
    mocks.settings.aiEnabled = true
    mocks.invokeFunction.mockResolvedValueOnce({ ok: true, model: 'deepseek-chat', latencyMs: 428 })
    const user = userEvent.setup()
    render(<SettingsPage />)

    expect(screen.queryByLabelText(/API Key/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '检测文本模型' }))

    expect(mocks.invokeFunction).toHaveBeenCalledWith('settings', { action: 'health_check' })
    expect(await screen.findByText('连接检测通过 · deepseek-chat · 428 ms')).toBeInTheDocument()
  })
})
