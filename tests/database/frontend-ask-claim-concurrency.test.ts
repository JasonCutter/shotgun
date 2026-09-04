import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-postgres/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  AskCommandCoordinator,
  type AskReadScope,
} from '../../modules/frontend-ask-write/src/index.js';
import type {
  AIExecutionPin,
  AskExecutionScope,
} from '../../modules/frontend-ask-execution/src/index.js';
import { ASK_SCHEMA_VERSION } from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool = createPostgresPool(databaseUrl);

type Fixture = {
  readonly projectId: string;
  readonly scope: AskReadScope;
  readonly executionScope: AskExecutionScope;
  readonly coordinator: AskCommandCoordinator;
  readonly repository: PostgresAskAnswerExecutionRepository;
  readonly projection: PostgresAskWorkspaceProjection;
};

const createFixture = async (): Promise<Fixture> => {
  const suffix = randomUUID();
  const principalId = `ask-claim-principal-${suffix}`;
  const projectId = `ask-claim-project-${suffix}`;
  await pool.query(
    `INSERT INTO auth.principals
       (principal_id, actor_type, status, account_id, created_at)
     VALUES ($1, 'user', 'active', $2, now())`,
    [principalId, `ask-claim-account-${suffix}`],
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
    sessionId: `ask-claim-session-${suffix}`,
    activeProject: {
      id: projectId,
      label: 'Ask Claim Project',
      isOwner: true,
      sensitivityClearance: 'private' as const,
    },
    accessibleProjects: [
      {
        id: projectId,
        label: 'Ask Claim Project',
        isOwner: true,
        sensitivityClearance: 'private' as const,
      },
    ],
    accessRevision: `ask-claim-access-${suffix}`,
    policyContextRevision: `ask-claim-policy-${suffix}`,
    executionAuthorities: {
      [projectId]: {
        projectId,
        accessRevision: `ask-claim-access-${suffix}`,
        policyContextRevision: `ask-claim-policy-${suffix}`,
        accessScope: ['owner'] as const,
        sensitivityClearance: 'private' as const,
      },
    },
  };
  const executionScope: AskExecutionScope = {
    principalId,
    projectId,
    accessRevision: scope.accessRevision,
    policyContextRevision: scope.policyContextRevision,
    sensitivityClearance: 'private',
    accessScope: ['owner'],
  };
  const projection = new PostgresAskWorkspaceProjection(pool);
  const coordinator = new AskCommandCoordinator(
    new PostgresFrontendCommandGateway(pool),
    new PostgresAskConversationRepository(pool),
    projection,
    new PostgresAskSourceSelectionValidator(pool),
    { enqueue: async () => undefined },
  );
  return {
    projectId,
    scope,
    executionScope,
    coordinator,
    projection,
    repository: new PostgresAskAnswerExecutionRepository(pool, projection, {
      resolve: async () => undefined,
    }),
  };
};

const enqueue = async (fixture: Fixture, index: number): Promise<string> => {
  const result = await fixture.coordinator.submitQuestion({
    ...fixture.scope,
    request: {
      schemaVersion: ASK_SCHEMA_VERSION,
      clientRequestId: `ask-claim-request-${randomUUID()}`,
      idempotencyKey: `ask-claim-idempotency-${randomUUID()}`,
      question: `Queued claim ${index}`,
      mode: 'CANONICAL_ONLY',
      sourceSelections: [],
    },
  });
  return result.answerRun.answerRunId;
};

const pinFor = (scope: AskExecutionScope, answerRunId: string): AIExecutionPin => ({
  answerRunId,
  projectId: scope.projectId,
  providerId: 'test-provider',
  modelId: 'test-model',
  aiConfigurationRevision: 1,
  credentialId: 'test-credential',
  credentialRevision: 1,
  initialProviderPolicyFingerprint: 'test-policy',
  createdAt: new Date().toISOString(),
});

