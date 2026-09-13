import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  PostgresDedupStore,
  PostgresJobRuntime,
} from '../../adapters/connector-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { createComparisonV2Runtime } from '../../assemblies/shotgun-app/src/comparison-v2-runtime.js';
import {
  createComparisonModule,
  type CandidateValidatedCompletionReceipt,
  type ComparisonV2OrchestrationOutcome,
} from '../../modules/comparison/src/index.js';
import { ShotgunError, type ClaimCandidate } from '../../packages/contracts/src/index.js';
import type { ConnectorSemanticIdentity } from '../../packages/connector-runtime/src/ports.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

afterAll(async () => {
  await pool?.end();
});

const actor = { type: 'user' as const, id: 'issue-289-owner' };
const security = {
  accessScope: ['owner'],
  sensitivity: 'internal' as const,
  dataClassification: 'issue-289-test',
};

const candidateFor = (projectId: string): ClaimCandidate =>
  ({
    candidateId: `candidate-${projectId}`,
    batchId: `batch-${projectId}`,
    revisionNumber: 1,
    projectId,
    sourceVersionId: `source-${projectId}`,
    claimText: 'FORBIDDEN_CANDIDATE_TEXT',
    evidenceIds: ['FORBIDDEN_EVIDENCE_ID'],
    evidenceMode: 'DIRECT_EVIDENCE',
    extractionProfile: 'direct-only',
    status: 'READY',
    providerCall: {
      provider: 'FORBIDDEN_PROVIDER_PAYLOAD',
    } as ClaimCandidate['providerCall'],
    accessScope: ['owner'],
    sensitivity: 'internal',
    createdAt: '2026-09-13T00:00:00.000Z',
  }) as ClaimCandidate;

const completedOutcome = (comparisonId: string): ComparisonV2OrchestrationOutcome =>
  ({
    status: 'COMPLETED',
    aggregate: { comparison: { comparisonId } },
    event: {
      eventType: 'ComparisonCompletedV2',
      contractVersion: '2.0',
      comparison: { comparisonId },
      analysisRevisionIds: [],
      emittedAt: '2026-09-13T00:00:00.000Z',
    },
  }) as unknown as ComparisonV2OrchestrationOutcome;

const failedRetryableOutcome = (): ComparisonV2OrchestrationOutcome =>
  ({
    status: 'FAILED',
    analysis: {
      comparisonId: 'comparison-issue-289',
      canonicalSnapshot: { version: 1, digest: 'snapshot-digest' },
      analysisRevisionId: 'analysis-issue-289',
      state: 'FAILED_RETRYABLE',
      safeFailureCode: 'RETRYABLE_DEPENDENCY',
    },
    event: {},
  }) as unknown as ComparisonV2OrchestrationOutcome;

const identityFor = (projectId: string, semanticKey: string): ConnectorSemanticIdentity => ({
  projectId,
  securityScope: JSON.stringify({
    accessScope: security.accessScope,
    sensitivity: security.sensitivity,
    dataClassification: security.dataClassification,
  }),
  consumerId: 'stage5.comparison:event:CandidateValidated',
  messageKind: 'event',
  messageType: 'CandidateValidated',
  semanticKey,
  fingerprint: `fingerprint:${semanticKey}`,
});

const eventFor = (projectId: string, candidate: ClaimCandidate) =>
  ({
    messageType: 'CandidateValidated',
    messageKind: 'event',
    schemaVersion: '1.0.0',
    messageId: `message-${projectId}`,
    correlationId: `correlation-${projectId}`,
    idempotencyKey: `candidate-validated:${projectId}`,
    createdAt: '2026-09-13T00:00:00.000Z',
    projectId,
    actor,
    security,
    payload: { candidateId: candidate.candidateId },
  }) as never;

const createModule = (
  projectId: string,
  compare: () => Promise<ComparisonV2OrchestrationOutcome>,
) => {
  const candidate = candidateFor(projectId);
  let reviewWrites = 0;
  const runtime = createComparisonV2Runtime({
    candidate: { findById: async () => candidate },
    settings: { getProjectSettingValue: async () => 'V2_ACTIVE' },
    orchestrator: { compare },
    reviewBridge: {
      materializeDraft: async () => {
        reviewWrites += 1;
        return { status: 'DRAFT_CREATED' } as never;
      },
      recordDecision: async () => ({ status: 'BLOCKED', reason: 'REVIEW_NOT_ELIGIBLE' }) as never,
    },
    freshness: {} as never,
  });
  const module = createComparisonModule(
    {
      save: async (result) => result,
      findById: async () => undefined,
      findByCandidateAndSnapshot: async () => undefined,
    },
    {
      getSnapshot: async () => ({
        snapshotId: `snapshot-${projectId}`,
        projectId,
        version: 1,
        digest: 'snapshot-digest',
        claims: [],
        createdAt: '2026-09-13T00:00:00.000Z',
      }),
    },
    { identity: { id: 'text-diff', version: '1' }, diff: () => [] },
    runtime,
  );
  return { candidate, module, getReviewWrites: () => reviewWrites };
};

const contextFor = (candidate: ClaimCandidate) =>
  ({
    query: async () => ({ payload: candidate }),
    publish: async () => undefined,
  }) as never;

const cleanup = async (projectId: string): Promise<void> => {
  await pool!.query(
    `DELETE FROM connector.jobs
      WHERE dedup_record_id IN (SELECT dedup_record_id FROM connector.dedup_records WHERE project_id=$1)`,
    [projectId],
  );
  await pool!.query('DELETE FROM connector.dedup_records WHERE project_id=$1', [projectId]);
};

