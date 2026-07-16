import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bootstrap = readFileSync('supabase/functions/bootstrap/index.ts', 'utf8')
const modelAdapter = readFileSync('supabase/functions/_shared/model.ts', 'utf8')

describe('server-side model readiness wiring', () => {
  it('returns effective model names and readiness booleans without returning secret values', () => {
    expect(bootstrap).toContain("textModel: selectedChatModel('text', settingResult.data.text_model)")
    expect(bootstrap).toContain("visionModel: selectedChatModel('vision', settingResult.data.vision_model)")
    expect(bootstrap).toContain('embeddingModel: selectedEmbeddingModel(settingResult.data.embedding_model)')
    expect(bootstrap).toContain("textModelConfigured: chatModelConfigured('text', settingResult.data.text_model)")
    expect(bootstrap).toContain("visionModelConfigured: chatModelConfigured('vision', settingResult.data.vision_model)")
    expect(bootstrap).toContain('embeddingModelConfigured: embeddingModelConfigured(settingResult.data.embedding_model)')
    expect(bootstrap).not.toContain('AI_TEXT_API_KEY')
    expect(bootstrap).not.toContain('AI_VISION_API_KEY')
    expect(bootstrap).not.toContain('AI_EMBEDDING_API_KEY')
  })

  it('requires endpoint, API key and model name before reporting a model as configured', () => {
    expect(modelAdapter).toContain("endpoint('/chat/completions', kind)")
    expect(modelAdapter).toContain("configuredValue(kind, 'API_KEY')")
    expect(modelAdapter).toContain('selectedChatModel(kind, requestedModel)')
    expect(modelAdapter).toContain("endpoint('/embeddings', 'embedding')")
    expect(modelAdapter).toContain("configuredValue('embedding', 'API_KEY')")
  })
})
