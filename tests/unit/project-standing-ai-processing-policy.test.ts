import { describe, expect, it } from 'vitest';

import {
  evaluateStandingAIProcessingPolicy,
  evaluateStandingAIProcessingPolicyForEmbedding,
  StandingAIProcessingPolicyService,
  type StandingAIProcessingPolicy,
  type StandingAIProcessingPolicyRepositoryPort,
} from '../../packages/policy/src/index.js';
import { parseProviderDeploymentCeiling } from '../../modules/provider-privacy-policy/src/index.js';

class InMemoryStandingPolicyRepository implements StandingAIProcessingPolicyRepositoryPort {
  private readonly policies = new Map<string, StandingAIProcessingPolicy>();

  getCurrent(projectId: string): Promise<StandingAIProcessingPolicy | undefined> {
    return Promise.resolve(this.policies.get(projectId));
  }

  saveRevision(input: {
    readonly expectedRevision: number;
    readonly next: StandingAIProcessingPolicy;
  }): Promise<'CREATED' | 'UPDATED' | 'CONFLICT'> {
    const current = this.policies.get(input.next.projectId);
    const currentRevision = current?.policyRevision ?? 0;
    if (currentRevision !== input.expectedRevision) return Promise.resolve('CONFLICT');
    this.policies.set(input.next.projectId, input.next);
    return Promise.resolve(current ? 'UPDATED' : 'CREATED');
  }
}

const policy = (
  overrides: Partial<StandingAIProcessingPolicy> = {},
): StandingAIProcessingPolicy => ({
  projectId: 'project-a',
  enabled: true,
  providerId: 'deepseek',
  policyRevision: 1,
  aiConfigurationRevision: 4,
  changedBy: 'owner-a',
  changedAt: '2026-09-02T00:00:00.000Z',
  ...overrides,
});

