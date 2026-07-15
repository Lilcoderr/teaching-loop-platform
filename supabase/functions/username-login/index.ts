import { handleOptions } from '../_shared/cors.ts'
import { asErrorResponse, HttpError, json, readJson, requireString } from '../_shared/http.ts'
import { publicClient, serviceClient, sha256 } from '../_shared/auth.ts'
import { publicAccountDirectoryEntry } from './logic.ts'

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  try {
    if (request.method !== 'POST') throw new HttpError(405, '仅支持 POST', 'method_not_allowed')
    const body = await readJson<Record<string, unknown>>(request)
    const db = serviceClient()
    if (body.action === 'list_accounts') {
      const { data, error } = await db.from('profiles')
        .select('id,display_name,role')
        .eq('status', 'active')
        .order('role')
        .order('display_name')
      if (error) throw error
      return json(request, {
        accounts: (data ?? []).map(publicAccountDirectoryEntry),
      })
    }

    const identifier = requireString(body.username, '账号', 64)
    const normalizedIdentifier = identifier.toLowerCase()
    const password = requireString(body.password, '密码', 256)
    const usernameHash = await sha256(normalizedIdentifier)
    const ipHash = await sha256((request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim())
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const profileQuery = db.from('profiles').select('id,status')
    const profilePromise = ACCOUNT_ID.test(identifier)
      ? profileQuery.eq('id', identifier).maybeSingle()
      : profileQuery.eq('username', normalizedIdentifier).maybeSingle()
    const cleanupPromise = db.from('auth_login_attempts').delete()
      .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    const [pairResult, usernameResult, ipResult, profileResult, cleanupResult] = await Promise.all([
      db.from('auth_login_attempts').select('id', { count: 'exact', head: true })
        .eq('username_hash', usernameHash).eq('ip_hash', ipHash).eq('succeeded', false).gte('created_at', since),
      db.from('auth_login_attempts').select('id', { count: 'exact', head: true })
        .eq('username_hash', usernameHash).eq('succeeded', false).gte('created_at', since),
      db.from('auth_login_attempts').select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash).eq('succeeded', false).gte('created_at', since),
      profilePromise,
      cleanupPromise,
    ])
    const rateLimitError = pairResult.error || usernameResult.error || ipResult.error
    if (rateLimitError) throw rateLimitError
    if (profileResult.error) throw profileResult.error
    if (cleanupResult.error) console.error('Login-attempt cleanup failed', cleanupResult.error.message)
    const pairFailures = pairResult.count
    const usernameFailures = usernameResult.count
    const ipFailures = ipResult.count
    if ((pairFailures ?? 0) >= 10 || (usernameFailures ?? 0) >= 15 || (ipFailures ?? 0) >= 50) {
      throw new HttpError(429, '登录尝试过多，请 15 分钟后再试', 'login_rate_limited')
    }
    const profile = profileResult.data
    if (!profile || profile.status !== 'active') {
      await db.from('auth_login_attempts').insert({ username_hash: usernameHash, ip_hash: ipHash, succeeded: false })
      throw new HttpError(401, '用户名或密码错误', 'invalid_credentials')
    }
    const { data: userResult, error: userError } = await db.auth.admin.getUserById(profile.id)
    const email = userResult.user?.email
    if (userError || !email) {
      await db.from('auth_login_attempts').insert({ username_hash: usernameHash, ip_hash: ipHash, succeeded: false })
      throw new HttpError(401, '用户名或密码错误', 'invalid_credentials')
    }
    const { data, error } = await publicClient().auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      await db.from('auth_login_attempts').insert({ username_hash: usernameHash, ip_hash: ipHash, succeeded: false })
      throw new HttpError(401, '用户名或密码错误', 'invalid_credentials')
    }
    await db.from('auth_login_attempts').insert({ username_hash: usernameHash, ip_hash: ipHash, succeeded: true })
    return json(request, { accessToken: data.session.access_token, refreshToken: data.session.refresh_token })
  } catch (error) {
    return asErrorResponse(request, error)
  }
})
