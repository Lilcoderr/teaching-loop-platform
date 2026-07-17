import { handleOptions } from '../_shared/cors.ts'
import { requireTeacher } from '../_shared/auth.ts'
import { asErrorResponse, HttpError, json, readJson, requireString } from '../_shared/http.ts'
import { chatCompletion, type ModelResult } from '../_shared/model.ts'
import { buildWeeklyReportModelMessages, parseWeeklyReportModelOutput } from './logic.ts'

const WEEKLY_REPORT_MODEL_TIMEOUT_MS = 20_000
const WEEKLY_REPORT_MAX_OUTPUT_TOKENS = 1400

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 20).map((item) => item.trim().slice(0, 500)) : []
}

function shanghaiDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function shanghaiTimestampRange(periodStart: string, periodEnd: string) {
  const start = new Date(`${periodStart}T00:00:00+08:00`)
  const endExclusive = new Date(`${periodEnd}T00:00:00+08:00`)
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)
  return { start: start.toISOString(), endExclusive: endExclusive.toISOString() }
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  try {
    if (request.method !== 'POST') throw new HttpError(405, '仅支持 POST', 'method_not_allowed')
    const { actor, db } = await requireTeacher(request)
    const body = await readJson<Record<string, unknown>>(request)
    const action = requireString(body.action, 'action', 20)
    if (action === 'save') {
      const report = body.report as Record<string, unknown> | undefined
      if (!report) throw new HttpError(400, '缺少周报数据', 'invalid_input')
      const id = requireString(report.id, 'report.id', 64)
      const record = {
        id,
        student_id: requireString(report.studentId, 'studentId', 64),
        period_start: requireString(report.periodStart, 'periodStart', 40).slice(0, 10),
        period_end: requireString(report.periodEnd, 'periodEnd', 40).slice(0, 10),
        title: requireString(report.title, '标题', 160),
        summary: typeof report.summary === 'string' ? report.summary.slice(0, 8000) : '',
        progress: list(report.progress),
        concerns: list(report.concerns),
        next_actions: list(report.nextActions),
        status: 'draft',
        published_at: null,
        created_by: actor.id,
      }
      const { error } = await db.from('weekly_reports').upsert(record, { onConflict: 'id' })
      if (error) throw error
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'weekly_report.save', target_type: 'weekly_report', target_id: id })
      return json(request, { ok: true, reportId: id })
    }
    if (action === 'publish') {
      const reportId = requireString(body.reportId, 'reportId', 64)
      const { error } = await db.from('weekly_reports').update({ status: 'published', published_at: new Date().toISOString() }).eq('id', reportId)
      if (error) throw error
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'weekly_report.publish', target_type: 'weekly_report', target_id: reportId })
      return json(request, { ok: true })
    }
    if (action === 'generate' || action === 'draft') {
      const studentId = requireString(body.studentId, 'studentId', 64)
      const defaultEnd = new Date()
      const defaultStart = new Date(defaultEnd); defaultStart.setDate(defaultStart.getDate() - 6)
      const periodStart = typeof body.periodStart === 'string' ? body.periodStart.slice(0, 10) : shanghaiDateKey(defaultStart)
      const periodEnd = typeof body.periodEnd === 'string' ? body.periodEnd.slice(0, 10) : shanghaiDateKey(defaultEnd)
      const timestampRange = shanghaiTimestampRange(periodStart, periodEnd)
      const [
        { data: evidence },
        { data: wrongItems },
        { data: tasks },
        { data: submissions },
        { data: dailyEvaluations },
        { data: settings },
        { data: studentProfile, error: studentError },
      ] = await Promise.all([
        db.from('learning_evidence').select('category,claim,evidence,created_at').eq('student_id', studentId).eq('state', 'teacher_verified')
          .gte('created_at', timestampRange.start).lt('created_at', timestampRange.endExclusive)
          .order('created_at', { ascending: true }).limit(60),
        db.from('wrong_items').select('title,knowledge_points,error_tags,teacher_note,resolved,occurred_at').eq('student_id', studentId)
          .eq('evidence_state', 'teacher_verified').gte('occurred_at', periodStart).lte('occurred_at', periodEnd)
          .order('occurred_at', { ascending: true }).limit(60),
        db.from('review_tasks').select('status').eq('student_id', studentId)
          .gte('created_at', timestampRange.start).lt('created_at', timestampRange.endExclusive).limit(500),
        db.from('submissions').select('id,minutes_spent,self_reflection').eq('student_id', studentId)
          .gte('assignment_date', periodStart).lte('assignment_date', periodEnd).limit(200),
        db.from('teacher_daily_evaluations').select('evaluation_date,subject,summary,highlights,improvements')
          .eq('student_id', studentId).gte('evaluation_date', periodStart).lte('evaluation_date', periodEnd)
          .order('evaluation_date', { ascending: true }).limit(60),
        db.from('app_settings').select('ai_enabled,text_model,text_provider').eq('singleton', true).single(),
        db.from('student_profiles').select('id,guardian_consent_at').eq('id', studentId).maybeSingle(),
      ])
      if (studentError || !studentProfile) {
        throw studentError ?? new HttpError(404, '学生资料不存在', 'not_found')
      }
      const submissionCount = submissions?.length ?? 0
      const timed = (submissions ?? []).filter((item) => typeof item.minutes_spent === 'number')
      const measurableBehavior = {
        submissionCount,
        averageMinutes: timed.length ? Math.round(timed.reduce((sum, item) => sum + item.minutes_spent, 0) / timed.length) : null,
        reflectionCompletionRate: submissionCount ? (submissions ?? []).filter((item) => item.self_reflection?.trim()).length / submissionCount : null,
        reviewCompletionRate: (tasks ?? []).length ? (tasks ?? []).filter((item) => item.status === 'completed').length / (tasks ?? []).length : null,
      }
      const modelMessages = buildWeeklyReportModelMessages({
        evidence,
        dailyEvaluations,
        wrongItems,
        reviewCompleted: (tasks ?? []).filter((item) => item.status === 'completed').length,
        reviewTotal: (tasks ?? []).length,
        measurableBehavior,
      })
      let parsed = null as ReturnType<typeof parseWeeklyReportModelOutput>
      let modelResult: ModelResult | null = null
      const modelAllowed = Boolean(settings.ai_enabled && studentProfile.guardian_consent_at)
      if (modelAllowed) {
        modelResult = await chatCompletion([
          { role: 'system', content: modelMessages.system },
          { role: 'user', content: modelMessages.user },
        ], {
          model: settings.text_model,
          json: true,
          temperature: 0.1,
          maxOutputTokens: WEEKLY_REPORT_MAX_OUTPUT_TOKENS,
          timeoutMs: WEEKLY_REPORT_MODEL_TIMEOUT_MS,
        })
        if (modelResult) parsed = parseWeeklyReportModelOutput(modelResult.text)
        const { error: usageError } = await db.from('model_usage').insert({
          student_id: studentId,
          operation: 'weekly_report',
          provider: settings.text_provider,
          model: modelResult?.model,
          input_tokens: modelResult?.inputTokens ?? 0,
          output_tokens: modelResult?.outputTokens ?? 0,
          fallback_used: !parsed,
        })
        if (usageError) console.error('Failed to record weekly report model usage', usageError.message)
      }
      const progress = parsed ? list(parsed.progress) : [
        `本周提交作业 ${submissionCount} 次`,
        `完成复习任务 ${(tasks ?? []).filter((item) => item.status === 'completed').length}/${(tasks ?? []).length}`,
      ]
      const concerns = parsed ? list(parsed.concerns) : [...new Set((wrongItems ?? []).flatMap((item) => item.knowledge_points))].slice(0, 5).map((point) => `继续关注：${point}`)
      const nextActions = parsed ? list(parsed.nextActions) : (wrongItems ?? []).filter((item) => !item.resolved).slice(0, 5).map((item) => `按计划复习：${item.title}`)
      const report = {
          id: crypto.randomUUID(), studentId, periodStart, periodEnd, title: '本周学习周报',
          summary: typeof parsed?.summary === 'string' ? parsed.summary.slice(0, 8000) : '以下内容根据教师已确认的学习记录生成，请教师复核后发布。',
          progress, concerns, nextActions, status: 'draft',
      }
      return json(request, action === 'draft' ? report : {
        report,
        fallbackUsed: !parsed,
        aiSkippedForConsent: Boolean(settings.ai_enabled && !studentProfile.guardian_consent_at),
      })
    }
    throw new HttpError(400, '不支持的周报操作', 'invalid_action')
  } catch (error) {
    return asErrorResponse(request, error)
  }
})
