export type AnswerMode = 'diagnose' | 'hint' | 'steps' | 'solution'
export type StoredHintLevel = 'diagnose' | 'hint' | 'key_step' | 'solution'

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

const SAFE_ANCHOR_ID = /^[kmw][1-9][0-9]?$/
const ANSWER_SHAPED_LABEL = /(?:答案\s*(?:为|是|[:：])|最终(?:答案|结果|结论)?\s*(?:为|是|[:：])|解得|故选|应选|选择\s*[A-D](?:\b|项)|选项\s*[A-D](?:\b|项)|\\boxed|(?:^|[\s，。；：:])[^，。；：:\s]{1,12}\s*(?:=|≈)\s*(?:[-+]?\d+(?:\.\d+)?|[A-D](?:\b|$)|√|\\(?:sqrt|frac|pi)))/i

export function sanitizeTutorSourceLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length < 2 || ANSWER_SHAPED_LABEL.test(normalized)) return null
  const plain = normalized
    .replace(/<[^>]*>/g, ' ')
    .replace(/[`*_#\[\]{}<>|$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return plain.length >= 2 && !ANSWER_SHAPED_LABEL.test(plain) ? plain : null
}

export function buildSafeSourceAnchors(
  candidates: TutorSourceAnchorCandidate[],
  limit = 8,
): TutorSourceAnchor[] {
  const anchors: TutorSourceAnchor[] = []
  const ids = new Set<string>()
  for (const candidate of candidates) {
    if (anchors.length >= Math.min(Math.max(limit, 0), 12)) break
    if (!SAFE_ANCHOR_ID.test(candidate.id) || ids.has(candidate.id)) continue
    const label = candidate.labels.map(sanitizeTutorSourceLabel).find((item): item is string => Boolean(item))
    if (!label) continue
    ids.add(candidate.id)
    anchors.push({ id: candidate.id, label, sourceType: candidate.sourceType })
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
  return attempt.length >= 8 && /(?:[0-9A-Za-z]|[=+\-*/^<>≤≥√∠]|\\[A-Za-z]+)/.test(attempt)
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
}

function scaffoldSelectionFromModel(value: string): TutorScaffoldSelection | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const row = parsed as Record<string, unknown>
    if (Object.keys(row).some((key) => key !== 'scaffold' && key !== 'anchorId')) return null
    const code = row.scaffold
    if (typeof code !== 'string' || !SCAFFOLD_CODE_SET.has(code)) return null
    if (row.anchorId !== undefined && typeof row.anchorId !== 'string') return null
    return { scaffold: code as TutorScaffoldCode, anchorId: row.anchorId }
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
  const selectedAnchor = hasSources
    ? anchors.find((anchor) => anchor.id === selection.anchorId) ?? firstAnchor
    : undefined
  return `${sourceLead(hasSources, selectedAnchor)}${SCAFFOLD_ANSWERS[level][selection.scaffold]}`
}
