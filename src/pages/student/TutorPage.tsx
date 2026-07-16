import { Bot, BookOpen, CornerDownLeft, ImagePlus, LoaderCircle, Send, Sparkles, UserRound, X } from 'lucide-react'
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { CitationList } from '../../components/CitationList'
import { MarkdownContent } from '../../components/MarkdownContent'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { usePlatform, type TutorImageInput } from '../../context/PlatformContext'
import { formatDateTime, subjectLabels } from '../../lib/utils'
import type { Citation, HintLevel, Subject } from '../../types/domain'

const levelLabels: Array<{ value: HintLevel; label: string }> = [
  { value: 'diagnose', label: '诊断卡点' },
  { value: 'hint', label: '给个提示' },
  { value: 'key_step', label: '关键步骤' },
  { value: 'solution', label: '完整解答' },
]

const acceptedImageTypes = new Set<TutorImageInput['mimeType']>(['image/jpeg', 'image/png', 'image/webp'])
const maxOriginalImageBytes = 15 * 1024 * 1024
const directImageBytes = 2_500_000

function isTutorImageType(value: string): value is TutorImageInput['mimeType'] {
  return acceptedImageTypes.has(value as TutorImageInput['mimeType'])
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败，请重新选择。'))
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('读取图片失败，请重新选择。'))
    reader.readAsDataURL(file)
  })
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const element = new Image()
    element.onload = () => {
      URL.revokeObjectURL(url)
      resolve(element)
    }
    element.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法处理这张图片，请换一张后重试。'))
    }
    element.src = url
  })
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('图片压缩失败，请换一张后重试。')),
    'image/jpeg',
    quality,
  ))
}

