import { Archive, BadgeCheck, BookOpenCheck, Check, CheckCircle2, LoaderCircle, ScanSearch, Search, Send, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AttachmentGallery } from '../../components/AttachmentGallery'
import { EmptyState } from '../../components/EmptyState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { StatusPill } from '../../components/StatusPill'
import { ErrorTagPill, LabelTag } from '../../components/Tag'
import { usePlatform } from '../../context/PlatformContext'
import { ERROR_TAG_OPTIONS } from '../../lib/review'
import { cn, formatShortDate, subjectLabels } from '../../lib/utils'
import type { ErrorTag, QuestionComment, Subject } from '../../types/domain'

export function StudentQuestionBankPage() {
  const { state, approveSubmission, gradeSubmission, rejectSubmission } = usePlatform()
  const [searchParams, setSearchParams] = useSearchParams()
  const [studentId, setStudentId] = useState(state.students[0]?.id ?? '')
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [query, setQuery] = useState('')
  const [selectedUploadId, setSelectedUploadId] = useState('')
  const [teacherHint, setTeacherHint] = useState('')
  const [teacherEvaluation, setTeacherEvaluation] = useState('')
  const [tags, setTags] = useState<ErrorTag[]>([])
  const [busy, setBusy] = useState(false)
  const [operationError, setOperationError] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('图片不清晰或内容不完整，请重新上传完整题面和作答过程。')
  const initializedUploadId = useRef('')
  const formDirty = useRef(false)
  const student = state.students.find((item) => item.id === studentId)
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  const confirmedItems = useMemo(() => state.wrongItems.filter((item) => {
    if (item.studentId !== studentId || item.evidenceState !== 'teacher_verified' || (subject !== 'all' && item.subject !== subject)) return false
    if (!normalizedQuery) return true
    return `${item.title} ${item.questionText ?? ''} ${item.knowledgePoints.join(' ')} ${item.teacherNote}`
      .toLocaleLowerCase('zh-CN').includes(normalizedQuery)
  }), [normalizedQuery, state.wrongItems, studentId, subject])
  const filteredWrongUploads = useMemo(() => state.submissions
    .filter((item) => {
      if (item.studentId !== studentId || item.mode !== 'wrong_item') return false
      if (subject !== 'all' && item.subject !== subject) return false
      if (!normalizedQuery) return true
      return `${item.title} ${item.selfReflection ?? ''} ${item.teacherHint ?? ''} ${item.teacherEvaluation ?? ''}`
        .toLocaleLowerCase('zh-CN').includes(normalizedQuery)
    })
    .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime()),
  [normalizedQuery, state.submissions, studentId, subject])
  const uploads = filteredWrongUploads.filter((item) =>
    !item.archivedToWrongBook && item.status !== 'scheduled' && item.status !== 'rejected',
  )
  const returnedUploads = filteredWrongUploads.filter((item) => item.status === 'rejected')
  const selectedUpload = state.submissions.find((item) => item.id === selectedUploadId && item.mode === 'wrong_item')
  const selectedDraft = state.analysisDrafts.find((item) => item.submissionId === selectedUploadId)
  const selectedWrongItems = useMemo(
    () => state.wrongItems.filter((item) => item.submissionId === selectedUploadId),
    [selectedUploadId, state.wrongItems],
  )
  const selectedIsConfirmed = Boolean(
    selectedUpload?.status === 'scheduled' || selectedUpload?.archivedToWrongBook || selectedWrongItems.some((item) => item.evidenceState === 'teacher_verified'),
  )
  const selectedReviewReady = Boolean(selectedUpload && ['uploaded', 'needs_review', 'failed'].includes(selectedUpload.status))

  useEffect(() => {
    const requestedId = searchParams.get('submission')
    if (!requestedId) return
    const requested = state.submissions.find((item) => item.id === requestedId && item.mode === 'wrong_item')
    if (!requested) return
    setStudentId(requested.studentId)
    setSelectedUploadId(requested.id)
  }, [searchParams, state.submissions])

  useEffect(() => {
    const switchingUpload = initializedUploadId.current !== selectedUploadId
    if (!switchingUpload && formDirty.current) return
    setTeacherHint((selectedUpload?.teacherHint ?? '').replace(/^第[^：:\n]+题[：:]\s*/, ''))
    setTeacherEvaluation(selectedUpload?.teacherEvaluation ?? '')
    const confirmedTags = selectedWrongItems
      .filter((item) => item.evidenceState === 'teacher_verified')
      .flatMap((item) => item.errorTags)
    setTags(confirmedTags.length ? [...new Set(confirmedTags)] : selectedDraft?.proposedTags ?? selectedUpload?.studentErrorTags ?? [])
    setOperationError('')
    setRejecting(false)
    setRejectReason('图片不清晰或内容不完整，请重新上传完整题面和作答过程。')
    initializedUploadId.current = selectedUploadId
    formDirty.current = false
  }, [selectedDraft, selectedUpload, selectedUploadId, selectedWrongItems])

  const markFormDirty = () => {
    formDirty.current = true
    setOperationError('')
  }

  const openUpload = (submissionId: string) => {
    setSelectedUploadId(submissionId)
    setSearchParams({ submission: submissionId })
  }

  const closeUpload = () => {
    if (busy) return
    setSelectedUploadId('')
    setSearchParams({})
    setRejecting(false)
  }

  const feedbackInput = (): { feedback: string; comments: QuestionComment[] } => ({
    feedback: teacherEvaluation.trim(),
    comments: teacherHint.trim() && selectedUpload ? [{
      questionNumber: selectedUpload.wrongNumbers[0] ?? '未标注',
      comment: teacherHint.trim(),
    }] : [],
  })

  const feedbackError = () => {
    if (Array.from(teacherHint.trim()).length > 4000) return '给学生的提示最多 4000 个字符'
    if (Array.from(teacherEvaluation.trim()).length > 8000) return '教师评价最多 8000 个字符'
    return ''
  }

  const saveHint = async () => {
    if (!selectedUpload || busy || (!teacherHint.trim() && !teacherEvaluation.trim())) return
    const validationError = feedbackError()
    if (validationError) return setOperationError(validationError)
    const { feedback, comments } = feedbackInput()
    setBusy(true)
    setOperationError('')
    try {
      await gradeSubmission(selectedUpload.id, feedback, comments)
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '提示保存失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  const confirmUpload = async () => {
    if (!selectedUpload || busy || selectedIsConfirmed) return
    if (!selectedReviewReady) return setOperationError('AI 正在分析该题，完成后才能纳入长期错题。')
    const validationError = feedbackError()
    if (validationError) return setOperationError(validationError)
    setBusy(true)
    setOperationError('')
    try {
      await approveSubmission(
        selectedUpload.id,
        tags,
        teacherEvaluation.trim(),
        [],
        teacherHint.trim(),
      )
      setSelectedUploadId('')
      setSearchParams({})
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '错题确认失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  const rejectUpload = async () => {
    if (!selectedUpload || busy || selectedIsConfirmed || !rejectReason.trim()) return
    if (!selectedReviewReady) return setOperationError('AI 正在分析该题，当前不能退回。')
    if (Array.from(rejectReason.trim()).length > 2000) return setOperationError('退回原因最多 2000 个字符')
    setBusy(true)
    setOperationError('')
    try {
      await rejectSubmission(selectedUpload.id, rejectReason.trim())
      setSelectedUploadId('')
      setSearchParams({})
      setRejecting(false)
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '退回失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="学生错题库" description="学生上传后先作为自报记录保存在本人错题本；教师确认后才进入长期学情、复习计划和备课依据。" />

      <section className="question-bank-toolbar panel">
        <label className="field"><span>学生</span><select value={studentId} onChange={(event) => setStudentId(event.target.value)}>{state.students.map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select></label>
        <label className="field"><span>科目</span><select value={subject} onChange={(event) => setSubject(event.target.value as 'all' | Subject)}><option value="all">全部科目</option>{(student?.subjects ?? []).map((item) => <option value={item} key={item}>{subjectLabels[item]}</option>)}</select></label>
        <label className="question-bank-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题目、知识点或教师备注" /></label>
      </section>

      <div className="question-bank-summary">
        <div><Archive size={18} /><span>教师已确认</span><strong>{confirmedItems.length}</strong></div>
        <div><BookOpenCheck size={18} /><span>学生自报待确认</span><strong>{uploads.length}</strong></div>
        <div><span>当前学生</span><strong>{student?.displayName ?? '--'}</strong></div>
      </div>

      {uploads.length > 0 && <section className="panel question-bank-pending">
        <div className="panel-header"><div><h2>学生自报，等待教师确认</h2><p>这些记录已在学生本人错题本中可见，但尚未进入长期学情和复习计划。</p></div><span>{uploads.length} 条待处理</span></div>
        <div className="question-bank-pending-list">{uploads.map((upload) => <article key={upload.id}><div><span>{subjectLabels[upload.subject]} · {formatShortDate(upload.assignmentDate)}</span><strong>{upload.title}</strong>{upload.selfReflection && <p>{upload.selfReflection}</p>}</div><div>{upload.teacherHint && <p className="question-bank-feedback">教师提示：{upload.teacherHint}</p>}{upload.teacherEvaluation && <p className="question-bank-feedback">教师评价：{upload.teacherEvaluation}</p>}<StatusPill status={upload.status} /><button className="button small" type="button" onClick={() => openUpload(upload.id)}>查看、提示与确认</button></div></article>)}</div>
      </section>}

      {returnedUploads.length > 0 && <section className="panel question-bank-returned">
        <div className="panel-header"><div><h2>已退回记录</h2><p>原始自报记录继续留存，学生重新上传后会形成新的待确认记录。</p></div><span>{returnedUploads.length} 条</span></div>
        <div className="question-bank-pending-list">{returnedUploads.map((upload) => <article key={upload.id}><div><span>{subjectLabels[upload.subject]} · {formatShortDate(upload.assignmentDate)}</span><strong>{upload.title}</strong><p>{upload.failureReason || '已退回，请学生重新上传。'}</p></div><div><StatusPill status={upload.status} /></div></article>)}</div>
      </section>}

      <section className="panel question-bank-list-panel">
        <div className="panel-header"><div><h2>{student?.displayName ?? '学生'}的教师确认错题</h2><p>只有这里的记录会进入长期学情、复习计划，并作为后续备课依据。</p></div><Archive size={18} /></div>
        {confirmedItems.length ? <div className="student-question-list">{confirmedItems.map((item) => <article key={item.id}>
          <div className="student-question-main"><div className="student-question-meta"><LabelTag>{subjectLabels[item.subject]}</LabelTag><span>{formatShortDate(item.occurredAt)} · 题号 {item.questionNumber}</span></div><h3>{item.title}</h3>{item.questionText && <p className="question-text-preview">{item.questionText}</p>}<div className="tag-row">{item.knowledgePoints.map((point) => <LabelTag key={point}>{point}</LabelTag>)}{item.errorTags.map((tag) => <ErrorTagPill tag={tag} key={tag} />)}</div>{item.submissionId && state.submissions.some((submission) => submission.id === item.submissionId) && <button className="button small" type="button" onClick={() => openUpload(item.submissionId)}><ScanSearch size={14} />查看原始上传</button>}</div><div className="student-question-note"><span>教师确认备注</span><p>{item.teacherNote || '暂无备注'}</p><strong>{item.resolved ? '已稳定掌握' : `复习阶段 ${item.reviewStage + 1}/4`}</strong></div>
        </article>)}</div> : <EmptyState icon={Archive} title="该筛选条件下还没有教师确认错题" detail="学生自报记录需要教师核对后，才会进入长期错题与复习计划。" />}
      </section>

      <Modal
        open={Boolean(selectedUpload)}
        title={selectedUpload?.title ?? '处理学生自报错题'}
        onClose={closeUpload}
        dismissible={!busy}
        footer={rejecting ? <>
          <button type="button" className="button" onClick={() => setRejecting(false)} disabled={busy}>取消</button>
          <button type="button" className="button danger" onClick={() => void rejectUpload()} disabled={busy || !rejectReason.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : <XCircle size={16} />}确认退回</button>
        </> : <>
          {!selectedIsConfirmed && <button type="button" className="button danger" onClick={() => setRejecting(true)} disabled={busy || !selectedReviewReady}><XCircle size={16} />退回补充</button>}
          <button type="button" className="button" onClick={() => void saveHint()} disabled={busy || (!teacherHint.trim() && !teacherEvaluation.trim())}>{busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}仅保存提示</button>
          {selectedIsConfirmed
            ? <button type="button" className="button primary" onClick={closeUpload} disabled={busy}><CheckCircle2 size={16} />已纳入长期错题</button>
            : <button type="button" className="button primary" onClick={() => void confirmUpload()} disabled={busy || !selectedReviewReady}>{busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}确认并纳入长期错题</button>}
        </>}
      >
        {selectedUpload && <div className="teacher-review-form">
          <div><StatusPill status={selectedUpload.status} /></div>
          {!selectedReviewReady && !selectedIsConfirmed && <p className="form-error" role="status">AI 正在分析，提示可以先保存；确认或退回将在分析结束后开放。</p>}
          <AttachmentGallery attachments={selectedUpload.attachments} title={selectedUpload.title} />
          <div className="student-reflection"><span>学生说明</span><p>{selectedUpload.selfReflection || '学生未填写补充说明'}</p></div>
          {selectedDraft && <div className="analysis-draft"><div className="draft-confidence"><span>AI 初步分析</span><strong>{Math.round(selectedDraft.confidence * 100)}%</strong></div><p>{selectedDraft.summary}</p></div>}
          <label className="field"><span>给学生的提示（可单独保存）</span><textarea value={teacherHint} maxLength={4000} onChange={(event) => { setTeacherHint(event.target.value); markFormDirty() }} placeholder="给出下一步切入点，不必直接给完整答案。" disabled={busy} /></label>
          <label className="field"><span>教师评价（可选）</span><textarea value={teacherEvaluation} maxLength={8000} onChange={(event) => { setTeacherEvaluation(event.target.value); markFormDirty() }} placeholder="确认前可记录题目价值、主要问题和后续要求。" disabled={busy} /></label>
          {rejecting && <label className="field question-bank-reject"><span>退回原因</span><textarea value={rejectReason} maxLength={2000} onChange={(event) => { setRejectReason(event.target.value); markFormDirty() }} placeholder="说明需要重新上传的内容。" disabled={busy} autoFocus /></label>}
          <label><BadgeCheck size={16} />教师确认错因（可选）</label>
          <div className="check-grid review-tags">
            {ERROR_TAG_OPTIONS.map((option) => <button type="button" className={cn('check-option', tags.includes(option.value) && 'active')} onClick={() => { setTags((previous) => previous.includes(option.value) ? previous.filter((item) => item !== option.value) : [...previous, option.value]); markFormDirty() }} disabled={busy || selectedIsConfirmed || rejecting} key={option.value}><span>{tags.includes(option.value) && <Check size={13} />}</span>{option.label}</button>)}
          </div>
          {operationError && <p className="form-error" role="alert">{operationError}</p>}
        </div>}
      </Modal>
    </>
  )
}
