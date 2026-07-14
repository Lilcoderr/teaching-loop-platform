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

export function fallbackAnswer(level: StoredHintLevel, hasSources: boolean): string {
  const sourceLead = hasSources ? '已找到与你的问题相关的已学资料，我会优先沿用其中的方法。\n\n' : ''
  if (level === 'diagnose') return `${sourceLead}先确认卡点：你是还没有确定第一步，还是已经列出关系式但无法继续？请把最先不确定的等式或步骤发来。`
  if (level === 'hint') return `${sourceLead}先只做一步：分别写出已知量、目标量和限制条件，再判断它们能由哪个定义或公式连接。暂时不要展开后续计算。`
  if (level === 'key_step') return `${sourceLead}关键步骤是把题目的文字或几何条件转成可检验的数学关系。完成列式后先检查定义域、单位和符号，再继续计算；这里先不展开最终结果。`
  return `${sourceLead}请沿“整理条件 → 选择方法 → 建立关系 → 计算 → 检验”的顺序完成，并逐步保留等价变形。`
}

export function safeLevelAnswer(level: StoredHintLevel, answer: string, hasSources: boolean): string {
  const limits: Record<StoredHintLevel, number> = { diagnose: 500, hint: 700, key_step: 1200, solution: 8000 }
  const looksLikeFullSolution = /(?:完整解答|最终答案|答案为|综上所述|故选|所以\s*[A-D]|第[一二三四五六]步)/.test(answer)
  if (level !== 'solution' && looksLikeFullSolution) return fallbackAnswer(level, hasSources)
  return answer.slice(0, limits[level])
}
