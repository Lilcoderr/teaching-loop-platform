import type { LucideIcon } from 'lucide-react'

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'teal',
}: {
  label: string
  value: string | number
  detail?: string
  icon: LucideIcon
  tone?: 'teal' | 'blue' | 'amber' | 'red'
}) {
  return (
    <article className="stat-card">
      <span className={`stat-icon tone-${tone}`}><Icon size={18} /></span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </article>
  )
}
