import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const loginFunction = readFileSync('supabase/functions/username-login/index.ts', 'utf8')

describe('username login critical path', () => {
  it('runs rate-limit checks, stale-log cleanup, and profile lookup in one parallel batch', () => {
    const parallelBlock = loginFunction.slice(
      loginFunction.indexOf("const profileQuery = db.from('profiles')"),
      loginFunction.indexOf('const rateLimitError ='),
    )

    expect(parallelBlock).toContain('const profilePromise =')
    expect(parallelBlock).toContain('const cleanupPromise =')
    expect(parallelBlock).toContain('await Promise.all([')
    expect(parallelBlock).toContain('profilePromise,')
    expect(parallelBlock).toContain('cleanupPromise,')
    expect(parallelBlock.match(/auth_login_attempts'\)\.select/g)).toHaveLength(3)
  })

  it('fails closed when any rate-limit query fails', () => {
    expect(loginFunction).toContain('const rateLimitError = pairResult.error || usernameResult.error || ipResult.error')
    expect(loginFunction).toContain('if (rateLimitError) throw rateLimitError')
    expect(loginFunction.indexOf('if (rateLimitError) throw rateLimitError'))
      .toBeLessThan(loginFunction.indexOf("publicClient().auth.signInWithPassword"))
  })
})
