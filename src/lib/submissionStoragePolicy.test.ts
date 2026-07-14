import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/202607150001_fix_submission_storage_insert_rls.sql',
  'utf8',
)

function storageFoldername(path: string) {
  return path.split('/').slice(0, -1)
}

describe('submission storage insert policy migration', () => {
  it('matches the two-folder path emitted by the upload client', () => {
    const path = [
      '11111111-1111-4111-8111-111111111111',
      'submission-example',
      'attachment-example-question.jpg',
    ].join('/')

    expect(storageFoldername(path)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      'submission-example',
    ])
    expect(migration).toContain('array_length(storage.foldername(name), 1) = 2')
  })

  it('keeps inserts bound to the authenticated student and their submission', () => {
    expect(migration).toContain("(storage.foldername(name))[1] = auth.uid()::text")
    expect(migration).toContain('public.is_active_student(auth.uid())')
    expect(migration).toContain('submission.student_id = auth.uid()')
    expect(migration).toContain('submission.created_by = auth.uid()')
    expect(migration).toContain("submission.status = 'uploaded'")
    expect(migration).not.toMatch(/with check\s*\(\s*true\s*\)/i)
  })
})