describe('Ask queued atomic multi-worker claim PostgreSQL verification', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('claims 64 queued runs exactly once across two concurrent workers', async () => {
    const fixture = await createFixture();
    const runIds = await Promise.all(
      Array.from({ length: 64 }, (_, index) => enqueue(fixture, index)),
    );
    const resolveInitialIdentity = async ({
      scope,
      answerRunId,
    }: {
      readonly scope: AskExecutionScope;
      readonly answerRunId: string;
    }): Promise<AIExecutionPin> => pinFor(scope, answerRunId);

    const [first, second] = await Promise.all([
      fixture.repository.claimQueuedForWorker('ask-claim-worker-a', 32, resolveInitialIdentity),
      fixture.repository.claimQueuedForWorker('ask-claim-worker-b', 32, resolveInitialIdentity),
    ]);
    const firstIds = first.map(({ claimed }) => claimed.context.snapshot.answerRunId);
    const secondIds = second.map(({ claimed }) => claimed.context.snapshot.answerRunId);
    const claimedIds = new Set([...firstIds, ...secondIds]);

    expect(firstIds).toHaveLength(32);
    expect(secondIds).toHaveLength(32);
    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(claimedIds).toEqual(new Set(runIds));

    const states = await pool.query<{ readonly state: string; readonly count: string }>(
      `SELECT state, count(*)::text AS count
       FROM frontend_ask.answer_runs
       WHERE project_id = $1 AND answer_run_id = ANY($2::text[])
       GROUP BY state`,
      [fixture.projectId, runIds],
    );
    expect(states.rows).toEqual([{ state: 'RUNNING', count: '64' }]);

    const plan = await pool.query<{ readonly 'QUERY PLAN': string }>(
      `EXPLAIN (COSTS OFF)
       SELECT answer_run_id
       FROM frontend_ask.answer_runs
       WHERE state = 'QUEUED'
       ORDER BY created_at, answer_run_id
       LIMIT 32
       FOR UPDATE SKIP LOCKED`,
    );
    expect(plan.rows.map((row) => row['QUERY PLAN'])).toContainEqual(
      expect.stringContaining('LockRows'),
    );
  });

  it('claims all 10 queued runs exactly once when two workers have capacity 32', async () => {
    const fixture = await createFixture();
    const runIds: string[] = [];
    for (let index = 0; index < 10; index += 1) runIds.push(await enqueue(fixture, index));
    const resolveInitialIdentity = async ({
      scope,
      answerRunId,
    }: {
      readonly scope: AskExecutionScope;
      readonly answerRunId: string;
    }): Promise<AIExecutionPin> => pinFor(scope, answerRunId);

    const [first, second] = await Promise.all([
      fixture.repository.claimQueuedForWorker('ask-claim-worker-10-a', 32, resolveInitialIdentity),
      fixture.repository.claimQueuedForWorker('ask-claim-worker-10-b', 32, resolveInitialIdentity),
    ]);
    const firstIds = first.map(({ claimed }) => claimed.context.snapshot.answerRunId);
    const secondIds = second.map(({ claimed }) => claimed.context.snapshot.answerRunId);

    expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
    expect(new Set([...firstIds, ...secondIds])).toEqual(new Set(runIds));
    expect(firstIds.length + secondIds.length).toBe(10);
  });

  it('continues to later FIFO candidates when the first pin validation fails', async () => {
    const fixture = await createFixture();
    const runIds: string[] = [];
    for (let index = 0; index < 3; index += 1) runIds.push(await enqueue(fixture, index));
    const resolveInitialIdentity = async ({
      scope,
      answerRunId,
    }: {
      readonly scope: AskExecutionScope;
      readonly answerRunId: string;
    }): Promise<AIExecutionPin> => {
      if (answerRunId === runIds[0]) {
        return { ...pinFor(scope, answerRunId), answerRunId: 'wrong-answer-run' };
      }
      return pinFor(scope, answerRunId);
    };

    const claimed = await fixture.repository.claimQueuedForWorker(
      'ask-claim-worker-failure',
      3,
      resolveInitialIdentity,
    );
    expect(claimed.map(({ claimed: execution }) => execution.context.snapshot.answerRunId)).toEqual(
      runIds.slice(1),
    );

    const states = await pool.query<{ readonly answer_run_id: string; readonly state: string }>(
      `SELECT answer_run_id, state
       FROM frontend_ask.answer_runs
       WHERE project_id = $1 AND answer_run_id = ANY($2::text[])
       ORDER BY created_at, answer_run_id`,
      [fixture.projectId, runIds],
    );
    expect(states.rows).toEqual([
      { answer_run_id: runIds[0], state: 'QUEUED' },
      { answer_run_id: runIds[1], state: 'RUNNING' },
      { answer_run_id: runIds[2], state: 'RUNNING' },
    ]);
  });
});
