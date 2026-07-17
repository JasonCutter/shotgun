import { describe, expect, it } from 'vitest';

import { FakeDraftActionConnector } from '../../adapters/action-connector-fake/src/index.js';
import { InMemoryActionExecutionRepository } from '../../adapters/stage11-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import type {
  ActionAuditEvent,
  ActionExecutionRecord,
} from '../../packages/contracts/src/index.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import { createActionExecutionModule } from '../../modules/action-execution/src/index.js';
import {
  actionAuditQuery,
  actionCandidate,
  approveActionCommand,
  executeActionCommand,
  prepareActionCommand,
  verifyActionCommand,
} from '../helpers/stage-11.js';

const harness = async (
  connector = new FakeDraftActionConnector(),
  clock = { now: () => '2026-07-17T10:00:00.000Z' },
) => {
  const repository = new InMemoryActionExecutionRepository();
  const kernel = new ShotgunKernel(new InProcessTransport());
  kernel.register(createActionExecutionModule(repository, connector, clock));
  await kernel.start();
  return { kernel, repository, connector };
};

const prepareAndApprove = async (app: Awaited<ReturnType<typeof harness>>, suffix: string) => {
  const preview = (
    await app.kernel.connector.sendCommand<ActionExecutionRecord>(
      prepareActionCommand(actionCandidate(suffix)),
    )
  ).result;
  const approved = (
    await app.kernel.connector.sendCommand<ActionExecutionRecord>(
      approveActionCommand(preview.actionId, preview.preview.previewDigest),
    )
  ).result;
  return approved;
};

