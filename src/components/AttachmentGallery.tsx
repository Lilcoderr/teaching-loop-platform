import { ChevronLeft, ChevronRight, ExternalLink, FileImage, FileText, Maximize2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Attachment } from '../types/domain'

export function AttachmentGallery({ attachments, title }: { attachments: Attachment[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const images = useMemo(
    () => attachments.filter((file) => file.previewUrl && file.mimeType.startsWith('image/')),
    [attachments],
  )
  const active = activeIndex === null ? undefined : images[activeIndex]

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!['Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Escape') setActiveIndex(null)
      if (event.key === 'ArrowLeft') setActiveIndex((current) => current === null ? null : (current - 1 + images.length) % images.length)
      if (event.key === 'ArrowRight') setActiveIndex((current) => current === null ? null : (current + 1) % images.length)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, images.length])

  return (
    <>
      <div className="attachment-preview-grid">
        {attachments.map((file, index) => (
          <div className="attachment-preview" key={file.id}>
            {file.previewUrl && file.mimeType.startsWith('image/')
              ? (
                  <button
                    type="button"
                    className="attachment-image-button"
                    onClick={() => setActiveIndex(images.findIndex((image) => image.id === file.id))}
                    title="放大图片"
                    aria-label={`放大查看 ${file.name}`}
                  >
                    <img src={file.previewUrl} alt={`${title} 第 ${index + 1} 页`} />
                    <span><Maximize2 size={16} /></span>
                  </button>
                )
              : file.previewUrl
                ? <a href={file.previewUrl} target="_blank" rel="noreferrer"><FileText size={28} /><span>打开附件</span></a>
                : <span>{file.mimeType.startsWith('image/') ? <FileImage size={28} /> : <FileText size={28} />}</span>}
            <strong>第 {index + 1} 页</strong>
            <small>{file.name}</small>
          </div>
        ))}
      </div>

      {active?.previewUrl && (
        <div className="image-lightbox" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setActiveIndex(null)}>
          <section role="dialog" aria-modal="true" aria-label={active.name}>
            <header>
              <div><strong>{active.name}</strong><span>{(activeIndex ?? 0) + 1} / {images.length}</span></div>
              <div>
                <a className="icon-button" href={active.previewUrl} target="_blank" rel="noreferrer" title="打开原图" aria-label="打开原图"><ExternalLink size={18} /></a>
                <button className="icon-button" type="button" onClick={() => setActiveIndex(null)} title="关闭" aria-label="关闭图片"><X size={20} /></button>
              </div>
            </header>
            <div className="image-lightbox-body"><img src={active.previewUrl} alt={active.name} /></div>
            {images.length > 1 && (
              <footer>
                <button className="icon-button" type="button" onClick={() => setActiveIndex((current) => current === null ? null : (current - 1 + images.length) % images.length)} title="上一页" aria-label="上一页"><ChevronLeft size={22} /></button>
                <button className="icon-button" type="button" onClick={() => setActiveIndex((current) => current === null ? null : (current + 1) % images.length)} title="下一页" aria-label="下一页"><ChevronRight size={22} /></button>
              </footer>
            )}
          </section>
        </div>
      )}
    </>
  )
}
