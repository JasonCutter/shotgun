import { describe, expect, it } from 'vitest';

import { InMemorySemanticEmbeddingProfileRepository } from '../../adapters/semantic-embedding-in-memory/src/index.js';
import { InMemoryProjectAIConfigurationRepository } from '../../adapters/ai-configuration-in-memory/src/index.js';
import {
  initialSemanticEmbeddingRegistry,
  SemanticEmbeddingProfileService,
} from '../../modules/semantic-embedding/src/index.js';
import {
  initialProviderRegistry,
  ProjectAIConfigurationService,
} from '../../modules/ai-configuration/src/index.js';
import type { EmbeddingCredentialMetadataReference } from '../../packages/contracts/src/index.js';

describe('AKP-1 WP1: SemanticEmbeddingProfile Authority', () => {
  const createServices = (customCredentials?: readonly EmbeddingCredentialMetadataReference[]) => {
    const embeddingRepo = new InMemorySemanticEmbeddingProfileRepository();
    const embeddingRegistry = initialSemanticEmbeddingRegistry();
    const providerRegistry = initialProviderRegistry();

    const credentialsList: EmbeddingCredentialMetadataReference[] = customCredentials
      ? [...customCredentials]
      : [
          {
            credentialId: 'cred-openai-1',
            projectId: 'project-akp-1',
            providerId: 'openai',
            credentialRevision: 1,
            lifecycleState: 'active',
          },
          {
            credentialId: 'cred-gemini-1',
            projectId: 'project-akp-1',
            providerId: 'google-gemini',
            credentialRevision: 1,
            lifecycleState: 'active',
          },
          {
            credentialId: 'cred-revoked-1',
            projectId: 'project-akp-1',
            providerId: 'openai',
            credentialRevision: 2,
            lifecycleState: 'revoked',
          },
        ];

    const credentialReader = {
      getMetadata: async (scope: {
        projectId: string;
        providerId: string;
        credentialId: string;
        credentialRevision: number;
      }) =>
        credentialsList.find(
          (c) =>
            c.projectId === scope.projectId &&
            c.providerId === scope.providerId &&
            c.credentialId === scope.credentialId &&
            c.credentialRevision === scope.credentialRevision,
        ),
    };

    const embeddingProfileService = new SemanticEmbeddingProfileService(
      providerRegistry,
      embeddingRegistry,
      embeddingRepo,
      credentialReader,
    );

    const aiConfigRepo = new InMemoryProjectAIConfigurationRepository();
    const aiConfigService = new ProjectAIConfigurationService(providerRegistry, aiConfigRepo, {
      getMetadata: async (scope) => ({
        credentialId: scope.credentialId,
        projectId: scope.projectId,
        providerId: scope.providerId,
        credentialRevision: scope.credentialRevision,
        lifecycleState: 'active',
      }),
    });

    return {
      embeddingProfileService,
      embeddingRepo,
      embeddingRegistry,
      aiConfigService,
      aiConfigRepo,
      providerRegistry,
    };
  };

  it('creates server-owned SemanticEmbeddingProfile in BUILDING status with pinned credential and dimension metadata', async () => {
    const { embeddingProfileService } = createServices();

    const profile = await embeddingProfileService.createProfile({
      projectId: 'project-akp-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'actor-creator',
      now: '2026-08-18T12:00:00.000Z',
    });

    expect(profile).toMatchObject({
      projectId: 'project-akp-1',
      profileRevision: 1,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      dimension: 1536,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      status: 'BUILDING',
      updatedBy: 'actor-creator',
      createdAt: '2026-08-18T12:00:00.000Z',
      updatedAt: '2026-08-18T12:00:00.000Z',
    });
    expect(profile.profileId).toBeDefined();
  });

  it('rejects profile creation when referenced credential is missing, mismatched, or revoked', async () => {
    const { embeddingProfileService } = createServices();

    // 1. Missing credential
    await expect(
      embeddingProfileService.createProfile({
        projectId: 'project-akp-1',
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: 'nonexistent-cred',
        credentialRevision: 1,
        updatedBy: 'actor-creator',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFIGURATION_REQUIRED',
    });

    // 2. Mismatched provider credential
    await expect(
      embeddingProfileService.createProfile({
        projectId: 'project-akp-1',
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: 'cred-gemini-1', // Belongs to google-gemini
        credentialRevision: 1,
        updatedBy: 'actor-creator',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFIGURATION_REQUIRED',
    });

    // 3. Revoked credential
    await expect(
      embeddingProfileService.createProfile({
        projectId: 'project-akp-1',
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-small',
        credentialId: 'cred-revoked-1',
        credentialRevision: 2,
        updatedBy: 'actor-creator',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFIGURATION_REQUIRED',
    });
  });

  it('persists updatedBy audit actor and timestamps consistently on profile activation', async () => {
    const { embeddingProfileService } = createServices();

    // Actor A creates the profile
    const p1 = await embeddingProfileService.createProfile({
      projectId: 'project-akp-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'actor-creator-a',
      now: '2026-08-18T10:00:00.000Z',
    });
    expect(p1.updatedBy).toBe('actor-creator-a');
    expect(p1.status).toBe('BUILDING');

    // Actor B activates the profile
    const activatedP1 = await embeddingProfileService.activateProfile({
      projectId: 'project-akp-1',
      profileId: p1.profileId,
      profileRevision: 1,
      updatedBy: 'actor-activator-b',
      now: '2026-08-18T11:00:00.000Z',
    });

    expect(activatedP1.status).toBe('ACTIVE');
    expect(activatedP1.updatedBy).toBe('actor-activator-b');
    expect(activatedP1.activatedAt).toBe('2026-08-18T11:00:00.000Z');
    expect(activatedP1.updatedAt).toBe('2026-08-18T11:00:00.000Z');

    // Re-read active profile
    const currentActive = await embeddingProfileService.getActive('project-akp-1');
    expect(currentActive?.profileId).toBe(p1.profileId);
    expect(currentActive?.status).toBe('ACTIVE');
    expect(currentActive?.updatedBy).toBe('actor-activator-b');
    expect(currentActive?.activatedAt).toBe('2026-08-18T11:00:00.000Z');

    // Re-read historical revision
    const historicalRev1 = await embeddingProfileService.getRevision('project-akp-1', 1);
    expect(historicalRev1?.profileId).toBe(p1.profileId);
    expect(historicalRev1?.status).toBe('ACTIVE');
    expect(historicalRev1?.updatedBy).toBe('actor-activator-b');
    expect(historicalRev1?.activatedAt).toBe('2026-08-18T11:00:00.000Z');
  });

  it('handles profile activation and persists activating actor on auto-retired previous profile', async () => {
    const { embeddingProfileService } = createServices();

    // Actor A creates P1
    const p1 = await embeddingProfileService.createProfile({
      projectId: 'project-akp-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'actor-a',
      now: '2026-08-18T09:00:00.000Z',
    });

    // Actor B activates P1
    await embeddingProfileService.activateProfile({
      projectId: 'project-akp-1',
      profileId: p1.profileId,
      profileRevision: 1,
      updatedBy: 'actor-b',
      now: '2026-08-18T10:00:00.000Z',
    });

    // Actor C creates P2
    const p2 = await embeddingProfileService.createProfile({
      projectId: 'project-akp-1',
      expectedRevision: 1,
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      credentialId: 'cred-gemini-1',
      credentialRevision: 1,
      updatedBy: 'actor-c',
      now: '2026-08-18T11:00:00.000Z',
    });
    expect(p2.status).toBe('BUILDING');
    expect(p2.dimension).toBe(768);

    // Actor D activates P2 (which auto-retires P1)
    await embeddingProfileService.activateProfile({
      projectId: 'project-akp-1',
      profileId: p2.profileId,
      profileRevision: 2,
      updatedBy: 'actor-d',
      now: '2026-08-18T12:00:00.000Z',
    });

    // Now active is p2 with actor-d
    const currentActive = await embeddingProfileService.getActive('project-akp-1');
    expect(currentActive?.profileId).toBe(p2.profileId);
    expect(currentActive?.status).toBe('ACTIVE');
    expect(currentActive?.updatedBy).toBe('actor-d');

    // And p1 has become RETIRED, with updatedBy recorded as actor-d and updatedAt = 12:00:00
    const retiredP1 = await embeddingProfileService.getRevision('project-akp-1', 1);
    expect(retiredP1?.status).toBe('RETIRED');
    expect(retiredP1?.updatedBy).toBe('actor-d');
    expect(retiredP1?.updatedAt).toBe('2026-08-18T12:00:00.000Z');
  });

  it('rejects stale profile creation revisions with CONFLICT error', async () => {
    const { embeddingProfileService } = createServices();

    await embeddingProfileService.createProfile({
      projectId: 'project-akp-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      credentialId: 'cred-openai-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });

    // Stale revision 0
    await expect(
      embeddingProfileService.createProfile({
        projectId: 'project-akp-1',
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-large',
        credentialId: 'cred-openai-1',
        credentialRevision: 1,
        updatedBy: 'principal-owner',
      }),
    ).rejects.toMatchObject({
      name: 'SemanticEmbeddingError',
      embeddingErrorCode: 'CONFLICT',
    });
  });

  it('proves Ask generation ProjectAIConfiguration and SemanticEmbeddingProfile are independent', async () => {
    const { embeddingProfileService, aiConfigService } = createServices();

    // 1. Configure Ask generation to use OpenAI gpt-5.6-luna
    const aiConfig = await aiConfigService.save({
      projectId: 'project-akp-1',
      expectedRevision: 0,
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: 'cred-openai',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    expect(aiConfig.activeModelId).toBe('gpt-5.6-luna');

    // 2. Configure embedding profile to use Google Gemini gemini-embedding-001
    const embProfile = await embeddingProfileService.createProfile({
      projectId: 'project-akp-1',
      expectedRevision: 0,
      providerId: 'google-gemini',
      embeddingModelId: 'gemini-embedding-001',
      credentialId: 'cred-gemini-1',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });
    await embeddingProfileService.activateProfile({
      projectId: 'project-akp-1',
      profileId: embProfile.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });

    // 3. Changing Ask generation model does NOT change embedding profile
    await aiConfigService.save({
      projectId: 'project-akp-1',
      expectedRevision: 1,
      activeProviderId: 'deepseek',
      activeModelId: 'deepseek-v4-flash',
      credentialId: 'cred-deepseek',
      credentialRevision: 1,
      updatedBy: 'principal-owner',
    });

    const activeAskConfig = await aiConfigService.getCurrent('project-akp-1');
    expect(activeAskConfig?.activeModelId).toBe('deepseek-v4-flash');

    const activeEmbProfile = await embeddingProfileService.getActive('project-akp-1');
    expect(activeEmbProfile?.providerId).toBe('google-gemini');
    expect(activeEmbProfile?.embeddingModelId).toBe('gemini-embedding-001');
  });
});
