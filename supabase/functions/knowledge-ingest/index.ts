import { handleOptions } from '../_shared/cors.ts'
import { requireSyncToken } from '../_shared/auth.ts'
import { asErrorResponse, HttpError, json, readJson, requireString } from '../_shared/http.ts'
import { embeddingModelConfigured, embedTexts } from '../_shared/model.ts'
import { externalEmbeddingAllowed } from './logic.ts'

const SUBJECTS = new Set(['math', 'physics', 'chemistry'])
const TYPES = new Set(['lecture', 'exercise', 'solution', 'lesson_plan'])
const VISIBILITIES = new Set(['student_visible', 'solution_gated', 'teacher_only'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function backfillMissingEmbeddings(
  db: ReturnType<typeof import('../_shared/auth.ts')['serviceClient']>,
  versionId: string,
  externalModelAllowed: boolean,
  requestedModel?: string,
): Promise<void> {
  if (!externalModelAllowed) return
  const { data: chunks, error } = await db.from('knowledge_chunks')
    .select('id,content')
    .eq('version_id', versionId)
    .is('embedding', null)
    .order('ordinal')
    .limit(250)
  if (error) throw error
  for (let start = 0; start < (chunks ?? []).length; start += 32) {
    const batch = (chunks ?? []).slice(start, start + 32)
    const vectors = await embedTexts(batch.map((chunk) => chunk.content), requestedModel)
    if (!vectors) return
    const updates = await Promise.all(batch.map((chunk, offset) =>
      db.from('knowledge_chunks').update({ embedding: vectors[offset] }).eq('id', chunk.id)
    ))
    const updateError = updates.find((result) => result.error)?.error
    if (updateError) throw updateError
  }
}

type StudentTarget = { id: string; guardianConsentAt: string | null }

async function resolveStudent(db: ReturnType<typeof import('../_shared/auth.ts')['serviceClient']>, value: unknown): Promise<StudentTarget> {
  const candidate = requireString(value, 'studentId', 80)
  if (UUID.test(candidate)) {
    const { data, error } = await db.from('student_profiles').select('id,guardian_consent_at').eq('id', candidate).maybeSingle()
    if (error) throw error
    if (data) return { id: data.id, guardianConsentAt: data.guardian_consent_at }
  }
  const { data, error } = await db.from('profiles').select('id,role').eq('username', candidate).maybeSingle()
  if (error) throw error
  if (!data || data.role !== 'student') throw new HttpError(400, `找不到学生：${candidate}`, 'student_not_found')
  const { data: student, error: studentError } = await db.from('student_profiles')
    .select('id,guardian_consent_at').eq('id', data.id).maybeSingle()
  if (studentError) throw studentError
  if (!student) throw new HttpError(400, `找不到学生：${candidate}`, 'student_not_found')
  return { id: student.id, guardianConsentAt: student.guardian_consent_at }
}

function validDocument(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, '文档格式无效', 'invalid_document')
  const doc = raw as Record<string, unknown>
  if (!SUBJECTS.has(String(doc.subject)) || !TYPES.has(String(doc.documentType)) || !VISIBILITIES.has(String(doc.visibility))) {
    throw new HttpError(400, '文档科目、类型或权限无效', 'invalid_document')
  }
  if (!Array.isArray(doc.chunks) || doc.chunks.length < 1 || doc.chunks.length > 250) {
    throw new HttpError(400, '每份文档必须包含 1 到 250 个片段', 'invalid_chunks')
  }
  return doc
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  let runDb: ReturnType<typeof import('../_shared/auth.ts')['serviceClient']> | undefined
  let activeRunId: string | undefined
  try {
    if (request.method !== 'POST') throw new HttpError(405, '仅支持 POST', 'method_not_allowed')
    const { db, tokenId, studentIds: allowedStudentIds, subjects: allowedSubjects } = await requireSyncToken(request, 'knowledge')
    runDb = db
    const body = await readJson<Record<string, unknown>>(request)
    const action = requireString(body.action, 'action', 20)
    const { data: run, error: runError } = await db.from('sync_runs').insert({ token_id: tokenId }).select('id').single()
    if (runError) throw runError
    activeRunId = run.id
    let added = 0, updated = 0, unchanged = 0, deactivated = 0
    const errors: Array<{ externalId?: string; message: string }> = []

    if (action === 'upsert') {
      const documents = Array.isArray(body.documents) ? body.documents : []
      if (!documents.length || documents.length > 25) throw new HttpError(400, '每批须包含 1 到 25 份文档', 'invalid_batch')
      let totalChunks = 0
      let totalCharacters = 0
      for (const raw of documents) {
        const doc = validDocument(raw)
        totalChunks += (doc.chunks as unknown[]).length
        for (const chunk of doc.chunks as Array<Record<string, unknown>>) {
          totalCharacters += requireString(chunk.content, 'chunk.content', 30000).length
        }
      }
      if (totalChunks > 1000 || totalCharacters > 2_000_000) {
        throw new HttpError(413, '单批最多 1000 个片段且总内容不超过 200 万字符', 'batch_too_large')
      }
      const { data: settings } = await db.from('app_settings').select('ai_enabled,embedding_model').eq('singleton', true).single()
      for (const raw of documents) {
        let externalId: string | undefined
        try {
          const doc = validDocument(raw)
          externalId = requireString(doc.externalId, 'externalId', 200)
          const student = await resolveStudent(db, doc.studentId ?? doc.studentUsername)
          const studentId = student.id
          if (!allowedStudentIds.includes(studentId) || !allowedSubjects.includes(String(doc.subject))) {
            throw new HttpError(403, '同步令牌无权写入该学生或科目', 'sync_scope_forbidden')
          }
          const embeddingAllowed = externalEmbeddingAllowed(
            settings?.ai_enabled,
            student.guardianConsentAt,
            embeddingModelConfigured(settings?.embedding_model),
          )
          const contentHash = requireString(doc.contentHash, 'contentHash', 128)
          const { data: existing, error: existingError } = await db.from('knowledge_documents').select('*').eq('external_id', externalId).maybeSingle()
          if (existingError) throw existingError
          if (existing && (!allowedStudentIds.includes(existing.student_id) || !allowedSubjects.includes(existing.subject))) {
            throw new HttpError(403, '同步令牌无权修改已有文档', 'sync_scope_forbidden')
          }
          if (existing && existing.content_hash === contentHash && existing.active_version_id) {
            await backfillMissingEmbeddings(db, existing.active_version_id, embeddingAllowed, settings?.embedding_model)
            const { error } = await db.from('knowledge_documents').update({
              student_id: studentId,
              subject: doc.subject,
              title: requireString(doc.title, 'title', 300),
              document_type: doc.documentType,
              visibility: doc.visibility,
              relative_path: requireString(doc.relativePath, 'relativePath', 1000),
              active: true,
              indexed_at: new Date().toISOString(),
            }).eq('id', existing.id)
            if (error) throw error
            unchanged += 1
            continue
          }
          const { data: matchingVersion, error: matchingVersionError } = existing
            ? await db.from('knowledge_document_versions').select('id,version').eq('document_id', existing.id).eq('content_hash', contentHash).maybeSingle()
            : { data: null, error: null }
          if (matchingVersionError) throw matchingVersionError
          const nextVersion = matchingVersion?.version ?? (existing ? existing.version + 1 : 1)
          let documentId = existing?.id
          if (!existing) {
            const { data, error } = await db.from('knowledge_documents').insert({
              external_id: externalId,
              student_id: studentId,
              subject: doc.subject,
              title: requireString(doc.title, 'title', 300),
              document_type: doc.documentType,
              visibility: doc.visibility,
              relative_path: requireString(doc.relativePath, 'relativePath', 1000),
              content_hash: contentHash,
              version: 1,
              active: false,
            }).select('id').single()
            if (error) throw error
            documentId = data.id
          }
          let version = matchingVersion
          if (!version) {
            const { data, error: versionError } = await db.from('knowledge_document_versions').insert({
              document_id: documentId,
              version: nextVersion,
              content_hash: contentHash,
              source_modified_at: typeof doc.sourceModifiedAt === 'string' ? doc.sourceModifiedAt : null,
            }).select('id,version').single()
            if (versionError) throw versionError
            version = data
          }

          const rawChunks = doc.chunks as Array<Record<string, unknown>>
          const embeddings: Array<number[] | null> = Array(rawChunks.length).fill(null)
          if (embeddingAllowed) {
            for (let start = 0; start < rawChunks.length; start += 32) {
              const batch = rawChunks.slice(start, start + 32).map((chunk) => requireString(chunk.content, 'chunk.content', 30000))
              const vectors = await embedTexts(batch, settings.embedding_model)
              if (vectors) vectors.forEach((vector, offset) => { embeddings[start + offset] = vector })
            }
          }
          const chunkRows = rawChunks.map((chunk, index) => {
            const content = requireString(chunk.content, 'chunk.content', 30000)
            const headingPath = Array.isArray(chunk.headingPath) ? chunk.headingPath.filter((item): item is string => typeof item === 'string') : []
            return {
              external_id: typeof chunk.externalId === 'string' ? chunk.externalId.slice(0, 200) : null,
              document_id: documentId,
              version_id: version.id,
              ordinal: Number.isInteger(chunk.chunkIndex) ? Number(chunk.chunkIndex) : Number.isInteger(chunk.ordinal) ? Number(chunk.ordinal) : index,
              heading: typeof chunk.section === 'string' ? chunk.section.slice(0, 1000) : headingPath.join(' > ').slice(0, 1000),
              content,
              content_hash: requireString(chunk.contentHash, 'chunk.contentHash', 128),
              embedding: embeddings[index],
              token_count: Math.ceil(content.length / 2),
            }
          })
          const { count: existingChunkCount, error: countError } = await db.from('knowledge_chunks')
            .select('id', { count: 'exact', head: true }).eq('version_id', version.id)
          if (countError) throw countError
          if ((existingChunkCount ?? 0) === 0) {
            const { error: chunkError } = await db.from('knowledge_chunks').insert(chunkRows)
            if (chunkError) throw chunkError
          } else if (existingChunkCount !== chunkRows.length) {
            throw new Error('已有版本的知识片段数量不完整，请联系管理员检查同步记录')
          }
          const { error: activateError } = await db.from('knowledge_documents').update({
            student_id: studentId,
            subject: doc.subject,
            title: requireString(doc.title, 'title', 300),
            document_type: doc.documentType,
            visibility: doc.visibility,
            relative_path: requireString(doc.relativePath, 'relativePath', 1000),
            content_hash: contentHash,
            version: nextVersion,
            active: true,
            active_version_id: version.id,
            indexed_at: new Date().toISOString(),
          }).eq('id', documentId)
          if (activateError) throw activateError
          if (existing) updated += 1
          else added += 1
        } catch (error) {
          console.error('Knowledge document ingest failed', externalId, error)
          errors.push({ externalId, message: error instanceof Error ? error.message : String(error) })
        }
      }
    } else if (action === 'deactivate') {
      const externalIds = Array.isArray(body.externalIds)
        ? body.externalIds.filter((value): value is string => typeof value === 'string').slice(0, 100) : []
      if (!externalIds.length) throw new HttpError(400, '没有要停用的 externalIds', 'invalid_batch')
      const { data: targets, error: targetError } = await db.from('knowledge_documents')
        .select('external_id,student_id,subject').in('external_id', externalIds)
      if (targetError) throw targetError
      if ((targets ?? []).some((item) => !allowedStudentIds.includes(item.student_id) || !allowedSubjects.includes(item.subject))) {
        throw new HttpError(403, '同步令牌无权停用其中的文档', 'sync_scope_forbidden')
      }
      const { data, error } = await db.from('knowledge_documents').update({ active: false }).in('external_id', externalIds).eq('active', true).select('id')
      if (error) throw error
      deactivated = data?.length ?? 0
    } else {
      throw new HttpError(400, 'action 只能是 upsert 或 deactivate', 'invalid_action')
    }

    const status = errors.length ? 'failed' : 'succeeded'
    await db.from('sync_runs').update({
      finished_at: new Date().toISOString(), status, added, updated, unchanged, deactivated,
      message: errors.length ? `${errors.length} 份文档处理失败` : null,
    }).eq('id', run.id)
    activeRunId = undefined
    return json(request, { ok: errors.length === 0, runId: run.id, added, updated, unchanged, deactivated, errors }, errors.length ? 207 : 200)
  } catch (error) {
    if (runDb && activeRunId) {
      await runDb.from('sync_runs').update({
        finished_at: new Date().toISOString(), status: 'failed', message: error instanceof Error ? error.message.slice(0, 1000) : '同步异常',
      }).eq('id', activeRunId)
    }
    return asErrorResponse(request, error)
  }
})
