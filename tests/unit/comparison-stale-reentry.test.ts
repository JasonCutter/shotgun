import { describe, expect, it } from 'vitest';

import {
  canonicalSnapshotDigest,
  type CanonicalSnapshot,
  type ClaimCandidate,
  type ComparisonResult,
} from '../../packages/contracts/src/index.js';
import { createComparisonModule } from '../../modules/comparison/src/index.js';

const actor = { type: 'user' as const, id: 'owner-1' };
const security = {
  accessScope: ['owner'],
  sensitivity: 'internal' as const,
  dataClassification: 'knowledge',
};

const readyCandidate = (status: ClaimCandidate['status'] = 'READY'): ClaimCandidate => ({
  candidateId: 'candidate-reentry-1',
  batchId: 'batch-1',
  revisionNumber: 1,
  projectId: 'project-1',
  sourceVersionId: 'source-1',
  claimText: 'A candidate that must be compared again.',
  evidenceIds: ['evidence-1'],
  evidenceMode: 'DIRECT_EVIDENCE',
  extractionProfile: 'direct-only',
  status,
  providerCall: {} as ClaimCandidate['providerCall'],
  accessScope: ['owner'],
  sensitivity: 'internal',
  createdAt: '2026-09-07T00:00:00.000Z',
});

const snapshot = (): CanonicalSnapshot => {
  const claims = [
    {
      claimId: 'claim-1',
      text: 'An older canonical claim.',
      revisionNumber: 1,
      evidenceIds: ['evidence-canonical-1'],
    },
  ] as const;
  return {
    snapshotId: 'snapshot-1',
    projectId: 'project-1',
    version: 1,
    digest: canonicalSnapshotDigest('project-1', 1, claims),
    claims,
    createdAt: '2026-09-07T00:00:00.000Z',
  };
};

const envelope = (candidateId = 'candidate-reentry-1') =>
  ({
    messageType: 'RecompareClaimCandidate',
    schemaVersion: '1.0.0',
    correlationId: 'correlation-reentry-1',
    idempotencyKey: 'recompare:client-1',
    createdAt: '2026-09-07T00:00:00.000Z',
    projectId: 'project-1',
    actor,
    security,
    payload: { candidateId },
  }) as never;

const makeModule = (candidate: ClaimCandidate = readyCandidate()) => {
  const saved: ComparisonResult[] = [];
  let snapshotReads = 0;
  let published = 0;
  const module = createComparisonModule(
    {
      save: async (result) => {
        saved.push(result);
        return result;
      },
      findById: async (_projectId, comparisonId) =>
        saved.find((result) => result.comparisonId === comparisonId),
      findByCandidateAndSnapshot: async (_projectId, candidateId, snapshotDigest) =>
        saved.find(
          (result) =>
            result.candidateId === candidateId && result.snapshotDigest === snapshotDigest,
        ),
    },
    {
      getSnapshot: async () => {
        snapshotReads += 1;
        return snapshot();
      },
    },
    { identity: { id: 'text-diff', version: '1' }, diff: () => [] },
  );
  const queryContext = {
    query: async () => ({ payload: candidate }),
    publish: async () => {
      published += 1;
    },
  } as never;
  return {
    module,
    saved,
    queryContext,
    get snapshotReads() {
      return snapshotReads;
    },
    get published() {
      return published;
    },
  };
};

