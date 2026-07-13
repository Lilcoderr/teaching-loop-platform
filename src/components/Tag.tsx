import { errorTagLabels } from '../lib/utils'
import type { ErrorTag } from '../types/domain'

export function ErrorTagPill({ tag }: { tag: ErrorTag }) {
  return <span className={`tag tag-${tag}`}>{errorTagLabels[tag]}</span>
}

export function LabelTag({ children }: { children: string }) {
  return <span className="tag tag-neutral">{children}</span>
}