describe.runIf(pool)('Issue #289 CandidateValidated completion receipt persistence', () => {
  it('persists one bounded V2 receipt after retry and reads it back after runtime restart', async () => {
    const projectId = `issue-289-${randomUUID()}`;
    const semanticKey = `candidate-validated:${projectId}`;
    const identity = identityFor(projectId, semanticKey);
    const jobId = randomUUID();
    const candidate = candidateFor(projectId);
    let comparisonAttempts = 0;
    const { module, getReviewWrites } = createModule(projectId, async () => {
      comparisonAttempts += 1;
      return comparisonAttempts === 1
        ? failedRetryableOutcome()
        : completedOutcome(`comparison-${projectId}`);
    });
    const handler = module.handlers.events[0]!.handle;
    const dedup = new PostgresDedupStore(pool!);
    const jobs = new PostgresJobRuntime(pool!, 2, 0);

    try {
      const began = await dedup.begin<CandidateValidatedCompletionReceipt>({ ...identity, jobId });
      expect(began.kind).toBe('ACQUIRED');
      if (began.kind !== 'ACQUIRED') return;

      const execution = await jobs.run(identity, `correlation-${projectId}`, async () =>
        handler(eventFor(projectId, candidate), contextFor(candidate)),
      );
      const expectedReceipt: CandidateValidatedCompletionReceipt = {
        kind: 'CANDIDATE_VALIDATED_COMPLETION',
        version: 1,
        rollout: 'V2_ACTIVE',
        v1Executed: false,
        v2Status: 'COMPLETED',
        comparisonId: `comparison-${projectId}`,
        reviewStatus: 'DRAFT_CREATED',
      };
      expect(execution.result).toEqual(expectedReceipt);
      expect(execution.job.attempts.map((attempt) => attempt.status)).toEqual([
        'failed',
        'succeeded',
      ]);
      expect(comparisonAttempts).toBe(2);
      expect(getReviewWrites()).toBe(1);

      await dedup.complete({
        identity,
        fenceToken: began.record.fenceToken,
        jobId: began.record.jobId ?? jobId,
        result: execution.result,
      });

      const persisted = await pool!.query<{ status: string; result: unknown }>(
        'SELECT status, result FROM connector.jobs WHERE job_id=$1',
        [execution.job.jobId],
      );
      expect(persisted.rows[0]).toEqual({ status: 'succeeded', result: expectedReceipt });
      expect(JSON.stringify(persisted.rows[0]!.result)).not.toMatch(
        /FORBIDDEN_CANDIDATE_TEXT|FORBIDDEN_EVIDENCE_ID|FORBIDDEN_PROVIDER_PAYLOAD|rationale|prompt|security/i,
      );

      const restartedJob = await new PostgresJobRuntime(pool!, 2, 0).find(identity);
      const restartedDedup = await new PostgresDedupStore(
        pool!,
      ).get<CandidateValidatedCompletionReceipt>(identity);
      expect(restartedJob?.status).toBe('succeeded');
      expect(restartedJob?.attempts).toHaveLength(2);
      expect(restartedDedup?.state).toBe('COMPLETED');
      expect(restartedDedup?.result).toEqual(expectedReceipt);

      const replay = await new PostgresDedupStore(pool!).begin<CandidateValidatedCompletionReceipt>(
        {
          ...identity,
          jobId: randomUUID(),
        },
      );
      expect(replay).toMatchObject({ kind: 'DUPLICATE', record: { state: 'COMPLETED' } });
      if (replay.kind === 'DUPLICATE') expect(replay.record.result).toEqual(expectedReceipt);
    } finally {
      await cleanup(projectId);
    }
  });

  it('does not persist a successful receipt for a terminal V2 ACK failure', async () => {
    const projectId = `issue-289-failed-${randomUUID()}`;
    const identity = identityFor(projectId, `candidate-validated:${projectId}`);
    const candidate = candidateFor(projectId);
    const { module } = createModule(projectId, async () => {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'policy blocked',
        module: 'issue-289-test',
        operation: 'compare',
      });
    });
    const dedup = new PostgresDedupStore(pool!);
    const jobs = new PostgresJobRuntime(pool!, 1, 0);
    const jobId = randomUUID();

    try {
      const began = await dedup.begin<CandidateValidatedCompletionReceipt>({ ...identity, jobId });
      expect(began.kind).toBe('ACQUIRED');
      if (began.kind !== 'ACQUIRED') return;

      let failure: unknown;
      try {
        await jobs.run(identity, `correlation-${projectId}`, async () =>
          module.handlers.events[0]!.handle(eventFor(projectId, candidate), contextFor(candidate)),
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: 'POLICY_DENIED' });
      await dedup.fail({
        identity,
        fenceToken: began.record.fenceToken,
        jobId: began.record.jobId ?? jobId,
        safeErrorCode: 'POLICY_DENIED',
        safeErrorMessage: 'policy blocked',
      });
      const stored = await dedup.get<CandidateValidatedCompletionReceipt>(identity);
      expect(stored?.state).toBe('FAILED');
      expect(stored?.result).toBeUndefined();
      const persisted = await pool!.query<{ status: string; result: unknown }>(
        'SELECT status, result FROM connector.jobs WHERE job_id=$1',
        [jobId],
      );
      expect(persisted.rows[0]?.status).toBe('failed');
      expect(persisted.rows[0]?.result).toBeNull();
    } finally {
      await cleanup(projectId);
    }
  });
});
