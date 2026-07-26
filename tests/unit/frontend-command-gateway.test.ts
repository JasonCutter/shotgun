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
});
