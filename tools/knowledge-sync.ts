import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join, parse, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import fg from 'fast-glob'
import { load } from 'cheerio'
import type { Content, Heading, Root } from 'mdast'
import { toString } from 'mdast-util-to-string'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { z } from 'zod'

import { invokeFunction } from './lib/http'
import {
  isDirectExecution,
  loadLocalEnvironment,
  readJsonConfig,
  reportCliError,
  requiredEnvironment,
} from './lib/runtime'
import {
  chunkArray,
  normalizeRelativePath,
  normalizeWhitespace,
  relativePosix,
  sha256,
} from './lib/text'

export type Subject = 'math' | 'physics' | 'chemistry'
export type KnowledgeVisibility = 'student_visible' | 'solution_gated' | 'teacher_only'
export type KnowledgeDocumentType = 'lecture' | 'exercise' | 'solution' | 'lesson_plan'

export interface KnowledgeChunkPayload {
  externalId: string
  chunkIndex: number
  section: string
  headingPath: string[]
  content: string
  contentHash: string
}

export interface KnowledgeDocumentPayload {
  externalId: string
  studentId: string
  subject: Subject
  title: string
  documentType: KnowledgeDocumentType
  visibility: KnowledgeVisibility
  relativePath: string
  contentHash: string
  sourceModifiedAt: string
  chunks: KnowledgeChunkPayload[]
}

interface ParsedChunk {
  section: string
  headingPath: string[]
  content: string
  contentHash: string
}

export interface ParsedDocument {
  title: string
  chunks: ParsedChunk[]
}

interface TextSection {
  headingPath: string[]
  blocks: string[]
}

const SubjectSchema = z.enum(['math', 'physics', 'chemistry'])
const DocumentTypeSchema = z.enum(['lecture', 'exercise', 'solution', 'lesson_plan'])
const VisibilitySchema = z.enum(['student_visible', 'solution_gated', 'teacher_only'])

const KnowledgeSourceSchema = z.object({
  studentId: z.string().trim().min(1),
  subject: SubjectSchema,
  root: z.string().trim().min(1),
  pathPrefix: z.string().trim().min(1).optional(),
  include: z
    .array(z.string().trim().min(1))
    .min(1)
    .default(['**/*.md', '**/*.markdown', '**/*.html', '**/*.htm']),
  exclude: z.array(z.string().trim().min(1)).default([]),
  defaultDocumentType: DocumentTypeSchema.default('lesson_plan'),
  defaultVisibility: VisibilitySchema.default('teacher_only'),
}).strict()

export const KnowledgeSyncConfigSchema = z.object({
  platformUrl: z.string().url().optional(),
  endpoint: z.string().url().optional(),
  tokenEnv: z.string().trim().min(1).default('KNOWLEDGE_SYNC_TOKEN'),
  stateFile: z.string().trim().min(1).default('.knowledge-sync-state.local.json'),
  batchSize: z.number().int().min(1).max(25).default(20),
  maxChunkCharacters: z.number().int().min(500).max(20_000).default(3_500),
  maxChunksPerDocument: z.number().int().min(1).max(250).default(250),
  sources: z.array(KnowledgeSourceSchema).min(1),
}).strict()

export type KnowledgeSyncConfig = z.infer<typeof KnowledgeSyncConfigSchema>

const StateEntrySchema = z.object({
  contentHash: z.string(),
  metadataHash: z.string().optional(),
  relativePath: z.string(),
  active: z.boolean(),
  syncedAt: z.string(),
})

const SyncStateSchema = z.object({
  version: z.literal(1),
  documents: z.record(z.string(), StateEntrySchema),
})

export type KnowledgeSyncState = z.infer<typeof SyncStateSchema>

const EMPTY_STATE: KnowledgeSyncState = { version: 1, documents: {} }

function nodeSource(source: string, node: Content) {
  const position = (
    node as unknown as {
      position?: { start?: { offset?: number }; end?: { offset?: number } }
    }
  ).position
  const start = position?.start?.offset
  const end = position?.end?.offset
  if (start === undefined || end === undefined) return toString(node).trim()
  return source.slice(start, end).trim()
}

