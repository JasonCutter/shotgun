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
  SemanticEmbeddingResolverPort,
  SemanticProjectionGeneration,
} from '../../packages/contracts/src/index.js';

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
        capabilityCatalogRevision: 'capability',
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
          capabilityCatalogRevision: 'capability',
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
    settingsRepository,
    setSourceWatermark: (next: typeof sourceWatermark) => {
      sourceWatermark = next;
    },
    getRefreshCount: () => refreshCount,
    setExecutionEligible: (next: boolean) => {
      executionEligible = next;
    },
    getExecutionResolutionCount: () => executionResolutionCount,
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
      payload: { targetProjectId: fixture.projectId, providerId: 'openai', secret: 'semantic-test' },
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
    const revisionAfterActivation = (await fixture.settingsRepository.getSettingsSnapshot(
      fixture.projectId,
    )).settingsRevision;

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
      payload: { targetProjectId: fixture.projectId, providerId: 'openai', secret: 'semantic-test' },
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