describe('Project Standing AI Processing Policy', () => {
  it('blocks private context when OFF and allows it when ON for the bound provider', () => {
    expect(
      evaluateStandingAIProcessingPolicy({
        policy: policy({ enabled: false }),
        providerId: 'deepseek',
        sensitivity: 'private',
        deploymentAllowsPrivate: true,
      }),
    ).toEqual({ eligible: false, reason: 'STANDING_POLICY_DISABLED' });
    expect(
      evaluateStandingAIProcessingPolicy({
        policy: policy(),
        providerId: 'deepseek',
        sensitivity: 'private',
        deploymentAllowsPrivate: true,
      }),
    ).toEqual({ eligible: true, reason: 'ELIGIBLE' });
  });

  it('keeps public/internal automatic, blocks restricted, and preserves deployment hard deny', () => {
    for (const sensitivity of ['public', 'internal'] as const) {
      expect(
        evaluateStandingAIProcessingPolicy({
          policy: policy(),
          providerId: 'deepseek',
          sensitivity,
          deploymentAllowsPrivate: false,
        }),
      ).toEqual({ eligible: true, reason: 'ELIGIBLE' });
    }
    expect(
      evaluateStandingAIProcessingPolicy({
        policy: policy(),
        providerId: 'deepseek',
        sensitivity: 'restricted',
        deploymentAllowsPrivate: true,
      }),
    ).toEqual({ eligible: false, reason: 'RESTRICTED_CONTEXT_BLOCKED' });
    expect(
      evaluateStandingAIProcessingPolicy({
        policy: policy(),
        providerId: 'deepseek',
        sensitivity: 'private',
        deploymentAllowsPrivate: false,
      }),
    ).toEqual({ eligible: false, reason: 'DEPLOYMENT_POLICY_BLOCKED' });
  });

  it('EMB-POL-1/3/4/5 keeps embedding provider identity independent of generative policy', () => {
    expect(
      evaluateStandingAIProcessingPolicyForEmbedding({
        policy: policy({ providerId: 'deepseek' }),
        sensitivity: 'internal',
        deploymentAllowsPrivate: false,
      }),
    ).toEqual({ eligible: true, reason: 'ELIGIBLE' });

    expect(
      evaluateStandingAIProcessingPolicyForEmbedding({
        policy: policy({ providerId: 'deepseek' }),
        sensitivity: 'private',
        deploymentAllowsPrivate: true,
      }),
    ).toEqual({ eligible: true, reason: 'ELIGIBLE' });

    expect(
      evaluateStandingAIProcessingPolicyForEmbedding({
        policy: policy({ providerId: 'deepseek' }),
        sensitivity: 'restricted',
        deploymentAllowsPrivate: true,
      }),
    ).toEqual({ eligible: false, reason: 'RESTRICTED_CONTEXT_BLOCKED' });

    expect(
      evaluateStandingAIProcessingPolicyForEmbedding({
        policy: policy({ providerId: 'deepseek', enabled: false }),
        sensitivity: 'internal',
        deploymentAllowsPrivate: true,
      }),
    ).toEqual({ eligible: false, reason: 'STANDING_POLICY_DISABLED' });
  });

  it('EMB-POL-2 preserves the private deployment ceiling for an independently pinned provider', () => {
    expect(
      evaluateStandingAIProcessingPolicyForEmbedding({
        policy: policy({ providerId: 'deepseek' }),
        sensitivity: 'private',
        deploymentAllowsPrivate: false,
      }),
    ).toEqual({ eligible: false, reason: 'DEPLOYMENT_POLICY_BLOCKED' });
  });

  it('EMB-POL-6 keeps generative provider mismatch fail-closed', () => {
    expect(
      evaluateStandingAIProcessingPolicy({
        policy: policy({ providerId: 'deepseek' }),
        providerId: 'openai',
        sensitivity: 'internal',
        deploymentAllowsPrivate: true,
      }),
    ).toEqual({ eligible: false, reason: 'STANDING_POLICY_PROVIDER_MISMATCH' });
  });

  it('keeps the legacy compatibility path explicit when the standing policy is absent', () => {
    expect(
      evaluateStandingAIProcessingPolicyForEmbedding({
        policy: undefined,
        sensitivity: 'internal',
        deploymentAllowsPrivate: true,
      }),
    ).toEqual({ eligible: false, reason: 'NOT_CONFIGURED' });
  });

  it('ignores only the standing provider mismatch for historical recovery', () => {
    expect(
      evaluateStandingAIProcessingPolicy({
        policy: policy({ providerId: 'deepseek' }),
        providerId: 'openai',
        sensitivity: 'internal',
        deploymentAllowsPrivate: true,
        ignoreStandingProviderMismatch: true,
      }),
    ).toEqual({ eligible: true, reason: 'ELIGIBLE' });
    expect(
      evaluateStandingAIProcessingPolicy({
        policy: policy({ providerId: 'deepseek' }),
        providerId: 'openai',
        sensitivity: 'private',
        deploymentAllowsPrivate: false,
        ignoreStandingProviderMismatch: true,
      }),
    ).toEqual({ eligible: false, reason: 'DEPLOYMENT_POLICY_BLOCKED' });
    expect(
      evaluateStandingAIProcessingPolicy({
        policy: policy({ providerId: 'deepseek', enabled: false }),
        providerId: 'openai',
        sensitivity: 'internal',
        deploymentAllowsPrivate: true,
        ignoreStandingProviderMismatch: true,
      }),
    ).toEqual({ eligible: false, reason: 'STANDING_POLICY_DISABLED' });
    expect(
      evaluateStandingAIProcessingPolicy({
        policy: policy({ providerId: 'deepseek' }),
        providerId: 'openai',
        sensitivity: 'restricted',
        deploymentAllowsPrivate: true,
        ignoreStandingProviderMismatch: true,
      }),
    ).toEqual({ eligible: false, reason: 'RESTRICTED_CONTEXT_BLOCKED' });
  });

  it('uses all registered providers only for the explicit local-owner default', () => {
    const local = parseProviderDeploymentCeiling({ localOwnerDefault: true });
    expect(local.configured).toBe(false);
    expect(local.allows('deepseek')).toBe(true);
    expect(local.allows('openai')).toBe(true);
    expect(local.allows('google-gemini')).toBe(true);

    const managed = parseProviderDeploymentCeiling({
      localOwnerDefault: false,
      providerAllowlist: '',
    });
    expect(managed.configured).toBe(true);
    expect(managed.allows('deepseek')).toBe(false);
  });

  it('does not inherit authority across providers or Projects, and revocation is immediate', async () => {
    const repository = new InMemoryStandingPolicyRepository();
    const service = new StandingAIProcessingPolicyService(repository);
    await service.save({
      projectId: 'project-a',
      expectedRevision: 0,
      enabled: true,
      providerId: 'deepseek',
      aiConfigurationRevision: 4,
      changedBy: 'owner-a',
      now: '2026-09-02T00:00:00.000Z',
    });
    const current = await service.getCurrent('project-a');
    expect(
      evaluateStandingAIProcessingPolicy({
        policy: current,
        providerId: 'openai',
        sensitivity: 'private',
        deploymentAllowsPrivate: true,
      }),
    ).toEqual({ eligible: false, reason: 'STANDING_POLICY_PROVIDER_MISMATCH' });
    expect(await service.getCurrent('project-b')).toBeUndefined();
    await service.save({
      projectId: 'project-a',
      expectedRevision: 1,
      enabled: false,
      providerId: 'deepseek',
      aiConfigurationRevision: 4,
      changedBy: 'owner-a',
      now: '2026-09-02T00:01:00.000Z',
    });
    expect(
      evaluateStandingAIProcessingPolicy({
        policy: await service.getCurrent('project-a'),
        providerId: 'deepseek',
        sensitivity: 'private',
        deploymentAllowsPrivate: true,
      }),
    ).toEqual({ eligible: false, reason: 'STANDING_POLICY_DISABLED' });
  });
});
