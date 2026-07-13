import { handleOptions } from '../_shared/cors.ts'
import { requireSyncToken } from '../_shared/auth.ts'
import { asErrorResponse, HttpError, json, readJson, requireString } from '../_shared/http.ts'

const SUBJECTS = new Set(['math', 'physics', 'chemistry'])

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  try {
    if (request.method !== 'POST') throw new HttpError(405, '仅支持 POST', 'method_not_allowed')
    const { db, tokenId, subjects: allowedSubjects } = await requireSyncToken(request, 'question_bank')
    const body = await readJson<Record<string, unknown>>(request)
    const items = Array.isArray(body.items) ? body.items : []
    if (!items.length || items.length > 100) throw new HttpError(400, '每批须包含 1 到 100 道题', 'invalid_batch')
    let inserted = 0, updated = 0, unchanged = 0
    const errors: Array<{ externalId?: string; message: string }> = []
    for (const raw of items) {
      let externalId: string | undefined
      try {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('题目格式无效')
        const item = raw as Record<string, unknown>
        externalId = requireString(item.externalId, 'externalId', 200)
        if (item.verified !== true || body.verifiedOnly !== true) throw new Error('只允许导入题面和官方答案均已复核的题目')
        if (!SUBJECTS.has(String(item.subject))) throw new Error('科目无效')
        if (!allowedSubjects.includes(String(item.subject))) throw new HttpError(403, '同步令牌无权导入该科目', 'sync_scope_forbidden')
        const questionText = requireString(item.questionText, 'questionText', 30000)
        const officialAnswer = requireString(item.officialAnswer, 'officialAnswer', 30000)
        const source = item.source && typeof item.source === 'object' ? item.source as Record<string, unknown> : {}
        const paperName = requireString(item.paperName ?? source.paperName, 'paperName', 500)
        const sourceFile = requireString(item.originalFile ?? source.originalFile, 'originalFile', 1000)
        const answerFile = requireString(item.answerFile ?? source.answerFile, 'answerFile', 1000)
        const questionNumber = requireString(item.questionNumber ?? source.questionNumber, 'questionNumber', 100)
        const questionPage = requireString(item.questionPage ?? source.questionPage, 'questionPage', 100)
        const answerPage = requireString(item.answerPage ?? source.answerPage, 'answerPage', 100)
        const contentHash = requireString(item.contentHash, 'contentHash', 128)
        const { data: existing, error: queryError } = await db.from('question_bank_items').select('id,content_hash').eq('external_id', externalId).maybeSingle()
        if (queryError) throw queryError
        if (existing?.content_hash === contentHash) { unchanged += 1; continue }
        const record = {
          external_id: externalId,
          subject: item.subject,
          topic: requireString(item.topic, 'topic', 300),
          question_text: questionText,
          official_answer: officialAnswer,
          source_paper: paperName,
          source_file: sourceFile,
          answer_file: answerFile,
          question_number: questionNumber,
          question_page: questionPage,
          answer_page: answerPage,
          knowledge_points: Array.isArray(item.knowledgePoints) ? item.knowledgePoints.filter((value): value is string => typeof value === 'string').slice(0, 30) : [],
          difficulty: typeof item.difficulty === 'string' ? item.difficulty.slice(0, 100) : 'medium',
          content_hash: contentHash,
          verified: true,
          active: true,
        }
        const { error } = await db.from('question_bank_items').upsert(record, { onConflict: 'external_id' })
        if (error) throw error
        if (existing) updated += 1
        else inserted += 1
      } catch (error) {
        errors.push({ externalId, message: error instanceof Error ? error.message : String(error) })
      }
    }
    await db.from('audit_logs').insert({
      actor_id: null, action: 'question_bank.import', target_type: 'sync_token', target_id: tokenId,
      metadata: { inserted, updated, unchanged, errors: errors.length },
    })
    return json(request, { ok: errors.length === 0, inserted, updated, unchanged, errors }, errors.length ? 207 : 200)
  } catch (error) {
    return asErrorResponse(request, error)
  }
})
