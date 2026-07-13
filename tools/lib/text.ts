import { createHash } from 'node:crypto'
import { posix, relative, sep } from 'node:path'

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeRelativePath(value: string) {
  return value.split(sep).join(posix.sep).replace(/^\.\//, '')
}

export function relativePosix(from: string, to: string) {
  return normalizeRelativePath(relative(from, to))
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export function splitList(value?: string) {
  if (!value) return []
  return value
    .split(/[、,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function chunkArray<T>(items: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}
