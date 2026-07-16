import { handleOptions } from '../_shared/cors.ts'
import { asErrorResponse, json } from '../_shared/http.ts'
import { requireActor } from '../_shared/auth.ts'
import {
  chatModelConfigured,
  embeddingModelConfigured,
  selectedChatModel,
  selectedEmbeddingModel,
} from '../_shared/model.ts'

const iso = (value: string | null | undefined) => value ?? undefined

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  try {
    const { actor, db } = await requireActor(request, { allowPasswordChange: true })
    if (actor.mustChangePassword) {
      return json(request, {
        currentUser: {
          id: actor.id, role: actor.role, displayName: actor.displayName,
          username: actor.username, avatarColor: '#64748b', mustChangePassword: true,
        },
        students: [], accounts: [], submissions: [], analysisDrafts: [], wrongItems: [], reviewTasks: [],
        messages: [], tutorTurns: [], reports: [], dailyEvaluations: [], submissionGrades: [], learningResources: [],
        knowledgeDocuments: [], questionBankItems: [], syncTokens: [], syncRuns: [],
        settings: {
          aiEnabled: false,
          textProvider: '',
          visionProvider: '',
          embeddingProvider: '',
          textModel: '',
          visionModel: '',
          embeddingModel: '',
          textModelConfigured: false,
          visionModelConfigured: false,
          embeddingModelConfigured: false,
          dailyStudentMessageLimit: 0,
          maxUploadMb: 25,
        },
      })
    }
    const { data: allProfiles, error: profileError } = await db.from('profiles')
      .select('id,username,display_name,role,avatar_color,status,must_change_password,last_active_at')
    if (profileError) throw profileError
    const profileById = new Map((allProfiles ?? []).map((profile) => [profile.id, profile]))

    let studentIds: string[] = []
    if (actor.role === 'teacher') {
      studentIds = (allProfiles ?? []).filter((p) => p.role === 'student' && p.status === 'active').map((p) => p.id)
    } else if (actor.role === 'student') {
      studentIds = [actor.id]
    } else {
      const { data: links, error } = await db.from('parent_students').select('student_id').eq('parent_id', actor.id)
      if (error) throw error
      studentIds = (links ?? []).map((link) => link.student_id)
    }

    const selectByStudents = <T>(query: T & { in: (column: string, values: string[]) => T }): T =>
      studentIds.length ? query.in('student_id', studentIds) : query.in('student_id', ['00000000-0000-0000-0000-000000000000'])

    const [studentResult, submissionResult, wrongResult, taskResult, messageResult, turnResult, reportResult, evaluationResult, settingResult] = await Promise.all([
      studentIds.length
        ? db.from('student_profiles').select(actor.role === 'parent' ? 'id' : 'id,grade,subjects,target_score,guardian_consent_at').in('id', studentIds)
        : Promise.resolve({ data: [], error: null }),
      actor.role === 'parent'
        ? Promise.resolve({ data: [], error: null })
        : selectByStudents(db.from('submissions').select('*').order('submitted_at', { ascending: false })).limit(500),
      actor.role === 'parent'
        ? Promise.resolve({ data: [], error: null })
        : selectByStudents(db.from('wrong_items').select('*').order('occurred_at', { ascending: false })).limit(1000),
      actor.role === 'parent'
        ? Promise.resolve({ data: [], error: null })
        : selectByStudents(db.from('review_tasks').select('*').order('due_at', { ascending: true })).limit(1000),
      actor.role === 'parent'
        ? Promise.resolve({ data: [], error: null })
        : selectByStudents(db.from('messages').select('*').order('created_at', { ascending: true })).limit(1000),
      actor.role === 'parent'
        ? Promise.resolve({ data: [], error: null })
        : selectByStudents(db.from('tutor_turns').select('*,tutor_citations(*)').order('created_at', { ascending: true })).limit(1000),
      selectByStudents(db.from('weekly_reports').select('*').order('period_end', { ascending: false }))
        .in('status', actor.role === 'teacher' ? ['draft', 'published'] : ['published']).limit(500),
      actor.role === 'parent'
        ? Promise.resolve({ data: [], error: null })
        : selectByStudents(db.from('teacher_daily_evaluations').select('*').order('evaluation_date', { ascending: false }).order('updated_at', { ascending: false })).limit(500),
      db.from('app_settings').select('*').eq('singleton', true).single(),
    ])
    for (const result of [studentResult, submissionResult, wrongResult, taskResult, messageResult, turnResult, reportResult, evaluationResult, settingResult]) {
      if (result.error) throw result.error
    }

    const submissions = submissionResult.data ?? []
    const submissionIds = submissions.map((item) => item.id)
    const [attachmentResult, draftResult, gradeResult, wrongFeedbackResult] = await Promise.all([
      submissionIds.length
        ? db.from('submission_attachments').select('*').in('submission_id', submissionIds).order('page_order').order('created_at')
        : Promise.resolve({ data: [], error: null }),
      actor.role === 'teacher' && submissionIds.length
        ? db.from('analysis_drafts').select('*').in('submission_id', submissionIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      submissionIds.length
        ? db.from('submission_grades').select('*').in('submission_id', submissionIds).order('confirmed_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      submissionIds.length
        ? db.from('wrong_submission_feedback').select('*').in('submission_id', submissionIds).order('updated_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])
    if (attachmentResult.error) throw attachmentResult.error
    if (draftResult.error) throw draftResult.error
    if (gradeResult.error) throw gradeResult.error
    if (wrongFeedbackResult.error) throw wrongFeedbackResult.error

    const attachmentRows = (attachmentResult.data ?? []).filter((attachment) => {
      const parts = String(attachment.storage_path).split('/')
      return parts.length >= 3 && parts[0] === attachment.student_id && parts[1] === attachment.submission_id
    })
    const paths = attachmentRows.map((attachment) => attachment.storage_path)
    const signedByPath = new Map<string, string>()
    if (paths.length) {
      const { data: signed } = await db.storage.from('submissions').createSignedUrls(paths, 3600)
      for (const item of signed ?? []) if (item.signedUrl && item.path) signedByPath.set(item.path, item.signedUrl)
    }
    const attachmentsBySubmission = new Map<string, Array<Record<string, unknown>>>()
    for (const attachment of attachmentRows) {
      const list = attachmentsBySubmission.get(attachment.submission_id) ?? []
      list.push({
        id: attachment.id,
        name: attachment.file_name,
        mimeType: attachment.mime_type,
        size: Number(attachment.file_size),
        storagePath: attachment.storage_path,
        previewUrl: signedByPath.get(attachment.storage_path),
      })
      attachmentsBySubmission.set(attachment.submission_id, list)
    }

    let accounts: Array<Record<string, unknown>> = []
    if (actor.role === 'teacher') {
      const { data: parentLinks, error } = await db.from('parent_students').select('parent_id,student_id')
      if (error) throw error
      const links = new Map<string, string[]>()
      for (const profile of allProfiles ?? []) if (profile.role === 'student') links.set(profile.id, [profile.id])
      for (const link of parentLinks ?? []) links.set(link.parent_id, [...(links.get(link.parent_id) ?? []), link.student_id])
      accounts = (allProfiles ?? []).map((profile) => ({
        id: profile.id,
        username: profile.username,
        displayName: profile.display_name,
        role: profile.role,
        avatarColor: profile.avatar_color,
        status: profile.status,
        mustChangePassword: profile.must_change_password,
        linkedStudentIds: links.get(profile.id) ?? [],
        lastActiveAt: iso(profile.last_active_at),
      }))
    }

    let knowledgeDocuments: Array<Record<string, unknown>> = []
    let questionBankItems: Array<Record<string, unknown>> = []
    let syncTokens: Array<Record<string, unknown>> = []
    let syncRuns: Array<Record<string, unknown>> = []
    let learningResources: Array<Record<string, unknown>> = []
    if (actor.role !== 'parent') {
      let materialRows: Array<Record<string, any>> = []
      if (actor.role === 'teacher') {
        const { data, error } = await db.from('learning_materials').select('*').order('updated_at', { ascending: false }).limit(2000)
        if (error) throw error
        materialRows = (data ?? []) as Array<Record<string, any>>
      } else {
        const { data: grants, error: grantsError } = await db.from('learning_material_grants').select('material_id').eq('student_id', actor.id)
        if (grantsError) throw grantsError
        const ids = (grants ?? []).map((grant) => grant.material_id)
        if (ids.length) {
          const { data, error } = await db.from('learning_materials').select('*').in('id', ids).eq('published', true)
          if (error) throw error
          materialRows = (data ?? []) as Array<Record<string, any>>
        }
      }
      const materialIds = materialRows.map((material) => String(material.id))
      const [{ data: files, error: filesError }, { data: materialGrants, error: materialGrantsError }] = await Promise.all([
        materialIds.length
        ? await db.from('learning_material_files').select('*').in('material_id', materialIds).order('created_at')
        : { data: [], error: null },
        actor.role === 'teacher' && materialIds.length
          ? await db.from('learning_material_grants').select('material_id,student_id').in('material_id', materialIds)
          : { data: [], error: null },
      ])
      if (filesError) throw filesError
      if (materialGrantsError) throw materialGrantsError
      const studentsByMaterial = new Map<string, string[]>()
      for (const grant of materialGrants ?? []) {
        const list = studentsByMaterial.get(String(grant.material_id)) ?? []
        list.push(String(grant.student_id))
        studentsByMaterial.set(String(grant.material_id), list)
      }
      const fileRows = (files ?? []) as Array<Record<string, any>>
      const paths = fileRows.map((file) => String(file.storage_path))
      const signedByPath = new Map<string, string>()
      if (paths.length) {
        const { data: signed } = await db.storage.from('materials').createSignedUrls(paths, 3600)
        for (const item of signed ?? []) if (item.signedUrl && item.path) signedByPath.set(item.path, item.signedUrl)
      }
      const filesByMaterial = new Map<string, Array<Record<string, unknown>>>()
      for (const file of fileRows) {
        const list = filesByMaterial.get(String(file.material_id)) ?? []
        list.push({
          id: file.id,
          name: file.file_name,
          mimeType: file.mime_type,
          size: Number(file.file_size),
          storagePath: file.storage_path,
          previewUrl: signedByPath.get(String(file.storage_path)),
        })
        filesByMaterial.set(String(file.material_id), list)
      }
      learningResources = materialRows.map((material) => ({
        id: material.id,
        studentId: actor.role === 'student' ? actor.id : (studentsByMaterial.get(String(material.id))?.[0] ?? ''),
        studentIds: studentsByMaterial.get(String(material.id)) ?? (actor.role === 'student' ? [actor.id] : []),
        subject: material.subject,
        topic: material.topic,
        title: material.title,
        resourceType: material.material_type,
        description: material.description || undefined,
        body: material.material_type === 'method' ? material.body || undefined : undefined,
        attachments: filesByMaterial.get(String(material.id)) ?? [],
        publishedAt: iso(material.published_at),
        createdAt: material.created_at,
      }))
    }
    if (actor.role === 'teacher') {
      const [documentsResult, chunksResult, runsResult, questionResult, tokensResult] = await Promise.all([
        db.from('knowledge_documents').select('*').order('indexed_at', { ascending: false }).limit(1000),
        db.rpc('active_knowledge_chunk_counts', { target_document_ids: null }),
        db.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(100),
        db.from('question_bank_items').select('*').eq('active', true).order('external_id').limit(2000),
        db.from('sync_tokens').select('id,label,operation,student_ids,subjects,created_at,last_used_at,expires_at')
          .is('revoked_at', null).order('created_at', { ascending: false }).limit(100),
      ])
      if (documentsResult.error) throw documentsResult.error
      if (chunksResult.error) throw chunksResult.error
      if (runsResult.error) throw runsResult.error
      if (questionResult.error) throw questionResult.error
      if (tokensResult.error) throw tokensResult.error
      const counts = new Map((chunksResult.data ?? []).map((row) => [String(row.document_id), Number(row.chunk_count)]))
      knowledgeDocuments = (documentsResult.data ?? []).map((doc) => ({
        id: doc.id,
        studentId: doc.student_id ?? undefined,
        subject: doc.subject,
        title: doc.title,
        documentType: doc.document_type,
        visibility: doc.visibility,
        relativePath: doc.relative_path,
        version: doc.version,
        contentHash: doc.content_hash,
        active: doc.active,
        indexedAt: doc.indexed_at,
        chunkCount: counts.get(doc.id) ?? 0,
      }))
      syncRuns = (runsResult.data ?? []).map((run) => ({
        id: run.id,
        startedAt: run.started_at,
        finishedAt: iso(run.finished_at),
        status: run.status,
        added: run.added,
        updated: run.updated,
        unchanged: run.unchanged,
        deactivated: run.deactivated,
        message: iso(run.message),
      }))
      syncTokens = (tokensResult.data ?? []).map((token) => ({
        id: token.id, label: token.label, operation: token.operation, studentIds: token.student_ids,
        subjects: token.subjects, createdAt: token.created_at, lastUsedAt: iso(token.last_used_at), expiresAt: iso(token.expires_at),
      }))
      questionBankItems = (questionResult.data ?? []).map((item) => ({
        id: item.external_id,
        subject: item.subject,
        topic: item.topic,
        paperName: item.source_paper,
        questionNumber: item.question_number,
        sourcePath: item.source_file,
        questionPage: Number(item.question_page) || item.question_page,
        answerPage: Number(item.answer_page) || item.answer_page,
        knowledgePoints: item.knowledge_points,
        difficulty: item.difficulty,
        verificationStatus: item.verified ? 'verified' : 'pending',
      }))
    } else if (actor.role === 'student') {
      const { data: directDocuments, error: directError } = await db.from('knowledge_documents').select('*')
        .eq('student_id', actor.id).eq('active', true).in('visibility', ['student_visible', 'solution_gated'])
      const { data: grantRows, error: grantError } = await db.from('knowledge_document_grants').select('document_id').eq('student_id', actor.id)
      if (directError || grantError) throw directError ?? grantError
      const grantedIds = (grantRows ?? []).map((grant) => grant.document_id)
      const { data: grantedDocuments, error: grantedError } = grantedIds.length
        ? await db.from('knowledge_documents').select('*').in('id', grantedIds).eq('active', true).in('visibility', ['student_visible', 'solution_gated'])
        : { data: [], error: null }
      if (grantedError) throw grantedError
      const documents = [...(directDocuments ?? []), ...(grantedDocuments ?? [])]
      const documentIds = [...new Set(documents.map((doc) => doc.id))]
      const { data: chunkCounts, error: chunksError } = documentIds.length
        ? await db.rpc('active_knowledge_chunk_counts', { target_document_ids: documentIds })
        : { data: [], error: null }
      if (chunksError) throw chunksError
      const counts = new Map((chunkCounts ?? []).map((row) => [String(row.document_id), Number(row.chunk_count)]))
      knowledgeDocuments = documents.map((doc) => ({
        id: doc.id,
        studentId: doc.student_id ?? actor.id,
        subject: doc.subject,
        title: doc.title,
        documentType: doc.document_type,
        visibility: doc.visibility,
        relativePath: doc.relative_path,
        version: doc.version,
        contentHash: doc.content_hash,
        active: doc.active,
        indexedAt: doc.indexed_at,
        chunkCount: counts.get(doc.id) ?? 0,
      }))
    }

    const students = (studentResult.data ?? []).map((student) => {
      const profile = profileById.get(student.id)!
      if (actor.role === 'parent') {
        return {
          id: student.id, role: 'student', displayName: profile.display_name,
          username: '', avatarColor: profile.avatar_color, grade: '', subjects: [],
        }
      }
      return {
        id: student.id,
        role: 'student',
        displayName: profile.display_name,
        username: profile.username,
        avatarColor: profile.avatar_color,
        grade: student.grade,
        subjects: student.subjects,
        targetScore: student.target_score === null ? undefined : Number(student.target_score),
        guardianConsentAt: iso(student.guardian_consent_at),
      }
    })
    const ownProfile = profileById.get(actor.id)!
    const gradeBySubmission = new Map<string, Record<string, any>>()
    for (const grade of gradeResult.data ?? []) gradeBySubmission.set(String(grade.submission_id), grade as Record<string, any>)
    const wrongFeedbackBySubmission = new Map<string, Record<string, any>>()
    for (const feedback of wrongFeedbackResult.data ?? []) {
      wrongFeedbackBySubmission.set(String(feedback.submission_id), feedback as Record<string, any>)
    }
    const wrongItemIdsBySubmission = new Map<string, string[]>()
    for (const wrongItem of wrongResult.data ?? []) {
      if (!wrongItem.submission_id) continue
      const ids = wrongItemIdsBySubmission.get(String(wrongItem.submission_id)) ?? []
      ids.push(String(wrongItem.id))
      wrongItemIdsBySubmission.set(String(wrongItem.submission_id), ids)
    }
    const currentUser = {
      id: actor.id,
      role: actor.role,
      displayName: ownProfile.display_name,
      username: ownProfile.username,
      avatarColor: ownProfile.avatar_color,
      mustChangePassword: actor.mustChangePassword,
    }
    return json(request, {
      currentUser,
      students,
      accounts,
      submissions: submissions.map((item) => ({
        id: item.id, studentId: item.student_id, mode: item.mode, subject: item.subject, title: item.title,
        submittedAt: item.submitted_at, assignmentDate: item.assignment_date, minutesSpent: item.minutes_spent ?? undefined,
        wrongNumbers: item.wrong_numbers, confidence: item.confidence ?? undefined, selfReflection: item.self_reflection ?? undefined,
        studentErrorTags: item.student_error_tags, status: item.status,
        teacherFeedback: gradeBySubmission.get(String(item.id))?.feedback
          ?? wrongFeedbackBySubmission.get(String(item.id))?.teacher_evaluation
          ?? wrongFeedbackBySubmission.get(String(item.id))?.teacher_hint
          ?? undefined,
        teacherHint: wrongFeedbackBySubmission.get(String(item.id))?.teacher_hint || undefined,
        teacherEvaluation: wrongFeedbackBySubmission.get(String(item.id))?.teacher_evaluation || undefined,
        teacherRespondedAt: iso(wrongFeedbackBySubmission.get(String(item.id))?.updated_at),
        archivedToWrongBook: Boolean(wrongFeedbackBySubmission.get(String(item.id))?.archived_at),
        archivedAt: iso(wrongFeedbackBySubmission.get(String(item.id))?.archived_at),
        wrongItemIds: wrongItemIdsBySubmission.get(String(item.id)) ?? [],
        teacherScore: gradeBySubmission.get(String(item.id))?.score === null ? undefined : gradeBySubmission.get(String(item.id))?.score,
        maxScore: gradeBySubmission.get(String(item.id))?.max_score === null ? undefined : gradeBySubmission.get(String(item.id))?.max_score,
        questionComments: gradeBySubmission.get(String(item.id))?.question_feedback ?? [],
        gradedAt: iso(gradeBySubmission.get(String(item.id))?.confirmed_at),
        attachments: attachmentsBySubmission.get(item.id) ?? [], failureReason: iso(item.failure_reason),
      })),
      analysisDrafts: (draftResult.data ?? []).map((item) => ({
        id: item.id, submissionId: item.submission_id, summary: item.summary, questionText: iso(item.question_text),
        proposedTags: item.proposed_tags, knowledgePoints: item.knowledge_points, evidence: item.evidence,
        confidence: Number(item.confidence), createdAt: item.created_at,
        gradingSummary: item.grading_feedback || undefined,
        proposedScore: item.proposed_score === null || item.proposed_score === undefined ? undefined : Number(item.proposed_score),
        maxScore: item.proposed_max_score === null || item.proposed_max_score === undefined ? undefined : Number(item.proposed_max_score),
        questionComments: item.question_feedback ?? [],
      })),
      submissionGrades: (gradeResult.data ?? []).map((grade) => ({
        id: grade.id, submissionId: grade.submission_id, studentId: grade.student_id,
        score: grade.score === null ? undefined : Number(grade.score),
        maxScore: grade.max_score === null ? undefined : Number(grade.max_score),
        feedback: grade.feedback, questionComments: grade.question_feedback ?? [],
        teacherId: grade.teacher_id, gradedAt: grade.confirmed_at, updatedAt: grade.updated_at,
      })),
      dailyEvaluations: (evaluationResult.data ?? []).map((evaluation) => ({
        id: evaluation.id, studentId: evaluation.student_id, date: evaluation.evaluation_date,
        subject: evaluation.subject ?? undefined, summary: evaluation.summary,
        highlights: evaluation.highlights ?? [], improvements: evaluation.improvements ?? [],
        createdAt: evaluation.created_at, updatedAt: evaluation.updated_at,
      })),
      wrongItems: (wrongResult.data ?? []).map((item) => ({
        id: item.id, studentId: item.student_id, submissionId: item.submission_id, subject: item.subject,
        questionNumber: item.question_number, title: item.title, knowledgePoints: item.knowledge_points,
        questionText: iso(item.question_text),
        errorTags: item.error_tags, evidenceState: item.evidence_state, teacherNote: item.teacher_note,
        occurredAt: item.occurred_at, recurrenceCount: item.recurrence_count, reviewStage: item.review_stage,
        nextReviewAt: iso(item.next_review_at), resolved: item.resolved,
      })),
      reviewTasks: (taskResult.data ?? []).map((item) => ({
        id: item.id, studentId: item.student_id, wrongItemId: item.wrong_item_id, title: item.title,
        dueAt: item.due_at, stage: item.stage, status: item.status,
      })),
      messages: (messageResult.data ?? []).map((item) => ({
        id: item.id, studentId: item.student_id, senderRole: item.sender_role, body: item.body,
        createdAt: item.created_at, read: item.read,
      })),
      tutorTurns: (turnResult.data ?? []).map((item) => ({
        id: item.id, studentId: item.student_id, role: item.role, body: item.body, createdAt: item.created_at,
        hintLevel: iso(item.hint_level), usedGeneralKnowledge: item.used_general_knowledge,
        citations: (item.tutor_citations ?? []).map((citation: Record<string, unknown>) => ({
          id: citation.id, label: citation.label, sourceType: citation.source_type, section: citation.section,
          excerpt: citation.excerpt, visibility: citation.visibility,
        })),
      })),
      reports: (reportResult.data ?? []).map((item) => ({
        id: item.id, studentId: item.student_id, periodStart: item.period_start, periodEnd: item.period_end,
        title: item.title, summary: item.summary, progress: item.progress, concerns: item.concerns,
        nextActions: item.next_actions, status: item.status, publishedAt: iso(item.published_at),
      })),
      learningResources,
      knowledgeDocuments,
      questionBankItems,
      syncTokens,
      syncRuns,
      settings: {
        aiEnabled: settingResult.data.ai_enabled,
        textProvider: settingResult.data.text_provider,
        visionProvider: settingResult.data.vision_provider,
        embeddingProvider: settingResult.data.embedding_provider,
        textModel: selectedChatModel('text', settingResult.data.text_model),
        visionModel: selectedChatModel('vision', settingResult.data.vision_model),
        embeddingModel: selectedEmbeddingModel(settingResult.data.embedding_model),
        textModelConfigured: chatModelConfigured('text', settingResult.data.text_model),
        visionModelConfigured: chatModelConfigured('vision', settingResult.data.vision_model),
        embeddingModelConfigured: embeddingModelConfigured(settingResult.data.embedding_model),
        dailyStudentMessageLimit: settingResult.data.daily_student_message_limit,
        maxUploadMb: settingResult.data.max_upload_mb,
      },
    })
  } catch (error) {
    return asErrorResponse(request, error)
  }
})
