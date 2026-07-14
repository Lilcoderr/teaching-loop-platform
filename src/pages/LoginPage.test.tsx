import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { PlatformProvider } from '../context/PlatformContext'
import { LoginPage } from './LoginPage'

describe('login page', () => {
  beforeEach(() => localStorage.clear())

  it('starts with empty conventional credential fields', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <PlatformProvider><LoginPage /></PlatformProvider>
      </MemoryRouter>,
    )

    const username = screen.getByRole('textbox', { name: '账号' })
    const password = screen.getByLabelText('密码')
    const submit = screen.getByRole('button', { name: '登录' })

    expect(username).toHaveValue('')
    expect(username).toHaveAttribute('placeholder', '用户名')
    expect(password).toHaveValue('')
    expect(password).toHaveAttribute('placeholder', '密码')
    expect(submit).toBeDisabled()

    await user.type(username, 'waynechen')
    await user.type(password, 'a-private-password')

    expect(username).toHaveValue('waynechen')
    expect(password).toHaveValue('a-private-password')
    expect(submit).toBeEnabled()
  })
})
