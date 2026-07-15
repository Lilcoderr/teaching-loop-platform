import {
  BarChart3,
  AlertTriangle,
  BookOpenCheck,
  Bot,
  ClipboardCheck,
  FileClock,
  FileQuestion,
  FileUp,
  GraduationCap,
  Home,
  Library,
  KeyRound,
  LoaderCircle,
  LogOut,
  MessageSquare,
  NotebookTabs,
  RefreshCw,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Suspense, type FormEvent, useEffect, useRef, useState } from 'react'
import { usePlatform } from '../context/PlatformContext'
import { revealActiveMobileNav } from '../lib/mobileNavigation'
import type { Role } from '../types/domain'
import { Avatar } from './Avatar'
import { Brand } from './Brand'
import { Modal } from './Modal'
import { RouteErrorBoundary } from './RouteErrorBoundary'

const roleLabels: Record<Role, string> = { teacher: '教师端', student: '学生端', parent: '家长端' }

const navByRole = {
  teacher: [
    { to: '/teacher', label: '概览', icon: BarChart3, end: true },
    { to: '/teacher/review', label: '作业批改', icon: ClipboardCheck },
    { to: '/teacher/students', label: '学生', icon: GraduationCap },
    { to: '/teacher/question-bank', label: '学生错题库', icon: BookOpenCheck },
    { to: '/teacher/knowledge', label: '学习资料', icon: Library },
    { to: '/teacher/reports', label: '周报', icon: FileClock },
    { to: '/teacher/accounts', label: '账号', icon: Users },
    { to: '/teacher/settings', label: '设置', icon: Settings },
  ],
  student: [
    { to: '/student', label: '今日', icon: Home, end: true },
    { to: '/student/upload', label: '交作业', icon: FileUp },
    { to: '/student/wrong-upload', label: '传错题', icon: FileQuestion },
    { to: '/student/resources', label: '学习资料', icon: Library },
    { to: '/student/mistakes', label: '错题本', icon: NotebookTabs },
    { to: '/student/tutor', label: 'AI 答疑', icon: Bot },
    { to: '/student/messages', label: '留言', icon: MessageSquare },
  ],
  parent: [{ to: '/parent', label: '学习周报', icon: BookOpenCheck, end: true }],
} as const

