import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import fg from 'fast-glob'
import type { Content, ListItem, Root } from 'mdast'
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
import { chunkArray, normalizeRelativePath, normalizeWhitespace, sha256, splitList } from './lib/text'

type Subject = 'math' | 'physics' | 'chemistry'

export interface QuestionBankItem {
  externalId: string
  subject: Subject
  topic: string
  questionText: string
  officialAnswer: string
  paperName: string
  questionNumber: string
  originalFile: string
  questionPage: string
  answerFile: string
  answerPage: string
  knowledgePoints: string[]
  difficulty?: string
  suitability?: string
  verificationStatus: '题面、官方答案均已复核'
  verified: true
  sourceRelativePath: string
  contentHash: string
  source: {
    paperName: string
    questionNumber: string
    originalFile: string
    questionPage: string
    answerFile: string
    answerPage: string
    recordFile: string
  }
}

export interface QuestionParseResult {
  entriesFound: number
  items: QuestionBankItem[]
  skipped: Array<{ externalId: string; reason: string }>
  errors: Array<{ externalId: string; reason: string }>
}

const QuestionBankSourceSchema = z.object({
  root: z.string().trim().min(1),
  subject: z.enum(['math', 'physics', 'chemistry']),
  pathPrefix: z.string().trim().min(1).optional(),
  topic: z.string().trim().min(1).optional(),
  include: z.array(z.string().trim().min(1)).min(1).default(['**/*.md', '**/*.markdown']),
  exclude: z.array(z.string().trim().min(1)).default(['README.md', '索引.md']),
}).strict()

export const QuestionBankImportConfigSchema = z.object({
  platformUrl: z.string().url().optional(),
  endpoint: z.string().url().optional(),
  tokenEnv: z.string().trim().min(1).default('KNOWLEDGE_SYNC_TOKEN'),
  batchSize: z.number().int().min(1).max(100).default(50),
  sources: z.array(QuestionBankSourceSchema).min(1),
}).strict()

export type QuestionBankImportConfig = z.infer<typeof QuestionBankImportConfigSchema>

function extractEntryId(value: string) {
  return value.toUpperCase().match(/\b[A-Z]{2,}\d{4}(?:-[A-Z0-9]+)+\b/)?.[0]
}

function normalizedStatus(value?: string) {
  return value?.replace(/\s+/g, '').replace(/，/g, '、')
}

function itemMetadata(item: ListItem) {
  const value = normalizeWhitespace(toString(item))
  const match = value.match(/^([^：:]+)[：:]\s*(.+)$/s)
  return match ? ([match[1].trim(), match[2].trim()] as const) : null
}

function collectMetadata(nodes: Content[]) {
  const metadata: Record<string, string> = {}
  for (const node of nodes) {
    if (node.type === 'heading') break
    if (node.type !== 'list') continue
    for (const item of node.children) {
      const pair = itemMetadata(item)
      if (pair) metadata[pair[0]] = pair[1]
    }
  }
  return metadata
}

function sourceOffset(node: Content, edge: 'start' | 'end') {
  return (
    node as unknown as {
      position?: { start?: { offset?: number }; end?: { offset?: number } }
    }
  ).position?.[edge]?.offset
}

function findSection(
  source: string,
  nodes: Content[],
  entryEnd: number,
  predicate: (heading: string) => boolean,
) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node.type !== 'heading' || !predicate(normalizeWhitespace(toString(node)))) continue
    const start = sourceOffset(node, 'end')
    if (start === undefined) return ''

    let end = entryEnd
    for (let cursor = index + 1; cursor < nodes.length; cursor += 1) {
      const candidate = nodes[cursor]
      if (candidate.type === 'heading' && candidate.depth <= node.depth) {
        end = sourceOffset(candidate, 'start') ?? entryEnd
        break
      }
    }
    return source.slice(start, end).trim()
  }
  return ''
}

function requiredMetadata(
  externalId: string,
  metadata: Record<string, string>,
  questionText: string,
  officialAnswer: string,
) {
  const combinedFile = metadata['原卷及答案']
  const values = {
    paperName: metadata['试卷'],
    questionNumber: metadata['题号'],
    questionPage: metadata['题面页'],
    answerPage: metadata['答案页'],
    originalFile: metadata['原卷'] ?? combinedFile,
    answerFile: metadata['答案'] ?? combinedFile,
  }
  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (!questionText) missing.push('题目正文')
  if (!officialAnswer) missing.push('官方答案正文')
  if (missing.length) {
    return `${externalId} 标记为已复核，但缺少：${missing.join('、')}`
  }
  return null
}

