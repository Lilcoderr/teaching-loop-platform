import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { HttpError } from './http.ts'

export type AppRole = 'teacher' | 'student' | 'parent'
export interface Actor {
  id: string
  username: string
  displayName: string
  role: AppRole
  mustChangePassword: boolean
}

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export function serviceClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function publicClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new HttpError(401, '请先登录', 'unauthorized')
  return match[1]
}

export async function requireActor(
  request: Request,
  options: { allowPasswordChange?: boolean } = {},
): Promise<{ actor: Actor; db: SupabaseClient; token: string }> {
  const token = bearerToken(request)
  const db = serviceClient()
  const { data: authData, error: authError } = await db.auth.getUser(token)
  if (authError || !authData.user) throw new HttpError(401, '登录状态已失效', 'unauthorized')
  const { data: profile, error } = await db.from('profiles')
    .select('id,username,display_name,role,status,must_change_password')
    .eq('id', authData.user.id).maybeSingle()
  if (error || !profile || profile.status !== 'active') throw new HttpError(403, '账号不存在或已停用', 'account_disabled')
  await db.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', profile.id)
  const result = {
    db,
    token,
    actor: {
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      role: profile.role,
      mustChangePassword: profile.must_change_password,
    },
  }
  if (result.actor.mustChangePassword && !options.allowPasswordChange) {
    throw new HttpError(428, '首次登录必须先修改临时密码', 'password_change_required')
  }
  return result
}

export async function requireTeacher(request: Request): Promise<{ actor: Actor; db: SupabaseClient; token: string }> {
  const auth = await requireActor(request)
  if (auth.actor.role !== 'teacher') throw new HttpError(403, '仅教师账号可以执行此操作', 'forbidden')
  return auth
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

export async function requireSyncToken(
  request: Request,
  operation: 'knowledge' | 'question_bank',
): Promise<{ db: SupabaseClient; tokenId: string; studentIds: string[]; subjects: string[] }> {
  const token = request.headers.get('x-sync-token')?.trim()
  if (!token || token.length < 24 || token.length > 256) throw new HttpError(401, '同步令牌无效', 'invalid_sync_token')
  const db = serviceClient()
  const hash = await sha256(token)
  const now = new Date().toISOString()
  const { data, error } = await db.from('sync_tokens').select('id,operation,student_ids,subjects,expires_at,revoked_at')
    .eq('token_hash', hash).maybeSingle()
  if (error || !data || data.operation !== operation || data.revoked_at || (data.expires_at && data.expires_at <= now)) {
    throw new HttpError(401, '同步令牌无效或已失效', 'invalid_sync_token')
  }
  await db.from('sync_tokens').update({ last_used_at: now }).eq('id', data.id)
  return { db, tokenId: data.id, studentIds: data.student_ids ?? [], subjects: data.subjects ?? [] }
}

export async function assertStudentAccess(db: SupabaseClient, actor: Actor, studentId: string): Promise<void> {
  if (actor.role === 'teacher' || (actor.role === 'student' && actor.id === studentId)) return
  void db
  throw new HttpError(403, '无权访问该学生数据', 'forbidden')
}
