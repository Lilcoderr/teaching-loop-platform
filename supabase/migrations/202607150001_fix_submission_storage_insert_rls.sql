-- Fix student attachment uploads for the client path shape:
--   <student uuid>/<submission id>/<file name>
--
-- storage.foldername(name) excludes the final file name, so this path has
-- exactly two folder segments. The original policy required three and denied
-- every upload. Keep writes student-only and bind the object to a submission
-- created by the same authenticated student.

begin;

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
      and submission.status = 'uploaded'
  )
);

commit;
