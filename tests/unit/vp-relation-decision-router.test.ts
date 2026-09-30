import { describe, expect, it, vi } from 'vitest';

import {
  VPRelationDecisionRouter,
  VPDecisionOutcomeUnknownError,
  type VPDecisionProviderPort,
  type VPRelationDecision,
  type VPRelationDecisionRequest,
} from '../../modules/vp-decision/src/index.js';

const input: VPRelationDecisionRequest = {
  projectId: 'project-a',
  left: {
    assertionId: 'left',
    sourceVersionId: 'version-left',
    evidenceId: 'evidence-left',
    text: 'The limit is 100 units.',
    accessScope: ['owner'],
    sensitivity: 'internal',
  },
  right: {
    assertionId: 'right',
    sourceVersionId: 'version-right',
    evidenceId: 'evidence-right',
    text: 'The limit is 100 units for domestic orders.',
    accessScope: ['owner'],
    sensitivity: 'internal',
  },
  allowedAccessScope: ['owner'],
  authorizedSensitivities: ['internal'],
  externalEgressAllowed: true,
  policyRevision: 'gold-calibrated-policy-1',
};

const decision: VPRelationDecision = {
  choice: 'QUALIFIES',
  direction: 'RIGHT_TO_LEFT',
  confidence: 0.8,
  probabilities: {
    EQUIVALENT: 0.02,
    SUPPORTS: 0,
    QUALIFIES: 0.8,
    CONTRADICTS: 0.01,
    RELATED: 0.12,
    UNRESOLVED: 0.05,
  },
  deepAnalysisScore: 0.8,
  model: 'jev-1.13.0',
  inputTokens: 100,
  outputTokens: 20,
};

const policy = {
  revision: 'gold-calibrated-policy-1',
  minimumChoiceProbability: 0.75,
  maximumDeepAnalysisScore: 0.2,
  maximumInputTokens: 1000,
  maximumOutputTokens: 200,
};

describe('VP relation decision routing', () => {
  it('escalates a condition-sensitive pair to general AI', async () => {
    const fast: VPDecisionProviderPort = { decideRelation: vi.fn(async () => decision) };
    const deep: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => ({
        ...decision,
        model: 'deep-model',
        deepAnalysisScore: 0,
      })),
    };
    const resolved = await new VPRelationDecisionRouter(fast, deep, policy).resolve(input);
    expect(resolved).toMatchObject({
      status: 'DECIDED',
      provider: 'GENERAL_AI',
      decision: { choice: 'QUALIFIES' },
    });
    expect(fast.decideRelation).toHaveBeenCalledOnce();
    expect(deep.decideRelation).toHaveBeenCalledOnce();
  });

  it('does not turn an uncertain or failed provider result into a relation', async () => {
    const fast: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => ({
        ...decision,
        deepAnalysisScore: 0.1,
        inputTokens: 2000,
      })),
    };
    expect(await new VPRelationDecisionRouter(fast, undefined, policy).resolve(input)).toEqual({
      status: 'UNRESOLVED',
      reason: 'INSUFFICIENT_EVIDENCE',
    });
    const failed: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => {
        throw new Error('provider timeout');
      }),
    };
    expect(await new VPRelationDecisionRouter(failed, undefined, policy).resolve(input)).toEqual({
      status: 'UNRESOLVED',
      reason: 'PROVIDER_FAILED',
    });
    const invalidDeep: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => ({
        ...decision,
        probabilities: { ...decision.probabilities, QUALIFIES: Number.NaN },
      })),
    };
    expect(
      await new VPRelationDecisionRouter(undefined, invalidDeep, policy).resolve(input),
    ).toEqual({ status: 'UNRESOLVED', reason: 'INSUFFICIENT_EVIDENCE' });
  });

  it('does not call either provider without egress permission', async () => {
    const provider: VPDecisionProviderPort = { decideRelation: vi.fn(async () => decision) };
    expect(
      await new VPRelationDecisionRouter(provider, provider, policy).resolve({
        ...input,
        externalEgressAllowed: false,
      }),
    ).toEqual({ status: 'UNRESOLVED', reason: 'NO_AUTHORIZED_PROVIDER' });
    expect(provider.decideRelation).not.toHaveBeenCalled();
  });

  it('does not fall back to another provider when the first provider outcome is unknown', async () => {
    const fast: VPDecisionProviderPort = {
      decideRelation: vi.fn(async () => {
        throw new VPDecisionOutcomeUnknownError();
      }),
    };
    const deep: VPDecisionProviderPort = { decideRelation: vi.fn(async () => decision) };

    expect(await new VPRelationDecisionRouter(fast, deep, policy).resolve(input)).toEqual({
      status: 'OUTCOME_UNKNOWN',
    });
    expect(fast.decideRelation).toHaveBeenCalledOnce();
    expect(deep.decideRelation).not.toHaveBeenCalled();
  });
});
