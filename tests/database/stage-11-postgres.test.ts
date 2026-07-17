import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresActionExecutionRepository } from '../../adapters/postgres-stage11/src/index.js';
import type {
  ActionApprovalToken,
  ActionAuditEvent,
  ActionExecutionRecord,
  ActionPreview,
} from '../../packages/contracts/src/index.js';
import {
  actionCandidateDigest,
  actionParameterDigest,
  actionPreviewDigest,
  actionTargetDigest,
} from '../../packages/contracts/src/index.js';
import { decideActionRisk } from '../../packages/policy/src/index.js';
import { actionCandidate } from '../helpers/stage-11.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const fixture = (): ActionExecutionRecord => {
  const candidate = actionCandidate('postgres');
  const riskDecision = decideActionRisk({
    operation: candidate.operation,
    sensitivity: 'private',
    compensation: false,
  });
  const createdAt = '2026-07-17T10:00:00.000Z';
  const preview: ActionPreview = {
    actionId: randomUUID(),
    projectId: 'project-stage11',
    candidate,
    candidateDigest: actionCandidateDigest(candidate),
    targetDigest: actionTargetDigest(candidate),
    parameterDigest: actionParameterDigest(candidate),
    previewDigest: actionPreviewDigest(candidate, riskDecision),
    riskDecision,
    createdAt,
  };
  return {
    actionId: preview.actionId,
    projectId: preview.projectId,
    status: 'PREVIEW_READY',
    preview,
    canonicalWrite: false,
    createdAt,
    updatedAt: createdAt,
  };
};

const initialAudit = (
  record: ActionExecutionRecord,
): readonly Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>[] => [
  {
    actionId: record.actionId,
    projectId: record.projectId,
    category: 'ACTION_CANDIDATE_VALIDATED',
    actorId: 'owner',
    policyVersion: record.preview.riskDecision.policyVersion,
    details: { candidateRevision: 1 },
    occurredAt: record.createdAt,
  },
  {
    actionId: record.actionId,
    projectId: record.projectId,
    category: 'ACTION_RISK_DECIDED',
    actorId: 'owner',
    policyVersion: record.preview.riskDecision.policyVersion,
    details: { riskLevel: record.preview.riskDecision.level },
    occurredAt: record.createdAt,
  },
  {
    actionId: record.actionId,
    projectId: record.projectId,
    category: 'ACTION_PREVIEW_READY',
    actorId: 'owner',
    policyVersion: record.preview.riskDecision.policyVersion,
    details: { previewDigest: record.preview.previewDigest },
    occurredAt: record.createdAt,
  },
];

describe.runIf(pool)('Stage 11 PostgreSQL Action persistence', () => {
  beforeEach(async () => {
    await pool!.query('TRUNCATE action.audit_events, action.approvals, action.executions CASCADE');
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('survives restart and atomically permits only one execution claim', async () => {
    const record = fixture();
    const first = new PostgresActionExecutionRepository(pool!);
    await first.createPreview(record, initialAudit(record));

    const restarted = new PostgresActionExecutionRepository(pool!);
    expect(await restarted.find(record.projectId, record.actionId)).toEqual(record);
    const approval: ActionApprovalToken = {
      tokenId: randomUUID(),
      actionId: record.actionId,
      candidateRevision: record.preview.candidate.revisionNumber,
      targetDigest: record.preview.targetDigest,
      parameterDigest: record.preview.parameterDigest,
      previewDigest: record.preview.previewDigest,
      approvedBy: { type: 'user', id: 'owner' },
      approvedAt: '2026-07-17T10:01:00.000Z',
      expiresAt: '2026-07-17T11:01:00.000Z',
    };
    await restarted.approve(
      record.projectId,
      record.actionId,
      record.preview.previewDigest,
      approval,
    );

    const claims = await Promise.all([
      first.claimForExecution(
        record.projectId,
        record.actionId,
        approval.tokenId,
        '2026-07-17T10:02:00.000Z',
        'worker-a',
      ),
      restarted.claimForExecution(
        record.projectId,
        record.actionId,
        approval.tokenId,
        '2026-07-17T10:02:00.000Z',
        'worker-b',
      ),
    ]);
    expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    expect((await restarted.find(record.projectId, record.actionId))?.status).toBe('EXECUTING');
    expect(
      (await restarted.listAudit(record.projectId, record.actionId)).map((event) => event.sequence),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps approvals and Audit append-only at the database boundary', async () => {
    const record = fixture();
    const repository = new PostgresActionExecutionRepository(pool!);
    await repository.createPreview(record, initialAudit(record));
    const approval: ActionApprovalToken = {
      tokenId: randomUUID(),
      actionId: record.actionId,
      candidateRevision: 1,
      targetDigest: record.preview.targetDigest,
      parameterDigest: record.preview.parameterDigest,
      previewDigest: record.preview.previewDigest,
      approvedBy: { type: 'user', id: 'owner' },
      approvedAt: '2026-07-17T10:01:00.000Z',
      expiresAt: '2026-07-17T11:01:00.000Z',
    };
    await repository.approve(
      record.projectId,
      record.actionId,
      record.preview.previewDigest,
      approval,
    );
    await expect(
      pool!.query("UPDATE action.audit_events SET category = 'TAMPERED' WHERE action_id = $1", [
        record.actionId,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool!.query('DELETE FROM action.approvals WHERE action_id = $1', [record.actionId]),
    ).rejects.toThrow(/append-only/);
  });
});