export function AppShell() {
  const { state, demoMode, switchDemoUser, signOut, initialSyncPending, initialDataReady, syncError, refresh } = usePlatform()
  const navigate = useNavigate()
  const location = useLocation()
  const role = state.currentUser.role
  const items = navByRole[role]
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [syncRetrying, setSyncRetrying] = useState(false)
  const mobileNavRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const nav = mobileNavRef.current
    if (!nav || typeof window.matchMedia !== 'function') return
    revealActiveMobileNav(nav, window.matchMedia('(max-width: 760px)').matches)
  }, [location.pathname, role])

  const retrySync = async () => {
    if (syncRetrying) return
    setSyncRetrying(true)
    try {
      await refresh()
    } finally {
      setSyncRetrying(false)
    }
  }

  const changeRole = (nextRole: Role) => {
    switchDemoUser(nextRole)
    navigate(nextRole === 'teacher' ? '/teacher' : nextRole === 'student' ? '/student' : '/parent')
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-role">
          <Avatar name={state.currentUser.displayName} color={state.currentUser.avatarColor} />
          <div><strong>{state.currentUser.displayName}</strong><small>{roleLabels[role]}</small></div>
        </div>
        <nav aria-label="主导航">
          {items.map(({ to, label, icon: Icon, ...rest }) => (
            <NavLink key={to} to={to} end={'end' in rest ? rest.end : false} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={18} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {demoMode && (
            <label className="demo-role-select">
              <span><ShieldCheck size={15} />演示视角</span>
              <select value={role} onChange={(event) => changeRole(event.target.value as Role)}>
                <option value="teacher">教师</option>
                <option value="student">学生</option>
                <option value="parent">家长</option>
              </select>
            </label>
          )}
          <button type="button" className="sidebar-signout" onClick={() => setPasswordOpen(true)}><KeyRound size={17} />修改密码</button>
          <button type="button" className="sidebar-signout" onClick={() => void signOut()}><LogOut size={17} />退出登录</button>
        </div>
      </aside>

      <div className="main-column">
        <header className="mobile-header">
          <Brand compact />
          <div>
            {demoMode && <span className="demo-badge">演示</span>}
            <Avatar name={state.currentUser.displayName} color={state.currentUser.avatarColor} size="sm" />
            <button type="button" className="icon-button" onClick={() => setPasswordOpen(true)} title="修改密码"><KeyRound size={17} /></button>
            <button type="button" className="icon-button mobile-signout" onClick={() => void signOut()} title="退出登录"><LogOut size={17} /></button>
          </div>
        </header>
        {syncError && initialDataReady && <div className="sync-error-banner" role="alert"><AlertTriangle size={18} /><span>{syncError}</span><button type="button" onClick={() => void retrySync()} disabled={syncRetrying}><RefreshCw className={syncRetrying ? 'spin' : undefined} size={16} />重试</button></div>}
        <main key={location.pathname} className="main-content">
          {initialSyncPending
            ? <div className="app-loading route-loading initial-sync-state" role="status" aria-live="polite"><LoaderCircle className="spin" size={28} /><strong>正在同步学习数据</strong><span>账号已登录，完成后会自动显示最新内容。</span></div>
            : !initialDataReady
              ? (
                  <section className="route-error initial-sync-failure" role="alert">
                    <span className="route-error-mark"><AlertTriangle size={24} /></span>
                    <h2>首次数据同步失败</h2>
                    <p>{syncError || '暂时无法读取学习数据，请重新同步。'}</p>
                    <button type="button" className="button primary" onClick={() => void retrySync()} disabled={syncRetrying}><RefreshCw className={syncRetrying ? 'spin' : undefined} size={16} />{syncRetrying ? '正在重试' : '重新同步'}</button>
                  </section>
                )
            : (
                <RouteErrorBoundary>
                  <Suspense fallback={<div className="app-loading route-loading"><LoaderCircle className="spin" size={28} /><span>正在打开页面</span></div>}>
                    <Outlet />
                  </Suspense>
                </RouteErrorBoundary>
              )}
        </main>
      </div>

      <nav ref={mobileNavRef} className="mobile-nav" aria-label="移动端导航">
        {items.map(({ to, label, icon: Icon, ...rest }) => (
          <NavLink key={to} to={to} end={'end' in rest ? rest.end : false} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon size={20} /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
      {passwordOpen && <ChangePasswordDialog onClose={() => setPasswordOpen(false)} />}
      <PasswordGate />
    </div>
  )
}

function PasswordForm({ onSuccess }: { onSuccess?: () => void }) {
  const { changePassword } = usePlatform()
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!currentPassword) return setError('请输入当前密码')
    if (password.length < 10) return setError('新密码至少 10 位')
    if (password === currentPassword) return setError('新密码不能与当前密码相同')
    if (password !== confirm) return setError('两次输入的密码不一致')
    setBusy(true)
    try {
      await changePassword(currentPassword, password)
      setCurrentPassword('')
      setPassword('')
      setConfirm('')
      setSuccess('密码已修改，请在下次登录时使用新密码')
      onSuccess?.()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '密码更新失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="password-gate" onSubmit={submit}>
      <div className="password-gate-mark"><KeyRound size={20} /><div><strong>设置仅自己知道的新密码</strong><span>新密码至少 10 位，不要与其他网站共用。</span></div></div>
      <label className="field"><span>当前密码</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
      <label className="field"><span>新密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>
      <label className="field"><span>再次输入新密码</span><input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" /></label>
      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-success">{success}</p>}
      <button className="button primary wide" type="submit" disabled={busy || password.length < 10}><ShieldCheck size={16} />{busy ? '正在更新' : '确认新密码'}</button>
    </form>
  )
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  return <Modal open title="修改密码" onClose={onClose}><PasswordForm /></Modal>
}

function PasswordGate() {
  const { state } = usePlatform()

  return (
    <Modal open={Boolean(state.currentUser.mustChangePassword)} title="设置新密码" onClose={() => undefined} dismissible={false}>
      <PasswordForm />
    </Modal>
  )
}
