import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, NotebookTabs, UserRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { usePlatform } from '../context/PlatformContext'

export function LoginPage() {
  const { signIn, demoMode, switchDemoUser } = usePlatform()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(username, password)
      if (demoMode) navigate('/', { replace: true })
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
          <label className="field">
            <span>账号</span>
            <div className="input-with-icon"><UserRound size={18} /><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="用户名" /></div>
          </label>
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
          <button className="button primary wide" type="submit" disabled={busy || !username.trim() || !password}>
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
