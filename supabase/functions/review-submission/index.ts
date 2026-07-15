import { handleOptions } from '../_shared/cors.ts'
import { requireTeacher } from '../_shared/auth.ts'
import { asErrorResponse, HttpError, json, readJson, requireString } from '../_shared/http.ts'

const VALID_TAGS = new Set(['concept', 'reading', 'modeling', 'calculation', 'writing', 'speed', 'avoidance'])

function textField(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new HttpError(400, `${label}格式无效`, 'invalid_input')
  const result = value.trim()
  if (Array.from(result).length > max) throw new HttpError(400, `${label}最多 ${max} 个字符`, 'invalid_input')
  return result
}

function questionComments(value: unknown): Array<Record<string, unknown>> {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new HttpError(400, '逐题反馈格式无效', 'invalid_question_comment')
  if (value.length > 100) throw new HttpError(400, '逐题反馈一次最多 100 条', 'invalid_question_comment')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new HttpError(400, `第 ${index + 1} 条逐题反馈格式无效`, 'invalid_question_comment')
    const row = item as Record<string, unknown>
    const questionNumber = textField(row.questionNumber, `第 ${index + 1} 条逐题反馈题号`, 40)
    const comment = textField(row.comment, `第 ${index + 1} 条逐题反馈`, 2000)
    if (!questionNumber || !comment) throw new HttpError(400, `第 ${index + 1} 条逐题反馈不完整`, 'invalid_question_comment')
    const result: Record<string, unknown> = { questionNumber, comment }
    if (row.score !== undefined) {
      if (typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 10000) {
        throw new HttpError(400, `第 ${index + 1} 条逐题反馈得分无效`, 'invalid_question_comment')
      }
      result.score = row.score
    }
    if (row.maxScore !== undefined) {
      if (typeof row.maxScore !== 'number' || !Number.isFinite(row.maxScore) || row.maxScore < 0 || row.maxScore > 10000) {
        throw new HttpError(400, `第 ${index + 1} 条逐题反馈满分无效`, 'invalid_question_comment')
      }
      result.maxScore = row.maxScore
    }
    return result
  })
}

function wrongNumbers(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new HttpError(400, '确认错题题号格式无效', 'invalid_question_number')
  if (value.length > 50) throw new HttpError(400, '一次最多确认 50 个错题题号', 'invalid_question_number')
  const values = value.map((item) => {
    if (typeof item !== 'string' || !item.trim()) throw new HttpError(400, '确认错题题号不能为空', 'invalid_question_number')
    const result = item.trim()
    if (Array.from(result).length > 40) throw new HttpError(400, '单个题号最多 40 个字符', 'invalid_question_number')
    return result
  })
  return [...new Set(values)]
}

