export interface FunctionRequestOptions {
  platformUrl?: string
  endpoint?: string
  functionName: string
  token?: string
  tokenHeader?: 'authorization' | 'x-sync-token'
  body: unknown
  timeoutMs?: number
}

export function resolveFunctionUrl(
  functionName: string,
  platformUrl?: string,
  endpoint?: string,
) {
  const explicitEndpoint = endpoint?.trim()
  if (explicitEndpoint) {
    try {
      return new URL(explicitEndpoint).toString()
    } catch {
      throw new Error(`函数地址不是有效 URL：${explicitEndpoint}`)
    }
  }

  const base = platformUrl?.trim().replace(/\/+$/, '')
  if (!base) throw new Error('缺少 PLATFORM_URL，且配置中未提供 platformUrl 或 endpoint')

  let parsed: URL
  try {
    parsed = new URL(base)
  } catch {
    throw new Error(`PLATFORM_URL 不是有效 URL：${base}`)
  }

  const path = parsed.pathname.replace(/\/+$/, '')
  if (path.endsWith('/functions/v1')) {
    parsed.pathname = `${path}/${functionName}`
  } else {
    parsed.pathname = `${path}/functions/v1/${functionName}`
  }

  return parsed.toString()
}

export async function invokeFunction<T>({
  functionName,
  platformUrl,
  endpoint,
  token,
  tokenHeader,
  body,
  timeoutMs = 45_000,
}: FunctionRequestOptions): Promise<T> {
  const url = resolveFunctionUrl(functionName, platformUrl, endpoint)
  const headers: Record<string, string> = { 'content-type': 'application/json' }

  if (tokenHeader === 'x-sync-token' && token) headers['x-sync-token'] = token
  if (tokenHeader === 'authorization' && token) headers.authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${functionName} 请求失败：${message}`)
  }

  const raw = await response.text()
  let payload: unknown = null
  if (raw) {
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = raw
    }
  }

  if (!response.ok) {
    const detail =
      typeof payload === 'object' && payload && 'error' in payload
        ? String(payload.error)
        : typeof payload === 'string'
          ? payload.slice(0, 300)
          : response.statusText
    throw new Error(`${functionName} 返回 ${response.status}：${detail}`)
  }

  return payload as T
}
