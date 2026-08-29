import type { DiscoveryResourceRefV1 } from './discovery-finding.js';

export const DISCOVERY_MODEL_PROFILE_SCHEMA_VERSION = '1.0.0' as const;
export type DiscoveryModelProfileSchemaVersion = typeof DISCOVERY_MODEL_PROFILE_SCHEMA_VERSION;

export const DISCOVERY_MODEL_PROFILE_STATUSES = ['PREPARED', 'ACTIVE', 'RETIRED'] as const;
export type DiscoveryModelProfileStatus = (typeof DISCOVERY_MODEL_PROFILE_STATUSES)[number];

export const DISCOVERY_QUALIFIED_FOLLOW_UP_ORIGIN_TYPES_V1 = [
  'KNOWLEDGE_GAP',
  'EVIDENCE_GAP',
  'RELATION_HYPOTHESIS',
  'PATTERN_HYPOTHESIS',
  'CONFLICT_HYPOTHESIS',
] as const;
export type DiscoveryQualifiedFollowUpOriginTypeV1 =
  (typeof DISCOVERY_QUALIFIED_FOLLOW_UP_ORIGIN_TYPES_V1)[number];

export const DISCOVERY_RELATION_ORIENTATIONS_V1 = [
  'UNDIRECTED',
  'ANCHOR_TO_OTHER',
  'OTHER_TO_ANCHOR',
] as const;
export type DiscoveryRelationOrientationV1 = (typeof DISCOVERY_RELATION_ORIENTATIONS_V1)[number];

/**
 * A Discovery-specific, revisioned selection of an ADR-133 provider/model
 * capability. Credential material and credential ciphertext are deliberately
 * absent; the exact credential is obtained from the pinned AI configuration
 * revision at execution time.
 */
export type DiscoveryModelProfileV1 = {
  readonly schemaVersion: DiscoveryModelProfileSchemaVersion;
  readonly profileId: string;
  readonly projectId: string;
  readonly profileRevision: number;
  readonly aiConfigurationRevision: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly providerRegistryRevision: string;
  readonly modelCapabilityRevision: string;
  readonly promptVersion: string;
  readonly outputSchemaVersion: string;
  readonly status: DiscoveryModelProfileStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly activatedAt?: string;
  readonly retiredAt?: string;
};

export type DiscoveryModelProfileRepositoryPort = {
  findActive(projectId: string): Promise<DiscoveryModelProfileV1 | undefined>;
  findCurrent(projectId: string): Promise<DiscoveryModelProfileV1 | undefined>;
  findRevision(
    projectId: string,
    profileRevision: number,
  ): Promise<DiscoveryModelProfileV1 | undefined>;
  saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: DiscoveryModelProfileV1;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'>;
  updateStatus(input: {
    readonly projectId: string;
    readonly profileId: string;
    readonly profileRevision: number;
    readonly expectedStatus: DiscoveryModelProfileStatus;
    readonly status: DiscoveryModelProfileStatus;
    readonly updatedAt: string;
  }): Promise<DiscoveryModelProfileV1 | 'NOT_FOUND' | 'CONFLICT'>;
};

export type DiscoveryAIConfigurationRevisionV1 = {
  readonly projectId: string;
  readonly activeProviderId: string;
  readonly activeModelId: string;
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly aiConfigurationRevision: number;
};

export type DiscoveryAIProviderCapabilityV1 = {
  readonly providerId: string;
  readonly status: 'active' | 'disabled';
  readonly registryRevision: string;
  readonly providerPolicyRevision: string;
};

export type DiscoveryAIModelCapabilityV1 = {
  readonly providerId: string;
  readonly modelId: string;
  readonly capabilityRevision: string;
  readonly structuredOutput?: boolean;
  readonly shotgunUsableCapabilities?: readonly string[];
};

export type DiscoveryAIProviderCapabilityRegistryPort = {
  getProvider(providerId: string): DiscoveryAIProviderCapabilityV1 | undefined;
  getModel(providerId: string, modelId: string): DiscoveryAIModelCapabilityV1 | undefined;
};

export type DiscoveryAIConfigurationReaderPort = {
  getRevision(
    projectId: string,
    revision: number,
  ): Promise<DiscoveryAIConfigurationRevisionV1 | undefined>;
};

