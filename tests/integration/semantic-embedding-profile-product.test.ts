import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryCredentialVaultRepository } from '../../adapters/credential-vault-in-memory/src/index.js';
import { InMemoryProjectAIConfigurationRepository } from '../../adapters/ai-configuration-in-memory/src/index.js';
import { InMemorySemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-in-memory/src/index.js';
import {
  InMemoryProjectAdministrationRepository,
  InMemorySettingsRepository,
} from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { SEMANTIC_EMBEDDING_CATALOG_REVISION } from '../../packages/contracts/src/index.js';
import {
  AISettingsBackendService,
  StaticAIProviderConnectivityRegistry,
} from '../../modules/ai-settings-backend/src/index.js';
import {
  initialProviderRegistry,
  ProjectAIConfigurationService,
} from '../../modules/ai-configuration/src/index.js';
import {
  CredentialVaultService,
  StaticCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import { parseProviderDeploymentCeiling } from '../../modules/provider-privacy-policy/src/index.js';
import {
  SemanticEmbeddingProfileService,
  initialSemanticEmbeddingRegistry,
} from '../../modules/semantic-embedding/src/index.js';
import type {
  AIStandingProcessingPolicy,
  SemanticEmbeddingResolverPort,
  SemanticProjectionGeneration,
} from '../../packages/contracts/src/index.js';
import type { StandingAIProcessingPolicyWriterPort } from '../../packages/policy/src/index.js';

const applications: Array<Awaited<ReturnType<typeof createApplication>>> = [];

afterEach(async () => {
  while (applications.length > 0) {
    await applications.pop()?.server.close();
  }
});

const createFixture = async (options: { readonly refreshFails?: boolean } = {}) => {
  const projectId = `semantic-profile-${crypto.randomUUID()}`;
  const accountId = `semantic-profile-account-${crypto.randomUUID()}`;
  const auth = new InMemoryAuthRepository();
  await auth.bootstrapOwner({
    accountId,
    projectId,
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });
  const principal = await auth.findPrincipalByAccountId(accountId);
  if (!principal) throw new Error('Semantic profile fixture principal was not created.');

  const projects = new InMemoryProjectAdministrationRepository(undefined, false);
  await projects.createProject({
    commandId: `semantic-profile-project-${crypto.randomUUID()}`,
    clientRequestId: `semantic-profile-project-${crypto.randomUUID()}`,
    idempotencyKey: `semantic-profile-project-${crypto.randomUUID()}`,
    projectId,
    name: 'Semantic profile Product boundary fixture',
    actorPrincipalId: principal.principalId,
    expectedProjectRevision: 0,
  });

  const registry = initialProviderRegistry();
  const vault = new CredentialVaultService(
    new InMemoryCredentialVaultRepository(),
    new StaticCredentialMasterKeyAuthority({
      key: Buffer.alloc(32, 71),
      keyVersion: 'semantic-profile-product-test',
    }),
  );
  let standingPolicy: AIStandingProcessingPolicy | undefined;
  const standingPolicyAuthority: StandingAIProcessingPolicyWriterPort = {
    getCurrent: async () => standingPolicy,
    save: async (input) => {
      standingPolicy = {
        projectId: input.projectId,
        enabled: input.enabled,
        providerId: input.providerId,
        policyRevision: input.expectedRevision + 1,
        aiConfigurationRevision: input.aiConfigurationRevision,
        changedBy: input.changedBy,
        changedAt: input.now ?? new Date().toISOString(),
      };
      return standingPolicy;
    },
  };
  const backend = new AISettingsBackendService(
    registry,
    new ProjectAIConfigurationService(
      registry,
      new InMemoryProjectAIConfigurationRepository(),
      vault,
    ),
    vault,
    new StaticAIProviderConnectivityRegistry([]),
    parseProviderDeploymentCeiling({ providerAllowlist: 'deepseek,openai' }),
    { getLegacyExternalTransferAllowed: async () => false },
    { getCurrent: async () => undefined },
    undefined,
    undefined,
    standingPolicyAuthority,
  );
  const semanticProfile = new SemanticEmbeddingProfileService(
    registry,
    initialSemanticEmbeddingRegistry(),
    new InMemorySemanticEmbeddingProfileRepository(),
    vault,
  );
  const embeddingRegistry = initialSemanticEmbeddingRegistry();
  let activeGeneration: SemanticProjectionGeneration | undefined;
  let sourceWatermark = {
    canonicalVersion: 1,
    sourceSnapshotDigest: 'sha256:source',
  };
  let refreshCount = 0;
  let executionResolutionCount = 0;
  let executionEligible = true;
  const settingsRepository = new InMemorySettingsRepository();
  const semanticActiveGenerationReader = {
    getActiveGeneration: async () => activeGeneration,
  };
  const semanticProjectionRefresh = {
    refresh: async ({ projectId }: { readonly projectId: string }) => {
      if (options.refreshFails) throw new Error('Semantic refresh is unavailable.');
      refreshCount += 1;
      const profile = await semanticProfile.getCurrent(projectId);
      if (!profile) throw new Error('Profile is required before refresh.');
      activeGeneration = {
        projectId,
        generationId: `generation-${profile.profileRevision}`,
        sourceProjectionDigest: sourceWatermark.sourceSnapshotDigest,
        canonicalBaseVersion: sourceWatermark.canonicalVersion,
        credentialId: profile.credentialId,
        credentialRevision: profile.credentialRevision,
        providerPolicyFingerprint: 'policy',
        providerId: profile.providerId,
        embeddingModelId: profile.embeddingModelId,
        embeddingProfileId: profile.profileId,
        embeddingProfileRevision: profile.profileRevision,
        providerRegistryRevision: 'registry',
        capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
        representationVersion: profile.representationVersion,
        dimension: profile.dimension,
        distanceMetric: 'cosine',
        normalizationPolicy: 'unit_length',
        buildStatus: 'READY',
        createdAt: new Date().toISOString(),
      };
      return {
        projectId,
        profileRevision: profile.profileRevision,
        status: 'ACTIVATED' as const,
        generationId: activeGeneration.generationId,
        itemCount: 0,
        membershipDigest: 'sha256:membership',
      };
    },
  };
  const semanticCorpusSourceSnapshotReader = {
    readWatermark: async (requestedProjectId: string) => ({
      projectId: requestedProjectId,
      canonicalVersion: sourceWatermark.canonicalVersion,
      canonicalSnapshotDigest: 'sha256:canonical',
      approvedKnowledgeDigest: 'sha256:approved',
      sourceSnapshotDigest: sourceWatermark.sourceSnapshotDigest,
    }),
    readSnapshot: async (requestedProjectId: string) => ({
      projectId: requestedProjectId,
      canonicalVersion: sourceWatermark.canonicalVersion,
      canonicalSnapshotDigest: 'sha256:canonical',
      approvedKnowledgeDigest: 'sha256:approved',
      sourceSnapshotDigest: sourceWatermark.sourceSnapshotDigest,
      effectiveAt: new Date().toISOString(),
      resources: [],
    }),
  };
  const semanticEmbeddingResolver: SemanticEmbeddingResolverPort = {
    resolveExecution: async ({
      projectId: requestedProjectId,
      profileRevision,
    }: {
      readonly projectId: string;
      readonly profileRevision?: number;
    }) => {
      executionResolutionCount += 1;
      if (!executionEligible) throw new Error('Current embedding policy is denied.');
      const profile = profileRevision
        ? await semanticProfile.getRevision(requestedProjectId, profileRevision)
        : await semanticProfile.getCurrent(requestedProjectId);
      if (!profile) throw new Error('Profile is required for readiness.');
      const model = embeddingRegistry.getModel(profile.providerId, profile.embeddingModelId);
      if (!model) throw new Error('Embedding model is unavailable.');
      return {
        profile,
        model,
        pin: {
          projectId: requestedProjectId,
          providerId: profile.providerId,
          embeddingModelId: profile.embeddingModelId,
          dimension: profile.dimension,
          embeddingProfileId: profile.profileId,
          embeddingProfileRevision: profile.profileRevision,
          credentialId: profile.credentialId,
          credentialRevision: profile.credentialRevision,
          providerRegistryRevision: 'registry',
          capabilityCatalogRevision: SEMANTIC_EMBEDDING_CATALOG_REVISION,
          providerPolicyFingerprint: 'policy',
          representationVersion: profile.representationVersion,
          createdAt: new Date().toISOString(),
        },
      };
    },
    resolveCompatibility: async (input) => input,
  };
  const application = await createApplication({
    authRepository: auth,
    projectAdminRepository: projects,
    aiSettingsBackend: backend,
    semanticEmbeddingProfile: semanticProfile,
    semanticEmbeddingRegistry: embeddingRegistry,
    semanticActiveGenerationReader,
    semanticProjectionRefresh,
    semanticCorpusSourceSnapshotReader,
    semanticEmbeddingResolver,
    settingsRepository,
  });
  applications.push(application);
  const session = await auth.createSession(
    principal.principalId,
    projectId,
    new Date(Date.now() + 60_000).toISOString(),
  );
  const cookie = `shotgun_session=${session.sessionToken}`;
  const csrfResponse = await application.server.inject({
    method: 'GET',
    url: '/api/v1/security/csrf',
    headers: { cookie },
  });
  if (csrfResponse.statusCode !== 200) throw new Error('Semantic profile CSRF setup failed.');
  const csrfToken = (csrfResponse.json() as { csrfToken: string }).csrfToken;
  return {
    application,
    projectId,
    headers: { cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' },
    vault,
    semanticProfile,
    settingsRepository,
    setSourceWatermark: (next: typeof sourceWatermark) => {
      sourceWatermark = next;
    },
    getRefreshCount: () => refreshCount,
    setExecutionEligible: (next: boolean) => {
      executionEligible = next;
    },
    getExecutionResolutionCount: () => executionResolutionCount,
    getActiveGeneration: () => activeGeneration,
  };
};

describe('Semantic embedding profile Product boundary', () => {
  it('reports owner-safe semantic status and activates only after refresh readiness', async () => {
    const fixture = await createFixture();
    const before = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-comparison-status',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()).toMatchObject({
      status: { projectId: fixture.projectId, status: 'NOT_CONFIGURED', rollout: 'V1_ONLY' },
    });
    const embeddingOptions = (
      before.json() as { status: { embeddingOptions: Array<Record<string, unknown>> } }
    ).status.embeddingOptions;
    expect(embeddingOptions).toHaveLength(3);
    expect(embeddingOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'openai',
          embeddingModelId: 'text-embedding-3-small',
          hasActiveCredential: false,
        }),
        expect.objectContaining({
          providerId: 'openai',
          embeddingModelId: 'text-embedding-3-large',
          hasActiveCredential: false,
        }),
        expect.objectContaining({
          providerId: 'google-gemini',
          embeddingModelId: 'gemini-embedding-001',
          hasActiveCredential: false,
        }),
      ]),
    );

    const credentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'openai',
        secret: 'semantic-test',
      },
    });
    expect(credentialResponse.statusCode).toBe(200);

    const prepared = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: { targetProjectId: fixture.projectId },
    });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json()).toMatchObject({
      status: { projectId: fixture.projectId, status: 'READY', rollout: 'V1_ONLY' },
    });
    const preparedAgain = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: { targetProjectId: fixture.projectId },
    });
    expect(preparedAgain.statusCode).toBe(200);
    expect(preparedAgain.json()).toMatchObject({
      status: { status: 'READY', profile: { profileRevision: 1 } },
    });

    const settingsSnapshot = await fixture.settingsRepository.getSettingsSnapshot(
      fixture.projectId,
    );
    const activated = await fixture.settingsRepository.applySettingsCommand({
      commandId: `semantic-activation-${crypto.randomUUID()}`,
      clientRequestId: `semantic-activation-${crypto.randomUUID()}`,
      idempotencyKey: `semantic-activation-${crypto.randomUUID()}`,
      projectId: fixture.projectId,
      expectedSettingsRevision: settingsSnapshot.settingsRevision,
      observedPolicyContextRevision: settingsSnapshot.policyContextRevision,
      settings: { 'comparison.stage5.rollout': 'V2_ACTIVE' },
      actorId: 'owner-1',
    });
    expect(activated.status).toBe('APPLIED');
    const after = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-comparison-status',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(after.json()).toMatchObject({ status: { rollout: 'V2_ACTIVE', status: 'READY' } });
  });

  it('fails closed when no active OpenAI embedding credential exists', async () => {
    const fixture = await createFixture();
    const deepSeekCredential = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'deepseek',
        secret: 'deepseek-generative-only',
      },
    });
    expect(deepSeekCredential.statusCode).toBe(200);
    const response = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: {},
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
  });

  it('requires exactly one active credential for semantic replacement', async () => {
    const emptyFixture = await createFixture();
    const noActive = await emptyFixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/embedding-credentials/replace',
      headers: emptyFixture.headers,
      payload: {
        targetProjectId: emptyFixture.projectId,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        secret: 'c6-no-active-secret',
        clientRequestId: `c6-no-active-${crypto.randomUUID()}`,
      },
    });
    expect(noActive.statusCode).toBe(503);
    expect(noActive.json()).toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
    expect(JSON.stringify(noActive.json())).not.toContain('c6-no-active-secret');

    const ambiguousFixture = await createFixture();
    const firstCredential = await ambiguousFixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: ambiguousFixture.headers,
      payload: {
        targetProjectId: ambiguousFixture.projectId,
        providerId: 'openai',
        secret: 'c6-ambiguous-a',
      },
    });
    expect(firstCredential.statusCode).toBe(200);
    const prepared = await ambiguousFixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: ambiguousFixture.headers,
      payload: {},
    });
    expect(prepared.statusCode).toBe(200);
    const secondCredential = await ambiguousFixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: ambiguousFixture.headers,
      payload: {
        targetProjectId: ambiguousFixture.projectId,
        providerId: 'openai',
        secret: 'c6-ambiguous-b',
      },
    });
    expect(secondCredential.statusCode).toBe(200);
    const ambiguous = await ambiguousFixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/embedding-credentials/replace',
      headers: ambiguousFixture.headers,
      payload: {
        targetProjectId: ambiguousFixture.projectId,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        secret: 'c6-ambiguous-replacement-secret',
        clientRequestId: `c6-ambiguous-${crypto.randomUUID()}`,
      },
    });
    expect(ambiguous.statusCode).toBe(409);
    expect(ambiguous.json()).toMatchObject({ code: 'CONFLICT' });
    expect(JSON.stringify(ambiguous.json())).not.toContain('c6-ambiguous-replacement-secret');
  });

  it('rebinds semantic embedding credentials without changing generative AI or rollout state', async () => {
    const fixture = await createFixture();
    const generativeCredentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'deepseek',
        secret: 'c6-deepseek-generative',
        clientRequestId: `c6-deepseek-${crypto.randomUUID()}`,
      },
    });
    expect(generativeCredentialResponse.statusCode).toBe(200);
    const generativeCredential = (
      generativeCredentialResponse.json() as {
        credential: { credentialId: string; credentialRevision: number };
      }
    ).credential;
    const configurationResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/configuration',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        expectedRevision: 0,
        providerId: 'deepseek',
        modelId: 'deepseek-flash',
        credentialId: generativeCredential.credentialId,
        credentialRevision: generativeCredential.credentialRevision,
      },
    });
    expect(configurationResponse.statusCode).toBe(200);

    const standingPolicyResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/standing-policy',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        expectedRevision: 0,
        enabled: true,
        providerId: 'deepseek',
        aiConfigurationRevision: 1,
      },
    });
    expect(standingPolicyResponse.statusCode).toBe(200);

    const embeddingCredentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/embedding-credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        secret: 'c6-openai-invalid-before-replacement',
        clientRequestId: `c6-embedding-${crypto.randomUUID()}`,
      },
    });
    expect(embeddingCredentialResponse.statusCode).toBe(200);
    const initialEmbeddingCredential = (
      embeddingCredentialResponse.json() as {
        credential: { credentialId: string; credentialRevision: number };
      }
    ).credential;

    const prepared = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: {},
    });
    expect(prepared.statusCode).toBe(200);
    const readyBefore = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-comparison-status',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(readyBefore.json()).toMatchObject({
      status: {
        status: 'READY',
        rollout: 'V1_ONLY',
        profile: {
          credentialId: initialEmbeddingCredential.credentialId,
          credentialRevision: 1,
        },
      },
    });
    const profileBefore = await fixture.semanticProfile.getCurrent(fixture.projectId);
    const generationBefore = fixture.getActiveGeneration();
    if (!profileBefore || !generationBefore) throw new Error('C6 fixture was not ready.');

    const settingsSnapshot = await fixture.settingsRepository.getSettingsSnapshot(
      fixture.projectId,
    );
    const activated = await fixture.settingsRepository.applySettingsCommand({
      commandId: `c6-activation-${crypto.randomUUID()}`,
      clientRequestId: `c6-activation-${crypto.randomUUID()}`,
      idempotencyKey: `c6-activation-${crypto.randomUUID()}`,
      projectId: fixture.projectId,
      expectedSettingsRevision: settingsSnapshot.settingsRevision,
      observedPolicyContextRevision: settingsSnapshot.policyContextRevision,
      settings: { 'comparison.stage5.rollout': 'V2_ACTIVE' },
      actorId: 'owner-1',
    });
    expect(activated.status).toBe('APPLIED');
    const generativeBefore = (
      await fixture.application.server.inject({
        method: 'GET',
        url: '/api/v1/settings/ai',
        headers: { cookie: fixture.headers.cookie },
      })
    ).json() as {
      settings: { currentConfiguration?: unknown; standingPolicy?: unknown };
    };

    const browserSuppliedCredentialIdentity = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/embedding-credentials/replace',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: 'browser-must-not-select-this',
        secret: 'c6-rejected-extra-field',
        clientRequestId: `c6-extra-${crypto.randomUUID()}`,
      },
    });
    expect(browserSuppliedCredentialIdentity.statusCode).toBe(400);
    expect(browserSuppliedCredentialIdentity.json()).toMatchObject({ code: 'VALIDATION_ERROR' });

    const unboundProvider = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/embedding-credentials/replace',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'google-gemini',
        embeddingModelId: 'gemini-embedding-001',
        secret: 'c6-rejected-unbound-provider',
        clientRequestId: `c6-unbound-${crypto.randomUUID()}`,
      },
    });
    expect(unboundProvider.statusCode).toBe(409);
    expect(unboundProvider.json()).toMatchObject({ code: 'CONFLICT' });
    expect(JSON.stringify(unboundProvider.json())).not.toContain('c6-rejected-unbound-provider');

    const replaced = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/embedding-credentials/replace',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        secret: 'c6-openai-replacement',
        clientRequestId: `c6-replace-${crypto.randomUUID()}`,
      },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({
      credential: {
        credentialId: initialEmbeddingCredential.credentialId,
        credentialRevision: 2,
        lifecycleState: 'active',
      },
    });
    expect(JSON.stringify(replaced.json())).not.toContain('c6-openai-replacement');

    const settingsAfterReplacement = (
      await fixture.application.server.inject({
        method: 'GET',
        url: '/api/v1/settings/ai',
        headers: { cookie: fixture.headers.cookie },
      })
    ).json() as {
      settings: {
        currentConfiguration?: unknown;
        standingPolicy?: unknown;
        credentialStatuses: Array<{
          credentialId: string;
          credentialRevision: number;
          lifecycleState: string;
        }>;
      };
    };
    expect(settingsAfterReplacement.settings.currentConfiguration).toEqual(
      generativeBefore.settings.currentConfiguration,
    );
    expect(settingsAfterReplacement.settings.standingPolicy).toEqual(
      generativeBefore.settings.standingPolicy,
    );
    expect(settingsAfterReplacement.settings.credentialStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credentialId: initialEmbeddingCredential.credentialId,
          credentialRevision: 2,
          lifecycleState: 'active',
        }),
      ]),
    );
    await expect(
      fixture.vault.getMetadata({
        projectId: fixture.projectId,
        providerId: 'openai',
        credentialId: initialEmbeddingCredential.credentialId,
        credentialRevision: 1,
      }),
    ).resolves.toMatchObject({ lifecycleState: 'superseded' });
    expect(await fixture.semanticProfile.getRevision(fixture.projectId, 1)).toEqual(profileBefore);
    expect(fixture.getActiveGeneration()).toEqual(generationBefore);

    const attention = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-comparison-status',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(attention.json()).toMatchObject({
      status: {
        status: 'NEEDS_ATTENTION',
        rollout: 'V2_ACTIVE',
        profile: { profileRevision: 1, credentialRevision: 1 },
      },
    });

    const rebound = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: {},
    });
    expect(rebound.statusCode).toBe(200);
    expect(rebound.json()).toMatchObject({
      status: {
        status: 'READY',
        rollout: 'V2_ACTIVE',
        profile: { profileRevision: 2, credentialRevision: 2 },
        generation: { embeddingProfileRevision: 2, buildStatus: 'READY' },
      },
    });
    expect(await fixture.semanticProfile.getRevision(fixture.projectId, 1)).toEqual(profileBefore);
    expect(await fixture.semanticProfile.getRevision(fixture.projectId, 2)).toMatchObject({
      credentialId: initialEmbeddingCredential.credentialId,
      credentialRevision: 2,
      status: 'PREPARED',
    });
  });

  it('configures a fresh DeepSeek Project embedding credential without mutating generative AI configuration', async () => {
    const fixture = await createFixture();
    const generativeCredentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'deepseek',
        secret: 'deepseek-generative-test',
        clientRequestId: `c4-deepseek-${crypto.randomUUID()}`,
      },
    });
    expect(generativeCredentialResponse.statusCode).toBe(200);
    const generativeCredential = (
      generativeCredentialResponse.json() as {
        credential: { credentialId: string; credentialRevision: number };
      }
    ).credential;

    const configured = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/configuration',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        expectedRevision: 0,
        providerId: 'deepseek',
        modelId: 'deepseek-flash',
        credentialId: generativeCredential.credentialId,
        credentialRevision: generativeCredential.credentialRevision,
      },
    });
    expect(configured.statusCode).toBe(200);

    const automaticProcessing = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/standing-policy',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        expectedRevision: 0,
        enabled: true,
        providerId: 'deepseek',
        aiConfigurationRevision: 1,
      },
    });
    expect(automaticProcessing.statusCode).toBe(200);
    expect(automaticProcessing.json()).toMatchObject({
      standingPolicy: { enabled: true, providerId: 'deepseek', aiConfigurationRevision: 1 },
    });

    const beforeSettingsResponse = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(beforeSettingsResponse.statusCode).toBe(200);
    const beforeSettings = (beforeSettingsResponse.json() as { settings: Record<string, unknown> })
      .settings;
    expect(beforeSettings).toMatchObject({
      currentConfiguration: {
        activeProviderId: 'deepseek',
        activeModelId: 'deepseek-flash',
        aiConfigurationRevision: 1,
      },
    });

    const embeddingCredentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/embedding-credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        secret: 'openai-embedding-test',
        clientRequestId: `c4-embedding-${crypto.randomUUID()}`,
      },
    });
    expect(embeddingCredentialResponse.statusCode).toBe(200);
    expect(embeddingCredentialResponse.json()).toMatchObject({
      credential: { providerId: 'openai', lifecycleState: 'active' },
    });
    expect(JSON.stringify(embeddingCredentialResponse.json())).not.toContain(
      'openai-embedding-test',
    );

    const afterSettingsResponse = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(afterSettingsResponse.statusCode).toBe(200);
    const afterSettings = (afterSettingsResponse.json() as { settings: Record<string, unknown> })
      .settings;
    expect(afterSettings.currentConfiguration).toEqual(beforeSettings.currentConfiguration);

    const statusResponse = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-comparison-status',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(statusResponse.json()).toMatchObject({
      status: {
        status: 'NOT_CONFIGURED',
        embeddingOptions: expect.arrayContaining([
          expect.objectContaining({
            providerId: 'openai',
            embeddingModelId: 'text-embedding-3-small',
            hasActiveCredential: true,
          }),
        ]),
      },
    });
    expect(JSON.stringify(statusResponse.json())).not.toContain('deepseek-v4-flash');

    const prepared = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        embeddingProviderId: 'openai',
        embeddingModelId: 'text-embedding-3-large',
      },
    });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json()).toMatchObject({
      status: {
        status: 'READY',
        profile: { providerId: 'openai', embeddingModelId: 'text-embedding-3-large' },
        generation: { providerId: 'openai', embeddingModelId: 'text-embedding-3-large' },
      },
    });
  });

  it('derives semantic credential authority from the registry and rejects unknown models', async () => {
    const fixture = await createFixture();
    const browserAuthorityInjection = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/embedding-credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        secret: 'must-not-be-stored',
        clientRequestId: `c4-authority-${crypto.randomUUID()}`,
        activeModelId: 'deepseek-flash',
      },
    });
    expect(browserAuthorityInjection.statusCode).toBe(400);
    expect(browserAuthorityInjection.json()).toMatchObject({ code: 'VALIDATION_ERROR' });

    const unknownModel = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/embedding-credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'deepseek',
        embeddingModelId: 'deepseek-v4-flash',
        secret: 'must-not-be-stored',
        clientRequestId: `c4-unknown-${crypto.randomUUID()}`,
      },
    });
    expect(unknownModel.statusCode).toBe(503);
    expect(unknownModel.json()).toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });
    expect(JSON.stringify(unknownModel.json())).not.toContain('must-not-be-stored');
  });

  it('keeps rollout V1_ONLY when semantic refresh fails', async () => {
    const fixture = await createFixture({ refreshFails: true });
    const credentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'openai',
        secret: 'semantic-test',
      },
    });
    expect(credentialResponse.statusCode).toBe(200);
    const prepared = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: {},
    });
    expect(prepared.statusCode).toBe(500);
    const status = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-comparison-status',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(status.json()).toMatchObject({ status: { rollout: 'V1_ONLY' } });
  });

  it('does not treat a READY generation with a stale source watermark as eligible', async () => {
    const fixture = await createFixture();
    const credentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'openai',
        secret: 'semantic-test',
      },
    });
    expect(credentialResponse.statusCode).toBe(200);
    const prepared = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: {},
    });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json()).toMatchObject({ status: { status: 'READY' } });

    const settingsSnapshot = await fixture.settingsRepository.getSettingsSnapshot(
      fixture.projectId,
    );
    const activation = await fixture.settingsRepository.applySettingsCommand({
      commandId: `semantic-activation-${crypto.randomUUID()}`,
      clientRequestId: `semantic-activation-${crypto.randomUUID()}`,
      idempotencyKey: `semantic-activation-${crypto.randomUUID()}`,
      projectId: fixture.projectId,
      expectedSettingsRevision: settingsSnapshot.settingsRevision,
      observedPolicyContextRevision: settingsSnapshot.policyContextRevision,
      settings: { 'comparison.stage5.rollout': 'V2_ACTIVE' },
      actorId: 'owner-1',
    });
    expect(activation.status).toBe('APPLIED');
    const revisionAfterActivation = (
      await fixture.settingsRepository.getSettingsSnapshot(fixture.projectId)
    ).settingsRevision;

    fixture.setSourceWatermark({ canonicalVersion: 2, sourceSnapshotDigest: 'sha256:changed' });
    const stale = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-comparison-status',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(stale.statusCode).toBe(200);
    expect(stale.json()).toMatchObject({
      status: { status: 'NEEDS_ATTENTION', rollout: 'V2_ACTIVE' },
    });
    const refreshed = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: {},
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json()).toMatchObject({ status: { status: 'READY', rollout: 'V2_ACTIVE' } });
    expect(fixture.getRefreshCount()).toBe(2);
    expect(
      (await fixture.settingsRepository.getSettingsSnapshot(fixture.projectId)).settingsRevision,
    ).toBe(revisionAfterActivation);
  });

  it('selects a deterministic registered embedding fallback when OpenAI is unavailable', async () => {
    const fixture = await createFixture();
    const credentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'google-gemini',
        secret: 'gemini-embedding-test',
      },
    });
    expect(credentialResponse.statusCode).toBe(200);
    const prepared = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: {},
    });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json()).toMatchObject({
      status: {
        status: 'READY',
        profile: { providerId: 'google-gemini', embeddingModelId: 'gemini-embedding-001' },
        generation: { providerId: 'google-gemini', embeddingModelId: 'gemini-embedding-001' },
      },
    });
  });

  it('fails closed when the preferred provider has ambiguous active credentials', async () => {
    const fixture = await createFixture();
    for (const secret of ['semantic-test-a', 'semantic-test-b']) {
      const credentialResponse = await fixture.application.server.inject({
        method: 'POST',
        url: '/api/v1/settings/ai/credentials',
        headers: fixture.headers,
        payload: { targetProjectId: fixture.projectId, providerId: 'openai', secret },
      });
      expect(credentialResponse.statusCode).toBe(200);
    }
    const prepared = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: {},
    });
    expect(prepared.statusCode).toBe(503);
    expect(prepared.json()).toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
  });

  it('revalidates current embedding execution eligibility without calling a provider', async () => {
    const fixture = await createFixture();
    const credentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'openai',
        secret: 'semantic-test',
      },
    });
    expect(credentialResponse.statusCode).toBe(200);
    const prepared = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: {},
    });
    expect(prepared.statusCode).toBe(200);

    const settingsSnapshot = await fixture.settingsRepository.getSettingsSnapshot(
      fixture.projectId,
    );
    const activation = await fixture.settingsRepository.applySettingsCommand({
      commandId: `semantic-activation-${crypto.randomUUID()}`,
      clientRequestId: `semantic-activation-${crypto.randomUUID()}`,
      idempotencyKey: `semantic-activation-${crypto.randomUUID()}`,
      projectId: fixture.projectId,
      expectedSettingsRevision: settingsSnapshot.settingsRevision,
      observedPolicyContextRevision: settingsSnapshot.policyContextRevision,
      settings: { 'comparison.stage5.rollout': 'V2_ACTIVE' },
      actorId: 'owner-1',
    });
    expect(activation.status).toBe('APPLIED');

    fixture.setExecutionEligible(false);
    const denied = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-comparison-status',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.json()).toMatchObject({
      status: { status: 'NEEDS_ATTENTION', rollout: 'V2_ACTIVE' },
    });
    const deniedPrepare = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-comparison/prepare',
      headers: fixture.headers,
      payload: {},
    });
    expect(deniedPrepare.statusCode).toBe(200);
    expect(deniedPrepare.json()).toMatchObject({
      status: { status: 'NEEDS_ATTENTION', rollout: 'V2_ACTIVE' },
    });

    fixture.setExecutionEligible(true);
    const restored = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-comparison-status',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(restored.json()).toMatchObject({
      status: { status: 'READY', rollout: 'V2_ACTIVE' },
    });
    expect(fixture.getExecutionResolutionCount()).toBeGreaterThan(0);
  });

  it('provisions a PREPARED profile through the Product API and enforces server ownership/CAS', async () => {
    const fixture = await createFixture();
    const empty = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ profile: null });

    const credentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'openai',
        secret: 'semantic-profile-test-secret',
      },
    });
    expect(credentialResponse.statusCode).toBe(200);
    const credential = (
      credentialResponse.json() as {
        credential: { credentialId: string; credentialRevision: number };
      }
    ).credential;

    const profileResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: fixture.headers,
      payload: {
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
      },
    });
    expect(profileResponse.statusCode).toBe(200);
    expect(profileResponse.json()).toMatchObject({
      profile: {
        projectId: fixture.projectId,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        profileRevision: 1,
        status: 'PREPARED',
      },
    });

    const readBack = await fixture.application.server.inject({
      method: 'GET',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: { cookie: fixture.headers.cookie },
    });
    expect(readBack.statusCode).toBe(200);
    expect(readBack.json()).toMatchObject({ profile: { profileRevision: 1, status: 'PREPARED' } });

    const unknownAuthority = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: fixture.headers,
      payload: {
        expectedRevision: 1,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
        projectId: 'attacker-controlled-project',
      },
    });
    expect(unknownAuthority.statusCode).toBe(400);
    expect(unknownAuthority.json()).toMatchObject({ code: 'VALIDATION_ERROR' });

    const stale = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: fixture.headers,
      payload: {
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects generative DeepSeek as a semantic embedding profile', async () => {
    const fixture = await createFixture();
    const credentialResponse = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/credentials',
      headers: fixture.headers,
      payload: {
        targetProjectId: fixture.projectId,
        providerId: 'deepseek',
        secret: 'deepseek-test',
      },
    });
    expect(credentialResponse.statusCode).toBe(200);
    const credential = (
      credentialResponse.json() as {
        credential: { credentialId: string; credentialRevision: number };
      }
    ).credential;
    const response = await fixture.application.server.inject({
      method: 'POST',
      url: '/api/v1/settings/ai/semantic-embedding-profile',
      headers: fixture.headers,
      payload: {
        expectedRevision: 0,
        providerId: 'deepseek',
        embeddingModelId: 'deepseek-v4-flash',
        credentialId: credential.credentialId,
        credentialRevision: credential.credentialRevision,
      },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });
  });
});
