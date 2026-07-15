-- Keep student-reported wrong questions separate from teacher-confirmed
-- long-term evidence. The existing self_reported enum value is the canonical
-- database representation of the product's "student reported" state.

begin;

create or replace function public.seed_self_reported_wrong_items()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare question_no text;
begin
  if new.mode <> 'wrong_item' or new.created_by <> new.student_id then
    return new;
  end if;

  if exists (
    select 1 from unnest(new.wrong_numbers) value
    where char_length(btrim(value)) not between 1 and 40
  ) then
    raise exception 'wrong_item_question_number_invalid';
  end if;

  for question_no in
    select distinct btrim(value)
    from unnest(
      case when cardinality(new.wrong_numbers) = 0
        then array['未标注']::text[]
        else new.wrong_numbers
      end
    ) value
  loop
    insert into public.wrong_items (
      student_id, submission_id, subject, question_number, title, question_text,
      knowledge_points, error_tags, evidence_state, teacher_note, occurred_at,
      next_review_at, verified_by, verified_at
    ) values (
      new.student_id,
      new.id,
      new.subject,
      question_no,
      case when cardinality(new.wrong_numbers) <= 1
        then new.title
        else new.title || ' · 第' || question_no || '题'
      end,
      null,
      '{}'::text[],
      new.student_error_tags,
      'self_reported',
      '',
      new.assignment_date,
      null,
      null,
      null
    )
    on conflict (submission_id, question_number) do nothing;
  end loop;

  return new;
end;
$$;

revoke all on function public.seed_self_reported_wrong_items()
  from public, anon, authenticated;

drop trigger if exists submissions_seed_self_reported_wrong_items on public.submissions;
create trigger submissions_seed_self_reported_wrong_items
  after insert on public.submissions
  for each row execute function public.seed_self_reported_wrong_items();

-- A failed attachment upload removes its still-uploaded submission. Remove only
-- the unverified placeholder records in that rollback path; verified records
-- retain the existing on-delete-set-null preservation behavior.
create or replace function public.cleanup_self_reported_wrong_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.wrong_items
  where submission_id = old.id and evidence_state = 'self_reported';
  return old;
end;
$$;

revoke all on function public.cleanup_self_reported_wrong_items()
  from public, anon, authenticated;

drop trigger if exists submissions_cleanup_self_reported_wrong_items on public.submissions;
create trigger submissions_cleanup_self_reported_wrong_items
  before delete on public.submissions
  for each row execute function public.cleanup_self_reported_wrong_items();

-- Backfill pending historical student uploads that predate the trigger. Already
-- archived submissions are left untouched, including legacy "unlabeled" rows.
do $$
begin
  if exists (
    select 1
    from public.submissions submission
    cross join lateral unnest(submission.wrong_numbers) value
    where submission.mode = 'wrong_item'
      and submission.created_by = submission.student_id
      and submission.status in ('uploaded', 'analyzing', 'needs_review', 'approved', 'rejected', 'failed')
      and char_length(btrim(value)) not between 1 and 40
  ) then
    raise exception 'historical_wrong_item_question_number_invalid';
  end if;
end;
$$;

insert into public.wrong_items (
  student_id, submission_id, subject, question_number, title, question_text,
  knowledge_points, error_tags, evidence_state, teacher_note, occurred_at,
  next_review_at, verified_by, verified_at
)
select
  submission.student_id,
  submission.id,
  submission.subject,
  numbers.question_no,
  case when cardinality(submission.wrong_numbers) <= 1
    then submission.title
    else submission.title || ' · 第' || numbers.question_no || '题'
  end,
  null,
  '{}'::text[],
  submission.student_error_tags,
  'self_reported',
  '',
  submission.assignment_date,
  null,
  null,
  null
