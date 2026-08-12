import { describe, expect, it } from 'vitest';

import {
  A4_PROVIDER_PRIVACY_POLICY_REVISION,
  ProviderExternalTransferApprovalService,
  evaluateProviderExternalTransfer,
  parseProviderDeploymentCeiling,
  type ProviderExternalTransferApproval,
  type ProviderExternalTransferApprovalProposal,
  type ProviderExternalTransferApprovalRepositoryPort,
} from '../../modules/provider-privacy-policy/src/index.js';
import { initialProviderRegistry } from '../../modules/ai-configuration/src/index.js';
import {
  AskProviderPolicyResolver,
  type AskProviderPolicyAuthorityReaderPort,
} from '../../modules/frontend-ask-provider-policy/src/index.js';

class InMemoryApprovalRepository implements ProviderExternalTransferApprovalRepositoryPort {
  readonly approvals = new Map<string, ProviderExternalTransferApproval>();
  readonly history = new Map<string, ProviderExternalTransferApproval[]>();
  readonly proposals = new Map<string, ProviderExternalTransferApprovalProposal>();

  async getCurrent(input: {
    projectId: string;
    providerId: 'deepseek' | 'openai' | 'google-gemini';
  }) {
    return this.approvals.get(`${input.projectId}:${input.providerId}`);
  }

  async listHistory(input: {
    projectId: string;
    providerId: 'deepseek' | 'openai' | 'google-gemini';
  }) {
    return this.history.get(`${input.projectId}:${input.providerId}`) ?? [];
  }

