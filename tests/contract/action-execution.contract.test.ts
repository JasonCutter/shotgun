import { describe, expect, it } from 'vitest';

import { FakeDraftActionConnector } from '../../adapters/action-connector-fake/src/index.js';
import {
  InMemoryActionCandidateRepository,
  InMemoryActionExecutionRepository,
} from '../../adapters/stage11-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import type {
  ActionAuditEvent,
  ActionExecutionRecord,
} from '../../packages/contracts/src/index.js';
import { actionEvidenceSetDigest, ShotgunError } from '../../packages/contracts/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import {
  actionFeedbackStatusForExecution,
  createActionExecutionModule,
  createActionFeedbackIntent,
  dispatchActionFeedbackOutbox,
  runActionFeedbackOutboxRecovery,
  type ActionExecutionRepositoryPort,
  type ActionFeedbackOutboxRecord,
  type ActionFeedbackOutboxRecoveryConnector,
  type ActionBindingReference,
} from '../../modules/action-execution/src/index.js';
import {
  actionAuditQuery,
  actionServerCandidate,
  approveActionCommand,
  executeActionCommand,
  prepareActionCommand,
  reconcileExecutingActionCommand,
  verifyActionCommand,
} from '../helpers/stage-11.js';

const harness = async (
  connector = new FakeDraftActionConnector(),
  clock = { now: () => '2026-07-17T10:00:00.000Z' },
  repository: ActionExecutionRepositoryPort = new InMemoryActionExecutionRepository(),
) => {
  const candidates = new InMemoryActionCandidateRepository();
  const independentVerification = {
    getValidationDigest: async (p: string, c: string) =>
      (await candidates.find(p, c))?.validationDigest,
    getEvidenceSetDigest: async (p: string, c: string) => {
      const cand = await candidates.find(p, c);
      return cand ? actionEvidenceSetDigest(cand.evidence) : undefined;
    },
    getSourceSensitivity: async (p: string, c: string) =>
      (await candidates.find(p, c))?.sourceSensitivity,
    resolveCurrentBinding: async (req: ActionBindingReference) => {
      const cand = await candidates.find(req.projectId, req.actionCandidateId);
      if (!cand) return undefined;
      return {
        validation: {
          validationId: cand.candidate.validation.validationId,
          candidateId: cand.candidate.candidateId,
          revisionNumber: cand.candidate.revisionNumber,
          sourceVersionId: 's1',
          status: 'READY',
          digest: cand.validationDigest,
        },
        evidence: cand.evidence.map((e) => ({
          evidenceId: e.evidenceId,
          sourceId: 'src1',
          sourceVersionId: 's1',
          exactHash: '0000',
          sensitivity: cand.sourceSensitivity,
          digest: e.digest,
        })),
        evidenceSetDigest: actionEvidenceSetDigest(cand.evidence),
        sourceVersionId: 's1',
        sourceSensitivity: cand.sourceSensitivity,
      };
    },
  };
  const kernel = new ShotgunKernel(new InProcessTransport());
  kernel.register(
    createActionExecutionModule(repository, candidates, independentVerification, connector, clock),
  );
  await kernel.start();
  return { kernel, candidates, repository, connector };
};

const prepareAndApprove = async (app: Awaited<ReturnType<typeof harness>>, suffix: string) => {
  const candidate = actionServerCandidate(suffix);
  await app.candidates.stage(candidate);
  const preview = (
    await app.kernel.connector.sendCommand<ActionExecutionRecord>(prepareActionCommand(candidate))
  ).result;
  return (
    await app.kernel.connector.sendCommand<ActionExecutionRecord>(
      approveActionCommand(preview.actionId, preview.preview.previewDigest),
    )
  ).result;
};

const feedbackOutboxFixture = (
  projectId: string,
  actionId: string,
): ActionFeedbackOutboxRecord => ({
  outboxId: `outbox:${projectId}:${actionId}`,
  projectId,
  actionId,
  semanticKey: `action-feedback:${actionId}:FAILED`,
  status: 'pending',
  feedbackStatus: 'FAILED',
  reentryPhase: 'ACTION_REVIEW',
  schemaVersion: '1.0.0',
  payload: {
    actionId,
    status: 'FAILED',
    reentryPhase: 'ACTION_REVIEW',
    occurredAt: '2026-07-17T10:00:00.000Z',
  },
  occurredAt: '2026-07-17T10:00:00.000Z',
  sourceUpdatedAt: '2026-07-17T10:00:00.000Z',
  attempts: 0,
  availableAt: '2026-07-17T10:00:00.000Z',
});

