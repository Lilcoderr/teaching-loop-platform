import { handleOptions } from '../_shared/cors.ts'
import { asErrorResponse, HttpError, json, readJson } from '../_shared/http.ts'
import { requireTeacher } from '../_shared/auth.ts'
import { chatCompletion, chatModelConfigured, parseJsonObject } from '../_shared/model.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  try {
    if (request.method !== 'POST') throw new HttpError(405, '仅支持 POST', 'method_not_allowed')
    const { actor, db } = await requireTeacher(request)
    const body = await readJson<Record<string, unknown>>(request)
    if (body.action === 'health_check') {
      const { data: current, error } = await db.from('app_settings').select('text_model').eq('singleton', true).single()
      if (error) throw error
      if (!chatModelConfigured('text', current?.text_model)) {
        throw new HttpError(409, '文本模型地址、Key 或模型名尚未完整配置', 'text_model_not_configured')
      }
      const startedAt = Date.now()
      const result = await chatCompletion([
        { role: 'system', content: '你是服务连通性检测器。不要处理用户数据，只输出 JSON。' },
        { role: 'user', content: '请只输出 {"ok":true}，不要增加其他字段。' },
      ], { model: current.text_model, json: true, temperature: 0, maxOutputTokens: 80, timeoutMs: 12_000 })
      const parsed = result ? parseJsonObject(result.text) : null
      if (!result || parsed?.ok !== true) {
        throw new HttpError(502, '文本模型未返回有效检测结果，请核对 Key、地址和模型名', 'text_model_health_failed')
      }
      return json(request, { ok: true, model: result.model, latencyMs: Date.now() - startedAt })
    }
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
