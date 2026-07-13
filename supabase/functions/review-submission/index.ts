import { handleOptions } from '../_shared/cors.ts'
import { requireTeacher } from '../_shared/auth.ts'
import { asErrorResponse, HttpError, json, readJson, requireString } from '../_shared/http.ts'

const VALID_TAGS = new Set(['concept', 'reading', 'modeling', 'calculation', 'writing', 'speed', 'avoidance'])

function questionComments(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.slice(0, 100).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const questionNumber = typeof row.questionNumber === 'string' ? row.questionNumber.trim().slice(0, 40) : ''
    const comment = typeof row.comment === 'string' ? row.comment.trim().slice(0, 2000) : ''
    if (!questionNumber || !comment) return []
    const result: Record<string, unknown> = { questionNumber, comment }
    if (typeof row.score === 'number' && Number.isFinite(row.score)) result.score = Math.max(0, Math.min(10000, row.score))
    if (typeof row.maxScore === 'number' && Number.isFinite(row.maxScore)) result.maxScore = Math.max(0, Math.min(10000, row.maxScore))
    return [result]
  })
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  try {
    if (request.method !== 'POST') throw new HttpError(405, '仅支持 POST', 'method_not_allowed')
    const { actor, db } = await requireTeacher(request)
    const body = await readJson<Record<string, unknown>>(request)
    const submissionId = requireString(body.submissionId, 'submissionId', 64)
    const action = requireString(body.action, 'action', 20)
    if (action === 'wrong_item_feedback') {
      const { data: submission, error: submissionError } = await db.from('submissions')
        .select('id,student_id,mode').eq('id', submissionId).maybeSingle()
      if (submissionError) throw submissionError
      if (!submission) throw new HttpError(404, 'Submission not found', 'not_found')
      if (submission.mode !== 'wrong_item') {
        throw new HttpError(400, 'Feedback action requires a wrong-item submission', 'invalid_submission_mode')
      }
      const teacherHint = typeof body.teacherHint === 'string' ? body.teacherHint.trim().slice(0, 4000) : ''
      const teacherEvaluation = typeof body.teacherEvaluation === 'string' ? body.teacherEvaluation.trim().slice(0, 8000) : ''
      if (!teacherHint && !teacherEvaluation) {
        throw new HttpError(400, 'A hint or evaluation is required', 'feedback_required')
      }
      const { data: feedback, error } = await db.from('wrong_submission_feedback').upsert({
        submission_id: submission.id,
        student_id: submission.student_id,
        teacher_id: actor.id,
        teacher_hint: teacherHint,
        teacher_evaluation: teacherEvaluation,
      }, { onConflict: 'submission_id' }).select('*').single()
      if (error) throw error
      await db.from('audit_logs').insert({
        actor_id: actor.id,
        action: 'wrong_submission.feedback',
        target_type: 'submission',
        target_id: submissionId,
        metadata: { hasHint: Boolean(teacherHint), hasEvaluation: Boolean(teacherEvaluation) },
      })
      return json(request, { ok: true, feedback })
    }
    if (action === 'archive_wrong_item') {
      const tags = Array.isArray(body.tags)
        ? body.tags.filter((tag): tag is string => typeof tag === 'string' && VALID_TAGS.has(tag)) : []
      const teacherHint = typeof body.teacherHint === 'string' ? body.teacherHint.trim().slice(0, 4000) : ''
      const teacherEvaluation = typeof body.teacherEvaluation === 'string' ? body.teacherEvaluation.trim().slice(0, 8000) : ''
      const { data, error } = await db.rpc('archive_wrong_item_submission', {
        target_submission_id: submissionId,
        reviewer_id: actor.id,
        hint_text: teacherHint,
        evaluation_text: teacherEvaluation,
        approved_tags: tags,
      })
      if (error) throw error
      return json(request, { ok: true, ...data })
    }
    if (action === 'grade') {
      const { data: submission, error: submissionError } = await db.from('submissions')
        .select('id,student_id,status').eq('id', submissionId).maybeSingle()
      if (submissionError) throw submissionError
      if (!submission) throw new HttpError(404, '提交不存在', 'not_found')
      const score = body.score === null || body.score === undefined ? null
        : typeof body.score === 'number' && Number.isFinite(body.score) ? Math.max(0, Math.min(10000, body.score)) : undefined
      const maxScore = body.maxScore === null || body.maxScore === undefined ? null
        : typeof body.maxScore === 'number' && Number.isFinite(body.maxScore) ? Math.max(0.01, Math.min(10000, body.maxScore)) : undefined
      if (score === undefined || maxScore === undefined) throw new HttpError(400, '分数格式无效', 'invalid_input')
      if (score !== null && maxScore !== null && score > maxScore) throw new HttpError(400, '得分不能超过满分', 'invalid_input')
      const feedback = typeof body.feedback === 'string' ? body.feedback.trim().slice(0, 8000) : ''
      const comments = questionComments(body.questionComments)
      const { data: grade, error: gradeError } = await db.from('submission_grades').upsert({
        submission_id: submission.id,
        student_id: submission.student_id,
        score,
        max_score: maxScore,
        feedback,
        question_feedback: comments,
        teacher_id: actor.id,
        confirmed_at: new Date().toISOString(),
      }, { onConflict: 'submission_id' }).select('id,submission_id,student_id,score,max_score,feedback,question_feedback,teacher_id,confirmed_at,updated_at').single()
      if (gradeError) throw gradeError
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'submission.grade', target_type: 'submission', target_id: submissionId, metadata: { score, maxScore, questionCount: comments.length } })
      return json(request, { ok: true, grade })
    }
    if (action === 'approve') {
      const tags = Array.isArray(body.tags)
        ? body.tags.filter((tag): tag is string => typeof tag === 'string' && VALID_TAGS.has(tag)) : []
      const teacherNote = typeof body.teacherNote === 'string' ? body.teacherNote.trim().slice(0, 4000) : ''
      const { data, error } = await db.rpc('approve_submission', {
        target_submission_id: submissionId,
        reviewer_id: actor.id,
        approved_tags: tags,
        reviewer_note: teacherNote,
      })
      if (error) throw error
      return json(request, { ok: true, ...data })
    }
    if (action === 'reject') {
      const reason = requireString(body.reason, '驳回原因', 2000)
      const { data: submission } = await db.from('submissions').select('id,status').eq('id', submissionId).maybeSingle()
      if (!submission) throw new HttpError(404, '提交不存在', 'not_found')
      if (submission.status === 'scheduled') throw new HttpError(409, '已生成复习计划的提交不能直接驳回', 'invalid_status')
      const { error } = await db.from('submissions').update({ status: 'rejected', failure_reason: reason }).eq('id', submissionId)
      if (error) throw error
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'submission.reject', target_type: 'submission', target_id: submissionId, metadata: { reason } })
      return json(request, { ok: true })
    }
    throw new HttpError(400, '不支持的复核操作', 'invalid_action')
  } catch (error) {
    return asErrorResponse(request, error)
  }
})