const outboxFixtureRepository = (initial: readonly ActionFeedbackOutboxRecord[]) => {
  const rows = new Map(initial.map((record) => [record.outboxId, record]));
  const releases: string[] = [];
  return {
    releases,
    async listFeedbackOutboxProjectIds() {
      return [...new Set([...rows.values()].map((row) => row.projectId))];
    },
    async findFeedbackOutbox(projectId: string, semanticKey: string) {
      const row = [...rows.values()].find(
        (candidate) => candidate.projectId === projectId && candidate.semanticKey === semanticKey,
      );
      return row ? structuredClone(row) : undefined;
    },
    async claimFeedbackOutbox(projectId: string, _semanticKey: string | undefined, limit: number) {
      return [...rows.values()]
        .filter((row) => row.projectId === projectId && row.status === 'pending')
        .slice(0, limit)
        .map((row) => {
          const claimed = { ...row, status: 'processing' as const, attempts: row.attempts + 1 };
          rows.set(row.outboxId, claimed);
          return structuredClone(claimed);
        });
    },
    async markFeedbackOutboxPublished(
      _projectId: string,
      outboxId: string,
      _attempt: number,
      publishedAt: string,
    ) {
      void _attempt;
      const row = rows.get(outboxId);
      if (row) rows.set(outboxId, { ...row, status: 'published', publishedAt });
    },
    async releaseFeedbackOutbox(
      _projectId: string,
      outboxId: string,
      _attempt: number,
      _error: string,
    ) {
      void _attempt;
      void _error;
      releases.push(outboxId);
      const row = rows.get(outboxId);
      if (row) rows.set(outboxId, { ...row, status: 'pending' });
    },
    async backfillFeedbackOutbox() {
      return 0;
    },
    row(outboxId: string) {
      return rows.get(outboxId);
    },
  };
};

