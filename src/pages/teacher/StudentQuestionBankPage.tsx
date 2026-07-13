import { Archive, ArrowRight, BookOpenCheck, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { StatusPill } from '../../components/StatusPill'
import { ErrorTagPill, LabelTag } from '../../components/Tag'
import { usePlatform } from '../../context/PlatformContext'
import { formatShortDate, subjectLabels } from '../../lib/utils'
import type { Subject } from '../../types/domain'

export function StudentQuestionBankPage() {
  const { state } = usePlatform()
  const [studentId, setStudentId] = useState(state.students[0]?.id ?? '')
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [query, setQuery] = useState('')
  const student = state.students.find((item) => item.id === studentId)
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const items = useMemo(() => state.wrongItems.filter((item) => {
    if (item.studentId !== studentId || (subject !== 'all' && item.subject !== subject)) return false
    if (!normalizedQuery) return true
    return `${item.title} ${item.questionText ?? ''} ${item.knowledgePoints.join(' ')} ${item.teacherNote}`
      .toLocaleLowerCase('zh-CN').includes(normalizedQuery)
  }), [normalizedQuery, state.wrongItems, studentId, subject])
  const uploads = state.submissions
    .filter((item) => item.studentId === studentId && item.mode === 'wrong_item' && !item.archivedToWrongBook && item.status !== 'scheduled')
    .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())

  return (
    <>
      <PageHeader title="学生错题库" description="每位学生独立保存已确认错题；确认归档后，后续备课可以按科目、知识点和错因筛选。" actions={<Link className="button" to="/teacher/review?mode=wrong_item"><ArrowRight size={16} />处理学生上传</Link>} />

      <section className="question-bank-toolbar panel">
        <label className="field"><span>学生</span><select value={studentId} onChange={(event) => setStudentId(event.target.value)}>{state.students.map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select></label>
        <label className="field"><span>科目</span><select value={subject} onChange={(event) => setSubject(event.target.value as 'all' | Subject)}><option value="all">全部科目</option>{(student?.subjects ?? []).map((item) => <option value={item} key={item}>{subjectLabels[item]}</option>)}</select></label>
        <label className="question-bank-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题目、知识点或教师备注" /></label>
      </section>

      <div className="question-bank-summary">
        <div><Archive size={18} /><span>已归档错题</span><strong>{items.length}</strong></div>
        <div><BookOpenCheck size={18} /><span>待处理上传</span><strong>{uploads.length}</strong></div>
        <div><span>当前学生</span><strong>{student?.displayName ?? '--'}</strong></div>
      </div>

      {uploads.length > 0 && <section className="panel question-bank-pending">
        <div className="panel-header"><div><h2>学生主动上传，尚未归档</h2><p>先查看原题并发送提示，确认后点击“一键归档到错题库”。</p></div></div>
        <div className="question-bank-pending-list">{uploads.map((upload) => <article key={upload.id}><div><span>{subjectLabels[upload.subject]} · {formatShortDate(upload.assignmentDate)}</span><strong>{upload.title}</strong>{upload.selfReflection && <p>{upload.selfReflection}</p>}</div><div>{upload.teacherFeedback && <p className="question-bank-feedback">教师回复：{upload.teacherFeedback}</p>}<StatusPill status={upload.status} /><Link className="button small" to={`/teacher/review?mode=wrong_item&submission=${upload.id}`}>查看并处理<ArrowRight size={14} /></Link></div></article>)}</div>
      </section>}

      <section className="panel question-bank-list-panel">
        <div className="panel-header"><div><h2>{student?.displayName ?? '学生'}的已确认错题</h2><p>这些记录已经进入该学生专属题库，可作为后续复习和备课选题依据。</p></div><Archive size={18} /></div>
        {items.length ? <div className="student-question-list">{items.map((item) => <article key={item.id}>
          <div className="student-question-main"><div className="student-question-meta"><LabelTag>{subjectLabels[item.subject]}</LabelTag><span>{formatShortDate(item.occurredAt)} · 题号 {item.questionNumber}</span></div><h3>{item.title}</h3>{item.questionText && <p className="question-text-preview">{item.questionText}</p>}<div className="tag-row">{item.knowledgePoints.map((point) => <LabelTag key={point}>{point}</LabelTag>)}{item.errorTags.map((tag) => <ErrorTagPill tag={tag} key={tag} />)}</div></div><div className="student-question-note"><span>教师确认备注</span><p>{item.teacherNote || '暂无备注'}</p><strong>{item.resolved ? '已稳定掌握' : `复习阶段 ${item.reviewStage + 1}/4`}</strong></div>
        </article>)}</div> : <EmptyState icon={Archive} title="该筛选条件下还没有已归档错题" detail="学生上传后，请先在“处理学生上传”中确认，再归档到专属错题库。" />}
      </section>
    </>
  )
}
