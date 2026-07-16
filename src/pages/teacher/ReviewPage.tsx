import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CheckCircle2,
  ClipboardCheck,
  LoaderCircle,
  Search,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { AttachmentGallery } from '../../components/AttachmentGallery'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { StatusPill } from '../../components/StatusPill'
import { usePlatform } from '../../context/PlatformContext'
import { ERROR_TAG_OPTIONS } from '../../lib/review'
import { cn, formatDateTime, subjectLabels } from '../../lib/utils'
import type { ErrorTag, QuestionComment } from '../../types/domain'

export function ReviewPage() {
  const { state, gradeAndApproveSubmission, rejectSubmission } = usePlatform()
  const [searchParams, setSearchParams] = useSearchParams()
  const legacyWrongMode = searchParams.get('mode') === 'wrong_item'
  const queue = state.submissions.filter((item) =>
    item.mode === 'assignment' && ['needs_review', 'failed', 'uploaded'].includes(item.status),
  )
  const requestedId = searchParams.get('submission')
  const selectedId = requestedId && queue.some((item) => item.id === requestedId) ? requestedId : queue[0]?.id
  const selected = queue.find((item) => item.id === selectedId) ?? queue[0]
  const reviewReady = selected !== undefined && ['uploaded', 'needs_review', 'failed'].includes(selected.status)
  const draft = state.analysisDrafts.find((item) => item.submissionId === selectedId)
  const [tags, setTags] = useState<ErrorTag[]>([])
  const [questionFeedback, setQuestionFeedback] = useState('')
  const [overallFeedback, setOverallFeedback] = useState('')
  const [score, setScore] = useState('')
  const [maxScore, setMaxScore] = useState('100')
  const [confirmedWrongNumbers, setConfirmedWrongNumbers] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('图片不清晰，请重新上传完整题面和关键步骤。')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [operationError, setOperationError] = useState('')
  const initializedSubmissionId = useRef<string | undefined>(undefined)
  const formDirty = useRef(false)

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return queue
    return queue.filter((item) => {
      const student = state.students.find((candidate) => candidate.id === item.studentId)
      return `${item.title} ${student?.displayName ?? ''}`.toLowerCase().includes(normalized)
    })
  }, [query, queue, state.students])

  useEffect(() => {
    const switchingSubmission = initializedSubmissionId.current !== selectedId
    if (!switchingSubmission && formDirty.current) return
    setTags(draft?.proposedTags ?? selected?.studentErrorTags ?? [])
    const comments = selected?.questionComments?.length ? selected.questionComments : draft?.questionComments ?? []
    setQuestionFeedback(comments.map((item) => `第${item.questionNumber}题：${item.comment}`).join('\n'))
    setOverallFeedback(selected?.teacherFeedback ?? draft?.gradingSummary ?? '')
    setScore(selected?.teacherScore !== undefined ? String(selected.teacherScore) : draft?.proposedScore !== undefined ? String(draft.proposedScore) : '')
    setMaxScore(selected?.maxScore !== undefined ? String(selected.maxScore) : draft?.maxScore !== undefined ? String(draft.maxScore) : '100')
    setConfirmedWrongNumbers('')
    setOperationError('')
    initializedSubmissionId.current = selectedId
    formDirty.current = false
  }, [draft, selected, selectedId])

  const markFormDirty = () => {
    formDirty.current = true
    setOperationError('')
  }

  const choose = (submissionId: string) => setSearchParams({ submission: submissionId })

  const moveToNext = (submissionId: string) => {
    const next = queue.find((item) => item.id !== submissionId)
    if (next) choose(next.id)
    else setSearchParams({})
  }

  const gradeInput = () => {
    if (Array.from(questionFeedback).length > 20000) throw new Error('逐题反馈总长度最多 20000 个字符')
    const lines = questionFeedback.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (lines.length > 100) throw new Error('逐题反馈一次最多填写 100 条')
    const questionComments: QuestionComment[] = lines.map((line) => {
      const match = line.trim().match(/^(?:第)?([^：:]+)(?:题)?[：:]\s*(.+)$/)
      if (!match) throw new Error('逐题反馈请按“第 3 题：反馈内容”格式逐行填写')
      const questionNumber = match[1].replace(/题$/, '').trim()
      const comment = match[2].trim()
      if (Array.from(questionNumber).length > 40) throw new Error('逐题反馈中的单个题号最多 40 个字符')
      if (Array.from(comment).length > 2000) throw new Error('每条逐题反馈最多 2000 个字符')
      return { questionNumber, comment }
    })
    return {
      questionComments,
      numericScore: score.trim() ? Number(score) : undefined,
      numericMaxScore: maxScore.trim() ? Number(maxScore) : undefined,
    }
  }

  const approve = async () => {
    if (!selected || busy || !overallFeedback.trim()) return
    if (!reviewReady) {
      setOperationError('AI 正在分析该作业，请稍后再确认。')
      return
    }
    if (Array.from(overallFeedback.trim()).length > 4000) {
      setOperationError('总体反馈最多 4000 个字符')
      return
    }
    const parsedWrongNumbers = confirmedWrongNumbers
      .split(/[，,、；;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    if (parsedWrongNumbers.length > 50) {
      setOperationError('一次最多确认 50 个错题题号')
      return
    }
    if (parsedWrongNumbers.some((value) => Array.from(value).length > 40)) {
      setOperationError('单个题号最多 40 个字符，请缩短后再确认')
      return
    }
    let grading: ReturnType<typeof gradeInput>
    try {
      grading = gradeInput()
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '逐题反馈格式无效')
      return
    }

    setBusy(true)
    setOperationError('')
    try {
      await gradeAndApproveSubmission(
        selected.id,
        tags,
        overallFeedback.trim(),
        grading.questionComments,
        parsedWrongNumbers,
        grading.numericScore,
        grading.numericMaxScore,
      )
      moveToNext(selected.id)
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '批改保存失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (!selected || busy || !rejectReason.trim()) return
    if (!reviewReady) {
      setOperationError('AI 正在分析该作业，当前不能退回。')
      return
    }
    if (Array.from(rejectReason.trim()).length > 2000) {
      setOperationError('退回原因最多 2000 个字符')
      return
    }
    setBusy(true)
    setOperationError('')
    try {
      await rejectSubmission(selected.id, rejectReason.trim())
      setRejectOpen(false)
      moveToNext(selected.id)
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '退回操作失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  if (legacyWrongMode) {
    const submissionId = searchParams.get('submission')
    return <Navigate replace to={`/teacher/wrong-items${submissionId ? `?submission=${encodeURIComponent(submissionId)}` : ''}`} />
  }

  return (
    <>
      <PageHeader title="作业批改" description="这里只处理学生提交的整份作业；错题与不会题请在学生错题库中独立处理。" />
      <div className="review-workspace">
        <aside className="review-inbox panel">
          <div className="review-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学生或作业" /></div>
          <div className="review-inbox-count">待批改 {filtered.length}</div>
          <div className="review-inbox-list">
            {filtered.map((submission) => {
              const student = state.students.find((item) => item.id === submission.studentId)
              return (
                <button type="button" className={cn('review-inbox-item', selected?.id === submission.id && 'active')} onClick={() => choose(submission.id)} disabled={busy} key={submission.id}>
                  <div><strong>{student?.displayName}</strong><span>{formatDateTime(submission.submittedAt)}</span></div>
                  <p>{submission.title}</p>
                  <span>当日作业 · {subjectLabels[submission.subject]} · {submission.attachments.length} 个文件</span>
                  <StatusPill status={submission.status} />
                </button>
              )
            })}
          </div>
        </aside>

        <section className="review-detail panel">
          {!selected ? <EmptyState icon={ClipboardCheck} title="待批改队列已清空" detail="新的学生作业会出现在左侧。" /> : (
            <>
              <div className="review-detail-header">
                <div>
                  <span>{state.students.find((item) => item.id === selected.studentId)?.displayName} · {subjectLabels[selected.subject]} · 当日作业</span>
                  <h2>{selected.title}</h2>
                  <p>{formatDateTime(selected.submittedAt)} · 用时 {selected.minutesSpent ?? '--'} 分钟 · 题号 {selected.wrongNumbers.join('、') || '未标注'}</p>
                </div>
                <StatusPill status={selected.status} />
              </div>

              <div className="review-columns">
                <div className="evidence-column">
                  <h3>学生原始作答</h3>
                  <AttachmentGallery attachments={selected.attachments} title={selected.title} />
                  <div className="student-reflection"><span>学生说明</span><p>{selected.selfReflection || '未填写作答说明'}</p></div>
                </div>

                <div className="analysis-column">
                  <h3><Sparkles size={17} />AI 初批</h3>
                  {draft ? (
                    <div className="analysis-draft">
                      <div className="draft-confidence"><span>AI 置信度</span><strong>{Math.round(draft.confidence * 100)}%</strong></div>
                      <p>{draft.summary}</p>
                      <div><span>识别的知识点</span><ul>{draft.knowledgePoints.map((point) => <li key={point}>{point}</li>)}</ul></div>
                      <div><span>判断依据</span><ul>{draft.evidence.map((item) => <li key={item}>{item}</li>)}</ul></div>
                    </div>
                  ) : selected.status === 'uploaded' ? (
                    <div className="draft-unavailable"><AlertTriangle size={18} />AI 初批尚未启动，可以直接人工核对和批改。</div>
                  ) : <div className="draft-unavailable"><AlertTriangle size={18} />AI 初批尚未生成，请教师直接核对原始作答。</div>}

                  <div className="teacher-review-form">
                    <label><BadgeCheck size={16} />教师最终批改</label>
                    <label className="field"><span>逐题反馈（可选）</span><textarea value={questionFeedback} maxLength={20000} onChange={(event) => { setQuestionFeedback(event.target.value); markFormDirty() }} placeholder={'例如：\n第 3 题：第二步符号错误，思路正确。\n第 7 题：需要补写定义域。'} /></label>
                    <label className="field"><span>总体反馈</span><textarea value={overallFeedback} maxLength={4000} onChange={(event) => { setOverallFeedback(event.target.value); markFormDirty() }} placeholder="总结本次完成情况、主要问题和下一步要求……" /></label>
                    <div className="grading-score-row"><label className="field"><span>得分（可选）</span><input type="number" min="0" max={maxScore || undefined} inputMode="decimal" value={score} onChange={(event) => { setScore(event.target.value); markFormDirty() }} placeholder="得分" /></label><label className="field"><span>满分</span><input type="number" min="1" inputMode="decimal" value={maxScore} onChange={(event) => { setMaxScore(event.target.value); markFormDirty() }} /></label></div>
                    <label className="field"><span>确认归入错题库的题号（可选）</span><input value={confirmedWrongNumbers} maxLength={2050} onChange={(event) => { setConfirmedWrongNumbers(event.target.value); markFormDirty() }} placeholder={selected.wrongNumbers.length ? `学生希望重点批改：${selected.wrongNumbers.join('、')}` : '例如：3, 7；留空表示没有确认错题'} /><small className="field-hint">学生填写的题号仅供参考；单个题号最多 40 个字符，最多确认 50 个，只有这里确认的题号才会进入错题库和复习计划。</small></label>
                    <label>确认错因（可选）</label>
                    <div className="check-grid review-tags">
                      {ERROR_TAG_OPTIONS.map((option) => (
                        <button type="button" className={cn('check-option', tags.includes(option.value) && 'active')} onClick={() => { setTags((previous) => previous.includes(option.value) ? previous.filter((item) => item !== option.value) : [...previous, option.value]); markFormDirty() }} key={option.value}>
                          <span>{tags.includes(option.value) && <Check size={13} />}</span>{option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {operationError && <p className="form-error" role="alert">{operationError}</p>}
                </div>
              </div>

              <div className="review-footer">
                <button type="button" className="button danger" onClick={() => setRejectOpen(true)} disabled={busy || !reviewReady}><XCircle size={16} />退回补交</button>
                <button type="button" className="button primary" onClick={() => void approve()} disabled={busy || !reviewReady || !overallFeedback.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}确认批改并反馈</button>
              </div>
            </>
          )}
        </section>
      </div>

      <Modal open={rejectOpen} title="退回本次作业" onClose={() => { if (!busy) setRejectOpen(false) }} footer={<><button type="button" className="button" onClick={() => setRejectOpen(false)} disabled={busy}>取消</button><button type="button" className="button danger" onClick={() => void reject()} disabled={busy || !rejectReason.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : null}确认退回</button></>}>
        <label className="field"><span>需要学生补充的内容</span><textarea value={rejectReason} maxLength={2000} onChange={(event) => { setRejectReason(event.target.value); setOperationError('') }} disabled={busy} /></label>
        {operationError && <p className="form-error" role="alert">{operationError}</p>}
      </Modal>
    </>
  )
}
