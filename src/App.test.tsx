import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { PlatformProvider } from './context/PlatformContext'

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
})
