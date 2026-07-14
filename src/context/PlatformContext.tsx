/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { demoParent, demoState, demoStudents, demoTeacher } from '../data/demo'
import { canUseKnowledgeSource } from '../lib/knowledge'
import { nextReviewDate } from '../lib/review'
import { runtime } from '../lib/runtime'
import { invokeFunction, supabase } from '../lib/supabase'
import { localDateKey, uniqueId } from '../lib/utils'
import type {
  AccountRecord,
  ErrorTag,
  HintLevel,
  LearningResourceType,
  PlatformState,
  QuestionComment,
  Role,
  StudentProfile,
  Submission,
  Subject,
  TutorTurn,
  UserProfile,
  WeeklyReport,
} from '../types/domain'

const STORAGE_KEY = 'teaching-loop-demo-v1'
const STORAGE_VERSION = 4

type SubmissionInput = Pick<
  Submission,
  | 'mode'
  | 'subject'
  | 'title'
  | 'assignmentDate'
  | 'minutesSpent'
  | 'wrongNumbers'
  | 'confidence'
  | 'selfReflection'
  | 'studentErrorTags'
>

interface PlatformContextValue {
  state: PlatformState
  demoMode: boolean
  loading: boolean
  authenticated: boolean
  activeStudentId?: string
  activeStudent: PlatformState['students'][number] | undefined
  setActiveStudentId: (studentId: string) => void
  switchDemoUser: (role: Role, userId?: string) => void
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  createSubmission: (input: SubmissionInput, files: File[]) => Promise<string>
  approveSubmission: (submissionId: string, tags: ErrorTag[], teacherNote: string, confirmedWrongNumbers?: string[]) => Promise<void>
  gradeSubmission: (submissionId: string, feedback: string, questionComments: QuestionComment[], score?: number, maxScore?: number) => Promise<void>
  rejectSubmission: (submissionId: string, reason: string) => Promise<void>
  saveDailyEvaluation: (studentId: string, date: string, summary: string, highlights: string[], improvements: string[], subject?: Subject) => Promise<void>
  createLearningResource: (input: { studentIds: string[]; subject: Subject; topic: string; title: string; resourceType: LearningResourceType; description?: string; body?: string }, files: File[]) => Promise<void>
  completeReview: (taskId: string, passed: boolean) => Promise<void>
  sendMessage: (studentId: string, body: string) => Promise<void>
  markMessagesRead: (studentId: string) => Promise<void>
  sendTutorMessage: (body: string, level: HintLevel, attempt?: string, subject?: Subject, image?: TutorImageInput) => Promise<void>
  generateReportDraft: (studentId: string) => Promise<WeeklyReport>
  saveReport: (report: WeeklyReport) => Promise<void>
  publishReport: (reportId: string) => Promise<void>
  updateSettings: (settings: PlatformState['settings']) => Promise<void>
  createAccount: (account: NewAccountInput, temporaryPassword: string) => Promise<void>
  manageAccount: (accountId: string, action: 'reset_password' | 'set_status', value: string) => Promise<void>
  createSyncToken: (label: string, operation: 'knowledge' | 'question_bank', studentIds: string[], subjects: Subject[]) => Promise<{ token: string; tokenId: string }>
  revokeSyncToken: (tokenId: string) => Promise<void>
  exportStudentMemory: (studentId: string) => Promise<{ fileName: string; markdown: string }>
  requestStudentDeletion: (studentId: string, reason: string) => Promise<string>
  deleteStudentData: (studentId: string, requestId: string, confirmation: string) => Promise<void>
  resetDemo: () => void
  refresh: () => Promise<void>
}

export interface TutorImageInput {
  dataUrl: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  name: string
  size: number
}

type NewAccountInput = Omit<AccountRecord, 'id' | 'lastActiveAt'> & Partial<
  Pick<StudentProfile, 'grade' | 'subjects' | 'targetScore' | 'guardianConsentAt'>
>

const PlatformContext = createContext<PlatformContextValue | null>(null)

function cloneDemoState() {
  return structuredClone(demoState)
}

function emptyPlatformState(): PlatformState {
  return {
    currentUser: { id: '', role: 'student', displayName: '', username: '', avatarColor: '#64748b' },
    students: [], accounts: [], submissions: [], analysisDrafts: [], dailyEvaluations: [], wrongItems: [], reviewTasks: [],
    messages: [], tutorTurns: [], reports: [], knowledgeDocuments: [], learningResources: [], questionBankItems: [], syncTokens: [], syncRuns: [],
    settings: { aiEnabled: false, textProvider: '', visionProvider: '', embeddingProvider: '', dailyStudentMessageLimit: 0, maxUploadMb: 25 },
  }
}

function loadDemoState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as { version?: number; state?: PlatformState }
      if (parsed.version === STORAGE_VERSION && parsed.state) return parsed.state
    }
  } catch {
    // A broken browser cache should never prevent the demo from opening.
  }
  return cloneDemoState()
}