export type DiscoveryAICredentialMetadataReaderPort = {
  getMetadata(scope: {
    readonly projectId: string;
    readonly providerId: string;
    readonly credentialId: string;
    readonly credentialRevision: number;
  }): Promise<
    | {
        readonly projectId: string;
        readonly providerId: string;
        readonly credentialId: string;
        readonly credentialRevision: number;
        readonly lifecycleState: 'active' | 'superseded' | 'revoked' | 'removed';
      }
    | undefined
  >;
};

export type DiscoveryModelProfileServicePort = {
  getActive(projectId: string): Promise<DiscoveryModelProfileV1 | undefined>;
  getCurrent(projectId: string): Promise<DiscoveryModelProfileV1 | undefined>;
  getRevision(
    projectId: string,
    profileRevision: number,
  ): Promise<DiscoveryModelProfileV1 | undefined>;
  createProfile(input: {
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly aiConfigurationRevision: number;
    readonly providerId: string;
    readonly modelId: string;
    readonly promptVersion: string;
    readonly outputSchemaVersion: string;
    readonly createdBy: string;
    readonly now?: string;
  }): Promise<DiscoveryModelProfileV1>;
  activateProfile(input: {
    readonly projectId: string;
    readonly profileId: string;
    readonly profileRevision: number;
    readonly now?: string;
  }): Promise<DiscoveryModelProfileV1>;
  retireProfile(input: {
    readonly projectId: string;
    readonly profileId: string;
    readonly profileRevision: number;
    readonly now?: string;
  }): Promise<DiscoveryModelProfileV1>;
};

export type DiscoveryAIExecutionPinV1 = {
  readonly projectId: string;
  readonly profileId: string;
  readonly profileRevision: number;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelCapabilityRevision: string;
  readonly aiConfigurationRevision: number;
  readonly credentialId: string;
  readonly credentialRevision: number;
  readonly providerPolicyFingerprint: string;
  readonly privacyPolicyRevision: string;
  readonly dataPolicyRevision: string;
  readonly promptVersion: string;
  readonly outputSchemaVersion: string;
};

export type DiscoveryAIExecutionResolutionV1 = {
  readonly pin: DiscoveryAIExecutionPinV1;
  readonly modelVersion: string;
};

export type DiscoveryAIExecutionResolverPort = {
  resolve(input: {
    readonly projectId: string;
    readonly profile: DiscoveryModelProfileV1;
    readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  }): Promise<DiscoveryAIExecutionResolutionV1>;
};

export type DiscoveryStructuredGenerationRequestV1 = {
  readonly systemInstruction: string;
  readonly prompt: string;
  readonly responseSchema: Record<string, unknown>;
};

export type DiscoveryStructuredGenerationResponseV1 = {
  readonly rawText: string;
  readonly providerResponseId?: string;
  readonly modelVersion?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
};

export type DiscoveryStructuredProviderPort = {
  readonly identity: {
    readonly provider: string;
    readonly model: string;
    readonly adapterVersion: string;
    readonly dataPolicyVersion: string;
  };
  generateStructured(
    request: DiscoveryStructuredGenerationRequestV1,
  ): Promise<DiscoveryStructuredGenerationResponseV1>;
};

export type DiscoveryStructuredProviderRouterPort = {
  resolve(input: {
    readonly projectId: string;
    readonly executionPin: DiscoveryAIExecutionPinV1;
  }): Promise<DiscoveryStructuredProviderPort>;
};

export type DiscoveryAIContextItemV1 = {
  readonly resourceRef: DiscoveryResourceRefV1;
  /** Deterministic server projection. It is untrusted data, never instruction. */
  readonly deterministicRepresentation: string;
  readonly evidenceIds: readonly string[];
};

export type DiscoveryQualifiedAIGenerationContextV1 = {
  readonly projectId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly sourceProjectionDigest: string;
  readonly canonicalBase: {
    readonly schemaVersion: '1.0.0';
    readonly canonicalVersion: number;
    readonly snapshotDigest: string;
  };
  readonly discoveryBase: {
    readonly schemaVersion: '1.0.0';
    readonly projectionRevision: string;
    readonly projectionDigest: string;
  };
  readonly originatingFindingType: DiscoveryQualifiedFollowUpOriginTypeV1;
  readonly boundedRationale: string;
  readonly items: readonly DiscoveryAIContextItemV1[];
};
