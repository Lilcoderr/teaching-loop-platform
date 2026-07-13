import { format, formatDistanceToNow, isToday, parseISO } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import type { ErrorTag, Subject, SubmissionStatus } from '../types/domain'

export const subjectLabels: Record<Subject, string> = {
  math: '数学',
  physics: '物理',
  chemistry: '化学',
}

export const statusLabels: Record<SubmissionStatus, string> = {
  uploaded: '已上传',
  analyzing: '分析中',
  needs_review: '待老师批改',
  approved: '已确认',
  rejected: '已驳回',
  scheduled: '已安排复习',
  failed: '需人工处理',
}

export const errorTagLabels: Record<ErrorTag, string> = {
  concept: '概念',
  reading: '审题',
  modeling: '建模',
  calculation: '运算',
  writing: '书写',
  speed: '速度',
  avoidance: '未作答/畏难',
}

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function formatShortDate(value: string) {
  return format(parseISO(value), 'M月d日', { locale: zhCN })
}

export function formatDateTime(value: string) {
  return format(parseISO(value), 'M月d日 HH:mm', { locale: zhCN })
}

export function relativeTime(value: string) {
  const date = parseISO(value)
  if (isToday(date)) return format(date, 'HH:mm')
  return formatDistanceToNow(date, { addSuffix: true, locale: zhCN })
}

export function uniqueId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function compactNumber(value: number) {
  if (value < 1000) return String(value)
  return `${(value / 1000).toFixed(1)}k`
}
