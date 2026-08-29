import { describe, expect, it, vi } from 'vitest';

import {
  EffectiveAIConfigurationResolver,
  DiscoveryAIExecutionResolver,
} from '../../adapters/ai-runtime-resolution/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';
import type { ProjectAIConfigurationPort } from '../../modules/ai-configuration/src/index.js';
import type { CredentialVaultPort } from '../../modules/credential-vault/src/index.js';
import type {
  AskProviderPolicyResolverPort,
  DiscoveryModelProfileV1,
} from '../../packages/contracts/src/index.js';

const profile: DiscoveryModelProfileV1 = {
  schemaVersion: '1.0.0',
  profileId: 'discovery-profile-1',
  projectId: 'project-1',
  profileRevision: 3,
  aiConfigurationRevision: 7,
  providerId: 'openai',
  modelId: 'gpt-5.6-luna',
  providerRegistryRevision: 'provider-registry:v1',
  modelCapabilityRevision: 'model-catalog:v1',
  promptVersion: 'discovery-ai-prompt:v1',
  outputSchemaVersion: 'discovery-ai-output:v1',
  status: 'ACTIVE',
  createdBy: 'owner-1',
  createdAt: '2026-08-30T00:00:00.000Z',
};

const configuration = {
  projectId: 'project-1',
  activeProviderId: 'openai',
  activeModelId: 'gpt-5.6-luna',
  credentialId: 'credential-7',
  credentialRevision: 4,
  aiConfigurationRevision: 7,
  updatedBy: 'owner-1',
  updatedAt: '2026-08-30T00:00:00.000Z',
};

const makeAuthority = (input: {
  readonly metadataState?: 'active' | 'revoked';
  readonly eligible?: boolean;
}) => {
  const policy: AskProviderPolicyResolverPort = {
    evaluateSelections: vi.fn(),
    evaluateContext: vi.fn(async () => ({
      schemaVersion: '1.0.0' as const,
      eligible: input.eligible ?? true,
      reason:
        input.eligible === false ? ('RESTRICTED_CONTEXT_BLOCKED' as const) : ('ELIGIBLE' as const),
      requiredAction:
        input.eligible === false ? ('REMOVE_RESTRICTED_CONTEXT' as const) : ('NONE' as const),
      policyFingerprint: 'policy-discovery-7',
      policyContextRevision: 'privacy-policy-5',
      provider: { displayName: 'OpenAI', model: 'GPT-5.6 Luna' },
      message: 'test',
    })),
  };
  const configurationReader = {
    getRevision: vi.fn(async () => configuration),
  } as unknown as ProjectAIConfigurationPort;
  const vault = {
    getMetadata: vi.fn(async () => ({
      credentialId: configuration.credentialId,
      projectId: configuration.projectId,
      providerId: configuration.activeProviderId,
      credentialRevision: configuration.credentialRevision,
      lifecycleState: input.metadataState ?? 'active',
    })),
  } as unknown as CredentialVaultPort;
  return {
    policy,
    vault,
    resolver: new EffectiveAIConfigurationResolver(
      initialProviderRegistry(),
      configurationReader,
      vault,
      { policy },
    ),
  };
};

describe('AKP-3 WP3 ADR-133 Discovery execution resolution', () => {
  it('pins the active profile, exact configuration, credential, capability and policy revisions', async () => {
    const { resolver } = makeAuthority({});
    const result = await new DiscoveryAIExecutionResolver(resolver).resolve({
      projectId: 'project-1',
      profile,
      sensitivity: 'private',
    });

    expect(result).toEqual({
      pin: {
        projectId: 'project-1',
        profileId: 'discovery-profile-1',
        profileRevision: 3,
        providerId: 'openai',
        modelId: 'gpt-5.6-luna',
        modelCapabilityRevision: 'model-catalog:v1',
        aiConfigurationRevision: 7,
        credentialId: 'credential-7',
        credentialRevision: 4,
        providerPolicyFingerprint: 'policy-discovery-7',
        privacyPolicyRevision: 'privacy-policy-5',
        dataPolicyRevision: 'v1',
        promptVersion: 'discovery-ai-prompt:v1',
        outputSchemaVersion: 'discovery-ai-output:v1',
      },
      modelVersion: 'catalog:gpt-5.6-luna@model-catalog:v1',
    });
  });

  it('fails closed for stale capability, revoked credential, restricted policy, or inactive profile', async () => {
    const authority = makeAuthority({});
    await expect(
      authority.resolver.resolveDiscoveryAIExecution({
        projectId: 'project-1',
        profile: { ...profile, modelCapabilityRevision: 'stale-capability' },
        sensitivity: 'internal',
      }),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });

    const revoked = makeAuthority({ metadataState: 'revoked' });
    await expect(
      revoked.resolver.resolveDiscoveryAIExecution({
        projectId: 'project-1',
        profile,
        sensitivity: 'internal',
      }),
    ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });

    const restricted = makeAuthority({ eligible: false });
    await expect(
      restricted.resolver.resolveDiscoveryAIExecution({
        projectId: 'project-1',
        profile,
        sensitivity: 'restricted',
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });

    await expect(
      authority.resolver.resolveDiscoveryAIExecution({
        projectId: 'project-1',
        profile: { ...profile, status: 'RETIRED' },
        sensitivity: 'internal',
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
  });
});