export function parseQuestionBankMarkdown(options: {
  source: string
  sourceRelativePath: string
  subject: Subject
  topic: string
}): QuestionParseResult {
  const tree = unified().use(remarkParse).parse(options.source) as Root
  const items: QuestionBankItem[] = []
  const skipped: QuestionParseResult['skipped'] = []
  const errors: QuestionParseResult['errors'] = []
  let entriesFound = 0

  for (let index = 0; index < tree.children.length; index += 1) {
    const heading = tree.children[index]
    if (heading.type !== 'heading') continue
    const externalId = extractEntryId(toString(heading))
    if (!externalId) continue
    entriesFound += 1

    let boundaryIndex = tree.children.length
    for (let cursor = index + 1; cursor < tree.children.length; cursor += 1) {
      const candidate = tree.children[cursor]
      if (candidate.type === 'heading' && candidate.depth <= heading.depth) {
        boundaryIndex = cursor
        break
      }
    }

    const nodes = tree.children.slice(index + 1, boundaryIndex)
    const metadata = collectMetadata(nodes)
    if (normalizedStatus(metadata['状态']) !== '题面、官方答案均已复核') {
      skipped.push({ externalId, reason: metadata['状态'] || '未提供严格的已复核状态' })
      index = boundaryIndex - 1
      continue
    }

    const entryEnd =
      boundaryIndex < tree.children.length
        ? sourceOffset(tree.children[boundaryIndex], 'start') ?? options.source.length
        : options.source.length
    const questionText = findSection(
      options.source,
      nodes,
      entryEnd,
      (label) => label === '题目',
    )
    const officialAnswer = findSection(
      options.source,
      nodes,
      entryEnd,
      (label) => /^官方答案(?:整理)?$/.test(label),
    )
    const validationError = requiredMetadata(externalId, metadata, questionText, officialAnswer)
    if (validationError) {
      errors.push({ externalId, reason: validationError })
      index = boundaryIndex - 1
      continue
    }

    const combinedFile = metadata['原卷及答案']
    const paperName = metadata['试卷']!
    const questionNumber = metadata['题号']!
    const originalFile = metadata['原卷'] ?? combinedFile!
    const answerFile = metadata['答案'] ?? combinedFile!
    const questionPage = metadata['题面页']!
    const answerPage = metadata['答案页']!
    const contentHash = sha256(
      JSON.stringify({
        externalId,
        subject: options.subject,
        topic: options.topic,
        questionText,
        officialAnswer,
        paperName,
        questionNumber,
        originalFile,
        questionPage,
        answerFile,
        answerPage,
      }),
    )

    items.push({
      externalId,
      subject: options.subject,
      topic: options.topic,
      questionText,
      officialAnswer,
      paperName,
      questionNumber,
      originalFile,
      questionPage,
      answerFile,
      answerPage,
      knowledgePoints: splitList(metadata['考点']),
      difficulty: metadata['难度'],
      suitability: metadata['适配'],
      verificationStatus: '题面、官方答案均已复核',
      verified: true,
      sourceRelativePath: options.sourceRelativePath,
      contentHash,
      source: {
        paperName,
        questionNumber,
        originalFile,
        questionPage,
        answerFile,
        answerPage,
        recordFile: options.sourceRelativePath,
      },
    })
    index = boundaryIndex - 1
  }

  return { entriesFound, items, skipped, errors }
}

function topicFromPath(relativeFile: string, explicitTopic?: string) {
  if (explicitTopic) return explicitTopic
  const directory = dirname(normalizeRelativePath(relativeFile))
  return directory === '.' ? '未分类' : directory.split('/')[0]
}

async function sourceFiles(
  source: z.infer<typeof QuestionBankSourceSchema>,
  configDirectory: string,
) {
  const root = resolve(configDirectory, source.root)
  const rootStats = await stat(root).catch(() => null)
  if (!rootStats) throw new Error(`题库源不存在：${root}`)
  if (rootStats.isFile()) {
    if (!['.md', '.markdown'].includes(extname(root).toLowerCase())) {
      throw new Error(`题库源文件必须是 Markdown：${root}`)
    }
    return { root: dirname(root), files: [basename(root)] }
  }
  if (!rootStats.isDirectory()) throw new Error(`题库源不是文件或目录：${root}`)
  const files = await fg(source.include ?? ['**/*.md', '**/*.markdown'], {
    cwd: root,
    onlyFiles: true,
    unique: true,
    dot: false,
    followSymbolicLinks: false,
    ignore: source.exclude ?? ['README.md', '索引.md'],
  })
  return { root, files }
}

