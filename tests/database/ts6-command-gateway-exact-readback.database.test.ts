import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { ShotgunError, type FrontendCommandRequest } from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { createPostCommitAckLossPool } from '../helpers/postgres-commit-ack-loss.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool = createPostgresPool(databaseUrl);

const commandQueryText = (query: unknown): string => {
  if (typeof query === 'string') return query.trim().toUpperCase();
  if (query && typeof query === 'object' && 'text' in query) {
    return String(query.text).trim().toUpperCase();
  }
  return '';
};

const unknownOutcome = (): ShotgunError =>
  new ShotgunError({
    code: 'OUTCOME_UNKNOWN',
    safeMessage: 'The test fault injector hid the completion outcome.',
    module: 'ts6-command-gateway-exact-readback-test',
    operation: 'fault-injection',
  });

const createPreCommitUnknownPool = (
  sourcePool: Pool,
  commandId: string,
  failOn: 'UPDATE' | 'SELECT',
): Pool => {
  const originalConnect = sourcePool.connect.bind(sourcePool);
  return {
    query: sourcePool.query.bind(sourcePool),
    connect: async () => {
      const client = await originalConnect();
      const originalQuery = client.query.bind(client);
      const originalRelease = client.release.bind(client);
      const injectedQuery = async (query: unknown, values?: unknown[]) => {
        const text = commandQueryText(query);
        const isTargetStatement =
          values?.[0] === commandId &&
          ((failOn === 'UPDATE' && text.startsWith('UPDATE FRONTEND_COMMAND.COMMAND_LEDGER')) ||
            (failOn === 'SELECT' &&
              text.startsWith('SELECT * FROM FRONTEND_COMMAND.COMMAND_LEDGER')));
        if (isTargetStatement) throw unknownOutcome();
        if (values === undefined) return originalQuery(query as never);
        return originalQuery(query as never, values as never);
      };
      client.query = injectedQuery as typeof client.query;
      client.release = ((error?: Error) => {
        client.query = originalQuery as typeof client.query;
        originalRelease(error);
      }) as typeof client.release;
      return client;
    },
  } as Pool;
};

type AcceptedCommand = {
  readonly commandId: string;
  readonly producedResources: readonly {
    readonly resourceKind: string;
    readonly resourceId: string;
    readonly resourceRevision?: string;
  }[];
  readonly completedAt: string;
};

const acceptCommand = async (gateway: PostgresFrontendCommandGateway): Promise<AcceptedCommand> => {
  const suffix = randomUUID();
  const commandId = `ts6-cg-rb-command-${suffix}`;
  const producedResources = [
    {
      resourceKind: 'TS6_TEST_RESOURCE',
      resourceId: `ts6-cg-rb-resource-${suffix}`,
      resourceRevision: '1',
    },
  ] as const;
  const request: FrontendCommandRequest = {
    envelopeVersion: '1.0.0',
    commandType: 'ts6.command-gateway.readback.v1',
    commandSchemaVersion: '1.0.0',
    clientRequestId: `ts6-cg-rb-request-${suffix}`,
    idempotencyKey: `ts6-cg-rb-idempotency-${suffix}`,
    projectContext: {
      activeProjectId: `ts6-cg-rb-project-${suffix}`,
      targetProjectId: `ts6-cg-rb-project-${suffix}`,
      resourceProjectId: `ts6-cg-rb-project-${suffix}`,
    },
    policyBinding: { mode: 'CURRENT', observedPolicyContextRevision: '1' },
    preconditions: [],
    clientIssuedAt: '2026-09-20T00:00:00.000Z',
    payload: { purpose: 'C2-R1 exact durable material readback' },
  };
  await gateway.accept({
    commandId,
    commandRevision: '1',
    principalId: `ts6-cg-rb-principal-${suffix}`,
    request,
    commandSemanticDigest: `ts6-cg-rb-digest-${suffix}`,
    acceptedPolicyContext: {
      policyContextId: 'ts6-cg-rb-policy',
      policyContextRevision: '1',
      acceptedAt: '2026-09-20T00:00:01.000Z',
    },
    correlationId: `ts6-cg-rb-correlation-${suffix}`,
    traceId: `ts6-cg-rb-trace-${suffix}`,
    receivedAt: '2026-09-20T00:00:00.500Z',
    acceptedAt: '2026-09-20T00:00:01.000Z',
  });
  return {
    commandId,
    producedResources,
    completedAt: '2026-09-20T00:00:02.000Z',
  };
};

const completionInput = (command: AcceptedCommand) => ({
  commandId: command.commandId,
  producedResources: command.producedResources,
  completedAt: command.completedAt,
});

const setOutcome = async (
  commandId: string,
  state: 'ACCEPTED' | 'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN',
  disposition: 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | null,
  producedResources: readonly unknown[],
): Promise<void> => {
  await pool.query(
    `UPDATE frontend_command.command_ledger
     SET outcome_state = $2,
         completion_disposition = $3,
         produced_resources = $4::jsonb
     WHERE command_id = $1`,
    [commandId, state, disposition, JSON.stringify(producedResources)],
  );
};

const readLedgerRow = async (commandId: string) => {
  const result = await pool.query<{
    command_revision: string;
    outcome_state: string;
    completion_disposition: string | null;
    produced_resources: unknown;
  }>(
    `SELECT command_revision::text, outcome_state, completion_disposition, produced_resources
     FROM frontend_command.command_ledger
     WHERE command_id = $1`,
    [commandId],
  );
  return result.rows[0];
};

