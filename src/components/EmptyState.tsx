import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({ icon: Icon, title, detail, action }: { icon: LucideIcon; title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span><Icon size={24} /></span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  )
}
