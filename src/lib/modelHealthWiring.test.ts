import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const settingsFunction = readFileSync('supabase/functions/settings/index.ts', 'utf8')

describe('server-side model health check', () => {
  it('checks the configured text model with a small request and never returns secret values', () => {
    expect(settingsFunction).toContain("body.action === 'health_check'")
    expect(settingsFunction).toContain("chatModelConfigured('text', current?.text_model)")
    expect(settingsFunction).toContain('maxOutputTokens: 80')
    expect(settingsFunction).toContain('timeoutMs: 12_000')
    expect(settingsFunction).toContain("parsed?.ok !== true")
    expect(settingsFunction).not.toContain('AI_TEXT_API_KEY')
    expect(settingsFunction).not.toContain('AI_API_KEY')
  })
})