describe('TS-6 C2-R1 frontend command gateway exact durable readback', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('CG-RB-01 reconciles one real committed completion after the COMMIT acknowledgement is lost', async () => {
    const command = await acceptCommand(new PostgresFrontendCommandGateway(pool));
    const injected = createPostCommitAckLossPool(pool);
    const gateway = new PostgresFrontendCommandGateway(injected.pool);

    const result = await gateway.complete(completionInput(command));
    const row = await readLedgerRow(command.commandId);

    expect(result).toMatchObject({
      commandId: command.commandId,
      outcomeState: 'COMPLETED',
      completionDisposition: 'SUCCEEDED',
      producedResources: command.producedResources,
    });
    expect(row).toMatchObject({
      command_revision: '2',
      outcome_state: 'COMPLETED',
      completion_disposition: 'SUCCEEDED',
      produced_resources: command.producedResources,
    });
    expect(injected.trace.commitAttempts).toBe(1);
    expect(injected.trace.rollbackAfterCommit).toBe(0);
    expect(
      injected.trace.commands.filter((text) =>
        text.startsWith('UPDATE FRONTEND_COMMAND.COMMAND_LEDGER'),
      ),
    ).toHaveLength(1);
  });

  it('CG-RB-02 preserves OUTCOME_UNKNOWN for a durable ACCEPTED pre-state', async () => {
    const command = await acceptCommand(new PostgresFrontendCommandGateway(pool));
    const gateway = new PostgresFrontendCommandGateway(
      createPreCommitUnknownPool(pool, command.commandId, 'UPDATE'),
    );

    await expect(gateway.complete(completionInput(command))).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(await readLedgerRow(command.commandId)).toMatchObject({
      command_revision: '1',
      outcome_state: 'ACCEPTED',
    });
  });

  it('CG-RB-03 preserves OUTCOME_UNKNOWN for a durable OUTCOME_UNKNOWN row', async () => {
    const command = await acceptCommand(new PostgresFrontendCommandGateway(pool));
    await setOutcome(command.commandId, 'OUTCOME_UNKNOWN', 'PARTIAL', []);
    const gateway = new PostgresFrontendCommandGateway(createPostCommitAckLossPool(pool).pool);

    await expect(gateway.complete(completionInput(command))).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(await readLedgerRow(command.commandId)).toMatchObject({
      outcome_state: 'OUTCOME_UNKNOWN',
      completion_disposition: 'PARTIAL',
    });
  });

  it('CG-RB-04 preserves OUTCOME_UNKNOWN for a durable REJECTED row', async () => {
    const command = await acceptCommand(new PostgresFrontendCommandGateway(pool));
    await setOutcome(command.commandId, 'REJECTED', 'FAILED', []);
    const gateway = new PostgresFrontendCommandGateway(createPostCommitAckLossPool(pool).pool);

    await expect(gateway.complete(completionInput(command))).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(await readLedgerRow(command.commandId)).toMatchObject({
      outcome_state: 'REJECTED',
      completion_disposition: 'FAILED',
    });
  });

  it('CG-RB-05 preserves OUTCOME_UNKNOWN for COMPLETED/SUCCEEDED with different resources', async () => {
    const command = await acceptCommand(new PostgresFrontendCommandGateway(pool));
    await setOutcome(command.commandId, 'COMPLETED', 'SUCCEEDED', [
      { resourceKind: 'TS6_TEST_RESOURCE', resourceId: 'different-resource' },
    ]);
    const gateway = new PostgresFrontendCommandGateway(createPostCommitAckLossPool(pool).pool);

    await expect(gateway.complete(completionInput(command))).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(await readLedgerRow(command.commandId)).toMatchObject({
      outcome_state: 'COMPLETED',
      completion_disposition: 'SUCCEEDED',
    });
  });

  it('CG-RB-06 preserves OUTCOME_UNKNOWN for COMPLETED with the wrong disposition', async () => {
    const command = await acceptCommand(new PostgresFrontendCommandGateway(pool));
    await setOutcome(command.commandId, 'COMPLETED', 'FAILED', command.producedResources);
    const gateway = new PostgresFrontendCommandGateway(createPostCommitAckLossPool(pool).pool);

    await expect(gateway.complete(completionInput(command))).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(await readLedgerRow(command.commandId)).toMatchObject({
      outcome_state: 'COMPLETED',
      completion_disposition: 'FAILED',
    });
  });

  it('CG-RB-07 preserves OUTCOME_UNKNOWN when the command is absent and readback returns no row', async () => {
    const command = await acceptCommand(new PostgresFrontendCommandGateway(pool));
    await pool.query('DELETE FROM frontend_command.command_ledger WHERE command_id = $1', [
      command.commandId,
    ]);
    const gateway = new PostgresFrontendCommandGateway(
      createPreCommitUnknownPool(pool, command.commandId, 'SELECT'),
    );

    await expect(gateway.complete(completionInput(command))).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
    });
    expect(await readLedgerRow(command.commandId)).toBeUndefined();
  });

  it('CG-RB-08 leaves normal completion behavior unchanged', async () => {
    const command = await acceptCommand(new PostgresFrontendCommandGateway(pool));
    const result = await new PostgresFrontendCommandGateway(pool).complete(
      completionInput(command),
    );

    expect(result).toMatchObject({
      commandId: command.commandId,
      outcomeState: 'COMPLETED',
      completionDisposition: 'SUCCEEDED',
      commandRevision: '2',
      producedResources: command.producedResources,
    });
  });
});
