import { CalendarClock, CheckCircle2, ChevronRight, LoaderCircle, NotebookTabs, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { ErrorTagPill, LabelTag } from '../../components/Tag'
import { usePlatform } from '../../context/PlatformContext'
import { formatShortDate, subjectLabels } from '../../lib/utils'
import type { Submission, Subject, WrongItem } from '../../types/domain'

function submissionTeacherNote(submission: Submission | undefined) {
  if (!submission) return ''
  const note = [
    submission.teacherHint ? `提示：${submission.teacherHint}` : '',
    submission.teacherEvaluation ? `评价：${submission.teacherEvaluation}` : '',
  ].filter(Boolean).join('\n')
  return note || submission.teacherFeedback || ''
}

export function MistakesPage() {
  const { state, completeReview } = usePlatform()
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [status, setStatus] = useState<'open' | 'resolved'>('open')
  const [selected, setSelected] = useState<WrongItem | null>(null)
  const [reviewAction, setReviewAction] = useState<{ taskId: string; passed: boolean } | null>(null)
  const [reviewError, setReviewError] = useState('')
  const [visibleCount, setVisibleCount] = useState(30)
  const studentId = state.currentUser.id
  const items = useMemo(() => state.wrongItems.filter((item) =>
    item.studentId === studentId &&
    (subject === 'all' || item.subject === subject) &&
    (status === 'resolved' ? item.resolved : !item.resolved),
  ), [state.wrongItems, status, studentId, subject])
  const visibleItems = items.slice(0, visibleCount)

  const reviewFor = (wrongItemId: string) => state.reviewTasks.find((task) =>
    task.wrongItemId === wrongItemId && task.status === 'due' && new Date(task.dueAt).getTime() <= Date.now(),
  )
  const selectedSubmission = selected?.submissionId
    ? state.submissions.find((submission) => submission.id === selected.submissionId)
    : undefined
  const selectedTeacherNote = submissionTeacherNote(selectedSubmission)

  const submitReview = async (taskId: string, passed: boolean) => {
    if (reviewAction) return
    setReviewAction({ taskId, passed })
    setReviewError('')
    try {
      await completeReview(taskId, passed)
    } catch (reason) {
      setReviewError(reason instanceof Error ? reason.message : '复习结果保存失败，请稍后重试')
    } finally {
      setReviewAction(null)
    }
  }

  return (
    <>
      <PageHeader title="我的错题" description="主动上传后立即保存；老师确认后会补充错因、建议和复习计划。" />
      <div className="filter-bar">
        <div className="segmented-control">
          <button type="button" className={status === 'open' ? 'active' : ''} onClick={() => { setStatus('open'); setVisibleCount(30) }}>待巩固</button>
          <button type="button" className={status === 'resolved' ? 'active' : ''} onClick={() => { setStatus('resolved'); setVisibleCount(30) }}>已稳定</button>
        </div>
        <select className="compact-select" value={subject} onChange={(event) => { setSubject(event.target.value as 'all' | Subject); setVisibleCount(30) }}>
          <option value="all">全部科目</option>
          <option value="math">数学</option>
          <option value="physics">物理</option>
          <option value="chemistry">化学</option>
        </select>
      </div>
      {reviewError && <p className="form-error" role="alert">{reviewError}</p>}

      {items.length ? (
        <div className="mistake-grid">
          {visibleItems.map((item) => {
            const review = reviewFor(item.id)
            const sourceSubmission = item.submissionId
              ? state.submissions.find((submission) => submission.id === item.submissionId)
              : undefined
            const needsResubmit = sourceSubmission?.status === 'rejected'
            const teacherNote = submissionTeacherNote(sourceSubmission)
            return (
              <article className="mistake-card" key={item.id}>
                <button className="mistake-main" type="button" onClick={() => setSelected(item)}>
                  <div className="mistake-topline"><LabelTag>{subjectLabels[item.subject]}</LabelTag><span>{item.evidenceState === 'teacher_verified' ? '老师已确认' : needsResubmit ? '需重新上传' : '待老师确认'} · {formatShortDate(item.occurredAt)}</span></div>
                  <h2>{item.title}</h2>
                  <div className="tag-row">{item.errorTags.map((tag) => <ErrorTagPill tag={tag} key={tag} />)}</div>
                  <p>{item.teacherNote || sourceSubmission?.failureReason || teacherNote || '题目已保存，等待老师补充提示或评价。'}</p>
                  <div className="mistake-meta"><span>出现 {item.recurrenceCount} 次</span><span>{item.evidenceState === 'teacher_verified' ? `复习阶段 ${item.reviewStage + 1}/4` : '尚未安排复习'}</span><ChevronRight size={16} /></div>
                </button>
                {review && (
                  <div className="mistake-review-bar">
                    <span><CalendarClock size={15} />今天到期</span>
                    <div>
                      <button type="button" className="button small" disabled={Boolean(reviewAction)} onClick={() => void submitReview(review.id, false)}>{reviewAction?.taskId === review.id && !reviewAction.passed ? <LoaderCircle className="spin" size={14} /> : <RotateCcw size={14} />}仍不熟</button>
                      <button type="button" className="button primary small" disabled={Boolean(reviewAction)} onClick={() => void submitReview(review.id, true)}>{reviewAction?.taskId === review.id && reviewAction.passed ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />}已掌握</button>
                    </div>
                  </div>
                )}
              </article>
            )
          })}
          {items.length > visibleItems.length && (
            <button type="button" className="button" onClick={() => setVisibleCount((count) => count + 30)}>
              加载更多错题
            </button>
          )}
        </div>
      ) : <section className="panel"><EmptyState icon={NotebookTabs} title={status === 'open' ? '当前没有待巩固错题' : '还没有稳定掌握的错题'} detail="从“上传错题 / 不会题”提交后会立即保存在这里。" /></section>}

      <Modal open={Boolean(selected)} title={selected?.title ?? '错题详情'} onClose={() => setSelected(null)}>
        {selected && (
          <div className="mistake-detail">
            <div className="detail-row"><span>题号</span><strong>{selected.questionNumber}</strong></div>
            <div className="detail-row"><span>科目</span><strong>{subjectLabels[selected.subject]}</strong></div>
            <div className="detail-block"><span>知识点</span><div className="tag-row">{selected.knowledgePoints.map((point) => <LabelTag key={point}>{point}</LabelTag>)}</div></div>
            <div className="detail-row"><span>确认状态</span><strong>{selected.evidenceState === 'teacher_verified' ? '老师已确认' : selectedSubmission?.status === 'rejected' ? '需重新上传' : '待老师确认'}</strong></div>
            <div className="detail-block"><span>老师建议</span><p>{selected.teacherNote || selectedSubmission?.failureReason || selectedTeacherNote || '老师尚未补充建议。'}</p></div>
            <div className="detail-block"><span>错因</span><div className="tag-row">{selected.errorTags.map((tag) => <ErrorTagPill tag={tag} key={tag} />)}</div></div>
            {selected.nextReviewAt && <div className="detail-row"><span>下次复习</span><strong>{formatShortDate(selected.nextReviewAt)}</strong></div>}
          </div>
        )}
      </Modal>
    </>
  )
}
