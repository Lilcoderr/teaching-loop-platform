import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { PlatformProvider } from '../context/PlatformContext'
import { LoginPage } from './LoginPage'

describe('login page', () => {
  beforeEach(() => localStorage.clear())

  it('selects a role and named account while keeping the password empty', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <PlatformProvider><LoginPage /></PlatformProvider>
      </MemoryRouter>,
    )

    const rolePicker = screen.getByRole('group', { name: '登录身份' })
    const account = screen.getByLabelText('账号')
    const password = screen.getByLabelText('密码')
    const submit = screen.getByRole('button', { name: '登录' })

    expect(within(rolePicker).getByRole('button', { name: '老师' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByRole('option', { name: '陈老师' })).toBeInTheDocument()
    expect(account).toHaveDisplayValue('陈老师')
    expect(password).toHaveValue('')
    expect(password).toHaveAttribute('placeholder', '密码')
    expect(submit).toBeDisabled()

    await user.type(password, 'a-private-password')

    expect(password).toHaveValue('a-private-password')
    expect(submit).toBeEnabled()

    await user.click(within(rolePicker).getByRole('button', { name: '学生' }))
    expect(account).toHaveDisplayValue('林同学')
    expect(screen.getByRole('option', { name: '周同学' })).toBeInTheDocument()
    expect(password).toHaveValue('')

    await user.click(within(rolePicker).getByRole('button', { name: '家长' }))
    expect(account).toHaveDisplayValue('林同学家长')
    expect(screen.queryByText('lin-parent')).not.toBeInTheDocument()
  })
})
