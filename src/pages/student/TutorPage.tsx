import { Bot, BookOpen, CornerDownLeft, LoaderCircle, Send, Sparkles, UserRound } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { CitationList } from '../../components/CitationList'
import { MarkdownContent } from '../../components/MarkdownContent'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { usePlatform } from '../../context/PlatformContext'
import { formatDateTime, subjectLabels } from '../../lib/utils'
import type { Citation, HintLevel, Subject } from '../../types/domain'

const levelLabels: Array<{ value: HintLevel; label: string }> = [
  { value: 'diagnose', label: '诊断卡点' },
  { value: 'hint', label: '给个提示' },
  { value: 'key_step', label: '关键步骤' },
  { value: 'solution', label: '完整解答' },
]

function hasMeaningfulAttempt(value: string) {
  const text = value.trim()
  return text.length >= 8 && /(?:[0-9A-Za-z]|[=+\-*/^<>≤≥√∠]|\\[A-Za-z]+)/.test(text)
}

export function TutorPage() {
  const { state, sendTutorMessage } = usePlatform()
  const studentId = state.currentUser.id
  const availableSubjects = state.students.find((student) => student.id === studentId)?.subjects ?? ['math']
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState('')
  const [subject, setSubject] = useState<Subject>(availableSubjects[0] ?? 'math')
  const [level, setLevel] = useState<HintLevel>('diagnose')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const turns = state.tutorTurns.filter((turn) => turn.studentId === studentId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns.length])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!message.trim() || busy) return
    if (level === 'solution' && !hasMeaningfulAttempt(attempt)) {
      setError('查看完整解答前，请写下至少 8 个字符且包含公式、设元或计算步骤。')
      return
    }
    setBusy(true)
    setError('')
    const current = message
    try {
      await sendTutorMessage(current, level, attempt, subject)
      setMessage('')
      setAttempt('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '答疑请求失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tutor-page">
      <PageHeader title="个性化答疑" description="回答会优先参考已学讲义和经老师确认的错题。" />
      <section className="tutor-shell">
        <div className="tutor-context-bar">
          <span><BookOpen size={16} />已连接 {state.knowledgeDocuments.filter((document) => document.studentId === studentId && document.active).length} 份个人资料</span>
          <span className="privacy-note">仅检索你的资料</span>
        </div>
        <div className="chat-stream">
          {!turns.length && (
            <div className="chat-empty">
              <span><Sparkles size={25} /></span>
              <h2>从一个具体卡点开始</h2>
              <p>可以输入题目、你的尝试，以及卡住的步骤。</p>
            </div>
          )}
          {turns.map((turn) => (
            <article className={`chat-turn ${turn.role}`} key={turn.id}>
              <span className="chat-avatar">{turn.role === 'assistant' ? <Bot size={18} /> : <UserRound size={18} />}</span>
              <div className="chat-bubble">
                <div className="chat-meta"><strong>{turn.role === 'assistant' ? '知行 AI' : state.currentUser.displayName}</strong><span>{formatDateTime(turn.createdAt)}</span></div>
                <MarkdownContent>{turn.body}</MarkdownContent>
                {turn.usedGeneralKnowledge && <p className="general-knowledge-note">本次未在已学资料中找到对应内容，回答使用了通用知识。</p>}
                {turn.citations && <CitationList citations={turn.citations} onSelect={setSelectedCitation} />}
              </div>
            </article>
          ))}
          {busy && <div className="chat-thinking"><LoaderCircle className="spin" size={17} />正在检索讲义和错题</div>}
          <div ref={bottomRef} />
        </div>
        <form className="chat-composer" onSubmit={submit}>
          <label className="tutor-subject"><span>当前科目</span><select value={subject} onChange={(event) => setSubject(event.target.value as Subject)}>{availableSubjects.map((item) => <option key={item} value={item}>{subjectLabels[item]}</option>)}</select></label>
          <div className="hint-levels">
            {levelLabels.map((option) => <button type="button" className={level === option.value ? 'active' : ''} onClick={() => setLevel(option.value)} key={option.value}>{option.label}</button>)}
          </div>
          {level === 'solution' && (
            <textarea className="attempt-input" value={attempt} onChange={(event) => setAttempt(event.target.value)} placeholder="先写下你已经尝试的公式、设元或步骤……" />
          )}
          <div className="composer-row">
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="描述题目和你卡住的位置" onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
            }} />
            <button type="submit" className="icon-button send-button" disabled={!message.trim() || busy || (level === 'solution' && !hasMeaningfulAttempt(attempt))} title="发送"><Send size={18} /></button>
          </div>
          {error && <p className="form-error">{error}</p>}
          <small><CornerDownLeft size={12} /> Enter 发送，Shift + Enter 换行</small>
        </form>
      </section>
      <Modal open={Boolean(selectedCitation)} title="引用来源" onClose={() => setSelectedCitation(null)}>
        {selectedCitation && <div className="citation-detail"><span>{selectedCitation.sourceType === 'wrong_item' ? '已确认错题' : selectedCitation.sourceType === 'solution' ? '题目解析' : '已学资料'}</span><h3>{selectedCitation.label}</h3>{selectedCitation.section && <p>{selectedCitation.section}</p>}{selectedCitation.excerpt && <code>{selectedCitation.excerpt}</code>}</div>}
      </Modal>
    </div>
  )
}
