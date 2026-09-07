import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import {
  PostgresConnectorRuntimeState,
  PostgresDedupStore,
  PostgresJobRuntime,
} from '../../adapters/connector-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  ShotgunError,
  createChildEvent,
  createCommand,
  type ContractDefinition,
} from '../../packages/contracts/src/index.js';
import type { ConnectorSemanticIdentity } from '../../packages/connector-runtime/src/ports.js';
import { ShotgunKernel } from '../../packages/kernel/src/index.js';
import type { ShotgunModule } from '../../packages/module-sdk/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

afterAll(async () => {
  await pool?.end();
});

const eventContract: ContractDefinition = {
  name: 'ConnectorIdentityDriftEvent',
  version: '1.0.0',
  kind: 'event',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['value'],
    properties: { value: { type: 'string' } },
  },
};

const identityFor = (projectId: string, fingerprint: string): ConnectorSemanticIdentity => ({
  projectId,
  securityScope: JSON.stringify({
    accessScope: ['owner'],
    sensitivity: 'public',
    dataClassification: 'connector-test',
  }),
  consumerId: 'connector.identity-test:event:ConnectorIdentityDriftEvent',
  messageKind: 'event',
  messageType: 'ConnectorIdentityDriftEvent',
  semanticKey: `identity-drift:${projectId}`,
  fingerprint,
});

const cleanup = async (projectId: string): Promise<void> => {
  await pool!.query('DELETE FROM connector.dead_letters WHERE project_id=$1', [projectId]);
  await pool!.query(
    `DELETE FROM connector.jobs
      WHERE dedup_record_id IN (SELECT dedup_record_id FROM connector.dedup_records WHERE project_id=$1)`,
    [projectId],
  );
  await pool!.query('DELETE FROM connector.dedup_records WHERE project_id=$1', [projectId]);
};

const currentDedupRow = async (projectId: string) => {
  const result = await pool!.query<{
    dedup_record_id: string;
    state: string;
    job_id: string | null;
    fence_token: number | string;
    fingerprint: string;
  }>(
    `SELECT dedup_record_id, state, job_id, fence_token, fingerprint
       FROM connector.dedup_records
      WHERE project_id=$1 AND semantic_key=$2`,
    [projectId, `identity-drift:${projectId}`],
  );
  return result.rows[0];
};

const makeIdentity = async (projectId: string): Promise<ConnectorSemanticIdentity> => {
  const row = await currentDedupRow(projectId);
  if (!row) throw new Error(`dedup row missing for ${projectId}`);
  return identityFor(projectId, row.fingerprint);
};

const makeModule = (onHandle: (value: string) => Promise<void>): ShotgunModule => ({
  manifest: {
    id: 'connector.identity-test',
    version: '1.0.0',
    owner: 'runtime-integrity-tests',
    compatibility: {
      runtime: '^1.0.0',
      contracts: [{ name: eventContract.name, range: '^1.0.0' }],
    },
    deployment: { modes: ['in_process'] },
    dataOwnership: {
      owns: ['test-only'],
      readsViaPorts: [],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [{ name: eventContract.name, range: '^1.0.0' }],
    },
    produces: { events: [], handoffs: [] },
    provides: { queries: [], capabilities: [] },
    requires: { capabilities: [] },
    security: { requiredContext: [], defaultOnMissingContext: 'deny' },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
  },
  contracts: [eventContract],
  handlers: {
    commands: [],
    events: [
      {
        messageType: eventContract.name,
        version: eventContract.version,
        handle: (envelope) => onHandle((envelope.payload as { readonly value: string }).value),
      },
    ],
    queries: [],
  },
});

const makeEvent = (projectId: string) => {
  const parent = createCommand({
    messageType: 'ConnectorIdentityDriftParent',
    schemaVersion: '1.0.0',
    producerModule: 'runtime-integrity-tests',
    producerVersion: '1.0.0',
    idempotencyKey: `parent:${projectId}`,
    projectId,
    actor: { type: 'system', id: 'runtime-integrity-tests' },
    security: {
      accessScope: ['owner'],
      sensitivity: 'public',
      dataClassification: 'connector-test',
    },
    payload: { value: 'parent' },
  });
  return createChildEvent(parent, {
    messageType: eventContract.name,
    schemaVersion: eventContract.version,
    producerModule: 'runtime-integrity-tests',
    producerVersion: '1.0.0',
    idempotencyKey: `identity-drift:${projectId}`,
    payload: { value: 'same-delivery' },
  });
};

