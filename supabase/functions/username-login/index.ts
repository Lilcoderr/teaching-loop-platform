import { handleOptions } from '../_shared/cors.ts'
import { asErrorResponse, HttpError, json, readJson, requireString } from '../_shared/http.ts'
import { publicClient, serviceClient, sha256 } from '../_shared/auth.ts'

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  try {
    if (request.method !== 'POST') throw new HttpError(405, '仅支持 POST', 'method_not_allowed')
    const body = await readJson<Record<string, unknown>>(request)
    const username = requireString(body.username, '用户名', 40).toLowerCase()
    const password = requireString(body.password, '密码', 256)
    const db = serviceClient()
    const usernameHash = await sha256(username)
    const ipHash = await sha256((request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim())
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const [{ count: pairFailures }, { count: usernameFailures }, { count: ipFailures }] = await Promise.all([
      db.from('auth_login_attempts').select('id', { count: 'exact', head: true })
        .eq('username_hash', usernameHash).eq('ip_hash', ipHash).eq('succeeded', false).gte('created_at', since),
      db.from('auth_login_attempts').select('id', { count: 'exact', head: true })
        .eq('username_hash', usernameHash).eq('succeeded', false).gte('created_at', since),
      db.from('auth_login_attempts').select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash).eq('succeeded', false).gte('created_at', since),
    ])
    if ((pairFailures ?? 0) >= 10 || (usernameFailures ?? 0) >= 15 || (ipFailures ?? 0) >= 50) {
      throw new HttpError(429, '登录尝试过多，请 15 分钟后再试', 'login_rate_limited')
    }
    await db.from('auth_login_attempts').delete().lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    const { data: profile } = await db.from('profiles').select('id,status').eq('username', username).maybeSingle()
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
