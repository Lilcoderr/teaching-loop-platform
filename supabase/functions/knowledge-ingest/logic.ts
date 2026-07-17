export function externalEmbeddingAllowed(
  aiEnabled: unknown,
  guardianConsentAt: unknown,
  modelConfigured: boolean,
): boolean {
  return aiEnabled === true
    && typeof guardianConsentAt === 'string'
    && guardianConsentAt.trim().length > 0
    && modelConfigured
}
