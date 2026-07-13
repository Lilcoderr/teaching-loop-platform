import { cn } from '../lib/utils'

export function Avatar({ name, color, size = 'md' }: { name: string; color: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cn('avatar', `avatar-${size}`)} style={{ backgroundColor: color }} aria-hidden="true">
      {name.slice(-2)}
    </span>
  )
}
