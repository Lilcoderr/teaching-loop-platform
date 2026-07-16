import { ArrowRight, Eye, EyeOff, GraduationCap, LoaderCircle, LockKeyhole, NotebookTabs, ShieldCheck, UserRound, Users } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { usePlatform } from '../context/PlatformContext'
import { invokeFunction } from '../lib/supabase'
import type { Role } from '../types/domain'

interface LoginAccount {
  id: string
  role: Role
  label: string
  loginIdentifier: string
}

const ACCOUNT_CACHE_KEY = 'teaching-loop-login-accounts-v1'
const ACCOUNT_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

function readCachedAccounts(): LoginAccount[] {
  try {
    const cached = JSON.parse(sessionStorage.getItem(ACCOUNT_CACHE_KEY) ?? 'null') as { savedAt?: number; accounts?: LoginAccount[] } | null
    if (!cached?.savedAt || Date.now() - cached.savedAt > ACCOUNT_CACHE_MAX_AGE_MS || !Array.isArray(cached.accounts)) return []
    return cached.accounts.filter((account) =>
      typeof account.id === 'string' && typeof account.label === 'string' && typeof account.loginIdentifier === 'string'
      && ['teacher', 'student', 'parent'].includes(account.role),
    )
  } catch {
    return []
  }
}

const roleOptions = [
  { role: 'teacher', label: '老师', icon: ShieldCheck },
  { role: 'student', label: '学生', icon: GraduationCap },
  { role: 'parent', label: '家长', icon: Users },
] as const

function publicAccountLabel(role: Role, displayName: string) {
  const firstCharacter = Array.from(displayName.trim())[0] ?? ''
  if (!firstCharacter) return role === 'teacher' ? '老师' : role === 'parent' ? '学生家长' : '学生'
  if (role === 'student') return `${firstCharacter}同学`
  if (role === 'parent') return `${firstCharacter}同学家长`
  return `${firstCharacter}老师`
}

export function LoginPage() {
  const { state, signIn, demoMode, switchDemoUser } = usePlatform()
  const navigate = useNavigate()
  const [role, setRole] = useState<Role>('teacher')
  const [accounts, setAccounts] = useState<LoginAccount[]>(() => demoMode ? [] : readCachedAccounts())
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [accountsBusy, setAccountsBusy] = useState(() => demoMode || !readCachedAccounts().length)
  const [accountsError, setAccountsError] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hasAccountDirectory = useRef(accounts.length > 0)

  const loadAccounts = useCallback(async () => {
    if (!hasAccountDirectory.current) setAccountsBusy(true)
    setAccountsError('')
    try {
      if (demoMode) {
        setAccounts(state.accounts.filter((account) => account.status === 'active').map((account) => ({
          id: account.id,
          role: account.role,
          label: publicAccountLabel(account.role, account.displayName),
          loginIdentifier: account.username,
        })))
        return
      }
      const result = await invokeFunction<{ accounts: Array<Omit<LoginAccount, 'loginIdentifier'>> }>('username-login', { action: 'list_accounts' })
      const nextAccounts = result.accounts.map((account) => ({ ...account, loginIdentifier: account.id }))
      setAccounts(nextAccounts)
      hasAccountDirectory.current = true
      sessionStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), accounts: nextAccounts }))
    } catch {
      setAccountsError('暂时无法读取账号，请检查网络后重试')
    } finally {
      setAccountsBusy(false)
    }
  }, [demoMode, state.accounts])

  useEffect(() => { void loadAccounts() }, [loadAccounts])

  const roleAccounts = useMemo(() => accounts.filter((account) => account.role === role), [accounts, role])
  useEffect(() => {
    if (!roleAccounts.some((account) => account.id === selectedAccountId)) {
      setSelectedAccountId(roleAccounts[0]?.id ?? '')
    }
  }, [roleAccounts, selectedAccountId])

  const selectedAccount = roleAccounts.find((account) => account.id === selectedAccountId)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedAccount) return
    setBusy(true)
    setError('')
    try {
      await signIn(selectedAccount.loginIdentifier, password, {
        id: selectedAccount.id,
        role: selectedAccount.role,
        displayName: selectedAccount.label,
      })
      navigate(selectedAccount.role === 'teacher' ? '/teacher' : selectedAccount.role === 'student' ? '/student' : '/parent', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  const enterDemo = (role: 'teacher' | 'student' | 'parent') => {
    switchDemoUser(role)
    navigate(role === 'teacher' ? '/teacher' : role === 'student' ? '/student' : '/parent')
  }

  return (
    <div className="login-page">
      <section className="login-panel">
        <Brand />
        <div className="login-heading">
          <h1>登录学习工作台</h1>
          <p>使用老师分配的账号继续</p>
        </div>
        <form onSubmit={submit}>
          <fieldset className="login-role-picker">
            <legend>选择登录身份</legend>
            <div className="segmented-control" role="group" aria-label="登录身份">
              {roleOptions.map(({ role: value, label, icon: Icon }) => (
                <button type="button" className={role === value ? 'active' : ''} aria-pressed={role === value} onClick={() => { setRole(value); setPassword(''); setError('') }} key={value}>
                  <Icon size={16} />{label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span>账号</span>
            <div className="input-with-icon">
              <UserRound size={18} />
              <select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)} disabled={accountsBusy || !roleAccounts.length} autoComplete="username">
                {accountsBusy && <option value="">正在读取账号</option>}
                {!accountsBusy && !roleAccounts.length && <option value="">暂无可用账号</option>}
                {roleAccounts.map((account) => <option value={account.id} key={account.id}>{account.label}</option>)}
              </select>
            </div>
          </label>
          {accountsError && <div className="account-load-error"><span>{accountsError}</span><button type="button" onClick={() => void loadAccounts()}>重试</button></div>}
          <label className="field">
            <span>密码</span>
            <div className="input-with-icon">
              <LockKeyhole size={18} />
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="密码" />
              <button type="button" className="input-action" onClick={() => setShowPassword((value) => !value)} title={showPassword ? '隐藏密码' : '显示密码'}>
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="button primary wide" type="submit" disabled={busy || accountsBusy || !selectedAccount || !password}>
            {busy ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={18} />}登录
          </button>
        </form>
        {demoMode && (
          <div className="demo-entry">
            <span>本地演示</span>
            <div>
              <button type="button" onClick={() => enterDemo('teacher')}>教师</button>
              <button type="button" onClick={() => enterDemo('student')}>学生</button>
              <button type="button" onClick={() => enterDemo('parent')}>家长</button>
            </div>
          </div>
        )}
      </section>
      <aside className="login-aside">
        <div className="login-mark"><NotebookTabs size={36} /></div>
        <blockquote>把每一次错误变成下一次备课的依据。</blockquote>
        <div className="login-metrics">
          <span><strong>作业</strong><small>完整留痕</small></span>
          <span><strong>错题</strong><small>定期复习</small></span>
          <span><strong>答疑</strong><small>因材施教</small></span>
        </div>
      </aside>
    </div>
  )
}
