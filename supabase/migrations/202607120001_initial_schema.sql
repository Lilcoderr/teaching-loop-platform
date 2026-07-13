-- Teaching Loop Platform V1. All private data is protected by RLS; Edge Functions
-- use service_role only after performing their own role or sync-token checks.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create type public.app_role as enum ('teacher', 'student', 'parent');
create type public.account_status as enum ('active', 'disabled');
create type public.subject as enum ('math', 'physics', 'chemistry');
create type public.upload_mode as enum ('assignment', 'wrong_item');
create type public.submission_status as enum ('uploaded', 'analyzing', 'needs_review', 'approved', 'rejected', 'scheduled', 'failed');
create type public.evidence_state as enum ('self_reported', 'ai_inferred', 'teacher_verified');
create type public.knowledge_visibility as enum ('student_visible', 'solution_gated', 'teacher_only');
create type public.knowledge_document_type as enum ('lecture', 'exercise', 'solution', 'lesson_plan');
create type public.error_tag as enum ('concept', 'reading', 'modeling', 'calculation', 'writing', 'speed', 'avoidance');
create type public.review_status as enum ('due', 'completed', 'missed');
create type public.message_sender_role as enum ('student', 'teacher');
create type public.tutor_turn_role as enum ('student', 'assistant');
create type public.hint_level as enum ('diagnose', 'hint', 'key_step', 'solution');
create type public.report_status as enum ('draft', 'published');
create type public.sync_status as enum ('running', 'succeeded', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username extensions.citext not null unique,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role public.app_role not null,
  avatar_color text not null default '#2563eb',
  status public.account_status not null default 'active',
  must_change_password boolean not null default true,
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username::text ~ '^[A-Za-z0-9_.-]{2,40}$')
);
create unique index one_teacher_only on public.profiles ((role)) where role = 'teacher';

create table public.student_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  grade text not null default '',
  subjects public.subject[] not null default '{}',
  target_score numeric(6,2),
  guardian_consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint target_score_nonnegative check (target_score is null or target_score >= 0)
);

create table public.parent_students (
  parent_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id)
);

create table public.submissions (
  id text primary key default gen_random_uuid()::text,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  mode public.upload_mode not null,
  subject public.subject not null,
  title text not null check (char_length(title) between 1 and 160),
  assignment_date date not null default current_date,
  submitted_at timestamptz not null default now(),
  minutes_spent integer check (minutes_spent is null or minutes_spent between 0 and 1440),
  wrong_numbers text[] not null default '{}',
  confidence smallint check (confidence is null or confidence between 1 and 5),
  self_reflection text check (self_reflection is null or char_length(self_reflection) <= 4000),
  student_error_tags public.error_tag[] not null default '{}',
  status public.submission_status not null default 'uploaded',
  failure_reason text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint submission_wrong_numbers_limit check (cardinality(wrong_numbers) <= 50),
  constraint submission_wrong_numbers_no_null check (array_position(wrong_numbers, null) is null),
  constraint submission_error_tags_limit check (cardinality(student_error_tags) <= 7)
);
create index submissions_student_date_idx on public.submissions (student_id, submitted_at desc);
create index submissions_status_idx on public.submissions (status, submitted_at desc);

create table public.submission_attachments (
  id text primary key default gen_random_uuid()::text,
  submission_id text not null references public.submissions(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 26214400),
  storage_path text not null unique,
  page_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index submission_attachments_submission_idx on public.submission_attachments (submission_id, page_order);

create table public.analysis_drafts (
  id uuid primary key default gen_random_uuid(),
  submission_id text not null references public.submissions(id) on delete cascade,
  summary text not null,
  question_text text,
  proposed_tags public.error_tag[] not null default '{}',
  knowledge_points text[] not null default '{}',
  evidence text[] not null default '{}',
  confidence numeric(4,3) not null default 0 check (confidence between 0 and 1),
  raw_model_output jsonb,
  model_name text,
  fallback_used boolean not null default false,
  created_at timestamptz not null default now()
);
create index analysis_drafts_submission_idx on public.analysis_drafts (submission_id, created_at desc);

create table public.wrong_items (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  submission_id text references public.submissions(id) on delete set null,
  subject public.subject not null,
  question_number text not null default '未标注',
  title text not null,
  question_text text,
  knowledge_points text[] not null default '{}',
  error_tags public.error_tag[] not null default '{}',
  evidence_state public.evidence_state not null default 'teacher_verified',
  teacher_note text not null default '',
  occurred_at date not null default current_date,
  recurrence_count integer not null default 1 check (recurrence_count > 0),
  review_stage smallint not null default 0 check (review_stage between 0 and 3),
  next_review_at timestamptz,
  resolved boolean not null default false,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, question_number)
);
create index wrong_items_student_subject_idx on public.wrong_items (student_id, subject, occurred_at desc);
create index wrong_items_review_idx on public.wrong_items (student_id, resolved, next_review_at);

