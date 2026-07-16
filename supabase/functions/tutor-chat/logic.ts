export type AnswerMode = 'diagnose' | 'hint' | 'steps' | 'solution'
export type StoredHintLevel = 'diagnose' | 'hint' | 'key_step' | 'solution'
export type TutorSubject = 'math' | 'physics' | 'chemistry'

export const MAX_TUTOR_IMAGE_BYTES = 4 * 1024 * 1024

const MODE_TO_LEVEL: Record<AnswerMode, StoredHintLevel> = {
  diagnose: 'diagnose',
  hint: 'hint',
  steps: 'key_step',
  solution: 'solution',
}

const LEGACY_LEVEL_TO_MODE: Record<StoredHintLevel, AnswerMode> = {
  diagnose: 'diagnose',
  hint: 'hint',
  key_step: 'steps',
  solution: 'solution',
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface TutorImage {
  dataUrl: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  name: string
  size: number
}

export interface KnowledgeChunkCandidate {
  score?: number | string | null
  title?: string | null
  heading?: string | null
  content?: string | null
}

export interface WrongItemCandidate {
  title?: string | null
  question_text?: string | null
  knowledge_points?: unknown
  teacher_note?: string | null
}

export type TutorSourceAnchorType = 'lecture' | 'exercise' | 'solution' | 'method' | 'wrong_item'

export interface TutorSourceAnchorCandidate {
  id: string
  labels: unknown[]
  sourceType: TutorSourceAnchorType
}

export interface TutorSourceAnchor {
  id: string
  label: string
  sourceType: TutorSourceAnchorType
}

export interface TutorCitationMetadata {
  label: string
  section: string
}

const SAFE_ANCHOR_ID = /^[kmw][1-9][0-9]?$/
const SOURCE_RESULT_OPERATOR = /(?:=|≈|≠|≤|≥|<|>|∈|∉|\\(?:leq?|geq?|neq|approx|in|notin)\b|(?:不大于|不小于|大于|小于|至少|至多)\s*(?:[-+]?\d|[零〇一二两三四五六七八九十百千万]))/i
const SOURCE_OPTION_RESULT = /(?:(?:正确|最终)?(?:答案|选项)|正确项|本题|保留|故|应选|选择|选|取).{0,12}?(?:[A-D]\s*项?|第\s*[一二三四1-4]\s*项)|(?:[A-D]\s*项?|第\s*[一二三四1-4]\s*项).{0,8}(?:正确|符合|应选)/i
const SOURCE_NUMERIC_RANGE = /[\[({｛（【]\s*[\[({｛（【]?\s*[-+]?\d+(?:\.\d+)?\s*[,，]\s*[-+]?\d+(?:\.\d+)?/i
const SOURCE_NUMERIC_CONCLUSION = /(?:答案|结果|结论|参数(?:范围)?|取值范围|范围|半径|直径|斜率|根|解集|最值).{0,12}(?:锁定在|确定(?:为|是)?|应取|取|等于|为|是|[:：]|\s)\s*(?:[正负]?[-+]?\d|[正负]?[零〇一二两三四五六七八九十百千万]|[A-D]\s*项|[\[({｛（【]|π|√|任意实数|全体实数|无穷|\\(?:frac|sqrt))/i
const SOURCE_VARIABLE_CONCLUSION = /(?:^|[\s，。；：:])(?:[A-Za-z][A-Za-z0-9_]*|[\u3400-\u9fff]{1,8})\s*(?:应取|取|等于|为|是|大于|小于|不大于|不小于)\s*(?:[正负]?[-+]?\d|[正负]?[零〇一二两三四五六七八九十百千万]|[A-D](?:\s*项)?|\\(?:frac|sqrt))/i
const SOURCE_ORDINAL_RESULT = /(?:唯一|符合条件|正确).{0,12}(?:第\s*[一二三四1-4]\s*(?:项|个)|[A-D]\s*项?)/i
const SOURCE_EXPLICIT_SOLUTION = /(?:解得|求得|算得|故选|应选|最终(?:答案|结果|结论)|\\boxed)/i
const SOURCE_MATH_RESULT = /\\(?:boxed|frac|sqrt)\s*\{?\s*[-+]?\d/i
const SOURCE_BARE_RESULT = /^\s*(?:[-+]?\d+(?:\.\d+)?|[A-D]\s*项?|√\s*\d+|\\(?:sqrt|frac)\s*\{[^}]+\})\s*$/i
const SOURCE_PROMPT_INJECTION = /(?:忽略.{0,20}(?:规则|指令|提示)|系统提示|api\s*key|密钥|内部路径|其他学生|https?:\/\/)/i

export function sanitizeTutorSourceLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const inspected = normalized
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/[`*_#|$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  if (inspected.length < 2) return null
  if (
    SOURCE_RESULT_OPERATOR.test(inspected)
    || SOURCE_OPTION_RESULT.test(inspected)
    || SOURCE_NUMERIC_RANGE.test(inspected)
    || SOURCE_NUMERIC_CONCLUSION.test(inspected)
    || SOURCE_VARIABLE_CONCLUSION.test(inspected)
    || SOURCE_ORDINAL_RESULT.test(inspected)
    || SOURCE_EXPLICIT_SOLUTION.test(inspected)
    || SOURCE_MATH_RESULT.test(inspected)
    || SOURCE_BARE_RESULT.test(inspected)
    || SOURCE_PROMPT_INJECTION.test(inspected)
  ) return null
  const plain = inspected.replace(/[\[\]{}<>]/g, ' ').replace(/\s+/g, ' ').trim()
  if (plain.length < 2) return null
  return plain
}

export function safeTutorCitationMetadata(
  label: unknown,
  section: unknown,
  fallbackLabel: string,
  fallbackSection: string,
): TutorCitationMetadata {
  return {
    label: sanitizeTutorSourceLabel(label) ?? fallbackLabel,
    section: sanitizeTutorSourceLabel(section) ?? fallbackSection,
  }
}

export function tutorCitationMetadata(
  level: StoredHintLevel,
  label: unknown,
  section: unknown,
  fallbackLabel: string,
  fallbackSection: string,
): TutorCitationMetadata {
  if (level !== 'solution') {
    return { label: fallbackLabel, section: fallbackSection }
  }
  return {
    label: typeof label === 'string' && label.trim() ? label.trim() : fallbackLabel,
    section: typeof section === 'string' && section.trim() ? section.trim() : fallbackSection,
  }
}

export function buildSafeSourceAnchors(
  candidates: TutorSourceAnchorCandidate[],
  limit = 8,
): TutorSourceAnchor[] {
  const anchors: TutorSourceAnchor[] = []
  const ids = new Set<string>()
  const typeCounts = new Map<TutorSourceAnchorType, number>()
  const typeLabels: Record<TutorSourceAnchorType, string> = {
    lecture: '讲义方法',
    exercise: '练习资料',
    solution: '解析资料',
    method: '方法技巧',
    wrong_item: '已确认错题',
  }
  for (const candidate of candidates) {
    if (anchors.length >= Math.min(Math.max(limit, 0), 12)) break
    if (!SAFE_ANCHOR_ID.test(candidate.id) || ids.has(candidate.id)) continue
    if (!(candidate.sourceType in typeLabels)) continue
    const ordinal = (typeCounts.get(candidate.sourceType) ?? 0) + 1
    typeCounts.set(candidate.sourceType, ordinal)
    ids.add(candidate.id)
    anchors.push({ id: candidate.id, label: `${typeLabels[candidate.sourceType]} ${ordinal}`, sourceType: candidate.sourceType })
  }
  return anchors
}

export function buildTutorRetrievalPromptBlock(
  level: StoredHintLevel,
  anchors: TutorSourceAnchor[],
  fullContextLines: string[],
): string {
  if (level === 'solution') {
    return [
      '<authorized_retrieval_context>',
      fullContextLines.join('\n\n') || '无可靠匹配资料',
      '</authorized_retrieval_context>',
    ].join('\n')
  }
  return [
    '<authorized_retrieval_metadata>',
    anchors.map((anchor) => `[${anchor.id}] ${anchor.sourceType}: ${anchor.label}`).join('\n') || '无可靠匹配资料元数据',
    '</authorized_retrieval_metadata>',
    '<untrusted_authorized_retrieval_context>',
    fullContextLines.join('\n\n') || '无可靠匹配资料',
    '</untrusted_authorized_retrieval_context>',
  ].join('\n')
}

export function resolveAnswerMode(answerMode: unknown, legacyHintLevel: unknown): {
  answerMode: AnswerMode
  hintLevel: StoredHintLevel
} | null {
  if (typeof answerMode === 'string' && answerMode in MODE_TO_LEVEL) {
    const mode = answerMode as AnswerMode
    return { answerMode: mode, hintLevel: MODE_TO_LEVEL[mode] }
  }
  if (answerMode !== undefined && answerMode !== null && answerMode !== '') return null
  if (typeof legacyHintLevel === 'string' && legacyHintLevel in LEGACY_LEVEL_TO_MODE) {
    const level = legacyHintLevel as StoredHintLevel
    return { answerMode: LEGACY_LEVEL_TO_MODE[level], hintLevel: level }
  }
  return null
}

function decodedBase64Size(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return Math.floor(value.length * 3 / 4) - padding
}

function hasExpectedMagicBytes(mimeType: TutorImage['mimeType'], bytes: number[]): boolean {
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mimeType === 'image/png') {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)
  }
  return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
}

export function validateTutorImage(value: unknown): { image?: TutorImage; error?: string } {
  if (value === undefined || value === null) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: '图片字段格式无效' }
  const row = value as Record<string, unknown>
  if (typeof row.mimeType !== 'string' || !IMAGE_TYPES.has(row.mimeType)) {
    return { error: '仅支持 JPG、PNG 或 WebP 图片' }
  }
  if (typeof row.dataUrl !== 'string') return { error: '图片内容格式无效' }
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(row.dataUrl)
  if (!match || match[1] !== row.mimeType) return { error: '图片内容与格式不匹配' }
  const encoded = match[2]
  if (encoded.length % 4 !== 0) return { error: '图片编码无效' }
  const size = decodedBase64Size(encoded)
  if (size <= 0 || size > MAX_TUTOR_IMAGE_BYTES) return { error: '图片不能超过 4 MB' }
  if (typeof row.size === 'number' && Number.isFinite(row.size) && Math.abs(row.size - size) > 2) {
    return { error: '图片大小校验失败' }
  }
  let header: number[]
  try {
    header = Array.from(atob(encoded.slice(0, 24)), (character) => character.charCodeAt(0))
  } catch {
    return { error: '图片编码无效' }
  }
  const mimeType = row.mimeType as TutorImage['mimeType']
  if (!hasExpectedMagicBytes(mimeType, header)) return { error: '图片文件内容无效' }
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim().slice(0, 180) : '题目图片'
  return { image: { dataUrl: row.dataUrl, mimeType, name, size } }
}

export function meaningfulAttempt(value: string | undefined): boolean {
  const attempt = value?.trim() ?? ''
  if (attempt.length < 8) return false
  const compact = attempt.normalize('NFKC').replace(/\s+/g, '')
  if (!compact || /^(.{1,4})\1+$/u.test(compact)) return false
  const semanticCharacters = compact.replace(/[^0-9A-Za-z\u3400-\u9fff]/g, '').toLowerCase()
  if (semanticCharacters.length < 5 || new Set(semanticCharacters).size < 3) return false
  const hasMathWork = /(?:[A-Za-z]\w*\s*[=<>≤≥]|[=<>≤≥]\s*(?:[-+]?\d|[A-Za-z])|(?:\d|[A-Za-z])\s*[+\-*/^]|[+\-*/^]\s*(?:\d|[A-Za-z])|\\(?:frac|sqrt|sin|cos|tan|log|ln|sum|int|vec|overrightarrow)\b)/i.test(attempt)
  const hasReasoningWork = /(?:设(?:置)?|令|由|因为|所以|代入|联立|化简|移项|展开|因式分解|求导|构造|作图|根据|先求|先算|检验|代回|列出|方程|函数|斜率|向量|受力|守恒|反应|浓度|物质的量)/.test(attempt)
  return hasMathWork || hasReasoningWork
}

export type TutorSubjectResolution =
  | { subjects: TutorSubject[]; error?: never }
  | { subjects?: never; error: 'invalid_subject' | 'subject_not_allowed' | 'subjects_missing' }

export function resolveTutorSubjects(
  requestedSubject: unknown,
  profileSubjects: unknown,
): TutorSubjectResolution {
  const allowedSubjects = Array.isArray(profileSubjects)
    ? [...new Set(profileSubjects.filter((subject): subject is TutorSubject => (
      subject === 'math' || subject === 'physics' || subject === 'chemistry'
    )))]
    : []
  if (requestedSubject !== undefined && requestedSubject !== null && requestedSubject !== '') {
    if (requestedSubject !== 'math' && requestedSubject !== 'physics' && requestedSubject !== 'chemistry') {
      return { error: 'invalid_subject' }
    }
    if (!allowedSubjects.includes(requestedSubject)) return { error: 'subject_not_allowed' }
    return { subjects: [requestedSubject] }
  }
  return allowedSubjects.length ? { subjects: allowedSubjects } : { error: 'subjects_missing' }
}

function searchTerms(value: string): Set<string> {
  const normalized = value.normalize('NFKC').toLowerCase()
  const terms = new Set<string>()
  const ignored = new Set([
    '这个', '那个', '题目', '问题', '怎么', '如何', '什么', '请问', '解答', '帮我', '一下', '已知', '求解',
    '学生', '补充', '文字', '核心', '条件', '科目', '知识', '检索', '关键', '题干', '摘要', '数学', '物理', '化学',
  ])
  for (const token of normalized.match(/[a-z0-9]{2,}|[\u3400-\u9fff]{2,}/g) ?? []) {
    if (/^[\u3400-\u9fff]+$/.test(token)) {
      for (let index = 0; index < token.length - 1; index += 1) {
        const term = token.slice(index, index + 2)
        if (!ignored.has(term)) terms.add(term)
      }
    } else {
      terms.add(token)
    }
  }
  return terms
}

export function hasLexicalOverlap(query: string, candidate: string): boolean {
  const queryTerms = searchTerms(query)
  if (!queryTerms.size) return false
  const candidateTerms = searchTerms(candidate)
  let matches = 0
  for (const term of queryTerms) {
    if (candidateTerms.has(term)) {
      matches += 1
      if (term.length > 2 || queryTerms.size <= 2 || matches >= 2) return true
    }
  }
  return false
}

export function selectRelevantChunks<T extends KnowledgeChunkCandidate>(
  chunks: T[],
  query: string,
  hasEmbedding: boolean,
  limit = 6,
): T[] {
  return [...chunks]
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0))
    .filter((chunk) => {
      const candidate = `${chunk.title ?? ''}\n${chunk.heading ?? ''}\n${chunk.content ?? ''}`
      if (hasLexicalOverlap(query, candidate)) return true
      return hasEmbedding && Number(chunk.score ?? 0) >= 0.22
    })
    .slice(0, limit)
}

export function selectRelevantWrongItems<T extends WrongItemCandidate>(items: T[], query: string, limit = 3): T[] {
  return items.filter((item) => hasLexicalOverlap(query, [
    item.title,
    item.question_text,
    Array.isArray(item.knowledge_points) ? item.knowledge_points.join(' ') : '',
    item.teacher_note,
  ].filter(Boolean).join('\n'))).slice(0, limit)
}

export interface ValidatedTutorModelAnswer {
  answer: string
  usedSourceIds: string[]
}

const MODEL_TEXT_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/
const MODEL_DISCLOSURE = /(?:system\s*prompt|developer\s*message|api\s*key|服务端密钥|系统提示词|内部指令|内部路径|其他学生信息)/i
const LOWER_MODE_ANSWER_LEAK = /(?:\\boxed|最终(?:答案|结果|结论)|答案\s*(?:为|是|[:：])|结果\s*(?:为|是|[:：])|故\s*(?:选|答案)|(?:正确|应选|选择)\s*(?:选项)?\s*[A-D](?:\s*项)?|解得\s*(?:\\?\(|[A-Za-z\u3400-\u9fff]){0,12}\s*(?:=|>|<|≥|≤|∈)|所以\s*(?:\\?\(|[A-Za-z\u3400-\u9fff]){0,12}\s*(?:=|>|<|≥|≤|∈))/i
const LOWER_MODE_NUMERIC_CONCLUSION = /(?:(?:得到|可得|从而|因此|求出|算出|推出)[^。；\n]{0,24}(?:=|>|<|≥|≤|∈)\s*(?:[-+]?\d|[A-D](?:\s*项)?|\\(?:frac|sqrt))|(?:^|[。；\n])\s*[A-Za-z][A-Za-z0-9_]*\s*=\s*[-+]?\d+(?:\.\d+)?\s*(?:[。；]|$))/im

function strictModelText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string' || MODEL_TEXT_CONTROL.test(value)) return null
  const normalized = value.normalize('NFKC').replace(/[ \t]+\n/g, '\n').trim()
  return normalized.length >= min && normalized.length <= max ? normalized : null
}

function hasExactKeys(row: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(row).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validatedSourceIds(value: unknown, anchors: TutorSourceAnchor[]): string[] | null {
  if (!Array.isArray(value) || value.length > 4) return null
  const allowed = new Set(anchors.map((anchor) => anchor.id))
  if (value.some((id) => typeof id !== 'string' || !allowed.has(id))) return null
  const ids = value as string[]
  return new Set(ids).size === ids.length ? ids : null
}

function hasUnsafeModelText(values: string[], lowerMode: boolean): boolean {
  const combined = values.join('\n')
  return MODEL_DISCLOSURE.test(combined)
    || (lowerMode && (LOWER_MODE_ANSWER_LEAK.test(combined) || LOWER_MODE_NUMERIC_CONCLUSION.test(combined)))
}

export function validateTutorModelAnswer(
  level: StoredHintLevel,
  rawAnswer: string,
  anchors: TutorSourceAnchor[] = [],
): ValidatedTutorModelAnswer | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawAnswer.trim())
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const row = parsed as Record<string, unknown>
  const usedSourceIds = validatedSourceIds(row.usedSourceIds, anchors)
  if (!usedSourceIds) return null
  const selectedAnchor = anchors.find((anchor) => anchor.id === usedSourceIds[0])
  const lead = sourceLead(usedSourceIds.length > 0, selectedAnchor)

  if (level === 'diagnose') {
    if (!hasExactKeys(row, ['blocker', 'checkQuestion', 'usedSourceIds'])) return null
    const blocker = strictModelText(row.blocker, 8, 220)
    const checkQuestion = strictModelText(row.checkQuestion, 6, 140)
    if (!blocker || !checkQuestion || hasUnsafeModelText([blocker, checkQuestion], true)) return null
    return { answer: `${lead}**卡点诊断**\n\n${blocker}\n\n**请先确认**\n\n${checkQuestion}`, usedSourceIds }
  }

  if (level === 'hint') {
    if (!hasExactKeys(row, ['hint', 'nextAction', 'usedSourceIds'])) return null
    const hint = strictModelText(row.hint, 8, 300)
    const nextAction = strictModelText(row.nextAction, 6, 180)
    if (!hint || !nextAction || hasUnsafeModelText([hint, nextAction], true)) return null
    return { answer: `${lead}**一级提示**\n\n${hint}\n\n**现在先做**\n\n${nextAction}`, usedSourceIds }
  }

  if (level === 'key_step') {
    if (!hasExactKeys(row, ['approach', 'steps', 'checkpoint', 'usedSourceIds'])) return null
    const approach = strictModelText(row.approach, 8, 320)
    const checkpoint = strictModelText(row.checkpoint, 6, 200)
    if (!approach || !checkpoint || !Array.isArray(row.steps) || row.steps.length < 1 || row.steps.length > 4) return null
    const steps = row.steps.map((step) => strictModelText(step, 4, 260))
    if (steps.some((step) => !step)) return null
    const safeSteps = steps as string[]
    if (hasUnsafeModelText([approach, ...safeSteps, checkpoint], true)) return null
    return {
      answer: `${lead}**解题路径**\n\n${approach}\n\n${safeSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n\n**停步检查**\n\n${checkpoint}`,
      usedSourceIds,
    }
  }

  if (!hasExactKeys(row, ['solution', 'usedSourceIds'])) return null
  const solution = strictModelText(row.solution, 20, 8000)
  if (!solution || hasUnsafeModelText([solution], false)) return null
  return { answer: `${lead}${solution}`, usedSourceIds }
}

function sourceLead(hasSources: boolean, anchor?: TutorSourceAnchor): string {
  if (!hasSources) return ''
  return anchor
    ? `已找到与你的问题相关的已学资料，优先参考「${anchor.label}」。\n\n`
    : '已找到与你的问题相关的已学资料，我会优先沿用其中的方法。\n\n'
}

export function fallbackAnswer(level: StoredHintLevel, hasSources: boolean, anchor?: TutorSourceAnchor): string {
  const lead = sourceLead(hasSources, anchor)
  if (level === 'diagnose') return `${lead}先确认卡点：你是还没有确定第一步，还是已经列出关系式但无法继续？请把最先不确定的等式或步骤发来。`
  if (level === 'hint') return `${lead}先只做一步：分别写出已知量、目标量和限制条件，再判断它们能由哪个定义或公式连接。暂时不要展开后续计算。`
  if (level === 'key_step') return `${lead}关键步骤是把题目的文字或几何条件转成可检验的数学关系。完成列式后先检查定义域、单位和符号，再继续计算；这里先不展开最终结果。`
  return `${lead}请沿“整理条件 → 选择方法 → 建立关系 → 计算 → 检验”的顺序完成，并逐步保留等价变形。`
}

export const TUTOR_SCAFFOLD_CODES = [
  'conditions',
  'representation',
  'method',
  'relation',
  'calculation',
  'verification',
  'unclear',
] as const

export type TutorScaffoldCode = typeof TUTOR_SCAFFOLD_CODES[number]

const SCAFFOLD_CODE_SET = new Set<string>(TUTOR_SCAFFOLD_CODES)
const SCAFFOLD_ANSWERS: Record<Exclude<StoredHintLevel, 'solution'>, Record<TutorScaffoldCode, string>> = {
  diagnose: {
    conditions: '先定位卡点：你是不确定题目给了哪些有效条件，还是不确定哪个条件应先使用？请只列出你已经确认的条件。',
    representation: '先定位卡点：你是不确定怎样把文字、图形或实验现象转成学科表达吗？请说出最难翻译的那一条信息。',
    method: '先定位卡点：你是想不到可用的方法，还是有多个方法但不知道如何选择？请说出你已经想到的候选方法。',
    relation: '先定位卡点：你是不知道设什么量，还是已经设量但列不出连接已知与目标的关系？请把当前设量发来。',
    calculation: '先定位卡点：你的关系已经建立，但卡在变形或计算吗？请发来最先无法继续的那一步，不必继续算。',
    verification: '先定位卡点：你已经得到候选结果，但不确定怎样检验条件、范围或单位吗？请先说出你准备核对的限制。',
    unclear: '先确认卡点：你是还没有确定第一步，还是已经列出关系式但无法继续？请把最先不确定的等式或步骤发来。',
  },
  hint: {
    conditions: '先只做一步：把显式条件与容易遗漏的限制分开列出，并圈出直接涉及目标量的条件。暂时不要计算。',
    representation: '先只做一步：把最关键的一条文字、图形或实验信息改写成规范的学科表达，再检查对象和方向是否对应。',
    method: '先只做一步：回忆一个能直接连接目标量与已知条件的定义、定理或基本模型，并先核对它的使用条件。',
    relation: '先只做一步：设最少的必要未知量，只建立一条连接已知与目标的关系；列好后先不要展开计算。',
    calculation: '先只做一步：回到最后一个确定正确的等价步骤，检查符号、括号和运算对象，再完成下一次变形。',
    verification: '先只做一步：逐项核对定义域、取值范围、单位、方向或题设限制，看候选结果是否全部满足。',
    unclear: '先只做一步：分别写出已知量、目标量和限制条件，再判断它们能由哪个定义或公式连接。暂时不要展开后续计算。',
  },
  key_step: {
    conditions: '关键步骤是先筛出真正参与求解的条件，并区分等价条件与附加限制。按目标量倒推需要哪些中间关系，但先不做最终计算。',
    representation: '关键步骤是把文字、图形或实验条件逐条转成可检验的学科关系，再核对对象、方向和适用范围。关系建立后先停在这里。',
    method: '关键步骤是先用适用条件排除不匹配的方法，再选择能最短连接已知与目标的定义、定理或模型。先写方法链，不展开最终结果。',
    relation: '关键步骤是选取最少的必要未知量，并让每个有效条件各对应一条关系。关系数量与未知量匹配后，再检查是否存在遗漏限制。',
    calculation: '关键步骤是从最后一个确定正确的关系继续做等价变形，每次只改变一个环节，并同步检查符号、括号和运算对象；省略最后计算。',
    verification: '关键步骤是把候选结果依次代回原始条件，并检查定义域、范围、单位、方向及特殊情形。这里只说明检验顺序，不给最终结论。',
    unclear: '关键步骤是把题目的条件转成可检验的学科关系。完成列式后先检查适用范围、单位和符号，再继续计算；这里不展开最终结果。',
  },
}

interface TutorScaffoldSelection {
  scaffold: TutorScaffoldCode
  anchorId?: string
  focusCodes: TutorFocusCode[]
}

export const TUTOR_FOCUS_CODES = [
  'locate_blocker',
  'extract_conditions',
  'translate_information',
  'compare_methods',
  'work_backward',
  'audit_last_step',
  'verify_constraints',
  'transfer_source',
] as const

export type TutorFocusCode = typeof TUTOR_FOCUS_CODES[number]

const TUTOR_FOCUS_CODE_SET = new Set<string>(TUTOR_FOCUS_CODES)
const MAX_TUTOR_FOCUS_CODES = 2

const FOCUS_ANSWERS: Record<Exclude<StoredHintLevel, 'solution'>, Record<TutorFocusCode, string>> = {
  diagnose: {
    locate_blocker: '先把卡点限定在“看不懂条件、想不到方法、列不出关系、算不下去”中的一类。',
    extract_conditions: '先确认你能否区分题目直接给出的条件与隐藏限制。',
    translate_information: '先确认你卡在文字、图形或实验信息中的哪一条转换。',
    compare_methods: '先确认你是没有候选方法，还是无法判断候选方法的适用条件。',
    work_backward: '先确认你能否从目标量倒推出一个必须先建立的中间关系。',
    audit_last_step: '先指出最后一个你确信正确的步骤，卡点就从它的下一步开始定位。',
    verify_constraints: '先确认你还没有核对的是定义域、范围、单位、方向还是题设限制。',
    transfer_source: '先确认你是没有识别出资料方法的使用场景，还是不确定它的适用条件。',
  },
  hint: {
    locate_blocker: '先只处理当前最早出现的卡点，不要同时推进后面的计算。',
    extract_conditions: '把显式条件和隐藏限制分成两列，再圈出直接关联目标量的一项。',
    translate_information: '把最关键的一条文字、图形或实验信息改写成规范的学科表达。',
    compare_methods: '列出一个候选方法，并先核对它的适用对象和使用条件。',
    work_backward: '从目标量倒推一个必要的中间关系，暂时不要展开求值。',
    audit_last_step: '回到最后一个确认正确的步骤，只检查它到下一步之间改变了什么。',
    verify_constraints: '按定义域、范围、单位、方向和题设限制的顺序逐项核对。',
    transfer_source: '先对照资料方法的适用条件，再判断本题已知条件是否具备对应特征。',
  },
  key_step: {
    locate_blocker: '关键是先解决最早的断点，再让后续步骤沿同一条方法链继续。',
    extract_conditions: '关键是筛出真正参与求解的条件，并区分等价条件与附加限制。',
    translate_information: '关键是把题目的核心信息转成可检验的学科关系，再核对对象和方向。',
    compare_methods: '关键是用适用条件排除不匹配的方法，再保留能连接已知与目标的方法链。',
    work_backward: '关键是从目标倒推所需的中间关系，再检查现有条件能否建立这条关系。',
    audit_last_step: '关键是从最后一个正确步骤继续等价处理，每次只改变一个环节并同步核对。',
    verify_constraints: '关键是把候选过程依次放回定义域、范围、单位、方向和题设限制中检验。',
    transfer_source: '关键是把资料方法的适用条件与本题特征逐项对应，再决定关系建立顺序。',
  },
}

function scaffoldSelectionFromModel(value: string): TutorScaffoldSelection | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const row = parsed as Record<string, unknown>
    if (Object.keys(row).some((key) => key !== 'scaffold' && key !== 'anchorId' && key !== 'focusCodes')) return null
    const code = row.scaffold
    if (typeof code !== 'string' || !SCAFFOLD_CODE_SET.has(code)) return null
    if (row.anchorId !== undefined && typeof row.anchorId !== 'string') return null
    if (!Array.isArray(row.focusCodes) || row.focusCodes.length < 1 || row.focusCodes.length > MAX_TUTOR_FOCUS_CODES) return null
    if (row.focusCodes.some((focus) => typeof focus !== 'string' || !TUTOR_FOCUS_CODE_SET.has(focus))) return null
    if (new Set(row.focusCodes).size !== row.focusCodes.length) return null
    return {
      scaffold: code as TutorScaffoldCode,
      anchorId: row.anchorId,
      focusCodes: row.focusCodes as TutorFocusCode[],
    }
  } catch {
    return null
  }
}

export function safeLevelAnswer(
  level: StoredHintLevel,
  answer: string,
  hasSources: boolean,
  anchors: TutorSourceAnchor[] = [],
): string {
  const normalized = answer.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\u2060\uFEFF]/g, '').trim()
  const firstAnchor = hasSources ? anchors[0] : undefined
  if (!normalized) return fallbackAnswer(level, hasSources, firstAnchor)
  if (level === 'solution') return normalized.slice(0, 8000)
  const selection = scaffoldSelectionFromModel(normalized)
  if (!selection) return fallbackAnswer(level, hasSources, firstAnchor)
  const selectedAnchor = hasSources && selection.anchorId
    ? anchors.find((anchor) => anchor.id === selection.anchorId)
    : undefined
  if (hasSources && anchors.length > 0 && !selectedAnchor) {
    return fallbackAnswer(level, true, firstAnchor)
  }
  if ((!hasSources || anchors.length === 0) && selection.anchorId !== undefined) {
    return fallbackAnswer(level, hasSources)
  }
  const focusAnswer = selection.focusCodes.map((focus) => FOCUS_ANSWERS[level][focus]).join('\n\n')
  return `${sourceLead(hasSources, selectedAnchor)}${SCAFFOLD_ANSWERS[level][selection.scaffold]}\n\n${focusAnswer}`
}