  async createProposal(input: {
    projectId: string;
    providerId: 'deepseek' | 'openai' | 'google-gemini';
    approved: boolean;
    expectedApprovalRevision: number;
    proposedBy: string;
  }) {
    const proposal = {
      proposalId: `proposal-${this.proposals.size + 1}`,
      ...input,
      status: 'PROPOSED' as const,
      createdAt: '2026-08-12T00:00:00.000Z',
    };
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  async approveProposal(input: {
    proposalId: string;
    projectId: string;
    providerId: 'deepseek' | 'openai' | 'google-gemini';
    reviewedBy: string;
    expectedApprovalRevision: number;
  }) {
    const proposal = this.proposals.get(input.proposalId);
    if (!proposal || proposal.status !== 'PROPOSED') throw new Error('stale proposal');
    const approval: ProviderExternalTransferApproval = {
      projectId: input.projectId,
      providerId: input.providerId,
      approved: proposal.approved,
      approvalRevision: input.expectedApprovalRevision + 1,
      reviewedBy: input.reviewedBy,
      reviewedAt: '2026-08-12T00:01:00.000Z',
    };
    const key = `${input.projectId}:${input.providerId}`;
    this.approvals.set(key, approval);
    this.history.set(key, [...(this.history.get(key) ?? []), approval]);
    this.proposals.set(input.proposalId, { ...proposal, status: 'APPROVED' });
    return approval;
  }

  async isProjectOwner(input: { projectId: string; principalId: string }) {
    return input.projectId === 'project-a' && input.principalId === 'owner-a';
  }
}

describe('A4 provider-specific privacy and deployment authority', () => {
  it('uses a provider-scoped default-deny deployment ceiling and ignores arbitrary IDs', () => {
    expect(A4_PROVIDER_PRIVACY_POLICY_REVISION).toBe('provider-external-transfer-policy:v1');
    const ceiling = parseProviderDeploymentCeiling({
      providerAllowlist: 'openai, arbitrary-provider, deepseek',
      legacyGeminiAllowed: true,
    });
    expect(ceiling.allows('openai')).toBe(true);
    expect(ceiling.allows('deepseek')).toBe(true);
    expect(ceiling.allows('google-gemini')).toBe(false);
    expect(ceiling.allows('arbitrary-provider')).toBe(false);
    expect(parseProviderDeploymentCeiling({}).allows('google-gemini')).toBe(false);
    expect(
      parseProviderDeploymentCeiling({ legacyGeminiAllowed: true }).allows('google-gemini'),
    ).toBe(true);
  });

  it('requires both provider deployment and matching Project/provider approval', () => {
    const deployment = parseProviderDeploymentCeiling({ providerAllowlist: 'openai' });
    const approval: ProviderExternalTransferApproval = {
      projectId: 'project-a',
      providerId: 'openai',
      approved: true,
      approvalRevision: 1,
      reviewedBy: 'owner-a',
      reviewedAt: '2026-08-12T00:00:00.000Z',
    };
    const approved = {
      projectId: 'project-a',
      providerId: 'openai' as const,
      approved: true,
      approvalRevision: 1,
      reviewedBy: 'owner-a',
      reviewedAt: '2026-08-12T00:00:00.000Z',
    };
    expect(
      evaluateProviderExternalTransfer({
        providerId: 'openai',
        sensitivity: 'private',
        deployment,
        legacyExternalTransferAllowed: true,
        approval,
      }),
    ).toMatchObject({ eligible: true, reason: 'ELIGIBLE' });
    expect(
      evaluateProviderExternalTransfer({
        providerId: 'deepseek',
        sensitivity: 'private',
        deployment,
        legacyExternalTransferAllowed: true,
        approval: { ...approved, providerId: 'deepseek' },
      }),
    ).toMatchObject({ eligible: false, reason: 'DEPLOYMENT_POLICY_BLOCKED' });
    expect(
      evaluateProviderExternalTransfer({
        providerId: 'openai',
        sensitivity: 'private',
        deployment,
        legacyExternalTransferAllowed: true,
      }),
    ).toMatchObject({ eligible: false, reason: 'PROJECT_APPROVAL_REQUIRED' });
  });

  it('preserves Gemini compatibility only when no Gemini authority exists', () => {
    const deployment = parseProviderDeploymentCeiling({ providerAllowlist: 'google-gemini' });
    expect(
      evaluateProviderExternalTransfer({
        providerId: 'google-gemini',
        sensitivity: 'private',
        deployment,
        legacyExternalTransferAllowed: true,
      }),
    ).toMatchObject({ eligible: true, usedLegacyGeminiCompatibility: true });
    expect(
      evaluateProviderExternalTransfer({
        providerId: 'google-gemini',
        sensitivity: 'private',
        deployment,
        legacyExternalTransferAllowed: true,
        approval: {
          projectId: 'project-a',
          providerId: 'google-gemini',
          approved: false,
          approvalRevision: 1,
          reviewedBy: 'owner-a',
          reviewedAt: '2026-08-12T00:00:00.000Z',
        },
      }),
    ).toMatchObject({ eligible: false, reason: 'PROJECT_APPROVAL_REQUIRED' });
    expect(
      evaluateProviderExternalTransfer({
        providerId: 'openai',
        sensitivity: 'private',
        deployment,
        legacyExternalTransferAllowed: true,
      }),
    ).toMatchObject({ eligible: false, reason: 'DEPLOYMENT_POLICY_BLOCKED' });
  });

  it('hard-denies restricted context regardless of deployment and approval', () => {
    expect(
      evaluateProviderExternalTransfer({
        providerId: 'openai',
        sensitivity: 'restricted',
        deployment: parseProviderDeploymentCeiling({ providerAllowlist: 'openai' }),
        legacyExternalTransferAllowed: true,
        approval: {
          projectId: 'project-a',
          providerId: 'openai',
          approved: true,
          approvalRevision: 1,
          reviewedBy: 'owner-a',
          reviewedAt: '2026-08-12T00:00:00.000Z',
        },
      }),
    ).toMatchObject({ eligible: false, reason: 'RESTRICTED_CONTEXT_BLOCKED' });
  });

  it('keeps the existing Ask authorization boundary while applying provider-specific authority', async () => {
    const reader: AskProviderPolicyAuthorityReaderPort = {
      readProjectPrivacyPolicy: async () => ({
        externalTransferAllowed: true,
        settingsRevision: 4,
        policyContextRevision: 4,
      }),
      readProviderExternalTransferApproval: async ({ providerId }) =>
        providerId === 'google-gemini'
          ? {
              providerId,
              approved: false,
              approvalRevision: 1,
            }
          : undefined,
      readSelectedSensitivities: async () => [],
    };
    const resolve = (providerId: string) =>
      new AskProviderPolicyResolver(reader, {
        providerId,
        deploymentPrivateTransferAllowed: true,
        providerPolicyIdentity: `${providerId}-policy`,
        providerDisplayName: providerId,
        providerModel: 'test-model',
      });
    await expect(
      resolve('openai').evaluateContext({ projectId: 'project-a', sensitivities: ['private'] }),
    ).resolves.toMatchObject({ reason: 'PROJECT_APPROVAL_REQUIRED' });
    await expect(
      resolve('google-gemini').evaluateContext({
        projectId: 'project-a',
        sensitivities: ['private'],
      }),
    ).resolves.toMatchObject({ reason: 'PROJECT_APPROVAL_REQUIRED' });
  });

  it('requires owner review then separate approval and preserves provider/project history', async () => {
    const repository = new InMemoryApprovalRepository();
    const service = new ProviderExternalTransferApprovalService(
      repository,
      initialProviderRegistry(),
    );
    const proposal = await service.propose({
      projectId: 'project-a',
      providerId: 'openai',
      approved: true,
      expectedApprovalRevision: 0,
      proposedBy: 'owner-a',
    });
    expect(proposal.status).toBe('PROPOSED');
    await expect(
      service.propose({
        projectId: 'project-a',
        providerId: 'arbitrary-provider',
        approved: true,
        expectedApprovalRevision: 0,
        proposedBy: 'owner-a',
      }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_PROVIDER' });
    await expect(
      service.approve({
        ...proposal,
        reviewedBy: 'not-owner',
        proposalId: proposal.proposalId,
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_OWNER_REQUIRED' });
    const approval = await service.approve({
      proposalId: proposal.proposalId,
      projectId: 'project-a',
      providerId: 'openai',
      expectedApprovalRevision: 0,
      reviewedBy: 'owner-a',
    });
    expect(approval).toMatchObject({ providerId: 'openai', approved: true, approvalRevision: 1 });
    expect(await service.listHistory('project-a', 'openai')).toHaveLength(1);
    expect(await service.getCurrent('project-a', 'deepseek')).toBeUndefined();
  });
});
