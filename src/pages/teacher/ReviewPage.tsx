import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileImage,
  FileText,
  LoaderCircle,
  Search,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { StatusPill } from '../../components/StatusPill'
import { usePlatform } from '../../context/PlatformContext'
import { ERROR_TAG_OPTIONS } from '../../lib/review'
import { cn, formatDateTime, subjectLabels } from '../../lib/utils'
import type { ErrorTag, QuestionComment } from '../../types/domain'

const modeLabels = {
  assignment: '当日作业',
  wrong_item: '错题 / 不会的题',
} as const

export function ReviewPage() {
  const { state, approveSubmission, gradeSubmission, rejectSubmission } = usePlatform()
  const [searchParams, setSearchParams] = useSearchParams()
  const [reviewMode, setReviewMode] = useState<'assignment' | 'wrong_item'>(searchParams.get('mode') === 'wrong_item' ? 'wrong_item' : 'assignment')
  const queue = state.submissions.filter((item) => item.mode === reviewMode && (
    reviewMode === 'wrong_item' || ['needs_review', 'failed', 'uploaded', 'analyzing'].includes(item.status)
  ))
  const requestedId = searchParams.get('submission')
  const selectedId = requestedId && queue.some((item) => item.id === requestedId) ? requestedId : queue[0]?.id
  const selected = queue.find((item) => item.id === selectedId) ?? queue[0]
  const draft = state.analysisDrafts.find((item) => item.submissionId === selectedId)
  const [tags, setTags] = useState<ErrorTag[]>([])
  const [questionFeedback, setQuestionFeedback] = useState('')
  const [overallFeedback, setOverallFeedback] = useState('')
  const [score, setScore] = useState('')
  const [maxScore, setMaxScore] = useState('100')
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('图片不清晰，请重新上传完整题面和关键步骤。')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [feedbackSaved, setFeedbackSaved] = useState(false)

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return queue
    return queue.filter((item) => {
      const student = state.students.find((candidate) => candidate.id === item.studentId)
      return `${item.title} ${student?.displayName ?? ''}`.toLowerCase().includes(normalized)
    })
  }, [query, queue, state.students])

  useEffect(() => {
    setTags(draft?.proposedTags ?? [])
    const comments = selected?.questionComments?.length ? selected.questionComments : draft?.questionComments ?? []
    setQuestionFeedback(comments.map((item) => `第${item.questionNumber}题：${item.comment}`).join('\n'))
    setOverallFeedback(selected?.teacherFeedback ?? draft?.gradingSummary ?? '')
    setScore(selected?.teacherScore !== undefined ? String(selected.teacherScore) : draft?.proposedScore !== undefined ? String(draft.proposedScore) : '')
    setMaxScore(selected?.maxScore !== undefined ? String(selected.maxScore) : draft?.maxScore !== undefined ? String(draft.maxScore) : '100')
    setFeedbackSaved(false)
  }, [draft, selected])

  const choose = (submissionId: string) => setSearchParams({ submission: submissionId })

  const moveToNext = (submissionId: string) => {
    const next = queue.find((item) => item.id !== submissionId)
    if (next) choose(next.id)
    else setSearchParams({})
  }

  const gradeInput = () => {
    const questionComments: QuestionComment[] = questionFeedback.split(/\r?\n/).flatMap((line) => {
      const match = line.trim().match(/^(?:第)?([^：:]+)(?:题)?[：:]\s*(.+)$/)
      return match ? [{ questionNumber: match[1].replace(/题$/, '').trim(), comment: match[2].trim() }] : []
    })
    return {
      questionComments,
      numericScore: score.trim() ? Number(score) : undefined,
      numericMaxScore: maxScore.trim() ? Number(maxScore) : undefined,
    }
  }

  const approve = async () => {
    if (!selected || busy || !overallFeedback.trim()) return
    const { questionComments, numericScore, numericMaxScore } = gradeInput()

    setBusy(true)
    try {
      await gradeSubmission(selected.id, overallFeedback.trim(), questionComments, numericScore, numericMaxScore)
      await approveSubmission(selected.id, tags, overallFeedback.trim())
      moveToNext(selected.id)
    } finally {
      setBusy(false)
    }
  }

  const sendQuestionFeedback = async () => {
    if (!selected || busy || !overallFeedback.trim()) return
    const { questionComments } = gradeInput()
    setBusy(true)
    try {
      await gradeSubmission(selected.id, overallFeedback.trim(), questionComments)
      setFeedbackSaved(true)
    } finally { setBusy(false) }
  }

  const reject = async () => {
    if (!selected || busy || !rejectReason.trim()) return
    setBusy(true)
    try {
      await rejectSubmission(selected.id, rejectReason.trim())
      setRejectOpen(false)
      moveToNext(selected.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="作业批改" description={reviewMode === 'assignment' ? 'AI 先完成初步分析，教师核对原始作答后给出最终批改。' : '查看学生上传的错题与不会题，先发送提示，确认后再归档到学生专属错题库。'} actions={<div className="segmented-control"><button type="button" className={reviewMode === 'assignment' ? 'active' : ''} onClick={() => { setReviewMode('assignment'); setSearchParams({}) }}>作业</button><button type="button" className={reviewMode === 'wrong_item' ? 'active' : ''} onClick={() => { setReviewMode('wrong_item'); setSearchParams({}) }}>错题 / 不会题</button></div>} />
      <div className="review-workspace">
        <aside className="review-inbox panel">
          <div className="review-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学生或作业" /></div>
          <div className="review-inbox-count">{reviewMode === 'assignment' ? '待批改' : '上传记录'} {filtered.length}</div>
          <div className="review-inbox-list">
            {filtered.map((submission) => {
              const student = state.students.find((item) => item.id === submission.studentId)
              return (
                <button type="button" className={cn('review-inbox-item', selected?.id === submission.id && 'active')} onClick={() => choose(submission.id)} key={submission.id}>
                  <div><strong>{student?.displayName}</strong><span>{formatDateTime(submission.submittedAt)}</span></div>
                  <p>{submission.title}</p>
                  <span>{modeLabels[submission.mode]} · {subjectLabels[submission.subject]} · {submission.attachments.length} 个文件</span>
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
                  <span>{state.students.find((item) => item.id === selected.studentId)?.displayName} · {subjectLabels[selected.subject]} · {modeLabels[selected.mode]}</span>
                  <h2>{selected.title}</h2>
                  <p>{formatDateTime(selected.submittedAt)} · 用时 {selected.minutesSpent ?? '--'} 分钟 · 题号 {selected.wrongNumbers.join('、') || '未标注'}</p>
                </div>
                <StatusPill status={selected.status} />
              </div>

              <div className="review-columns">
                <div className="evidence-column">
                  <h3>学生原始作答</h3>
                  <div className="attachment-preview-grid">
                    {selected.attachments.map((file, index) => (
                      <div className="attachment-preview" key={file.id}>
                        {file.previewUrl && file.mimeType.startsWith('image/')
                          ? <img src={file.previewUrl} alt={`${selected.title} 第 ${index + 1} 页`} />
                          : file.previewUrl
                            ? <a href={file.previewUrl} target="_blank" rel="noreferrer"><FileText size={28} /><span>打开 PDF</span></a>
                            : <span>{file.mimeType.startsWith('image/') ? <FileImage size={28} /> : <FileText size={28} />}</span>}
                        <strong>第 {index + 1} 页</strong><small>{file.name}</small>
                      </div>
                    ))}
                  </div>
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
                  ) : <div className="draft-unavailable"><AlertTriangle size={18} />AI 初批尚未生成，请教师直接核对原始作答。</div>}

                  <div className="teacher-review-form">
                    <label><BadgeCheck size={16} />{selected.mode === 'assignment' ? '教师最终批改' : '给学生的提示与评价'}</label>
                    <label className="field"><span>逐题反馈（可选）</span><textarea value={questionFeedback} onChange={(event) => setQuestionFeedback(event.target.value)} placeholder={'例如：\n第 3 题：第二步符号错误，思路正确。\n第 7 题：需要补写定义域。'} /></label>
                    <label className="field"><span>{selected.mode === 'assignment' ? '总体反馈' : '提示或评价'}</span><textarea value={overallFeedback} onChange={(event) => { setOverallFeedback(event.target.value); setFeedbackSaved(false) }} placeholder={selected.mode === 'assignment' ? '总结本次完成情况、主要问题和下一步要求……' : '可以只提示关键切入点，不必直接给出完整答案。'} /></label>
                    {selected.mode === 'assignment' && <div className="grading-score-row"><label className="field"><span>得分（可选）</span><input type="number" min="0" max={maxScore || undefined} inputMode="decimal" value={score} onChange={(event) => setScore(event.target.value)} placeholder="得分" /></label><label className="field"><span>满分</span><input type="number" min="1" inputMode="decimal" value={maxScore} onChange={(event) => setMaxScore(event.target.value)} /></label></div>}
                    <label>确认错因（可选）</label>
                    <div className="check-grid review-tags">
                      {ERROR_TAG_OPTIONS.map((option) => (
                        <button type="button" className={cn('check-option', tags.includes(option.value) && 'active')} onClick={() => setTags((previous) => previous.includes(option.value) ? previous.filter((item) => item !== option.value) : [...previous, option.value])} key={option.value}>
                          <span>{tags.includes(option.value) && <Check size={13} />}</span>{option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="review-footer">
                <button type="button" className="button danger" onClick={() => setRejectOpen(true)} disabled={selected.status === 'scheduled'}><XCircle size={16} />退回补交</button>
                {selected.mode === 'wrong_item' && <button type="button" className="button" onClick={() => void sendQuestionFeedback()} disabled={busy || !overallFeedback.trim()}>{feedbackSaved ? <CheckCircle2 size={16} /> : <Sparkles size={16} />}{feedbackSaved ? '提示已发送' : '仅发送提示'}</button>}
                <button type="button" className="button primary" onClick={() => void approve()} disabled={busy || !overallFeedback.trim() || (selected.mode === 'wrong_item' && selected.status === 'scheduled')}>{busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}{selected.mode === 'wrong_item' ? selected.status === 'scheduled' ? '已归档到错题库' : '一键归档到错题库' : '确认批改并反馈'}</button>
              </div>
            </>
          )}
        </section>
      </div>

      <Modal open={rejectOpen} title="退回本次作业" onClose={() => setRejectOpen(false)} footer={<><button type="button" className="button" onClick={() => setRejectOpen(false)}>取消</button><button type="button" className="button danger" onClick={() => void reject()} disabled={busy || !rejectReason.trim()}>确认退回</button></>}>
        <label className="field"><span>需要学生补充的内容</span><textarea value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} /></label>
      </Modal>
    </>
  )
}