describe('Stage 5 stale comparison re-entry', () => {
  it('reuses the same candidate+snapshot Comparison identity and emits the normal handoff', async () => {
    const fixture = makeModule();
    const handler = fixture.module.handlers.commands[0]!.handle;

    const first = await handler(envelope(), fixture.queryContext);
    const second = await handler(envelope(), fixture.queryContext);

    expect(first).toMatchObject({
      candidateId: 'candidate-reentry-1',
      rollout: 'V1_ONLY',
      v1Executed: true,
      snapshotVersion: 1,
    });
    expect(second).toMatchObject({
      comparisonId: (first as { comparisonId: string }).comparisonId,
    });
    expect(fixture.saved).toHaveLength(1);
    expect(fixture.published).toBe(2);
    expect(fixture.snapshotReads).toBe(2);
  });

  it('rejects non-READY candidates before reading Canonical or writing a Comparison', async () => {
    const fixture = makeModule(readyCandidate('REJECTED'));
    const handler = fixture.module.handlers.commands[0]!.handle;

    await expect(handler(envelope(), fixture.queryContext)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(fixture.saved).toHaveLength(0);
    expect(fixture.snapshotReads).toBe(0);
  });

  it('does not invoke the v1 path when the server-owned rollout is V2_ACTIVE', async () => {
    const fixture = makeModule();
    const activeModule = createComparisonModule(
      {
        save: async (result) => {
          fixture.saved.push(result);
          return result;
        },
        findById: async () => undefined,
        findByCandidateAndSnapshot: async () => undefined,
      },
      {
        getSnapshot: async () => {
          throw new Error('V1 snapshot read must not run in V2_ACTIVE');
        },
      },
      { identity: { id: 'text-diff', version: '1' }, diff: () => [] },
      {
        handleCandidateValidated: async () => ({
          rollout: 'V2_ACTIVE' as const,
          v2Outcome: { status: 'BLOCKED' as const, reason: 'SEMANTIC_UNAVAILABLE' },
          review: { status: 'BLOCKED' as const, reason: 'SEMANTIC_UNAVAILABLE' },
        }),
      },
    );

    const result = await activeModule.handlers.commands[0]!.handle(
      envelope(),
      fixture.queryContext,
    );
    expect(result).toMatchObject({ rollout: 'V2_ACTIVE', v1Executed: false });
    expect(result).toMatchObject({
      v2: { status: 'BLOCKED', reason: 'SEMANTIC_UNAVAILABLE' },
      review: { status: 'BLOCKED', reason: 'SEMANTIC_UNAVAILABLE' },
    });
    expect(result).not.toHaveProperty('comparisonId');
    expect(fixture.saved).toHaveLength(0);
  });

  it('propagates safe shortlist detail without exposing internal payloads', async () => {
    const fixture = makeModule();
    const activeModule = createComparisonModule(
      {
        save: async (result) => {
          fixture.saved.push(result);
          return result;
        },
        findById: async () => undefined,
        findByCandidateAndSnapshot: async () => undefined,
      },
      {
        getSnapshot: async () => {
          throw new Error('V1 snapshot read must not run in V2_ACTIVE');
        },
      },
      { identity: { id: 'text-diff', version: '1' }, diff: () => [] },
      {
        handleCandidateValidated: async () => ({
          rollout: 'V2_ACTIVE' as const,
          v2Outcome: {
            status: 'BLOCKED' as const,
            reason: 'SHORTLIST_BLOCKED',
            detail: 'SEMANTIC_DEGRADED:{"lexicalStatus":"READY","semanticStatus":"DEGRADED"}',
          },
          review: { status: 'NOT_ATTEMPTED' as const },
        }),
      },
    );

    const result = await activeModule.handlers.commands[0]!.handle(
      envelope(),
      fixture.queryContext,
    );

    expect(result).toMatchObject({
      v2: {
        status: 'BLOCKED',
        reason: 'SHORTLIST_BLOCKED',
        detail: 'SEMANTIC_DEGRADED:{"lexicalStatus":"READY","semanticStatus":"DEGRADED"}',
      },
      review: { status: 'NOT_ATTEMPTED' },
    });
    expect(result).not.toHaveProperty('v2.rawText');
    expect(result).not.toHaveProperty('v2.providerError');
    expect(fixture.saved).toHaveLength(0);
  });

  it.each([
    {
      name: 'retryable',
      state: 'FAILED_RETRYABLE' as const,
      safeFailureCode: 'RETRYABLE_DEPENDENCY' as const,
    },
    {
      name: 'terminal',
      state: 'FAILED_TERMINAL' as const,
      safeFailureCode: 'TERMINAL_FAILURE' as const,
    },
  ])(
    'exposes the durable $name V2 failure identity without falling back to v1',
    async ({ state, safeFailureCode }) => {
      const fixture = makeModule();
      const activeModule = createComparisonModule(
        {
          save: async (result) => {
            fixture.saved.push(result);
            return result;
          },
          findById: async () => undefined,
          findByCandidateAndSnapshot: async () => undefined,
        },
        {
          getSnapshot: async () => {
            throw new Error('V1 snapshot read must not run in V2_ACTIVE failure');
          },
        },
        { identity: { id: 'text-diff', version: '1' }, diff: () => [] },
        {
          handleCandidateValidated: async () => ({
            rollout: 'V2_ACTIVE' as const,
            v1Executed: false,
            v2Outcome: {
              status: 'FAILED' as const,
              analysis: {
                comparisonId: 'comparison-v2-failure',
                canonicalSnapshot: {
                  id: 'snapshot-1',
                  version: 1,
                  digest: 'snapshot-digest',
                },
                analysisRevisionId: 'analysis-v2-failure',
                state,
                safeFailureCode,
              },
            },
            review: { status: 'NOT_ATTEMPTED' as const },
          }),
        },
      );

      const result = await activeModule.handlers.commands[0]!.handle(
        envelope(),
        fixture.queryContext,
      );

      expect(result).toMatchObject({
        rollout: 'V2_ACTIVE',
        v1Executed: false,
        v2: {
          status: 'FAILED',
          comparisonId: 'comparison-v2-failure',
          snapshotVersion: 1,
          snapshotDigest: 'snapshot-digest',
          analysisRevisionId: 'analysis-v2-failure',
          analysisState: state,
          safeFailureCode,
        },
        review: { status: 'NOT_ATTEMPTED' },
      });
      expect(result).not.toHaveProperty('v2.rawText');
      expect(result).not.toHaveProperty('v2.providerError');
      expect(fixture.saved).toHaveLength(0);
      expect(fixture.snapshotReads).toBe(0);
    },
  );

  it('keeps the V2 success response contract and review handoff unchanged', async () => {
    const fixture = makeModule();
    const activeModule = createComparisonModule(
      {
        save: async (result) => {
          fixture.saved.push(result);
          return result;
        },
        findById: async () => undefined,
        findByCandidateAndSnapshot: async () => undefined,
      },
      {
        getSnapshot: async () => {
          throw new Error('V1 snapshot read must not run in V2_ACTIVE success');
        },
      },
      { identity: { id: 'text-diff', version: '1' }, diff: () => [] },
      {
        handleCandidateValidated: async () => ({
          rollout: 'V2_ACTIVE' as const,
          v1Executed: false,
          v2Outcome: {
            status: 'COMPLETED' as const,
            aggregate: {
              comparison: {
                comparisonId: 'comparison-v2-success',
                canonicalSnapshot: { version: 1, digest: 'snapshot-digest' },
              },
            },
          },
          review: { status: 'DRAFT_CREATED' as const },
        }),
      },
    );

    const result = await activeModule.handlers.commands[0]!.handle(
      envelope(),
      fixture.queryContext,
    );

    expect(result).toMatchObject({
      rollout: 'V2_ACTIVE',
      v1Executed: false,
      v2: {
        status: 'COMPLETED',
        comparisonId: 'comparison-v2-success',
        snapshotVersion: 1,
        snapshotDigest: 'snapshot-digest',
      },
      review: { status: 'DRAFT_CREATED' },
    });
    expect(fixture.saved).toHaveLength(0);
    expect(fixture.snapshotReads).toBe(0);
  });
});
