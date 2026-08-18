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

describe('AKP-1 WP1: SemanticEmbeddingProfile Authority', () => {
  const createServices = () => {
    const embeddingRepo = new InMemorySemanticEmbeddingProfileRepository();
    const embeddingRegistry = initialSemanticEmbeddingRegistry();
    const embeddingProfileService = new SemanticEmbeddingProfileService(
      embeddingRegistry,
      embeddingRepo,
    );

    const aiConfigRepo = new InMemoryProjectAIConfigurationRepository();
    const aiConfigRegistry = initialProviderRegistry();
    const aiConfigService = new ProjectAIConfigurationService(aiConfigRegistry, aiConfigRepo, {
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
    };
  };

  it('creates server-owned SemanticEmbeddingProfile in BUILDING status with dimension metadata', async () => {
    const { embeddingProfileService } = createServices();

    const profile = await embeddingProfileService.createProfile({
      projectId: 'project-akp-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      updatedBy: 'principal-owner',
      now: '2026-08-18T12:00:00.000Z',
    });

    expect(profile).toMatchObject({
      projectId: 'project-akp-1',
      profileRevision: 1,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      dimension: 1536,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      status: 'BUILDING',
      updatedBy: 'principal-owner',
    });
    expect(profile.profileId).toBeDefined();
  });

  it('handles profile activation and retires previously active profile', async () => {
    const { embeddingProfileService } = createServices();

    const p1 = await embeddingProfileService.createProfile({
      projectId: 'project-akp-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      updatedBy: 'principal-owner',
    });

    expect(await embeddingProfileService.getActive('project-akp-1')).toBeUndefined();

    const activeP1 = await embeddingProfileService.activateProfile({
      projectId: 'project-akp-1',
      profileId: p1.profileId,
      profileRevision: 1,
      updatedBy: 'principal-owner',
    });
    expect(activeP1.status).toBe('ACTIVE');

    const currentActive = await embeddingProfileService.getActive('project-akp-1');
    expect(currentActive?.profileId).toBe(p1.profileId);
    expect(currentActive?.status).toBe('ACTIVE');

    // Create a new generation profile
    const p2 = await embeddingProfileService.createProfile({
      projectId: 'project-akp-1',
      expectedRevision: 1,
      providerId: 'google-gemini',
      embeddingModelId: 'text-embedding-004',
      updatedBy: 'principal-owner',
    });
    expect(p2.status).toBe('BUILDING');
    expect(p2.dimension).toBe(768);

    // Active profile is still p1
    expect((await embeddingProfileService.getActive('project-akp-1'))?.profileId).toBe(
      p1.profileId,
    );

    // Explicitly activate p2
    const activeP2 = await embeddingProfileService.activateProfile({
      projectId: 'project-akp-1',
      profileId: p2.profileId,
      profileRevision: 2,
      updatedBy: 'principal-owner',
    });
    expect(activeP2.status).toBe('ACTIVE');

    // Now active is p2, and p1 has become RETIRED
    expect((await embeddingProfileService.getActive('project-akp-1'))?.profileId).toBe(
      p2.profileId,
    );
    const retiredP1 = await embeddingProfileService.getRevision('project-akp-1', 1);
    expect(retiredP1?.status).toBe('RETIRED');
  });

  it('rejects stale profile creation revisions with CONFLICT error', async () => {
    const { embeddingProfileService } = createServices();

    await embeddingProfileService.createProfile({
      projectId: 'project-akp-1',
      expectedRevision: 0,
      providerId: 'openai',
      embeddingModelId: 'text-embedding-3-small',
      updatedBy: 'principal-owner',
    });

    // Stale revision 0
    await expect(
      embeddingProfileService.createProfile({
        projectId: 'project-akp-1',
        expectedRevision: 0,
        providerId: 'openai',
        embeddingModelId: 'text-embedding-3-large',
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

    // 2. Configure embedding profile to use Google Gemini text-embedding-004
    const embProfile = await embeddingProfileService.createProfile({
      projectId: 'project-akp-1',
      expectedRevision: 0,
      providerId: 'google-gemini',
      embeddingModelId: 'text-embedding-004',
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
    expect(activeEmbProfile?.embeddingModelId).toBe('text-embedding-004');
  });
});
