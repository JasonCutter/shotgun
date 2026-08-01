import { describe, expect, it } from 'vitest';

import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import type { FrontendCommandRequest } from '../../packages/contracts/src/index.js';

const request: FrontendCommandRequest = {
  envelopeVersion: '1.0.0',
  commandType: 'project.metadata.update.v1',
  commandSchemaVersion: '1.0.0',
  clientRequestId: 'request-1',
  idempotencyKey: 'idempotency-1',
  projectContext: {
    activeProjectId: 'shotgun',
    targetProjectId: 'shotgun',
    resourceProjectId: 'shotgun',
  },
  policyBinding: { mode: 'CURRENT', observedPolicyContextRevision: '1' },
  preconditions: [
    {
      purpose: 'TARGET',
      subject: { resourceKind: 'project', resourceId: 'shotgun' },
      expectedRevision: '1',
    },
  ],
  clientIssuedAt: '2026-07-26T00:00:00.000Z',
  payload: { name: 'Renamed' },
};

const acceptedInput = (digest: string) => ({
  commandId: 'server-command-1',
  commandRevision: '1',
  principalId: 'principal-1',
  request,
  commandSemanticDigest: digest,
  acceptedPolicyContext: {
    policyContextId: 'project-policy-context/shotgun',
    policyContextRevision: '1',
    acceptedAt: '2026-07-26T00:00:01.000Z',
  },
  correlationId: 'correlation-1',
  traceId: 'trace-1',
  receivedAt: '2026-07-26T00:00:00.500Z',
  acceptedAt: '2026-07-26T00:00:01.000Z',
});

describe('InMemoryFrontendCommandGateway', () => {
  it('returns the same outcome for the same idempotency scope and digest', async () => {
    const gateway = new InMemoryFrontendCommandGateway();
    const first = await gateway.accept(acceptedInput('digest-1'));
    const replay = await gateway.accept({
      ...acceptedInput('digest-1'),
      commandId: 'server-command-2',
    });

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.outcome.commandId).toBe(first.outcome.commandId);
  });

  it('rejects idempotency reuse with a different semantic digest', async () => {
    const gateway = new InMemoryFrontendCommandGateway();
    await gateway.accept(acceptedInput('digest-1'));

    await expect(gateway.accept(acceptedInput('digest-2'))).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSE_MISMATCH',
    });
  });

  it('stores completed outcomes for clientRequestId recovery', async () => {
    const gateway = new InMemoryFrontendCommandGateway();
    await gateway.accept(acceptedInput('digest-1'));
    await gateway.complete({
      commandId: 'server-command-1',
      producedResources: [
        { resourceKind: 'project', resourceId: 'shotgun', resourceRevision: '2' },
      ],
      completedAt: '2026-07-26T00:00:02.000Z',
    });

    const outcome = await gateway.findByClientRequestId('principal-1', 'request-1');
    expect(outcome).toMatchObject({
      outcomeState: 'COMPLETED',
      completionDisposition: 'SUCCEEDED',
      commandRevision: '2',
    });
  });

  it('does not resolve a clientRequestId for a different protected resource', async () => {
    const gateway = new InMemoryFrontendCommandGateway();
    const boundRequest: FrontendCommandRequest = {
      ...request,
      clientRequestId: 'resource-bound-request',
      commandType: 'ask.answer-run.export.v1',
      preconditions: [
        {
          purpose: 'TARGET',
          subject: { resourceKind: 'ASK_ANSWER_RUN', resourceId: 'run-a' },
        },
      ],
    };
    await gateway.accept({
      ...acceptedInput('digest-resource-bound'),
      request: boundRequest,
      commandId: 'command-resource-bound',
      commandSemanticDigest: 'digest-resource-bound',
    });

    await expect(
      gateway.findByClientRequestId('principal-1', 'resource-bound-request', {
        resourceKind: 'ASK_ANSWER_RUN',
        resourceId: 'run-b',
        commandTypes: ['ask.answer-run.export.v1'],
      }),
    ).resolves.toBeNull();
  });

  it('resolves an accepted command to outcome unknown without rejecting it', async () => {
    const gateway = new InMemoryFrontendCommandGateway();
    await gateway.accept(acceptedInput('digest-1'));

    const outcome = await gateway.markOutcomeUnknown({
      commandId: 'server-command-1',
      message: 'Commit acknowledgement was lost.',
      completedAt: '2026-07-26T00:00:03.000Z',
    });

    expect(outcome).toMatchObject({
      outcomeState: 'OUTCOME_UNKNOWN',
      completionDisposition: 'PARTIAL',
      commandRevision: '2',
    });
    expect((await gateway.findByClientRequestId('principal-1', 'request-1'))?.outcomeState).toBe(
      'OUTCOME_UNKNOWN',
    );
  });

  it('resumes an accepted replay and completes it exactly once', async () => {
    const gateway = new InMemoryFrontendCommandGateway();
    const first = await gateway.accept(acceptedInput('digest-1'));
    const replay = await gateway.accept({
      ...acceptedInput('digest-1'),
      commandId: 'server-command-retry',
    });

    expect(replay).toMatchObject({
      replayed: true,
      outcome: { commandId: first.outcome.commandId, outcomeState: 'ACCEPTED' },
    });

    const locked = await gateway.lockAcceptedForExecution(
      { kind: 'test-transaction' },
      replay.outcome.commandId,
    );
    expect(locked.outcomeState).toBe('ACCEPTED');
    await gateway.complete({
      commandId: replay.outcome.commandId,
      producedResources: [{ resourceKind: 'ASK_ANSWER_EXPORT', resourceId: 'export-1' }],
      completedAt: '2026-07-26T00:00:04.000Z',
    });

    const concurrentReplay = await gateway.accept({
      ...acceptedInput('digest-1'),
      commandId: 'server-command-concurrent-retry',
    });
    const completedLock = await gateway.lockAcceptedForExecution(
      { kind: 'test-transaction' },
      concurrentReplay.outcome.commandId,
    );
    const completedAgain = await gateway.complete({
      commandId: concurrentReplay.outcome.commandId,
      producedResources: [{ resourceKind: 'ASK_ANSWER_EXPORT', resourceId: 'duplicate' }],
      completedAt: '2026-07-26T00:00:05.000Z',
    });

    expect(concurrentReplay.replayed).toBe(true);
    expect(completedLock.outcomeState).toBe('COMPLETED');
    expect(completedAgain).toMatchObject({
      outcomeState: 'COMPLETED',
      producedResources: [{ resourceKind: 'ASK_ANSWER_EXPORT', resourceId: 'export-1' }],
    });
    expect(completedAgain.commandRevision).toBe('2');
  });
});
