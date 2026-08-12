import { describe, expect, it } from 'vitest';

import { InMemoryProjectAIConfigurationRepository } from '../../adapters/ai-configuration-in-memory/src/index.js';
import {
  initialProviderRegistry,
  ProjectAIConfigurationService,
  type CredentialMetadataReference,
} from '../../modules/ai-configuration/src/index.js';

const activeCredential: CredentialMetadataReference = {
  credentialId: 'credential-a',
  projectId: 'project-a',
  providerId: 'openai',
  credentialRevision: 3,
  lifecycleState: 'active',
};

describe('ProjectAIConfigurationPort contract', () => {
  it('returns registry descriptors and saves only a validated exact credential reference', async () => {
    const service = new ProjectAIConfigurationService(
      initialProviderRegistry(),
      new InMemoryProjectAIConfigurationRepository(),
      { getMetadata: async () => activeCredential },
    );

    expect(service.listProviders()).toHaveLength(3);
    expect(service.listModels('openai')).toEqual([
      expect.objectContaining({
        providerId: 'openai',
        modelId: 'gpt-5.6-luna',
        validationContract: expect.objectContaining({ name: 'structured-json', version: 'v1' }),
      }),
    ]);
    await expect(
      service.save({
        projectId: 'project-a',
        expectedRevision: 0,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: 'credential-a',
        credentialRevision: 3,
        updatedBy: 'owner',
      }),
    ).resolves.toMatchObject({
      projectId: 'project-a',
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: 'credential-a',
      credentialRevision: 3,
      aiConfigurationRevision: 1,
    });
  });

  it('rejects a provider/model mismatch and does not treat native capability as product capability', async () => {
    const service = new ProjectAIConfigurationService(
      initialProviderRegistry(),
      new InMemoryProjectAIConfigurationRepository(),
      { getMetadata: async () => activeCredential },
    );

    expect(service.listModels('google-gemini')[0]).toMatchObject({
      providerNativeCapabilities: expect.arrayContaining(['image', 'audio']),
      shotgunUsableCapabilities: ['text', 'structuredOutput'],
    });
    await expect(
      service.save({
        projectId: 'project-a',
        expectedRevision: 0,
        activeProviderId: 'deepseek',
        activeModelId: 'gpt-5.6-luna',
        credentialId: 'credential-a',
        credentialRevision: 3,
        updatedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' });
  });
});
