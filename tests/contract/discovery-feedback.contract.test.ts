import {
  createDiscoveryFeedbackEventV1,
  decodeDiscoveryFeedbackEventV1,
  decodeDiscoveryRankingPolicyRevisionV1,
  decodeDiscoverySuppressionDirectiveV1,
  DISCOVERY_EPISTEMIC_FEEDBACK_KINDS,
  DISCOVERY_RANKING_POLICY_VERSION_V1,
  DISCOVERY_UTILITY_FEEDBACK_KINDS,
} from '../../packages/contracts/src/index.js';
import { describe, expect, it } from 'vitest';
import type { DiscoveryFeedbackEventV1 } from '../../packages/contracts/src/index.js';

const actor = { type: 'user' as const, id: 'principal-1' };

const feedback = (
  feedbackClass: 'EPISTEMIC' | 'UTILITY',
  feedbackKind: string,
): Record<string, unknown> => ({
  schemaVersion: '1.0.0',
  feedbackId: `${feedbackClass}-${feedbackKind}`,
  projectId: 'project-a',
  findingId: 'finding-1',
  findingRevision: 3,
  actor,
  principalId: 'principal-1',
  feedbackClass,
  feedbackKind,
  reason: 'explicit test reason',
  scope: 'FINDING',
  createdAt: '2026-08-31T00:00:00.000Z',
});

describe('Discovery feedback contracts', () => {
  it('decodes every frozen epistemic and utility kind', () => {
    for (const kind of DISCOVERY_EPISTEMIC_FEEDBACK_KINDS) {
      expect(decodeDiscoveryFeedbackEventV1(feedback('EPISTEMIC', kind)).feedbackKind).toBe(kind);
    }
    for (const kind of DISCOVERY_UTILITY_FEEDBACK_KINDS) {
      expect(decodeDiscoveryFeedbackEventV1(feedback('UTILITY', kind)).feedbackKind).toBe(kind);
    }
  });

  it('rejects class/kind mismatch and unknown fields', () => {
    expect(() => decodeDiscoveryFeedbackEventV1(feedback('UTILITY', 'WRONG_ENTITY'))).toThrow(
      /incompatible/,
    );
    expect(() =>
      decodeDiscoveryFeedbackEventV1({ ...feedback('UTILITY', 'USEFUL'), extra: true }),
    ).toThrow(/unknown field/);
    expect(() =>
      decodeDiscoveryFeedbackEventV1({
        ...feedback('UTILITY', 'USEFUL'),
        actor: { ...actor, extra: true },
      }),
    ).toThrow(/unknown field/);
  });

  it('keeps exact, similar, and snooze directives schema-distinct', () => {
    const base = {
      schemaVersion: '1.0.0',
      suppressionId: 'suppression-1',
      projectId: 'project-a',
      actor,
      principalId: 'principal-1',
      sourceFindingId: 'finding-1',
      sourceFindingRevision: 3,
      scope: 'PROJECT',
      createdAt: '2026-08-31T00:00:00.000Z',
    } as const;
    const exact = decodeDiscoverySuppressionDirectiveV1({
      ...base,
      suppressionKind: 'SUPPRESS_EXACT',
      matcherKind: 'EXACT_FINGERPRINT',
      matcherVersion: 'discovery-fingerprint:v1',
      fingerprint: 'sha256:abc',
      fingerprintVersion: 'discovery-fingerprint:v1',
    });
    const similar = decodeDiscoverySuppressionDirectiveV1({
      ...base,
      suppressionId: 'suppression-2',
      suppressionKind: 'SUPPRESS_SIMILAR',
      matcherKind: 'SEMANTIC_FAMILY',
      matcherVersion: 'semantic-family:v1',
    });
    const snooze = decodeDiscoverySuppressionDirectiveV1({
      ...base,
      suppressionId: 'suppression-3',
      suppressionKind: 'SNOOZE',
      matcherKind: 'NONE',
      expiresAt: '2026-09-01T00:00:00.000Z',
    });
    expect(exact.matcherKind).toBe('EXACT_FINGERPRINT');
    expect(similar.matcherKind).toBe('SEMANTIC_FAMILY');
    expect(snooze.matcherKind).toBe('NONE');
    expect(() =>
      decodeDiscoverySuppressionDirectiveV1({
        ...base,
        suppressionKind: 'SUPPRESS_SIMILAR',
        matcherKind: 'SEMANTIC_FAMILY',
        matcherVersion: 'semantic-family:v1',
        fingerprint: 'must-not-be-used-for-similar',
      }),
    ).toThrow(/exact fingerprint/);
    expect(() =>
      decodeDiscoverySuppressionDirectiveV1({
        ...base,
        suppressionKind: 'SNOOZE',
        matcherKind: 'NONE',
      }),
    ).toThrow(/expiresAt/);
  });

  it('decodes revisioned global ranking policy without truth/confidence semantics', () => {
    const policy = decodeDiscoveryRankingPolicyRevisionV1({
      schemaVersion: '1.0.0',
      policyId: 'discovery-ranking-policy',
      policyRevision: 2,
      scope: 'GLOBAL',
      algorithmVersion: DISCOVERY_RANKING_POLICY_VERSION_V1,
      rules: ['finding-id-tiebreak', 'benefits-minus-penalties'],
      weights: {
        novelty: 1,
        projectRelevance: 0.8,
        evidenceCoverage: 0.7,
        impactReach: 0.6,
        temporalUrgency: 0.5,
        redundancyPenalty: 0.4,
        costRiskPenalty: 0.3,
      },
      createdBy: actor,
      createdAt: '2026-08-31T00:00:00.000Z',
      effectiveFrom: '2026-08-31T00:00:00.000Z',
    });
    expect(policy.rules).toEqual(['benefits-minus-penalties', 'finding-id-tiebreak']);
    expect(policy.algorithmVersion).toBe(DISCOVERY_RANKING_POLICY_VERSION_V1);
    expect(policy).not.toHaveProperty('truthProbability');
    expect(
      createDiscoveryFeedbackEventV1(feedback('UTILITY', 'USEFUL') as DiscoveryFeedbackEventV1)
        .feedbackClass,
    ).toBe('UTILITY');
  });
});
