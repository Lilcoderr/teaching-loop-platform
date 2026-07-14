import { describe, expect, it } from 'vitest'
import {
  publicAccountDirectoryEntry,
  publicAccountLabel,
} from '../../supabase/functions/username-login/logic'

describe('public login account directory', () => {
  it('shows only a surname or first character plus the role label', () => {
    expect(publicAccountLabel('student', '林小满')).toBe('林同学')
    expect(publicAccountLabel('parent', '周晨家长')).toBe('周同学家长')
    expect(publicAccountLabel('teacher', '方志远老师')).toBe('方老师')
    expect(publicAccountLabel('student', 'Alice Chen')).toBe('A同学')
  })

  it('never returns username, email, or the full display name', () => {
    const entry = publicAccountDirectoryEntry({
      id: '11111111-1111-4111-8111-111111111111',
      role: 'student',
      display_name: '林小满',
    })
    expect(entry).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      role: 'student',
      label: '林同学',
    })
    expect(JSON.stringify(entry)).not.toContain('林小满')
    expect(entry).not.toHaveProperty('username')
    expect(entry).not.toHaveProperty('email')
  })
})
