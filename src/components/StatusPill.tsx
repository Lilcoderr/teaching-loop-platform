import { statusLabels } from '../lib/utils'
import type { SubmissionStatus } from '../types/domain'

export function StatusPill({ status }: { status: SubmissionStatus }) {
  return <span className={`status-pill status-${status}`}>{statusLabels[status]}</span>
}
