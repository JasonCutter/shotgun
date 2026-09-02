import { describe, expect, it } from 'vitest';

import {
  EffectiveAIConfigurationResolver,
  type SourceAIExecutionResolution,
} from '../../adapters/ai-runtime-resolution/src/index.js';
import {
  StaticProviderRegistry,
  type ProjectAIConfiguration,
} from '../../modules/ai-configuration/src/index.js';
import type {
  CredentialMetadata,
  CredentialVaultPort,
} from '../../modules/credential-vault/src/index.js';
import type { AskProviderPolicyResolverPort } from '../../packages/contracts/src/index.js';

const projectId = 'stage4-source-runtime-project';
const configuration: ProjectAIConfiguration = {
  projectId,
  activeProviderId: 'deepseek',
  activeModelId: 'deepseek-v4-flash',
  credentialId: 'credential-deepseek',
  credentialRevision: 2,
  aiConfigurationRevision: 4,
  updatedBy: 'owner',
  updatedAt: '2026-09-02T00:00:00.000Z',
};

const credential: CredentialMetadata = {
  credentialId: configuration.credentialId,
  projectId,
  providerId: configuration.activeProviderId,
  encryptionVersion: 'aes-256-gcm:v1',
  keyVersion: 'test',
  credentialRevision: configuration.credentialRevision,
  lifecycleState: 'active',
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
};

const policy = (eligible: boolean): AskProviderPolicyResolverPort => ({
  evaluateSelections: async () => ({
    schemaVersion: '1.0.0',
    eligible,
    reason: eligible ? 'ELIGIBLE' : 'DEPLOYMENT_POLICY_BLOCKED',
    requiredAction: eligible ? 'NONE' : 'CONTACT_DEPLOYMENT_ADMINISTRATOR',
    policyFingerprint: 'policy-fingerprint',
    policyContextRevision: 'policy-revision-3',
    provider: { displayName: 'DeepSeek', model: configuration.activeModelId },
    message: eligible ? 'eligible' : 'blocked',
  }),
  evaluateContext: async () => ({
    schemaVersion: '1.0.0',
    eligible,
    reason: eligible ? 'ELIGIBLE' : 'DEPLOYMENT_POLICY_BLOCKED',
    requiredAction: eligible ? 'NONE' : 'CONTACT_DEPLOYMENT_ADMINISTRATOR',
    policyFingerprint: 'policy-fingerprint',
    policyContextRevision: 'policy-revision-3',
    provider: { displayName: 'DeepSeek', model: configuration.activeModelId },
    message: eligible ? 'eligible' : 'blocked',
  }),
});

const vaultFor = (metadata: CredentialMetadata | undefined): CredentialVaultPort =>
  ({
    getMetadata: async () => metadata,
  }) as unknown as CredentialVaultPort;

const standingPolicy = {
  getCurrent: async () => ({
    enabled: true,
    providerId: configuration.activeProviderId,
    aiConfigurationRevision: configuration.aiConfigurationRevision,
  }),
};

const resolve = async (input: {
  readonly sensitivity?: 'public' | 'internal' | 'private' | 'restricted';
  readonly policyEligible?: boolean;
  readonly metadata?: CredentialMetadata;
  readonly existingIdentity?: SourceAIExecutionResolution['executionIdentity'];
}) => {
  const resolver = new EffectiveAIConfigurationResolver(
    new StaticProviderRegistry(),
    { getCurrent: async () => configuration } as never,
    vaultFor(input.metadata ?? credential),
    {
      policy: policy(input.policyEligible ?? true),
      standingPolicyAuthority: standingPolicy,
      clock: () => '2026-09-02T00:00:00.000Z',
    },
  );
  return resolver.resolveSourceAIExecutionIdentity({
    principalId: 'stage4-service',
    projectId,
    requestId: 'stage4-request-1',
    sourceVersionId: '22222222-2222-4222-8222-222222222222',
    sensitivity: input.sensitivity ?? 'private',
    accessScope: ['owner'],
    dataClassification: 'source-content',
    ...(input.existingIdentity === undefined ? {} : { existingIdentity: input.existingIdentity }),
  });
};

describe('Stage 4 Source AI execution authority', () => {
  it('resolves DeepSeek through the exact Project configuration, credential, and Standing Policy', async () => {
    const resolved = await resolve({});

    expect(resolved.pin).toMatchObject({
      projectId,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      aiConfigurationRevision: 4,
      credentialId: 'credential-deepseek',
      credentialRevision: 2,
      initialProviderPolicyFingerprint: 'policy-fingerprint',
    });
    expect(resolved.executionIdentity).toEqual({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      aiConfigurationRevision: 4,
      credentialId: 'credential-deepseek',
      credentialRevision: 2,
      policyContextRevision: 'policy-revision-3',
      providerPolicyFingerprint: 'policy-fingerprint',
    });
    expect(Object.isFrozen(resolved.pin)).toBe(true);
  });

  it('fails closed before any provider route for restricted, policy-denied, revoked, or unconfigured authority', async () => {
    await expect(resolve({ sensitivity: 'restricted' })).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(resolve({ policyEligible: false })).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
    await expect(
      resolve({ metadata: { ...credential, lifecycleState: 'revoked' } }),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });

    const resolver = new EffectiveAIConfigurationResolver(
      new StaticProviderRegistry(),
      { getCurrent: async () => undefined } as never,
      vaultFor(undefined),
      { policy: policy(true), standingPolicyAuthority: standingPolicy },
    );
    await expect(
      resolver.resolveSourceAIExecutionIdentity({
        principalId: 'stage4-service',
        projectId,
        requestId: 'stage4-request-1',
        sourceVersionId: '22222222-2222-4222-8222-222222222222',
        sensitivity: 'private',
        accessScope: ['owner'],
        dataClassification: 'source-content',
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
  });

  it('rejects a durable retry when the Project configuration or provider policy fingerprint changed', async () => {
    const initial = await resolve({});
    await expect(
      resolve({
        existingIdentity: {
          ...initial.executionIdentity,
          credentialRevision: initial.executionIdentity.credentialRevision + 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
    await expect(
      resolve({
        existingIdentity: {
          ...initial.executionIdentity,
          providerPolicyFingerprint: 'changed-policy-fingerprint',
        },
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });
});
