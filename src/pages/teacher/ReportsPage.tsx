import { Download, FileClock, LoaderCircle, Plus, Save, Send, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { usePlatform } from '../../context/PlatformContext'
import { formatShortDate, localDateKey, uniqueId } from '../../lib/utils'
import type { WeeklyReport } from '../../types/domain'

function lines(value: string) {
  return value.split('\n').map((item) => item.trim()).filter(Boolean)
}

export function ReportsPage() {
  const { state, generateReportDraft, saveReport, publishReport } = usePlatform()
  const [studentId, setStudentId] = useState(state.students[0]?.id ?? '')
  const reports = useMemo(() => state.reports.filter((item) => item.studentId === studentId), [state.reports, studentId])
  const [selectedId, setSelectedId] = useState(reports[0]?.id ?? '')
  const selected = reports.find((item) => item.id === selectedId) ?? reports[0]
  const [editing, setEditing] = useState<WeeklyReport | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')

  const open = (report: WeeklyReport) => { setSelectedId(report.id); setEditing(structuredClone(report)); setError('') }
  const create = () => {
    const end = new Date()
    const start = new Date(end); start.setDate(start.getDate() - 6)
    const student = state.students.find((item) => item.id === studentId)
    setEditing({ id: uniqueId('report'), studentId, periodStart: localDateKey(start), periodEnd: localDateKey(end), title: '本周学习周报', summary: `${student?.displayName ?? '学生'}本周学情待教师整理。`, progress: [], concerns: [], nextActions: [], status: 'draft' })
    setError('')
  }

  const createAiDraft = async () => {
    if (!studentId || drafting || saving || publishing) return
    setDrafting(true)
    setError('')
    try {
      setEditing(await generateReportDraft(studentId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI 周报起草失败，请稍后重试')
    } finally {
      setDrafting(false)
    }
  }

  const save = async () => {
    if (!editing || drafting || saving || publishing) return
    setSaving(true)
    setError('')
    try {
      await saveReport(editing)
      setSelectedId(editing.id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '周报保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  const publish = async (reportId: string) => {
    if (drafting || saving || publishing) return
    setPublishing(true)
    setError('')
    try {
      await publishReport(reportId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '周报发布失败，请稍后重试')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <>
      <PageHeader title="家长周报" description="只有教师确认并发布的内容对家长可见。" actions={<><button className="button" type="button" onClick={() => window.print()}><Download size={16} /><span>打印当前</span></button><button className="button" type="button" onClick={() => void createAiDraft()} disabled={drafting || saving || publishing || !studentId}>{drafting ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}<span>AI 起草</span></button><button className="button primary" type="button" onClick={create} disabled={drafting || saving || publishing || !studentId}><Plus size={16} /><span>新建周报</span></button></>} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="reports-layout">
        <aside className="report-list panel">
          <div className="report-student-select"><select value={studentId} disabled={drafting || saving || publishing} onChange={(event) => { setStudentId(event.target.value); setSelectedId(''); setEditing(null); setError('') }}>{state.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}</select></div>
          {reports.map((report) => <button type="button" className={selected?.id === report.id ? 'active' : ''} onClick={() => open(report)} disabled={drafting || saving || publishing} key={report.id}><span><FileClock size={17} /></span><div><strong>{report.title}</strong><small>{formatShortDate(report.periodStart)} - {formatShortDate(report.periodEnd)}</small></div><i className={`report-status ${report.status}`}>{report.status === 'published' ? '已发布' : '草稿'}</i></button>)}
        </aside>
        <section className="report-editor panel">
          {!editing && selected ? <ReportPreview report={selected} onEdit={() => setEditing(structuredClone(selected))} onPublish={() => void publish(selected.id)} publishing={publishing} /> : editing ? (
            <div className="report-form">
              <div className="report-form-toolbar"><span>{editing.status === 'published' ? '已发布版本' : '编辑草稿'}</span><div><button className="button" type="button" onClick={() => setEditing(null)} disabled={saving}>取消</button><button className="button primary" type="button" onClick={() => void save()} disabled={saving || drafting || publishing}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? '正在保存' : '保存'}</button></div></div>
              <div className="panel-body form-grid">
                <label className="field full"><span>标题</span><input value={editing.title} disabled={saving} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
                <label className="field"><span>开始日期</span><input type="date" value={editing.periodStart.slice(0, 10)} disabled={saving} onChange={(event) => setEditing({ ...editing, periodStart: new Date(`${event.target.value}T12:00:00`).toISOString() })} /></label>
                <label className="field"><span>结束日期</span><input type="date" value={editing.periodEnd.slice(0, 10)} disabled={saving} onChange={(event) => setEditing({ ...editing, periodEnd: new Date(`${event.target.value}T12:00:00`).toISOString() })} /></label>
                <label className="field full"><span>本周总结</span><textarea value={editing.summary} disabled={saving} onChange={(event) => setEditing({ ...editing, summary: event.target.value })} /></label>
                <label className="field full"><span>进步表现（每行一条）</span><textarea value={editing.progress.join('\n')} disabled={saving} onChange={(event) => setEditing({ ...editing, progress: lines(event.target.value) })} /></label>
                <label className="field full"><span>需关注问题（每行一条）</span><textarea value={editing.concerns.join('\n')} disabled={saving} onChange={(event) => setEditing({ ...editing, concerns: lines(event.target.value) })} /></label>
                <label className="field full"><span>下周行动（每行一条）</span><textarea value={editing.nextActions.join('\n')} disabled={saving} onChange={(event) => setEditing({ ...editing, nextActions: lines(event.target.value) })} /></label>
              </div>
            </div>
          ) : <div className="compact-empty"><FileClock size={22} /><span>选择或新建一份周报</span></div>}
        </section>
      </div>
    </>
  )
}

function ReportPreview({ report, onEdit, onPublish, publishing }: { report: WeeklyReport; onEdit: () => void; onPublish: () => void; publishing: boolean }) {
  return (
    <article className="report-preview">
      <header><div><span>{formatShortDate(report.periodStart)} - {formatShortDate(report.periodEnd)}</span><h2>{report.title}</h2></div><div><button className="button" type="button" onClick={onEdit} disabled={publishing}>编辑</button>{report.status === 'draft' && <button className="button primary" type="button" onClick={onPublish} disabled={publishing}>{publishing ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}{publishing ? '正在发布' : '发布'}</button>}</div></header>
      <p className="report-summary">{report.summary}</p>
      <ReportSection title="本周进步" items={report.progress} tone="green" />
      <ReportSection title="需要关注" items={report.concerns} tone="amber" />
      <ReportSection title="下周行动" items={report.nextActions} tone="blue" />
      <footer>本周报仅包含教师确认后的学习记录。</footer>
    </article>
  )
}

function ReportSection({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return <section className={`report-section tone-border-${tone}`}><h3>{title}</h3>{items.length ? <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul> : <p>暂无记录</p>}</section>
}
