import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import dotenv from 'dotenv'
import type { output, ZodTypeAny } from 'zod'

let environmentLoaded = false

export function loadLocalEnvironment(cwd = process.cwd()) {
  if (environmentLoaded) return

  dotenv.config({ path: resolve(cwd, '.env.local'), override: false, quiet: true })
  dotenv.config({ path: resolve(cwd, '.env'), override: false, quiet: true })
  environmentLoaded = true
}

export async function readJsonConfig<Schema extends ZodTypeAny>(
  configPath: string,
  schema: Schema,
): Promise<{ config: output<Schema>; absolutePath: string }> {
  const absolutePath = resolve(configPath)
  let raw: string

  try {
    raw = await readFile(absolutePath, 'utf8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`无法读取配置文件 ${absolutePath}：${message}`)
  }

  let value: unknown
  try {
    value = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`配置文件不是有效 JSON（${absolutePath}）：${message}`)
  }

  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('；')
    throw new Error(`配置校验失败（${absolutePath}）：${details}`)
  }

  return { config: parsed.data as output<Schema>, absolutePath }
}

export function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`缺少环境变量 ${name}`)
  return value
}

export function isDirectExecution(metaUrl: string) {
  const entry = process.argv[1]
  if (!entry) return false

  const entryUrl = pathToFileURL(resolve(entry)).href
  return process.platform === 'win32'
    ? entryUrl.toLowerCase() === metaUrl.toLowerCase()
    : entryUrl === metaUrl
}

export function reportCliError(error: unknown) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