function updateHeadingPath(path: string[], heading: Heading, label: string) {
  const next = path.slice(0, heading.depth - 1)
  while (next.length < heading.depth - 1) next.push('未命名章节')
  next[heading.depth - 1] = label
  return next
}

function splitOversizedText(value: string, maxCharacters: number) {
  if (value.length <= maxCharacters) return [value]

  const paragraphs = value.split(/\n{2,}/)
  const parts: string[] = []
  let current = ''

  const push = () => {
    const text = current.trim()
    if (text) parts.push(text)
    current = ''
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxCharacters) {
      push()
      let remaining = paragraph.trim()
      while (remaining.length > maxCharacters) {
        const window = remaining.slice(0, maxCharacters + 1)
        const newline = window.lastIndexOf('\n')
        const sentence = Math.max(
          window.lastIndexOf('。'),
          window.lastIndexOf('；'),
          window.lastIndexOf('. '),
        )
        const splitAt = Math.max(newline, sentence)
        const end = splitAt > maxCharacters * 0.55 ? splitAt + 1 : maxCharacters
        parts.push(remaining.slice(0, end).trim())
        remaining = remaining.slice(end).trim()
      }
      if (remaining) current = remaining
      continue
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length > maxCharacters) push()
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }

  push()
  return parts
}

function sectionsToChunks(
  title: string,
  sections: TextSection[],
  maxCharacters: number,
): ParsedChunk[] {
  const chunks: ParsedChunk[] = []

  for (const section of sections) {
    const content = section.blocks.map((block) => block.trim()).filter(Boolean).join('\n\n')
    if (!content) continue

    const headingPath = section.headingPath.length ? section.headingPath : [title]
    const label = headingPath.join(' > ')
    for (const part of splitOversizedText(content, maxCharacters)) {
      chunks.push({
        section: label,
        headingPath,
        content: part,
        contentHash: sha256(part),
      })
    }
  }

  if (!chunks.length) {
    const content = title.trim()
    chunks.push({
      section: title,
      headingPath: [title],
      content,
      contentHash: sha256(content),
    })
  }

  return chunks
}

export function parseMarkdownDocument(
  source: string,
  fallbackTitle: string,
  maxCharacters = 3_500,
): ParsedDocument {
  const tree = unified().use(remarkParse).parse(source) as Root
  let title = fallbackTitle
  let headingPath: string[] = []
  let current: TextSection = { headingPath: [fallbackTitle], blocks: [] }
  const sections: TextSection[] = []

  const flush = () => {
    if (current.blocks.some((block) => block.trim())) sections.push(current)
  }

  for (const node of tree.children) {
    if (node.type === 'heading') {
      flush()
      const label = normalizeWhitespace(toString(node)) || '未命名章节'
      if (node.depth === 1 && title === fallbackTitle) title = label
      headingPath = updateHeadingPath(headingPath, node, label)
      current = { headingPath: [...headingPath], blocks: [nodeSource(source, node)] }
    } else {
      current.blocks.push(nodeSource(source, node))
    }
  }
  flush()

  return { title, chunks: sectionsToChunks(title, sections, maxCharacters) }
}

export function parseHtmlDocument(
  source: string,
  fallbackTitle: string,
  maxCharacters = 3_500,
): ParsedDocument {
  const $ = load(source)
  $('script,style,noscript,template,.katex-html').remove()

  let title = normalizeWhitespace($('h1').first().text()) || fallbackTitle
  let headingPath: string[] = []
  let current: TextSection = { headingPath: [title], blocks: [] }
  const sections: TextSection[] = []

  const flush = () => {
    if (current.blocks.some((block) => block.trim())) sections.push(current)
  }

  $('h1,h2,h3,h4,h5,h6,p,pre,blockquote,li,tr').each((_index, element) => {
    if (!('name' in element)) return
    const tag = element.name.toLowerCase()
    const isHeading = /^h[1-6]$/.test(tag)

    if (!isHeading && $(element).parents('p,pre,blockquote,li,tr').length) return

    let text: string
    if (tag === 'tr') {
      text = $(element)
        .find('th,td')
        .map((_cellIndex, cell) => normalizeWhitespace($(cell).text()))
        .get()
        .filter(Boolean)
        .join(' | ')
    } else if (tag === 'pre') {
      text = $(element).text().trim()
    } else {
      text = normalizeWhitespace($(element).text())
    }
    if (!text) return

    if (isHeading) {
      flush()
      const depth = Number(tag.slice(1)) as Heading['depth']
      if (depth === 1) title = text
      headingPath = updateHeadingPath(headingPath, { type: 'heading', depth, children: [] }, text)
      current = { headingPath: [...headingPath], blocks: [`${'#'.repeat(depth)} ${text}`] }
    } else {
      current.blocks.push(text)
    }
  })
  flush()

  if (!sections.length) {
    const bodyText = normalizeWhitespace($('body').text())
    if (bodyText) sections.push({ headingPath: [title], blocks: [bodyText] })
  }

  return { title, chunks: sectionsToChunks(title, sections, maxCharacters) }
}

