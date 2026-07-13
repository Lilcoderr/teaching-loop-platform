import { Bot, CalendarCheck2, History, MessageSquare, Send, Sparkles, Target } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Avatar } from '../../components/Avatar'
import { MetricBars } from '../../components/MetricBars'
import { PageHeader } from '../../components/PageHeader'
import { ErrorTagPill } from '../../components/Tag'
import { usePlatform } from '../../context/PlatformContext'
import { errorTagLabels, formatShortDate, relativeTime, subjectLabels } from '../../lib/utils'
import type { ErrorTag, Subject } from '../../types/domain'

export function StudentsPage() {
  const { state, activeStudent, activeStudentId, setActiveStudentId, sendMessage, markMessagesRead, saveDailyEvaluation } = usePlatform()
  const [message, setMessage] = useState('')
  const [evaluationSummary, setEvaluationSummary] = useState('')
  const [evaluationHighlights, setEvaluationHighlights] = useState('')
  const [evaluationImprovements, setEvaluationImprovements] = useState('')
  const [evaluationSubject, setEvaluationSubject] = useState<Subject | ''>('')
  const [evaluationBusy, setEvaluationBusy] = useState(false)
  const [evaluationSaved, setEvaluationSaved] = useState(false)
  const wrongItems = state.wrongItems.filter((item) => item.studentId === activeStudentId)
  const openItems = wrongItems.filter((item) => !item.resolved)
  const submissions = state.submissions.filter((item) => item.studentId === activeStudentId)
  const messages = state.messages.filter((item) => item.studentId === activeStudentId)
  const evaluationHistory = state.dailyEvaluations
    .filter((item) => item.studentId === activeStudentId)
    .sort((left, right) => right.date.localeCompare(left.date) || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  const tagBars = useMemo(() => Object.entries(errorTagLabels).map(([tag, label]) => ({ label, value: openItems.filter((item) => item.errorTags.includes(tag as ErrorTag)).length })).filter((item) => item.value).sort((a, b) => b.value - a.value), [openItems])

  useEffect(() => {
    if (activeStudentId) void markMessagesRead(activeStudentId)
  }, [activeStudentId, markMessagesRead])

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10)
    const current = state.dailyEvaluations.find((item) => item.studentId === activeStudentId && item.date.slice(0, 10) === today)
    setEvaluationSummary(current?.summary ?? '')
    setEvaluationHighlights(current?.highlights.join('\n') ?? '')
    setEvaluationImprovements(current?.improvements.join('\n') ?? '')
    setEvaluationSubject(current?.subject ?? '')
    setEvaluationSaved(false)
  }, [activeStudentId, state.dailyEvaluations])

  const submitMessage = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeStudentId || !message.trim()) return
    await sendMessage(activeStudentId, message)
    setMessage('')
  }

  const submitEvaluation = async (event: FormEvent) => {
    event.preventDefault()
    if (!activeStudentId || !evaluationSummary.trim()) return
    setEvaluationBusy(true)
    try {
      await saveDailyEvaluation(
        activeStudentId, new Date().toISOString().slice(0, 10), evaluationSummary.trim(),
        evaluationHighlights.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        evaluationImprovements.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        evaluationSubject || undefined,
      )
      setEvaluationSaved(true)
    } finally { setEvaluationBusy(false) }
  }

  return (
    <>
      <PageHeader
        title="学生学情"
        description="所有结论都可回溯到作业、错题或复习记录。"
        actions={
          <select className="student-select" value={activeStudentId} onChange={(event) => setActiveStudentId(event.target.value)}>
            {state.students.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}
          </select>
        }
      />
      {activeStudent && (
        <>
          <section className="student-profile-band">
            <Avatar name={activeStudent.displayName} color={activeStudent.avatarColor} size="lg" />
            <div><h2>{activeStudent.displayName}</h2><p>{activeStudent.grade} · {activeStudent.subjects.map((item) => subjectLabels[item]).join(' / ')}</p></div>
            <dl>
              <div><dt><Target size={14} />目标分</dt><dd>{activeStudent.targetScore ?? '--'}</dd></div>
              <div><dt><CalendarCheck2 size={14} />已提交</dt><dd>{submissions.length}</dd></div>
              <div><dt>待巩固</dt><dd>{openItems.length}</dd></div>
            </dl>
          </section>

          <div className="student-detail-grid">
            <div className="teacher-main-stack">
              <section className="panel">
                <div className="panel-header"><div><h2>已确认错题</h2><p>最近发生在前</p></div></div>
                {wrongItems.map((item) => (
                  <div className="student-evidence-row" key={item.id}>
                    <div className="evidence-date"><strong>{formatShortDate(item.occurredAt)}</strong><span>{subjectLabels[item.subject]}</span></div>
                    <div className="evidence-main"><h3>{item.title}</h3><p>{item.teacherNote}</p><div className="tag-row">{item.errorTags.map((tag) => <ErrorTagPill tag={tag} key={tag} />)}</div></div>
                    <span className={item.resolved ? 'evidence-resolved' : 'evidence-open'}>{item.resolved ? '已稳定' : `阶段 ${item.reviewStage + 1}/4`}</span>
                  </div>
                ))}
              </section>
              <section className="panel">
                <div className="panel-header"><div><h2>师生留言</h2><p>未读问题会出现在教师概览</p></div><MessageSquare size={17} /></div>
                <div className="teacher-message-stream">
                  {messages.slice(-5).map((item) => <div className={`teacher-message ${item.senderRole}`} key={item.id}><p>{item.body}</p><span>{item.senderRole === 'teacher' ? '我' : activeStudent.displayName} · {relativeTime(item.createdAt)}</span></div>)}
                </div>
                <form className="inline-message-form" onSubmit={submitMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="回复学生……" /><button className="icon-button" type="submit" disabled={!message.trim()} title="发送"><Send size={16} /></button></form>
              </section>
            </div>
            <div className="side-stack">
              <section className="panel daily-evaluation-editor">
                <div className="panel-header"><div><h2>今日评价</h2><p>发布后显示在学生首页</p></div><Sparkles size={17} /></div>
                <form className="panel-body" onSubmit={submitEvaluation}>
                  <label className="field"><span>科目（可选）</span><select value={evaluationSubject} onChange={(event) => setEvaluationSubject(event.target.value as Subject | '')}><option value="">综合评价</option>{activeStudent.subjects.map((subject) => <option value={subject} key={subject}>{subjectLabels[subject]}</option>)}</select></label>
                  <label className="field"><span>总体评价</span><textarea value={evaluationSummary} onChange={(event) => { setEvaluationSummary(event.target.value); setEvaluationSaved(false) }} placeholder="今天课堂参与、作答质量和学习习惯的可追溯评价" /></label>
                  <label className="field"><span>做得好（每行一条）</span><textarea value={evaluationHighlights} onChange={(event) => setEvaluationHighlights(event.target.value)} placeholder={'主动说明卡点\n计算步骤更完整'} /></label>
                  <label className="field"><span>下一步（每行一条）</span><textarea value={evaluationImprovements} onChange={(event) => setEvaluationImprovements(event.target.value)} placeholder={'检查符号\n补全取值范围'} /></label>
                  <button type="submit" className="button primary" disabled={evaluationBusy || !evaluationSummary.trim()}><Sparkles size={15} />{evaluationBusy ? '正在发布' : evaluationSaved ? '已发布' : '发布今日评价'}</button>
                </form>
              </section>
              <section className="panel evaluation-history-panel">
                <div className="panel-header"><div><h2>历史评价</h2><p>长期保留，并自动作为学情分析证据</p></div><History size={17} /></div>
                {evaluationHistory.length ? <div className="evaluation-history-list">{evaluationHistory.map((evaluation) => <article key={evaluation.id}>
                  <div><strong>{formatShortDate(evaluation.date)}</strong><span>{evaluation.subject ? subjectLabels[evaluation.subject] : '综合评价'}</span></div>
                  <p>{evaluation.summary}</p>
                  {(evaluation.highlights.length > 0 || evaluation.improvements.length > 0) && <small>{evaluation.highlights.length ? `亮点：${evaluation.highlights.join('；')}` : ''}{evaluation.highlights.length && evaluation.improvements.length ? ' · ' : ''}{evaluation.improvements.length ? `下一步：${evaluation.improvements.join('；')}` : ''}</small>}
                </article>)}</div> : <p className="evaluation-history-empty">暂时没有历史评价。</p>}
              </section>
              <section className="panel"><div className="panel-header"><h2>错因分布</h2></div><div className="panel-body"><MetricBars items={tagBars.length ? tagBars : [{ label: '暂无', value: 0 }]} /></div></section>
              <section className="panel prep-brief"><div className="panel-header"><h2>备课建议</h2><Bot size={17} /></div><div className="panel-body"><span>基于已确认学情</span><h3>{openItems[0]?.knowledgePoints.join('、') || '等待更多证据'}</h3><p>{openItems[0] ? `优先处理“${errorTagLabels[openItems[0].errorTags[0]]}”类问题，并在完整题目中检查步骤落地。` : '完成首批作业复核后自动形成建议。'}</p></div></section>
            </div>
          </div>
        </>
      )}
    </>
  )
}