from public.submissions submission
cross join lateral (
  select distinct btrim(value) as question_no
  from unnest(
    case when cardinality(submission.wrong_numbers) = 0
      then array['未标注']::text[]
      else submission.wrong_numbers
    end
  ) value
) numbers
where submission.mode = 'wrong_item'
  and submission.created_by = submission.student_id
  and submission.status in ('uploaded', 'analyzing', 'needs_review', 'approved', 'rejected', 'failed')
on conflict (submission_id, question_number) do nothing;

-- Confirming a student upload upgrades the seeded row in place. Only this
-- teacher-confirmed transition creates durable evidence and a review task.
create or replace function public.archive_wrong_item_submission(
  target_submission_id text,
  reviewer_id uuid,
  hint_text text,
  evaluation_text text,
  approved_tags text[]
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare submission public.submissions%rowtype;
declare draft public.analysis_drafts%rowtype;
declare stored_feedback public.wrong_submission_feedback%rowtype;
declare question_no text;
declare item_id uuid;
declare prior_state public.evidence_state;
declare was_verified boolean;
declare made integer := 0;
declare tags public.error_tag[];
declare note text;
declare claim_text text;
declare evidence_text text;
begin
  if not exists (
    select 1 from public.profiles
    where id = reviewer_id and role = 'teacher' and status = 'active'
  ) then
    raise exception 'teacher required';
  end if;

  select * into submission from public.submissions
  where id = target_submission_id for update;
  if not found then raise exception 'submission not found'; end if;
  if submission.mode <> 'wrong_item' then
    raise exception 'only wrong-item submissions can be archived here';
  end if;
  if submission.status = 'scheduled'
    and exists (
      select 1 from public.wrong_items existing
      where existing.submission_id = submission.id
        and existing.evidence_state = 'teacher_verified'
    )
    and not exists (
      select 1 from public.wrong_items existing
      where existing.submission_id = submission.id
        and existing.evidence_state <> 'teacher_verified'
    )
  then
    return jsonb_build_object(
      'submission_id', submission.id,
      'created', 0,
      'idempotent', true,
      'wrong_item_ids', (
        select coalesce(jsonb_agg(id order by created_at), '[]'::jsonb)
        from public.wrong_items where submission_id = submission.id
      )
    );
  end if;
  if submission.status <> 'scheduled'
    and submission.status not in ('uploaded', 'analyzing', 'needs_review', 'approved', 'failed')
  then
    raise exception 'wrong-item submission cannot be confirmed from status %', submission.status;
  end if;

  if exists (
    select 1 from unnest(submission.wrong_numbers) value
    where char_length(btrim(value)) not between 1 and 40
  ) then
    raise exception 'wrong_item_question_number_invalid';
  end if;
  if char_length(btrim(coalesce(hint_text, ''))) > 4000 then
    raise exception 'wrong_item_hint_too_long';
  end if;
  if char_length(btrim(coalesce(evaluation_text, ''))) > 8000 then
    raise exception 'wrong_item_evaluation_too_long';
  end if;

  insert into public.wrong_submission_feedback (
    submission_id, student_id, teacher_id, teacher_hint, teacher_evaluation, archived_at
  ) values (
    submission.id, submission.student_id, reviewer_id,
    btrim(coalesce(hint_text, '')), btrim(coalesce(evaluation_text, '')), now()
  ) on conflict (submission_id) do update set
    teacher_id = excluded.teacher_id,
    teacher_hint = case
      when btrim(excluded.teacher_hint) <> '' then excluded.teacher_hint
      else public.wrong_submission_feedback.teacher_hint
    end,
    teacher_evaluation = case
      when btrim(excluded.teacher_evaluation) <> '' then excluded.teacher_evaluation
      else public.wrong_submission_feedback.teacher_evaluation
    end,
    archived_at = coalesce(public.wrong_submission_feedback.archived_at, excluded.archived_at)
  returning * into stored_feedback;

  select * into draft from public.analysis_drafts
  where submission_id = submission.id order by created_at desc limit 1;

  select coalesce(array_agg(distinct value::public.error_tag), '{}') into tags
  from unnest(coalesce(approved_tags, '{}')) value
  where value in ('concept','reading','modeling','calculation','writing','speed','avoidance');

  note := concat_ws(
    E'\n',
    case when btrim(stored_feedback.teacher_hint) <> ''
      then '提示：' || btrim(stored_feedback.teacher_hint) end,
    case when btrim(stored_feedback.teacher_evaluation) <> ''
      then '评价：' || btrim(stored_feedback.teacher_evaluation) end
  );
  claim_text := case when cardinality(tags) > 0
    then '教师确认错因：' || array_to_string(tags, '、')
    else '教师已确认该错题'
  end;
  evidence_text := coalesce(nullif(note, ''), '教师已核对学生原始上传。');

  for question_no in
    select distinct btrim(value)
    from unnest(
      case when cardinality(submission.wrong_numbers) = 0
        then case when exists (
          select 1 from public.wrong_items legacy
          where legacy.submission_id = submission.id and legacy.question_number = 'unlabeled'
        ) then array['unlabeled']::text[] else array['未标注']::text[] end
        else submission.wrong_numbers
      end
    ) value
  loop
    prior_state := null;
    select existing.evidence_state into prior_state
    from public.wrong_items existing
    where existing.submission_id = submission.id
      and existing.question_number = question_no;
    was_verified := coalesce(prior_state = 'teacher_verified', false);

    insert into public.wrong_items (
      student_id, submission_id, subject, question_number, title, question_text,
      knowledge_points, error_tags, evidence_state, teacher_note, occurred_at,
      review_stage, next_review_at, resolved, verified_by, verified_at
    ) values (
      submission.student_id,
      submission.id,
      submission.subject,
      question_no,
      case when cardinality(submission.wrong_numbers) <= 1
        then submission.title
        else submission.title || ' · 第' || question_no || '题'
      end,
      draft.question_text,
      coalesce(draft.knowledge_points, '{}'),
      tags,
      'teacher_verified',
      note,
      submission.assignment_date,
      0,
      now() + interval '1 day',
      false,
      reviewer_id,
      now()
    ) on conflict (submission_id, question_number) do update set
      subject = excluded.subject,
      title = excluded.title,
      question_text = coalesce(excluded.question_text, wrong_items.question_text),
      knowledge_points = case when cardinality(excluded.knowledge_points) > 0
        then excluded.knowledge_points else wrong_items.knowledge_points end,
      error_tags = excluded.error_tags,
      evidence_state = 'teacher_verified',
      teacher_note = case when btrim(excluded.teacher_note) <> ''
        then excluded.teacher_note else wrong_items.teacher_note end,
      occurred_at = excluded.occurred_at,
      review_stage = case when wrong_items.evidence_state = 'teacher_verified'
        then wrong_items.review_stage else 0 end,
      next_review_at = case when wrong_items.evidence_state = 'teacher_verified'
        then wrong_items.next_review_at else excluded.next_review_at end,
      resolved = case when wrong_items.evidence_state = 'teacher_verified'
        then wrong_items.resolved else false end,
      verified_by = reviewer_id,
      verified_at = now()
    returning id into item_id;

    if not was_verified then
      insert into public.review_tasks (student_id, wrong_item_id, title, due_at, stage)
      values (
        submission.student_id, item_id,
        '复习：' || submission.title || case when question_no = '未标注' then '' else ' · 第' || question_no || '题' end,
        now() + interval '1 day', 0
      )
      on conflict (wrong_item_id) where status = 'due' do nothing;
      made := made + 1;
    end if;

    update public.learning_evidence
    set claim = claim_text, evidence = evidence_text, confirmed_by = reviewer_id
    where wrong_item_id = item_id
      and state = 'teacher_verified'
      and category = 'wrong_item';
    if not found then
      insert into public.learning_evidence (
        student_id, wrong_item_id, submission_id, state, category, claim, evidence, confirmed_by
      ) values (
        submission.student_id, item_id, submission.id, 'teacher_verified',
        'wrong_item', claim_text, evidence_text, reviewer_id
      );
    end if;
  end loop;

  if not exists (
    select 1 from public.wrong_items existing
    where existing.submission_id = submission.id
      and existing.evidence_state = 'teacher_verified'
  ) then
    raise exception 'wrong_item_confirmation_created_no_records';
  end if;

  update public.submissions
  set status = 'scheduled', failure_reason = null
  where id = submission.id;

  if made > 0 then
    insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
    values (
      reviewer_id, 'wrong_submission.confirm', 'submission', submission.id,
      jsonb_build_object('wrong_items_upgraded', made)
    );
  end if;

  return jsonb_build_object(
    'submission_id', submission.id,
    'created', made,
    'idempotent', made = 0,
    'wrong_item_ids', (
      select coalesce(jsonb_agg(id order by created_at), '[]'::jsonb)
      from public.wrong_items where submission_id = submission.id
    )
  );
end;
$$;

revoke all on function public.archive_wrong_item_submission(text, uuid, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.archive_wrong_item_submission(text, uuid, text, text, text[])
  to service_role;

-- Saving an assignment grade and confirming its wrong items is one database
-- transaction. Any failure in approval rolls back the grade upsert as well.
create or replace function public.grade_and_approve_submission(
  target_submission_id text,
  reviewer_id uuid,
  grade_score numeric,
  grade_max_score numeric,
  grade_feedback text,
  grade_question_feedback jsonb,
  approved_tags text[],
  confirmed_wrong_numbers text[]
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare submission public.submissions%rowtype;
declare grade_id uuid;
declare approval jsonb;
declare comments jsonb := coalesce(grade_question_feedback, '[]'::jsonb);
begin
  if not exists (
    select 1 from public.profiles
    where id = reviewer_id and role = 'teacher' and status = 'active'
  ) then
    raise exception 'teacher required';
  end if;

  select * into submission from public.submissions
  where id = target_submission_id for update;
  if not found then raise exception 'submission not found'; end if;
  if submission.mode <> 'assignment' then
    raise exception 'grade_and_approve_requires_assignment';
  end if;
  if char_length(btrim(coalesce(grade_feedback, ''))) not between 1 and 4000 then
    raise exception 'assignment_feedback_invalid';
  end if;
  if grade_score is not null and (grade_score < 0 or grade_score > 10000) then
    raise exception 'grade_score_invalid';
  end if;
  if grade_max_score is not null and (grade_max_score <= 0 or grade_max_score > 10000) then
    raise exception 'grade_max_score_invalid';
  end if;
  if grade_score is not null and grade_max_score is not null and grade_score > grade_max_score then
    raise exception 'grade_score_exceeds_max';
  end if;
  if cardinality(coalesce(confirmed_wrong_numbers, '{}'::text[])) > 50 then
    raise exception 'confirmed_wrong_numbers_limit';
  end if;
  if exists (
    select 1 from unnest(coalesce(confirmed_wrong_numbers, '{}'::text[])) value
    where char_length(btrim(value)) not between 1 and 40
  ) then
    raise exception 'confirmed_wrong_number_invalid';
  end if;
  if jsonb_typeof(comments) <> 'array' then
    raise exception 'question_feedback_must_be_array';
  end if;
  if jsonb_array_length(comments) > 100 then
    raise exception 'question_feedback_limit';
  end if;
  if exists (
    select 1 from jsonb_array_elements(comments) entry
    where jsonb_typeof(entry) <> 'object'
      or jsonb_typeof(entry -> 'questionNumber') is distinct from 'string'
      or char_length(btrim(entry ->> 'questionNumber')) not between 1 and 40
      or jsonb_typeof(entry -> 'comment') is distinct from 'string'
      or char_length(btrim(entry ->> 'comment')) not between 1 and 2000
  ) then
    raise exception 'question_feedback_invalid';
  end if;

  insert into public.submission_grades (
    submission_id, student_id, score, max_score, feedback,
    question_feedback, teacher_id, confirmed_at
  ) values (
    submission.id, submission.student_id, grade_score, grade_max_score,
    btrim(grade_feedback), comments, reviewer_id, now()
  ) on conflict (submission_id) do update set
    student_id = excluded.student_id,
    score = excluded.score,
    max_score = excluded.max_score,
    feedback = excluded.feedback,
    question_feedback = excluded.question_feedback,
    teacher_id = excluded.teacher_id,
    confirmed_at = excluded.confirmed_at
  returning id into grade_id;

  approval := public.approve_submission(
    submission.id,
    reviewer_id,
    approved_tags,
    btrim(grade_feedback),
    confirmed_wrong_numbers
  );

  insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
  values (
    reviewer_id, 'submission.grade_and_approve', 'submission', submission.id,
    jsonb_build_object('grade_id', grade_id, 'question_count', jsonb_array_length(comments))
  );

  return approval || jsonb_build_object('grade_id', grade_id);
end;
$$;

revoke all on function public.grade_and_approve_submission(
  text, uuid, numeric, numeric, text, jsonb, text[], text[]
) from public, anon, authenticated;
grant execute on function public.grade_and_approve_submission(
  text, uuid, numeric, numeric, text, jsonb, text[], text[]
) to service_role;

-- Feedback remains student-visible before confirmation through
-- wrong_submission_feedback. Once an item is confirmed, later feedback edits
-- must also update the durable wrong-item note and its searchable evidence.
create or replace function public.sync_verified_wrong_item_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
declare note text;
begin
  note := concat_ws(
    E'\n',
    case when btrim(new.teacher_hint) <> ''
      then '提示：' || btrim(new.teacher_hint) end,
    case when btrim(new.teacher_evaluation) <> ''
      then '评价：' || btrim(new.teacher_evaluation) end
  );

  if note <> '' then
    update public.wrong_items
    set teacher_note = note
    where submission_id = new.submission_id
      and evidence_state = 'teacher_verified';

    update public.learning_evidence evidence
    set evidence = note
    from public.wrong_items item
    where item.submission_id = new.submission_id
      and item.evidence_state = 'teacher_verified'
      and evidence.wrong_item_id = item.id
      and evidence.state = 'teacher_verified'
      and evidence.category = 'wrong_item';
  end if;

  return new;
end;
$$;

revoke all on function public.sync_verified_wrong_item_feedback()
  from public, anon, authenticated;

drop trigger if exists wrong_submission_feedback_sync_verified_items
  on public.wrong_submission_feedback;
create trigger wrong_submission_feedback_sync_verified_items
  after insert or update of teacher_hint, teacher_evaluation
  on public.wrong_submission_feedback
  for each row execute function public.sync_verified_wrong_item_feedback();

-- Reconcile feedback saved after confirmation before this trigger existed.
update public.wrong_items item
set teacher_note = concat_ws(
  E'\n',
  case when btrim(feedback.teacher_hint) <> ''
    then '提示：' || btrim(feedback.teacher_hint) end,
  case when btrim(feedback.teacher_evaluation) <> ''
    then '评价：' || btrim(feedback.teacher_evaluation) end
)
from public.wrong_submission_feedback feedback
where item.submission_id = feedback.submission_id
  and item.evidence_state = 'teacher_verified'
  and (
    btrim(feedback.teacher_hint) <> '' or
    btrim(feedback.teacher_evaluation) <> ''
  );

update public.learning_evidence evidence
set evidence = item.teacher_note
from public.wrong_items item
where evidence.wrong_item_id = item.id
  and item.evidence_state = 'teacher_verified'
  and btrim(item.teacher_note) <> ''
  and evidence.state = 'teacher_verified'
  and evidence.category = 'wrong_item';

commit;
