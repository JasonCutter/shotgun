import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import { StructuredAskAnswerProviderAdapter } from '../../adapters/ai-provider-ask/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';
import { PostgresAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-postgres/src/index.js';
import {
  createPostgresPool,
  PostgresProjectAdministrationRepository,
} from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import { AskAnswerExecutionService } from '../../modules/frontend-ask-execution/src/index.js';
import { ASK_SCHEMA_VERSION, ShotgunError } from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for Ask PostgreSQL tests.');

const newRuntime = (pool: Pool) => {
  const gateway = new PostgresFrontendCommandGateway(pool);
  const repository = new PostgresAskConversationRepository(pool);
  const projection = new PostgresAskWorkspaceProjection(pool);
  const validator = new PostgresAskSourceSelectionValidator(pool);
  return {
    gateway,
    repository,
    projection,
    validator,
    coordinator: new AskCommandCoordinator(gateway, repository, projection, validator),
  };
};

describe('PostgreSQL Ask write and recovery boundary', () => {
  let pool: Pool | undefined;

  afterAll(async () => {
    await pool?.end();
  });

  it('commits aggregate and outcome atomically, recovers after restart, and serializes follow-ups', async () => {
    pool = createPostgresPool(databaseUrl);
    const suffix = randomUUID();
    const accountId = `ask-db-owner-${suffix}`;
    const projectId = `ask-db-project-${suffix}`;
    const auth = new PostgresAuthRepository(pool);
    const projectRepository = new PostgresProjectAdministrationRepository(pool);
    const principal = await auth.bootstrapLocalOwnerPrincipal({ accountId });

    await projectRepository.createProject({
      commandId: `ask-db-project-command-${suffix}`,
      clientRequestId: `ask-db-project-request-${suffix}`,
      idempotencyKey: `ask-db-project-idempotency-${suffix}`,
      projectId,
      name: 'Ask Database Boundary',
      description: 'PostgreSQL Ask write and recovery verification fixture',
      actorPrincipalId: principal.principalId,
      expectedProjectRevision: 0,
    });
    await auth.createProjectOwnerMembership({
      principalId: principal.principalId,
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });

    const scope = {
      principalId: principal.principalId,
      sessionId: `ask-db-session-${suffix}`,
      activeProject: {
        id: projectId,
        label: 'Ask Database Boundary',
        isOwner: true,
        sensitivityClearance: 'private' as const,
      },
      accessibleProjects: [
        {
          id: projectId,
          label: 'Ask Database Boundary',
          isOwner: true,
          sensitivityClearance: 'private' as const,
        },
      ],
      accessRevision: `ask-db-access-${suffix}`,
      policyContextRevision: `ask-db-policy-${suffix}`,
    };

    const firstRequest = {
      schemaVersion: ASK_SCHEMA_VERSION,
      clientRequestId: `ask-db-first-request-${suffix}`,
      idempotencyKey: `ask-db-first-idempotency-${suffix}`,
      question: 'Persist this Ask Conversation.',
      mode: 'CANONICAL_ONLY' as const,
      sourceSelections: [],
    };
    const firstRuntime = newRuntime(pool);
    const first = await firstRuntime.coordinator.submitQuestion({
      ...scope,
      request: firstRequest,
    });
    expect(first.answerRun).toMatchObject({
      state: 'ACTION_REQUIRED',
      attentionReason: 'MODEL_EXECUTION_NOT_CONFIGURED',
      projectId,
    });

    const ledger = await pool.query<{
      readonly outcome_state: string;
      readonly produced_resources: readonly { readonly resourceKind: string }[];
    }>(
      `SELECT outcome_state, produced_resources
       FROM frontend_command.command_ledger
       WHERE principal_id = $1 AND client_request_id = $2`,
      [scope.principalId, firstRequest.clientRequestId],
    );
    expect(ledger.rows[0]?.outcome_state).toBe('COMPLETED');
    expect(ledger.rows[0]?.produced_resources).toHaveLength(4);

    await pool.end();
    pool = createPostgresPool(databaseUrl);
    const restartedRuntime = newRuntime(pool);
    const recovered = await restartedRuntime.coordinator.getQuestionSubmissionByClientRequestId({
      ...scope,
      clientRequestId: firstRequest.clientRequestId,
    });
    expect(recovered).toMatchObject({
      outcomeState: 'COMPLETED',
      conversationId: first.answerRun.conversationId,
      branchId: first.answerRun.branchId,
      turnId: first.answerRun.turnId,
      answerRunId: first.answerRun.answerRunId,
    });

    const recoveredConversation = await restartedRuntime.projection.getConversation({
      ...scope,
      conversationId: first.answerRun.conversationId,
    });
    const recoveredBranch = recoveredConversation.branches[0]!;
    expect(recoveredBranch.turns).toHaveLength(1);

    const followUp = await restartedRuntime.coordinator.submitQuestion({
      ...scope,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: `ask-db-follow-up-request-${suffix}`,
        idempotencyKey: `ask-db-follow-up-idempotency-${suffix}`,
        conversationId: recoveredConversation.conversationId,
        branchId: recoveredBranch.branchId,
        expectedConversationRevision: recoveredConversation.conversationRevision,
        expectedBranchRevision: recoveredBranch.branchRevision!,
        question: 'Append a durable follow-up.',
        sourceSelections: [],
      },
    });
    expect(followUp.workspace.selectedConversation?.branches[0]?.turns).toHaveLength(2);

    await expect(
      restartedRuntime.coordinator.submitQuestion({
        ...scope,
        request: {
          schemaVersion: ASK_SCHEMA_VERSION,
          clientRequestId: `ask-db-stale-request-${suffix}`,
          idempotencyKey: `ask-db-stale-idempotency-${suffix}`,
          conversationId: recoveredConversation.conversationId,
          branchId: recoveredBranch.branchId,
          expectedConversationRevision: recoveredConversation.conversationRevision,
          expectedBranchRevision: recoveredBranch.branchRevision!,
          question: 'This stale follow-up must not write.',
          sourceSelections: [],
        },
      }),
    ).rejects.toBeInstanceOf(ShotgunError);

    const concurrentBase = await restartedRuntime.projection.getConversation({
      ...scope,
      conversationId: recoveredConversation.conversationId,
    });
    const concurrentBranch = concurrentBase.branches[0]!;
    const concurrent = await Promise.allSettled(
      ['A', 'B'].map((label) =>
        restartedRuntime.coordinator.submitQuestion({
          ...scope,
          request: {
            schemaVersion: ASK_SCHEMA_VERSION,
            clientRequestId: `ask-db-concurrent-${label}-request-${suffix}`,
            idempotencyKey: `ask-db-concurrent-${label}-idempotency-${suffix}`,
            conversationId: concurrentBase.conversationId,
            branchId: concurrentBranch.branchId,
            expectedConversationRevision: concurrentBase.conversationRevision,
            expectedBranchRevision: concurrentBranch.branchRevision!,
            question: `Concurrent follow-up ${label}`,
            sourceSelections: [],
          },
        }),
      ),
    );
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const finalConversation = await restartedRuntime.projection.getConversation({
      ...scope,
      conversationId: concurrentBase.conversationId,
    });
    expect(finalConversation.branches[0]?.turns.map((turn) => turn.ordinal)).toEqual([1, 2, 3]);

    const executionScope = {
      principalId: scope.principalId,
      projectId,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      sensitivityClearance: 'private' as const,
    };
    const executionRepository = new PostgresAskAnswerExecutionRepository(
      pool,
      restartedRuntime.projection,
    );
    const executionService = new AskAnswerExecutionService(
      executionRepository,
      new StructuredAskAnswerProviderAdapter(new FakeAIProviderAdapter()),
    );
    const stopExecutionWorker = await executionService.startWorker(10);
    const executionCoordinator = new AskCommandCoordinator(
      restartedRuntime.gateway,
      restartedRuntime.repository,
      restartedRuntime.projection,
      restartedRuntime.validator,
      executionService,
    );
    const executionSubmission = await executionCoordinator.submitQuestion({
      ...scope,
      request: {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: `ask-db-execution-request-${suffix}`,
        idempotencyKey: `ask-db-execution-idempotency-${suffix}`,
        question: 'Execute a durable Ask answer.',
        mode: 'CANONICAL_ONLY',
        sourceSelections: [],
      },
    });
    let executed = executionSubmission.answerRun;
    for (let attempt = 0; attempt < 20 && executed.state !== 'SUCCEEDED'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      executed = await restartedRuntime.projection.getAnswerRun({
        ...scope,
        answerRunId: executionSubmission.answerRun.answerRunId,
      });
    }
    expect(executed.state).toBe('SUCCEEDED');
    stopExecutionWorker();
    const events = await executionService.events(
      executionScope,
      executionSubmission.answerRun.answerRunId,
    );
    expect(events.map((event) => event.kind)).toContain('COMPLETED');
    const exported = await executionService.export(
      executionScope,
      executionSubmission.answerRun.answerRunId,
      'JSON',
      `ask-db-export-${suffix}`,
    );
    const feedback = await executionService.feedback(
      executionScope,
      executionSubmission.answerRun.answerRunId,
      'HELPFUL',
      undefined,
      `ask-db-feedback-${suffix}`,
    );
    const seed = await executionService.transitionSeed(
      executionScope,
      executionSubmission.answerRun.answerRunId,
      'DRAFT_CHANGE_SET',
      `ask-db-seed-${suffix}`,
    );
    expect(exported.answerRunId).toBe(executionSubmission.answerRun.answerRunId);
    expect(feedback.answerRunId).toBe(executionSubmission.answerRun.answerRunId);
    expect(seed.state).toBe('PROPOSED');
  });
});
