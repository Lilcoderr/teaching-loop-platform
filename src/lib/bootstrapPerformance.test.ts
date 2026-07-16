import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bootstrap = readFileSync('supabase/functions/bootstrap/index.ts', 'utf8')
const migration = readFileSync('supabase/migrations/202607160002_knowledge_chunk_count_rpc.sql', 'utf8')

describe('bootstrap payload controls', () => {
  it('aggregates active knowledge chunk counts in PostgreSQL instead of downloading chunk rows', () => {
    expect(bootstrap).toContain("db.rpc('active_knowledge_chunk_counts', { target_document_ids: null })")
    expect(bootstrap).toContain("db.rpc('active_knowledge_chunk_counts', { target_document_ids: documentIds })")
    expect(bootstrap).not.toContain("db.from('knowledge_chunks').select('document_id,version_id').limit(10000)")
    expect(migration).toContain('group by chunks.document_id')
  })

  it('keeps the aggregation RPC private to server-side service calls', () => {
    expect(migration).toContain('revoke all on function public.active_knowledge_chunk_counts(uuid[]) from public, anon, authenticated')
    expect(migration).toContain('grant execute on function public.active_knowledge_chunk_counts(uuid[]) to service_role')
  })
})
