import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/202607150003_wrong_item_business_separation.sql',
  'utf8',
)
const reviewPage = readFileSync('src/pages/teacher/ReviewPage.tsx', 'utf8')
const questionBankPage = readFileSync('src/pages/teacher/StudentQuestionBankPage.tsx', 'utf8')
const appRoutes = readFileSync('src/App.tsx', 'utf8')
const platformContext = readFileSync('src/context/PlatformContext.tsx', 'utf8')
const reviewFunction = readFileSync('supabase/functions/review-submission/index.ts', 'utf8')

describe('assignment and student-reported wrong-item separation', () => {
  it('seeds only student-created wrong uploads as self-reported records without review tasks', () => {
    const seedBlock = migration.slice(
      migration.indexOf('create or replace function public.seed_self_reported_wrong_items()'),
      migration.indexOf('create or replace function public.cleanup_self_reported_wrong_items()'),
    )

    expect(seedBlock).toContain("new.mode <> 'wrong_item'")
    expect(seedBlock).toContain('new.created_by <> new.student_id')
    expect(seedBlock).toContain("'self_reported'")
    expect(seedBlock).toContain('on conflict (submission_id, question_number) do nothing')
    expect(seedBlock).not.toContain('public.review_tasks')
    expect(seedBlock).not.toContain('public.learning_evidence')
  })

  it('cleans upload-rollbacks and idempotently backfills pending historical submissions', () => {
    expect(migration).toContain("where submission_id = old.id and evidence_state = 'self_reported'")
    expect(migration).toContain('drop trigger if exists submissions_seed_self_reported_wrong_items')
    expect(migration).toContain('drop trigger if exists submissions_cleanup_self_reported_wrong_items')
    expect(migration).toContain("submission.status in ('uploaded', 'analyzing', 'needs_review', 'approved', 'rejected', 'failed')")
    expect(migration).toContain('on conflict (submission_id, question_number) do nothing')
  })

  it('upgrades the same record only when a teacher confirms it', () => {
    expect(migration).toContain('on conflict (submission_id, question_number) do update set')
    expect(migration).toContain("evidence_state = 'teacher_verified'")
    expect(migration).toContain('if not was_verified then')
    expect(migration).toContain("if submission.status = 'scheduled'")
    expect(migration).toContain("and existing.evidence_state = 'teacher_verified'")
    expect(migration).toContain("and existing.evidence_state <> 'teacher_verified'")
    expect(migration).toContain('insert into public.review_tasks')
    expect(migration).toContain("and state = 'teacher_verified'")
    expect(migration).toContain('if not found then\n      insert into public.learning_evidence')
    expect(migration).toContain("'idempotent', made = 0")
  })

  it('preserves separately saved hints and evaluations in the confirmed long-term note', () => {
    expect(migration).toContain('declare stored_feedback public.wrong_submission_feedback%rowtype;')
    expect(migration).toContain('returning * into stored_feedback;')
    expect(migration).toContain('btrim(stored_feedback.teacher_hint)')
    expect(migration).toContain("'提示：' || btrim(stored_feedback.teacher_hint)")
    expect(migration).toContain('btrim(stored_feedback.teacher_evaluation)')
    expect(migration).toContain("'评价：' || btrim(stored_feedback.teacher_evaluation)")
  })

  it('rejects invalid question numbers and cannot schedule a confirmation without a verified record', () => {
    expect(migration).toContain("raise exception 'wrong_item_question_number_invalid'")
    expect(migration).toContain('from unnest(new.wrong_numbers) value')
    expect(migration).toContain('from unnest(submission.wrong_numbers) value')
    expect(migration).toContain("raise exception 'wrong_item_confirmation_created_no_records'")
    expect(migration.indexOf("raise exception 'wrong_item_confirmation_created_no_records'"))
      .toBeLessThan(migration.indexOf("set status = 'scheduled'"))
  })

  it('rejects oversized teacher-confirmed assignment numbers instead of truncating them', () => {
    expect(reviewPage).toContain("Array.from(value).length > 40")
    expect(reviewPage).toContain('单个题号最多 40 个字符，请缩短后再确认')
    expect(platformContext).toContain("cleanedConfirmedWrongNumbers.some((value) => Array.from(value).length > 40)")
    expect(reviewFunction).toContain("if (Array.from(result).length > 40)")
    expect(reviewFunction).toContain('if (value.length > 50)')
    expect(reviewFunction).toContain("'invalid_question_number'")
    expect(migration).toContain("raise exception 'confirmed_wrong_numbers_limit'")
    expect(migration).toContain("raise exception 'confirmed_wrong_number_invalid'")
    expect(reviewFunction).not.toContain('.trim().slice(0, 40)')
  })

  it('uses one transactional operation for assignment grading and approval', () => {
    const atomicFunction = migration.slice(
      migration.indexOf('create or replace function public.grade_and_approve_submission('),
      migration.indexOf('create or replace function public.sync_verified_wrong_item_feedback()'),
    )
    expect(reviewPage).toContain('await gradeAndApproveSubmission(')
    expect(reviewPage).not.toContain('await gradeSubmission(')
    expect(reviewPage).not.toContain('await approveSubmission(')
    expect(platformContext).toContain("action: 'grade_and_approve'")
    expect(reviewFunction).toContain("if (action === 'grade_and_approve')")
    expect(reviewFunction).toContain("db.rpc('grade_and_approve_submission'")
    expect(atomicFunction.indexOf('insert into public.submission_grades'))
      .toBeLessThan(atomicFunction.indexOf('approval := public.approve_submission('))
    expect(atomicFunction).toContain("return approval || jsonb_build_object('grade_id', grade_id)")
  })

  it('rejects wrong-item submissions from the legacy assignment grade action', () => {
    const gradeAction = reviewFunction.slice(
      reviewFunction.indexOf("if (action === 'grade')"),
      reviewFunction.indexOf("if (action === 'approve')"),
    )
    expect(gradeAction).toContain(".select('id,student_id,status,mode')")
    expect(gradeAction).toContain("if (submission.mode !== 'assignment')")
    expect(gradeAction).toContain("'invalid_submission_mode'")
    expect(gradeAction.indexOf("if (submission.mode !== 'assignment')"))
      .toBeLessThan(gradeAction.indexOf("db.from('submission_grades').upsert"))
  })

  it('atomically rejects only submissions that are still in a rejectable status', () => {
    const rejectAction = reviewFunction.slice(reviewFunction.indexOf("if (action === 'reject')"))
    expect(rejectAction).toContain(".in('status', ['uploaded', 'analyzing', 'needs_review', 'failed'])")
    expect(rejectAction).toContain(".select('id').maybeSingle()")
    expect(rejectAction).toContain("throw new HttpError(409, '当前状态已变化，不能退回该提交'")
  })

  it('fails migration before backfill when historical wrong-item numbers are invalid', () => {
    const preflightStart = migration.indexOf('-- Backfill pending historical student uploads')
    const preflight = migration.slice(
      preflightStart,
      migration.indexOf('insert into public.wrong_items (', preflightStart),
    )
    expect(preflight).toContain('cross join lateral unnest(submission.wrong_numbers) value')
    expect(preflight).toContain('char_length(btrim(value)) not between 1 and 40')
    expect(preflight).toContain("raise exception 'historical_wrong_item_question_number_invalid'")
  })

  it('rejects oversized review text instead of slicing it', () => {
    expect(reviewFunction).toContain("textField(body.teacherHint, '教师提示', 4000)")
    expect(reviewFunction).toContain("textField(body.teacherEvaluation, '教师评价', 8000)")
    expect(reviewFunction).toContain("textField(body.feedback, '总体反馈', 4000)")
    expect(reviewFunction).toContain('if (value.length > 100)')
    expect(reviewFunction).not.toContain('.slice(0, 4000)')
    expect(reviewFunction).not.toContain('.slice(0, 8000)')
    expect(reviewFunction).not.toContain('.slice(0, 2000)')
    expect(reviewPage).toContain('maxLength={4000}')
    expect(questionBankPage).toContain('maxLength={8000}')
  })

  it('syncs later feedback edits to confirmed wrong-item notes and long-term evidence', () => {
    expect(migration).toContain('create or replace function public.sync_verified_wrong_item_feedback()')
    expect(migration).toContain("set teacher_note = note")
    expect(migration).toContain('update public.learning_evidence evidence')
    expect(migration).toContain("and evidence.category = 'wrong_item'")
    expect(migration).toContain('wrong_submission_feedback_sync_verified_items')
    expect(migration).toContain('Reconcile feedback saved after confirmation before this trigger existed.')
  })

  it('keeps wrong uploads out of the assignment review page', () => {
    expect(reviewPage).toContain("item.mode === 'assignment'")
    expect(reviewPage).toContain('<PageHeader title="作业批改"')
    expect(reviewPage).toContain('/teacher/wrong-items')
    expect(reviewPage).not.toContain('item.mode === reviewMode')
    expect(reviewPage).not.toContain('仅发送提示')
  })

  it('handles student reports independently in the student question bank', () => {
    expect(questionBankPage).toContain('const confirmedItems = useMemo(')
    expect(questionBankPage).toContain('const filteredWrongUploads = useMemo(')
    expect(questionBankPage).toContain("item.evidenceState !== 'teacher_verified'")
    expect(questionBankPage).toContain('await gradeSubmission(selectedUpload.id')
    expect(questionBankPage).toContain('await approveSubmission(')
    expect(questionBankPage).toContain('teacherEvaluation.trim(),\n        [],\n        teacherHint.trim(),')
    expect(questionBankPage).toContain('确认并纳入长期错题')
    expect(appRoutes).toContain('path="teacher/wrong-items"')
  })

  it('returns incomplete uploads with a student-visible reason outside the pending queue', () => {
    expect(questionBankPage).toContain('rejectSubmission } = usePlatform()')
    expect(questionBankPage).toContain("item.status !== 'rejected'")
    expect(questionBankPage).toContain("const [rejectReason, setRejectReason] = useState(")
    expect(questionBankPage).toContain('await rejectSubmission(selectedUpload.id, rejectReason.trim())')
    expect(questionBankPage).toContain('upload.failureReason')
    expect(questionBankPage).toContain('退回补充')
  })

  it('keeps original attachments available before and after confirmation', () => {
    expect(questionBankPage).toContain('<AttachmentGallery attachments={selectedUpload.attachments}')
    expect(questionBankPage).toContain('item.submissionId && state.submissions.some(')
    expect(questionBankPage).toContain('onClick={() => openUpload(item.submissionId)}')
    expect(questionBankPage).toContain('查看原始上传')
  })
})