export async function collectQuestionBankItems(
  config: QuestionBankImportConfig,
  configDirectory: string,
) {
  const byExternalId = new Map<string, QuestionBankItem>()
  const skipped: QuestionParseResult['skipped'] = []
  const errors: QuestionParseResult['errors'] = []
  let filesScanned = 0
  let entriesFound = 0

  for (const source of config.sources) {
    const discovered = await sourceFiles(source, configDirectory)
    const prefix = source.pathPrefix
      ? normalizeRelativePath(source.pathPrefix).replace(/^\/+|\/+$/g, '')
      : basename(discovered.root)
    for (const relativeFile of discovered.files) {
      filesScanned += 1
      const text = (await readFile(resolve(discovered.root, relativeFile), 'utf8')).replace(/^\uFEFF/, '')
      const sourceRelativePath = normalizeRelativePath(`${prefix}/${relativeFile}`)
      const parsed = parseQuestionBankMarkdown({
        source: text,
        sourceRelativePath,
        subject: source.subject,
        topic: topicFromPath(relativeFile, source.topic),
      })
      entriesFound += parsed.entriesFound
      skipped.push(...parsed.skipped)
      errors.push(...parsed.errors)

      for (const item of parsed.items) {
        const existing = byExternalId.get(item.externalId)
        if (existing && existing.contentHash !== item.contentHash) {
          errors.push({
            externalId: item.externalId,
            reason: `同一编号在多个文件中内容不一致：${existing.sourceRelativePath} / ${item.sourceRelativePath}`,
          })
          continue
        }
        byExternalId.set(item.externalId, item)
      }
    }
  }

  return {
    filesScanned,
    entriesFound,
    items: Array.from(byExternalId.values()).sort((left, right) =>
      left.externalId.localeCompare(right.externalId),
    ),
    skipped,
    errors,
  }
}

interface ImportResponse {
  ok?: boolean
  inserted?: number
  updated?: number
  unchanged?: number
  errors?: unknown[]
}

export async function runQuestionBankImport(options: { configPath: string; dryRun: boolean }) {
  loadLocalEnvironment()
  const loaded = await readJsonConfig(options.configPath, QuestionBankImportConfigSchema)
  const collected = await collectQuestionBankItems(loaded.config, dirname(loaded.absolutePath))

  console.log(
    `扫描 ${collected.filesScanned} 个 Markdown，发现 ${collected.entriesFound} 个编号条目；` +
      `可导入 ${collected.items.length}，未满足复核条件 ${collected.skipped.length}，格式错误 ${collected.errors.length}。`,
  )
  collected.skipped.forEach((item) => console.log(`[跳过] ${item.externalId}：${item.reason}`))
  if (collected.errors.length) {
    throw new Error(collected.errors.map((item) => `[${item.externalId}] ${item.reason}`).join('\n'))
  }

  if (options.dryRun) {
    collected.items.forEach((item) =>
      console.log(`[dry-run] ${item.externalId} ${item.paperName} ${item.questionNumber}`),
    )
    return { ...collected, dryRun: true }
  }

  if (collected.items.length) {
    const token = requiredEnvironment(loaded.config.tokenEnv ?? 'KNOWLEDGE_SYNC_TOKEN')
    const platformUrl = loaded.config.platformUrl ?? process.env.PLATFORM_URL
    for (const batch of chunkArray(collected.items, loaded.config.batchSize ?? 50)) {
      const response = await invokeFunction<ImportResponse>({
        functionName: 'question-bank-import',
        platformUrl,
        endpoint: loaded.config.endpoint,
        token,
        tokenHeader: 'x-sync-token',
        body: { items: batch, verifiedOnly: true },
      })
      if (response.ok === false || response.errors?.length) {
        throw new Error(`题库批次未完全导入：${JSON.stringify(response.errors ?? [])}`)
      }
    }
  }

  console.log(`题库导入完成：${collected.items.length} 条。`)
  return { ...collected, dryRun: false }
}

function printHelp() {
  console.log(`用法：npm run question-bank:import -- --config <配置.json> [--dry-run]

仅导入状态严格为“题面、官方答案均已复核”且题面、官方答案、来源字段完整的条目。`)
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c', default: 'question-bank-import.local.json' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  })
  if (values.help) return printHelp()
  await runQuestionBankImport({
    configPath: values.config ?? 'question-bank-import.local.json',
    dryRun: values['dry-run'] ?? false,
  })
}

if (isDirectExecution(import.meta.url)) main().catch(reportCliError)
