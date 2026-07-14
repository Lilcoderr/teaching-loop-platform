import { BookOpenCheck, Bot, ChevronRight, CircleAlert, FileClock, Library, MessageSquare, ScanSearch } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '../../components/Avatar'
import { MetricBars } from '../../components/MetricBars'
import { PageHeader } from '../../components/PageHeader'
import { StatCard } from '../../components/StatCard'
import { StatusPill } from '../../components/StatusPill'
import { usePlatform } from '../../context/PlatformContext'
import { errorTagLabels, relativeTime, subjectLabels } from '../../lib/utils'
import type { ErrorTag } from '../../types/domain'

export function TeacherDashboard() {
  const { state } = usePlatform()
  const pending = state.submissions.filter((item) => item.status === 'needs_review' || item.status === 'failed')
  const unread = state.messages.filter((item) => item.senderRole === 'student' && !item.read)
  const due = state.reviewTasks.filter((item) => item.status === 'due' && new Date(item.dueAt).getTime() <= Date.now())
  const activeDocs = state.knowledgeDocuments.filter((item) => item.active)
  const tagCounts = Object.entries(errorTagLabels).map(([tag, label]) => ({
    label,
    value: state.wrongItems.filter((item) => item.errorTags.includes(tag as ErrorTag) && !item.resolved).length,
  })).sort((a, b) => b.value - a.value).slice(0, 5)
  const verifiedOpen = state.wrongItems.filter((item) => item.evidenceState === 'teacher_verified' && !item.resolved)
  const pointCounts = verifiedOpen.flatMap((item) => item.knowledgePoints).reduce<Record<string, number>>((counts, point) => {
    counts[point] = (counts[point] ?? 0) + 1
    return counts
  }, {})
  const topPoint = Object.entries(pointCounts).sort((a, b) => b[1] - a[1])[0]
  const sourceSubmissionCount = new Set(verifiedOpen.map((item) => item.submissionId).filter(Boolean)).size

  return (
    <>
      <PageHeader title="教学概览" description="今天需要处理的作业、留言和复习反馈。" actions={<Link className="button primary" to="/teacher/review"><ScanSearch size={17} /><span>开始批改</span></Link>} />
      <div className="stats-grid">
        <StatCard label="待批改作业" value={pending.length} detail={pending.length ? '优先处理最新作业' : '队列已清空'} icon={CircleAlert} tone="amber" />
        <StatCard label="学生留言" value={unread.length} detail="未读问题与反馈" icon={MessageSquare} tone="blue" />
        <StatCard label="到期复习" value={due.length} detail="等待学生完成" icon={BookOpenCheck} tone="teal" />
        <StatCard label="已索引资料" value={activeDocs.length} detail={`${activeDocs.reduce((sum, item) => sum + item.chunkCount, 0)} 个知识片段`} icon={Library} tone="red" />
      </div>

      <div className="dashboard-grid teacher-dashboard-grid">
        <div className="teacher-main-stack">
          <section className="panel">
            <div className="panel-header"><div><h2>待批改队列</h2><p>AI 初批仅供参考，由教师确认最终结果</p></div><Link className="text-link" to="/teacher/review">全部 {pending.length}</Link></div>
            {pending.length ? pending.slice(0, 5).map((submission) => {
              const student = state.students.find((item) => item.id === submission.studentId)
              return (
                <Link to={`/teacher/review?mode=${submission.mode}&submission=${submission.id}`} className="list-row review-queue-row" key={submission.id}>
                  <Avatar name={student?.displayName ?? '学生'} color={student?.avatarColor ?? '#78716c'} />
                  <div className="list-row-main"><strong>{submission.title}</strong><p>{student?.displayName} · {subjectLabels[submission.subject]} · {submission.wrongNumbers.length ? `错题 ${submission.wrongNumbers.join('、')}` : '未标错题号'}</p></div>
                  <div className="list-row-meta"><StatusPill status={submission.status} /><span>{relativeTime(submission.submittedAt)}</span><ChevronRight size={16} /></div>
                </Link>
              )
            }) : <div className="compact-empty"><BookOpenCheck size={20} /><span>当前没有待批改作业</span></div>}
          </section>

          <section className="student-overview-section">
            <div className="panel-header"><div><h2>学生概况</h2><p>只展示可追溯的学习证据</p></div><Link className="text-link" to="/teacher/students">查看学情</Link></div>
            <div className="student-overview-grid">
              {state.students.map((student) => {
                const open = state.wrongItems.filter((item) => item.studentId === student.id && !item.resolved).length
                const submissions = state.submissions.filter((item) => item.studentId === student.id).length
                return (
                  <Link to="/teacher/students" className="student-overview" key={student.id}>
                    <Avatar name={student.displayName} color={student.avatarColor} size="lg" />
                    <div><strong>{student.displayName}</strong><span>{student.grade} · {student.subjects.map((item) => subjectLabels[item]).join(' / ')}</span></div>
                    <dl><div><dt>提交</dt><dd>{submissions}</dd></div><div><dt>待巩固</dt><dd>{open}</dd></div><div><dt>目标</dt><dd>{student.targetScore ?? '--'}</dd></div></dl>
                  </Link>
                )
              })}
            </div>
          </section>
        </div>

        <div className="side-stack">
          <section className="panel">
            <div className="panel-header"><h2>高频错因</h2><span className="panel-kicker">未解决错题</span></div>
            <div className="panel-body"><MetricBars items={tagCounts} /></div>
          </section>
          <section className="panel prep-brief">
            <div className="panel-header"><h2>下次备课提示</h2><Bot size={17} /></div>
            <div className="panel-body">
              <span>证据汇总</span>
              <h3>{topPoint ? `优先巩固：${topPoint[0]}` : '等待更多已确认学情'}</h3>
              <p>{topPoint ? `该知识点在当前未解决错题中出现 ${topPoint[1]} 次。建议备课时先复盘对应错因，再从已复核题库选择同方法练习。` : '完成作业复核后，这里会根据教师确认的知识点和错题自动汇总备课方向。'}</p>
              <div className="brief-source"><FileClock size={14} />来自 {sourceSubmissionCount} 次提交、{verifiedOpen.length} 条已确认错题</div>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
