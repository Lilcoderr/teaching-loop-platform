import { MessageSquare, Send } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { usePlatform } from '../../context/PlatformContext'
import { formatDateTime } from '../../lib/utils'

export function MessagesPage() {
  const { state, sendMessage } = usePlatform()
  const [visibleCount, setVisibleCount] = useState(50)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const studentId = state.currentUser.id
  const messages = state.messages.filter((message) => message.studentId === studentId)
  const visibleMessages = messages.slice(-visibleCount)
  useEffect(() => bottomRef.current?.scrollIntoView(), [messages.length])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!body.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await sendMessage(studentId, body)
      setBody('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '留言发送失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="给老师留言" description="适合记录课堂外的问题、反馈和待讲内容。" />
      <section className="message-panel panel">
        <div className="message-stream">
          {!messages.length && <EmptyState icon={MessageSquare} title="还没有留言" detail="发出第一条问题后，老师会在这里回复。" />}
          {messages.length > visibleMessages.length && (
            <button type="button" className="button small" onClick={() => setVisibleCount((count) => count + 50)}>
              加载更早留言
            </button>
          )}
          {visibleMessages.map((message) => (
            <div className={`message-row ${message.senderRole}`} key={message.id}>
              <div><p>{message.body}</p><span>{message.senderRole === 'teacher' ? '老师' : '我'} · {formatDateTime(message.createdAt)}</span></div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form className="message-composer" onSubmit={submit}>
          <textarea value={body} onChange={(event) => { setBody(event.target.value); setError('') }} placeholder="写下问题或反馈……" disabled={busy} />
          <button className="button primary" type="submit" disabled={!body.trim() || busy}><Send size={16} />发送</button>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
      </section>
    </>
  )
}
