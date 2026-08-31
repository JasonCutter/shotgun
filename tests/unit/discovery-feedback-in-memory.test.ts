import { InMemoryDiscoveryFeedbackRepository } from '../../adapters/discovery-feedback-in-memory/src/index.js';
import type {
  DiscoveryFeedbackEventV1,
  DiscoveryRankingPolicyRevisionV1,
  DiscoverySuppressionDirectiveV1,
} from '../../packages/contracts/src/index.js';
import { describe, expect, it } from 'vitest';

const actor = { type: 'user' as const, id: 'principal-1' };

const event = (overrides: Partial<DiscoveryFeedbackEventV1> = {}): DiscoveryFeedbackEventV1 => ({
  schemaVersion: '1.0.0',
  feedbackId: 'feedback-1',
  projectId: 'project-a',
  findingId: 'finding-1',
  findingRevision: 2,
  actor,
  principalId: 'principal-1',
  feedbackClass: 'UTILITY',
  feedbackKind: 'USEFUL',
  createdAt: '2026-08-31T00:00:00.000Z',
  ...overrides,
});

const suppression = (
  overrides: Partial<DiscoverySuppressionDirectiveV1> = {},
): DiscoverySuppressionDirectiveV1 => ({
  schemaVersion: '1.0.0',
  suppressionId: 'suppression-1',
  projectId: 'project-a',
  actor,
  principalId: 'principal-1',
  sourceFindingId: 'finding-1',
  sourceFindingRevision: 2,
  suppressionKind: 'SUPPRESS_EXACT',
  scope: 'FINDING',
  matcherKind: 'EXACT_FINGERPRINT',
  matcherVersion: 'discovery-fingerprint:v1',
  fingerprint: 'sha256:finding-1',
  fingerprintVersion: 'discovery-fingerprint:v1',
  createdAt: '2026-08-31T00:00:00.000Z',
  ...overrides,
});

const policy = (revision: number, effectiveFrom: string): DiscoveryRankingPolicyRevisionV1 => ({
  schemaVersion: '1.0.0',
  policyId: 'discovery-ranking-policy',
  policyRevision: revision,
  scope: 'GLOBAL',
  algorithmVersion: 'discovery-ranking-policy:v1',
  rules: ['benefits-minus-penalties', 'finding-id-tiebreak'],
  weights: {
    novelty: 1,
    projectRelevance: 0.8,
    evidenceCoverage: 0.7,
    impactReach: 0.6,
    temporalUrgency: 0.5,
    redundancyPenalty: 0.4,
    costRiskPenalty: 0.3,
  },
  createdBy: { type: 'system', id: 'ranking-policy-owner' },
  createdAt: effectiveFrom,
  effectiveFrom,
});

describe('InMemoryDiscoveryFeedbackRepository', () => {
  it('is append-only and keeps Finding revision and project isolation', async () => {
    const repository = new InMemoryDiscoveryFeedbackRepository();
    expect(await repository.appendFeedback(event())).toBe('CREATED');
    expect(await repository.appendFeedback(event({ reason: 'attempted overwrite' }))).toBe(
      'CONFLICT',
    );
    expect(
      await repository.listFeedbackForFinding({
        projectId: 'project-a',
        findingId: 'finding-1',
        findingRevision: 2,
      }),
    ).toEqual([event()]);
    expect(
      await repository.listFeedbackForFinding({
        projectId: 'project-b',
        findingId: 'finding-1',
        findingRevision: 2,
      }),
    ).toEqual([]);
  });

  it('requires explicit exact/similar matching and expires snoozes without deleting history', async () => {
    const repository = new InMemoryDiscoveryFeedbackRepository();
    await repository.appendSuppression(suppression());
    await repository.appendSuppression(
      suppression({
        suppressionId: 'suppression-similar',
        suppressionKind: 'SUPPRESS_SIMILAR',
        matcherKind: 'SEMANTIC_FAMILY',
        matcherVersion: 'semantic-family:v1',
        fingerprint: undefined,
        fingerprintVersion: undefined,
        scope: 'PROJECT',
      }),
    );
    await repository.appendSuppression(
      suppression({
        suppressionId: 'suppression-snooze',
        suppressionKind: 'SNOOZE',
        scope: 'FINDING',
        matcherKind: 'NONE',
        matcherVersion: undefined,
        fingerprint: undefined,
        fingerprintVersion: undefined,
        expiresAt: '2026-09-01T00:00:00.000Z',
      }),
    );

    const lookup = {
      projectId: 'project-a',
      principalId: 'principal-1',
      findingId: 'finding-1',
      findingRevision: 2,
      fingerprint: 'sha256:finding-1',
      fingerprintVersion: 'discovery-fingerprint:v1',
      at: '2026-08-31T12:00:00.000Z',
    };
    const exactAndSnooze = await repository.listRelevantSuppression(lookup);
    expect(exactAndSnooze.map((entry) => entry.suppressionId)).toEqual([
      'suppression-1',
      'suppression-snooze',
    ]);
    const similar = await repository.listRelevantSuppression({
      ...lookup,
      fingerprint: undefined,
      fingerprintVersion: undefined,
      semanticMatcherVersion: 'semantic-family:v1',
    });
    expect(similar.map((entry) => entry.suppressionId)).toEqual([
      'suppression-similar',
      'suppression-snooze',
    ]);
    expect(
      await repository.listRelevantSuppression({
        ...lookup,
        at: '2026-09-02T00:00:00.000Z',
      }),
    ).toEqual([{ ...suppression(), suppressionId: 'suppression-1' }]);
    expect(
      await repository.appendSuppression(
        suppression({
          suppressionId: 'suppression-snooze',
          suppressionKind: 'SNOOZE',
          scope: 'FINDING',
          matcherKind: 'NONE',
          matcherVersion: undefined,
          fingerprint: undefined,
          fingerprintVersion: undefined,
          expiresAt: '2026-09-01T00:00:00.000Z',
        }),
      ),
    ).toBe('CONFLICT');
  });

  it('keeps immutable ranking history and resolves the effective global revision by time', async () => {
    const repository = new InMemoryDiscoveryFeedbackRepository(() => '2026-08-31T12:00:00.000Z');
    await repository.insertRankingPolicyRevision(policy(1, '2026-08-31T00:00:00.000Z'));
    await repository.insertRankingPolicyRevision(policy(2, '2999-01-01T00:00:00.000Z'));
    expect(
      await repository.insertRankingPolicyRevision(policy(2, '2999-01-01T00:00:00.000Z')),
    ).toBe('CONFLICT');
    expect(
      (
        await repository.resolveEffectiveRankingPolicy({
          projectId: 'project-a',
          policyId: 'discovery-ranking-policy',
        })
      )?.policyRevision,
    ).toBe(1);
    expect(
      (
        await repository.resolveEffectiveRankingPolicy({
          projectId: 'project-a',
          policyId: 'discovery-ranking-policy',
          at: '2999-01-02T00:00:00.000Z',
        })
      )?.policyRevision,
    ).toBe(2);
    expect(
      (
        await repository.resolveEffectiveRankingPolicy({
          projectId: 'project-a',
          policyId: 'discovery-ranking-policy',
          at: '2026-08-31T12:00:00.000Z',
        })
      )?.policyRevision,
    ).toBe(1);
    expect(
      (
        await repository.listRankingPolicyRevisions({
          projectId: 'project-a',
          policyId: 'discovery-ranking-policy',
          at: '2999-01-02T00:00:00.000Z',
        })
      ).map((entry) => entry.policyRevision),
    ).toEqual([2, 1]);
  });
});
