import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { FakeDraftActionConnector } from '../../adapters/action-connector-fake/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  PostgresActionCandidateRepository,
  PostgresActionExecutionRepository,
} from '../../adapters/postgres-stage11/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import type { ActionExecutionRecord } from '../../packages/contracts/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import {
  createActionExecutionModule,
  type ActionBindingReference,
} from '../../modules/action-execution/src/index.js';
import {
  actionServerCandidate,
  approveActionCommand,
  executeActionCommand,
  prepareActionCommand,
  reconcileExecutingActionCommand,
} from '../helpers/stage-11.js';
import { actionEvidenceSetDigest } from '../../packages/contracts/src/index.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const createActionKernel = (
  repository: PostgresActionExecutionRepository,
  candidates: PostgresActionCandidateRepository,
  connector: FakeDraftActionConnector,
) => {
  const independentVerification = {
    resolveCurrentBinding: async (request: ActionBindingReference) => {
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
  };
  const kernel = new ShotgunKernel(new InProcessTransport());
  kernel.register(
    createActionExecutionModule(repository, candidates, independentVerification, connector, {
      now: () => '2026-09-15T10:00:00.000Z',
    }),
  );
  return kernel;
};

describe.runIf(pool)('Stage 12.1 P0-2 PostgreSQL Action persistence', () => {
  beforeEach(async () => {
    await pool!.query(
      'TRUNCATE action.audit_events, action.approval_records, action.preview_snapshots, action.approvals, action.executions, action.candidates CASCADE',
    );
  });
  afterAll(async () => {
    await pool!.end();
  });

  it('persists immutable Snapshot and Approval records and atomically permits one execution claim', async () => {
    const candidates = new PostgresActionCandidateRepository(pool!);
    const executions = new PostgresActionExecutionRepository(pool!);
    const connector = new FakeDraftActionConnector();
    const kernel = new ShotgunKernel(new InProcessTransport());
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
    kernel.register(
      createActionExecutionModule(executions, candidates, independentVerification, connector),
    );
    await kernel.start();
    const candidate = actionServerCandidate('postgres');
    await candidates.stage(candidate);
    const preview = (
      await kernel.connector.sendCommand<ActionExecutionRecord>(prepareActionCommand(candidate))
    ).result;
    const approved = (
      await kernel.connector.sendCommand<ActionExecutionRecord>(
        approveActionCommand(preview.actionId, preview.preview.previewDigest),
      )
    ).result;

    const [first, second] = await Promise.all([
      executions.claimForExecution(
        approved.projectId,
        approved.approval!.approvalId,
        '2026-07-17T10:01:00.000Z',
        'worker-a',
      ),
      executions.claimForExecution(
        approved.projectId,
        approved.approval!.approvalId,
        '2026-07-17T10:01:00.000Z',
        'worker-b',
      ),
    ]);
    expect([first, second].filter((claim) => claim.claimed)).toHaveLength(1);
    expect((await executions.find(approved.projectId, approved.actionId))?.status).toBe(
      'EXECUTING',
    );
    await expect(
      pool!.query('UPDATE action.preview_snapshots SET expires_at = now() WHERE snapshot_id = $1', [
        approved.preview.snapshotId,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool!.query('DELETE FROM action.approval_records WHERE approval_id = $1', [
        approved.approval!.approvalId,
      ]),
    ).rejects.toThrow(/append-only/);
    await kernel.shutdown();
  });

  it('persists provider OUTCOME_UNKNOWN feedback through the Action outbox without replaying the provider', async () => {
    const candidates = new PostgresActionCandidateRepository(pool!);
    const repository = new PostgresActionExecutionRepository(pool!);
    const connector = new FakeDraftActionConnector('secret', {
      preflight: 'ready',
      execute: 'unknown-after-effect',
    });
    const kernel = createActionKernel(repository, candidates, connector);
    await kernel.start();
    const candidate = actionServerCandidate('postgres-provider-unknown');
    await candidates.stage(candidate);
    const preview = (
      await kernel.connector.sendCommand<ActionExecutionRecord>(prepareActionCommand(candidate))
    ).result;
    const approved = (
      await kernel.connector.sendCommand<ActionExecutionRecord>(
        approveActionCommand(preview.actionId, preview.preview.previewDigest),
      )
    ).result;
    const unknown = (
      await kernel.connector.sendCommand<ActionExecutionRecord>(
        executeActionCommand(approved.approval!.approvalId),
      )
    ).result;

    expect(unknown.status).toBe('OUTCOME_UNKNOWN');
    expect(connector.calls).toEqual({ preflight: 1, execute: 1, verify: 0 });
    const feedback = await repository.findFeedbackOutbox(
      unknown.projectId,
      `action-feedback:${unknown.actionId}:OUTCOME_UNKNOWN`,
    );
    expect(feedback).toMatchObject({ status: 'published', feedbackStatus: 'OUTCOME_UNKNOWN' });
    expect((await repository.listAudit(unknown.projectId, unknown.actionId)).at(-1)?.category).toBe(
      'ACTION_OUTCOME_UNKNOWN',
    );
    await kernel.shutdown();
  });

  it('reconciles a persisted EXECUTING Action after repository restart without connector calls', async () => {
    const candidates = new PostgresActionCandidateRepository(pool!);
    const repository = new PostgresActionExecutionRepository(pool!);
    const connector = new FakeDraftActionConnector();
    const kernel = createActionKernel(repository, candidates, connector);
    await kernel.start();

    const candidate = actionServerCandidate('postgres-restart-reconcile');
    await candidates.stage(candidate);
    const preview = (
      await kernel.connector.sendCommand<ActionExecutionRecord>(prepareActionCommand(candidate))
    ).result;
    const approved = (
      await kernel.connector.sendCommand<ActionExecutionRecord>(
        approveActionCommand(preview.actionId, preview.preview.previewDigest),
      )
    ).result;
    const claimed = await repository.claimForExecution(
      approved.projectId,
      approved.approval!.approvalId,
      '2026-09-15T10:01:00.000Z',
      'worker-before-restart',
    );
    expect(claimed.claimed).toBe(true);
    await kernel.shutdown();

    const freshRepository = new PostgresActionExecutionRepository(pool!);
    const freshCandidates = new PostgresActionCandidateRepository(pool!);
    const freshConnector = new FakeDraftActionConnector();
    const freshKernel = createActionKernel(freshRepository, freshCandidates, freshConnector);
    await freshKernel.start();
    const recovered = (
      await freshKernel.connector.sendCommand<ActionExecutionRecord>(
        reconcileExecutingActionCommand(approved.actionId, claimed.record.updatedAt),
      )
    ).result;

    expect(recovered).toMatchObject({
      status: 'OUTCOME_UNKNOWN',
      actionId: approved.actionId,
      preview: approved.preview,
      approval: approved.approval,
      failureReason:
        'Execution was interrupted before a durable provider outcome was established. Automatic execution retry is forbidden.',
    });
    expect(freshConnector.calls).toEqual({ preflight: 0, execute: 0, verify: 0 });
    const persisted = await freshRepository.find(approved.projectId, approved.actionId);
    expect(persisted).toEqual(recovered);
    const audit = await freshRepository.listAudit(approved.projectId, approved.actionId);
    expect(audit.filter((event) => event.category === 'ACTION_OUTCOME_UNKNOWN')).toHaveLength(1);
    expect(audit.at(-1)?.details).toMatchObject({
      automaticRetry: false,
      reconciliation: 'orphaned-executing',
      expectedUpdatedAt: claimed.record.updatedAt,
    });
    expect(await countPersistedActionRows(approved.projectId, approved.actionId)).toEqual({
      executions: 1,
      snapshots: 1,
      approvals: 1,
      audits: 6,
      feedback_outbox: 1,
    });
    await freshKernel.shutdown();
  });

  it('uses the PostgreSQL optimistic guard so reconciliation and a competing transition cannot both win', async () => {
    const candidates = new PostgresActionCandidateRepository(pool!);
    const repository = new PostgresActionExecutionRepository(pool!);
    const kernel = createActionKernel(repository, candidates, new FakeDraftActionConnector());
    await kernel.start();

    const candidate = actionServerCandidate('postgres-reconcile-race');
    await candidates.stage(candidate);
    const preview = (
      await kernel.connector.sendCommand<ActionExecutionRecord>(prepareActionCommand(candidate))
    ).result;
    const approved = (
      await kernel.connector.sendCommand<ActionExecutionRecord>(
        approveActionCommand(preview.actionId, preview.preview.previewDigest),
      )
    ).result;
    const claimed = await repository.claimForExecution(
      approved.projectId,
      approved.approval!.approvalId,
      '2026-09-15T10:01:00.000Z',
      'worker-race',
    );
    const expectedUpdatedAt = claimed.record.updatedAt;

    const recoveryRepository = new PostgresActionExecutionRepository(pool!);
    const recoveryConnector = new FakeDraftActionConnector();
    const recoveryKernel = createActionKernel(
      recoveryRepository,
      new PostgresActionCandidateRepository(pool!),
      recoveryConnector,
    );
    await recoveryKernel.start();
    const competingRepository = new PostgresActionExecutionRepository(pool!);
    const competingTransition = competingRepository.transition(
      approved.projectId,
      approved.actionId,
      {
        expectedStatus: 'EXECUTING',
        next: { ...claimed.record, updatedAt: '2026-09-15T10:02:00.000Z' },
        category: 'ACTION_PREFLIGHT_PASSED',
        actorId: 'worker-race',
        details: { connectorId: 'fake-draft', duplicate: false },
      },
    );
    const reconciliation = recoveryKernel.connector.sendCommand<ActionExecutionRecord>(
      reconcileExecutingActionCommand(approved.actionId, expectedUpdatedAt, 'race'),
    );
    const [competingResult, reconciliationResult] = await Promise.allSettled([
      competingTransition,
      reconciliation,
    ]);
    expect(
      [competingResult, reconciliationResult].filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      [competingResult, reconciliationResult].filter(
        (result) => result.status === 'rejected' && result.reason?.code === 'CONFLICT',
      ),
    ).toHaveLength(1);
    const final = await recoveryRepository.find(approved.projectId, approved.actionId);
    expect(['EXECUTING', 'OUTCOME_UNKNOWN']).toContain(final?.status);
    expect(recoveryConnector.calls).toEqual({ preflight: 0, execute: 0, verify: 0 });
    const audit = await recoveryRepository.listAudit(approved.projectId, approved.actionId);
    expect(
      audit.filter((event) => event.category === 'ACTION_OUTCOME_UNKNOWN').length,
    ).toBeLessThanOrEqual(1);
    await recoveryKernel.shutdown();
    await kernel.shutdown();
  });
});

const countPersistedActionRows = async (projectId: string, actionId: string) => {
  const result = await pool!.query<{
    readonly executions: number;
    readonly snapshots: number;
    readonly approvals: number;
    readonly audits: number;
    readonly feedback_outbox: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM action.executions WHERE project_id = $1 AND action_id = $2) AS executions,
       (SELECT count(*)::int FROM action.preview_snapshots WHERE project_id = $1 AND action_id = $2) AS snapshots,
       (SELECT count(*)::int FROM action.approval_records WHERE action_id = $2) AS approvals,
       (SELECT count(*)::int FROM action.audit_events WHERE project_id = $1 AND action_id = $2) AS audits,
       (SELECT count(*)::int FROM action.action_feedback_outbox WHERE project_id = $1 AND action_id = $2) AS feedback_outbox`,
    [projectId, actionId],
  );
  return result.rows[0];
};
