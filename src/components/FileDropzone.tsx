import { ArrowDown, ArrowUp, FileText, Image, Paperclip, Trash2, UploadCloud } from 'lucide-react'
import { type ChangeEvent, type DragEvent, useRef, useState } from 'react'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const FILE_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf'

function fileKey(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

export function FileDropzone({ files, onChange, maxMb = 15 }: { files: File[]; onChange: (files: File[]) => void; maxMb?: number }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')

  const addFiles = (incoming: File[]) => {
    const invalidType = incoming.find((file) => !ACCEPTED.includes(file.type))
    if (invalidType) {
      setError(`${invalidType.name} 的格式暂不支持`)
      return
    }
    const oversized = incoming.find((file) => file.size > maxMb * 1024 * 1024)
    if (oversized) {
      setError(`${oversized.name} 超过 ${maxMb} MB`)
      return
    }
    const existing = new Set(files.map(fileKey))
    const deduped = incoming.filter((file) => !existing.has(fileKey(file)))
    onChange([...files, ...deduped].slice(0, 12))
    setError(incoming.length + files.length > 12 ? '一次最多上传 12 个文件' : '')
  }

  const select = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    addFiles(Array.from(event.dataTransfer.files))
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= files.length) return
    const next = [...files]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div className="file-picker">
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <UploadCloud size={25} />
        <strong>拖入作业照片或 PDF</strong>
        <span>JPG、PNG、WebP、PDF，单个不超过 {maxMb} MB</span>
        <button type="button" className="button small" onClick={() => inputRef.current?.click()}><Paperclip size={15} />选择文件</button>
        <input ref={inputRef} type="file" multiple accept={FILE_ACCEPT} onChange={select} hidden />
      </div>
      {error && <p className="form-error">{error}</p>}
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file, index) => (
            <li key={fileKey(file)}>
              <span className="file-type">{file.type.startsWith('image/') ? <Image size={18} /> : <FileText size={18} />}</span>
              <div><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB · 第 {index + 1} 页</small></div>
              <div className="file-actions">
                <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} title="上移"><ArrowUp size={16} /></button>
                <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === files.length - 1} title="下移"><ArrowDown size={16} /></button>
                <button type="button" className="icon-button danger-icon" onClick={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))} title="移除"><Trash2 size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
