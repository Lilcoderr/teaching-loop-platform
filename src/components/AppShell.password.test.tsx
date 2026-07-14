import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { PlatformProvider } from '../context/PlatformContext'

describe('password settings', () => {
  beforeEach(() => localStorage.clear())

  it('lets every signed-in role open the password dialog', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/teacher']}>
        <PlatformProvider><App /></PlatformProvider>
      </MemoryRouter>,
    )

    const roleSelect = await screen.findByLabelText('演示视角')
    expect(screen.getAllByRole('button', { name: '修改密码' })).not.toHaveLength(0)

    await user.selectOptions(roleSelect, 'student')
    expect(screen.getAllByRole('button', { name: '修改密码' })).not.toHaveLength(0)

    await user.selectOptions(roleSelect, 'parent')
    expect(screen.getAllByRole('button', { name: '修改密码' })).not.toHaveLength(0)
  })

  it('validates confirmation and updates the current account password', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/teacher']}>
        <PlatformProvider><App /></PlatformProvider>
      </MemoryRouter>,
    )

    await user.click((await screen.findAllByRole('button', { name: '修改密码' }))[0])
    const dialog = screen.getByRole('dialog', { name: '修改密码' })
    const currentPassword = within(dialog).getByLabelText('当前密码')
    const newPassword = within(dialog).getByLabelText('新密码')
    const confirmation = within(dialog).getByLabelText('再次输入新密码')
    const submit = within(dialog).getByRole('button', { name: '确认新密码' })

    fireEvent.change(currentPassword, { target: { value: 'current-password-2026' } })
    fireEvent.change(newPassword, { target: { value: 'new-password-2026' } })
    fireEvent.change(confirmation, { target: { value: 'different-password' } })
    await user.click(submit)
    expect(within(dialog).getByText('两次输入的密码不一致')).toBeInTheDocument()

    fireEvent.change(confirmation, { target: { value: 'new-password-2026' } })
    await user.click(submit)
    expect(await within(dialog).findByText('密码已修改，请在下次登录时使用新密码')).toBeInTheDocument()
  })
})
