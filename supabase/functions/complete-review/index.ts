import { handleOptions } from '../_shared/cors.ts'
import { requireActor } from '../_shared/auth.ts'
import { asErrorResponse, HttpError, json, readJson, requireString } from '../_shared/http.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  try {
    if (request.method !== 'POST') throw new HttpError(405, '仅支持 POST', 'method_not_allowed')
    const { actor, db } = await requireActor(request)
    if (actor.role === 'parent') throw new HttpError(403, '家长账号不能完成复习任务', 'forbidden')
    const body = await readJson<Record<string, unknown>>(request)
    const taskId = requireString(body.taskId, 'taskId', 64)
    if (typeof body.passed !== 'boolean') throw new HttpError(400, 'passed 必须为布尔值', 'invalid_input')
    const { data, error } = await db.rpc('complete_review_task', {
      target_task_id: taskId,
      actor_id: actor.id,
      passed: body.passed,
    })
    if (error) throw error
    return json(request, { ok: true, ...data })
  } catch (error) {
    return asErrorResponse(request, error)
  }
})
