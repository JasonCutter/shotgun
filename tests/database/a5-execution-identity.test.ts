import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-postgres/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import type {
  AIExecutionPin,
  AskExecutionScope,
} from '../../modules/frontend-ask-execution/src/index.js';
import { ASK_SCHEMA_VERSION } from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool = createPostgresPool(databaseUrl);

describe('A5 execution identity PostgreSQL persistence', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('persists one immutable pin and copies it to retry attempts without secret material', async () => {
    const suffix = randomUUID();
    const principalId = randomUUID();
    const projectId = `a5-project-${suffix}`;
    await pool.query(
      `INSERT INTO auth.principals
         (principal_id, actor_type, status, account_id, created_at)
       VALUES ($1, 'user', 'active', $2, now())`,
      [principalId, `a5-account-${suffix}`],
    );
    await pool.query(
      `INSERT INTO project_admin.projects
         (id, name, status, active, created_at, updated_at, revision)
       VALUES ($1, $1, 'ACTIVE', true, now(), now(), 1)`,
      [projectId],
    );
    await pool.query(
      `INSERT INTO auth.project_memberships
         (principal_id, project_id, scopes, sensitivity_clearance, is_owner)
       VALUES ($1, $2, ARRAY['owner'], 'private', true)`,
      [principalId, projectId],
    );

    const scope = {
      principalId,
      sessionId: `a5-session-${suffix}`,
      activeProject: {
        id: projectId,
        label: 'A5 Project',
        isOwner: true,
        sensitivityClearance: 'private' as const,
      },
      accessibleProjects: [
        {
          id: projectId,
          label: 'A5 Project',
          isOwner: true,
          sensitivityClearance: 'private' as const,
        },
      ],
      accessRevision: `a5-access-${suffix}`,
      policyContextRevision: `a5-policy-${suffix}`,
      executionAuthorities: {
        [projectId]: {
          projectId,
          accessRevision: `a5-access-${suffix}`,
          policyContextRevision: `a5-policy-${suffix}`,
          accessScope: ['owner'],
          sensitivityClearance: 'private' as const,
        },
      },
    };
    const gateway = new PostgresFrontendCommandGateway(pool);
    const conversationRepository = new PostgresAskConversationRepository(pool);
    const projection = new PostgresAskWorkspaceProjection(pool);
    const coordinator = new AskCommandCoordinator(
      gateway,
      conversationRepository,
      projection,
      new PostgresAskSourceSelectionValidator(pool),
      { enqueue: async () => undefined },
    );
    const submission = await coordinator.submitQuestion({
      ...scope,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: `a5-request-${suffix}`,
        idempotencyKey: `a5-idempotency-${suffix}`,
        question: 'Pin this execution identity.',
        mode: 'CANONICAL_ONLY',
        sourceSelections: [],
      },
    });
    expect(submission.answerRun.state).toBe('QUEUED');

    const executionScope: AskExecutionScope = {
      principalId,
      projectId,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      sensitivityClearance: 'private',
      accessScope: ['owner'],
    };
    const repository = new PostgresAskAnswerExecutionRepository(pool, projection, {
      resolve: async () => undefined,
    });
    const executionPin: AIExecutionPin = {
      answerRunId: submission.answerRun.answerRunId,
      projectId,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      aiConfigurationRevision: 4,
      credentialId: 'credential-a5',
      credentialRevision: 2,
      initialProviderPolicyFingerprint: 'a5-policy-fingerprint',
      createdAt: '2026-08-12T00:00:00.000Z',
    };

    const first = await repository.claimInitial(
      executionScope,
      submission.answerRun.answerRunId,
      'a5-worker-1',
      executionPin,
    );
    expect(first?.attempt.executionPin).toEqual(executionPin);
    expect(
      await repository.readExecutionPin(executionScope, submission.answerRun.answerRunId),
    ).toEqual(executionPin);
    await expect(
      repository.createExecutionPinIfAbsent({
        scope: executionScope,
        answerRunId: submission.answerRun.answerRunId,
        executionPin: { ...executionPin, credentialRevision: 3 },
      }),
    ).rejects.toThrow('different AI execution identity');

    await repository.fail({
      scope: executionScope,
      answerRunId: submission.answerRun.answerRunId,
      attemptNumber: first!.attempt.attemptNumber,
      state: 'OUTCOME_UNKNOWN',
      failure: {
        code: 'OUTCOME_UNKNOWN',
        message: 'A5 persistence test outcome is unknown.',
        retryable: false,
        outcomeUnknown: true,
      },
      workerId: 'a5-worker-1',
    });
    const retry = await repository.retryAndClaim({
      scope: executionScope,
      answerRunId: submission.answerRun.answerRunId,
      mode: 'SAME_CONTEXT',
      workerId: 'a5-worker-2',
    });
    expect(retry.attempt.executionPin).toEqual(executionPin);
    const exact = await repository.readExactAttemptIdentity({
      scope: executionScope,
      answerRunId: submission.answerRun.answerRunId,
      attemptId: retry.attempt.attemptId,
    });
    expect(exact).toMatchObject({
      kind: 'RETRY_SAME_CONTEXT',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      aiConfigurationRevision: 4,
      credentialId: 'credential-a5',
      credentialRevision: 2,
      initialProviderPolicyFingerprint: 'a5-policy-fingerprint',
    });

    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'frontend_ask'
         AND table_name IN ('answer_runs', 'answer_run_attempts')
         AND column_name LIKE '%credential%'
       ORDER BY table_name, column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain('credential_secret');
  });
});
