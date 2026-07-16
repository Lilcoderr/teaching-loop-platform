create or replace function public.active_knowledge_chunk_counts(target_document_ids uuid[] default null)
returns table(document_id uuid, chunk_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select chunks.document_id, count(*)::bigint as chunk_count
  from public.knowledge_chunks as chunks
  join public.knowledge_documents as documents
    on documents.id = chunks.document_id
   and documents.active_version_id = chunks.version_id
  where documents.active = true
    and (target_document_ids is null or documents.id = any(target_document_ids))
  group by chunks.document_id;
$$;

revoke all on function public.active_knowledge_chunk_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.active_knowledge_chunk_counts(uuid[]) to service_role;
