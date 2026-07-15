import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/202607150002_review_schedule_material_citations.sql',
  'utf8',
)
const businessMigration = readFileSync(
  'supabase/migrations/202607150003_wrong_item_business_separation.sql',
  'utf8',
)
const reviewPage = readFileSync('src/pages/teacher/ReviewPage.tsx', 'utf8')
const platformContext = readFileSync('src/context/PlatformContext.tsx', 'utf8')
const reviewFunction = readFileSync('supabase/functions/review-submission/index.ts', 'utf8')

describe('review and material citation migration', () => {
  it('does not invent a wrong item when no wrong number was confirmed', () => {
    expect(migration).toContain('if cardinality(confirmed_numbers) = 0 then')
    expect(migration).toContain("set status = 'approved'")
    expect(migration).toContain('for number in select unnest(confirmed_numbers)')
    expect(migration).not.toContain("array['未标注']")
  })

  it('passes only teacher-confirmed assignment numbers through the transactional grade-and-approve RPC', () => {
    expect(reviewPage).toContain('const parsedWrongNumbers = confirmedWrongNumbers')
    expect(reviewPage).toContain('.split(/[，,、；;\\s]+/)')
    expect(reviewPage).toContain('await gradeAndApproveSubmission(')
    expect(platformContext).toContain('const normalizedWrongNumbers = [...new Set(cleanedWrongNumbers)]')
    expect(platformContext).toContain('confirmedWrongNumbers: normalizedWrongNumbers')
    expect(reviewFunction).toContain('confirmed_wrong_numbers: confirmedWrongNumbers')
    expect(reviewFunction).toContain("if (action === 'grade_and_approve')")
    expect(migration).toContain('confirmed_wrong_numbers text[]')
    expect(migration).toContain("if s.mode <> 'assignment' then")
    expect(migration).toContain('for number in select unnest(confirmed_numbers)')
    expect(migration).not.toContain('s.wrong_numbers')
    expect(businessMigration).toContain('create or replace function public.grade_and_approve_submission(')
  })

  it('prevents a review task from being completed before its due time', () => {
    expect(migration).toContain('if task.due_at > now() then')
    expect(migration).toContain("raise exception 'review_task_not_due'")
  })

  it('records exactly one source for learning-material citations', () => {
    expect(migration).toContain('learning_material_id uuid')
    expect(migration).toContain('num_nonnulls(knowledge_chunk_id, learning_material_id, wrong_item_id) = 1')
  })

  it('aligns the materials bucket with the HTML and legacy Word formats accepted by the UI', () => {
    expect(migration).toContain("'text/html'")
    expect(migration).toContain("'application/msword'")
  })
})
