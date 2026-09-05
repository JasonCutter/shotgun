import { describe, expect, it, vi } from 'vitest';

import { EffectiveAIConfigurationResolver } from '../../adapters/ai-runtime-resolution/src/index.js';
import { AIProviderRouter } from '../../adapters/ai-provider-router/src/index.js';
import { InMemoryProjectAIConfigurationRepository } from '../../adapters/ai-configuration-in-memory/src/index.js';
import {
  initialProviderRegistry,
  ProjectAIConfigurationService,
  type ProjectAIConfiguration,
} from '../../modules/ai-configuration/src/index.js';
import { DiscoveryModelProfileService } from '../../modules/discovery-ai-generation/src/profile.js';
import {
  type CredentialMetadata,
  type CredentialVaultPort,
} from '../../modules/credential-vault/src/index.js';
import {
  StaticAIProviderConnectivityRegistry,
  type AIProviderConnectivityAdapter,
} from '../../modules/ai-settings-backend/src/index.js';
import {
  StandingAIProcessingPolicyService,
  type StandingAIProcessingPolicyRepositoryPort,
} from '../../packages/policy/src/index.js';
import type { AskProviderPolicyResolverPort } from '../../packages/contracts/src/index.js';

const projectId = 'deepseek-policy-project';
const deepseekCredential: CredentialMetadata = {
  credentialId: 'credential-deepseek',
  projectId,
  providerId: 'deepseek',
  encryptionVersion: 'aes-256-gcm:v1',
  keyVersion: 'test',
  credentialRevision: 1,
  lifecycleState: 'active',
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
};

const openaiCredential: CredentialMetadata = {
  ...deepseekCredential,
  credentialId: 'credential-openai',
  providerId: 'openai',
};

const configuration = (providerId: string, modelId: string): ProjectAIConfiguration => ({
  projectId,
  activeProviderId: providerId,
  activeModelId: modelId,
  credentialId:
    providerId === 'deepseek' ? deepseekCredential.credentialId : openaiCredential.credentialId,
  credentialRevision: 1,
  aiConfigurationRevision: 2,
  updatedBy: 'owner',
  updatedAt: '2026-09-05T00:00:00.000Z',
});

const policy = (): AskProviderPolicyResolverPort => ({
  evaluateSelections: async () => ({
    schemaVersion: '1.0.0',
    eligible: true,
    reason: 'ELIGIBLE',
    requiredAction: 'NONE',
    policyFingerprint: 'policy-deepseek',
    policyContextRevision: 'standing-1',
    provider: { displayName: 'DeepSeek', model: 'deepseek-v4-flash' },
    message: 'eligible',
  }),
  evaluateContext: async () => ({
    schemaVersion: '1.0.0',
    eligible: true,
    reason: 'ELIGIBLE',
    requiredAction: 'NONE',
    policyFingerprint: 'policy-deepseek',
    policyContextRevision: 'standing-1',
    provider: { displayName: 'DeepSeek', model: 'deepseek-v4-flash' },
    message: 'eligible',
  }),
});

const vaultFor = (metadata: CredentialMetadata): CredentialVaultPort =>
  ({
    getMetadata: async () => metadata,
  }) as unknown as CredentialVaultPort;

const standing = (providerId: string, aiConfigurationRevision: number) => ({
  getCurrent: async () => ({ enabled: true, providerId, aiConfigurationRevision }),
});

