export interface ModelMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<Record<string, unknown>>
}

export interface ModelResult {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
}

type ModelKind = 'text' | 'vision' | 'embedding'
export type ChatModelKind = 'text' | 'vision'

function configuredValue(kind: ModelKind, suffix: 'BASE_URL' | 'API_KEY'): string | undefined {
  return Deno.env.get(`AI_${kind.toUpperCase()}_${suffix}`)?.trim() || Deno.env.get(`AI_${suffix}`)?.trim()
}

function endpoint(path: string, kind: ModelKind): string | null {
  const base = configuredValue(kind, 'BASE_URL')?.replace(/\/$/, '')
  return base ? `${base}${path}` : null
}

function selectedChatModel(kind: ChatModelKind, requestedModel?: string): string {
  const configuredModel = kind === 'vision'
    ? Deno.env.get('AI_VISION_MODEL')?.trim()
    : Deno.env.get('AI_TEXT_MODEL')?.trim()
  return configuredModel || requestedModel?.trim() || (kind === 'text' ? 'deepseek-chat' : '')
}

export function chatModelConfigured(kind: ChatModelKind, requestedModel?: string): boolean {
  return Boolean(
    endpoint('/chat/completions', kind)
    && configuredValue(kind, 'API_KEY')
    && selectedChatModel(kind, requestedModel),
  )
}

export function modelConfigured(): boolean {
  return chatModelConfigured('text')
}

export async function chatCompletion(
  messages: ModelMessage[],
  options: { model?: string; json?: boolean; temperature?: number; kind?: 'text' | 'vision'; maxOutputTokens?: number } = {},
): Promise<ModelResult | null> {
  const kind = options.kind ?? 'text'
  const url = endpoint('/chat/completions', kind)
  const key = configuredValue(kind, 'API_KEY')
  if (!url || !key) return null
  const model = selectedChatModel(kind, options.model)
  if (!model) return null
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: Math.min(Math.max(options.maxOutputTokens ?? 1200, 100), 2400),
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) {
      console.error('AI request failed', response.status, (await response.text()).slice(0, 500))
      return null
    }
    const data = await response.json()
    const text = data?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim()) return null
    return {
      text: text.trim().slice(0, 12_000),
      model: String(data.model || model),
      inputTokens: Number(data.usage?.prompt_tokens || 0),
      outputTokens: Number(data.usage?.completion_tokens || 0),
    }
  } catch (error) {
    console.error('AI request error', error)
    return null
  }
}

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return []
  const url = endpoint('/embeddings', 'embedding')
  const key = configuredValue('embedding', 'API_KEY')
  if (!url || !key) return null
  const model = Deno.env.get('AI_EMBEDDING_MODEL') || 'text-embedding-3-small'
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts, dimensions: 1536 }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) {
      console.error('Embedding request failed', response.status, (await response.text()).slice(0, 500))
      return null
    }
    const data = await response.json()
    const vectors = [...(data.data ?? [])].sort((a, b) => a.index - b.index).map((item) => item.embedding)
    return vectors.length === texts.length && vectors.every((vector) => Array.isArray(vector) && vector.length === 1536)
      ? vectors : null
  } catch (error) {
    console.error('Embedding request error', error)
    return null
  }
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(stripped)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
}