function defaultUserForRole(role: Role, userId?: string): UserProfile {
  if (role === 'student') return demoStudents.find((student) => student.id === userId) ?? demoStudents[0]
  if (role === 'parent') return demoParent
  return demoTeacher
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlatformState>(() => (runtime.demoMode ? loadDemoState() : emptyPlatformState()))
  const [loading, setLoading] = useState(!runtime.demoMode)
  const [authenticated, setAuthenticated] = useState(runtime.demoMode)
  const loadingRef = useRef(!runtime.demoMode)
  const authEpoch = useRef(0)
  const latestRefreshRequest = useRef(0)
  const lastBootstrapAt = useRef(0)
  const authRefresh = useRef<{ epoch: number; promise: Promise<void> } | null>(null)
  const [activeStudentId, setActiveStudentId] = useState<string | undefined>(() => {
    const user = runtime.demoMode ? loadDemoState().currentUser : undefined
    return user?.role === 'student' ? user.id : demoStudents[0].id
  })

  const refresh = useCallback(async (options: { showLoading?: boolean; rethrow?: boolean } = {}) => {
    if (runtime.demoMode) return Promise.resolve()
    const requestId = ++latestRefreshRequest.current
    const requestEpoch = authEpoch.current
    if (options.showLoading) {
      loadingRef.current = true
      setLoading(true)
    }
    try {
      const next = await invokeFunction<PlatformState>('bootstrap')
      if (requestEpoch === authEpoch.current && requestId === latestRefreshRequest.current) {
        setState(next)
        lastBootstrapAt.current = Date.now()
        setAuthenticated(true)
        setActiveStudentId((current) => {
          if (next.currentUser.role === 'student') return next.currentUser.id
          if (current && next.students.some((student) => student.id === current)) return current
          return next.students[0]?.id
        })
      }
    } catch (error) {
      const session = await supabase?.auth.getSession()
      if (requestEpoch === authEpoch.current && requestId === latestRefreshRequest.current) {
        setState(emptyPlatformState())
        setActiveStudentId(undefined)
        setAuthenticated(false)
        if (session?.data.session) console.error('加载平台数据失败', error)
      }
      if (options.rethrow) throw error
    } finally {
      if (options.showLoading && requestEpoch === authEpoch.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }, [])

  const refreshAfterSignIn = useCallback((showLoading = false) => {
    const epoch = authEpoch.current
    if (authRefresh.current?.epoch === epoch) return authRefresh.current.promise
    const promise = refresh({ showLoading, rethrow: true })
    authRefresh.current = { epoch, promise }
    void promise.catch(() => undefined)
    return promise
  }, [refresh])

  useEffect(() => {
    if (runtime.demoMode) return
    void refresh({ showLoading: true })
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        authEpoch.current += 1
        authRefresh.current = null
        setState(emptyPlatformState())
        setActiveStudentId(undefined)
        setAuthenticated(false)
        loadingRef.current = false
        setLoading(false)
      }
      if (event === 'SIGNED_IN') {
        authEpoch.current += 1
        authRefresh.current = null
        void refreshAfterSignIn(loadingRef.current).catch(() => undefined)
      }
    })
    return () => subscription?.data.subscription.unsubscribe()
  }, [refresh, refreshAfterSignIn])

  useEffect(() => {
    if (runtime.demoMode || !authenticated) return
    const refreshExpiringLinks = () => {
      if (Date.now() - lastBootstrapAt.current >= 45 * 60 * 1000) void refresh()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshExpiringLinks()
    }
    const interval = window.setInterval(refreshExpiringLinks, 10 * 60 * 1000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refreshExpiringLinks)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refreshExpiringLinks)
    }
  }, [authenticated, refresh])

  useEffect(() => {
    if (!runtime.demoMode) return
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state }))
  }, [state])

  const switchDemoUser = useCallback((role: Role, userId?: string) => {
    if (!runtime.demoMode) return
    const currentUser = defaultUserForRole(role, userId)
    setState((previous) => ({ ...previous, currentUser }))
    if (role === 'student') setActiveStudentId(currentUser.id)
    if (role === 'parent') setActiveStudentId('student-lin')
  }, [])

  const signIn = useCallback(async (username: string, password: string) => {
    if (runtime.demoMode) {
      const normalized = username.trim().toLowerCase()
      const account = state.accounts.find((item) => item.username.toLowerCase() === normalized)
      if (!account || !password) throw new Error('账号或密码不正确')
      setState((previous) => ({ ...previous, currentUser: account }))
      setAuthenticated(true)
      return
    }

    if (!supabase) throw new Error('Supabase 尚未配置')
    if (username.includes('@')) {
      const { error } = await supabase.auth.signInWithPassword({ email: username, password })
      if (error) throw error
    } else {
      const result = await invokeFunction<{ accessToken: string; refreshToken: string }>('username-login', {
        username,
        password,
      })
      const { error } = await supabase.auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      })
      if (error) throw error
    }
    await refreshAfterSignIn()
  }, [refreshAfterSignIn, state.accounts])

  const signOut = useCallback(async () => {
    if (runtime.demoMode) {
      setAuthenticated(false)
      return
    }
    await supabase?.auth.signOut()
  }, [])

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (!currentPassword) throw new Error('请输入当前密码')
    if (newPassword.length < 10) throw new Error('新密码至少 10 位')
    if (currentPassword === newPassword) throw new Error('新密码不能与当前密码相同')
    if (!runtime.demoMode && supabase) {
      await invokeFunction('account-admin', { action: 'change_password', currentPassword, newPassword })
      await refresh()
      return
    }
    setState((previous) => ({
      ...previous,
      currentUser: { ...previous.currentUser, mustChangePassword: false },
      accounts: previous.accounts.map((account) =>
        account.id === previous.currentUser.id ? { ...account, mustChangePassword: false } : account,
      ),
    }))
  }, [refresh])

  const createSubmission = useCallback(async (input: SubmissionInput, files: File[]) => {
    const submissionId = uniqueId('submission')
    const studentId = state.currentUser.role === 'student' ? state.currentUser.id : activeStudentId
    if (!studentId) throw new Error('未选择学生')

    if (!runtime.demoMode && supabase) {
      const { error: submissionError } = await supabase.from('submissions').insert({
        id: submissionId,
        student_id: studentId,
        mode: input.mode,
        subject: input.subject,
        title: input.title,
        assignment_date: input.assignmentDate,
        minutes_spent: input.minutesSpent,
        wrong_numbers: input.wrongNumbers,
        confidence: input.confidence,
        self_reflection: input.selfReflection,
        student_error_tags: input.studentErrorTags,
        status: 'uploaded',
      })
      if (submissionError) throw submissionError

      const uploadedPaths: string[] = []
      try {
        for (const [pageOrder, file] of files.entries()) {
          const attachmentId = uniqueId('attachment')
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const storagePath = `${studentId}/${submissionId}/${attachmentId}-${safeName}`
          const { error: uploadError } = await supabase.storage.from('submissions').upload(storagePath, file)
          if (uploadError) throw uploadError
          uploadedPaths.push(storagePath)
          const { error: attachmentError } = await supabase.from('submission_attachments').insert({
            id: attachmentId,
            submission_id: submissionId,
            student_id: studentId,
            file_name: file.name,
            mime_type: file.type,
            file_size: file.size,
            storage_path: storagePath,
            page_order: pageOrder,
          })
          if (attachmentError) throw attachmentError
        }
      } catch (error) {
        if (uploadedPaths.length) await supabase.storage.from('submissions').remove(uploadedPaths)
        await supabase.from('submissions').delete().eq('id', submissionId).eq('status', 'uploaded')
        throw error
      }
      await invokeFunction('analyze-submission', { submissionId })
      await refresh()
      return submissionId
    }

    const submission: Submission = {
      id: submissionId,
      studentId,
      ...input,
      submittedAt: new Date().toISOString(),
      status: state.settings.aiEnabled ? 'analyzing' : 'needs_review',
      attachments: files.map((file) => ({
        id: uniqueId('attachment'),
        name: file.name,
        mimeType: file.type,
        size: file.size,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      })),
    }
    setState((previous) => ({ ...previous, submissions: [submission, ...previous.submissions] }))

    if (state.settings.aiEnabled) {
      await new Promise((resolve) => window.setTimeout(resolve, 700))
      setState((previous) => ({
        ...previous,
        submissions: previous.submissions.map((item) =>
          item.id === submissionId ? { ...item, status: 'needs_review' } : item,
        ),
        analysisDrafts: [
          {
            id: uniqueId('draft'),
            submissionId,
            summary: '已识别提交内容，建议教师结合原图确认知识点与错因。',
            proposedTags: input.studentErrorTags.length ? input.studentErrorTags : ['modeling'],
            knowledgePoints: input.subject === 'math' ? ['待教师确认的数学知识点'] : ['待教师确认的学科知识点'],
            evidence: input.selfReflection ? [input.selfReflection] : ['学生未填写自我复盘'],
            confidence: 0.72,
            createdAt: new Date().toISOString(),
          },
          ...previous.analysisDrafts,
        ],
      }))
    }
    return submissionId
  }, [activeStudentId, refresh, state.currentUser, state.settings.aiEnabled])

  const approveSubmission = useCallback(async (
    submissionId: string,
    tags: ErrorTag[],
    teacherNote: string,
    confirmedWrongNumbers: string[] = [],
  ) => {
    const normalizedConfirmedWrongNumbers = [...new Set(confirmedWrongNumbers
      .map((value) => value.trim().slice(0, 40))
      .filter(Boolean))].slice(0, 50)
    if (!runtime.demoMode) {
      const submission = state.submissions.find((item) => item.id === submissionId)
      if (submission?.mode === 'wrong_item') {
        await invokeFunction('review-submission', {
          submissionId, action: 'archive_wrong_item', tags,
          teacherHint: '', teacherEvaluation: teacherNote,
        })
      } else {
        await invokeFunction('review-submission', {
          submissionId, action: 'approve', tags, teacherNote,
          confirmedWrongNumbers: normalizedConfirmedWrongNumbers,
        })
      }
      await refresh()
      return
    }
    setState((previous) => {
      const submission = previous.submissions.find((item) => item.id === submissionId)
      if (!submission) return previous
      const wrongNumbers = submission.mode === 'wrong_item'
        ? (submission.wrongNumbers.length ? submission.wrongNumbers : ['未标注'])
        : normalizedConfirmedWrongNumbers
      const newWrongItems = wrongNumbers.map((questionNumber) => ({
        id: uniqueId('wrong'),
        studentId: submission.studentId,
        submissionId,
        subject: submission.subject,
        questionNumber,
        title: `${submission.title} · 第${questionNumber}题`,
        knowledgePoints:
          previous.analysisDrafts.find((draft) => draft.submissionId === submissionId)?.knowledgePoints ?? [],
        errorTags: tags,
        evidenceState: 'teacher_verified' as const,
        teacherNote,
        occurredAt: submission.assignmentDate,
        recurrenceCount: 1,
        reviewStage: 0,
        nextReviewAt: nextReviewDate(new Date(), 0, false).dueAt,
        resolved: false,
      }))
      const newTasks = newWrongItems.map((item) => ({
        id: uniqueId('review'),
        studentId: item.studentId,
        wrongItemId: item.id,
        title: `复习：${item.title}`,
        dueAt: item.nextReviewAt!,
        stage: 0,
        status: 'due' as const,
      }))
      return {
        ...previous,
        submissions: previous.submissions.map((item) =>
          item.id === submissionId ? { ...item, status: wrongNumbers.length ? 'scheduled' : 'approved' } : item,
        ),
        wrongItems: [...newWrongItems, ...previous.wrongItems],
        reviewTasks: [...newTasks, ...previous.reviewTasks],
      }
    })
  }, [refresh, state.submissions])

  const gradeSubmission = useCallback(async (
    submissionId: string,
    feedback: string,
    questionComments: QuestionComment[],
    score?: number,
    maxScore?: number,
  ) => {
    if (!runtime.demoMode) {
      const submission = state.submissions.find((item) => item.id === submissionId)
      if (submission?.mode === 'wrong_item') {
        const hint = questionComments.map((item) => `第${item.questionNumber}题：${item.comment}`).join('\n')
        await invokeFunction('review-submission', {
          submissionId, action: 'wrong_item_feedback', teacherHint: hint, teacherEvaluation: feedback,
        })
      } else {
        await invokeFunction('review-submission', {
          submissionId, action: 'grade', feedback, questionComments,
          score: score ?? null, maxScore: maxScore ?? null,
        })
      }
      await refresh()
      return
    }
    setState((previous) => ({
      ...previous,
      submissions: previous.submissions.map((submission) => {
        if (submission.id !== submissionId) return submission
        const hint = questionComments.map((item) => `第${item.questionNumber}题：${item.comment}`).join('\n')
        return submission.mode === 'wrong_item' ? {
          ...submission,
          teacherHint: hint || submission.teacherHint,
          teacherEvaluation: feedback || submission.teacherEvaluation,
          teacherFeedback: feedback || hint || submission.teacherFeedback,
          questionComments,
          gradedAt: new Date().toISOString(),
        } : {
          ...submission, teacherFeedback: feedback, questionComments, teacherScore: score,
          maxScore, gradedAt: new Date().toISOString(),
        }
      }),
    }))
  }, [refresh, state.submissions])

  const saveDailyEvaluation = useCallback(async (
    studentId: string,
    date: string,
    summary: string,
    highlights: string[],
    improvements: string[],
    subject?: Subject,
  ) => {
    if (!runtime.demoMode) {
      await invokeFunction('teacher-content', { action: 'evaluation_upsert', studentId, date, subject, summary, highlights, improvements })
      await refresh()
      return
    }
    setState((previous) => {
      const current = previous.dailyEvaluations.find((item) => item.studentId === studentId && item.date === date && item.subject === subject)
      const evaluation = { id: current?.id ?? uniqueId('evaluation'), studentId, date, subject, summary, highlights, improvements, createdAt: new Date().toISOString() }
      return { ...previous, dailyEvaluations: current ? previous.dailyEvaluations.map((item) => item.id === current.id ? evaluation : item) : [evaluation, ...previous.dailyEvaluations] }
    })
  }, [refresh])

  const createLearningResource = useCallback(async (
    input: { studentIds: string[]; subject: Subject; topic: string; title: string; resourceType: LearningResourceType; description?: string; body?: string },
    files: File[],
  ) => {
    if (!runtime.demoMode && supabase) {
      let searchableBody = input.body?.trim() ?? ''
      if (!searchableBody && files.length === 1) {
        const file = files[0]
        const lowerName = file.name.toLowerCase()
        if (file.type === 'text/markdown' || lowerName.endsWith('.md')) {
          searchableBody = (await file.text()).trim().slice(0, 100000)
        } else if (file.type === 'text/html' || lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
          const source = await file.text()
          searchableBody = (new DOMParser().parseFromString(source, 'text/html').body.textContent ?? '')
            .replace(/\s+/g, ' ').trim().slice(0, 100000)
        }
      }
      const result = await invokeFunction<{ material: { id: string } }>('teacher-content', {
        action: 'material_create', ...input, body: searchableBody, published: false,
      })
      const materialId = result.material.id
      for (const file of files) {
        const fileId = crypto.randomUUID()
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const storagePath = `${materialId}/${fileId}-${safeName}`
        const { error: uploadError } = await supabase.storage.from('materials').upload(storagePath, file)
        if (uploadError) throw uploadError
        const { error: fileError } = await supabase.from('learning_material_files').insert({
          id: fileId, material_id: materialId, file_name: file.name, mime_type: file.type || 'application/octet-stream',
          file_size: file.size, storage_path: storagePath,
        })
        if (fileError) throw fileError
      }
      await invokeFunction('teacher-content', { action: 'material_publish', materialId, studentIds: input.studentIds, published: true })
      await refresh()
      return
    }
    const createdAt = new Date().toISOString()
    setState((previous) => ({
      ...previous,
      learningResources: [...input.studentIds.flatMap((studentId) => ({
        id: uniqueId('resource'), studentId, subject: input.subject, topic: input.topic,
        title: input.title, resourceType: input.resourceType, description: input.description, body: input.body,
        attachments: files.map((file) => ({ id: uniqueId('resource-file'), name: file.name, mimeType: file.type, size: file.size })),
        createdAt, publishedAt: createdAt,
      })), ...previous.learningResources],
    }))
  }, [refresh])

  const rejectSubmission = useCallback(async (submissionId: string, reason: string) => {
    if (!runtime.demoMode) {
      await invokeFunction('review-submission', { submissionId, action: 'reject', reason })
      await refresh()
      return
    }
    setState((previous) => ({
      ...previous,
      submissions: previous.submissions.map((item) =>
        item.id === submissionId ? { ...item, status: 'rejected', failureReason: reason } : item,
      ),
    }))
  }, [refresh])

  const completeReview = useCallback(async (taskId: string, passed: boolean) => {
    if (!runtime.demoMode) {
      await invokeFunction('complete-review', { taskId, passed })
      await refresh()
      return
    }
    setState((previous) => {
      const task = previous.reviewTasks.find((item) => item.id === taskId)
      if (!task) return previous
      const schedule = nextReviewDate(new Date(), task.stage, passed)
      return {
        ...previous,
        reviewTasks: previous.reviewTasks.map((item) =>
          item.id === taskId ? { ...item, status: 'completed' } : item,
        ),
        wrongItems: previous.wrongItems.map((item) =>
          item.id === task.wrongItemId
            ? {
                ...item,
                reviewStage: schedule.nextStage,
                nextReviewAt: schedule.dueAt,
                resolved: passed && schedule.nextStage === 3,
              }
            : item,
        ),
      }
    })
  }, [refresh])

  const sendMessage = useCallback(async (studentId: string, body: string) => {
    if (!body.trim()) return
    if (!runtime.demoMode && supabase) {
      const { error } = await supabase.from('messages').insert({
        student_id: studentId,
        sender_role: state.currentUser.role,
        body: body.trim(),
      })
      if (error) throw error
      await refresh()
      return
    }
    setState((previous) => ({
      ...previous,
      messages: [
        ...previous.messages,
        {
          id: uniqueId('message'),
          studentId,
          senderRole: previous.currentUser.role === 'teacher' ? 'teacher' : 'student',
          body: body.trim(),
          createdAt: new Date().toISOString(),
          read: false,
        },
      ],
    }))
  }, [refresh, state.currentUser.role])

  const markMessagesRead = useCallback(async (studentId: string) => {
    if (!runtime.demoMode && supabase) {
      const { error } = await supabase.from('messages').update({ read: true }).eq('student_id', studentId).eq('sender_role', 'student')
      if (error) throw error
      setState((previous) => ({
        ...previous,
        messages: previous.messages.map((message) =>
          message.studentId === studentId && message.senderRole === 'student' ? { ...message, read: true } : message,
        ),
      }))
      return
    }
    setState((previous) => ({
      ...previous,
      messages: previous.messages.map((message) =>
        message.studentId === studentId && message.senderRole === 'student' ? { ...message, read: true } : message,
      ),
    }))
  }, [])

  const sendTutorMessage = useCallback(async (
    body: string,
    level: HintLevel,
    attempt?: string,
    subject?: Subject,
    image?: TutorImageInput,
  ) => {
    const studentId = state.currentUser.role === 'student' ? state.currentUser.id : activeStudentId
    const message = body.trim() || (image ? '请分析这张题目图片' : '')
    if (!studentId || !message) return
    const studentTurn: TutorTurn = {
      id: uniqueId('turn'),
      studentId,
      role: 'student',
      body: message,
      createdAt: new Date().toISOString(),
    }

    if (!runtime.demoMode) {
      const response = await invokeFunction<TutorTurn & { studentTurnId: string }>('tutor-chat', {
        message,
        hintLevel: level,
        answerMode: level === 'key_step' ? 'steps' : level,
        attempt,
        subject,
        image,
      })
      setState((previous) => ({
        ...previous,
        tutorTurns: [...previous.tutorTurns, { ...studentTurn, id: response.studentTurnId }, response],
      }))
      return
    }

    setState((previous) => ({ ...previous, tutorTurns: [...previous.tutorTurns, studentTurn] }))
    await new Promise((resolve) => window.setTimeout(resolve, 500))
    const lower = message.toLowerCase()
    const relatedDocuments = state.knowledgeDocuments.filter(
      (document) =>
        document.studentId === studentId &&
        (!subject || document.subject === subject) &&
        document.active &&
        canUseKnowledgeSource(document.visibility, 'student', level, Boolean(attempt?.trim())),
    ).slice(0, 2)
    const relatedWrong = state.wrongItems.find((item) => item.studentId === studentId && (!subject || item.subject === subject) && !item.resolved)
    const citations = [
      ...relatedDocuments.map((document) => ({
        id: document.id,
        label: document.title,
        sourceType: document.documentType === 'solution' ? 'solution' as const : document.documentType === 'exercise' ? 'exercise' as const : 'lecture' as const,
        section: document.documentType === 'solution' ? '经尝试后开放的完整解析' : '与当前问题匹配的方法',
        excerpt: document.relativePath,
        visibility: document.visibility,
      })),
      ...(relatedWrong
        ? [{ id: relatedWrong.id, label: `错题 ${relatedWrong.questionNumber} · ${relatedWrong.title}`, sourceType: 'wrong_item' as const, section: relatedWrong.teacherNote, visibility: 'student_visible' as const }]
        : []),
    ]
    let responseBody = '我先确认你的卡点：你现在是没有想到第一步，还是已经列式但无法继续？请把已经完成的步骤发给我。'
    if (level === 'hint') {
      responseBody = lower.includes('切线')
        ? '先检查已知点是否在曲线上，再决定能否直接使用切线公式。把点代入原方程，左右两边是否相等？'
        : '先把题目中的已知量、目标量和限制条件分别写出来。你只需要告诉我：最先能使用哪一个定义或公式？'
    }
    if (level === 'key_step') {
      responseBody = '关键步骤是把几何条件翻译成代数关系，再检查定义域或判别式。请先完成联立，不要急着展开；写出二次方程的三个系数后我再帮你核对。'
    }
    if (level === 'solution') {
      responseBody = attempt?.trim()
        ? '根据你的尝试，完整处理顺序应是：① 写出对象的标准方程；② 设直线并联立；③ 用判别式保证相交；④ 用韦达关系代替直接求根；⑤ 回到题目目标量并检查取值范围。你原来的第二步是对的，主要遗漏在第③步。'
        : '完整解答需要先看到你的尝试。请至少提交一个公式、一个设元或你卡住的具体步骤，我再继续。'
    }
    const assistantTurn: TutorTurn = {
      id: uniqueId('turn'),
      studentId,
      role: 'assistant',
      body: responseBody,
      createdAt: new Date().toISOString(),
      hintLevel: level,
      citations,
      usedGeneralKnowledge: citations.length === 0,
    }
    setState((previous) => ({ ...previous, tutorTurns: [...previous.tutorTurns, assistantTurn] }))
  }, [activeStudentId, state.currentUser, state.knowledgeDocuments, state.wrongItems])

  const saveReport = useCallback(async (report: WeeklyReport) => {
    if (!runtime.demoMode) {
      await invokeFunction('weekly-report', { action: 'save', report })
      await refresh()
      return
    }
    setState((previous) => ({
      ...previous,
      reports: previous.reports.some((item) => item.id === report.id)
        ? previous.reports.map((item) => (item.id === report.id ? report : item))
        : [report, ...previous.reports],
    }))
  }, [refresh])

  const generateReportDraft = useCallback(async (studentId: string): Promise<WeeklyReport> => {
    if (!runtime.demoMode) {
      return invokeFunction<WeeklyReport>('weekly-report', { action: 'draft', studentId })
    }
    const student = state.students.find((item) => item.id === studentId)
    const verified = state.wrongItems.filter((item) => item.studentId === studentId && item.evidenceState === 'teacher_verified')
    const open = verified.filter((item) => !item.resolved)
    const completed = state.reviewTasks.filter((item) => item.studentId === studentId && item.status === 'completed')
    const evaluations = state.dailyEvaluations.filter((item) => item.studentId === studentId)
    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    return {
      id: uniqueId('report'),
      studentId,
      periodStart: localDateKey(start),
      periodEnd: localDateKey(end),
      title: '本周学习周报',
      summary: evaluations[0]?.summary ?? `${student?.displayName ?? '学生'}本周提交与复习记录已汇总，以下内容仅基于教师确认的学习证据。`,
      progress: [...(evaluations[0]?.highlights ?? []), ...(completed.length ? [`按计划完成 ${completed.length} 次错题复习`] : [])].slice(0, 4),
      concerns: [...(evaluations[0]?.improvements ?? []), ...open.slice(0, 3).map((item) => `${item.title}：${item.teacherNote}`)].slice(0, 4),
      nextActions: open.slice(0, 3).map((item) => `继续巩固${item.knowledgePoints[0] ?? item.title}`),
      status: 'draft',
    }
  }, [state.dailyEvaluations, state.reviewTasks, state.students, state.wrongItems])

  const publishReport = useCallback(async (reportId: string) => {
    if (!runtime.demoMode) {
      await invokeFunction('weekly-report', { action: 'publish', reportId })
      await refresh()
      return
    }
    setState((previous) => ({
      ...previous,
      reports: previous.reports.map((report) =>
        report.id === reportId ? { ...report, status: 'published', publishedAt: new Date().toISOString() } : report,
      ),
    }))
  }, [refresh])

  const updateSettings = useCallback(async (settings: PlatformState['settings']) => {
    if (!runtime.demoMode) {
      await invokeFunction('settings', settings)
      await refresh()
      return
    }
    setState((previous) => ({ ...previous, settings }))
  }, [refresh])

  const createAccount = useCallback(async (
    account: NewAccountInput,
    temporaryPassword: string,
  ) => {
    if (!runtime.demoMode) {
      await invokeFunction('account-admin', { action: 'create', account, temporaryPassword })
      await refresh()
      return
    }
    const accountId = uniqueId('account')
    setState((previous) => ({
      ...previous,
      accounts: [...previous.accounts, { ...account, id: accountId }],
      students: account.role === 'student'
        ? [...previous.students, {
            id: accountId,
            role: 'student',
            displayName: account.displayName,
            username: account.username,
            avatarColor: account.avatarColor,
            grade: account.grade || '待填写',
            subjects: account.subjects?.length ? account.subjects : ['math'],
            targetScore: account.targetScore,
            guardianConsentAt: account.guardianConsentAt,
          }]
        : previous.students,
    }))
  }, [refresh])

  const manageAccount = useCallback(async (
    accountId: string,
    action: 'reset_password' | 'set_status',
    value: string,
  ) => {
    if (!runtime.demoMode) {
      await invokeFunction('account-admin', { action, accountId, value })
      await refresh()
      return
    }
    if (action === 'set_status') {
      setState((previous) => ({
        ...previous,
        accounts: previous.accounts.map((account) =>
          account.id === accountId ? { ...account, status: value as 'active' | 'disabled' } : account,
        ),
      }))
    }
  }, [refresh])

  const createSyncToken = useCallback(async (label: string, operation: 'knowledge' | 'question_bank', studentIds: string[], subjects: Subject[]) => {
    if (!runtime.demoMode) {
      const result = await invokeFunction<{ token: string; tokenId: string }>('account-admin', {
        action: 'create_sync_token',
        label, operation, studentIds, subjects,
      })
      await refresh()
      return result
    }
    const tokenId = uniqueId('sync-token')
    setState((previous) => ({
      ...previous,
      syncTokens: [{ id: tokenId, label, operation, studentIds, subjects, createdAt: new Date().toISOString() }, ...previous.syncTokens],
    }))
    return { token: `demo_sync_${crypto.randomUUID().replaceAll('-', '')}`, tokenId }
  }, [refresh])

  const revokeSyncToken = useCallback(async (tokenId: string) => {
    if (!runtime.demoMode) {
      await invokeFunction('account-admin', { action: 'revoke_sync_token', tokenId })
      await refresh()
      return
    }
    setState((previous) => ({ ...previous, syncTokens: previous.syncTokens.filter((token) => token.id !== tokenId) }))
  }, [refresh])

  const exportStudentMemory = useCallback(async (studentId: string) => {
    if (!runtime.demoMode) {
      const result = await invokeFunction<{ students: Array<{ displayName: string; markdown: string }> }>('export-memory', {
        studentIds: [studentId],
      })
      const exported = result.students[0]
      if (!exported) throw new Error('没有可导出的已确认学情')
      return { fileName: `${exported.displayName}-网站学情.md`, markdown: exported.markdown }
    }
    const student = state.students.find((item) => item.id === studentId)
    const wrongItems = state.wrongItems.filter((item) => item.studentId === studentId && item.evidenceState === 'teacher_verified')
    const evaluations = state.dailyEvaluations.filter((item) => item.studentId === studentId).sort((left, right) => right.date.localeCompare(left.date))
    const markdown = [
      `# ${student?.displayName ?? '学生'}｜网站学情增量`,
      '',
      `- 导出时间：${new Date().toISOString()}`,
      '- 数据口径：仅包含教师确认记录。',
      '',
      '## 已确认错题',
      '',
      ...(wrongItems.length ? wrongItems.map((item) => `- ${item.title}｜${item.knowledgePoints.join('、')}｜${item.teacherNote}`) : ['- 暂无新增记录']),
      '',
      '## 教师每日评价',
      '',
      ...(evaluations.length ? evaluations.map((item) => `- ${item.date}｜${item.subject ?? '综合'}｜${item.summary}${item.improvements.length ? `｜下一步：${item.improvements.join('；')}` : ''}`) : ['- 暂无评价记录']),
    ].join('\n')
    return { fileName: `${student?.displayName ?? '学生'}-网站学情.md`, markdown }
  }, [state.dailyEvaluations, state.students, state.wrongItems])

  const requestStudentDeletion = useCallback(async (studentId: string, reason: string) => {
    if (!runtime.demoMode) {
      const result = await invokeFunction<{ requestId: string }>('account-admin', {
        action: 'request_data_deletion', studentId, reason,
      })
      return result.requestId
    }
    return uniqueId('deletion-request')
  }, [])

  const deleteStudentData = useCallback(async (studentId: string, requestId: string, confirmation: string) => {
    if (!runtime.demoMode) {
      await invokeFunction('account-admin', {
        action: 'delete_student_data', studentId, requestId, confirmation,
      })
      await refresh()
      return
    }
    setState((previous) => ({
      ...previous,
      students: previous.students.filter((student) => student.id !== studentId),
      accounts: previous.accounts.filter((account) => account.id !== studentId).map((account) => ({
        ...account,
        linkedStudentIds: account.linkedStudentIds.filter((id) => id !== studentId),
      })),
      submissions: previous.submissions.filter((item) => item.studentId !== studentId),
      analysisDrafts: previous.analysisDrafts.filter((draft) => !previous.submissions.some((item) => item.studentId === studentId && item.id === draft.submissionId)),
      wrongItems: previous.wrongItems.filter((item) => item.studentId !== studentId),
      reviewTasks: previous.reviewTasks.filter((item) => item.studentId !== studentId),
      messages: previous.messages.filter((item) => item.studentId !== studentId),
      tutorTurns: previous.tutorTurns.filter((item) => item.studentId !== studentId),
      reports: previous.reports.filter((item) => item.studentId !== studentId),
      knowledgeDocuments: previous.knowledgeDocuments.filter((item) => item.studentId !== studentId),
    }))
    setActiveStudentId((current) => current === studentId ? undefined : current)
  }, [refresh])

  const resetDemo = useCallback(() => {
    const next = cloneDemoState()
    localStorage.removeItem(STORAGE_KEY)
    setState(next)
    setActiveStudentId(next.students[0].id)
  }, [])

  const activeStudent = state.students.find((student) => student.id === activeStudentId)
  const value = useMemo<PlatformContextValue>(() => ({
    state,
    demoMode: runtime.demoMode,
    loading,
    authenticated,
    activeStudentId,
    activeStudent,
    setActiveStudentId,
    switchDemoUser,
    signIn,
    signOut,
    changePassword,
    createSubmission,
    approveSubmission,
    gradeSubmission,
    rejectSubmission,
    saveDailyEvaluation,
    createLearningResource,
    completeReview,
    sendMessage,
    markMessagesRead,
    sendTutorMessage,
    generateReportDraft,
    saveReport,
    publishReport,
    updateSettings,
    createAccount,
    manageAccount,
    createSyncToken,
    revokeSyncToken,
    exportStudentMemory,
    requestStudentDeletion,
    deleteStudentData,
    resetDemo,
    refresh,
  }), [
    state,
    loading,
    authenticated,
    activeStudentId,
    activeStudent,
    switchDemoUser,
    signIn,
    signOut,
    changePassword,
    createSubmission,
    approveSubmission,
    gradeSubmission,
    rejectSubmission,
    saveDailyEvaluation,
    createLearningResource,
    completeReview,
    sendMessage,
    markMessagesRead,
    sendTutorMessage,
    generateReportDraft,
    saveReport,
    publishReport,
    updateSettings,
    createAccount,
    manageAccount,
    createSyncToken,
    revokeSyncToken,
    exportStudentMemory,
    requestStudentDeletion,
    deleteStudentData,
    resetDemo,
    refresh,
  ])

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
}

export function usePlatform() {
  const value = useContext(PlatformContext)
  if (!value) throw new Error('usePlatform 必须在 PlatformProvider 中使用')
  return value
}