async function prepareTutorImage(file: File): Promise<TutorImageInput> {
  if (file.size <= directImageBytes) {
    return {
      dataUrl: await readAsDataUrl(file),
      mimeType: file.type as TutorImageInput['mimeType'],
      name: file.name,
      size: file.size,
    }
  }

  const source = await loadImage(file)
  const scale = Math.min(1, 2000 / Math.max(source.naturalWidth, source.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器无法压缩图片，请先缩小图片后重试。')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  let compressed = await canvasBlob(canvas, file.size > 8 * 1024 * 1024 ? 0.72 : 0.82)
  if (compressed.size > 4 * 1024 * 1024) compressed = await canvasBlob(canvas, 0.62)
  if (compressed.size > 4 * 1024 * 1024) throw new Error('图片压缩后仍然过大，请裁剪题目区域后重试。')
  return {
    dataUrl: await readAsDataUrl(compressed),
    mimeType: 'image/jpeg',
    name: file.name.replace(/\.[^.]+$/, '') + '.jpg',
    size: compressed.size,
  }
}

function hasMeaningfulAttempt(value: string) {
  const text = value.trim()
  return text.length >= 8 && /(?:[0-9A-Za-z]|[=+\-*/^<>≤≥√∠]|\\[A-Za-z]+)/.test(text)
}

export function TutorPage() {
  const { state, sendTutorMessage, demoMode } = usePlatform()
  const studentId = state.currentUser.id
  const studentProfile = state.students.find((student) => student.id === studentId)
  const availableSubjects = studentProfile?.subjects ?? ['math']
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState('')
  const [subject, setSubject] = useState<Subject>(availableSubjects[0] ?? 'math')
  const [level, setLevel] = useState<HintLevel>('diagnose')
  const [image, setImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('正在检索资料并组织回答')
  const [error, setError] = useState('')
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const turns = state.tutorTurns.filter((turn) => turn.studentId === studentId)
  const consentReady = demoMode || Boolean(studentProfile?.guardianConsentAt)
  const textModelReady = demoMode || Boolean(consentReady && state.settings.aiEnabled && state.settings.textModelConfigured)
  const visionModelReady = demoMode || Boolean(textModelReady && state.settings.visionModelConfigured)
  const modelStatus = demoMode
    ? { label: '演示模式', tone: 'demo' }
    : !consentReady
      ? { label: '等待监护人知情记录', tone: 'missing' }
      : !state.settings.aiEnabled
        ? { label: 'AI 未启用', tone: 'missing' }
        : !state.settings.textModelConfigured
          ? { label: 'AI 文本模型未连接', tone: 'missing' }
          : !state.settings.visionModelConfigured
            ? { label: '文字已连接 · 图片未连接', tone: 'partial' }
            : { label: '文字与图片已连接', tone: 'connected' }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns.length])

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview)
  }, [imagePreview])

  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!isTutorImageType(file.type)) {
      setError('仅支持 JPG、PNG 或 WebP 图片。')
      return
    }
    if (file.size > maxOriginalImageBytes) {
      setError('原始图片不能超过 15 MB，请先裁剪题目区域。')
      return
    }
    setImage(file)
    setImagePreview(URL.createObjectURL(file))
    setError('')
  }

  const clearImage = () => {
    setImage(null)
    setImagePreview('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if ((!message.trim() && !image) || busy) return
    if (!consentReady) {
      setError('尚未完成监护人知情记录，请联系老师。')
      return
    }
    if (!textModelReady) {
      setError('AI 答疑尚未连接，请联系老师完成模型配置。')
      return
    }
    if (image && !visionModelReady) {
      setError('图片答疑尚未连接视觉模型，请先输入题目文字。')
      return
    }
    if (level === 'solution' && !hasMeaningfulAttempt(attempt)) {
      setError('查看完整解答前，请写下至少 8 个字符且包含公式、设元或计算步骤。')
      return
    }
    setBusy(true)
    setBusyLabel(image ? '正在处理题目图片' : '正在检索资料并组织回答')
    setError('')
    const current = message
    try {
      const imagePayload = image ? await prepareTutorImage(image) : undefined
      setBusyLabel('正在检索资料并组织回答')
      await sendTutorMessage(current, level, attempt, subject, imagePayload)
      setMessage('')
      setAttempt('')
      clearImage()
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
          <span><BookOpen size={16} />已连接 {state.knowledgeDocuments.filter((document) => document.studentId === studentId && document.active).length + state.learningResources.filter((resource) => resource.studentId === studentId).length} 份个人资料</span>
          <span className={`tutor-model-status ${modelStatus.tone}`}><Bot size={15} />{modelStatus.label}</span>
          <span className="privacy-note">仅检索你的资料</span>
        </div>
        <div className="chat-stream">
          {!turns.length && (
            <div className="chat-empty">
              <span><Sparkles size={25} /></span>
              <h2>从一个具体卡点开始</h2>
              <p>可以输入题目、上传一张题目图片，并选择你现在需要的帮助程度。</p>
            </div>
          )}
          {turns.map((turn) => (
            <article className={`chat-turn ${turn.role}`} key={turn.id}>
              <span className="chat-avatar">{turn.role === 'assistant' ? <Bot size={18} /> : <UserRound size={18} />}</span>
              <div className="chat-bubble">
                <div className="chat-meta"><strong>{turn.role === 'assistant' ? '知行 AI' : state.currentUser.displayName}</strong><span>{formatDateTime(turn.createdAt)}</span></div>
                <MarkdownContent>{turn.body}</MarkdownContent>
                {turn.usedGeneralKnowledge && <p className="general-knowledge-note">未找到可靠匹配的已学资料，本次由 AI 使用通用学科知识回答。</p>}
                {turn.citations && <CitationList citations={turn.citations} onSelect={setSelectedCitation} />}
              </div>
            </article>
          ))}
          {busy && <div className="chat-thinking"><LoaderCircle className="spin" size={17} />{busyLabel}</div>}
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
          {image && imagePreview && (
            <div className="tutor-image-preview">
              <img src={imagePreview} alt="待发送的题目" />
              <div><strong>{image.name}</strong><small>{(image.size / 1024 / 1024).toFixed(1)} MB · 仅本次答疑使用</small></div>
              <button type="button" className="icon-button" onClick={clearImage} title="移除图片" aria-label="移除图片"><X size={17} /></button>
            </div>
          )}
          <div className="composer-row">
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="描述题目和你卡住的位置" onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() }
            }} />
            <div className="tutor-composer-actions">
              <button type="button" className="icon-button tutor-image-button" onClick={() => imageInputRef.current?.click()} disabled={busy || !visionModelReady} title={!visionModelReady ? '图片答疑未配置' : image ? '更换图片' : '上传题目图片'} aria-label={!visionModelReady ? '图片答疑未配置' : image ? '更换图片' : '上传题目图片'}><ImagePlus size={18} /></button>
              <button type="submit" className="icon-button send-button" disabled={!textModelReady || (!message.trim() && !image) || busy || (level === 'solution' && !hasMeaningfulAttempt(attempt))} title={!consentReady ? '等待监护人知情记录' : !textModelReady ? 'AI 答疑未连接' : '发送'}><Send size={18} /></button>
              <input ref={imageInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={chooseImage} disabled={!visionModelReady} hidden />
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <small><CornerDownLeft size={12} /> Enter 发送，Shift + Enter 换行 · 每次 1 张，手机大图自动压缩</small>
        </form>
      </section>
      <Modal open={Boolean(selectedCitation)} title="引用来源" onClose={() => setSelectedCitation(null)}>
        {selectedCitation && <div className="citation-detail"><span>{selectedCitation.sourceType === 'wrong_item' ? '已确认错题' : selectedCitation.sourceType === 'solution' ? '题目解析' : '已学资料'}</span><h3>{selectedCitation.label}</h3>{selectedCitation.section && <p>{selectedCitation.section}</p>}{selectedCitation.excerpt && <code>{selectedCitation.excerpt}</code>}</div>}
      </Modal>
    </div>
  )
}
