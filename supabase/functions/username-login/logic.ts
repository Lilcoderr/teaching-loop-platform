export type PublicLoginRole = 'teacher' | 'student' | 'parent'

export function publicAccountLabel(role: PublicLoginRole, displayName: string): string {
  const firstCharacter = Array.from(displayName.trim())[0] ?? ''
  if (!firstCharacter) return role === 'teacher' ? '老师' : role === 'parent' ? '学生家长' : '学生'
  if (role === 'student') return `${firstCharacter}同学`
  if (role === 'parent') return `${firstCharacter}同学家长`
  return `${firstCharacter}老师`
}

export function publicAccountDirectoryEntry(profile: {
  id: string
  role: PublicLoginRole
  display_name: string
}) {
  return {
    id: profile.id,
    role: profile.role,
    label: publicAccountLabel(profile.role, profile.display_name),
  }
}
