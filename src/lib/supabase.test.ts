import { describe, expect, it } from 'vitest'
import { functionErrorMessage } from './supabase'

describe('functionErrorMessage', () => {
  it('uses the safe business message returned by an Edge Function', async () => {
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error: '当前密码不正确', code: 'invalid_current_password' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    })

    await expect(functionErrorMessage(error)).resolves.toBe('当前密码不正确')
  })

  it('falls back to the SDK error when the response has no business message', async () => {
    await expect(functionErrorMessage(new Error('网络连接失败'))).resolves.toBe('网络连接失败')
  })
})
