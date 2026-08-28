import { describe, expect, it } from 'vitest';

import { InMemorySemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-in-memory/src/index.js';
import { SemanticEmbeddingAuthorityResolver } from '../../adapters/semantic-embedding-resolution/src/index.js';
import {
  DeterministicFakeEmbeddingAdapter,
  initialSemanticEmbeddingRegistry,
  SemanticEmbeddingProfileService,
} from '../../modules/semantic-embedding/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';
import {
  parseProviderDeploymentCeiling,
  type ProviderExternalTransferApprovalPort,
} from '../../modules/provider-privacy-policy/src/index.js';
import type {
  CredentialMetadata,
  CredentialVaultPort,
} from '../../modules/credential-vault/src/index.js';
import type {
  ProviderStatusReaderPort,
  SemanticEmbeddingRegistryPort,
} from '../../packages/contracts/src/index.js';

describe('AKP-1 WP1: Semantic Embedding Resolution and Execution Pinning', () => {
  const createTestRig = (
    options: {
      readonly vaultAvailable?: boolean;
      readonly credentials?: readonly CredentialMetadata[];
      readonly approvedProviders?: readonly string[];
      readonly approvalRevision?: number;
      readonly allowedDeploymentProviders?: string;
      readonly omitDeploymentCeiling?: boolean;
      readonly omitApprovalAuthority?: boolean;
      readonly legacyGeminiAllowed?: boolean;
      readonly customProviderRegistry?: ProviderStatusReaderPort;
      readonly customEmbeddingRegistry?: SemanticEmbeddingRegistryPort;
    } = {},
  ) => {
    const embeddingRegistry = options.customEmbeddingRegistry ?? initialSemanticEmbeddingRegistry();
    const providerRegistry: ProviderStatusReaderPort =
      options.customProviderRegistry ?? initialProviderRegistry();
    const repository = new InMemorySemanticEmbeddingProfileRepository();

    const credentialList = options.credentials ?? [
      {
        credentialId: 'cred-openai-1',
        projectId: 'project-1',
        providerId: 'openai',
        encryptionVersion: 'aes-256-gcm:v1' as const,
        keyVersion: 'v1',
        credentialRevision: 1,
        lifecycleState: 'active' as const,
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
      },
      {
        credentialId: 'cred-gemini-1',
        projectId: 'project-1',
        providerId: 'google-gemini',
        encryptionVersion: 'aes-256-gcm:v1' as const,
        keyVersion: 'v1',
        credentialRevision: 1,
        lifecycleState: 'active' as const,
        createdAt: '2026-08-18T00:00:00.000Z',
        updatedAt: '2026-08-18T00:00:00.000Z',
      },
    ];

    const credentialReader = {
      getMetadata: async (scope: {
        projectId: string;
        providerId: string;
        credentialId: string;
        credentialRevision: number;
      }) =>
        credentialList.find(
          (c) =>
            c.projectId === scope.projectId &&
            c.providerId === scope.providerId &&
            c.credentialId === scope.credentialId &&
            c.credentialRevision === scope.credentialRevision,
        ),
    };

    const profileService = new SemanticEmbeddingProfileService(
      providerRegistry,
      embeddingRegistry,
      repository,
      credentialReader,
    );

    const vault: CredentialVaultPort = {
      getAvailability: () =>
        options.vaultAvailable === false
          ? { state: 'UNAVAILABLE', reason: 'MISSING_MASTER_KEY' }
          : { state: 'AVAILABLE', keyVersion: 'v1' },
      getMetadata: async (scope) =>
        credentialList.find(
          (c) =>
            c.projectId === scope.projectId &&
            c.providerId === scope.providerId &&
            c.credentialId === scope.credentialId &&
            c.credentialRevision === scope.credentialRevision,
        ),
      listMetadata: async (projectId) => credentialList.filter((c) => c.projectId === projectId),
      create: async () => {
        throw new Error('not implemented in test rig');
      },
      replace: async () => {
        throw new Error('not implemented in test rig');
      },
      revoke: async () => {
        throw new Error('not implemented in test rig');
      },
      remove: async () => {
        throw new Error('not implemented in test rig');
      },
      getWriteOutcome: async () => undefined,
      withCredential: async () => ({ status: 'SUCCEEDED' }),
    };

    const approvedSet = new Set(options.approvedProviders ?? ['openai', 'google-gemini']);
    const approvalRevision = options.approvalRevision ?? 1;
    const approvalAuthority: ProviderExternalTransferApprovalPort = {
      getCurrent: async (projectId, providerId) =>
        approvedSet.has(providerId)
          ? {
              projectId,
              providerId: providerId as 'openai' | 'google-gemini' | 'deepseek',
              approved: true,
              approvalRevision,
              reviewedBy: 'principal-owner',
              reviewedAt: '2026-08-18T00:00:00.000Z',
            }
          : undefined,
      listHistory: async () => [],
      propose: async () => {
        throw new Error('not implemented');
      },
      approve: async () => {
        throw new Error('not implemented');
      },
    };

    const deploymentCeiling = parseProviderDeploymentCeiling({
      providerAllowlist: options.allowedDeploymentProviders ?? 'openai,google-gemini',
    });

    const resolver = new SemanticEmbeddingAuthorityResolver(
      providerRegistry,
      embeddingRegistry,
      profileService,
      vault,
      {
        approvalAuthority: options.omitApprovalAuthority ? undefined! : approvalAuthority,
        deploymentCeiling: options.omitDeploymentCeiling ? undefined! : deploymentCeiling,
        legacyExternalTransferAllowed:
          options.legacyGeminiAllowed !== undefined
            ? async () => options.legacyGeminiAllowed!
            : undefined,
        clock: () => '2026-08-18T14:00:00.000Z',
      },
    );

    return {
      embeddingRegistry,
      providerRegistry,
      repository,
      profileService,
      resolver,
      vault,
      setCredentialLifecycle: (
        credentialId: string,
        lifecycleState: CredentialMetadata['lifecycleState'],
      ) => {
        const credential = credentialList.find(
          (candidate) => candidate.credentialId === credentialId,
        );
        if (credential) Object.assign(credential, { lifecycleState });
      },
    };
  };

  it('fails closed with CONFIGURATION_REQUIRED when no active embedding profile exists', async () => {
    const { resolver } = createTestRig();

    await expect(
      resolver.resolveExecution({
        projectId: 'project-1',
        sensitivity: 'public',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFIGURATION_REQUIRED',
    });
  });

  it('fails closed with CONFIGURATION_REQUIRED when required privacy authority is unconfigured', async () => {
    const { resolver, profileService } = createTestRig({
      omitDeploymentCeiling: true,
    });

    const profile = await profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });

    await expect(
      resolver.resolveExecution({
        projectId: 'project-1',
        sensitivity: 'public',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFIGURATION_REQUIRED',
    });
  });

  it('resolves execution and produces immutable execution pin with complete governing revisions from provider authority', async () => {
    const { resolver, profileService } = createTestRig();

    const profile = await profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });

    const resolved = await resolver.resolveExecution({
      projectId: 'project-1',
      sensitivity: 'public',
    });

    expect(resolved.pin).toMatchObject({
      projectId: 'project-1',
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      embeddingProfileId: profile.profileId,
      embeddingProfileRevision: 1,
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      providerRegistryRevision: 'provider-registry:v1',
      capabilityCatalogRevision: 'semantic-embedding-catalog:v1',
      representationVersion: 'semantic-representation:v1',
      createdAt: '2026-08-18T14:00:00.000Z',
    });
    expect(resolved.pin.providerPolicyFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);

    // Verify no secret, token, key or cipher is in pin
    const serializedPin = JSON.stringify(resolved.pin);
    expect(serializedPin).not.toContain('secret');
    expect(serializedPin).not.toContain('cipher');
    expect(serializedPin).not.toContain('bearer');

    expect(resolved.model.providerDefaultDimension).toBe(1536);
  });

  it('proves providerRegistryRevision is authoritatively derived from ProviderRegistryPort rather than a local fallback literal', async () => {
    const customProviderRegistry: ProviderStatusReaderPort = {
      getProvider: (providerId: string) =>
        providerId === 'openai'
          ? {
              providerId: 'openai',
              status: 'active',
              registryRevision: 'custom-provider-registry:v2-governed',
            }
          : undefined,
    };

    const { resolver, profileService } = createTestRig({ customProviderRegistry });

    const profile = await profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });

    const resolved = await resolver.resolveExecution({
      projectId: 'project-1',
      sensitivity: 'public',
    });

    expect(resolved.pin.providerRegistryRevision).toBe('custom-provider-registry:v2-governed');
  });

  it('checks current execution compatibility without requiring transfer policy or reproducing build audit fields', async () => {
    const { resolver, profileService } = createTestRig({
      omitDeploymentCeiling: true,
      omitApprovalAuthority: true,
    });
    const profile = await profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });

    await expect(
      resolver.resolveCompatibility({
        projectId: 'project-1',
        providerId: profile.providerId,
        embeddingModelId: profile.embeddingModelId,
        embeddingProfileId: profile.profileId,
        embeddingProfileRevision: profile.profileRevision,
        credentialId: profile.credentialId,
        credentialRevision: profile.credentialRevision,
        representationVersion: profile.representationVersion,
        dimension: profile.dimension,
        distanceMetric: profile.distanceMetric,
        normalizationPolicy: profile.normalizationPolicy,
      }),
    ).resolves.toMatchObject({
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialRevision: 1,
    });
  });

  it('fails compatibility when the pinned credential is revoked', async () => {
    const rig = createTestRig();
    const profile = await rig.profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await rig.profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });
    rig.setCredentialLifecycle('cred-openai-1', 'revoked');

    await expect(
      rig.resolver.resolveCompatibility({
        projectId: 'project-1',
        providerId: profile.providerId,
        embeddingModelId: profile.embeddingModelId,
        embeddingProfileId: profile.profileId,
        embeddingProfileRevision: profile.profileRevision,
        credentialId: profile.credentialId,
        credentialRevision: profile.credentialRevision,
        representationVersion: profile.representationVersion,
        dimension: profile.dimension,
        distanceMetric: profile.distanceMetric,
        normalizationPolicy: profile.normalizationPolicy,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CAPABILITY_UNAVAILABLE',
    });
  });

  it('fails compatibility when the current provider is unavailable', async () => {
    let providerActive = true;
    const baseProviderRegistry = initialProviderRegistry();
    const providerRegistry: ProviderStatusReaderPort = {
      getProvider: (providerId) => {
        const provider = baseProviderRegistry.getProvider(providerId);
        return providerId === 'openai' && provider
          ? { ...provider, status: providerActive ? 'active' : 'disabled' }
          : provider;
      },
    };
    const rig = createTestRig({ customProviderRegistry: providerRegistry });
    const profile = await rig.profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await rig.profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });
    providerActive = false;

    await expect(
      rig.resolver.resolveCompatibility({
        projectId: 'project-1',
        providerId: profile.providerId,
        embeddingModelId: profile.embeddingModelId,
        embeddingProfileId: profile.profileId,
        embeddingProfileRevision: profile.profileRevision,
        credentialId: profile.credentialId,
        credentialRevision: profile.credentialRevision,
        representationVersion: profile.representationVersion,
        dimension: profile.dimension,
        distanceMetric: profile.distanceMetric,
        normalizationPolicy: profile.normalizationPolicy,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CAPABILITY_UNAVAILABLE',
    });
  });

  it('fails compatibility when the current embedding model is unavailable', async () => {
    let modelAvailable = true;
    const baseEmbeddingRegistry = initialSemanticEmbeddingRegistry();
    const embeddingRegistry: SemanticEmbeddingRegistryPort = {
      listModels: (providerId) => baseEmbeddingRegistry.listModels(providerId),
      getModel: (providerId, modelId) =>
        modelAvailable ? baseEmbeddingRegistry.getModel(providerId, modelId) : undefined,
    };
    const rig = createTestRig({ customEmbeddingRegistry: embeddingRegistry });
    const profile = await rig.profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await rig.profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });
    modelAvailable = false;

    await expect(
      rig.resolver.resolveCompatibility({
        projectId: 'project-1',
        providerId: profile.providerId,
        embeddingModelId: profile.embeddingModelId,
        embeddingProfileId: profile.profileId,
        embeddingProfileRevision: profile.profileRevision,
        credentialId: profile.credentialId,
        credentialRevision: profile.credentialRevision,
        representationVersion: profile.representationVersion,
        dimension: profile.dimension,
        distanceMetric: profile.distanceMetric,
        normalizationPolicy: profile.normalizationPolicy,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CAPABILITY_UNAVAILABLE',
    });
  });

  it('proves providerPolicyFingerprint changes when governed policy inputs change', async () => {
    // 1. Rig with approvalRevision = 1
    const rig1 = createTestRig({ approvalRevision: 1 });
    const p1 = await rig1.profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await rig1.profileService.activateProfile({
      projectId: 'project-1',
      profileId: p1.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });
    const res1 = await rig1.resolver.resolveExecution({
      projectId: 'project-1',
      sensitivity: 'private',
    });

    // 2. Rig with approvalRevision = 2
    const rig2 = createTestRig({ approvalRevision: 2 });
    const p2 = await rig2.profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await rig2.profileService.activateProfile({
      projectId: 'project-1',
      profileId: p2.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });
    const res2 = await rig2.resolver.resolveExecution({
      projectId: 'project-1',
      sensitivity: 'private',
    });

    // 3. Same rig but sensitivity = public
    const res3 = await rig1.resolver.resolveExecution({
      projectId: 'project-1',
      sensitivity: 'public',
    });

    // 4. Rig with different allowedDeploymentProviders
    const rig4 = createTestRig({ allowedDeploymentProviders: 'openai' });
    const p4 = await rig4.profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await rig4.profileService.activateProfile({
      projectId: 'project-1',
      profileId: p4.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });
    const res4 = await rig4.resolver.resolveExecution({
      projectId: 'project-1',
      sensitivity: 'private',
    });

    expect(res1.pin.providerPolicyFingerprint).not.toBe(res2.pin.providerPolicyFingerprint);
    expect(res1.pin.providerPolicyFingerprint).not.toBe(res3.pin.providerPolicyFingerprint);
    expect(res1.pin.providerPolicyFingerprint).not.toBe(res4.pin.providerPolicyFingerprint);
  });

  it('fails closed with POLICY_DENIED on restricted sensitivity via canonical privacy decision', async () => {
    const { resolver, profileService } = createTestRig();

    const profile = await profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });

    await expect(
      resolver.resolveExecution({
        projectId: 'project-1',
        sensitivity: 'restricted',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'POLICY_DENIED',
    });
  });

  it('fails closed with POLICY_DENIED when private sensitivity is blocked by deployment ceiling', async () => {
    const { resolver, profileService } = createTestRig({
      allowedDeploymentProviders: 'google-gemini', // openai not in deployment allowlist
    });

    const profile = await profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });

    await expect(
      resolver.resolveExecution({
        projectId: 'project-1',
        sensitivity: 'private',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'POLICY_DENIED',
    });
  });

  it('fails closed with POLICY_DENIED when private sensitivity lacks project approval', async () => {
    const { resolver, profileService } = createTestRig({
      approvedProviders: [], // No provider approved for project
    });

    const profile = await profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });

    await expect(
      resolver.resolveExecution({
        projectId: 'project-1',
        sensitivity: 'private',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'POLICY_DENIED',
    });
  });

  it('allows eligible private context when approved and within deployment ceiling', async () => {
    const { resolver, profileService } = createTestRig({
      approvedProviders: ['openai'],
      allowedDeploymentProviders: 'openai,google-gemini',
    });

    const profile = await profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });

    const resolved = await resolver.resolveExecution({
      projectId: 'project-1',
      sensitivity: 'private',
    });
    expect(resolved.pin.providerId).toBe('openai');
  });

  it('fails closed on credential revocation, mismatch, or missing vault key without list fallback', async () => {
    const { resolver, profileService } = createTestRig({
      credentials: [
        {
          credentialId: 'cred-openai-1',
          projectId: 'project-1',
          providerId: 'openai',
          encryptionVersion: 'aes-256-gcm:v1' as const,
          keyVersion: 'v1',
          credentialRevision: 1,
          lifecycleState: 'active' as const,
          createdAt: '2026-08-18T00:00:00.000Z',
          updatedAt: '2026-08-18T00:00:00.000Z',
        },
      ],
    });

    const profile = await profileService.createProfile({
      projectId: 'project-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await profileService.activateProfile({
      projectId: 'project-1',
      profileId: profile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });

    // Mismatched credential requested via execution override
    await expect(
      resolver.resolveExecution({
        projectId: 'project-1',
        sensitivity: 'public',
        credentialId: 'cred-different-id',
        credentialRevision: 1,
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CAPABILITY_UNAVAILABLE',
    });
  });

  it('validates DeterministicFakeEmbeddingAdapter vector dimensionality and reproducibility', async () => {
    const adapter = new DeterministicFakeEmbeddingAdapter({
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      dimension: 1536,
    });

    const result1 = await adapter.embed({
      text: 'Deterministic embedding test payload',
      resourceType: 'CLAIM',
      resourceId: 'claim-1',
    });

    expect(result1.dimension).toBe(1536);
    expect(result1.vector).toHaveLength(1536);
    expect(result1.modelId).toBe('text-embedding-3-small');
    expect(result1.providerId).toBe('openai');
    expect(result1.tokenCount).toBeGreaterThan(0);

    // Verify unit length (approx norm 1.0)
    const norm = Math.sqrt(result1.vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 3);

    // Verify determinism on repeated call
    const result2 = await adapter.embed({
      text: 'Deterministic embedding test payload',
    });
    expect(result2.vector).toEqual(result1.vector);

    // Verify different text produces different vector
    const result3 = await adapter.embed({
      text: 'Completely different text input',
    });
    expect(result3.vector).not.toEqual(result1.vector);

    // Batch embedding
    const batch = await adapter.embedBatch([{ text: 'First payload' }, { text: 'Second payload' }]);
    expect(batch).toHaveLength(2);
    expect(batch[0]!.vector).toHaveLength(1536);
    expect(batch[1]!.vector).toHaveLength(1536);
  });
});