create table public.learning_evidence (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  wrong_item_id uuid references public.wrong_items(id) on delete cascade,
  submission_id text references public.submissions(id) on delete cascade,
  state public.evidence_state not null,
  category text not null,
  claim text not null,
  evidence text not null,
  confirmed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint verified_has_confirmer check (state <> 'teacher_verified' or confirmed_by is not null)
);
create index learning_evidence_student_idx on public.learning_evidence (student_id, state, created_at desc);

create table public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  wrong_item_id uuid not null references public.wrong_items(id) on delete cascade,
  title text not null,
  due_at timestamptz not null,
  stage smallint not null check (stage between 0 and 3),
  status public.review_status not null default 'due',
  result_passed boolean,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_due_review_per_wrong_item on public.review_tasks (wrong_item_id) where status = 'due';
create index review_tasks_student_due_idx on public.review_tasks (student_id, status, due_at);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles(id),
  sender_role public.message_sender_role not null,
  body text not null check (char_length(body) between 1 and 4000),
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index messages_student_created_idx on public.messages (student_id, created_at);

create table public.tutor_turns (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  role public.tutor_turn_role not null,
  body text not null check (char_length(body) between 1 and 12000),
  hint_level public.hint_level,
  used_general_knowledge boolean not null default false,
  created_at timestamptz not null default now()
);
create index tutor_turns_student_created_idx on public.tutor_turns (student_id, created_at);

create table public.weekly_reports (
  id text primary key default gen_random_uuid()::text,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  title text not null,
  summary text not null default '',
  progress text[] not null default '{}',
  concerns text[] not null default '{}',
  next_actions text[] not null default '{}',
  status public.report_status not null default 'draft',
  published_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_report_period check (period_end >= period_start),
  unique (student_id, period_start, period_end)
);
create index weekly_reports_student_idx on public.weekly_reports (student_id, status, period_end desc);

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  student_id uuid references public.student_profiles(id) on delete cascade,
  subject public.subject not null,
  title text not null,
  document_type public.knowledge_document_type not null,
  visibility public.knowledge_visibility not null,
  relative_path text not null,
  content_hash text not null,
  version integer not null default 1 check (version > 0),
  active boolean not null default true,
  active_version_id uuid,
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_documents_scope_idx on public.knowledge_documents (student_id, subject, active, visibility);

create table public.knowledge_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  version integer not null,
  content_hash text not null,
  source_modified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (document_id, version),
  unique (document_id, content_hash)
);
alter table public.knowledge_documents
  add constraint knowledge_documents_active_version_fk
  foreign key (active_version_id) references public.knowledge_document_versions(id) on delete set null;

create table public.knowledge_document_grants (
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (document_id, student_id)
);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  version_id uuid not null references public.knowledge_document_versions(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  heading text,
  content text not null check (char_length(content) between 1 and 30000),
  content_hash text not null,
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(heading, '') || ' ' || content)) stored,
  embedding extensions.vector(1536),
  token_count integer check (token_count is null or token_count >= 0),
  created_at timestamptz not null default now(),
  unique (version_id, ordinal)
);
create index knowledge_chunks_search_idx on public.knowledge_chunks using gin (search_vector);
create index knowledge_chunks_trigram_idx on public.knowledge_chunks using gin (content extensions.gin_trgm_ops);
create index knowledge_chunks_document_idx on public.knowledge_chunks (document_id, version_id, ordinal);
create index knowledge_chunks_embedding_idx on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops) where embedding is not null;

