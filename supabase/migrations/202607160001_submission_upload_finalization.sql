-- Make a submission visible to the review workflow only after every attachment
-- has been stored and its metadata has been committed. Existing rows predate
-- this lifecycle marker and are treated as already finalized.

begin;

alter table public.submissions
  add column if not exists upload_finalized_at timestamptz;

update public.submissions
set upload_finalized_at = coalesce(updated_at, submitted_at, now())
where upload_finalized_at is null;

comment on column public.submissions.upload_finalized_at is
  'Null while a client upload is incomplete; set exactly once by finalize_submission_upload.';

create index if not exists submissions_incomplete_upload_idx
  on public.submissions (created_by, submitted_at)
  where upload_finalized_at is null;

-- Serialize attachment inserts with finalization. Without the row lock, a
-- concurrent insert could pass its policy immediately before finalization and
-- commit an extra attachment after the submission became reviewable.
create or replace function public.guard_submission_attachment_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare submission_record public.submissions%rowtype;
begin
  select * into submission_record
  from public.submissions
  where id = new.submission_id
  for update;

  if not found then
    raise exception 'submission_not_found';
  end if;
  if submission_record.student_id <> new.student_id then
    raise exception 'attachment_student_mismatch';
  end if;
  if submission_record.upload_finalized_at is not null
    or submission_record.status <> 'analyzing'
  then
    raise exception 'submission_upload_already_finalized';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_submission_attachment_insert()
  from public, anon, authenticated;

drop trigger if exists submission_attachment_00_upload_window
  on public.submission_attachments;
create trigger submission_attachment_00_upload_window
  before insert on public.submission_attachments
  for each row execute function public.guard_submission_attachment_insert();

-- Keep the lifecycle marker immutable and require an explicit review-ready
-- state before a submission can move to a teacher terminal state.
create or replace function public.guard_submission_upload_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.upload_finalized_at is not null or new.status <> 'analyzing' then
      raise exception 'submission_must_start_uploading';
    end if;
    return new;
  end if;

  if old.upload_finalized_at is null then
    if new.upload_finalized_at is null then
      if new.status <> 'analyzing' then
        raise exception 'incomplete_submission_status_change';
      end if;
    elsif new.status <> 'uploaded' then
      raise exception 'submission_finalize_status_invalid';
    end if;
  elsif new.upload_finalized_at is distinct from old.upload_finalized_at then
    raise exception 'submission_upload_finalized_at_immutable';
  end if;

  if new.status in ('approved', 'rejected', 'scheduled')
    and new.status is distinct from old.status
    and old.status not in ('uploaded', 'needs_review', 'failed')
  then
    raise exception 'submission_not_ready_for_teacher_review';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_submission_upload_lifecycle()
  from public, anon, authenticated;

drop trigger if exists submissions_upload_lifecycle on public.submissions;
create trigger submissions_upload_lifecycle
  before insert or update on public.submissions
  for each row execute function public.guard_submission_upload_lifecycle();

