import { handleOptions } from '../_shared/cors.ts'
import { asErrorResponse, HttpError, json, readJson } from '../_shared/http.ts'
import { requireTeacher } from '../_shared/auth.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  try {
    if (request.method !== 'POST') throw new HttpError(405, '仅支持 POST', 'method_not_allowed')
    const { actor, db } = await requireTeacher(request)
    const body = await readJson<Record<string, unknown>>(request)
    const limit = Number(body.dailyStudentMessageLimit)
    const maxUpload = Number(body.maxUploadMb)
    if (!Number.isInteger(limit) || limit < 0 || limit > 500 || !Number.isInteger(maxUpload) || maxUpload < 1 || maxUpload > 25) {
      throw new HttpError(400, '额度或上传大小无效', 'invalid_input')
    }
    const update = {
      ai_enabled: Boolean(body.aiEnabled),
      text_provider: typeof body.textProvider === 'string' ? body.textProvider.slice(0, 80) : 'openai-compatible',
      vision_provider: typeof body.visionProvider === 'string' ? body.visionProvider.slice(0, 80) : 'openai-compatible',
      embedding_provider: typeof body.embeddingProvider === 'string' ? body.embeddingProvider.slice(0, 80) : 'openai-compatible',
      daily_student_message_limit: limit,
      max_upload_mb: maxUpload,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    }
    const { error } = await db.from('app_settings').update(update).eq('singleton', true)
    if (error) throw error
    await db.from('audit_logs').insert({ actor_id: actor.id, action: 'settings.update', target_type: 'app_settings' })
    return json(request, { ok: true })
  } catch (error) {
    return asErrorResponse(request, error)
  }
})
