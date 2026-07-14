-- Keep review state truthful, prevent early spaced-repetition completion,
-- and allow published learning materials to be cited by tutor answers.

begin;

alter table public.tutor_citations
  add column if not exists learning_material_id uuid
    references public.learning_materials(id) on delete set null;

alter table public.tutor_citations drop constraint if exists citation_has_source;
alter table public.tutor_citations
  add constraint citation_has_source check (
    num_nonnulls(knowledge_chunk_id, learning_material_id, wrong_item_id) = 1
  );

create or replace function public.approve_submission(
  target_submission_id text,
  reviewer_id uuid,
  approved_tags text[],
  reviewer_note text,
  confirmed_wrong_numbers text[]
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s public.submissions%rowtype;
declare draft public.analysis_drafts%rowtype;
declare number text;
declare item_id uuid;
declare made integer := 0;
declare tags public.error_tag[];
declare confirmed_numbers text[];
begin
  if not exists (
    select 1 from public.profiles
    where id = reviewer_id and role = 'teacher' and status = 'active'
  ) then
    raise exception 'teacher required';
  end if;
  select * into s from public.submissions where id = target_submission_id for update;
  if not found then raise exception 'submission not found'; end if;
  if s.mode <> 'assignment' then
    raise exception 'approve_submission_requires_assignment';
  end if;
  if s.status = 'scheduled' then
    return jsonb_build_object('submission_id', s.id, 'created', 0, 'idempotent', true);
  end if;
  if s.status not in ('uploaded', 'analyzing', 'needs_review', 'approved', 'failed') then
    raise exception 'submission cannot be approved from status %', s.status;
  end if;
  select coalesce(array_agg(distinct btrim(value)), '{}') into confirmed_numbers
  from unnest(coalesce(confirmed_wrong_numbers, '{}')) value
  where char_length(btrim(value)) between 1 and 40;

  -- A reviewed assignment without confirmed wrong question numbers is valid
  -- evidence of completion, not an artificial wrong item.
  if cardinality(confirmed_numbers) = 0 then
    if s.status = 'approved' then
      return jsonb_build_object('submission_id', s.id, 'created', 0, 'idempotent', true);
    end if;
    update public.submissions set status = 'approved', failure_reason = null where id = s.id;
    insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
    values (
      reviewer_id, 'submission.approve', 'submission', s.id::text,
      jsonb_build_object('wrong_items', 0, 'no_confirmed_wrong_numbers', true)
    );
    return jsonb_build_object('submission_id', s.id, 'created', 0, 'idempotent', false);
  end if;

  select * into draft from public.analysis_drafts
  where submission_id = s.id order by created_at desc limit 1;
  select coalesce(array_agg(value::public.error_tag), '{}') into tags
  from unnest(coalesce(approved_tags, '{}')) value
  where value in ('concept','reading','modeling','calculation','writing','speed','avoidance');

  for number in select unnest(confirmed_numbers)
  loop
    insert into public.wrong_items (
      student_id, submission_id, subject, question_number, title, question_text,
      knowledge_points, error_tags, evidence_state, teacher_note, occurred_at,
      next_review_at, verified_by, verified_at
    ) values (
      s.student_id, s.id, s.subject, number, s.title || ' · 第' || number || '题', draft.question_text,
      coalesce(draft.knowledge_points, '{}'), tags, 'teacher_verified', coalesce(reviewer_note, ''),
      s.assignment_date, now() + interval '1 day', reviewer_id, now()
    ) on conflict (submission_id, question_number) do update set
      error_tags = excluded.error_tags,
      teacher_note = excluded.teacher_note,
      knowledge_points = excluded.knowledge_points,
      verified_by = reviewer_id,
      verified_at = now()
    returning id into item_id;
    insert into public.review_tasks (student_id, wrong_item_id, title, due_at, stage)
    values (s.student_id, item_id, '复习：' || s.title || ' · 第' || number || '题', now() + interval '1 day', 0)
    on conflict (wrong_item_id) where status = 'due' do nothing;
    insert into public.learning_evidence (
      student_id, wrong_item_id, submission_id, state, category, claim, evidence, confirmed_by
    ) values (
      s.student_id, item_id, s.id, 'teacher_verified', 'wrong_item',
      '确认错因：' || coalesce(array_to_string(tags, '、'), '待补充'),
      coalesce(reviewer_note, '教师已复核原始提交'), reviewer_id
    );
    made := made + 1;
  end loop;
  update public.submissions set status = 'scheduled', failure_reason = null where id = s.id;
  insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
  values (
    reviewer_id, 'submission.approve', 'submission', s.id::text,
    jsonb_build_object('wrong_items', made)
  );
  return jsonb_build_object('submission_id', s.id, 'created', made, 'idempotent', false);
end;
$$;

revoke all on function public.approve_submission(text, uuid, text[], text, text[])
  from public, anon, authenticated;
grant execute on function public.approve_submission(text, uuid, text[], text, text[])
  to service_role;
revoke execute on function public.approve_submission(text, uuid, text[], text) from service_role;

create or replace function public.complete_review_task(
  target_task_id uuid,
  actor_id uuid,
  passed boolean
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare task public.review_tasks%rowtype;
declare next_stage smallint;
declare next_due timestamptz;
declare done boolean := false;
begin
  select * into task from public.review_tasks where id = target_task_id for update;
  if not found then raise exception 'review task not found'; end if;
  if not (
    actor_id = task.student_id or exists (
      select 1 from public.profiles
      where id = actor_id and role = 'teacher' and status = 'active'
    )
  ) then
    raise exception 'not allowed';
  end if;
  if task.status <> 'due' then
    return jsonb_build_object('task_id', task.id, 'idempotent', true);
  end if;
  if task.due_at > now() then
    raise exception 'review_task_not_due';
  end if;
  update public.review_tasks
  set status = 'completed', result_passed = passed, completed_at = now()
  where id = task.id;
  if passed and task.stage = 3 then
    update public.wrong_items
    set resolved = true, next_review_at = null, review_stage = 3
    where id = task.wrong_item_id;
    done := true;
  else
    next_stage := case when passed then task.stage + 1 else 0 end;
    next_due := now() + case next_stage
      when 0 then interval '1 day'
      when 1 then interval '3 days'
      when 2 then interval '7 days'
      else interval '14 days'
    end;
    update public.wrong_items
    set resolved = false, review_stage = next_stage, next_review_at = next_due
    where id = task.wrong_item_id;
    insert into public.review_tasks(student_id, wrong_item_id, title, due_at, stage)
    values (task.student_id, task.wrong_item_id, task.title, next_due, next_stage);
  end if;
  insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
  values (
    actor_id, 'review.complete', 'review_task', task.id::text,
    jsonb_build_object('passed', passed, 'resolved', done)
  );
  return jsonb_build_object(
    'task_id', task.id, 'passed', passed, 'resolved', done,
    'next_stage', next_stage, 'next_due', next_due
  );
end;
$$;

revoke all on function public.complete_review_task(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_review_task(uuid, uuid, boolean)
  to service_role;

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','application/pdf','text/plain','text/markdown','text/html',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]
where id = 'materials';

notify pgrst, 'reload schema';

commit;
