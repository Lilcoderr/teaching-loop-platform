import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync('supabase/functions/analyze-submission/index.ts', 'utf8')

describe('submission analysis truthfulness guard', () => {
  it('only calls the vision model when at least one image attachment is available', () => {
    expect(source).toContain("String(attachment.mime_type).startsWith('image/')")
    expect(source).toContain('imageAttachments.length > 0')
    expect(source).toContain('附件未包含可识别图片，已转人工复核')
  })
})
