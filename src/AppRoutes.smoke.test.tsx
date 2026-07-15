import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PlatformProvider } from './context/PlatformContext'
import { demoParent, demoState, demoStudents, demoTeacher } from './data/demo'
import type { Role } from './types/domain'

function saveDemoRole(role: Role) {
  const state = structuredClone(demoState)
  state.currentUser = role === 'student' ? demoStudents[0] : role === 'parent' ? demoParent : demoTeacher
  localStorage.setItem('teaching-loop-demo-v1', JSON.stringify({ version: 4, state }))
}

function renderRoute(role: Role, route: string) {
  saveDemoRole(role)
  return render(
    <MemoryRouter initialEntries={[route]}>
      <PlatformProvider><App /></PlatformProvider>
    </MemoryRouter>,
  )
}

describe('all role routes render in the real application shell', () => {
  beforeEach(() => {
    localStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
  })

  it.each([
    ['/teacher', '教学概览'],
    ['/teacher/review', '作业批改'],
    ['/teacher/students', '学生学情'],
    ['/teacher/question-bank', '学生错题库'],
    ['/teacher/knowledge', '学习资料'],
    ['/teacher/reports', '家长周报'],
    ['/teacher/accounts', '账号管理'],
    ['/teacher/settings', '平台设置'],
  ])('renders teacher route %s', async (route, heading) => {
    renderRoute('teacher', route)
    expect(await screen.findByRole('heading', { name: heading, level: 1 }, { timeout: 5000 })).toBeInTheDocument()
  })

  it.each([
    ['/student', /今天好/],
    ['/student/upload', '提交今日作业'],
    ['/student/wrong-upload', '上传错题或不会的题'],
    ['/student/resources', '学习资料'],
    ['/student/mistakes', '我的错题'],
    ['/student/tutor', '个性化答疑'],
    ['/student/messages', '给老师留言'],
  ])('renders student route %s', async (route, heading) => {
    renderRoute('student', route)
    expect(await screen.findByRole('heading', { name: heading, level: 1 }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('renders the parent report route', async () => {
    renderRoute('parent', '/parent')
    expect(await screen.findByRole('heading', { name: '学习周报', level: 1 }, { timeout: 5000 })).toBeInTheDocument()
  })
})
