import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { externalEmbeddingAllowed } from '../../supabase/functions/knowledge-ingest/logic'

const knowledgeIngest = readFileSync('supabase/functions/knowledge-ingest/index.ts', 'utf8')

describe('knowledge ingest external model privacy guard', () => {
  it('requires AI enablement, recorded guardian consent, and an embedding configuration', () => {
    expect(externalEmbeddingAllowed(true, '2026-07-13T08:00:00.000Z', true)).toBe(true)
    expect(externalEmbeddingAllowed(false, '2026-07-13T08:00:00.000Z', true)).toBe(false)
    expect(externalEmbeddingAllowed(true, null, true)).toBe(false)
    expect(externalEmbeddingAllowed(true, '', true)).toBe(false)
    expect(externalEmbeddingAllowed(true, '2026-07-13T08:00:00.000Z', false)).toBe(false)
  })

  it('uses the consent decision for both new vectors and unchanged-version backfills', () => {
    expect(knowledgeIngest).toContain('if (embeddingAllowed)')
    expect(knowledgeIngest).toContain('backfillMissingEmbeddings(db, existing.active_version_id, embeddingAllowed')
    expect(knowledgeIngest).toContain('const embeddings: Array<number[] | null> = Array(rawChunks.length).fill(null)')
  })
})
