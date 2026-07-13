const DEFAULT_HEADERS = 'authorization, x-client-info, apikey, content-type, x-sync-token'

export function corsHeaders(request?: Request): Record<string, string> {
  const configured = Deno.env.get('ALLOWED_ORIGINS')?.split(',').map((value) => value.trim()).filter(Boolean)
  const origin = request?.headers.get('origin') ?? '*'
  const allowedOrigin = !configured?.length || configured.includes('*') || configured.includes(origin) ? origin : configured[0]
  return {
    'Access-Control-Allow-Origin': allowedOrigin || '*',
    'Access-Control-Allow-Headers': DEFAULT_HEADERS,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

export function handleOptions(request: Request): Response | null {
  return request.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders(request) }) : null
}
