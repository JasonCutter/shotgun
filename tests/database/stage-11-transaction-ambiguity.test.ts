import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  PostgresActionCandidateRepository,
  PostgresActionExecutionRepository,
} from '../../adapters/postgres-stage11/src/index.js';
import { FakeDraftActionConnector } from '../../adapters/action-connector-fake/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import type {
  ActionApprovalRecord,
  ActionExecutionRecord,
  ProviderActionResult,
} from '../../packages/contracts/src/index.js';
import { actionEvidenceSetDigest } from '../../packages/contracts/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import {
  createActionExecutionModule,
  type ActionBindingReference,
} from '../../modules/action-execution/src/index.js';
import { actionServerCandidate, prepareActionCommand } from '../helpers/stage-11.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

type CommitAckLossMode = 'after-commit' | 'before-commit';

type AckLossPool = {
  readonly pool: Pool;
  readonly commands: readonly string[];
  readonly connectionDiscarded: () => boolean;
};

const createCommitAckLossPool = (basePool: Pool, mode: CommitAckLossMode): AckLossPool => {
  const commands: string[] = [];
  let connectionDiscarded = false;
  const wrappedPool = {
    connect: async (): Promise<PoolClient> => {
      const client = await basePool.connect();
      let released = false;
      return {
        query: async (sql: string, values?: readonly unknown[]) => {
          const command = sql.trim().toUpperCase();
          if (command === 'BEGIN' || command === 'COMMIT' || command === 'ROLLBACK')
            commands.push(command);
          if (command === 'COMMIT') {
            if (mode === 'before-commit') {
              connectionDiscarded = true;
              released = true;
              client.release(new Error('discarded before COMMIT outcome was proven'));
              throw new Error('simulated unresolved COMMIT acknowledgement');
            }
            await client.query(sql, values as unknown[]);
            throw new Error('simulated lost COMMIT acknowledgement');
          }
          return values === undefined ? client.query(sql) : client.query(sql, values as unknown[]);
        },
        release: (error?: Error) => {
          if (released) return;
          released = true;
          client.release(error);
        },
      } as unknown as PoolClient;
    },
    query: (sql: string, values?: readonly unknown[]) =>
      values === undefined ? basePool.query(sql) : basePool.query(sql, values as unknown[]),
  };
  return {
    pool: wrappedPool as unknown as Pool,
    commands,
    connectionDiscarded: () => connectionDiscarded,
  };
};

const independentVerification = async (
  candidates: PostgresActionCandidateRepository,
): Promise<{
  readonly resolveCurrentBinding: (request: ActionBindingReference) => Promise<
    | {
        readonly validation: {
          readonly validationId: string;
          readonly candidateId: string;
          readonly revisionNumber: number;
          readonly sourceVersionId: string;
          readonly status: string;
          readonly digest: string;
        };
        readonly evidence: readonly {
          readonly evidenceId: string;
          readonly sourceId: string;
          readonly sourceVersionId: string;
          readonly exactHash: string;
          readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
          readonly digest: string;
        }[];
        readonly evidenceSetDigest: string;
        readonly sourceVersionId: string;
        readonly sourceSensitivity: 'public' | 'internal' | 'private' | 'restricted';
      }
    | undefined
  >;
}> => ({
  resolveCurrentBinding: async (request) => {
    const candidate = await candidates.find(request.projectId, request.actionCandidateId);
    if (!candidate) return undefined;
    return {
      validation: {
        validationId: candidate.candidate.validation.validationId,
        candidateId: candidate.candidate.candidateId,
        revisionNumber: candidate.candidate.revisionNumber,
        sourceVersionId: 'source:stage11',
        status: 'READY',
        digest: candidate.validationDigest,
      },
      evidence: candidate.evidence.map((evidence) => ({
        evidenceId: evidence.evidenceId,
        sourceId: 'source:stage11',
        sourceVersionId: 'source:stage11',
        exactHash: 'sha256:stage11',
        sensitivity: candidate.sourceSensitivity,
        digest: evidence.digest,
      })),
      evidenceSetDigest: actionEvidenceSetDigest(candidate.evidence),
      sourceVersionId: 'source:stage11',
      sourceSensitivity: candidate.sourceSensitivity,
    };
  },
});

const preparePreview = async (
  executionPool: Pool,
  suffix: string,
): Promise<{
  readonly repository: PostgresActionExecutionRepository;
  readonly preview: ActionExecutionRecord;
}> => {
  const candidates = new PostgresActionCandidateRepository(pool!);
  const repository = new PostgresActionExecutionRepository(executionPool);
  const candidate = actionServerCandidate(suffix);
  await candidates.stage(candidate);
  const kernel = new ShotgunKernel(new InProcessTransport());
  const connector = new FakeDraftActionConnector();
  kernel.register(
    createActionExecutionModule(
      repository,
      candidates,
      await independentVerification(candidates),
      connector,
      { now: () => '2026-09-15T10:00:00.000Z' },
    ),
  );
  await kernel.start();
  const preview = (
    await kernel.connector.sendCommand<ActionExecutionRecord>(prepareActionCommand(candidate))
  ).result;
  await kernel.shutdown();
  return { repository, preview };
};

const createApproval = (preview: ActionExecutionRecord): ActionApprovalRecord => ({
  approvalId: randomUUID(),
  actionId: preview.actionId,
  snapshotId: preview.preview.snapshotId,
  snapshotDigest: preview.preview.previewDigest,
  candidateRevision: preview.preview.candidate.revisionNumber,
  approvedBy: { type: 'user', id: 'owner' },
  approvalPolicy: preview.preview.approvalPolicy,
  approvedAt: '2026-09-15T10:01:00.000Z',
  expiresAt: preview.preview.expiresAt,
});

