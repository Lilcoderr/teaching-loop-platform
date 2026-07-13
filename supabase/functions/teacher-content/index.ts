import { handleOptions } from '../_shared/cors.ts'
import { requireTeacher } from '../_shared/auth.ts'
import { asErrorResponse, HttpError, json, readJson, requireString } from '../_shared/http.ts'

const SUBJECTS = new Set(['math', 'physics', 'chemistry'])
const MATERIAL_TYPES = new Set(['lecture', 'assignment', 'supplement', 'method'])

function materialBody(value: unknown, materialType: string): string {
  const content = typeof value === 'string' ? value.trim().slice(0, 100000) : ''
  if (materialType === 'method' && !content) {
    throw new HttpError(400, 'Method resources require Markdown content', 'method_body_required')
  }
  return materialType === 'method' ? content : ''
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim())
    .map((item) => item.trim().slice(0, maxLength)))].slice(0, maxItems)
}

function optionalSubject(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || !SUBJECTS.has(value)) throw new HttpError(400, '科目无效', 'invalid_subject')
  return value
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  try {
    if (request.method !== 'POST') throw new HttpError(405, '仅支持 POST', 'method_not_allowed')
    const { actor, db } = await requireTeacher(request)
    const body = await readJson<Record<string, unknown>>(request)
    const action = requireString(body.action, 'action', 32)

    if (action === 'evaluation_upsert') {
      const studentId = requireString(body.studentId, 'studentId', 64)
      const evaluationDate = requireString(body.date, 'date', 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(evaluationDate)) throw new HttpError(400, '日期无效', 'invalid_date')
      const subject = optionalSubject(body.subject)
      const summary = requireString(body.summary, 'summary', 4000)
      const highlights = strings(body.highlights, 10, 500)
      const improvements = strings(body.improvements, 10, 500)
      const { data: student, error: studentError } = await db.from('profiles').select('id,role,status').eq('id', studentId).maybeSingle()
      if (studentError) throw studentError
      if (!student || student.role !== 'student' || student.status !== 'active') throw new HttpError(404, '学生不存在', 'student_not_found')
      let existingQuery = db.from('teacher_daily_evaluations').select('id')
        .eq('student_id', studentId).eq('evaluation_date', evaluationDate)
      existingQuery = subject === null ? existingQuery.is('subject', null) : existingQuery.eq('subject', subject)
      const { data: existing, error: existingError } = await existingQuery.maybeSingle()
      if (existingError && existingError.code !== 'PGRST116') throw existingError
      const payload = { student_id: studentId, teacher_id: actor.id, evaluation_date: evaluationDate, subject, summary, highlights, improvements }
      const result = existing
        ? await db.from('teacher_daily_evaluations').update(payload).eq('id', existing.id).select('*').single()
        : await db.from('teacher_daily_evaluations').insert(payload).select('*').single()
      if (result.error) throw result.error
      await db.from('audit_logs').insert({
        actor_id: actor.id,
        action: existing ? 'daily_evaluation.update' : 'daily_evaluation.create',
        target_type: 'teacher_daily_evaluation',
        target_id: result.data.id,
        metadata: { studentId, evaluationDate, subject },
      })
      return json(request, { ok: true, evaluation: result.data })
    }

    if (action === 'material_create') {
      const title = requireString(body.title, 'title', 200)
      const materialType = requireString(body.resourceType ?? body.materialType, 'resourceType', 20)
      if (!MATERIAL_TYPES.has(materialType)) throw new HttpError(400, '资料类型无效', 'invalid_resource_type')
      const subject = optionalSubject(body.subject)
      if (!subject) throw new HttpError(400, '资料必须指定科目', 'subject_required')
      const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 160) : ''
      const description = typeof body.description === 'string' ? body.description.trim().slice(0, 4000) : ''
      const markdown = materialBody(body.body ?? body.markdown, materialType)
      const studentIds = strings(body.studentIds, 200, 64)
      if (!studentIds.length) throw new HttpError(400, '至少指定一名学生', 'students_required')
      const { data: students, error: studentsError } = await db.from('student_profiles').select('id,subjects').in('id', studentIds)
      if (studentsError) throw studentsError
      if ((students ?? []).length !== studentIds.length) throw new HttpError(400, '存在无效学生', 'invalid_student')
      if ((students ?? []).some((student) => !(student.subjects ?? []).includes(subject))) throw new HttpError(400, '资料科目不在学生授权科目内', 'subject_not_allowed')
      const { data: material, error: materialError } = await db.from('learning_materials').insert({
        title, material_type: materialType, subject, topic, description, body: markdown, created_by: actor.id,
        published: body.published === true, published_at: body.published === true ? new Date().toISOString() : null,
      }).select('*').single()
      if (materialError) throw materialError
      const { error: grantsError } = await db.from('learning_material_grants').insert(studentIds.map((id) => ({ material_id: material.id, student_id: id, granted_by: actor.id })))
      if (grantsError) throw grantsError
      return json(request, { ok: true, material })
    }

    if (action === 'material_update') {
      const materialId = requireString(body.materialId, 'materialId', 64)
      const { data: current, error: currentError } = await db.from('learning_materials')
        .select('id,created_by,material_type,title,topic,description,body,published')
        .eq('id', materialId).maybeSingle()
      if (currentError) throw currentError
      if (!current || current.created_by !== actor.id) {
        throw new HttpError(404, 'Material not found', 'not_found')
      }

      const title = body.title === undefined ? current.title : requireString(body.title, 'title', 200)
      const topic = body.topic === undefined
        ? current.topic
        : typeof body.topic === 'string' ? body.topic.trim().slice(0, 160) : ''
      const description = body.description === undefined
        ? current.description
        : typeof body.description === 'string' ? body.description.trim().slice(0, 4000) : ''
      const markdownInput = body.body ?? body.markdown
      const markdown = markdownInput === undefined
        ? materialBody(current.body, current.material_type)
        : materialBody(markdownInput, current.material_type)
      const { data: material, error } = await db.from('learning_materials').update({
        title, topic, description, body: markdown,
      }).eq('id', materialId).select('*').single()
      if (error) throw error
      await db.from('audit_logs').insert({
        actor_id: actor.id,
        action: 'learning_material.update',
        target_type: 'learning_material',
        target_id: materialId,
        metadata: { materialType: current.material_type, published: current.published },
      })
      return json(request, { ok: true, material })
    }

    if (action === 'material_publish') {
      const materialId = requireString(body.materialId, 'materialId', 64)
      const { data: material, error: materialError } = await db.from('learning_materials')
        .select('id,created_by,subject,material_type,body').eq('id', materialId).maybeSingle()
      if (materialError) throw materialError
      if (!material || material.created_by !== actor.id) throw new HttpError(404, '资料不存在', 'not_found')
      const published = body.published !== false
      if (published && material.material_type === 'method' && !String(material.body ?? '').trim()) {
        throw new HttpError(400, 'Method resources require Markdown content before publishing', 'method_body_required')
      }
      const update = await db.from('learning_materials').update({ published, published_at: published ? new Date().toISOString() : null }).eq('id', materialId)
      if (update.error) throw update.error
      const studentIds = strings(body.studentIds, 200, 64)
      if (studentIds.length) {
        const { data: students, error: studentsError } = await db.from('student_profiles').select('id,subjects').in('id', studentIds)
        if (studentsError) throw studentsError
        if ((students ?? []).length !== studentIds.length || (students ?? []).some((student) => !(student.subjects ?? []).includes(material.subject))) {
          throw new HttpError(400, '存在无效学生或资料科目未获授权', 'invalid_student')
        }
        const { error } = await db.from('learning_material_grants').upsert(studentIds.map((id) => ({ material_id: materialId, student_id: id, granted_by: actor.id })), { onConflict: 'material_id,student_id' })
        if (error) throw error
      }
      return json(request, { ok: true, materialId, published })
    }

    throw new HttpError(400, '不支持的操作', 'invalid_action')
  } catch (error) {
    return asErrorResponse(request, error)
  }
})
