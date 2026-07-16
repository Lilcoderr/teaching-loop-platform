export type Role = 'teacher' | 'student' | 'parent'
export type Subject = 'math' | 'physics' | 'chemistry'
export type UploadMode = 'assignment' | 'wrong_item'
export type SubmissionStatus =
  | 'uploaded'
  | 'analyzing'
  | 'needs_review'
  | 'approved'
  | 'rejected'
  | 'scheduled'
  | 'failed'
export type EvidenceState = 'self_reported' | 'ai_inferred' | 'teacher_verified'
export type KnowledgeVisibility = 'student_visible' | 'solution_gated' | 'teacher_only'
export type HintLevel = 'diagnose' | 'hint' | 'key_step' | 'solution'
export type ErrorTag =
  | 'concept'
  | 'reading'
  | 'modeling'
  | 'calculation'
  | 'writing'
  | 'speed'
  | 'avoidance'

export interface UserProfile {
  id: string
  role: Role
  displayName: string
  username: string
  avatarColor: string
  mustChangePassword?: boolean
}

export interface StudentProfile extends UserProfile {
  role: 'student'
  grade: string
  subjects: Subject[]
  targetScore?: number
  guardianConsentAt?: string
}

export interface AccountRecord extends UserProfile {
  status: 'active' | 'disabled'
  linkedStudentIds: string[]
  lastActiveAt?: string
}

export interface Attachment {
  id: string
  name: string
  mimeType: string
  size: number
  storagePath?: string
  previewUrl?: string
}

export interface Submission {
  id: string
  studentId: string
  mode: UploadMode
  subject: Subject
  title: string
  submittedAt: string
  assignmentDate: string
  minutesSpent?: number
  wrongNumbers: string[]
  confidence?: number
  selfReflection?: string
  studentErrorTags: ErrorTag[]
  status: SubmissionStatus
  attachments: Attachment[]
  failureReason?: string
  teacherFeedback?: string
  teacherScore?: number
  maxScore?: number
  questionComments?: QuestionComment[]
  gradedAt?: string
  teacherHint?: string
  teacherEvaluation?: string
  teacherRespondedAt?: string
  archivedToWrongBook?: boolean
  archivedAt?: string
  wrongItemIds?: string[]
}

export interface QuestionComment {
  questionNumber: string
  comment: string
  score?: number
  maxScore?: number
}

export interface AnalysisDraft {
  id: string
  submissionId: string
  summary: string
  questionText?: string
  proposedTags: ErrorTag[]
  knowledgePoints: string[]
  evidence: string[]
  confidence: number
  createdAt: string
  gradingSummary?: string
  proposedScore?: number
  maxScore?: number
  questionComments?: QuestionComment[]
}

export interface DailyEvaluation {
  id: string
  studentId: string
  date: string
  subject?: Subject
  summary: string
  highlights: string[]
  improvements: string[]
  createdAt: string
  updatedAt?: string
}

export interface WrongItem {
  id: string
  studentId: string
  submissionId: string
  subject: Subject
  questionNumber: string
  title: string
  knowledgePoints: string[]
  errorTags: ErrorTag[]
  evidenceState: EvidenceState
  teacherNote: string
  questionText?: string
  occurredAt: string
  recurrenceCount: number
  reviewStage: number
  nextReviewAt?: string
  resolved: boolean
}

export interface ReviewTask {
  id: string
  studentId: string
  wrongItemId: string
  title: string
  dueAt: string
  stage: number
  status: 'due' | 'completed' | 'missed'
}

export interface Message {
  id: string
  studentId: string
  senderRole: 'student' | 'teacher'
  body: string
  createdAt: string
  read: boolean
}

export interface Citation {
  id: string
  label: string
  sourceType: 'lecture' | 'exercise' | 'solution' | 'wrong_item'
  section?: string
  excerpt?: string
  visibility: KnowledgeVisibility
}

export interface TutorTurn {
  id: string
  studentId: string
  role: 'student' | 'assistant'
  body: string
  createdAt: string
  hintLevel?: HintLevel
  citations?: Citation[]
  usedGeneralKnowledge?: boolean
}

export interface WeeklyReport {
  id: string
  studentId: string
  periodStart: string
  periodEnd: string
  title: string
  summary: string
  progress: string[]
  concerns: string[]
  nextActions: string[]
  status: 'draft' | 'published'
  publishedAt?: string
}

export interface KnowledgeDocument {
  id: string
  studentId?: string
  subject: Subject
  title: string
  documentType: 'lecture' | 'exercise' | 'solution' | 'lesson_plan'
  visibility: KnowledgeVisibility
  relativePath: string
  version: number
  contentHash: string
  active: boolean
  indexedAt: string
  chunkCount: number
}

export type LearningResourceType = 'lecture' | 'assignment' | 'supplement' | 'method'

export interface LearningResource {
  id: string
  studentId: string
  studentIds?: string[]
  subject: Subject
  topic: string
  title: string
  resourceType: LearningResourceType
  description?: string
  body?: string
  attachments: Attachment[]
  publishedAt?: string
  createdAt: string
}

export interface SyncRun {
  id: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'succeeded' | 'failed'
  added: number
  updated: number
  unchanged: number
  deactivated: number
  message?: string
}

export interface SyncTokenRecord {
  id: string
  label: string
  operation: 'knowledge' | 'question_bank'
  studentIds: string[]
  subjects: Subject[]
  createdAt: string
  lastUsedAt?: string
  expiresAt?: string
}

export interface QuestionBankItem {
  id: string
  subject: Subject
  topic: string
  paperName: string
  questionNumber: string
  sourcePath: string
  questionPage: number
  answerPage: number
  knowledgePoints: string[]
  difficulty: '基础' | '中等' | '中等偏上' | '困难'
  verificationStatus: 'verified' | 'pending'
}

export interface AppSettings {
  aiEnabled: boolean
  textProvider: string
  visionProvider: string
  embeddingProvider: string
  textModel: string
  visionModel: string
  embeddingModel: string
  textModelConfigured: boolean
  visionModelConfigured: boolean
  embeddingModelConfigured: boolean
  dailyStudentMessageLimit: number
  maxUploadMb: number
}

export interface PlatformState {
  currentUser: UserProfile
  students: StudentProfile[]
  accounts: AccountRecord[]
  submissions: Submission[]
  analysisDrafts: AnalysisDraft[]
  dailyEvaluations: DailyEvaluation[]
  wrongItems: WrongItem[]
  reviewTasks: ReviewTask[]
  messages: Message[]
  tutorTurns: TutorTurn[]
  reports: WeeklyReport[]
  knowledgeDocuments: KnowledgeDocument[]
  learningResources: LearningResource[]
  questionBankItems: QuestionBankItem[]
  syncTokens: SyncTokenRecord[]
  syncRuns: SyncRun[]
  settings: AppSettings
}
