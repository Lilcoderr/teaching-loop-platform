import { Download, KeyRound, MoreHorizontal, Plus, ShieldCheck, Trash2, UserRound, Users } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { usePlatform } from '../../context/PlatformContext'
import { relativeTime } from '../../lib/utils'
import { subjectLabels } from '../../lib/utils'
import type { AccountRecord, Subject } from '../../types/domain'

export function AccountsPage() {
  const { state, createAccount, manageAccount, exportStudentMemory, requestStudentDeletion, deleteStudentData } = usePlatform()
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<'student' | 'parent'>('student')
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [linkedStudentId, setLinkedStudentId] = useState(state.students[0]?.id ?? '')
  const [grade, setGrade] = useState('准高三')
  const [subjects, setSubjects] = useState<Subject[]>(['math'])
  const [targetScore, setTargetScore] = useState('110')
  const [consentDate, setConsentDate] = useState(new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')
  const [selectedAccount, setSelectedAccount] = useState<AccountRecord | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [accountMessage, setAccountMessage] = useState('')
  const [deletionReason, setDeletionReason] = useState('监护人提出删除申请')
  const [deletionRequestId, setDeletionRequestId] = useState('')
  const [deletionConfirmation, setDeletionConfirmation] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!displayName.trim() || !username.trim() || password.length < 8) return setError('请完整填写，临时密码至少 8 位')
    if (role === 'student' && (!consentDate || !subjects.length)) return setError('学生账号必须记录监护人知情日期并选择至少一个科目')
    await createAccount({
      role,
      displayName: displayName.trim(),
      username: username.trim(),
      avatarColor: role === 'student' ? '#2563eb' : '#7c3aed',
      status: 'active',
      linkedStudentIds: role === 'parent' && linkedStudentId ? [linkedStudentId] : [],
      ...(role === 'student' ? {
        grade,
        subjects,
        targetScore: targetScore ? Number(targetScore) : undefined,
        guardianConsentAt: new Date(`${consentDate}T12:00:00`).toISOString(),
      } : {}),
    }, password)
    setOpen(false); setDisplayName(''); setUsername(''); setPassword('')
  }

  return (
    <>
      <PageHeader title="账号管理" description="学生和家长账号由教师创建，首次登录后修改密码。" actions={<button className="button primary" type="button" onClick={() => setOpen(true)}><Plus size={16} /><span>新建账号</span></button>} />
      <section className="panel account-table-panel">
        <div className="panel-header"><div><h2>全部账号</h2><p>共 {state.accounts.length} 个</p></div></div>
        <div className="table-scroll">
          <table className="data-table account-table">
            <thead><tr><th>用户</th><th>角色</th><th>账号</th><th>关联学生</th><th>最近活动</th><th>状态</th><th aria-label="操作" /></tr></thead>
            <tbody>{state.accounts.map((account) => <tr key={account.id}><td><div className="account-cell"><Avatar name={account.displayName} color={account.avatarColor} size="sm" /><strong>{account.displayName}</strong></div></td><td><span className={`role-badge role-${account.role}`}>{account.role === 'teacher' ? '教师' : account.role === 'student' ? '学生' : '家长'}</span></td><td>{account.username}</td><td>{account.linkedStudentIds.map((id) => state.students.find((item) => item.id === id)?.displayName).filter(Boolean).join('、') || '--'}</td><td>{account.lastActiveAt ? relativeTime(account.lastActiveAt) : '尚未登录'}</td><td>{account.status === 'active' ? <span className="active-state"><ShieldCheck size={14} />正常</span> : <span className="inactive-state">已停用</span>}</td><td><button type="button" className="icon-button" onClick={() => { setSelectedAccount(account); setNewPassword(''); setAccountMessage(''); setDeletionRequestId(''); setDeletionConfirmation('') }} title="账号操作"><MoreHorizontal size={16} /></button></td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <Modal open={open} title="新建账号" onClose={() => setOpen(false)} footer={<><button className="button" type="button" onClick={() => setOpen(false)}>取消</button><button className="button primary" type="submit" form="account-form"><Plus size={15} />创建</button></>}>
        <form id="account-form" className="form-grid" onSubmit={submit}>
          <div className="field full"><span>账号角色</span><div className="segmented-control"><button type="button" className={role === 'student' ? 'active' : ''} onClick={() => setRole('student')}><UserRound size={14} />学生</button><button type="button" className={role === 'parent' ? 'active' : ''} onClick={() => setRole('parent')}><Users size={14} />家长</button></div></div>
          <label className="field full"><span>显示名称</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label className="field"><span>登录账号</span><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" /></label>
          <label className="field"><span>临时密码</span><div className="input-with-icon"><KeyRound size={17} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></div></label>
          {role === 'parent' ? <label className="field full"><span>关联学生</span><select value={linkedStudentId} onChange={(event) => setLinkedStudentId(event.target.value)}>{state.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></label> : <>
            <label className="field"><span>年级</span><input value={grade} onChange={(event) => setGrade(event.target.value)} /></label>
            <label className="field"><span>目标分（可选）</span><input type="number" min="0" max="750" value={targetScore} onChange={(event) => setTargetScore(event.target.value)} /></label>
            <div className="field full"><span>辅导科目</span><div className="subject-checks">{(['math', 'physics', 'chemistry'] as Subject[]).map((subject) => <label key={subject}><input type="checkbox" checked={subjects.includes(subject)} onChange={(event) => setSubjects((current) => event.target.checked ? [...current, subject] : current.filter((item) => item !== subject))} />{subjectLabels[subject]}</label>)}</div></div>
            <label className="field full"><span>监护人知情日期</span><input type="date" value={consentDate} onChange={(event) => setConsentDate(event.target.value)} /></label>
          </>}
          {error && <p className="form-error full">{error}</p>}
        </form>
      </Modal>

      <Modal open={Boolean(selectedAccount)} title="账号操作" onClose={() => setSelectedAccount(null)}>
        {selectedAccount && <div className="account-actions-panel">
          <div className="account-action-user"><Avatar name={selectedAccount.displayName} color={selectedAccount.avatarColor} /><div><strong>{selectedAccount.displayName}</strong><span>{selectedAccount.username}</span></div></div>
          {selectedAccount.role !== 'teacher' && <div className="account-action-block"><label className="field"><span>设置新的临时密码</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 8 位" /></label><button type="button" className="button" disabled={newPassword.length < 8} onClick={async () => { await manageAccount(selectedAccount.id, 'reset_password', newPassword); setAccountMessage('临时密码已更新'); setNewPassword('') }}><KeyRound size={15} />重置密码</button></div>}
          <div className="account-action-block"><div><strong>{selectedAccount.status === 'active' ? '停用账号' : '恢复账号'}</strong><p>停用后无法登录，历史学习数据继续保留。</p></div><button type="button" className={selectedAccount.status === 'active' ? 'button danger' : 'button'} onClick={async () => { const status = selectedAccount.status === 'active' ? 'disabled' : 'active'; await manageAccount(selectedAccount.id, 'set_status', status); setSelectedAccount({ ...selectedAccount, status }); setAccountMessage(status === 'active' ? '账号已恢复' : '账号已停用') }}>{selectedAccount.status === 'active' ? '停用' : '恢复'}</button></div>
          {selectedAccount.role === 'student' && <>
            <div className="account-action-block"><div><strong>导出已确认学情</strong><p>生成 Markdown，不包含 AI 推测和原始聊天。</p></div><button type="button" className="button" onClick={async () => { const file = await exportStudentMemory(selectedAccount.id); const url = URL.createObjectURL(new Blob([file.markdown], { type: 'text/markdown;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = file.fileName; link.click(); URL.revokeObjectURL(url) }}><Download size={15} />导出</button></div>
            <div className="deletion-zone">
              <div><Trash2 size={17} /><span><strong>学生数据删除</strong><small>先建立申请，再输入账号确认永久删除。</small></span></div>
              {!deletionRequestId ? <><label className="field"><span>删除原因</span><input value={deletionReason} onChange={(event) => setDeletionReason(event.target.value)} /></label><button type="button" className="button danger" disabled={!deletionReason.trim()} onClick={async () => setDeletionRequestId(await requestStudentDeletion(selectedAccount.id, deletionReason))}>建立删除申请</button></> : <><p>确认文本：<code>DELETE:{selectedAccount.username}</code></p><input className="text-input" value={deletionConfirmation} onChange={(event) => setDeletionConfirmation(event.target.value)} placeholder={`DELETE:${selectedAccount.username}`} /><button type="button" className="button danger" disabled={deletionConfirmation !== `DELETE:${selectedAccount.username}`} onClick={async () => { await deleteStudentData(selectedAccount.id, deletionRequestId, deletionConfirmation); setSelectedAccount(null) }}><Trash2 size={15} />永久删除学生数据</button></>}
            </div>
          </>}
          {accountMessage && <p className="form-success">{accountMessage}</p>}
        </div>}
      </Modal>
    </>
  )
}