const countRows = async (projectId: string, actionId: string) => {
  const result = await pool!.query<{
    readonly executions: number;
    readonly snapshots: number;
    readonly approvals: number;
    readonly audits: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM action.executions WHERE project_id = $1 AND action_id = $2) AS executions,
       (SELECT count(*)::int FROM action.preview_snapshots WHERE project_id = $1 AND action_id = $2) AS snapshots,
       (SELECT count(*)::int FROM action.approval_records WHERE action_id = $2) AS approvals,
       (SELECT count(*)::int FROM action.audit_events WHERE project_id = $1 AND action_id = $2) AS audits`,
    [projectId, actionId],
  );
  return result.rows[0];
};

describe.runIf(pool)('Stage 11 PostgreSQL transaction ambiguity reconciliation', () => {
  beforeEach(async () => {
    await migrateUpTo(undefined, databaseUrl);
    await pool!.query(
      'TRUNCATE action.action_review_work_items, action.audit_events, action.approval_records, action.preview_snapshots, action.approvals, action.executions, action.candidates CASCADE',
    );
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('reconciles Preview, Approval, Claim, transitions, and feedback after committed ACK loss', async () => {
    const ackLoss = createCommitAckLossPool(pool!, 'after-commit');
    const { repository, preview } = await preparePreview(ackLoss.pool, `ack-loss-${randomUUID()}`);
    const approval = createApproval(preview);
    const approved = await repository.approve(
      preview.projectId,
      preview.actionId,
      preview.preview.previewDigest,
      approval,
    );
    const claimed = await repository.claimForExecution(
      approved.projectId,
      approval.approvalId,
      '2026-09-15T10:02:00.000Z',
      'worker-1',
    );
    expect(claimed.claimed).toBe(true);

    const preflightPassed = await repository.transition(
      claimed.record.projectId,
      claimed.record.actionId,
      {
        expectedStatus: 'EXECUTING',
        next: { ...claimed.record, updatedAt: '2026-09-15T10:03:00.000Z' },
        category: 'ACTION_PREFLIGHT_PASSED',
        actorId: 'worker-1',
        details: { connectorId: 'fake-draft', duplicate: false },
      },
    );
    const providerResult: ProviderActionResult = {
      provider: 'fake-draft',
      externalId: `external:${preview.actionId}`,
      idempotencyKey: `action:${preview.actionId}:${preview.preview.previewDigest}`,
      observedDigest: 'sha256:provider-result',
      completedAt: '2026-09-15T10:04:00.000Z',
    };
    const executed = await repository.transition(
      preflightPassed.projectId,
      preflightPassed.actionId,
      {
        expectedStatus: 'EXECUTING',
        next: {
          ...preflightPassed,
          status: 'EXECUTED',
          providerResult,
          updatedAt: '2026-09-15T10:04:00.000Z',
        },
        category: 'ACTION_EXECUTED',
        actorId: 'worker-1',
        details: {
          provider: providerResult.provider,
          externalId: providerResult.externalId,
          observedDigest: providerResult.observedDigest,
        },
      },
    );
    const feedback = await repository.upsertFromFeedback({
      projectId: executed.projectId,
      semanticKey: `action-feedback:${executed.actionId}:VERIFIED`,
      actionId: executed.actionId,
      outcome: 'VERIFIED',
      phase: 'ACTION_REVIEW',
      evidenceRef: `action-audit:${executed.actionId}:VERIFIED`,
      feedbackOccurredAt: '2026-09-15T10:05:00.000Z',
      now: '2026-09-15T10:05:00.000Z',
    });

    expect(approved.status).toBe('APPROVED');
    expect(executed.status).toBe('EXECUTED');
    expect(feedback.actionId).toBe(executed.actionId);
    expect(await countRows(executed.projectId, executed.actionId)).toEqual({
      executions: 1,
      snapshots: 1,
      approvals: 1,
      audits: 7,
    });
    expect(ackLoss.commands.filter((command) => command === 'ROLLBACK')).toHaveLength(0);
    expect(ackLoss.commands.filter((command) => command === 'COMMIT')).toHaveLength(6);
  }, 60_000);

  it('keeps unresolved Claim COMMIT ambiguity unknown without rollback or fabricated EXECUTING', async () => {
    const { repository: baseRepository, preview } = await preparePreview(
      pool!,
      `unresolved-${randomUUID()}`,
    );
    const approval = createApproval(preview);
    await baseRepository.approve(
      preview.projectId,
      preview.actionId,
      preview.preview.previewDigest,
      approval,
    );
    const unresolved = createCommitAckLossPool(pool!, 'before-commit');
    const repository = new PostgresActionExecutionRepository(unresolved.pool);

    await expect(
      repository.claimForExecution(
        preview.projectId,
        approval.approvalId,
        '2026-09-15T10:02:00.000Z',
        'worker-1',
      ),
    ).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
      module: 'postgres-stage11',
      operation: 'claim-action-for-execution',
    });
    expect((await baseRepository.find(preview.projectId, preview.actionId))?.status).toBe(
      'APPROVED',
    );
    expect(unresolved.commands).toEqual(['BEGIN', 'COMMIT']);
    expect(unresolved.connectionDiscarded()).toBe(true);
  }, 60_000);
});
