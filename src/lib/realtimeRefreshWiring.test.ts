import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const context = readFileSync('src/context/PlatformContext.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/202607160001_submission_upload_finalization.sql', 'utf8')

describe('cross-account refresh wiring', () => {
  it('subscribes to the student-teacher workflow tables with one debounced refresh', () => {
    expect(context).toContain("realtimeClient.channel(`platform-live-")
    expect(context).toContain('window.setTimeout(() => void refresh(), 800)')
    for (const table of [
      'submissions',
      'messages',
      'teacher_daily_evaluations',
      'wrong_items',
      'learning_materials',
      'learning_material_grants',
      'weekly_reports',
    ]) {
      expect(migration).toContain(`'${table}'`)
      expect(context).toContain(`'${table}'`)
    }
  })

  it('ignores incomplete upload inserts until the manifest is finalized', () => {
    expect(context).toContain("next?.status === 'analyzing' && !next.upload_finalized_at")
  })

  it('patches a sent message locally instead of awaiting a full bootstrap', () => {
    const sendMessage = context.slice(context.indexOf('const sendMessage'), context.indexOf('const markMessagesRead'))
    expect(sendMessage).toContain(".select('id,student_id,sender_role,body,created_at,read').single()")
    expect(sendMessage).toContain('messages: previous.messages.some')
    expect(sendMessage).not.toContain('await refresh()')
  })
})
