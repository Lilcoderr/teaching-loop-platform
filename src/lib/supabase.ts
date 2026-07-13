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

export async function invokeFunction<T>(name: string, body?: unknown) {
  if (!supabase) throw new Error('Supabase 尚未配置')
  const { data, error } = await supabase.functions.invoke<T>(name, {
    body: body as Record<string, unknown> | undefined,
  })
  if (error) throw error
  if (data === null) throw new Error(`${name} 返回了空响应`)
  return data
}
