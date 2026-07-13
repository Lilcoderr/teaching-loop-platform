-- Searchable Markdown methods, durable daily-evaluation evidence, and teacher
-- feedback for student wrong-question submissions.

alter table public.learning_materials
  add column if not exists body text not null default ''
    check (char_length(body) <= 100000),
  add column if not exists search_vector tsvector generated always as (
    to_tsvector(
      'simple',
      coalesce(title, '') || ' ' || coalesce(description, '') || ' ' ||
      case when material_type = 'method' then coalesce(body, '') else '' end
    )
  ) stored;

alter table public.learning_materials
  add constraint learning_material_method_body_required
  check (material_type <> 'method' or char_length(btrim(body)) > 0) not valid;

create index learning_materials_search_idx
  on public.learning_materials using gin (search_vector);
create index learning_materials_title_trigram_idx
  on public.learning_materials using gin (title extensions.gin_trgm_ops);
create index learning_materials_description_trigram_idx
  on public.learning_materials using gin (description extensions.gin_trgm_ops);
create index learning_materials_method_body_trigram_idx
  on public.learning_materials using gin (body extensions.gin_trgm_ops)
  where material_type = 'method';

alter table public.learning_evidence
  add column if not exists daily_evaluation_id uuid
    references public.teacher_daily_evaluations(id) on delete cascade;

create unique index learning_evidence_daily_evaluation_idx
  on public.learning_evidence (daily_evaluation_id)
  where daily_evaluation_id is not null;

create or replace function public.sync_daily_evaluation_evidence()
returns trigger language plpgsql security definer set search_path = public as $$
declare evidence_text text;
begin
  evidence_text := concat_ws(
    E'\n',
    'Evaluation date: ' || new.evaluation_date::text,
    case when new.subject is not null then 'Subject: ' || new.subject::text end,
    case when cardinality(new.highlights) > 0 then 'Highlights: ' || array_to_string(new.highlights, '; ') end,
    case when cardinality(new.improvements) > 0 then 'Improvements: ' || array_to_string(new.improvements, '; ') end
  );

  insert into public.learning_evidence (
    student_id, daily_evaluation_id, state, category, claim, evidence, confirmed_by
  ) values (
    new.student_id, new.id, 'teacher_verified', 'teacher_daily_evaluation',
    new.summary, evidence_text, new.teacher_id
  )
  on conflict (daily_evaluation_id) where daily_evaluation_id is not null do update set
    student_id = excluded.student_id,
    state = 'teacher_verified',
    category = 'teacher_daily_evaluation',
    claim = excluded.claim,
    evidence = excluded.evidence,
    confirmed_by = excluded.confirmed_by;
  return new;
end;
$$;

create trigger daily_evaluation_evidence_sync
  after insert or update of student_id, teacher_id, evaluation_date, subject, summary, highlights, improvements
  on public.teacher_daily_evaluations
  for each row execute function public.sync_daily_evaluation_evidence();

-- Backfill evaluations created before this migration.
insert into public.learning_evidence (
  student_id, daily_evaluation_id, state, category, claim, evidence, confirmed_by
)
select
  evaluation.student_id,
  evaluation.id,
  'teacher_verified',
  'teacher_daily_evaluation',
  evaluation.summary,
  concat_ws(
    E'\n',
    'Evaluation date: ' || evaluation.evaluation_date::text,
    case when evaluation.subject is not null then 'Subject: ' || evaluation.subject::text end,
    case when cardinality(evaluation.highlights) > 0 then 'Highlights: ' || array_to_string(evaluation.highlights, '; ') end,
    case when cardinality(evaluation.improvements) > 0 then 'Improvements: ' || array_to_string(evaluation.improvements, '; ') end
  ),
  evaluation.teacher_id
from public.teacher_daily_evaluations evaluation
on conflict (daily_evaluation_id) where daily_evaluation_id is not null do nothing;

create table public.wrong_submission_feedback (
  submission_id text primary key references public.submissions(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id),
  teacher_hint text not null default '' check (char_length(teacher_hint) <= 4000),
  teacher_evaluation text not null default '' check (char_length(teacher_evaluation) <= 8000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wrong_feedback_has_content check (
    char_length(btrim(teacher_hint)) > 0 or
    char_length(btrim(teacher_evaluation)) > 0 or
    archived_at is not null
  )
);
create index wrong_submission_feedback_student_idx
  on public.wrong_submission_feedback (student_id, updated_at desc);

create or replace function public.validate_wrong_submission_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.submissions submission
    where submission.id = new.submission_id
      and submission.student_id = new.student_id
      and submission.mode = 'wrong_item'
  ) then
    raise exception 'feedback must reference the matching wrong-item submission';
  end if;
  if not exists (
    select 1 from public.profiles teacher
    where teacher.id = new.teacher_id and teacher.role = 'teacher' and teacher.status = 'active'
  ) then
    raise exception 'teacher_id must reference an active teacher';
  end if;
  return new;
