import { handleOptions } from '../_shared/cors.ts'
import { publicClient, requireActor, sha256 } from '../_shared/auth.ts'
import { asErrorResponse, HttpError, json, readJson, requireString } from '../_shared/http.ts'

const USERNAME = /^[A-Za-z0-9_.-]{2,40}$/
const ROLES = new Set(['teacher', 'student', 'parent'])
const TOKEN_OPERATIONS = new Set(['knowledge', 'question_bank'])
const SUBJECTS = new Set(['math', 'physics', 'chemistry'])

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function listStudentFiles(
  db: ReturnType<typeof import('../_shared/auth.ts')['serviceClient']>,
  studentId: string,
): Promise<string[]> {
  const files: string[] = []
  const folders = [studentId]
  while (folders.length) {
    const folder = folders.shift()!
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await db.storage.from('submissions').list(folder, { limit: 100, offset })
      if (error) throw error
      for (const item of data ?? []) {
        const path = `${folder}/${item.name}`
        if (item.id) files.push(path)
        else if (item.name !== '.' && item.name !== '..') folders.push(path)
      }
      if ((data?.length ?? 0) < 100) break
      if (files.length + folders.length > 10_000) throw new HttpError(409, '学生文件过多，请联系管理员分批处理', 'storage_cleanup_too_large')
    }
  }
  return files
}

