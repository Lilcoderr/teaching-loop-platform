import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'

const updateSettings = vi.fn()

vi.mock('../../context/PlatformContext', () => ({
  usePlatform: () => ({
    state: {
      settings: {
        aiEnabled: false,
        textProvider: 'openai-compatible',
        visionProvider: 'openai-compatible',
        embeddingProvider: 'openai-compatible',
        dailyStudentMessageLimit: 30,
        maxUploadMb: 15,
      },
    },
    updateSettings,
    demoMode: false,
    resetDemo: vi.fn(),
  }),
}))

describe('AI provider status', () => {
  it('does not claim that a provider is connected when the browser cannot verify server secrets', async () => {
    const user = userEvent.setup()
    render(<SettingsPage />)

    expect(screen.queryByText('已连接')).not.toBeInTheDocument()
    expect(screen.getAllByText('未启用')).toHaveLength(3)

    await user.click(screen.getByRole('checkbox', { name: /启用 AI 分析与答疑/ }))

    expect(screen.getAllByText('待服务端验证')).toHaveLength(3)
    expect(screen.queryByText('已连接')).not.toBeInTheDocument()
  })
})
