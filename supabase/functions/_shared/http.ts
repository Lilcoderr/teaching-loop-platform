import { corsHeaders } from './cors.ts'

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'request_error') {
    super(message)
  }
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new HttpError(415, '请求必须使用 application/json', 'invalid_content_type')
  }
  try {
    return await request.json() as T
  } catch {
    throw new HttpError(400, '请求 JSON 格式无效', 'invalid_json')
  }
}

export function asErrorResponse(request: Request, error: unknown): Response {
  if (error instanceof HttpError) {
    return json(request, { error: error.message, code: error.code }, error.status)
  }
  console.error(error)
  return json(request, { error: '服务暂时不可用，请稍后重试', code: 'internal_error' }, 500)
}

export function requireString(value: unknown, name: string, max = 12000): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${name} 不能为空`, 'invalid_input')
  const result = value.trim()
  if (result.length > max) throw new HttpError(400, `${name} 过长`, 'invalid_input')
  return result
}

export function optionalString(value: unknown, max = 12000): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, '文本字段格式无效', 'invalid_input')
  return value.trim()
}