Deno.serve(async (request) => {
  const options = handleOptions(request)
  if (options) return options
  try {
    if (request.method !== 'POST') throw new HttpError(405, '仅支持 POST', 'method_not_allowed')
    const { actor, db } = await requireActor(request, { allowPasswordChange: true })
    const body = await readJson<Record<string, unknown>>(request)
    const action = requireString(body.action, 'action', 40)

    if (action === 'change_password') {
      const currentPassword = requireString(body.currentPassword, '当前密码', 256)
      const newPassword = requireString(body.newPassword, '新密码', 256)
      if (newPassword.length < 10) throw new HttpError(400, '新密码至少 10 位', 'weak_password')
      if (currentPassword === newPassword) throw new HttpError(400, '新密码不能与当前密码相同', 'password_unchanged')
      const { data: authUser, error: userError } = await db.auth.admin.getUserById(actor.id)
      const email = authUser.user?.email
      if (userError || !email) throw new HttpError(401, '无法验证当前账号', 'reauthentication_failed')
      const { error: verificationError } = await publicClient().auth.signInWithPassword({
        email,
        password: currentPassword,
      })
      if (verificationError) throw new HttpError(401, '当前密码不正确', 'invalid_current_password')
      const { error: authError } = await db.auth.admin.updateUserById(actor.id, { password: newPassword })
      if (authError) throw authError
      const { error } = await db.from('profiles').update({ must_change_password: false }).eq('id', actor.id)
      if (error) throw error
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'account.password_changed', target_type: 'profile', target_id: actor.id })
      return json(request, { ok: true })
    }
    if (actor.mustChangePassword) throw new HttpError(428, '首次登录必须先修改临时密码', 'password_change_required')
    if (actor.role !== 'teacher') throw new HttpError(403, '仅教师账号可以执行此操作', 'forbidden')

    if (action === 'create') {
      const account = body.account as Record<string, unknown> | undefined
      if (!account) throw new HttpError(400, '缺少账号资料', 'invalid_input')
      const username = requireString(account.username, '用户名', 40).toLowerCase()
      const displayName = requireString(account.displayName, '姓名', 80)
      const role = requireString(account.role, '角色', 20)
      const password = requireString(body.temporaryPassword, '临时密码', 256)
      if (!USERNAME.test(username) || !ROLES.has(role)) throw new HttpError(400, '用户名或角色无效', 'invalid_input')
      if (role === 'teacher') throw new HttpError(409, 'V1 仅允许一个教师账号', 'single_teacher_only')
      if (password.length < 8) throw new HttpError(400, '临时密码至少 8 位', 'weak_password')
      const consentAt = role === 'student' && typeof account.guardianConsentAt === 'string'
        ? Date.parse(account.guardianConsentAt) : Number.NaN
      if (role === 'student' && (!Number.isFinite(consentAt) || consentAt > Date.now() + 5 * 60_000)) {
        throw new HttpError(400, '学生账号必须记录有效的监护人知情时间', 'guardian_consent_required')
      }
      const { data: existing } = await db.from('profiles').select('id').eq('username', username).maybeSingle()
      if (existing) throw new HttpError(409, '用户名已存在', 'username_exists')

      const syntheticEmail = `${crypto.randomUUID()}@accounts.teaching-loop.invalid`
      const { data: authData, error: authError } = await db.auth.admin.createUser({
        email: syntheticEmail,
        password,
        email_confirm: true,
        user_metadata: { username, display_name: displayName },
      })
      if (authError || !authData.user) throw new HttpError(400, authError?.message ?? '创建账号失败', 'account_create_failed')
      const profile = {
        id: authData.user.id,
        username,
        display_name: displayName,
        role,
        avatar_color: typeof account.avatarColor === 'string' ? account.avatarColor.slice(0, 32) : '#2563eb',
        status: account.status === 'disabled' ? 'disabled' : 'active',
        must_change_password: true,
      }
      const { error: profileError } = await db.from('profiles').insert(profile)
      if (profileError) throw profileError
      const linkedIds = Array.isArray(account.linkedStudentIds)
        ? account.linkedStudentIds.filter((value): value is string => typeof value === 'string') : []
      if (role === 'student') {
        const subjects = Array.isArray(account.subjects)
          ? account.subjects.filter((value) => ['math', 'physics', 'chemistry'].includes(String(value))) : []
        const { error } = await db.from('student_profiles').insert({
          id: authData.user.id,
          grade: typeof account.grade === 'string' ? account.grade.slice(0, 40) : '',
          subjects,
          target_score: typeof account.targetScore === 'number' ? account.targetScore : null,
          guardian_consent_at: new Date(consentAt).toISOString(),
        })
        if (error) throw error
      } else if (role === 'parent' && linkedIds.length) {
        const { error } = await db.from('parent_students').insert(linkedIds.map((studentId) => ({ parent_id: authData.user!.id, student_id: studentId })))
        if (error) throw error
      }
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'account.create', target_type: 'profile', target_id: authData.user.id, metadata: { role } })
      return json(request, { ok: true, accountId: authData.user.id }, 201)
    }

    if (action === 'reset_password') {
      const accountId = requireString(body.accountId, 'accountId', 64)
      const temporaryPassword = requireString(body.temporaryPassword ?? body.value, '临时密码', 256)
      if (temporaryPassword.length < 8) throw new HttpError(400, '临时密码至少 8 位', 'weak_password')
      const { data: target } = await db.from('profiles').select('id,role').eq('id', accountId).maybeSingle()
      if (!target || target.role === 'teacher') throw new HttpError(404, '账号不存在或不可重置', 'not_found')
      const { error } = await db.auth.admin.updateUserById(accountId, { password: temporaryPassword })
      if (error) throw error
      await db.from('profiles').update({ must_change_password: true }).eq('id', accountId)
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'account.reset_password', target_type: 'profile', target_id: accountId })
      return json(request, { ok: true })
    }

    if (action === 'set_status') {
      const accountId = requireString(body.accountId, 'accountId', 64)
      const statusValue = body.status ?? body.value
      const status = statusValue === 'active' ? 'active' : statusValue === 'disabled' ? 'disabled' : null
      if (!status) throw new HttpError(400, '账号状态无效', 'invalid_input')
      if (accountId === actor.id && status === 'disabled') throw new HttpError(400, '不能停用当前教师账号', 'invalid_input')
      const { error } = await db.from('profiles').update({ status }).eq('id', accountId)
      if (error) throw error
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'account.set_status', target_type: 'profile', target_id: accountId, metadata: { status } })
      return json(request, { ok: true })
    }

    if (action === 'create_sync_token') {
      const label = requireString(body.label ?? '本地同步工具', '令牌名称', 100)
      const operation = requireString(body.operation, '令牌用途', 30)
      if (!TOKEN_OPERATIONS.has(operation)) throw new HttpError(400, '同步令牌用途无效', 'invalid_input')
      const studentIds = Array.isArray(body.studentIds)
        ? body.studentIds.filter((value): value is string => typeof value === 'string').slice(0, 100) : []
      const subjects = Array.isArray(body.subjects)
        ? body.subjects.filter((value): value is string => typeof value === 'string' && SUBJECTS.has(value)).slice(0, 3) : []
      if (operation === 'knowledge' && !studentIds.length) throw new HttpError(400, '知识同步令牌至少绑定一个学生', 'invalid_input')
      if (!subjects.length) throw new HttpError(400, '同步令牌至少绑定一个科目', 'invalid_input')
      if (studentIds.length) {
        const { count } = await db.from('student_profiles').select('id', { count: 'exact', head: true }).in('id', studentIds)
        if (count !== new Set(studentIds).size) throw new HttpError(400, '令牌包含无效学生', 'invalid_input')
      }
      const token = randomToken()
      const tokenHash = await sha256(token)
      const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : null
      const { data, error } = await db.from('sync_tokens').insert({
        label, token_hash: tokenHash, operation, student_ids: [...new Set(studentIds)],
        subjects: [...new Set(subjects)], created_by: actor.id, expires_at: expiresAt,
      }).select('id').single()
      if (error) throw error
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'sync_token.create', target_type: 'sync_token', target_id: data.id, metadata: { label, operation, studentIds, subjects } })
      return json(request, { ok: true, tokenId: data.id, token }, 201)
    }

    if (action === 'revoke_sync_token') {
      const tokenId = requireString(body.tokenId, 'tokenId', 64)
      const { error } = await db.from('sync_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', tokenId)
      if (error) throw error
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'sync_token.revoke', target_type: 'sync_token', target_id: tokenId })
      return json(request, { ok: true })
    }

    if (action === 'request_data_deletion') {
      const studentId = requireString(body.studentId, 'studentId', 64)
      const reason = requireString(body.reason, '删除原因', 1000)
      const { data, error } = await db.from('data_deletion_requests').insert({ student_id: studentId, requested_by: actor.id, reason }).select('id').single()
      if (error) throw error
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'student_data.deletion_requested', target_type: 'student', target_id: studentId, metadata: { requestId: data.id } })
      return json(request, { ok: true, requestId: data.id, requiresConfirmation: true })
    }

    if (action === 'delete_student_data') {
      const studentId = requireString(body.studentId, 'studentId', 64)
      const requestId = requireString(body.requestId, 'requestId', 64)
      const { data: target } = await db.from('profiles').select('id,username,display_name,role').eq('id', studentId).maybeSingle()
      if (!target || target.role !== 'student') throw new HttpError(404, '学生账号不存在', 'not_found')
      if (body.confirmation !== `DELETE:${target.username}`) {
        throw new HttpError(400, `需输入 DELETE:${target.username} 才能确认`, 'confirmation_required')
      }
      const { data: deletionRequest } = await db.from('data_deletion_requests').select('id,status').eq('id', requestId).eq('student_id', studentId).maybeSingle()
      if (!deletionRequest || deletionRequest.status !== 'pending') throw new HttpError(409, '删除申请不存在或已处理', 'invalid_deletion_request')
      const paths = await listStudentFiles(db, studentId)
      for (let offset = 0; offset < paths.length; offset += 100) {
        const { error: storageError } = await db.storage.from('submissions').remove(paths.slice(offset, offset + 100))
        if (storageError) throw storageError
      }
      await db.from('audit_logs').insert({ actor_id: actor.id, action: 'student_data.deleted', target_type: 'student', target_id: studentId, metadata: { requestId } })
      const { error } = await db.auth.admin.deleteUser(studentId)
      if (error) throw error
      return json(request, { ok: true, deletedStudentId: studentId })
    }

    throw new HttpError(400, '不支持的账号操作', 'invalid_action')
  } catch (error) {
    return asErrorResponse(request, error)
  }
})