end;
$$;

create trigger wrong_submission_feedback_check
  before insert or update on public.wrong_submission_feedback
  for each row execute function public.validate_wrong_submission_feedback();
create trigger wrong_submission_feedback_updated
  before update on public.wrong_submission_feedback
  for each row execute function public.set_updated_at();

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
declare question_no text;
declare item_id uuid;
declare made integer := 0;
declare tags public.error_tag[];
declare note text;
declare already_archived boolean;
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

  select exists (
    select 1 from public.wrong_items where submission_id = submission.id
  ) into already_archived;

  insert into public.wrong_submission_feedback (
    submission_id, student_id, teacher_id, teacher_hint, teacher_evaluation, archived_at
  ) values (
    submission.id, submission.student_id, reviewer_id,
    left(coalesce(hint_text, ''), 4000), left(coalesce(evaluation_text, ''), 8000), now()
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
    archived_at = coalesce(public.wrong_submission_feedback.archived_at, excluded.archived_at);

  if already_archived then
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

  select * into draft from public.analysis_drafts
  where submission_id = submission.id order by created_at desc limit 1;

  select coalesce(array_agg(value::public.error_tag), '{}') into tags
  from unnest(coalesce(approved_tags, '{}')) value
  where value in ('concept','reading','modeling','calculation','writing','speed','avoidance');

  note := concat_ws(
    E'\n',
    case when btrim(coalesce(hint_text, '')) <> '' then 'Hint: ' || btrim(hint_text) end,
    case when btrim(coalesce(evaluation_text, '')) <> '' then 'Evaluation: ' || btrim(evaluation_text) end
  );

  for question_no in
    select unnest(
      case when cardinality(submission.wrong_numbers) = 0
        then array['unlabeled']
        else submission.wrong_numbers
      end
    )
  loop
    insert into public.wrong_items (
      student_id, submission_id, subject, question_number, title, question_text,
      knowledge_points, error_tags, evidence_state, teacher_note, occurred_at,
      next_review_at, verified_by, verified_at
    ) values (
      submission.student_id,
      submission.id,
      submission.subject,
      question_no,
      case when cardinality(submission.wrong_numbers) <= 1
        then submission.title
        else submission.title || ' - ' || question_no
      end,
      draft.question_text,
      coalesce(draft.knowledge_points, '{}'),
      tags,
      'teacher_verified',
      note,
      submission.assignment_date,
      now() + interval '1 day',
      reviewer_id,
      now()
    )
    returning id into item_id;

    insert into public.review_tasks (student_id, wrong_item_id, title, due_at, stage)
    values (submission.student_id, item_id, 'Review: ' || submission.title, now() + interval '1 day', 0)
    on conflict (wrong_item_id) where status = 'due' do nothing;

    insert into public.learning_evidence (
      student_id, wrong_item_id, submission_id, state, category, claim, evidence, confirmed_by
    ) values (
      submission.student_id,
      item_id,
      submission.id,
      'teacher_verified',
      'wrong_item',
      case when cardinality(tags) > 0
        then 'Confirmed error causes: ' || array_to_string(tags, ', ')
        else 'Wrong item archived by teacher'
      end,
      coalesce(nullif(note, ''), 'Teacher confirmed this wrong item.'),
      reviewer_id
    );
    made := made + 1;
  end loop;

  update public.submissions
  set status = 'scheduled', failure_reason = null
  where id = submission.id;

  insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
  values (
    reviewer_id,
    'wrong_submission.archive',
    'submission',
    submission.id,
    jsonb_build_object('wrong_items', made)
  );

  return jsonb_build_object(
    'submission_id', submission.id,
    'created', made,
    'idempotent', false,
    'wrong_item_ids', (
      select coalesce(jsonb_agg(id order by created_at), '[]'::jsonb)
      from public.wrong_items where submission_id = submission.id
    )
  );
end;
$$;

alter table public.wrong_submission_feedback enable row level security;
create policy wrong_submission_feedback_teacher_all
  on public.wrong_submission_feedback for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy wrong_submission_feedback_student_read
  on public.wrong_submission_feedback for select to authenticated
  using (public.is_active_student(student_id));

revoke all on function public.archive_wrong_item_submission(text, uuid, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.archive_wrong_item_submission(text, uuid, text, text, text[])
  to service_role;
grant select, insert, update on public.wrong_submission_feedback to authenticated;
grant all on public.wrong_submission_feedback to service_role;