const EXTENSION_PRIORITY: Record<string, number> = {
  '.md': 0,
  '.markdown': 1,
  '.html': 2,
  '.htm': 3,
}

export function choosePreferredFiles(paths: string[]) {
  const selected = new Map<string, string>()

  for (const filePath of [...paths].sort((left, right) => left.localeCompare(right, 'zh-CN'))) {
    const extension = extname(filePath).toLowerCase()
    if (!(extension in EXTENSION_PRIORITY)) continue
    const details = parse(normalizeRelativePath(filePath))
    const key = join(details.dir.toLowerCase(), details.name.toLowerCase())
    const current = selected.get(key)
    if (!current) {
      selected.set(key, filePath)
      continue
    }
    const currentPriority = EXTENSION_PRIORITY[extname(current).toLowerCase()]
    if (EXTENSION_PRIORITY[extension] < currentPriority) selected.set(key, filePath)
  }

  return Array.from(selected.values()).sort((left, right) => left.localeCompare(right, 'zh-CN'))
}

export function inferDocumentPolicy(
  filePath: string,
  fallback: { documentType: KnowledgeDocumentType; visibility: KnowledgeVisibility },
) {
  const stem = parse(filePath).name.replace(/\s+/g, '')
  if (stem.includes('题目与解析')) {
    return { documentType: 'solution' as const, visibility: 'solution_gated' as const }
  }
  if (stem.includes('课后练习')) {
    return { documentType: 'exercise' as const, visibility: 'student_visible' as const }
  }
  if (stem.includes('讲义')) {
    return { documentType: 'lecture' as const, visibility: 'student_visible' as const }
  }
  if (stem.includes('教案')) {
    return { documentType: 'lesson_plan' as const, visibility: 'teacher_only' as const }
  }
  return fallback
}

async function scanSource(
  source: z.infer<typeof KnowledgeSourceSchema>,
  configDirectory: string,
  maxCharacters: number,
  maxChunks: number,
) {
  const root = resolve(configDirectory, source.root)
  const rootStats = await stat(root).catch(() => null)
  if (!rootStats?.isDirectory()) throw new Error(`知识源目录不存在或不是目录：${root}`)

  const discovered = await fg(source.include ?? ['**/*.md', '**/*.markdown', '**/*.html', '**/*.htm'], {
    cwd: root,
    onlyFiles: true,
    unique: true,
    dot: false,
    followSymbolicLinks: false,
    ignore: source.exclude ?? [],
  })
  const selected = choosePreferredFiles(discovered)
  const documents: KnowledgeDocumentPayload[] = []
  const pathPrefix = source.pathPrefix
    ? normalizeRelativePath(source.pathPrefix).replace(/^\/+|\/+$/g, '')
    : basename(root)

  for (const relativeFile of selected) {
    const absoluteFile = resolve(root, relativeFile)
    const [buffer, fileStats] = await Promise.all([readFile(absoluteFile), stat(absoluteFile)])
    const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
    const extension = extname(relativeFile).toLowerCase()
    const fallbackTitle = parse(relativeFile).name
    const parsed =
      extension === '.md' || extension === '.markdown'
        ? parseMarkdownDocument(text, fallbackTitle, maxCharacters)
        : parseHtmlDocument(text, fallbackTitle, maxCharacters)
    if (parsed.chunks.length > maxChunks) {
      throw new Error(
        `${absoluteFile} 被切成 ${parsed.chunks.length} 段，超过单文档上限 ${maxChunks}；请提高 maxChunkCharacters 或拆分源文件`,
      )
    }

    const selectedRelativePath = normalizeRelativePath(relativeFile)
    const stablePath = selectedRelativePath.replace(/\.(?:md|markdown|html|htm)$/i, '').toLowerCase()
    const externalId = `knowledge-${sha256(
      `${source.studentId}\0${source.subject}\0${pathPrefix}/${stablePath}`,
    ).slice(0, 32)}`
    const policy = inferDocumentPolicy(relativeFile, {
      documentType: source.defaultDocumentType ?? 'lesson_plan',
      visibility: source.defaultVisibility ?? 'teacher_only',
    })
    const relativePath = normalizeRelativePath(`${pathPrefix}/${selectedRelativePath}`)

    documents.push({
      externalId,
      studentId: source.studentId,
      subject: source.subject,
      title: parsed.title,
      documentType: policy.documentType,
      visibility: policy.visibility,
      relativePath,
      contentHash: sha256(buffer),
      sourceModifiedAt: fileStats.mtime.toISOString(),
      chunks: parsed.chunks.map((chunk, chunkIndex) => ({
        ...chunk,
        chunkIndex,
        externalId: `chunk-${sha256(`${externalId}\0${chunkIndex}\0${chunk.contentHash}`).slice(0, 40)}`,
      })),
    })
  }

  return { documents, discoveredCount: discovered.length, selectedCount: selected.length }
}