create or replace function public.finalize_submission_upload(
  target_submission_id text,
  expected_attachment_count integer,
  expected_total_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare submission_record public.submissions%rowtype;
declare attachment_count integer;
declare attachment_bytes bigint;
declare stored_object_count integer;
declare all_object_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;
  if expected_attachment_count not between 1 and 12 then
    raise exception 'attachment_count_invalid';
  end if;
  if expected_total_bytes not between 1 and 104857600 then
    raise exception 'attachment_total_bytes_invalid';
  end if;

  select * into submission_record
  from public.submissions
  where id = target_submission_id
  for update;

  if not found then
    raise exception 'submission_not_found';
  end if;
  if submission_record.created_by <> auth.uid() then
    raise exception 'submission_upload_owner_required';
  end if;
  if submission_record.upload_finalized_at is not null
    or submission_record.status <> 'analyzing'
  then
    raise exception 'submission_upload_not_finalizable';
  end if;

  select count(*)::integer, coalesce(sum(file_size), 0)::bigint
  into attachment_count, attachment_bytes
  from public.submission_attachments
  where submission_id = target_submission_id;

  if attachment_count <> expected_attachment_count
    or attachment_bytes <> expected_total_bytes
  then
    raise exception 'attachment_manifest_mismatch';
  end if;

  select count(*)::integer
  into stored_object_count
  from public.submission_attachments attachment
  join storage.objects object
    on object.bucket_id = 'submissions'
   and object.name = attachment.storage_path
  where attachment.submission_id = target_submission_id
    and attachment.student_id = submission_record.student_id
    and split_part(attachment.storage_path, '/', 1) = submission_record.student_id::text
    and split_part(attachment.storage_path, '/', 2) = target_submission_id;

  select count(*)::integer
  into all_object_count
  from storage.objects object
  where object.bucket_id = 'submissions'
    and split_part(object.name, '/', 1) = submission_record.student_id::text
    and split_part(object.name, '/', 2) = target_submission_id;

  if stored_object_count <> attachment_count
    or all_object_count <> attachment_count
  then
    raise exception 'attachment_storage_manifest_mismatch';
  end if;

  update public.submissions
  set status = 'uploaded', upload_finalized_at = now(), updated_at = now()
  where id = target_submission_id;

  return jsonb_build_object(
    'submission_id', target_submission_id,
    'status', 'uploaded',
    'attachment_count', attachment_count,
    'total_bytes', attachment_bytes
  );
end;
$$;

revoke all on function public.finalize_submission_upload(text, integer, bigint)
  from public, anon;
grant execute on function public.finalize_submission_upload(text, integer, bigint)
  to authenticated;

drop policy if exists submissions_insert on public.submissions;
create policy submissions_insert on public.submissions
for insert to authenticated
with check (
  public.can_manage_student(student_id)
  and created_by = auth.uid()
  and status = 'analyzing'
  and upload_finalized_at is null
);

drop policy if exists submissions_creator_abort on public.submissions;
create policy submissions_creator_abort on public.submissions
for delete to authenticated
using (
  created_by = auth.uid()
  and status = 'analyzing'
  and upload_finalized_at is null
);

drop policy if exists attachments_insert on public.submission_attachments;
create policy attachments_insert on public.submission_attachments
for insert to authenticated
with check (
  public.can_manage_student(student_id)
  and exists (
    select 1
    from public.submissions submission
    where submission.id = submission_id
      and submission.student_id = submission_attachments.student_id
      and submission.created_by = auth.uid()
      and submission.status = 'analyzing'
      and submission.upload_finalized_at is null
  )
);

drop policy if exists submission_files_insert on storage.objects;
create policy submission_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'submissions'
  and array_length(storage.foldername(name), 1) = 2
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.is_active_student(auth.uid())
  and exists (
    select 1
    from public.submissions submission
    where submission.id = (storage.foldername(name))[2]
      and submission.student_id = auth.uid()
      and submission.created_by = auth.uid()
      and submission.status = 'analyzing'
      and submission.upload_finalized_at is null
  )
);

drop policy if exists submission_files_creator_abort on storage.objects;
create policy submission_files_creator_abort on storage.objects
for delete to authenticated
using (
  bucket_id = 'submissions'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1
    from public.submissions submission
    where submission.id = (storage.foldername(name))[2]
      and submission.created_by = auth.uid()
      and submission.status = 'analyzing'
      and submission.upload_finalized_at is null
  )
);

-- Wrong-item placeholders should not enter the student's durable self-reported
-- list until the attachment upload has passed finalization.
drop trigger if exists submissions_seed_self_reported_wrong_items
  on public.submissions;
create trigger submissions_seed_self_reported_wrong_items
  after update of upload_finalized_at on public.submissions
  for each row
  when (old.upload_finalized_at is null and new.upload_finalized_at is not null)
  execute function public.seed_self_reported_wrong_items();

-- Self-reflection is also evidence only after the upload manifest is complete.
drop trigger if exists submission_self_report on public.submissions;
create trigger submission_self_report
  after update of upload_finalized_at on public.submissions
  for each row
  when (old.upload_finalized_at is null and new.upload_finalized_at is not null)
  execute function public.capture_submission_self_report();

-- Realtime is optional in self-hosted/test environments. When the standard
-- Supabase publication exists, add the cross-account workflow tables exactly
-- once so clients can trigger a debounced bootstrap refresh.
do $$
declare table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array[
      'submissions',
      'submission_grades',
      'wrong_submission_feedback',
      'messages',
      'teacher_daily_evaluations',
      'review_tasks',
      'wrong_items',
      'learning_materials',
      'learning_material_grants',
      'weekly_reports'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end;
$$;

commit;
