-- Learning content and assignment grading extensions.
-- This migration is additive and keeps the original submission/knowledge model intact.

create type public.material_type as enum ('lecture', 'assignment', 'supplement', 'method');

alter table public.analysis_drafts
  add column if not exists proposed_score numeric(7,2),
  add column if not exists proposed_max_score numeric(7,2),
  add column if not exists grading_feedback text,
  add column if not exists question_feedback jsonb not null default '[]'::jsonb,
  add column if not exists grading_confidence numeric(4,3)
    check (grading_confidence is null or grading_confidence between 0 and 1);

create table public.submission_grades (
  id uuid primary key default gen_random_uuid(),
  submission_id text not null unique references public.submissions(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  score numeric(7,2) check (score is null or score >= 0),
  max_score numeric(7,2) check (max_score is null or max_score > 0),
  feedback text not null default '' check (char_length(feedback) <= 8000),
  question_feedback jsonb not null default '[]'::jsonb,
  teacher_id uuid not null references public.profiles(id),
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grade_score_not_over_max check (score is null or max_score is null or score <= max_score)
);
create index submission_grades_student_idx on public.submission_grades (student_id, confirmed_at desc);

create table public.teacher_daily_evaluations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id),
  evaluation_date date not null default current_date,
  subject public.subject,
  summary text not null check (char_length(btrim(summary)) between 1 and 4000),
  highlights text[] not null default '{}',
  improvements text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index teacher_daily_evaluation_scope_idx
  on public.teacher_daily_evaluations (student_id, evaluation_date, subject) nulls not distinct;
create index teacher_daily_evaluations_student_date_idx
  on public.teacher_daily_evaluations (student_id, evaluation_date desc);

create or replace function public.validate_teacher_owned_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = new.teacher_id and role = 'teacher' and status = 'active') then
    raise exception 'teacher_id must reference an active teacher';
  end if;
  return new;
end;
$$;
create trigger submission_grade_teacher_check
  before insert or update on public.submission_grades
  for each row execute function public.validate_teacher_owned_row();
create trigger daily_evaluation_teacher_check
  before insert or update on public.teacher_daily_evaluations
  for each row execute function public.validate_teacher_owned_row();

create or replace function public.validate_submission_grade_student()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.submissions where id = new.submission_id and student_id = new.student_id) then
    raise exception 'grade student does not match submission';
  end if;
  return new;
end;
$$;
create trigger submission_grade_student_check
  before insert or update on public.submission_grades
  for each row execute function public.validate_submission_grade_student();

create trigger submission_grades_updated before update on public.submission_grades
  for each row execute function public.set_updated_at();
create trigger daily_evaluations_updated before update on public.teacher_daily_evaluations
  for each row execute function public.set_updated_at();

create table public.learning_materials (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  material_type public.material_type not null,
  subject public.subject not null,
  topic text not null default '' check (char_length(topic) <= 160),
  description text not null default '' check (char_length(description) <= 4000),
  created_by uuid not null references public.profiles(id),
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index learning_materials_subject_topic_idx
  on public.learning_materials (subject, topic, published, updated_at desc);

create table public.learning_material_grants (
  material_id uuid not null references public.learning_materials(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  granted_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (material_id, student_id)
);
create index learning_material_grants_student_idx on public.learning_material_grants (student_id, created_at desc);

create table public.learning_material_files (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.learning_materials(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 240),
  mime_type text not null check (char_length(mime_type) between 1 and 120),
  file_size bigint not null check (file_size > 0 and file_size <= 26214400),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index learning_material_files_material_idx on public.learning_material_files (material_id, created_at);

create trigger materials_updated before update on public.learning_materials
  for each row execute function public.set_updated_at();

create or replace function public.can_manage_material(target_material_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_teacher() and exists (
    select 1 from public.learning_materials m
    where m.id = target_material_id and m.created_by = auth.uid()
  );
$$;

create or replace function public.can_view_material(target_material_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_teacher() or exists (
    select 1 from public.learning_materials m
    join public.learning_material_grants g on g.material_id = m.id and g.student_id = auth.uid()
    where m.id = target_material_id and m.published and public.is_active_student(auth.uid())
  );
$$;

create or replace function public.material_path_allowed(path text, require_manage boolean default false)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare material_key text;
begin
  if path is null or path !~ '^[0-9a-fA-F-]{36}/[^/]{1,240}$' then return false; end if;
  material_key := split_part(path, '/', 1);
  if require_manage then
    return public.can_manage_material(material_key::uuid);
  end if;
  return public.can_view_material(material_key::uuid);
exception when others then
  return false;
end;
$$;

create or replace function public.validate_learning_material_file()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if split_part(new.storage_path, '/', 1) <> new.material_id::text
     or split_part(new.storage_path, '/', 2) = ''
     or new.storage_path like '%..%' then
    raise exception 'material file storage path does not match material';
  end if;
  if not exists (select 1 from public.learning_materials where id = new.material_id) then
    raise exception 'material not found';
  end if;
  return new;
end;
$$;
create trigger learning_material_file_check before insert or update on public.learning_material_files
  for each row execute function public.validate_learning_material_file();

alter table public.submission_grades enable row level security;
alter table public.teacher_daily_evaluations enable row level security;
alter table public.learning_materials enable row level security;
alter table public.learning_material_grants enable row level security;
alter table public.learning_material_files enable row level security;

create policy submission_grades_teacher_all on public.submission_grades for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy submission_grades_student_read on public.submission_grades for select to authenticated
  using (public.is_active_student(student_id) and confirmed_at is not null);

create policy daily_evaluations_teacher_all on public.teacher_daily_evaluations for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy daily_evaluations_student_read on public.teacher_daily_evaluations for select to authenticated
  using (public.is_active_student(student_id));

create policy learning_materials_teacher_all on public.learning_materials for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy learning_materials_student_read on public.learning_materials for select to authenticated
  using (public.can_view_material(id));
create policy learning_material_grants_teacher_all on public.learning_material_grants for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy learning_material_files_teacher_all on public.learning_material_files for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());
create policy learning_material_files_student_read on public.learning_material_files for select to authenticated
  using (public.can_view_material(material_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materials', 'materials', false, 26214400,
  array['image/jpeg','image/png','image/webp','application/pdf','text/plain','text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy learning_material_files_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'materials' and public.material_path_allowed(name, false));
create policy learning_material_files_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'materials' and public.material_path_allowed(name, true));
create policy learning_material_files_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'materials' and public.material_path_allowed(name, true))
  with check (bucket_id = 'materials' and public.material_path_allowed(name, true));
create policy learning_material_files_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'materials' and public.material_path_allowed(name, true));

grant execute on function public.can_manage_material(uuid), public.can_view_material(uuid), public.material_path_allowed(text, boolean)
  to authenticated, service_role;
grant select, insert, update on public.submission_grades, public.teacher_daily_evaluations,
  public.learning_materials, public.learning_material_grants, public.learning_material_files to authenticated;
grant all on public.submission_grades, public.teacher_daily_evaluations,
  public.learning_materials, public.learning_material_grants, public.learning_material_files to service_role;