export async function collectKnowledgeDocuments(
  config: KnowledgeSyncConfig,
  configDirectory: string,
) {
  const byExternalId = new Map<string, KnowledgeDocumentPayload>()
  let discoveredCount = 0
  let selectedCount = 0

  for (const source of config.sources) {
    const scanned = await scanSource(
      source,
      configDirectory,
      config.maxChunkCharacters ?? 3_500,
      config.maxChunksPerDocument ?? 250,
    )
    discoveredCount += scanned.discoveredCount
    selectedCount += scanned.selectedCount
    for (const document of scanned.documents) {
      const existing = byExternalId.get(document.externalId)
      if (existing && existing.contentHash !== document.contentHash) {
        throw new Error(`多个知识源产生了相同 externalId，但内容不同：${document.relativePath}`)
      }
      byExternalId.set(document.externalId, document)
    }
  }

  return { documents: Array.from(byExternalId.values()), discoveredCount, selectedCount }
}

async function readSyncState(statePath: string): Promise<KnowledgeSyncState> {
  try {
    const raw = await readFile(statePath, 'utf8')
    const parsed = SyncStateSchema.safeParse(JSON.parse(raw.replace(/^\uFEFF/, '')))
    if (!parsed.success) throw new Error(parsed.error.message)
    return parsed.data
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(EMPTY_STATE)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`无法读取同步状态 ${statePath}：${message}`)
  }
}

export function createSyncPlan(
  documents: KnowledgeDocumentPayload[],
  state: KnowledgeSyncState,
) {
  const currentIds = new Set(documents.map((document) => document.externalId))
  const upserts = documents.filter((document) => {
    const previous = state.documents[document.externalId]
    return (
      !previous ||
      !previous.active ||
      previous.contentHash !== document.contentHash ||
      previous.metadataHash !== documentMetadataHash(document)
    )
  })
  const unchanged = documents.filter((document) => {
    const previous = state.documents[document.externalId]
    return (
      previous?.active &&
      previous.contentHash === document.contentHash &&
      previous.metadataHash === documentMetadataHash(document)
    )
  })
  const deactivations = Object.entries(state.documents)
    .filter(([externalId, entry]) => entry.active && !currentIds.has(externalId))
    .map(([externalId]) => externalId)

  return { upserts, unchanged, deactivations }
}

function documentMetadataHash(document: KnowledgeDocumentPayload) {
  return sha256(
    JSON.stringify({
      studentId: document.studentId,
      subject: document.subject,
      title: document.title,
      documentType: document.documentType,
      visibility: document.visibility,
      relativePath: document.relativePath,
      chunks: document.chunks.map((chunk) => ({
        section: chunk.section,
        contentHash: chunk.contentHash,
      })),
    }),
  )
}

