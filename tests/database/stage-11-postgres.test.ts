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
  prepareActionCommand,
} from '../helpers/stage-11.js';
import { actionEvidenceSetDigest } from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

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
});