create table public.tutor_citations (
  id uuid primary key default gen_random_uuid(),
  tutor_turn_id uuid not null references public.tutor_turns(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  knowledge_chunk_id uuid references public.knowledge_chunks(id) on delete set null,
  wrong_item_id uuid references public.wrong_items(id) on delete set null,
  label text not null,
  source_type text not null check (source_type in ('lecture', 'exercise', 'solution', 'wrong_item')),
  section text,
  excerpt text,
  visibility public.knowledge_visibility not null,
  created_at timestamptz not null default now(),
  constraint citation_has_source check (knowledge_chunk_id is not null or wrong_item_id is not null)
);
create index tutor_citations_turn_idx on public.tutor_citations (tutor_turn_id);

create table public.sync_tokens (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  token_hash text not null unique check (char_length(token_hash) = 64),
  operation text not null check (operation in ('knowledge', 'question_bank')),
  student_ids uuid[] not null default '{}',
  subjects public.subject[] not null default '{}',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  token_id uuid references public.sync_tokens(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.sync_status not null default 'running',
  added integer not null default 0,
  updated integer not null default 0,
  unchanged integer not null default 0,
  deactivated integer not null default 0,
  message text
);

create table public.question_bank_items (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  subject public.subject not null,
  topic text not null,
  question_text text not null,
  official_answer text not null,
  source_paper text not null,
  source_file text not null,
  answer_file text not null,
  question_number text not null,
  question_page text not null,
  answer_page text not null,
  knowledge_points text[] not null default '{}',
  difficulty text not null default 'medium',
  suitable_student_ids uuid[] not null default '{}',
  verified boolean not null default true check (verified),
  content_hash text not null,
  active boolean not null default true,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index question_bank_subject_topic_idx on public.question_bank_items (subject, topic) where active;

create table public.app_settings (
  singleton boolean primary key default true check (singleton),
  ai_enabled boolean not null default false,
  text_provider text not null default 'openai-compatible',
  vision_provider text not null default 'openai-compatible',
  embedding_provider text not null default 'openai-compatible',
  text_model text not null default 'deepseek-chat',
  vision_model text not null default '',
  embedding_model text not null default 'text-embedding-3-small',
  daily_student_message_limit integer not null default 30 check (daily_student_message_limit between 0 and 500),
  max_upload_mb integer not null default 20 check (max_upload_mb between 1 and 25),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (singleton) values (true);

create table public.model_usage (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.student_profiles(id) on delete set null,
  operation text not null,
  provider text,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  fallback_used boolean not null default false,
  created_at timestamptz not null default now()
);
create index model_usage_student_day_idx on public.model_usage (student_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create table public.auth_login_attempts (
  id bigint generated always as identity primary key,
  username_hash text not null check (char_length(username_hash) = 64),
  ip_hash text not null check (char_length(ip_hash) = 64),
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index auth_login_attempts_rate_idx on public.auth_login_attempts (username_hash, ip_hash, created_at desc);

create table public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  reason text not null check (char_length(reason) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending', 'executed', 'cancelled')),
  requested_at timestamptz not null default now(),
  executed_at timestamptz,
  unique (student_id, status)
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger student_profiles_updated before update on public.student_profiles for each row execute function public.set_updated_at();
create trigger submissions_updated before update on public.submissions for each row execute function public.set_updated_at();
create trigger wrong_items_updated before update on public.wrong_items for each row execute function public.set_updated_at();
create trigger weekly_reports_updated before update on public.weekly_reports for each row execute function public.set_updated_at();
create trigger knowledge_documents_updated before update on public.knowledge_documents for each row execute function public.set_updated_at();
create trigger question_bank_items_updated before update on public.question_bank_items for each row execute function public.set_updated_at();

create or replace function public.is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher' and status = 'active'
  );
$$;

create or replace function public.is_active_student(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select target = auth.uid() and exists (
    select 1 from public.profiles where id = auth.uid() and role = 'student' and status = 'active'
  );
$$;

create or replace function public.is_linked_parent(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.parent_students ps
    join public.profiles p on p.id = ps.parent_id
    where ps.parent_id = auth.uid() and ps.student_id = target and p.role = 'parent' and p.status = 'active'
  );
$$;

create or replace function public.can_manage_student(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_teacher() or public.is_active_student(target);
$$;

revoke all on function public.is_teacher() from public;
revoke all on function public.is_active_student(uuid) from public;
revoke all on function public.is_linked_parent(uuid) from public;
revoke all on function public.can_manage_student(uuid) from public;
grant execute on function public.is_teacher() to authenticated, service_role;
grant execute on function public.is_active_student(uuid) to authenticated, service_role;
grant execute on function public.is_linked_parent(uuid) to authenticated, service_role;
grant execute on function public.can_manage_student(uuid) to authenticated, service_role;

create or replace function public.validate_student_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.id and role = 'student') then
    raise exception 'student_profiles row requires a student profile';
  end if;
  return new;
end;
$$;
create trigger student_profile_role_check before insert or update on public.student_profiles
for each row execute function public.validate_student_profile_role();

create or replace function public.validate_parent_link_roles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.parent_id and role = 'parent') then
    raise exception 'parent_students.parent_id requires a parent profile';
  end if;
  return new;
end;
$$;
create trigger parent_link_role_check before insert or update on public.parent_students
for each row execute function public.validate_parent_link_roles();

create or replace function public.validate_message_sender()
returns trigger language plpgsql security definer set search_path = public as $$
declare actual_role public.app_role;
begin
  select role into actual_role from public.profiles where id = new.sender_id and status = 'active';
  if actual_role is null or actual_role::text <> new.sender_role::text then
    raise exception 'sender role mismatch';
  end if;
  if actual_role = 'student' and new.student_id <> new.sender_id then
    raise exception 'students may only message as themselves';
  end if;
  return new;
end;
$$;
create trigger message_sender_check before insert or update on public.messages
for each row execute function public.validate_message_sender();

create or replace function public.validate_submission_attachment()
returns trigger language plpgsql security definer set search_path = public as $$
declare configured_mb integer;
declare existing_count integer;
declare existing_bytes bigint;
begin
  if not exists (
    select 1 from public.submissions s
    where s.id = new.submission_id and s.student_id = new.student_id
  ) then
    raise exception 'attachment student does not match submission';
  end if;
  if split_part(new.storage_path, '/', 1) <> new.student_id::text
     or split_part(new.storage_path, '/', 2) <> new.submission_id
     or split_part(new.storage_path, '/', 3) = '' then
    raise exception 'attachment storage path does not match student and submission';
  end if;
  select max_upload_mb into configured_mb from public.app_settings where singleton;
  if new.file_size > configured_mb::bigint * 1024 * 1024 then
    raise exception 'attachment exceeds configured upload limit';
  end if;
  select count(*), coalesce(sum(file_size), 0)
    into existing_count, existing_bytes
  from public.submission_attachments
  where submission_id = new.submission_id and id <> new.id;
  if existing_count >= 12 then
    raise exception 'a submission may contain at most 12 attachments';
  end if;
  if existing_bytes + new.file_size > 104857600 then
    raise exception 'submission attachments exceed the 100 MiB total limit';
  end if;
  return new;
end;
$$;
create trigger submission_attachment_check before insert or update on public.submission_attachments
for each row execute function public.validate_submission_attachment();

create or replace function public.create_tutor_student_turn(
  target_student_id uuid,
  turn_body text,
  daily_limit integer
)
returns table(id uuid, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare day_start timestamptz;
declare used_count integer;
begin
  if char_length(trim(turn_body)) < 1 or char_length(turn_body) > 8000 then
    raise exception 'invalid tutor message';
  end if;
  if daily_limit < 0 or daily_limit > 500 then
    raise exception 'invalid daily limit';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_student_id::text || ':' || (timezone('Asia/Shanghai', now())::date)::text, 0));
  day_start := (timezone('Asia/Shanghai', now())::date::timestamp at time zone 'Asia/Shanghai');
  select count(*) into used_count from public.tutor_turns
    where student_id = target_student_id and role = 'student' and created_at >= day_start;
  if used_count >= daily_limit then
    raise exception using errcode = 'P0001', message = 'daily_tutor_limit_reached';
  end if;
  return query insert into public.tutor_turns as inserted (student_id, role, body)
    values (target_student_id, 'student', trim(turn_body)) returning inserted.id, inserted.created_at;
end;
$$;
revoke all on function public.create_tutor_student_turn(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.create_tutor_student_turn(uuid, text, integer) to service_role;

create or replace function public.capture_submission_self_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.self_reflection is not null and btrim(new.self_reflection) <> '' then
    insert into public.learning_evidence (
      student_id, submission_id, state, category, claim, evidence
    ) values (
      new.student_id, new.id, 'self_reported', 'student_reflection',
      '学生提交了自我复盘', new.self_reflection
    );
  end if;
  return new;
end;
$$;
create trigger submission_self_report after insert on public.submissions
for each row execute function public.capture_submission_self_report();

-- Admin-only helper used once after creating the first Auth user.
create or replace function public.bootstrap_teacher(
  user_id uuid,
  teacher_username text,
  teacher_display_name text
)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from public.profiles where role = 'teacher') then
    raise exception 'teacher already exists';
  end if;
  if not exists (select 1 from auth.users where id = user_id) then
    raise exception 'auth user not found';
  end if;
  insert into public.profiles (id, username, display_name, role, must_change_password)
  values (user_id, teacher_username, teacher_display_name, 'teacher', false);
end;
$$;
revoke all on function public.bootstrap_teacher(uuid, text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_teacher(uuid, text, text) to service_role;

create or replace function public.approve_submission(
  target_submission_id text,
  reviewer_id uuid,
  approved_tags text[],
  reviewer_note text
)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s public.submissions%rowtype;
declare draft public.analysis_drafts%rowtype;
declare number text;
declare item_id uuid;
declare made integer := 0;
declare tags public.error_tag[];
begin
  if not exists (select 1 from public.profiles where id = reviewer_id and role = 'teacher' and status = 'active') then
    raise exception 'teacher required';
  end if;
  select * into s from public.submissions where id = target_submission_id for update;
  if not found then raise exception 'submission not found'; end if;
  if s.status = 'scheduled' then
    return jsonb_build_object('submission_id', s.id, 'created', 0, 'idempotent', true);
  end if;
  if s.status not in ('uploaded', 'analyzing', 'needs_review', 'approved', 'failed') then
    raise exception 'submission cannot be approved from status %', s.status;
  end if;
  select * into draft from public.analysis_drafts where submission_id = s.id order by created_at desc limit 1;
  select coalesce(array_agg(value::public.error_tag), '{}') into tags
  from unnest(coalesce(approved_tags, '{}')) value
  where value in ('concept','reading','modeling','calculation','writing','speed','avoidance');
  for number in select unnest(case when cardinality(s.wrong_numbers) = 0 then array['未标注'] else s.wrong_numbers end)
  loop
    insert into public.wrong_items (
      student_id, submission_id, subject, question_number, title, question_text,
      knowledge_points, error_tags, evidence_state, teacher_note, occurred_at,
      next_review_at, verified_by, verified_at
    ) values (
      s.student_id, s.id, s.subject, number, s.title || ' · 第' || number || '题', draft.question_text,
      coalesce(draft.knowledge_points, '{}'), tags, 'teacher_verified', coalesce(reviewer_note, ''), s.assignment_date,
      now() + interval '1 day', reviewer_id, now()
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
  values (reviewer_id, 'submission.approve', 'submission', s.id::text, jsonb_build_object('wrong_items', made));
  return jsonb_build_object('submission_id', s.id, 'created', made, 'idempotent', false);
end;
$$;
revoke all on function public.approve_submission(text, uuid, text[], text) from public, anon, authenticated;
grant execute on function public.approve_submission(text, uuid, text[], text) to service_role;

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
  if not (actor_id = task.student_id or exists (select 1 from public.profiles where id = actor_id and role = 'teacher' and status = 'active')) then
    raise exception 'not allowed';
  end if;
  if task.status <> 'due' then
    return jsonb_build_object('task_id', task.id, 'idempotent', true);
  end if;
  update public.review_tasks set status = 'completed', result_passed = passed, completed_at = now() where id = task.id;
  if passed and task.stage = 3 then
    update public.wrong_items set resolved = true, next_review_at = null, review_stage = 3 where id = task.wrong_item_id;
    done := true;
  else
    next_stage := case when passed then task.stage + 1 else 0 end;
    next_due := now() + case next_stage when 0 then interval '1 day' when 1 then interval '3 days' when 2 then interval '7 days' else interval '14 days' end;
    update public.wrong_items set resolved = false, review_stage = next_stage, next_review_at = next_due where id = task.wrong_item_id;
    insert into public.review_tasks(student_id, wrong_item_id, title, due_at, stage)
    values (task.student_id, task.wrong_item_id, task.title, next_due, next_stage);
  end if;
  insert into public.audit_logs(actor_id, action, target_type, target_id, metadata)
  values (actor_id, 'review.complete', 'review_task', task.id::text, jsonb_build_object('passed', passed, 'resolved', done));
  return jsonb_build_object('task_id', task.id, 'passed', passed, 'resolved', done, 'next_stage', next_stage, 'next_due', next_due);
end;
$$;
revoke all on function public.complete_review_task(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.complete_review_task(uuid, uuid, boolean) to service_role;

create or replace function public.search_knowledge_chunks(
  query_text text,
  query_embedding extensions.vector(1536),
  target_student_id uuid,
  target_subject public.subject,
  allowed_visibilities public.knowledge_visibility[],
  result_limit integer default 8
)
returns table (
  chunk_id uuid,
  document_id uuid,
  title text,
  document_type public.knowledge_document_type,
  visibility public.knowledge_visibility,
  relative_path text,
  heading text,
  content text,
  score double precision
)
language sql stable security definer set search_path = public, extensions as $$
  with candidates as (
    select c.id as chunk_id, d.id as document_id, d.title, d.document_type, d.visibility,
      d.relative_path, c.heading, c.content,
      greatest(
        ts_rank_cd(c.search_vector, plainto_tsquery('simple', query_text))::double precision,
        extensions.similarity(left(c.content, 4000), left(query_text, 1000))::double precision
      ) as text_score,
      case when query_embedding is null or c.embedding is null then 0::double precision
        else (1 - (c.embedding <=> query_embedding))::double precision end as vector_score,
      case when d.student_id = target_student_id then 0.12 else 0 end as personal_boost
    from public.knowledge_chunks c
    join public.knowledge_documents d on d.id = c.document_id and d.active_version_id = c.version_id
    where d.active
      and d.subject = target_subject
      and d.visibility = any(allowed_visibilities)
      and (
        d.student_id = target_student_id
        or exists (select 1 from public.knowledge_document_grants g where g.document_id = d.id and g.student_id = target_student_id)
      )
  )
  select chunk_id, document_id, title, document_type, visibility, relative_path, heading, content,
    (text_score * 0.55 + vector_score * 0.33 + personal_boost)::double precision as score
  from candidates
  where text_score > 0 or vector_score > 0
  order by score desc, chunk_id
  limit least(greatest(result_limit, 1), 20);
$$;
revoke all on function public.search_knowledge_chunks(text, extensions.vector, uuid, public.subject, public.knowledge_visibility[], integer) from public, anon, authenticated;
grant execute on function public.search_knowledge_chunks(text, extensions.vector, uuid, public.subject, public.knowledge_visibility[], integer) to service_role;

create index auth_login_attempts_username_created_idx on public.auth_login_attempts (username_hash, created_at desc);
create index auth_login_attempts_ip_created_idx on public.auth_login_attempts (ip_hash, created_at desc);

-- RLS
alter table public.profiles enable row level security;
alter table public.student_profiles enable row level security;
alter table public.parent_students enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_attachments enable row level security;
alter table public.analysis_drafts enable row level security;
alter table public.wrong_items enable row level security;
alter table public.learning_evidence enable row level security;
alter table public.review_tasks enable row level security;
alter table public.messages enable row level security;
alter table public.tutor_turns enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_document_versions enable row level security;
alter table public.knowledge_document_grants enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.tutor_citations enable row level security;
alter table public.sync_tokens enable row level security;
alter table public.sync_runs enable row level security;
alter table public.question_bank_items enable row level security;
alter table public.app_settings enable row level security;
alter table public.model_usage enable row level security;
alter table public.audit_logs enable row level security;
alter table public.auth_login_attempts enable row level security;
alter table public.data_deletion_requests enable row level security;

create policy profiles_read on public.profiles for select to authenticated
using (id = auth.uid() or public.is_teacher());
create policy student_profiles_read on public.student_profiles for select to authenticated
using (public.is_teacher() or public.is_active_student(id));
create policy parent_links_read on public.parent_students for select to authenticated
using (public.is_teacher() or parent_id = auth.uid());

create policy submissions_read on public.submissions for select to authenticated
using (public.can_manage_student(student_id));
create policy submissions_insert on public.submissions for insert to authenticated
with check (public.can_manage_student(student_id) and created_by = auth.uid());
create policy submissions_teacher_update on public.submissions for update to authenticated
using (public.is_teacher()) with check (public.is_teacher());
create policy submissions_creator_abort on public.submissions for delete to authenticated
using (created_by = auth.uid() and status = 'uploaded');

create policy attachments_read on public.submission_attachments for select to authenticated
using (public.can_manage_student(student_id));
create policy attachments_insert on public.submission_attachments for insert to authenticated
with check (public.can_manage_student(student_id) and exists (
  select 1 from public.submissions s where s.id = submission_id and s.student_id = submission_attachments.student_id
));
create policy attachments_teacher_update on public.submission_attachments for update to authenticated
using (public.is_teacher()) with check (public.is_teacher());

create policy drafts_teacher_read on public.analysis_drafts for select to authenticated using (public.is_teacher());
create policy wrong_items_read on public.wrong_items for select to authenticated using (public.can_manage_student(student_id));
create policy evidence_read on public.learning_evidence for select to authenticated
using (public.is_teacher() or (public.is_active_student(student_id) and state = 'teacher_verified'));
create policy review_tasks_read on public.review_tasks for select to authenticated using (public.can_manage_student(student_id));

create policy messages_read on public.messages for select to authenticated using (public.can_manage_student(student_id));
create policy messages_insert on public.messages for insert to authenticated
with check (public.can_manage_student(student_id) and sender_id = auth.uid() and sender_role::text = (select role::text from public.profiles where id = auth.uid()));
create policy messages_update_read_state on public.messages for update to authenticated
using (public.can_manage_student(student_id)) with check (public.can_manage_student(student_id));

create policy tutor_turns_read on public.tutor_turns for select to authenticated using (public.can_manage_student(student_id));
create policy citations_read on public.tutor_citations for select to authenticated using (public.can_manage_student(student_id));

create policy reports_teacher_all on public.weekly_reports for all to authenticated
using (public.is_teacher()) with check (public.is_teacher());
create policy reports_student_read on public.weekly_reports for select to authenticated
using (status = 'published' and (public.is_active_student(student_id) or public.is_linked_parent(student_id)));

create policy knowledge_teacher_read on public.knowledge_documents for select to authenticated using (public.is_teacher());
create policy knowledge_versions_teacher_read on public.knowledge_document_versions for select to authenticated
using (public.is_teacher());
create policy knowledge_grants_teacher_read on public.knowledge_document_grants for select to authenticated using (public.is_teacher());
create policy knowledge_chunks_teacher_read on public.knowledge_chunks for select to authenticated using (public.is_teacher());

create policy sync_tokens_teacher_read on public.sync_tokens for select to authenticated using (public.is_teacher());
create policy sync_runs_teacher_read on public.sync_runs for select to authenticated using (public.is_teacher());
create policy question_bank_teacher_read on public.question_bank_items for select to authenticated using (public.is_teacher());
create policy settings_read on public.app_settings for select to authenticated using (true);
create policy usage_teacher_read on public.model_usage for select to authenticated using (public.is_teacher());
create policy audit_teacher_read on public.audit_logs for select to authenticated using (public.is_teacher());
create policy deletion_requests_teacher_read on public.data_deletion_requests for select to authenticated using (public.is_teacher());

-- Private submission files. The first path segment is always the student UUID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 26214400, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy submission_files_read on storage.objects for select to authenticated
using (bucket_id = 'submissions' and public.can_manage_student(((storage.foldername(name))[1])::uuid));
create policy submission_files_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'submissions'
  and array_length(storage.foldername(name), 1) >= 3
  and public.can_manage_student(((storage.foldername(name))[1])::uuid)
  and exists (
    select 1 from public.submissions s
    where s.id = (storage.foldername(name))[2]
      and s.student_id = ((storage.foldername(name))[1])::uuid
  )
);
create policy submission_files_teacher_update on storage.objects for update to authenticated
using (bucket_id = 'submissions' and public.is_teacher()) with check (bucket_id = 'submissions' and public.is_teacher());
create policy submission_files_creator_abort on storage.objects for delete to authenticated
using (
  bucket_id = 'submissions'
  and public.can_manage_student(((storage.foldername(name))[1])::uuid)
  and exists (
    select 1 from public.submissions s
    where s.id = (storage.foldername(name))[2]
      and s.created_by = auth.uid()
      and s.status = 'uploaded'
  )
);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert on public.submissions, public.submission_attachments, public.messages to authenticated;
grant delete on public.submissions to authenticated;
grant select on all tables in schema public to authenticated;
grant update (read) on public.messages to authenticated;
grant update on public.submissions, public.submission_attachments to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