describe('Stage 12.1 P0-2 server-bound Action contracts', () => {
  it('maps only feedback-producing terminal states and excludes PREFLIGHT_FAILED', () => {
    expect(actionFeedbackStatusForExecution('VERIFIED')).toBe('VERIFIED');
    expect(actionFeedbackStatusForExecution('OUTCOME_UNKNOWN')).toBe('OUTCOME_UNKNOWN');
    expect(actionFeedbackStatusForExecution('FAILED')).toBe('FAILED');
    expect(actionFeedbackStatusForExecution('VERIFICATION_FAILED')).toBe('FAILED');
    expect(actionFeedbackStatusForExecution('PREFLIGHT_FAILED')).toBeUndefined();
  });

  it('persists and dispatches one deterministic feedback outbox record with ACK-loss retry', async () => {
    const app = await harness();
    const approved = await prepareAndApprove(app, 'feedback-outbox');
    const claimed = await app.repository.claimForExecution(
      approved.projectId,
      approved.approval!.approvalId,
      '2026-07-17T10:01:00.000Z',
      'worker',
    );
    const failed = {
      ...claimed.record,
      status: 'FAILED' as const,
      failureReason: 'provider failure',
      updatedAt: '2026-07-17T10:02:00.000Z',
    };
    await app.repository.transition(approved.projectId, approved.actionId, {
      expectedStatus: 'EXECUTING',
      next: failed,
      category: 'ACTION_FAILED',
      actorId: 'worker',
      details: { automaticRetry: false },
      feedbackIntent: createActionFeedbackIntent(failed),
    });
    const semanticKey = `action-feedback:${approved.actionId}:FAILED`;
    const pending = await app.repository.findFeedbackOutbox(approved.projectId, semanticKey);
    expect(pending).toMatchObject({
      semanticKey,
      feedbackStatus: 'FAILED',
      status: 'pending',
      attempts: 0,
      payload: {
        actionId: approved.actionId,
        status: 'FAILED',
        reentryPhase: 'ACTION_REVIEW',
      },
    });

    const attemptedKeys: string[] = [];
    await expect(
      dispatchActionFeedbackOutbox(
        app.repository,
        {
          publish: async (event) => {
            attemptedKeys.push(event.idempotencyKey!);
            throw new ShotgunError({
              code: 'OUTCOME_UNKNOWN',
              safeMessage: 'publication ACK was lost',
              module: 'test',
              operation: 'publish',
            });
          },
        },
        approved.projectId,
        1,
        '2026-07-17T10:03:00.000Z',
      ),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await dispatchActionFeedbackOutbox(
      app.repository,
      {
        publish: async (event) => {
          attemptedKeys.push(event.idempotencyKey!);
        },
      },
      approved.projectId,
      1,
      '2026-07-17T10:04:00.000Z',
    );
    expect(attemptedKeys).toEqual([semanticKey, semanticKey]);
    expect(await app.repository.findFeedbackOutbox(approved.projectId, semanticKey)).toMatchObject({
      status: 'published',
      attempts: 2,
    });
    await app.kernel.shutdown();
  });

  it('keeps VERIFIED and FAILED verification feedback distinct and excludes preflight failure', async () => {
    const app = await harness();
    const approved = await prepareAndApprove(app, 'feedback-statuses');
    const claimed = await app.repository.claimForExecution(
      approved.projectId,
      approved.approval!.approvalId,
      '2026-07-17T10:01:00.000Z',
      'worker',
    );
    const verificationFailed = {
      ...claimed.record,
      status: 'VERIFICATION_FAILED' as const,
      updatedAt: '2026-07-17T10:02:00.000Z',
    };
    const verified = {
      ...verificationFailed,
      status: 'VERIFIED' as const,
      updatedAt: '2026-07-17T10:03:00.000Z',
    };
    await app.repository.transition(approved.projectId, approved.actionId, {
      expectedStatus: 'EXECUTING',
      next: verificationFailed,
      category: 'ACTION_VERIFICATION_FAILED',
      actorId: 'worker',
      details: { verificationStatus: 'MISMATCH' },
      feedbackIntent: createActionFeedbackIntent(verificationFailed),
    });
    await app.repository.transition(approved.projectId, approved.actionId, {
      expectedStatus: 'VERIFICATION_FAILED',
      next: verified,
      category: 'ACTION_VERIFIED',
      actorId: 'worker',
      details: { verificationStatus: 'APPLIED' },
      feedbackIntent: createActionFeedbackIntent(verified),
    });
    expect(
      await app.repository.findFeedbackOutbox(
        approved.projectId,
        `action-feedback:${approved.actionId}:FAILED`,
      ),
    ).toMatchObject({ feedbackStatus: 'FAILED' });
    expect(
      await app.repository.findFeedbackOutbox(
        approved.projectId,
        `action-feedback:${approved.actionId}:VERIFIED`,
      ),
    ).toMatchObject({ feedbackStatus: 'VERIFIED' });
    const preflight = {
      ...verified,
      status: 'PREFLIGHT_FAILED' as const,
      updatedAt: '2026-07-17T10:04:00.000Z',
    };
    expect(createActionFeedbackIntent(preflight)).toBeUndefined();
    await app.kernel.shutdown();
  });

  it('backfills historical feedback categories additively and is repeat-safe', async () => {
    const app = await harness();
    const approved = await prepareAndApprove(app, 'feedback-backfill');
    const claimed = await app.repository.claimForExecution(
      approved.projectId,
      approved.approval!.approvalId,
      '2026-07-17T10:01:00.000Z',
      'worker',
    );
    const transitions = [
      ['FAILED', 'ACTION_FAILED', '2026-07-17T10:02:00.000Z'],
      ['OUTCOME_UNKNOWN', 'ACTION_OUTCOME_UNKNOWN', '2026-07-17T10:03:00.000Z'],
      ['VERIFICATION_FAILED', 'ACTION_VERIFICATION_FAILED', '2026-07-17T10:04:00.000Z'],
      ['VERIFIED', 'ACTION_VERIFIED', '2026-07-17T10:05:00.000Z'],
    ] as const;
    let current = claimed.record;
    for (const [status, category, updatedAt] of transitions) {
      current = await app.repository.transition(approved.projectId, approved.actionId, {
        expectedStatus: current.status,
        next: { ...current, status, updatedAt },
        category,
        actorId: 'worker',
        details: { historical: true },
      });
    }
    expect(await app.repository.backfillFeedbackOutbox(100, '2026-07-17T10:06:00.000Z')).toBe(3);
    expect(await app.repository.backfillFeedbackOutbox(100, '2026-07-17T10:07:00.000Z')).toBe(0);
    await app.kernel.shutdown();
  });

  it('runs bounded feedback recovery through the existing command boundary without provider calls', async () => {
    const app = await harness(new FakeDraftActionConnector(), {
      now: () => '2026-07-17T10:05:00.000Z',
    });
    const approved = await prepareAndApprove(app, 'feedback-recovery');
    const claimed = await app.repository.claimForExecution(
      approved.projectId,
      approved.approval!.approvalId,
      '2026-07-17T10:03:00.000Z',
      'worker',
    );
    const failed = {
      ...claimed.record,
      status: 'FAILED' as const,
      failureReason: 'provider failure',
      updatedAt: '2026-07-17T10:04:00.000Z',
    };
    await app.repository.transition(approved.projectId, approved.actionId, {
      expectedStatus: 'EXECUTING',
      next: failed,
      category: 'ACTION_FAILED',
      actorId: 'worker',
      details: { automaticRetry: false },
      feedbackIntent: createActionFeedbackIntent(failed),
    });

    expect(
      await runActionFeedbackOutboxRecovery(app.repository, app.kernel.connector, {
        batchSize: 1,
      }),
    ).toBe(1);
    expect(
      await app.repository.findFeedbackOutbox(
        approved.projectId,
        `action-feedback:${approved.actionId}:FAILED`,
      ),
    ).toMatchObject({ status: 'published', attempts: 1 });
    expect(app.connector.calls).toEqual({ preflight: 0, execute: 0, verify: 0 });
    await app.kernel.shutdown();
  });

  it('isolates a poison row while allowing later healthy rows in the same batch to progress', async () => {
    const poison = feedbackOutboxFixture('project-a', 'poison');
    const healthy = feedbackOutboxFixture('project-a', 'healthy');
    const repository = outboxFixtureRepository([poison, healthy]);
    const attempted: string[] = [];

    await expect(
      dispatchActionFeedbackOutbox(
        repository,
        {
          publish: async (event) => {
            attempted.push(event.idempotencyKey);
            if (event.idempotencyKey === poison.semanticKey) {
              throw new ShotgunError({
                code: 'RETRYABLE_DEPENDENCY',
                safeMessage: 'Poison consumer is unavailable.',
                module: 'test',
                operation: 'publish-feedback',
                retryable: true,
              });
            }
          },
        },
        'project-a',
        2,
        '2026-07-17T10:01:00.000Z',
      ),
    ).rejects.toMatchObject({ code: 'RETRYABLE_DEPENDENCY' });

    expect(attempted).toEqual([healthy.semanticKey, poison.semanticKey]);
    expect(repository.releases).toEqual([poison.outboxId]);
    expect(repository.row(healthy.outboxId)?.status).toBe('published');
  });

  it('stops producer redispatch after an accepted required-consumer dead-letter', async () => {
    const row = feedbackOutboxFixture('project-a', 'governed-dlq');
    const repository = outboxFixtureRepository([row]);
    let publications = 0;
    const context = {
      publish: async () => undefined,
      publishWithOutcome: async () => {
        publications += 1;
        return { requiredConsumerDeadLetter: true };
      },
    };

    expect(
      await dispatchActionFeedbackOutbox(
        repository,
        context,
        'project-a',
        1,
        '2026-07-17T10:01:00.000Z',
      ),
    ).toBe(1);
    expect(repository.row(row.outboxId)?.status).toBe('published');
    expect(
      await dispatchActionFeedbackOutbox(
        repository,
        context,
        'project-a',
        1,
        '2026-07-17T10:02:00.000Z',
      ),
    ).toBe(0);
    expect(publications).toBe(1);
  });

  it('continues recovery across projects after one project fails', async () => {
    const repository = outboxFixtureRepository([
      feedbackOutboxFixture('project-a', 'failure'),
      feedbackOutboxFixture('project-b', 'healthy'),
    ]);
    const projects: string[] = [];
    await expect(
      runActionFeedbackOutboxRecovery(repository, {
        async sendCommand<TPayload>(
          command: Parameters<ActionFeedbackOutboxRecoveryConnector['sendCommand']>[0],
        ) {
          projects.push(command.projectId!);
          if (command.projectId === 'project-a') {
            throw new ShotgunError({
              code: 'RETRYABLE_DEPENDENCY',
              safeMessage: 'Project A is unavailable.',
              module: 'test',
              operation: 'dispatch-feedback',
            });
          }
          return { result: { published: 1 } as TPayload };
        },
      }),
    ).rejects.toMatchObject({ code: 'RETRYABLE_DEPENDENCY' });
    expect(projects).toEqual(['project-a', 'project-b']);
  });

  it('backfills unseen historical feedback beyond a small batch limit', async () => {
    const app = await harness();
    for (let index = 0; index < 5; index += 1) {
      const approved = await prepareAndApprove(app, `feedback-forward-${index}`);
      const claimed = await app.repository.claimForExecution(
        approved.projectId,
        approved.approval!.approvalId,
        `2026-07-17T10:0${index + 1}:00.000Z`,
        'worker',
      );
      await app.repository.transition(approved.projectId, approved.actionId, {
        expectedStatus: 'EXECUTING',
        next: {
          ...claimed.record,
          status: 'FAILED',
          updatedAt: `2026-07-17T10:1${index}:00.000Z`,
        },
        category: 'ACTION_FAILED',
        actorId: 'historical-worker',
        details: { historical: true },
      });
    }
    expect(await app.repository.backfillFeedbackOutbox(2, '2026-07-17T11:00:00.000Z')).toBe(2);
    expect(await app.repository.backfillFeedbackOutbox(2, '2026-07-17T11:01:00.000Z')).toBe(2);
    expect(await app.repository.backfillFeedbackOutbox(2, '2026-07-17T11:02:00.000Z')).toBe(1);
    expect(await app.repository.backfillFeedbackOutbox(2, '2026-07-17T11:03:00.000Z')).toBe(0);
    await app.kernel.shutdown();
  });

  it('uses only a stored Candidate, immutable Snapshot, server Approval Record, and approvalId execution', async () => {
    const secret = 'must-never-appear-in-action-records';
    const app = await harness(new FakeDraftActionConnector(secret));
    const approved = await prepareAndApprove(app, 'happy');
    expect(approved).toMatchObject({
      status: 'APPROVED',
      canonicalWrite: false,
      preview: {
        canonicalSerializer: 'action-preview-canonical-v1',
        approvalPolicy: { requiredApprovalCount: 1, selfApprovalAllowed: true },
        candidate: { operation: 'CREATE_DRAFT' },
      },
      approval: { snapshotDigest: approved.preview.previewDigest },
    });

    const completed = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        executeActionCommand(approved.approval!.approvalId),
      )
    ).result;
    expect(completed).toMatchObject({
      status: 'VERIFIED',
      providerResult: { provider: 'fake' },
      verification: { status: 'APPLIED' },
    });
    expect(app.connector.calls).toEqual({ preflight: 1, execute: 1, verify: 1 });
    const audit = (
      await app.kernel.connector.query<{ items: readonly ActionAuditEvent[] }>(
        actionAuditQuery(completed.actionId),
      )
    ).result.payload.items;
    const feedbackOutbox = await app.repository.findFeedbackOutbox(
      completed.projectId,
      `action-feedback:${completed.actionId}:VERIFIED`,
    );
    expect(audit.map((event) => event.category)).toEqual([
      'ACTION_CANDIDATE_VALIDATED',
      'ACTION_RISK_DECIDED',
      'ACTION_PREVIEW_READY',
      'ACTION_APPROVED',
      'ACTION_EXECUTION_CLAIMED',
      'ACTION_PREFLIGHT_PASSED',
      'ACTION_EXECUTED',
      'ACTION_VERIFIED',
    ]);
    expect(JSON.stringify({ completed, audit, connector: app.connector })).not.toContain(secret);
    expect(JSON.stringify(feedbackOutbox)).not.toContain(secret);
    await app.kernel.shutdown();
  });

  it('does not classify a PostgreSQL ACTION_EXECUTED ambiguity as a provider failure', async () => {
    const inner = new InMemoryActionExecutionRepository();
    const repository: ActionExecutionRepositoryPort = {
      createPreview: inner.createPreview.bind(inner),
      approve: inner.approve.bind(inner),
      claimForExecution: inner.claimForExecution.bind(inner),
      find: inner.find.bind(inner),
      listAudit: inner.listAudit.bind(inner),
      listFeedbackOutboxProjectIds: inner.listFeedbackOutboxProjectIds.bind(inner),
      findFeedbackOutbox: inner.findFeedbackOutbox.bind(inner),
      claimFeedbackOutbox: inner.claimFeedbackOutbox.bind(inner),
      markFeedbackOutboxPublished: inner.markFeedbackOutboxPublished.bind(inner),
      releaseFeedbackOutbox: inner.releaseFeedbackOutbox.bind(inner),
      backfillFeedbackOutbox: inner.backfillFeedbackOutbox.bind(inner),
      transition: async (projectId, actionId, transition) => {
        const persisted = await inner.transition(projectId, actionId, transition);
        if (transition.category === 'ACTION_EXECUTED')
          throw new ShotgunError({
            code: 'OUTCOME_UNKNOWN',
            safeMessage: 'The ACTION_EXECUTED database outcome could not be proven.',
            module: 'postgres-stage11',
            operation: 'transition-action',
          });
        return persisted;
      },
    };
    const app = await harness(new FakeDraftActionConnector(), undefined, repository);
    const approved = await prepareAndApprove(app, 'db-ambiguity');

    await expect(
      app.kernel.connector.sendCommand(executeActionCommand(approved.approval!.approvalId)),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    expect(app.connector.calls.execute).toBe(1);
    expect((await app.repository.find(approved.projectId, approved.actionId))?.status).toBe(
      'EXECUTED',
    );
    const audit = await app.repository.listAudit(approved.projectId, approved.actionId);
    expect(audit.map((event) => event.category)).not.toContain('ACTION_FAILED');
    expect(audit.map((event) => event.category)).not.toContain('ACTION_OUTCOME_UNKNOWN');
    await app.kernel.shutdown();
  });

  it('rejects stale Snapshot state and lets a service worker, not a user, perform explicit verification', async () => {
    const now = '2026-07-17T10:00:00.000Z';
    const app = await harness(
      new FakeDraftActionConnector('secret', {
        preflight: 'ready',
        execute: 'unknown-after-effect',
      }),
      { now: () => now },
    );
    const approved = await prepareAndApprove(app, 'stale');
    const changed = actionServerCandidate('stale', {
      candidate: { ...actionServerCandidate('stale').candidate, revisionNumber: 2 },
    });
    await app.candidates.stage(changed);
    await expect(
      app.kernel.connector.sendCommand(executeActionCommand(approved.approval!.approvalId)),
    ).rejects.toMatchObject({ code: 'STALE_ACTION_SNAPSHOT' });
    expect(app.connector.calls.execute).toBe(0);

    const second = await prepareAndApprove(app, 'unknown');
    const unknown = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        executeActionCommand(second.approval!.approvalId),
      )
    ).result;
    expect(unknown.status).toBe('OUTCOME_UNKNOWN');
    await expect(
      app.kernel.connector.sendCommand({
        ...verifyActionCommand(unknown.actionId),
        actor: { type: 'user', id: 'owner' },
      }),
    ).rejects.toMatchObject({ code: 'ACTION_AUTHORIZATION_DENIED' });
    const verified = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        verifyActionCommand(unknown.actionId),
      )
    ).result;
    expect(verified.status).toBe('VERIFIED');
    await app.kernel.shutdown();
  });

  it('atomically claims a single external execution for concurrent Execute requests', async () => {
    const app = await harness();
    const approved = await prepareAndApprove(app, 'concurrent');
    const [first, second] = await Promise.all([
      app.kernel.connector.sendCommand<ActionExecutionRecord>(
        executeActionCommand(approved.approval!.approvalId, 'a'),
      ),
      app.kernel.connector.sendCommand<ActionExecutionRecord>(
        executeActionCommand(approved.approval!.approvalId, 'b'),
      ),
    ]);
    expect(app.connector.calls.execute).toBe(1);
    expect([first.result.status, second.result.status]).toContain('VERIFIED');
    await app.kernel.shutdown();
  });

  it('reconciles EXECUTING without invoking the connector and guards the exact timestamp', async () => {
    const app = await harness();
    const approved = await prepareAndApprove(app, 'reconcile');
    const claimed = await app.repository.claimForExecution(
      approved.projectId,
      approved.approval!.approvalId,
      '2026-07-17T10:01:00.000Z',
      'owner',
    );
    expect(claimed.record.status).toBe('EXECUTING');
    const expectedUpdatedAt = claimed.record.updatedAt;
    const feedbackBefore = app.kernel.connector.traces
      .list()
      .filter((record) => record.messageType === 'ActionFeedbackRecorded').length;

    await expect(
      app.kernel.connector.sendCommand(
        reconcileExecutingActionCommand(approved.actionId, '2026-07-17T10:00:59.000Z', 'stale'),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await app.repository.find(approved.projectId, approved.actionId))?.status).toBe(
      'EXECUTING',
    );
    expect(
      (await app.repository.listAudit(approved.projectId, approved.actionId)).filter(
        (event) => event.category === 'ACTION_OUTCOME_UNKNOWN',
      ),
    ).toHaveLength(0);

    const reconciled = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        reconcileExecutingActionCommand(approved.actionId, expectedUpdatedAt),
      )
    ).result;
    expect(reconciled).toMatchObject({
      actionId: approved.actionId,
      projectId: approved.projectId,
      status: 'OUTCOME_UNKNOWN',
      preview: approved.preview,
      approval: approved.approval,
      failureReason:
        'Execution was interrupted before a durable provider outcome was established. Automatic execution retry is forbidden.',
    });
    expect(app.connector.calls).toEqual({ preflight: 0, execute: 0, verify: 0 });
    const audit = await app.repository.listAudit(approved.projectId, approved.actionId);
    expect(audit.filter((event) => event.category === 'ACTION_OUTCOME_UNKNOWN')).toHaveLength(1);
    expect(audit.at(-1)?.details).toMatchObject({
      automaticRetry: false,
      reconciliation: 'orphaned-executing',
      expectedUpdatedAt,
    });
    const feedbackAfterFirst = app.kernel.connector.traces
      .list()
      .filter((record) => record.messageType === 'ActionFeedbackRecorded').length;
    expect(feedbackAfterFirst).toBe(feedbackBefore + 1);

    const replayed = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        reconcileExecutingActionCommand(approved.actionId, expectedUpdatedAt, 'replay'),
      )
    ).result;
    expect(replayed).toEqual(reconciled);
    expect(
      (await app.repository.listAudit(approved.projectId, approved.actionId)).filter(
        (event) => event.category === 'ACTION_OUTCOME_UNKNOWN',
      ),
    ).toHaveLength(1);
    expect(
      app.kernel.connector.traces
        .list()
        .filter((record) => record.messageType === 'ActionFeedbackRecorded'),
    ).toHaveLength(feedbackAfterFirst);
    await app.kernel.shutdown();
  });

  it('rejects reconciliation for non-EXECUTING states and unauthorized system actors', async () => {
    const app = await harness();
    await expect(
      app.kernel.connector.sendCommand(
        reconcileExecutingActionCommand('missing-action', '2026-07-17T10:00:00.000Z'),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_REFERENCE_NOT_FOUND' });
    const approved = await prepareAndApprove(app, 'reconcile-conflicts');
    await expect(
      app.kernel.connector.sendCommand(
        reconcileExecutingActionCommand(approved.actionId, approved.updatedAt, 'non-owner', {
          type: 'user',
          id: 'reviewer',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_AUTHORIZATION_DENIED' });
    await expect(
      app.kernel.connector.sendCommand(
        reconcileExecutingActionCommand(approved.actionId, approved.updatedAt, 'approved'),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const system = await app.repository.claimForExecution(
      approved.projectId,
      approved.approval!.approvalId,
      '2026-07-17T10:01:00.000Z',
      'system:worker',
    );
    await expect(
      app.kernel.connector.sendCommand(
        reconcileExecutingActionCommand(approved.actionId, system.record.updatedAt, 'system', {
          type: 'system',
          id: 'system:worker',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_AUTHORIZATION_DENIED' });
    await app.kernel.shutdown();
  });

  it('rejects a Service Principal approval while allowing the single-owner user approval policy', async () => {
    const app = await harness();
    const candidate = actionServerCandidate('approval-policy');
    await app.candidates.stage(candidate);
    const preview = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(prepareActionCommand(candidate))
    ).result;
    await expect(
      app.kernel.connector.sendCommand(
        approveActionCommand(preview.actionId, preview.preview.previewDigest, 'service', {
          type: 'service',
          id: 'automation',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_AUTHORIZATION_DENIED' });
    const approved = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        approveActionCommand(preview.actionId, preview.preview.previewDigest),
      )
    ).result;
    expect(approved.approval?.approvalPolicy.requiredApprovalCount).toBe(1);
    expect(approved.approval?.approvedBy.type).toBe('user');
    await app.kernel.shutdown();
  });
});