function gradeFields(body: Record<string, unknown>) {
  const score = body.score === null || body.score === undefined ? null : body.score
  const maxScore = body.maxScore === null || body.maxScore === undefined ? null : body.maxScore
  if (score !== null && (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 10000)) {
    throw new HttpError(400, '得分格式无效', 'invalid_input')
  }
  if (maxScore !== null && (typeof maxScore !== 'number' || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 10000)) {
    throw new HttpError(400, '满分格式无效', 'invalid_input')
  }
  if (score !== null && maxScore !== null && score > maxScore) throw new HttpError(400, '得分不能超过满分', 'invalid_input')
  return { score, maxScore, comments: questionComments(body.questionComments) }
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
      const teacherHint = textField(body.teacherHint, '教师提示', 4000)
      const teacherEvaluation = textField(body.teacherEvaluation, '教师评价', 8000)
      if (!teacherHint && !teacherEvaluation) {
        throw new HttpError(400, 'A hint or evaluation is required', 'feedback_required')
      }
      const { data: existingFeedback, error: existingError } = await db.from('wrong_submission_feedback')
        .select('teacher_hint,teacher_evaluation').eq('submission_id', submission.id).maybeSingle()
      if (existingError) throw existingError
      const { data: feedback, error } = await db.from('wrong_submission_feedback').upsert({
        submission_id: submission.id,
        student_id: submission.student_id,
        teacher_id: actor.id,
        teacher_hint: teacherHint || existingFeedback?.teacher_hint || '',
        teacher_evaluation: teacherEvaluation || existingFeedback?.teacher_evaluation || '',
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
      const teacherHint = textField(body.teacherHint, '教师提示', 4000)
      const teacherEvaluation = textField(body.teacherEvaluation, '教师评价', 8000)
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
    if (action === 'grade_and_approve') {
      const tags = Array.isArray(body.tags)
        ? body.tags.filter((tag): tag is string => typeof tag === 'string' && VALID_TAGS.has(tag)) : []
      const feedback = textField(body.feedback, '总体反馈', 4000)
      if (!feedback) throw new HttpError(400, '总体反馈不能为空', 'invalid_input')
      const { score, maxScore, comments } = gradeFields(body)
      const confirmedWrongNumbers = wrongNumbers(body.confirmedWrongNumbers)
      const { data, error } = await db.rpc('grade_and_approve_submission', {
        target_submission_id: submissionId,
        reviewer_id: actor.id,
        grade_score: score,
        grade_max_score: maxScore,
        grade_feedback: feedback,
        grade_question_feedback: comments,
        approved_tags: tags,
        confirmed_wrong_numbers: confirmedWrongNumbers,
      })
      if (error) throw error
      return json(request, { ok: true, ...data })
    }
    if (action === 'grade') {
      const { data: submission, error: submissionError } = await db.from('submissions')
        .select('id,student_id,status,mode').eq('id', submissionId).maybeSingle()
      if (submissionError) throw submissionError
      if (!submission) throw new HttpError(404, '提交不存在', 'not_found')
      if (submission.mode !== 'assignment') {
        throw new HttpError(400, '作业评分只适用于整份作业提交', 'invalid_submission_mode')
      }
      const { score, maxScore, comments } = gradeFields(body)
      const feedback = textField(body.feedback, '总体反馈', 4000)
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
      const { data: submission, error: submissionError } = await db.from('submissions')
        .select('id,mode').eq('id', submissionId).maybeSingle()
      if (submissionError) throw submissionError
      if (!submission) throw new HttpError(404, '提交不存在', 'not_found')
      if (submission.mode !== 'assignment') {
        throw new HttpError(400, '整份作业才能使用确认批改；错题或不会题请使用归档操作', 'invalid_submission_mode')
      }
      const tags = Array.isArray(body.tags)
        ? body.tags.filter((tag): tag is string => typeof tag === 'string' && VALID_TAGS.has(tag)) : []
      const confirmedWrongNumbers = wrongNumbers(body.confirmedWrongNumbers)
      const teacherNote = textField(body.teacherNote, '总体反馈', 4000)
      const { data, error } = await db.rpc('approve_submission', {
        target_submission_id: submissionId,
        reviewer_id: actor.id,
        approved_tags: tags,
        reviewer_note: teacherNote,
        confirmed_wrong_numbers: confirmedWrongNumbers,
      })
      if (error) throw error
      return json(request, { ok: true, ...data })
    }
    if (action === 'reject') {
      const reason = requireString(body.reason, '驳回原因', 2000)
      const { data: rejected, error: rejectError } = await db.from('submissions')
        .update({ status: 'rejected', failure_reason: reason })
        .eq('id', submissionId)
        .in('status', ['uploaded', 'analyzing', 'needs_review', 'failed'])
        .select('id').maybeSingle()
      if (rejectError) throw rejectError
      if (!rejected) {
        const { data: current, error: currentError } = await db.from('submissions').select('id,status').eq('id', submissionId).maybeSingle()
        if (currentError) throw currentError
        if (!current) throw new HttpError(404, '提交不存在', 'not_found')
        throw new HttpError(409, '当前状态已变化，不能退回该提交', 'invalid_status')
      }
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'submission.reject', target_type: 'submission', target_id: submissionId, metadata: { reason } })
      return json(request, { ok: true })
    }
    throw new HttpError(400, '不支持的复核操作', 'invalid_action')
  } catch (error) {
    return asErrorResponse(request, error)
  }
})