const historicalMigrationPolicy = (
  deploymentAllowsPrivate = true,
): AskProviderPolicyResolverPort => ({
  ...policy(),
  evaluateContext: async (input) => {
    if (input.sensitivities.includes('restricted')) {
      return {
        schemaVersion: '1.0.0',
        eligible: false,
        reason: 'RESTRICTED_CONTEXT_BLOCKED',
        requiredAction: 'REMOVE_RESTRICTED_CONTEXT',
        policyFingerprint: 'current-deepseek-policy',
        policyContextRevision: 'standing-3',
        provider: { displayName: 'OpenAI', model: 'gpt-5.6-luna' },
        message: 'restricted context is denied',
      };
    }
    if (input.providerId === 'openai') {
      if (input.sensitivities.includes('private') && !deploymentAllowsPrivate) {
        return {
          schemaVersion: '1.0.0',
          eligible: false,
          reason: 'DEPLOYMENT_POLICY_BLOCKED',
          requiredAction: 'CONTACT_DEPLOYMENT_ADMINISTRATOR',
          policyFingerprint: 'current-deepseek-policy',
          policyContextRevision: 'standing-3',
          provider: { displayName: 'OpenAI', model: 'gpt-5.6-luna' },
          message: 'deployment blocks private OpenAI transfer',
        };
      }
      if (input.ignoreStandingProviderMismatch === true) {
        return {
          schemaVersion: '1.0.0',
          eligible: true,
          reason: 'ELIGIBLE',
          requiredAction: 'NONE',
          policyFingerprint: 'current-deepseek-policy',
          policyContextRevision: 'standing-3',
          provider: { displayName: 'OpenAI', model: 'gpt-5.6-luna' },
          message: 'historical provider mismatch ignored only',
        };
      }
      return {
        schemaVersion: '1.0.0',
        eligible: false,
        reason: 'STANDING_POLICY_PROVIDER_MISMATCH',
        requiredAction: 'CONFIGURE_STANDING_AI_FOR_PROVIDER',
        policyFingerprint: 'current-deepseek-policy',
        policyContextRevision: 'standing-3',
        provider: { displayName: 'OpenAI', model: 'gpt-5.6-luna' },
        message: 'historical provider is no longer current',
      };
    }
    return policy().evaluateContext(input);
  },
});

const historicalMigrationFixture = (
  options: {
    readonly deploymentAllowsPrivate?: boolean;
    readonly standingEnabled?: boolean;
  } = {},
) => {
  const current = {
    ...configuration('deepseek', 'deepseek-v4-flash'),
    aiConfigurationRevision: 3,
  };
  const historical = configuration('openai', 'gpt-5.6-luna');
  const getRevision = vi.fn(async () => historical);
  const resolver = new EffectiveAIConfigurationResolver(
    initialProviderRegistry(),
    { getCurrent: async () => current, getRevision } as never,
    {
      getMetadata: async (scope: { readonly providerId: string }) =>
        scope.providerId === 'deepseek' ? deepseekCredential : openaiCredential,
    } as unknown as CredentialVaultPort,
    {
      enforceDeepSeekOnly: true,
      policy: historicalMigrationPolicy(options.deploymentAllowsPrivate ?? true),
      standingPolicyAuthority: {
        getCurrent: async () => ({
          enabled: options.standingEnabled ?? true,
          providerId: 'deepseek',
          aiConfigurationRevision: 3,
        }),
      },
    },
  );
  return { current, historical, getRevision, resolver };
};