describe.runIf(pool)('WP-05 connector current-job identity authority', () => {
  it('reads and runs only the rotated current job while preserving historical job A', async () => {
    const projectId = `wp05-current-job-${randomUUID()}`;
    const identityBase = {
      projectId,
      securityScope: JSON.stringify({
        accessScope: ['owner'],
        sensitivity: 'public',
        dataClassification: 'connector-test',
      }),
      consumerId: 'connector.identity-test:event:ConnectorIdentityDriftEvent',
      messageKind: 'event' as const,
      messageType: 'ConnectorIdentityDriftEvent',
      semanticKey: `identity-drift:${projectId}`,
      fingerprint: `test-fingerprint:${projectId}`,
    };
    const dedup = new PostgresDedupStore(pool!);
    const jobs = new PostgresJobRuntime(pool!);
    const jobA = randomUUID();
    const jobB = randomUUID();

    try {
      const beganA = await dedup.begin({ ...identityBase, jobId: jobA });
      expect(beganA.kind).toBe('ACQUIRED');
      if (beganA.kind !== 'ACQUIRED' || !beganA.record.jobId) return;
      const dedupRow = await currentDedupRow(projectId);
      expect(dedupRow?.job_id).toBe(jobA);
      await jobs.enqueue({
        jobId: jobA,
        dedupRecordId: dedupRow!.dedup_record_id,
        identity: identityBase,
        correlationId: randomUUID(),
      });

      await expect(
        jobs.run(identityBase, randomUUID(), async () => {
          throw new ShotgunError({
            code: 'CONFIGURATION_REQUIRED',
            safeMessage: 'controlled first delivery failure',
            module: 'runtime-integrity-tests',
            operation: 'handler',
          });
        }),
      ).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
      await dedup.fail({
        identity: identityBase,
        fenceToken: beganA.record.fenceToken,
        jobId: jobA,
        safeErrorCode: 'CONFIGURATION_REQUIRED',
        safeErrorMessage: 'controlled first delivery failure',
      });

      const beganB = await dedup.begin({ ...identityBase, jobId: jobB });
      expect(beganB.kind).toBe('ACQUIRED');
      if (beganB.kind !== 'ACQUIRED') return;
      expect(beganB.record.jobId).toBe(jobB);
      expect(jobB).not.toBe(jobA);

      const currentBeforeRun = await currentDedupRow(projectId);
      expect(currentBeforeRun?.job_id).toBe(jobB);
      await jobs.enqueue({
        jobId: jobB,
        dedupRecordId: dedupRow!.dedup_record_id,
        identity: identityBase,
        correlationId: randomUUID(),
      });
      expect((await jobs.find(identityBase))?.jobId).toBe(jobB);

      let invocations = 0;
      const execution = await jobs.run(identityBase, randomUUID(), async (attempt) => {
        invocations += 1;
        expect(attempt.jobId).toBe(jobB);
        return { accepted: true };
      });
      expect(invocations).toBe(1);
      expect(execution.job.jobId).toBe(jobB);
      await dedup.complete({
        identity: identityBase,
        fenceToken: beganB.record.fenceToken,
        jobId: jobB,
        result: execution.result,
      });

      const rows = await pool!.query<{ job_id: string; status: string; attempts: string }>(
        `SELECT j.job_id, j.status,
                (SELECT COUNT(*) FROM connector.job_attempts a WHERE a.job_id=j.job_id)::text AS attempts
           FROM connector.jobs j
           JOIN connector.dedup_records d ON d.dedup_record_id=j.dedup_record_id
          WHERE d.project_id=$1
          ORDER BY j.created_at`,
        [projectId],
      );
      expect(rows.rows).toEqual([
        { job_id: jobA, status: 'failed', attempts: '1' },
        { job_id: jobB, status: 'succeeded', attempts: '1' },
      ]);
      expect((await currentDedupRow(projectId))?.state).toBe('COMPLETED');
      expect((await currentDedupRow(projectId))?.job_id).toBe(jobB);
    } finally {
      await cleanup(projectId);
    }
  });

  it('re-enters the same durable event on a rotated job and snapshots the current DLQ job', async () => {
    const projectId = `wp05-runtime-reentry-${randomUUID()}`;
    let fail = true;
    const state = new PostgresConnectorRuntimeState(pool!);
    const kernel = new ShotgunKernel(new InProcessTransport(), {
      connectorRuntimeState: state,
    });
    kernel.register(
      makeModule(async () => {
        if (fail) {
          throw new ShotgunError({
            code: 'CONFIGURATION_REQUIRED',
            safeMessage: 'controlled first delivery failure',
            module: 'connector.identity-test',
            operation: 'handler',
          });
        }
      }),
    );

    try {
      await kernel.start();
      const event = makeEvent(projectId);
      const first = await kernel.connector.publishEvent(event);
      expect(first.consumers).toMatchObject([
        { status: 'dead-letter', errorCode: 'CONFIGURATION_REQUIRED' },
      ]);
      const firstRow = await currentDedupRow(projectId);
      expect(firstRow?.state).toBe('FAILED');
      const firstJobId = firstRow?.job_id;
      expect(firstJobId).toBeTruthy();

      const firstIdentity = await makeIdentity(projectId);
      const firstDeadLetter = (await state.deadLetters.list())[0];
      expect(firstDeadLetter?.job?.jobId).toBe(firstJobId);
      expect((await state.jobs.find(firstIdentity))?.jobId).toBe(firstJobId);

      fail = false;
      const second = await kernel.connector.publishEvent(event);
      expect(second.consumers).toEqual([
        { consumerId: 'connector.identity-test', status: 'processed' },
      ]);
      const secondRow = await currentDedupRow(projectId);
      expect(secondRow?.state).toBe('COMPLETED');
      expect(secondRow?.job_id).toBeTruthy();
      expect(secondRow?.job_id).not.toBe(firstJobId);

      const secondIdentity = await makeIdentity(projectId);
      expect((await state.jobs.find(secondIdentity))?.jobId).toBe(secondRow?.job_id);
      const jobs = await state.jobs.list();
      expect(jobs.map((job) => job.jobId)).toEqual([firstJobId, secondRow?.job_id]);
      expect((await state.deadLetters.list())[0]?.job?.jobId).toBe(firstJobId);
    } finally {
      await kernel.shutdown();
      await cleanup(projectId);
    }
  });
});
