import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { FakeDraftActionConnector } from '../../adapters/action-connector-fake/src/index.js';
import { PostgresActionExecutionRepository } from '../../adapters/postgres-stage11/src/index.js';
import type {
  ActionAuditEvent,
  ActionExecutionRecord,
} from '../../packages/contracts/src/index.js';
import { ShotgunError } from '../../packages/contracts/src/index.js';
import {
  createActionExecutionModule,
  createActionFeedbackIntent,
  dispatchActionFeedbackOutbox,
  runActionFeedbackOutboxRecovery,
} from '../../modules/action-execution/src/index.js';
import { createActionFeedbackReviewModule } from '../../modules/action-feedback-review/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectId = 'project-stage11-feedback-outbox';
const timestamp = '2026-09-15T10:00:00.000Z';
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const poolWithCommitAckLoss = (base: Pool): Pool =>
  ({
    connect: async (): Promise<PoolClient> => {
      const client = await base.connect();
      let released = false;
      return {
        query: async (sql: string, values?: readonly unknown[]) => {
          if (sql.trim().toUpperCase() === 'COMMIT') {
            await client.query(sql);
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
      values === undefined ? base.query(sql) : base.query(sql, values as unknown[]),
  }) as unknown as Pool;

const seedExecuting = async (suffix: string): Promise<ActionExecutionRecord> => {
  const actionId = randomUUID();
  const record = {
    actionId,
    projectId,
    status: 'EXECUTING' as const,
    preview: {
      actionId,
      projectId,
      previewDigest: digest('a'),
      riskDecision: { policyVersion: 'stage11-test' },
    },
    canonicalWrite: false as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  } as ActionExecutionRecord;
  await pool!.query(
    `INSERT INTO action.executions
       (action_id, project_id, candidate_id, candidate_revision, candidate_digest,
        target_digest, parameter_digest, preview_digest, status, record_json, created_at, updated_at)
     VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9::jsonb, $10, $10)`,
    [
      actionId,
      projectId,
      `candidate:${suffix}:${actionId}`,
      digest('b'),
      digest('c'),
      digest('d'),
      record.preview.previewDigest,
      record.status,
      JSON.stringify(record),
      timestamp,
    ],
  );
  return record;
};

const transition = async (
  repository: PostgresActionExecutionRepository,
  current: ActionExecutionRecord,
  status: ActionExecutionRecord['status'],
  category: ActionAuditEvent['category'],
  updatedAt: string,
  withFeedback = true,
): Promise<ActionExecutionRecord> => {
  const next = { ...current, status, updatedAt } as ActionExecutionRecord;
  return repository.transition(current.projectId, current.actionId, {
    expectedStatus: current.status,
    next,
    category,
    actorId: 'stage11-test-worker',
    details: { test: true },
    feedbackIntent: withFeedback ? createActionFeedbackIntent(next) : undefined,
  });
};

const stage11Kernel = (
  repository: PostgresActionExecutionRepository,
  connector: FakeDraftActionConnector,
) => {
  const kernel = new ShotgunKernel(new InProcessTransport());
  kernel.register(
    createActionExecutionModule(
      repository,
      { find: async () => undefined },
      { resolveCurrentBinding: async () => undefined },
      connector,
      { now: () => '2026-09-15T11:00:00.000Z' },
    ),
    createActionFeedbackReviewModule(repository, { now: () => '2026-09-15T11:00:00.000Z' }),
  );
  return kernel;
};

describe.runIf(pool)('ADR-166 Stage 11 Action feedback outbox PostgreSQL regressions', () => {
  beforeEach(async () => {
    await migrateUpTo(undefined, databaseUrl);
    await pool!.query(
      'TRUNCATE action.action_feedback_outbox, action.audit_events, action.executions CASCADE',
    );
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('A-E/J/K atomically persists terminal feedback, keeps UNKNOWN and VERIFIED distinct, and excludes preflight', async () => {
    const repository = new PostgresActionExecutionRepository(pool!);
    const failed = await seedExecuting('failed');
    await transition(repository, failed, 'FAILED', 'ACTION_FAILED', '2026-09-15T10:01:00.000Z');
    const unknown = await seedExecuting('unknown');
    await transition(
      repository,
      unknown,
      'OUTCOME_UNKNOWN',
      'ACTION_OUTCOME_UNKNOWN',
      '2026-09-15T10:02:00.000Z',
    );
    const verified = await seedExecuting('verified');
    await transition(
      repository,
      verified,
      'VERIFIED',
      'ACTION_VERIFIED',
      '2026-09-15T10:03:00.000Z',
    );
    const verificationFailed = await seedExecuting('verification-failed');
    await transition(
      repository,
      verificationFailed,
      'VERIFICATION_FAILED',
      'ACTION_VERIFICATION_FAILED',
      '2026-09-15T10:04:00.000Z',
    );
    const preflight = await seedExecuting('preflight');
    await transition(
      repository,
      preflight,
      'PREFLIGHT_FAILED',
      'ACTION_PREFLIGHT_FAILED',
      '2026-09-15T10:05:00.000Z',
      false,
    );

    const rows = await pool!.query<{
      readonly action_id: string;
      readonly feedback_status: string;
      readonly semantic_key: string;
    }>(
      `SELECT action_id, feedback_status, semantic_key
       FROM action.action_feedback_outbox
       ORDER BY action_id, feedback_status`,
    );
    expect(rows.rows).toHaveLength(4);
    expect(rows.rows.map((row) => row.feedback_status).sort()).toEqual([
      'FAILED',
      'FAILED',
      'OUTCOME_UNKNOWN',
      'VERIFIED',
    ]);
    expect(rows.rows.some((row) => row.action_id === preflight.actionId)).toBe(false);

    const unknownVerified = await seedExecuting('unknown-then-verified');
    await transition(
      repository,
      unknownVerified,
      'OUTCOME_UNKNOWN',
      'ACTION_OUTCOME_UNKNOWN',
      '2026-09-15T10:06:00.000Z',
    );
    const recoveredVerified = await transition(
      repository,
      { ...unknownVerified, status: 'OUTCOME_UNKNOWN', updatedAt: '2026-09-15T10:06:00.000Z' },
      'VERIFIED',
      'ACTION_VERIFIED',
      '2026-09-15T10:07:00.000Z',
    );
    expect(recoveredVerified.status).toBe('VERIFIED');
    const distinct = await pool!.query<{ readonly semantic_key: string }>(
      `SELECT semantic_key
       FROM action.action_feedback_outbox
       WHERE project_id = $1 AND action_id = $2
       ORDER BY semantic_key`,
      [projectId, unknownVerified.actionId],
    );
    expect(distinct.rows.map((row) => row.semantic_key)).toEqual([
      `action-feedback:${unknownVerified.actionId}:OUTCOME_UNKNOWN`,
      `action-feedback:${unknownVerified.actionId}:VERIFIED`,
    ]);
  });

  it('G-H retries the same semantic key after publication ACK loss and stale worker claim', async () => {
    const repository = new PostgresActionExecutionRepository(pool!);
    const action = await seedExecuting('dispatch');
    const failed = await transition(
      repository,
      action,
      'FAILED',
      'ACTION_FAILED',
      '2026-09-15T10:01:00.000Z',
    );
    const semanticKey = `action-feedback:${failed.actionId}:FAILED`;
    const attempted: string[] = [];
    await expect(
      dispatchActionFeedbackOutbox(
        repository,
        {
          publish: async (event) => {
            attempted.push(event.idempotencyKey!);
            throw new ShotgunError({
              code: 'OUTCOME_UNKNOWN',
              safeMessage: 'publication ACK was lost',
              module: 'stage11-test',
              operation: 'publish',
            });
          },
        },
        projectId,
        1,
        '2026-09-15T10:02:00.000Z',
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await dispatchActionFeedbackOutbox(
      repository,
      {
        publish: async (event) => {
          attempted.push(event.idempotencyKey!);
        },
      },
      projectId,
      1,
      '2026-09-15T10:03:00.000Z',
    );
    expect(attempted).toEqual([semanticKey, semanticKey]);

    const processing = await repository.claimFeedbackOutbox(
      projectId,
      undefined,
      1,
      '2026-09-15T10:04:00.000Z',
      '2026-09-15T10:03:00.000Z',
    );
    expect(processing).toHaveLength(0);
    const second = await seedExecuting('restart');
    const secondFailed = await transition(
      repository,
      second,
      'FAILED',
      'ACTION_FAILED',
      '2026-09-15T10:05:00.000Z',
    );
    const firstClaim = await repository.claimFeedbackOutbox(
      projectId,
      `action-feedback:${secondFailed.actionId}:FAILED`,
      1,
      '2026-09-15T10:06:00.000Z',
      '2026-09-15T10:05:00.000Z',
    );
    expect(firstClaim).toHaveLength(1);
    const restarted = new PostgresActionExecutionRepository(pool!);
    const restartedClaim = await restarted.claimFeedbackOutbox(
      projectId,
      `action-feedback:${secondFailed.actionId}:FAILED`,
      1,
      '2026-09-15T10:12:00.000Z',
      '2026-09-15T10:07:00.000Z',
    );
    expect(restartedClaim).toHaveLength(1);
    await dispatchActionFeedbackOutbox(
      restarted,
      { publish: async () => undefined },
      projectId,
      1,
      '2026-09-15T10:20:00.000Z',
      `action-feedback:${secondFailed.actionId}:FAILED`,
    );
    expect(
      await restarted.findFeedbackOutbox(
        projectId,
        `action-feedback:${secondFailed.actionId}:FAILED`,
      ),
    ).toMatchObject({ status: 'published', attempts: 3 });
  });

  it('proves a published marker after COMMIT acknowledgement loss without redispatch', async () => {
    const repository = new PostgresActionExecutionRepository(pool!);
    const action = await seedExecuting('published-marker-ack-loss');
    await transition(repository, action, 'FAILED', 'ACTION_FAILED', '2026-09-15T10:11:00.000Z');
    const semanticKey = `action-feedback:${action.actionId}:FAILED`;
    const claimed = await repository.claimFeedbackOutbox(
      projectId,
      semanticKey,
      1,
      '2026-09-15T10:12:00.000Z',
      '2026-09-15T10:07:00.000Z',
    );
    expect(claimed).toHaveLength(1);

    const ackLossRepository = new PostgresActionExecutionRepository(poolWithCommitAckLoss(pool!));
    await expect(
      ackLossRepository.markFeedbackOutboxPublished(
        projectId,
        claimed[0]!.outboxId,
        claimed[0]!.attempts,
        '2026-09-15T10:13:00.000Z',
        claimed[0],
      ),
    ).resolves.toBeUndefined();
    expect(await repository.findFeedbackOutbox(projectId, semanticKey)).toMatchObject({
      status: 'published',
      claimedAt: undefined,
      publishedAt: '2026-09-15T10:13:00.000Z',
    });
  });

  it('I backfills all historical feedback categories additively without provider calls or duplicates', async () => {
    const repository = new PostgresActionExecutionRepository(pool!);
    const action = await seedExecuting('backfill');
    const categories: readonly ActionAuditEvent['category'][] = [
      'ACTION_FAILED',
      'ACTION_OUTCOME_UNKNOWN',
      'ACTION_VERIFICATION_FAILED',
      'ACTION_VERIFIED',
      'ACTION_PREFLIGHT_FAILED',
    ];
    for (const [index, category] of categories.entries()) {
      const occurredAt = `2026-09-15T10:0${index + 1}:00.000Z`;
      const event: ActionAuditEvent = {
        auditEventId: randomUUID(),
        actionId: action.actionId,
        projectId,
        sequence: index + 1,
        category,
        actorId: 'historical-worker',
        policyVersion: 'stage11-test',
        details: { historical: true },
        occurredAt,
      };
      await pool!.query(
        `INSERT INTO action.audit_events
           (audit_event_id, action_id, project_id, sequence, category, event_json, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          event.auditEventId,
          action.actionId,
          projectId,
          event.sequence,
          category,
          JSON.stringify(event),
          occurredAt,
        ],
      );
    }
    expect(await repository.backfillFeedbackOutbox(100, '2026-09-15T10:20:00.000Z')).toBe(3);
    expect(await repository.backfillFeedbackOutbox(100, '2026-09-15T10:21:00.000Z')).toBe(0);
    const rows = await pool!.query<{ readonly feedback_status: string }>(
      'SELECT feedback_status FROM action.action_feedback_outbox WHERE project_id = $1',
      [projectId],
    );
    expect(rows.rows.map((row) => row.feedback_status).sort()).toEqual([
      'FAILED',
      'OUTCOME_UNKNOWN',
      'VERIFIED',
    ]);
  });

  it('backfill makes forward progress when the requested limit is smaller than history', async () => {
    const repository = new PostgresActionExecutionRepository(pool!);
    for (let index = 0; index < 5; index += 1) {
      const action = await seedExecuting(`backfill-forward-${index}`);
      await transition(
        repository,
        action,
        'FAILED',
        'ACTION_FAILED',
        `2026-09-15T10:2${index}:00.000Z`,
        false,
      );
    }
    expect(await repository.backfillFeedbackOutbox(2, '2026-09-15T10:40:00.000Z')).toBe(2);
    expect(await repository.backfillFeedbackOutbox(2, '2026-09-15T10:41:00.000Z')).toBe(2);
    expect(await repository.backfillFeedbackOutbox(2, '2026-09-15T10:42:00.000Z')).toBe(1);
    expect(await repository.backfillFeedbackOutbox(2, '2026-09-15T10:43:00.000Z')).toBe(0);
  });

  it('restarts the real Stage 11 kernel and materializes each committed feedback exactly once', async () => {
    const repository = new PostgresActionExecutionRepository(pool!);
    const connector = new FakeDraftActionConnector();
    const failed = await seedExecuting('restart-failed');
    await transition(repository, failed, 'FAILED', 'ACTION_FAILED', '2026-09-15T10:51:00.000Z');
    const unknown = await seedExecuting('restart-unknown');
    await transition(
      repository,
      unknown,
      'OUTCOME_UNKNOWN',
      'ACTION_OUTCOME_UNKNOWN',
      '2026-09-15T10:52:00.000Z',
    );
    const verified = await seedExecuting('restart-verified');
    await transition(
      repository,
      verified,
      'VERIFIED',
      'ACTION_VERIFIED',
      '2026-09-15T10:53:00.000Z',
    );
    const verificationFailed = await seedExecuting('restart-verification-failed');
    await transition(
      repository,
      verificationFailed,
      'VERIFICATION_FAILED',
      'ACTION_VERIFICATION_FAILED',
      '2026-09-15T10:54:00.000Z',
    );
    const preflight = await seedExecuting('restart-preflight');
    await transition(
      repository,
      preflight,
      'PREFLIGHT_FAILED',
      'ACTION_PREFLIGHT_FAILED',
      '2026-09-15T10:55:00.000Z',
      false,
    );

    const firstProcess = stage11Kernel(repository, connector);
    await firstProcess.start();
    await firstProcess.shutdown();

    const restartedProcess = stage11Kernel(repository, connector);
    await restartedProcess.start();
    try {
      expect(await runActionFeedbackOutboxRecovery(repository, restartedProcess.connector)).toBe(4);
      const reviews = await pool!.query<{ readonly action_id: string; readonly outcome: string }>(
        `SELECT action_id, outcome
         FROM action.action_review_work_items
         WHERE project_id = $1
         ORDER BY action_id`,
        [projectId],
      );
      expect(reviews.rows).toHaveLength(4);
      expect(reviews.rows.map((row) => row.outcome).sort()).toEqual([
        'FAILED',
        'FAILED',
        'OUTCOME_UNKNOWN',
        'VERIFIED',
      ]);
      expect(await runActionFeedbackOutboxRecovery(repository, restartedProcess.connector)).toBe(0);
      expect(
        (
          await pool!.query(
            'SELECT count(*)::int AS count FROM action.action_review_work_items WHERE project_id = $1',
            [projectId],
          )
        ).rows[0]?.count,
      ).toBe(4);
      expect(connector.calls).toEqual({ preflight: 0, execute: 0, verify: 0 });
    } finally {
      await restartedProcess.shutdown();
    }
  });
});
