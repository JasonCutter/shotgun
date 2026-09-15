import type {
  ResolvedSemanticEmbeddingExecution,
  SemanticCorpusSourceSnapshot,
  SemanticEmbeddingProfile,
  SemanticEmbeddingResolverPort,
  SemanticProjectionGeneration,
  SemanticSensitivity,
} from '../../../packages/contracts/src/index.js';

const sensitivityRank: Record<SemanticSensitivity, number> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

/** The strongest sensitivity present in the server-owned semantic corpus. */
export const semanticSourceSensitivity = (
  snapshot: Pick<SemanticCorpusSourceSnapshot, 'resources'>,
): SemanticSensitivity =>
  snapshot.resources.reduce<SemanticSensitivity>(
    (highest, resource) =>
      sensitivityRank[resource.provenance.sensitivity] > sensitivityRank[highest]
        ? resource.provenance.sensitivity
        : highest,
    'public',
  );

const executionMatchesGeneration = (
  generation: SemanticProjectionGeneration,
  resolved: ResolvedSemanticEmbeddingExecution,
): boolean => {
  const { pin, profile, model } = resolved;
  return (
    pin.projectId === generation.projectId &&
    pin.providerId === generation.providerId &&
    pin.embeddingModelId === generation.embeddingModelId &&
    pin.embeddingProfileId === generation.embeddingProfileId &&
    pin.embeddingProfileRevision === generation.embeddingProfileRevision &&
    pin.credentialId === generation.credentialId &&
    pin.credentialRevision === generation.credentialRevision &&
    pin.providerRegistryRevision === generation.providerRegistryRevision &&
    pin.capabilityCatalogRevision === generation.capabilityCatalogRevision &&
    pin.providerPolicyFingerprint === generation.providerPolicyFingerprint &&
    pin.representationVersion === generation.representationVersion &&
    pin.dimension === generation.dimension &&
    profile.profileId === generation.embeddingProfileId &&
    profile.profileRevision === generation.embeddingProfileRevision &&
    profile.providerId === generation.providerId &&
    profile.embeddingModelId === generation.embeddingModelId &&
    profile.credentialId === generation.credentialId &&
    profile.credentialRevision === generation.credentialRevision &&
    profile.representationVersion === generation.representationVersion &&
    profile.dimension === generation.dimension &&
    profile.distanceMetric === generation.distanceMetric &&
    profile.normalizationPolicy === generation.normalizationPolicy &&
    model.providerId === generation.providerId &&
    model.modelId === generation.embeddingModelId &&
    model.capabilityRevision === generation.capabilityCatalogRevision
  );
};

/**
 * One server-authoritative predicate for semantic generation readiness.
 * Resolver errors are fail-closed so callers can route to the existing
 * refresh/recovery authority instead of treating an unverifiable generation
 * as current.
 */
export const semanticGenerationMatchesCurrentExecution = async (input: {
  readonly generation: SemanticProjectionGeneration;
  readonly profile: SemanticEmbeddingProfile;
  readonly resolver: SemanticEmbeddingResolverPort;
  readonly sensitivity: SemanticSensitivity;
}): Promise<boolean> => {
  try {
    const resolved = await input.resolver.resolveExecution({
      projectId: input.generation.projectId,
      sensitivity: input.sensitivity,
      profileRevision: input.profile.profileRevision,
      credentialId: input.generation.credentialId,
      credentialRevision: input.generation.credentialRevision,
    });
    return executionMatchesGeneration(input.generation, resolved);
  } catch {
    return false;
  }
};
