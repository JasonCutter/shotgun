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
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import { createActionExecutionModule } from '../../modules/action-execution/src/index.js';
import {
  actionAuditQuery,
  actionServerCandidate,
  approveActionCommand,
  executeActionCommand,
  prepareActionCommand,
  verifyActionCommand,
} from '../helpers/stage-11.js';

const harness = async (
  connector = new FakeDraftActionConnector(),
  clock = { now: () => '2026-07-17T10:00:00.000Z' },
) => {
  const candidates = new InMemoryActionCandidateRepository();
  const repository = new InMemoryActionExecutionRepository();
  const kernel = new ShotgunKernel(new InProcessTransport());
  kernel.register(createActionExecutionModule(repository, candidates, connector, clock));
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

describe('Stage 12.1 P0-2 server-bound Action contracts', () => {
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
