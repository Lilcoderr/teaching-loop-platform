import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { z } from 'zod'

import { invokeFunction } from './lib/http'
import {
  isDirectExecution,
  loadLocalEnvironment,
  readJsonConfig,
  reportCliError,
  requiredEnvironment,
} from './lib/runtime'

export const MemoryPullConfigSchema = z.object({
  platformUrl: z.string().url().optional(),
  endpoint: z.string().url().optional(),
  tokenEnv: z.string().trim().min(1).default('TEACHER_ACCESS_TOKEN'),
  outputDir: z.string().trim().min(1),
  studentIds: z.array(z.string().trim().min(1)).default([]),
  since: z.string().datetime({ offset: true }).optional(),
}).strict()

export type MemoryPullConfig = z.infer<typeof MemoryPullConfigSchema>

const ExportStudentSchema = z.object({
  studentId: z.string().min(1),
  displayName: z.string().min(1),
  markdown: z.string(),
  data: z.unknown().optional(),
})

const ExportResponseSchema = z.object({
  generatedAt: z.string().min(1),
  students: z.array(ExportStudentSchema),
})

export function assertMemoryOutputDirectory(outputDirectory: string) {
  const absolute = resolve(outputDirectory)
  if (basename(absolute) !== '网站同步' || basename(dirname(absolute)).toLowerCase() !== 'memory-bank') {
    throw new Error(`outputDir 必须明确指向 memory-bank/网站同步，当前为：${absolute}`)
  }
  return absolute
}

export function safeFileComponent(value: string) {
  const invalidCharacters = '<>:"/\\|?*'
  const sanitized = Array.from(value.normalize('NFKC'))
    .map((character) =>
      character.charCodeAt(0) < 32 || invalidCharacters.includes(character) ? '_' : character,
    )
    .join('')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80)
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : '未命名学生'
}

export function buildExportFileName(studentId: string, displayName: string, generatedAt: string) {
  const timestamp = generatedAt.replace(/[^0-9]/g, '').slice(0, 17) || Date.now().toString()
  const id = safeFileComponent(studentId).slice(0, 36)
  return `${timestamp}-${safeFileComponent(displayName)}-${id}.md`
}

function formatExport(
  student: z.infer<typeof ExportStudentSchema>,
  generatedAt: string,
) {
  return [
    '<!-- 由 student-platform/tools/memory-pull.ts 追加导出；请勿将此文件作为网站回写源。 -->',
    `<!-- studentId: ${JSON.stringify(student.studentId)}; generatedAt: ${JSON.stringify(generatedAt)} -->`,
    '',
    student.markdown.trim(),
    '',
  ].join('\n')
}

async function writeAppendOnly(
  outputDirectory: string,
  preferredFileName: string,
  content: string,
) {
  const extensionIndex = preferredFileName.lastIndexOf('.')
  const stem = preferredFileName.slice(0, extensionIndex)
  const extension = preferredFileName.slice(extensionIndex)

  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const fileName = attempt === 0 ? preferredFileName : `${stem}-${attempt}${extension}`
    const target = resolve(outputDirectory, fileName)
    if (dirname(target) !== outputDirectory) throw new Error('生成的导出路径越过了 outputDir')
    try {
      await writeFile(target, content, { encoding: 'utf8', flag: 'wx' })
      return target
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }

  throw new Error(`同一时间戳下导出文件过多：${preferredFileName}`)
}

export async function runMemoryPull(options: { configPath: string; since?: string }) {
  loadLocalEnvironment()
  const loaded = await readJsonConfig(options.configPath, MemoryPullConfigSchema)
  const outputDirectory = assertMemoryOutputDirectory(
    resolve(dirname(loaded.absolutePath), loaded.config.outputDir),
  )
  const token = requiredEnvironment(loaded.config.tokenEnv ?? 'TEACHER_ACCESS_TOKEN')
  const studentIds = loaded.config.studentIds ?? []
  const since = options.since ?? loaded.config.since
  if (since && Number.isNaN(Date.parse(since))) throw new Error(`since 不是有效日期时间：${since}`)

  const payload = await invokeFunction<unknown>({
    functionName: 'export-memory',
    platformUrl: loaded.config.platformUrl ?? process.env.PLATFORM_URL,
    endpoint: loaded.config.endpoint,
    token,
    tokenHeader: 'authorization',
    body: {
      ...(studentIds.length ? { studentIds } : {}),
      ...(since ? { since } : {}),
    },
  })
  const parsed = ExportResponseSchema.safeParse(payload)
  if (!parsed.success) throw new Error(`export-memory 响应格式错误：${parsed.error.message}`)

  await mkdir(outputDirectory, { recursive: true })
  const written: string[] = []
  for (const student of parsed.data.students) {
    const fileName = buildExportFileName(
      student.studentId,
      student.displayName,
      parsed.data.generatedAt,
    )
    written.push(
      await writeAppendOnly(
        outputDirectory,
        fileName,
        formatExport(student, parsed.data.generatedAt),
      ),
    )
  }

  console.log(`已追加导出 ${written.length} 份学生学情到 ${outputDirectory}；未删除或覆盖已有文件。`)
  written.forEach((filePath) => console.log(`- ${filePath}`))
  return written
}

function printHelp() {
  console.log(`用法：npm run memory:pull -- --config <配置.json> [--since <ISO 时间>]

配置路径默认 memory-pull.local.json。工具只会在 memory-bank/网站同步 中追加 Markdown。`)
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c', default: 'memory-pull.local.json' },
      since: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
    strict: true,
  })
  if (values.help) return printHelp()
  await runMemoryPull({
    configPath: values.config ?? 'memory-pull.local.json',
    since: values.since,
  })
}

if (isDirectExecution(import.meta.url)) main().catch(reportCliError)
