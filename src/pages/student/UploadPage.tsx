import { AlertCircle, Check, CheckCircle2, FileText, LoaderCircle, MessageSquare, Send } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { FileDropzone } from '../../components/FileDropzone'
import { PageHeader } from '../../components/PageHeader'
import { StatusPill } from '../../components/StatusPill'
import { usePlatform } from '../../context/PlatformContext'
import { ERROR_TAG_OPTIONS } from '../../lib/review'
import { cn, formatDateTime, localDateKey, subjectLabels } from '../../lib/utils'
import type { ErrorTag, Submission, Subject, UploadMode } from '../../types/domain'

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function SubmissionUploadPage({ mode }: { mode: UploadMode }) {
  const { state, createSubmission } = usePlatform()
  const student = state.students.find((item) => item.id === state.currentUser.id)
  const [files, setFiles] = useState<File[]>([])
  const [subject, setSubject] = useState<Subject>(student?.subjects[0] ?? 'math')
  const [title, setTitle] = useState('')
  const [assignmentDate, setAssignmentDate] = useState(localDateKey())
  const [minutesSpent, setMinutesSpent] = useState('')
  const [wrongNumbers, setWrongNumbers] = useState('')
  const [confidence, setConfidence] = useState(3)
  const [reflection, setReflection] = useState('')
  const [tags, setTags] = useState<ErrorTag[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<{ title: string; fileCount: number } | null>(null)
  const history = state.submissions
    .filter((item) => item.studentId === state.currentUser.id && item.mode === mode)
    .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())

  const toggleTag = (tag: ErrorTag) => {
    setTags((previous) => previous.includes(tag) ? previous.filter((item) => item !== tag) : [...previous, tag])
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError('')
    setSuccess(null)
    if (!title.trim()) return setError(mode === 'assignment' ? '请填写作业名称' : '请填写题目名称')
    if (!files.length) return setError('请至少选择一个文件')
    const parsedWrongNumbers = wrongNumbers.split(/[，,、\s]+/).map((item) => item.trim()).filter(Boolean)
    const invalidWrongNumber = parsedWrongNumbers.find((item) => Array.from(item).length > 40)
    if (invalidWrongNumber) return setError('单个题号最多 40 个字符，请缩短后再提交')
    if (parsedWrongNumbers.length > 50) return setError('一次最多填写 50 个题号')
    const submittedTitle = title.trim()
    const submittedFileCount = files.length
    setBusy(true)
    try {
      await createSubmission({
        mode,
        subject,
        title: submittedTitle,
        assignmentDate: new Date(`${assignmentDate}T12:00:00`).toISOString(),
        minutesSpent: minutesSpent ? Number(minutesSpent) : undefined,
        wrongNumbers: parsedWrongNumbers,
        confidence,
        selfReflection: reflection.trim(),
        studentErrorTags: tags,
      }, files)
      setSuccess({ title: submittedTitle, fileCount: submittedFileCount })
      setFiles([])
      setTitle('')
      setMinutesSpent('')
      setWrongNumbers('')
      setConfidence(3)
      setReflection('')
      setTags([])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提交失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={mode === 'assignment' ? '提交今日作业' : '上传错题或不会的题'}
        description={mode === 'assignment' ? '上传完整作答过程，AI 初批后由老师在线确认和批改。' : '把题面和你的尝试一起上传，老师会整理卡点并安排后续复习。'}
      />
      {success && (
        <section className="upload-success" role="status" aria-live="polite">
          <CheckCircle2 size={22} />
          <div>
            <strong>{mode === 'assignment' ? '作业提交成功' : '题目提交成功'}</strong>
            <p>“{success.title}”及 {success.fileCount} 个附件已交给老师，可在下方记录中查看处理状态。</p>
          </div>
          <button type="button" className="button small" onClick={() => setSuccess(null)}>继续提交</button>
        </section>
      )}
      <form className="upload-layout" onSubmit={submit} aria-busy={busy}>
        <section className="panel upload-main">
          <div className="panel-header"><div><h2>{mode === 'assignment' ? '作业照片或 PDF' : '题面与作答过程'}</h2><p>按页排序后提交，单次最多 12 个文件</p></div></div>
          <fieldset className="panel-body upload-fieldset" disabled={busy}>
            <FileDropzone files={files} onChange={setFiles} maxMb={state.settings.maxUploadMb} />
          </fieldset>
        </section>

        <section className="panel upload-details">
          <div className="panel-header"><div><h2>{mode === 'assignment' ? '作业信息' : '错题信息'}</h2><p>标有“可选”的项目可以稍后补充</p></div></div>
          <fieldset className="panel-body form-grid upload-fieldset" disabled={busy}>
            <label className="field">
              <span>科目</span>
              <select value={subject} onChange={(event) => setSubject(event.target.value as Subject)}>
                {(student?.subjects ?? ['math']).map((item) => <option value={item} key={item}>{subjectLabels[item]}</option>)}
              </select>
            </label>
            <label className="field">
              <span>日期</span>
              <input type="date" value={assignmentDate} onChange={(event) => setAssignmentDate(event.target.value)} />
            </label>
            <label className="field full">
              <span>{mode === 'assignment' ? '作业名称' : '错题名称'}</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={mode === 'assignment' ? '例如：解析几何课后练习' : '例如：椭圆切线第12题'} />
            </label>
            <label className="field">
              <span>用时（分钟，可选）</span>
              <input type="number" min="1" max="600" value={minutesSpent} onChange={(event) => setMinutesSpent(event.target.value)} placeholder="例如 45" />
            </label>
            <label className="field">
              <span>{mode === 'assignment' ? '希望重点批改的题号（可选，单个最多 40 字符）' : '题号（可选，单个最多 40 字符）'}</span>
              <input value={wrongNumbers} onChange={(event) => setWrongNumbers(event.target.value)} placeholder="例如 12, 16, 18" />
            </label>
            <div className="field full">
              <span>完成把握：{confidence}/5</span>
              <div className="confidence-picker">
                {[1, 2, 3, 4, 5].map((value) => <button type="button" className={value <= confidence ? 'active' : ''} onClick={() => setConfidence(value)} key={value}>{value}</button>)}
              </div>
            </div>
            <div className="field full">
              <span>你认为可能的错因（可多选）</span>
              <div className="check-grid">
                {ERROR_TAG_OPTIONS.map((option) => (
                  <button type="button" className={cn('check-option', tags.includes(option.value) && 'active')} onClick={() => toggleTag(option.value)} key={option.value}>
                    <span>{tags.includes(option.value) && <Check size={13} />}</span>{option.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="field full">
              <span>{mode === 'assignment' ? '作业自评（可选）' : '你的尝试与卡点（建议填写）'}</span>
              <textarea value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder={mode === 'assignment' ? '哪些题不确定，或者希望老师重点看哪里。' : '写下你已经尝试的公式、设元，以及从哪一步开始不会。'} />
            </label>
            {error && <p className="form-error full" role="alert">{error}</p>}
            <div className="form-actions full">
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}{busy ? '正在提交' : '提交给老师'}
              </button>
            </div>
          </fieldset>
        </section>
      </form>
      <SubmissionHistory mode={mode} submissions={history} />
    </>
  )
}

function SubmissionHistory({ mode, submissions }: { mode: UploadMode; submissions: Submission[] }) {
  return (
    <section className="panel submission-history">
      <div className="panel-header">
        <div>
          <h2>{mode === 'assignment' ? '我的作业记录' : '我上传的错题与不会题'}</h2>
          <p>{mode === 'assignment' ? '在这里查看批改进度、得分和老师反馈' : '老师的提示与评价会显示在这里，归档后可到错题本复习'}</p>
        </div>
        <span className="submission-history-count">{submissions.length} 条</span>
      </div>
      {submissions.length ? (
        <div className="submission-history-list">
          {submissions.map((submission) => <SubmissionHistoryItem submission={submission} key={submission.id} />)}
        </div>
      ) : <p className="submission-history-empty">还没有{mode === 'assignment' ? '作业' : '题目'}上传记录。</p>}
    </section>
  )
}

function SubmissionHistoryItem({ submission }: { submission: Submission }) {
  const hasTeacherResponse = Boolean(
    submission.teacherFeedback || submission.teacherHint || submission.teacherEvaluation || submission.questionComments?.length || submission.teacherScore !== undefined,
  )

  return (
    <article className="submission-history-item">
      <header className="submission-history-heading">
        <div>
          <span>{subjectLabels[submission.subject]} · {formatDateTime(submission.submittedAt)}</span>
          <h3>{submission.title}</h3>
        </div>
        <StatusPill status={submission.status} />
      </header>

      <div className="submission-history-meta">
        {submission.minutesSpent !== undefined && <span>用时 {submission.minutesSpent} 分钟</span>}
        {submission.wrongNumbers.length > 0 && <span>题号 {submission.wrongNumbers.join('、')}</span>}
        {submission.confidence !== undefined && <span>完成把握 {submission.confidence}/5</span>}
      </div>

      {submission.attachments.length > 0 && (
        <div className="submission-attachments">
          <span>附件</span>
          <ul>
            {submission.attachments.map((attachment) => (
              <li key={attachment.id}>
                <FileText size={15} />
                {attachment.previewUrl
                  ? <a href={attachment.previewUrl} target="_blank" rel="noreferrer">{attachment.name}</a>
                  : <span>{attachment.name}</span>}
                <small>{formatFileSize(attachment.size)}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      {submission.selfReflection && <div className="submission-student-note"><span>我的说明</span><p>{submission.selfReflection}</p></div>}

      {submission.failureReason && (
        <div className="submission-history-alert">
          <AlertCircle size={16} /><div><strong>需要补充</strong><p>{submission.failureReason}</p></div>
        </div>
      )}

      <div className="submission-teacher-response">
        <div className="submission-response-label"><MessageSquare size={16} /><span>老师反馈</span></div>
        {hasTeacherResponse ? (
          <div className="submission-response-content">
            {submission.teacherScore !== undefined && <strong>得分：{submission.teacherScore}{submission.maxScore !== undefined ? ` / ${submission.maxScore}` : ''}</strong>}
            {submission.teacherHint && <div><span>提示</span><p>{submission.teacherHint}</p></div>}
            {submission.teacherEvaluation && <div><span>评价</span><p>{submission.teacherEvaluation}</p></div>}
            {!submission.teacherHint && !submission.teacherEvaluation && submission.teacherFeedback && <div><span>总体反馈</span><p>{submission.teacherFeedback}</p></div>}
            {submission.questionComments?.map((comment) => <div key={`${comment.questionNumber}-${comment.comment}`}><span>第 {comment.questionNumber} 题</span><p>{comment.comment}{comment.score !== undefined ? `（${comment.score}${comment.maxScore !== undefined ? `/${comment.maxScore}` : ' 分'}）` : ''}</p></div>)}
          </div>
        ) : <p className="submission-response-pending">老师还未反馈，请留意状态更新。</p>}
      </div>
    </article>
  )
}

export function UploadPage() {
  return <SubmissionUploadPage mode="assignment" />
}

export function WrongUploadPage() {
  return <SubmissionUploadPage mode="wrong_item" />
}
