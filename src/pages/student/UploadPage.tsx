import { Check, LoaderCircle, Send } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileDropzone } from '../../components/FileDropzone'
import { PageHeader } from '../../components/PageHeader'
import { StatusPill } from '../../components/StatusPill'
import { usePlatform } from '../../context/PlatformContext'
import { ERROR_TAG_OPTIONS } from '../../lib/review'
import { cn, formatDateTime, localDateKey, subjectLabels } from '../../lib/utils'
import type { ErrorTag, Subject, UploadMode } from '../../types/domain'

function SubmissionUploadPage({ mode }: { mode: UploadMode }) {
  const { state, createSubmission } = usePlatform()
  const navigate = useNavigate()
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
  const recentQuestions = state.submissions
    .filter((item) => item.studentId === state.currentUser.id && item.mode === 'wrong_item')
    .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime())

  const toggleTag = (tag: ErrorTag) => {
    setTags((previous) => previous.includes(tag) ? previous.filter((item) => item !== tag) : [...previous, tag])
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!title.trim()) return setError(mode === 'assignment' ? '请填写作业名称' : '请填写题目名称')
    if (!files.length) return setError('请至少选择一个文件')
    setBusy(true)
    try {
      await createSubmission({
        mode,
        subject,
        title: title.trim(),
        assignmentDate: new Date(`${assignmentDate}T12:00:00`).toISOString(),
        minutesSpent: minutesSpent ? Number(minutesSpent) : undefined,
        wrongNumbers: wrongNumbers.split(/[，,、\s]+/).map((item) => item.trim()).filter(Boolean),
        confidence,
        selfReflection: reflection.trim(),
        studentErrorTags: tags,
      }, files)
      navigate('/student', { replace: true })
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
      <form className="upload-layout" onSubmit={submit}>
        <section className="panel upload-main">
          <div className="panel-header"><div><h2>{mode === 'assignment' ? '作业照片或 PDF' : '题面与作答过程'}</h2><p>按页排序后提交，单次最多 12 个文件</p></div></div>
          <div className="panel-body">
            <FileDropzone files={files} onChange={setFiles} maxMb={state.settings.maxUploadMb} />
          </div>
        </section>

        <section className="panel upload-details">
          <div className="panel-header"><div><h2>{mode === 'assignment' ? '作业信息' : '错题信息'}</h2><p>标有“可选”的项目可以稍后补充</p></div></div>
          <div className="panel-body form-grid">
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
              <span>{mode === 'assignment' ? '希望重点批改的题号（可选）' : '题号（可选）'}</span>
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
            {error && <p className="form-error full">{error}</p>}
            <div className="form-actions full">
              <button className="button primary" type="submit" disabled={busy}>
                {busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}{busy ? '正在提交' : '提交给老师'}
              </button>
            </div>
          </div>
        </section>
      </form>
      {mode === 'wrong_item' && <section className="panel question-upload-history">
        <div className="panel-header"><div><h2>我上传的问题</h2><p>老师发送提示后会直接显示在这里，归档后可在错题本继续复习</p></div></div>
        {recentQuestions.length ? <div className="question-upload-list">{recentQuestions.map((item) => <article key={item.id}>
          <div><span>{subjectLabels[item.subject]} · {formatDateTime(item.submittedAt)}</span><strong>{item.title}</strong>{item.selfReflection && <p>{item.selfReflection}</p>}</div>
          <div className="question-upload-response">
            {item.teacherHint && <><span>老师提示</span><p>{item.teacherHint}</p></>}
            {item.teacherEvaluation && <><span>老师评价</span><p>{item.teacherEvaluation}</p></>}
            {!item.teacherHint && !item.teacherEvaluation && item.teacherFeedback && <><span>老师回复</span><p>{item.teacherFeedback}</p></>}
            {!item.teacherHint && !item.teacherEvaluation && !item.teacherFeedback && <span>等待老师回复</span>}
            <StatusPill status={item.status} />
          </div>
        </article>)}</div> : <p className="question-upload-empty">还没有上传记录。</p>}
      </section>}
    </>
  )
}

export function UploadPage() {
  return <SubmissionUploadPage mode="assignment" />
}

export function WrongUploadPage() {
  return <SubmissionUploadPage mode="wrong_item" />
}
