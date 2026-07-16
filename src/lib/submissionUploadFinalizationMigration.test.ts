import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/202607160001_submission_upload_finalization.sql',
  'utf8',
)

describe('submission upload finalization migration', () => {
  it('backfills old submissions and finalizes new uploads through one guarded RPC', () => {
    expect(migration).toContain('add column if not exists upload_finalized_at timestamptz')
    expect(migration).toContain('where upload_finalized_at is null;')
    expect(migration).toContain('create or replace function public.finalize_submission_upload(')
    expect(migration).toContain('where id = target_submission_id\n  for update;')
    expect(migration).toContain('attachment_count <> expected_attachment_count')
    expect(migration).toContain('attachment_bytes <> expected_total_bytes')
    expect(migration).toContain("set status = 'uploaded', upload_finalized_at = now()")
  })

  it('serializes attachment inserts and rejects metadata after finalization', () => {
    expect(migration).toContain('create or replace function public.guard_submission_attachment_insert()')
    expect(migration).toContain("submission_record.status <> 'analyzing'")
    expect(migration).toContain("raise exception 'submission_upload_already_finalized'")
    expect(migration).toContain('before insert on public.submission_attachments')
    expect(migration).toContain('join storage.objects object')
    expect(migration).toContain('all_object_count <> attachment_count')
  })

  it('prevents clients from forging a completed or teacher-reviewed state', () => {
    expect(migration).toContain("and status = 'analyzing'")
    expect(migration).toContain('and upload_finalized_at is null')
    expect(migration).toContain("new.status in ('approved', 'rejected', 'scheduled')")
    expect(migration).toContain("old.status not in ('uploaded', 'needs_review', 'failed')")
    expect(migration).toContain("raise exception 'submission_not_ready_for_teacher_review'")
    expect(migration).toContain('submission.created_by = auth.uid()')
  })

  it('seeds self-reported wrong items only after upload finalization', () => {
    expect(migration).toContain('after update of upload_finalized_at on public.submissions')
    expect(migration).toContain('old.upload_finalized_at is null and new.upload_finalized_at is not null')
    expect(migration).not.toContain('after insert on public.submissions\n  for each row execute function public.seed_self_reported_wrong_items()')
    expect(migration).toContain('execute function public.capture_submission_self_report()')
  })

  it('idempotently enables realtime refresh sources when the publication exists', () => {
    expect(migration).toContain("pubname = 'supabase_realtime'")
    for (const table of [
      'submissions',
      'submission_grades',
      'wrong_submission_feedback',
      'messages',
      'teacher_daily_evaluations',
      'review_tasks',
      'wrong_items',
      'learning_materials',
      'learning_material_grants',
      'weekly_reports',
    ]) {
      expect(migration).toContain(`'${table}'`)
    }
    expect(migration).toContain('alter publication supabase_realtime add table public.%I')
  })
})