describe('Stage 11 risk-controlled external Action contracts', () => {
  it('keeps Candidate separate and completes Preview, approval, preflight, execute, verify and feedback', async () => {
    const secret = 'must-never-appear-in-action-records';
    const app = await harness(new FakeDraftActionConnector(secret));
    const approved = await prepareAndApprove(app, 'happy');
    expect(approved).toMatchObject({
      status: 'APPROVED',
      canonicalWrite: false,
      preview: {
        candidate: { operation: 'CREATE_DRAFT', validation: { status: 'VALIDATED' } },
        riskDecision: { level: 'R1', requiresUserApproval: true },
      },
    });
    const execute = executeActionCommand(approved.actionId, approved.approval!.tokenId);
    const completed = (await app.kernel.connector.sendCommand<ActionExecutionRecord>(execute))
      .result;
    expect(completed).toMatchObject({
      status: 'VERIFIED',
      providerResult: { provider: 'fake' },
      verification: { status: 'APPLIED', provider: 'fake' },
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
    expect(
      app.kernel.connector.traces
        .findByTraceId(execute.traceId)
        .some((record) => record.messageType === 'ActionFeedbackRecorded'),
    ).toBe(true);
    await app.kernel.shutdown();
  });

  it('rejects wrong revisions, non-user approval and expired approval tokens', async () => {
    let now = '2026-07-17T10:00:00.000Z';
    const app = await harness(new FakeDraftActionConnector(), { now: () => now });
    const preview = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        prepareActionCommand(actionCandidate('negative')),
      )
    ).result;
    await expect(
      app.kernel.connector.sendCommand(
        approveActionCommand(preview.actionId, preview.preview.previewDigest, 'service', {
          type: 'service',
          id: 'automation',
        }),
      ),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect(
      app.kernel.connector.sendCommand(
        approveActionCommand(preview.actionId, `sha256:${'0'.repeat(64)}`, 'wrong-digest'),
      ),
    ).rejects.toMatchObject({ code: 'STALE_APPROVAL' });
    const approved = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        approveActionCommand(
          preview.actionId,
          preview.preview.previewDigest,
          'expires',
          undefined,
          1000,
        ),
      )
    ).result;
    now = '2026-07-17T10:00:02.000Z';
    await expect(
      app.kernel.connector.sendCommand(
        executeActionCommand(approved.actionId, approved.approval!.tokenId, 'expired'),
      ),
    ).rejects.toMatchObject({ code: 'STALE_APPROVAL' });
    await expect(
      app.kernel.connector.sendCommand(
        prepareActionCommand(
          actionCandidate('negative', { parameters: { title: 'Changed', body: 'Changed' } }),
          'mutated-same-revision',
        ),
      ),
    ).rejects.toMatchObject({ code: 'STALE_APPROVAL' });
    await app.kernel.shutdown();
  });

  it('allows only one provider call under concurrent execute requests', async () => {
    const app = await harness();
    const approved = await prepareAndApprove(app, 'concurrent');
    const [first, second] = await Promise.all([
      app.kernel.connector.sendCommand<ActionExecutionRecord>(
        executeActionCommand(approved.actionId, approved.approval!.tokenId, 'concurrent-a'),
      ),
      app.kernel.connector.sendCommand<ActionExecutionRecord>(
        executeActionCommand(approved.actionId, approved.approval!.tokenId, 'concurrent-b'),
      ),
    ]);
    expect(app.connector.calls.execute).toBe(1);
    expect([first.result.status, second.result.status]).toContain('VERIFIED');
    await app.kernel.shutdown();
  });

  it('never auto-retries OUTCOME_UNKNOWN and resolves it only through provider verification', async () => {
    const connector = new FakeDraftActionConnector('secret', {
      preflight: 'ready',
      execute: 'unknown-after-effect',
    });
    const app = await harness(connector);
    const approved = await prepareAndApprove(app, 'unknown');
    const unknown = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        executeActionCommand(approved.actionId, approved.approval!.tokenId, 'unknown-first'),
      )
    ).result;
    expect(unknown.status).toBe('OUTCOME_UNKNOWN');
    expect(connector.calls.execute).toBe(1);
    const repeated = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        executeActionCommand(approved.actionId, approved.approval!.tokenId, 'unknown-repeat'),
      )
    ).result;
    expect(repeated.status).toBe('OUTCOME_UNKNOWN');
    expect(connector.calls.execute).toBe(1);

    connector.setBehavior({ preflight: 'ready', execute: 'success' });
    const verified = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        verifyActionCommand(approved.actionId),
      )
    ).result;
    expect(verified.status).toBe('VERIFIED');
    expect(connector.calls.execute).toBe(1);
    await app.kernel.shutdown();
  });

  it('stops before provider execution when Preflight denies the current state', async () => {
    const connector = new FakeDraftActionConnector('secret', {
      preflight: 'deny',
      execute: 'success',
    });
    const app = await harness(connector);
    const approved = await prepareAndApprove(app, 'preflight-denied');
    const denied = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        executeActionCommand(approved.actionId, approved.approval!.tokenId),
      )
    ).result;
    expect(denied).toMatchObject({
      status: 'PREFLIGHT_FAILED',
      failureReason: 'Fake provider denied the current target state.',
    });
    expect(connector.calls).toEqual({ preflight: 1, execute: 0, verify: 0 });
    const audit = (
      await app.kernel.connector.query<{ items: readonly ActionAuditEvent[] }>(
        actionAuditQuery(denied.actionId),
      )
    ).result.payload.items;
    expect(audit.at(-1)?.category).toBe('ACTION_PREFLIGHT_FAILED');
    await app.kernel.shutdown();
  });

  it('treats compensation as a separate candidate, approval and Audit chain', async () => {
    const app = await harness();
    const original = await prepareAndApprove(app, 'original');
    const completed = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        executeActionCommand(original.actionId, original.approval!.tokenId),
      )
    ).result;
    const compensation = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        prepareActionCommand(
          actionCandidate('compensation', { compensationForActionId: completed.actionId }),
        ),
      )
    ).result;
    expect(compensation.actionId).not.toBe(completed.actionId);
    expect(compensation).toMatchObject({
      status: 'PREVIEW_READY',
      preview: {
        candidate: { compensationForActionId: completed.actionId },
        riskDecision: { level: 'R2', requiresUserApproval: true },
      },
    });
    const compensationApproved = (
      await app.kernel.connector.sendCommand<ActionExecutionRecord>(
        approveActionCommand(
          compensation.actionId,
          compensation.preview.previewDigest,
          'compensation-approval',
        ),
      )
    ).result;
    expect(compensationApproved.status).toBe('APPROVED');
    const audit = (
      await app.kernel.connector.query<{ items: readonly ActionAuditEvent[] }>(
        actionAuditQuery(compensation.actionId),
      )
    ).result.payload.items;
    expect(audit.at(-1)?.category).toBe('ACTION_APPROVED');
    expect(app.connector.calls.execute).toBe(1);
    await app.kernel.shutdown();
  });
});