describe('DeepSeek-only generative AI execution policy (DSK-1..DSK-8)', () => {
  it('DSK-1 rejects new OpenAI/Gemini configurations and accepts DeepSeek', async () => {
    const repository = new InMemoryProjectAIConfigurationRepository();
    const service = new ProjectAIConfigurationService(
      initialProviderRegistry(),
      repository,
      {
        getMetadata: async (scope) =>
          scope.providerId === 'deepseek' ? deepseekCredential : openaiCredential,
      },
      undefined,
      { enforceDeepSeekOnly: true },
    );

    await expect(
      service.save({
        projectId,
        expectedRevision: 0,
        activeProviderId: 'openai',
        activeModelId: 'gpt-5.6-luna',
        credentialId: openaiCredential.credentialId,
        credentialRevision: 1,
        updatedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      service.save({
        projectId,
        expectedRevision: 0,
        activeProviderId: 'deepseek',
        activeModelId: 'deepseek-v4-flash',
        credentialId: deepseekCredential.credentialId,
        credentialRevision: 1,
        updatedBy: 'owner',
      }),
    ).resolves.toMatchObject({ activeProviderId: 'deepseek', activeModelId: 'deepseek-v4-flash' });
  });

  it('DSK-2 blocks a new Ask/Stage 4 pin for a stale non-DeepSeek current configuration', async () => {
    const resolver = new EffectiveAIConfigurationResolver(
      initialProviderRegistry(),
      { getCurrent: async () => configuration('openai', 'gpt-5.6-luna') } as never,
      vaultFor(openaiCredential),
      {
        enforceDeepSeekOnly: true,
        policy: policy(),
        standingPolicyAuthority: standing('openai', 2),
      },
    );
    await expect(
      resolver.resolveInitialAIExecutionIdentity({
        principalId: 'owner',
        projectId,
        answerRunId: 'ask-new',
        authorizedContext: {
          snapshot: {} as never,
          evidence: [],
          context: [],
          contextStatus: 'SUPPORTED',
          resolvedContextDigest: 'd',
          queryPlanRevision: 'q',
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
  });

  it('DSK-3 and DSK-4 resolve new Ask and Source execution through DeepSeek', async () => {
    const resolver = new EffectiveAIConfigurationResolver(
      initialProviderRegistry(),
      { getCurrent: async () => configuration('deepseek', 'deepseek-v4-flash') } as never,
      vaultFor(deepseekCredential),
      {
        enforceDeepSeekOnly: true,
        policy: policy(),
        standingPolicyAuthority: standing('deepseek', 2),
      },
    );
    const ask = await resolver.resolveInitialAIExecutionIdentity({
      principalId: 'owner',
      projectId,
      answerRunId: 'ask-deepseek',
      authorizedContext: {
        snapshot: {} as never,
        evidence: [],
        context: [],
        contextStatus: 'SUPPORTED',
        resolvedContextDigest: 'd',
        queryPlanRevision: 'q',
      },
    });
    expect(ask).toMatchObject({ providerId: 'deepseek', modelId: 'deepseek-v4-flash' });
    const source = await resolver.resolveSourceAIExecutionIdentity({
      principalId: 'stage4',
      projectId,
      requestId: 'source-deepseek',
      sourceVersionId: 'source-version',
      sensitivity: 'private',
      accessScope: ['owner'],
      dataClassification: 'source-content',
    });
    expect(source.executionIdentity).toMatchObject({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
  });

  it('DSK-5 rejects a newly authored non-DeepSeek Discovery profile and runtime pin', async () => {
    const profileRepository = {
      findActive: vi.fn(),
      findCurrent: vi.fn(async () => undefined),
      findRevision: vi.fn(),
      saveRevision: vi.fn(),
      updateStatus: vi.fn(),
    };
    const service = new DiscoveryModelProfileService(
      initialProviderRegistry(),
      { getRevision: async () => configuration('openai', 'gpt-5.6-luna') },
      { getMetadata: async () => openaiCredential },
      profileRepository,
      undefined,
      { enforceDeepSeekOnly: true },
    );
    await expect(
      service.createProfile({
        projectId,
        expectedRevision: 0,
        aiConfigurationRevision: 2,
        providerId: 'openai',
        modelId: 'gpt-5.6-luna',
        promptVersion: 'discovery-ai-prompt:v1',
        outputSchemaVersion: 'discovery-ai-output:v1',
        createdBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
  });

  it('DSK-6 keeps Comparison v2 provider identity on the shared DeepSeek execution identity', async () => {
    const resolver = new EffectiveAIConfigurationResolver(
      initialProviderRegistry(),
      { getCurrent: async () => configuration('deepseek', 'deepseek-v4-flash') } as never,
      vaultFor(deepseekCredential),
      {
        enforceDeepSeekOnly: true,
        policy: policy(),
        standingPolicyAuthority: standing('deepseek', 2),
      },
    );
    const identity = await resolver.resolveSourceAIExecutionIdentity({
      principalId: 'comparison-v2',
      projectId,
      requestId: 'comparison-new',
      sourceVersionId: 'candidate-source-version',
      sensitivity: 'internal',
      accessScope: ['owner'],
      dataClassification: 'candidate-content',
    });
    expect(identity.executionIdentity.providerId).toBe('deepseek');
    expect(identity.executionIdentity.modelId).toBe('deepseek-v4-flash');
  });

  it('DSK-7 fails DeepSeek without routing the failure to OpenAI or Gemini', async () => {
    const calls: string[] = [];
    const adapter = (providerId: 'deepseek' | 'openai'): AIProviderConnectivityAdapter => ({
      providerId,
      testConnection: async () => ({}),
      generateStructured: async () => {
        calls.push(providerId);
        if (providerId === 'deepseek') throw new Error('deepseek unavailable');
        return { rawText: '{}' };
      },
    });
    const vault = {
      withCredential: async (_scope: unknown, callback: (key: Uint8Array) => Promise<unknown>) => {
        await callback(Buffer.from('secret'));
        return { status: 'SUCCEEDED' as const };
      },
    } as unknown as CredentialVaultPort;
    const router = new AIProviderRouter(
      initialProviderRegistry(),
      new StaticAIProviderConnectivityRegistry([adapter('deepseek'), adapter('openai')]),
      vault,
    );
    const provider = await router.resolveStructured({
      projectId,
      executionPin: {
        answerRunId: 'source',
        projectId,
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        aiConfigurationRevision: 2,
        credentialId: deepseekCredential.credentialId,
        credentialRevision: 1,
        initialProviderPolicyFingerprint: 'policy-deepseek',
        createdAt: '2026-09-05T00:00:00.000Z',
      },
    });
    await expect(
      provider.generateStructured({ systemInstruction: '', prompt: '', responseSchema: {} }),
    ).rejects.toThrow();
    expect(calls).toEqual(['deepseek']);
  });

  it('DSK-8 preserves an exact historical non-DeepSeek retry identity without allowing a new pin', async () => {
    const historical = configuration('openai', 'gpt-5.6-luna');
    const resolver = new EffectiveAIConfigurationResolver(
      initialProviderRegistry(),
      { getCurrent: async () => historical, getRevision: async () => historical } as never,
      {
        getMetadata: async (scope: { readonly providerId: string }) =>
          scope.providerId === 'deepseek' ? deepseekCredential : openaiCredential,
      } as unknown as CredentialVaultPort,
      {
        enforceDeepSeekOnly: true,
        policy: policy(),
        standingPolicyAuthority: standing('openai', 2),
      },
    );
    const existing = {
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      aiConfigurationRevision: 2,
      credentialId: openaiCredential.credentialId,
      credentialRevision: 1,
      policyContextRevision: 'standing-1',
      providerPolicyFingerprint: 'policy-deepseek',
    };
    const retry = await resolver.resolveSourceAIExecutionIdentity({
      principalId: 'stage4-recovery',
      projectId,
      requestId: 'historical-retry',
      sourceVersionId: 'source-version',
      sensitivity: 'internal',
      accessScope: ['owner'],
      dataClassification: 'source-content',
      existingIdentity: existing,
    });
    expect(retry.executionIdentity.providerId).toBe('openai');
    await expect(
      resolver.resolveInitialAIExecutionIdentity({
        principalId: 'owner',
        projectId,
        answerRunId: 'new-logical-request',
        authorizedContext: {
          snapshot: {} as never,
          evidence: [],
          context: [],
          contextStatus: 'SUPPORTED',
          resolvedContextDigest: 'd',
          queryPlanRevision: 'q',
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
  });

  it('DSK-8A reconstructs a historical OpenAI retry after the current Project migrated to DeepSeek', async () => {
    const { historical, getRevision, resolver } = historicalMigrationFixture();
    const existingIdentity = {
      providerId: 'openai',
      modelId: 'gpt-5.6-luna',
      aiConfigurationRevision: historical.aiConfigurationRevision,
      credentialId: historical.credentialId,
      credentialRevision: historical.credentialRevision,
      policyContextRevision: 'standing-1',
      providerPolicyFingerprint: 'historical-openai-policy',
    };
    const retry = await resolver.resolveSourceAIExecutionIdentity({
      principalId: 'stage4-recovery',
      projectId,
      requestId: 'historical-retry-after-migration',
      sourceVersionId: 'source-version',
      sensitivity: 'internal',
      accessScope: ['owner'],
      dataClassification: 'source-content',
      existingIdentity,
    });
    expect(retry.executionIdentity).toEqual(existingIdentity);
    expect(getRevision).toHaveBeenCalledWith(projectId, 2);
    const fresh = await resolver.resolveInitialAIExecutionIdentity({
      principalId: 'owner',
      projectId,
      answerRunId: 'new-deepseek-request',
      authorizedContext: {
        snapshot: {} as never,
        evidence: [],
        context: [],
        contextStatus: 'SUPPORTED',
        resolvedContextDigest: 'd',
        queryPlanRevision: 'q',
      },
    });
    expect(fresh).toMatchObject({ providerId: 'deepseek', modelId: 'deepseek-v4-flash' });
  });

  it('DSK-8B preserves the private deployment veto during historical provider migration', async () => {
    const { historical, resolver } = historicalMigrationFixture({
      deploymentAllowsPrivate: false,
    });
    await expect(
      resolver.resolveSourceAIExecutionIdentity({
        principalId: 'stage4-recovery',
        projectId,
        requestId: 'historical-private-retry',
        sourceVersionId: 'source-version',
        sensitivity: 'private',
        accessScope: ['owner'],
        dataClassification: 'source-content',
        existingIdentity: {
          providerId: 'openai',
          modelId: 'gpt-5.6-luna',
          aiConfigurationRevision: historical.aiConfigurationRevision,
          credentialId: historical.credentialId,
          credentialRevision: historical.credentialRevision,
          policyContextRevision: 'standing-1',
          providerPolicyFingerprint: 'historical-openai-policy',
        },
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('DSK-8C blocks historical recovery when the current Standing Policy is disabled', async () => {
    const { historical, resolver } = historicalMigrationFixture({ standingEnabled: false });
    await expect(
      resolver.resolveSourceAIExecutionIdentity({
        principalId: 'stage4-recovery',
        projectId,
        requestId: 'historical-disabled-retry',
        sourceVersionId: 'source-version',
        sensitivity: 'internal',
        accessScope: ['owner'],
        dataClassification: 'source-content',
        existingIdentity: {
          providerId: 'openai',
          modelId: 'gpt-5.6-luna',
          aiConfigurationRevision: historical.aiConfigurationRevision,
          credentialId: historical.credentialId,
          credentialRevision: historical.credentialRevision,
          policyContextRevision: 'standing-1',
          providerPolicyFingerprint: 'historical-openai-policy',
        },
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it('DSK-8D keeps restricted historical recovery denied', async () => {
    const { historical, resolver } = historicalMigrationFixture();
    await expect(
      resolver.resolveSourceAIExecutionIdentity({
        principalId: 'stage4-recovery',
        projectId,
        requestId: 'historical-restricted-retry',
        sourceVersionId: 'source-version',
        sensitivity: 'restricted',
        accessScope: ['owner'],
        dataClassification: 'source-content',
        existingIdentity: {
          providerId: 'openai',
          modelId: 'gpt-5.6-luna',
          aiConfigurationRevision: historical.aiConfigurationRevision,
          credentialId: historical.credentialId,
          credentialRevision: historical.credentialRevision,
          policyContextRevision: 'standing-1',
          providerPolicyFingerprint: 'historical-openai-policy',
        },
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });
});

describe('DeepSeek-only standing-policy write authority', () => {
  it('rejects a new non-DeepSeek standing policy when strict composition is enabled', async () => {
    const repository: StandingAIProcessingPolicyRepositoryPort = {
      getCurrent: async () => undefined,
      saveRevision: async () => 'CREATED',
    };
    const service = new StandingAIProcessingPolicyService(repository, {
      enforceDeepSeekOnly: true,
    });
    await expect(
      service.save({
        projectId,
        expectedRevision: 0,
        enabled: true,
        providerId: 'openai',
        aiConfigurationRevision: 2,
        changedBy: 'owner',
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });
});
