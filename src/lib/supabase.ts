import { createClient } from '@supabase/supabase-js'
import { runtime } from './runtime'

export const supabase = runtime.demoMode
  ? null
  : createClient(runtime.supabaseUrl, runtime.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })

export async function functionErrorMessage(error: unknown): Promise<string> {
  const fallback = error instanceof Error && error.message ? error.message : '服务请求失败，请稍后重试'
  const context = error && typeof error === 'object'
    ? (error as { context?: { clone?: () => { json?: () => Promise<unknown> } } }).context
    : undefined
  if (!context || typeof context.clone !== 'function') return fallback
  try {
    const copy = context.clone()
    if (typeof copy.json !== 'function') return fallback
    const payload = await copy.json()
    if (payload && typeof payload === 'object') {
      const message = (payload as { error?: unknown }).error
      if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 500)
    }
  } catch {
    // Some clients expose an already-consumed response; retain the SDK message.
  }
  return fallback
}

export async function invokeFunction<T>(name: string, body?: unknown) {
  if (!supabase) throw new Error('Supabase 尚未配置')
  const { data, error } = await supabase.functions.invoke<T>(name, {
    body: body as Record<string, unknown> | undefined,
  })
  if (error) throw new Error(await functionErrorMessage(error))
  if (data === null) throw new Error(`${name} 返回了空响应`)
  return data
}
