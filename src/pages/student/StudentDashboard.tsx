import { ArrowRight, Bot, CheckCircle2, ClipboardCheck, FileQuestion, FileUp, NotebookTabs, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { StatusPill } from '../../components/StatusPill'
import { usePlatform } from '../../context/PlatformContext'
import { localDateKey, relativeTime, subjectLabels } from '../../lib/utils'

export function StudentDashboard() {
  const { state } = usePlatform()
  const studentId = state.currentUser.id
  const student = state.students.find((item) => item.id === studentId)
  const assignments = state.submissions
    .filter((item) => item.studentId === studentId && item.mode === 'assignment')
    .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())
  const today = localDateKey()
  const evaluations = state.dailyEvaluations
    .filter((item) => item.studentId === studentId && item.date.slice(0, 10) === today)
    .sort((left, right) => (left.subject ?? '').localeCompare(right.subject ?? '') || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())

  return (
    <>
      <PageHeader
        title={`今天好，${student?.displayName ?? state.currentUser.displayName}`}
        description="交作业、看批改，需要帮助时直接问老师或 AI。"
      />
      <section className="panel quick-actions-panel student-home-quick">
        <div className="panel-header"><h2>快捷入口</h2></div>
        <div className="quick-action-grid four-actions">
          <Link to="/student/upload"><FileUp size={20} /><span>交作业</span><ArrowRight size={15} /></Link>
          <Link to="/student/wrong-upload"><FileQuestion size={20} /><span>上传错题 / 不会题</span><ArrowRight size={15} /></Link>
          <Link to="/student/tutor"><Bot size={20} /><span>问 AI</span><ArrowRight size={15} /></Link>
          <Link to="/student/mistakes"><NotebookTabs size={20} /><span>看错题</span><ArrowRight size={15} /></Link>
        </div>
      </section>

      <div className="student-home-grid">
        <section className="panel daily-evaluation-panel">
          <div className="panel-header"><div><h2>老师今日评价</h2><p>{evaluations.length ? `今日共 ${evaluations.length} 条` : '基于今天的课堂和作业表现'}</p></div><Sparkles size={18} /></div>
          {evaluations.length ? <div className="daily-evaluation-list">{evaluations.map((evaluation) => <article className="evaluation-body" key={evaluation.id}>
            <strong className="evaluation-subject">{evaluation.subject ? subjectLabels[evaluation.subject] : '综合评价'}</strong>
            <p>{evaluation.summary}</p>
            {evaluation.highlights.length > 0 && <div><strong>做得好</strong>{evaluation.highlights.map((item, index) => <span className="evaluation-point positive" key={`${evaluation.id}-highlight-${index}`}><CheckCircle2 size={14} />{item}</span>)}</div>}
            {evaluation.improvements.length > 0 && <div><strong>下一步</strong>{evaluation.improvements.map((item, index) => <span className="evaluation-point" key={`${evaluation.id}-improvement-${index}`}>{item}</span>)}</div>}
          </article>)}</div> : <EmptyState icon={Sparkles} title="老师今天还没有发布评价" detail="发布后会显示在这里。" />}
        </section>

        <section className="panel grading-status-panel">
          <div className="panel-header"><div><h2>作业批改情况</h2><p>查看 AI 初批与老师最终反馈</p></div><ClipboardCheck size={18} /></div>
          {assignments.length ? <div className="grading-list">{assignments.slice(0, 5).map((submission) => <article className="grading-row" key={submission.id}>
            <div className="grading-row-main"><span>{subjectLabels[submission.subject]} · {relativeTime(submission.submittedAt)}</span><strong>{submission.title}</strong>{submission.teacherFeedback && <p>{submission.teacherFeedback}</p>}</div>
            <div className="grading-result">{submission.gradedAt ? <><span className="graded-badge">老师已批改</span>{submission.teacherScore !== undefined && <strong>{submission.teacherScore}{submission.maxScore !== undefined ? ` / ${submission.maxScore}` : ' 分'}</strong>}</> : <StatusPill status={submission.status} />}</div>
          </article>)}</div> : <EmptyState icon={ClipboardCheck} title="还没有提交作业" detail="从上方“交作业”开始提交。" />}
        </section>
      </div>
    </>
  )
}
