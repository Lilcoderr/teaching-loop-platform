import { BookOpenCheck, CalendarDays, CheckCircle2, Eye } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { usePlatform } from '../../context/PlatformContext'
import { formatShortDate } from '../../lib/utils'

export function ParentReportsPage() {
  const { state, demoMode } = usePlatform()
  const account = state.accounts.find((item) => item.id === state.currentUser.id)
  const reports = useMemo(() => {
    const published = state.reports.filter((item) => item.status === 'published')
    if (!demoMode || !account) return published
    return published.filter((item) => account.linkedStudentIds.includes(item.studentId))
  }, [account, demoMode, state.reports])
  const [selectedId, setSelectedId] = useState(reports[0]?.id ?? '')
  const selected = reports.find((item) => item.id === selectedId) ?? reports[0]
  const student = state.students.find((item) => item.id === selected?.studentId)

  return (
    <>
      <PageHeader title="学习周报" description="以下内容均已由老师确认并发布。" />
      {!reports.length ? <section className="panel"><EmptyState icon={BookOpenCheck} title="暂时没有已发布周报" detail="老师发布后会显示在这里。" /></section> : (
        <div className="parent-report-layout">
          <aside className="parent-report-list panel">
            {reports.map((report) => <button type="button" className={selected?.id === report.id ? 'active' : ''} onClick={() => setSelectedId(report.id)} key={report.id}><CalendarDays size={18} /><div><strong>{report.title}</strong><span>{formatShortDate(report.periodStart)} - {formatShortDate(report.periodEnd)}</span></div><Eye size={15} /></button>)}
          </aside>
          {selected && <article className="parent-report panel">
            <header><span>{student?.displayName} · {formatShortDate(selected.periodStart)} - {formatShortDate(selected.periodEnd)}</span><h1>{selected.title}</h1><p>{selected.summary}</p></header>
            <section><h2>本周进步</h2>{selected.progress.map((item) => <div className="parent-report-item success" key={item}><CheckCircle2 size={17} /><span>{item}</span></div>)}</section>
            <section><h2>需要关注</h2>{selected.concerns.map((item) => <div className="parent-report-item concern" key={item}><span>{item}</span></div>)}</section>
            <section><h2>下周行动</h2><ol>{selected.nextActions.map((item) => <li key={item}>{item}</li>)}</ol></section>
            <footer>由教师基于已确认的作业、错题与复习记录整理</footer>
          </article>}
        </div>
      )}
    </>
  )
}
