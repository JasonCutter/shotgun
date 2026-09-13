import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  PostgresDedupStore,
  PostgresJobRuntime,
} from '../../adapters/connector-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { ShotgunError, type ClaimCandidate } from '../../packages/contracts/src/index.js';
import type { ConnectorSemanticIdentity } from '../../packages/connector-runtime/src/ports.js';
import type { ComparisonV2OrchestrationOutcome } from '../../modules/comparison/src/index.js';
import { createComparisonV2Runtime } from '../../assemblies/shotgun-app/src/comparison-v2-runtime.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

afterAll(async () => {
  await pool?.end();
});

const candidate: ClaimCandidate = {
  candidateId: 'issue-287-candidate',
  batchId: 'issue-287-batch',
  revisionNumber: 1,
  projectId: 'issue-287-project',
  sourceVersionId: 'issue-287-source',
  claimText: 'A durable retryable comparison claim.',
  evidenceIds: ['issue-287-evidence'],
  evidenceMode: 'DIRECT_EVIDENCE',
  extractionProfile: 'direct-only',
  status: 'READY',
  providerCall: {} as ClaimCandidate['providerCall'],
  accessScope: ['owner'],
  sensitivity: 'internal',
  createdAt: '2026-09-13T00:00:00.000Z',
} as ClaimCandidate;

const actor = { type: 'user' as const, id: 'issue-287-owner' };
const security = {
  accessScope: ['owner'],
  sensitivity: 'internal' as const,
  dataClassification: 'issue-287-test',
};

const identityFor = (projectId: string, semanticKey: string): ConnectorSemanticIdentity => ({
  projectId,
  securityScope: JSON.stringify({
    accessScope: security.accessScope,
    sensitivity: security.sensitivity,
    dataClassification: security.dataClassification,
  }),
  consumerId: 'comparison-v2.issue-287:event:CandidateValidated',
  messageKind: 'event',
  messageType: 'CandidateValidated',
  semanticKey,
  fingerprint: `fingerprint:${semanticKey}`,
});

const completedOutcome = (): ComparisonV2OrchestrationOutcome =>
  ({
    status: 'COMPLETED',
    aggregate: { comparison: { comparisonId: 'issue-287-comparison' } },
    event: {
      eventType: 'ComparisonCompletedV2',
      contractVersion: '2.0',
      comparison: { comparisonId: 'issue-287-comparison' },
      analysisRevisionIds: [],
      emittedAt: '2026-09-13T00:00:00.000Z',
    },
  }) as unknown as ComparisonV2OrchestrationOutcome;

const cleanup = async (projectId: string): Promise<void> => {
  await pool!.query('DELETE FROM connector.dead_letters WHERE project_id=$1', [projectId]);
  await pool!.query(
    `DELETE FROM connector.jobs
      WHERE dedup_record_id IN (SELECT dedup_record_id FROM connector.dedup_records WHERE project_id=$1)`,
    [projectId],
  );
  await pool!.query('DELETE FROM connector.dedup_records WHERE project_id=$1', [projectId]);
};

describe.runIf(pool)('Issue #287 durable Comparison V2 required-ACK retry', () => {
  it('schedules a typed retry, completes on the second attempt, and survives runtime restart', async () => {
    const projectId = `issue-287-${randomUUID()}`;
    const semanticKey = `candidate-validated:${projectId}`;
    const identity = identityFor(projectId, semanticKey);
    const jobId = randomUUID();
    const testCandidate = { ...candidate, projectId };
    const dedup = new PostgresDedupStore(pool!);
    const jobs = new PostgresJobRuntime(pool!, 2, 0);
    let comparisonAttempts = 0;
    let reviewWrites = 0;

    const runtime = createComparisonV2Runtime({
      candidate: { findById: async () => testCandidate },
      settings: { getProjectSettingValue: async () => 'V2_ACTIVE' },
      orchestrator: {
        compare: async () => {
          comparisonAttempts += 1;
          if (comparisonAttempts === 1) {
            return {
              status: 'FAILED',
              analysis: {
                state: 'FAILED_RETRYABLE',
                safeFailureCode: 'RETRYABLE_DEPENDENCY',
              },
              event: {},
            } as unknown as ComparisonV2OrchestrationOutcome;
          }
          return completedOutcome();
        },
      },
      reviewBridge: {
        materializeDraft: async () => {
          reviewWrites += 1;
          return { status: 'DRAFT_CREATED' } as never;
        },
        recordDecision: async () => ({ status: 'BLOCKED', reason: 'REVIEW_NOT_ELIGIBLE' }) as never,
      },
      freshness: {} as never,
    });

    try {
      const began = await dedup.begin({ ...identity, jobId });
      expect(began.kind).toBe('ACQUIRED');

      const execution = await jobs.run(identity, randomUUID(), async () =>
        runtime.handleCandidateValidated({
          projectId,
          candidateId: testCandidate.candidateId,
          candidate: testCandidate,
          actor,
          security,
          executionTrigger: 'INITIAL_OR_EVENT_REPLAY',
        }),
      );

      expect(comparisonAttempts).toBe(2);
      expect(reviewWrites).toBe(1);
      expect(execution.result.review).toEqual({ status: 'DRAFT_CREATED' });
      expect(execution.job.status).toBe('succeeded');
      expect(execution.job.attempts.map((attempt) => attempt.status)).toEqual([
        'failed',
        'succeeded',
      ]);

      if (began.kind === 'ACQUIRED') {
        const finalAttempt = execution.job.attempts.at(-1);
        if (!finalAttempt || finalAttempt.fencingToken === undefined) {
          throw new Error('durable retry did not record a final attempt');
        }
        await dedup.complete({
          identity,
          fenceToken: finalAttempt.fencingToken,
          jobId,
          result: execution.result,
        });
      }

      const restarted = new PostgresJobRuntime(pool!, 2, 0);
      const recovered = await restarted.find(identity);
      expect(recovered?.status).toBe('succeeded');
      expect(recovered?.attempts).toHaveLength(2);
      expect(recovered?.attempts.at(-1)?.status).toBe('succeeded');
      expect(reviewWrites).toBe(1);
    } finally {
      await cleanup(projectId);
    }
  });

  it('honors the existing max-attempt policy for a permanently retryable ACK failure', async () => {
    const projectId = `issue-287-max-${randomUUID()}`;
    const identity = identityFor(projectId, `candidate-validated:${projectId}`);
    const jobId = randomUUID();
    const dedup = new PostgresDedupStore(pool!);
    const jobs = new PostgresJobRuntime(pool!, 1, 0);
    let attempts = 0;

    try {
      const began = await dedup.begin({ ...identity, jobId });
      expect(began.kind).toBe('ACQUIRED');
      await expect(
        jobs.run(identity, randomUUID(), async () => {
          attempts += 1;
          throw new ShotgunError({
            code: 'RETRYABLE_DEPENDENCY',
            safeMessage: 'the typed ACK failure is surfaced by the handler',
            module: 'comparison-v2.issue-287',
            operation: 'required-ack',
            retryable: true,
          });
        }),
      ).rejects.toThrow();
      expect(attempts).toBe(1);
      const stored = await jobs.find(identity);
      expect(stored?.status).toBe('failed');
      expect(stored?.attempts).toHaveLength(1);
    } finally {
      await cleanup(projectId);
    }
  });
});
