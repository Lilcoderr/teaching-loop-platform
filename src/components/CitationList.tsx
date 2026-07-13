import { BookOpen, FileCheck2, History } from 'lucide-react'
import type { Citation } from '../types/domain'

export function CitationList({ citations, onSelect }: { citations: Citation[]; onSelect?: (citation: Citation) => void }) {
  if (!citations.length) return null
  return (
    <div className="citation-list">
      <p>参考资料</p>
      {citations.map((citation) => {
        const Icon = citation.sourceType === 'wrong_item' ? History : citation.sourceType === 'solution' ? FileCheck2 : BookOpen
        return (
          <button type="button" className="citation" key={citation.id} title={citation.section ?? citation.label} onClick={() => onSelect?.(citation)}>
            <Icon size={15} />
            <span>{citation.label}</span>
            {citation.section && <small>{citation.section}</small>}
          </button>
        )
      })}
    </div>
  )
}