interface IngestResponse {
  ok?: boolean
  runId?: string
  added?: number
  updated?: number
  unchanged?: number
  deactivated?: number
  errors?: unknown[]
}

function assertSuccessfulResponse(response: IngestResponse, operation: string) {
  if (response.ok === false || response.errors?.length) {
    throw new Error(`${operation} 未完全成功：${JSON.stringify(response.errors ?? [])}`)
  }
}

export async function runKnowledgeSync(options: { configPath: string; dryRun: boolean }) {
  loadLocalEnvironment()
  const loaded = await readJsonConfig(options.configPath, KnowledgeSyncConfigSchema)
  const configDirectory = dirname(loaded.absolutePath)
  const statePath = resolve(configDirectory, loaded.config.stateFile ?? '.knowledge-sync-state.local.json')
  const [collected, state] = await Promise.all([
    collectKnowledgeDocuments(loaded.config, configDirectory),
    readSyncState(statePath),
  ])
  const plan = createSyncPlan(collected.documents, state)

  console.log(
    `扫描 ${collected.discoveredCount} 个候选文件，MD/HTML 去重后 ${collected.selectedCount} 个；` +
      `新增或变化 ${plan.upserts.length}，未变化 ${plan.unchanged.length}，待停用 ${plan.deactivations.length}。`,
  )

  if (options.dryRun) {
    for (const document of plan.upserts) {
      console.log(`[dry-run] upsert ${document.relativePath} (${document.chunks.length} chunks)`)
    }
    for (const externalId of plan.deactivations) {
      console.log(`[dry-run] deactivate ${externalId}`)
    }
    return { ...plan, dryRun: true }
  }

  if (plan.upserts.length || plan.deactivations.length) {
    const token = requiredEnvironment(loaded.config.tokenEnv ?? 'KNOWLEDGE_SYNC_TOKEN')
    const platformUrl = loaded.config.platformUrl ?? process.env.PLATFORM_URL

    for (const batch of chunkArray(plan.upserts, loaded.config.batchSize ?? 20)) {
      const response = await invokeFunction<IngestResponse>({
        functionName: 'knowledge-ingest',
        platformUrl,
        endpoint: loaded.config.endpoint,
        token,
        tokenHeader: 'x-sync-token',
        body: { action: 'upsert', documents: batch },
      })
      assertSuccessfulResponse(response, '知识文档写入')
    }

    for (const batch of chunkArray(plan.deactivations, loaded.config.batchSize ?? 20)) {
      const response = await invokeFunction<IngestResponse>({
        functionName: 'knowledge-ingest',
        platformUrl,
        endpoint: loaded.config.endpoint,
        token,
        tokenHeader: 'x-sync-token',
        body: { action: 'deactivate', externalIds: batch },
      })
      assertSuccessfulResponse(response, '知识文档停用')
    }
  }

  const syncedAt = new Date().toISOString()
  const nextState: KnowledgeSyncState = structuredClone(state)
  for (const document of collected.documents) {
    nextState.documents[document.externalId] = {
      contentHash: document.contentHash,
      metadataHash: documentMetadataHash(document),
      relativePath: document.relativePath,
      active: true,
      syncedAt,
    }
  }
  for (const externalId of plan.deactivations) {
    nextState.documents[externalId] = {
      ...nextState.documents[externalId],
      active: false,
      syncedAt,
    }
  }

  await mkdir(dirname(statePath), { recursive: true })
  await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8')
  console.log(`同步完成；状态已写入 ${relativePosix(process.cwd(), statePath)}`)
  return { ...plan, dryRun: false }
}

function printHelp() {
  console.log(`用法：npm run knowledge:sync -- --config <配置.json> [--dry-run]

配置路径默认 knowledge-sources.local.json。相对目录均以配置文件所在目录为基准。`)
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c', default: 'knowledge-sources.local.json' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  })
  if (values.help) return printHelp()
  await runKnowledgeSync({
    configPath: values.config ?? 'knowledge-sources.local.json',
    dryRun: values['dry-run'] ?? false,
  })
}

if (isDirectExecution(import.meta.url)) main().catch(reportCliError)
