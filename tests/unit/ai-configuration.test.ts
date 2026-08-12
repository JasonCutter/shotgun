import { describe, expect, it, vi } from 'vitest';

import { InMemoryProjectAIConfigurationRepository } from '../../adapters/ai-configuration-in-memory/src/index.js';
import {
  initialProviderRegistry,
  ProjectAIConfigurationService,
  StaticProviderRegistry,
  type CredentialMetadataReference,
} from '../../modules/ai-configuration/src/index.js';

const credential = (overrides: Partial<CredentialMetadataReference> = {}) => ({
  credentialId: 'credential-openai',
  projectId: 'project-a',
  providerId: 'openai',
  credentialRevision: 1,
  lifecycleState: 'active' as const,
  ...overrides,
});

const createService = (records: readonly CredentialMetadataReference[] = [credential()]) => {
  const metadata = vi.fn(
    async (scope: {
      projectId: string;
      providerId: string;
      credentialId: string;
      credentialRevision: number;
    }) =>
      records.find(
        (record) =>
          record.projectId === scope.projectId &&
          record.providerId === scope.providerId &&
          record.credentialId === scope.credentialId &&
          record.credentialRevision === scope.credentialRevision,
      ),
  );
  const repository = new InMemoryProjectAIConfigurationRepository();
  return {
    service: new ProjectAIConfigurationService(initialProviderRegistry(), repository, {
      getMetadata: metadata,
    }),
    repository,
    metadata,
  };
};

describe('A3 provider registry, model catalog, and project AI configuration', () => {
  it('exposes exactly the server-owned providers and separates native from usable capabilities', () => {
    const registry = initialProviderRegistry();
    const providers = registry.listProviders();

    expect(providers.map((provider) => provider.providerId)).toEqual([
      'openai',
      'google-gemini',
      'deepseek',
    ]);
    expect(registry.getModel('openai', 'gpt-5.6-luna')).toMatchObject({
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      providerNativeCapabilities: ['text', 'image', 'structuredOutput'],
      shotgunUsableCapabilities: ['text', 'image', 'structuredOutput'],
      capabilityRevision: 'model-catalog:v1',
    });
    expect(registry.getModel('google-gemini', 'gemini-3.6-flash')).toMatchObject({
      providerNativeCapabilities: ['text', 'image', 'audio', 'structuredOutput'],
      shotgunUsableCapabilities: ['text', 'structuredOutput'],
    });
    expect(registry.getProvider('deepseek')?.models[0]?.modelId).toBe('deepseek-v4-flash');
    expect(registry.getProvider('arbitrary-provider')).toBeUndefined();

    const returned = providers[0]!;
    (returned.models as Array<unknown>).length = 0;
    expect(registry.getProvider('openai')?.models).toHaveLength(1);
    expect(() => new StaticProviderRegistry()).not.toThrow();
  });

  it('rejects unknown providers before model or credential resolution', async () => {
    const { service, metadata } = createService();

    expect(() => service.listModels('arbitrary-provider')).toThrowError(
      expect.objectContaining({ code: 'UNKNOWN_PROVIDER' }),
    );
    await expect(
      service.save({
        projectId: 'project-a',
        expectedRevision: 0,
        activeProviderId: 'arbitrary-provider',
        activeModelId: 'gpt-5.6-luna',
        credentialId: 'credential-openai',
        credentialRevision: 1,
        updatedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_PROVIDER' });
    expect(metadata).not.toHaveBeenCalled();
  });

  it('creates revisioned configuration without exposing secret or ciphertext fields', async () => {
    const { service, repository, metadata } = createService();
    const saved = await service.save({
      projectId: 'project-a',
      expectedRevision: 0,
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: 'credential-openai',
      credentialRevision: 1,
      updatedBy: 'owner',
      now: '2026-08-12T00:00:00.000Z',
    });

    expect(saved).toEqual({
      projectId: 'project-a',
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: 'credential-openai',
      credentialRevision: 1,
      aiConfigurationRevision: 1,
      updatedBy: 'owner',
      updatedAt: '2026-08-12T00:00:00.000Z',
    });
    expect(await service.getCurrent('project-a')).toEqual(saved);
    expect(await service.getRevision('project-a', 1)).toEqual(saved);
    expect(JSON.stringify(saved)).not.toMatch(/plaintext|ciphertext|secret|encrypted/i);
    expect(metadata).toHaveBeenCalledWith({
      projectId: 'project-a',
      providerId: 'openai',
      credentialId: 'credential-openai',
      credentialRevision: 1,
    });
    expect(await repository.findRevision('project-a', 2)).toBeUndefined();
  });

  it('preserves history and provider credential references across a provider switch', async () => {
    const openai = credential();
    const deepseek = credential({
      credentialId: 'credential-deepseek',
      providerId: 'deepseek',
    });
    const { service } = createService([openai, deepseek]);

    const first = await service.save({
      projectId: 'project-a',
      expectedRevision: 0,
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: openai.credentialId,
      credentialRevision: openai.credentialRevision,
      updatedBy: 'owner',
    });
    const second = await service.save({
      projectId: 'project-a',
      expectedRevision: first.aiConfigurationRevision,
      activeProviderId: 'deepseek',
      activeModelId: 'deepseek-v4-flash',
      credentialId: deepseek.credentialId,
      credentialRevision: deepseek.credentialRevision,
      updatedBy: 'owner',
    });

    expect(second.aiConfigurationRevision).toBe(2);
    expect(await service.getRevision('project-a', 1)).toEqual(first);
    expect(await service.getCurrent('project-a')).toEqual(second);
  });

  it('fails closed for stale writes, ownership mismatches, and unavailable credentials', async () => {
    const { service } = createService([
      credential(),
      credential({
        credentialId: 'credential-other-project',
        projectId: 'project-b',
      }),
      credential({
        credentialId: 'credential-revoked',
        lifecycleState: 'revoked',
      }),
    ]);
    const first = await service.save({
      projectId: 'project-a',
      expectedRevision: 0,
      activeProviderId: 'openai',
      activeModelId: 'gpt-5.6-luna',
      credentialId: 'credential-openai',
      credentialRevision: 1,
      updatedBy: 'owner',
    });

    await expect(
      service.save({
        projectId: 'project-a',
        expectedRevision: 0,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: 'credential-openai',
        credentialRevision: 1,
        updatedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      service.save({
        projectId: 'project-a',
        expectedRevision: first.aiConfigurationRevision,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: 'credential-other-project',
        credentialRevision: 1,
        updatedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    await expect(
      service.save({
        projectId: 'project-a',
        expectedRevision: first.aiConfigurationRevision,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: 'credential-revoked',
        credentialRevision: 1,
        updatedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_UNAVAILABLE' });
    await expect(
      service.save({
        projectId: 'project-a',
        expectedRevision: first.aiConfigurationRevision,
        activeProviderId: 'openai',
        activeModelId: 'not-registered',
        credentialId: 'credential-openai',
        credentialRevision: 1,
        updatedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' });
  });

  it('rejects a metadata authority response that violates the requested ownership scope', async () => {
    const service = new ProjectAIConfigurationService(
      initialProviderRegistry(),
      new InMemoryProjectAIConfigurationRepository(),
      {
        getMetadata: async () => credential({ projectId: 'project-b' }),
      },
    );

    await expect(
      service.save({
        projectId: 'project-a',
        expectedRevision: 0,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: 'credential-openai',
        credentialRevision: 1,
        updatedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_OWNERSHIP_DENIED' });
  });
});
