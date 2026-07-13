import { CalendarClock, CheckCircle2, ChevronRight, NotebookTabs, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { ErrorTagPill, LabelTag } from '../../components/Tag'
import { usePlatform } from '../../context/PlatformContext'
import { formatShortDate, subjectLabels } from '../../lib/utils'
import type { Subject, WrongItem } from '../../types/domain'

export function MistakesPage() {
  const { state, completeReview } = usePlatform()
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [status, setStatus] = useState<'open' | 'resolved'>('open')
  const [selected, setSelected] = useState<WrongItem | null>(null)
  const studentId = state.currentUser.id
  const items = useMemo(() => state.wrongItems.filter((item) =>
    item.studentId === studentId &&
    (subject === 'all' || item.subject === subject) &&
    (status === 'resolved' ? item.resolved : !item.resolved),
  ), [state.wrongItems, status, studentId, subject])

  const reviewFor = (wrongItemId: string) => state.reviewTasks.find((task) => task.wrongItemId === wrongItemId && task.status === 'due')

  return (
    <>
      <PageHeader title="我的错题" description="只记录经老师确认的错因与复习计划。" />
      <div className="filter-bar">
        <div className="segmented-control">
          <button type="button" className={status === 'open' ? 'active' : ''} onClick={() => setStatus('open')}>待巩固</button>
          <button type="button" className={status === 'resolved' ? 'active' : ''} onClick={() => setStatus('resolved')}>已稳定</button>
        </div>
        <select className="compact-select" value={subject} onChange={(event) => setSubject(event.target.value as 'all' | Subject)}>
          <option value="all">全部科目</option>
          <option value="math">数学</option>
          <option value="physics">物理</option>
          <option value="chemistry">化学</option>
        </select>
      </div>

      {items.length ? (
        <div className="mistake-grid">
          {items.map((item) => {
            const review = reviewFor(item.id)
            return (
              <article className="mistake-card" key={item.id}>
                <button className="mistake-main" type="button" onClick={() => setSelected(item)}>
                  <div className="mistake-topline"><LabelTag>{subjectLabels[item.subject]}</LabelTag><span>{formatShortDate(item.occurredAt)}</span></div>
                  <h2>{item.title}</h2>
                  <div className="tag-row">{item.errorTags.map((tag) => <ErrorTagPill tag={tag} key={tag} />)}</div>
                  <p>{item.teacherNote}</p>
                  <div className="mistake-meta"><span>出现 {item.recurrenceCount} 次</span><span>复习阶段 {item.reviewStage + 1}/4</span><ChevronRight size={16} /></div>
                </button>
                {review && (
                  <div className="mistake-review-bar">
                    <span><CalendarClock size={15} />今天到期</span>
                    <div>
                      <button type="button" className="button small" onClick={() => void completeReview(review.id, false)}><RotateCcw size={14} />仍不熟</button>
                      <button type="button" className="button primary small" onClick={() => void completeReview(review.id, true)}><CheckCircle2 size={14} />已掌握</button>
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      ) : <section className="panel"><EmptyState icon={NotebookTabs} title={status === 'open' ? '当前没有待巩固错题' : '还没有稳定掌握的错题'} detail="老师确认后的错题会出现在这里。" /></section>}

      <Modal open={Boolean(selected)} title={selected?.title ?? '错题详情'} onClose={() => setSelected(null)}>
        {selected && (
          <div className="mistake-detail">
            <div className="detail-row"><span>题号</span><strong>{selected.questionNumber}</strong></div>
            <div className="detail-row"><span>科目</span><strong>{subjectLabels[selected.subject]}</strong></div>
            <div className="detail-block"><span>知识点</span><div className="tag-row">{selected.knowledgePoints.map((point) => <LabelTag key={point}>{point}</LabelTag>)}</div></div>
            <div className="detail-block"><span>老师建议</span><p>{selected.teacherNote}</p></div>
            <div className="detail-block"><span>错因</span><div className="tag-row">{selected.errorTags.map((tag) => <ErrorTagPill tag={tag} key={tag} />)}</div></div>
            {selected.nextReviewAt && <div className="detail-row"><span>下次复习</span><strong>{formatShortDate(selected.nextReviewAt)}</strong></div>}
          </div>
        )}
      </Modal>
    </>
  )
}
