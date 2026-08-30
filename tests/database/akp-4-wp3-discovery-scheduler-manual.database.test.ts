import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryScheduleRepository } from '../../adapters/discovery-trigger-coordinator/src/index.js';
import { PostgresDiscoveryRuntimeRepository } from '../../adapters/discovery-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import {
  aggregateDiscoveryProjectionReadinessV1,
  createDefaultDiscoveryTriggerPolicyV1,
  DiscoveryTriggerCoordinator,
  PersistentDiscoveryScheduler,
  StaticDiscoveryTriggerPolicy,
} from '../../modules/discovery-trigger-coordinator/src/index.js';
import type {
  CommandEnvelope,
  DiscoveryManualTriggerRequestV1,
  DiscoveryScheduleV1,
  DiscoveryCanonicalCommittedSourcePort,
  DiscoveryProjectionReadinessPort,
} from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const poolA: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const poolB: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const createDueSchedule = (projectId: string): DiscoveryScheduleV1 => ({
  schemaVersion: '1.0.0',
  projectId,
  scheduleId: 'weekly',
  scheduleRevision: '1',
  status: 'ENABLED',
  timezone: 'UTC',
  dayOfWeek: 1,
  localTime: '09:00',
  nextOccurrenceAt: '2026-08-24T09:00:00.000Z',
  nextOccurrenceKey: '2026-08-24T09:00@UTC',
  updatedAt: '2026-08-23T00:00:00.000Z',
});

const manual = (
  projectId: string,
  requestId: string,
): CommandEnvelope<DiscoveryManualTriggerRequestV1> => ({
  messageId: `physical:${randomUUID()}`,
  messageType: 'RunKnowledgeDiscoveryDurable',
  messageKind: 'command',
  schemaVersion: '1.0.0',
  producerModule: 'test',
  producerVersion: '1.0.0',
  correlationId: `correlation:${requestId}`,
  projectId,
  actor: { type: 'user', id: 'owner' },
  security: { accessScope: ['owner'], sensitivity: 'private', dataClassification: 'test' },
  payload: { commandId: `command:${requestId}`, requestId, requestedScanMode: 'INCREMENTAL' },
  createdAt: '2026-08-30T00:00:00.000Z',
  traceId: `trace:${requestId}`,
  idempotencyKey: `delivery:${requestId}`,
});

describe.runIf(databaseUrl)('AKP-4 WP3 PostgreSQL scheduler/manual authority proof', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await poolA!.end();
    await poolB!.end();
  });

  it('persists/reconstructs schedules and uses PostgreSQL uniqueness plus CAS for one due Job', async () => {
    const projectId = `akp-4-wp3-${randomUUID()}`;
    await poolA!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, $2, 'ACTIVE', true)`,
      [projectId, 'AKP-4 WP3 scheduler test'],
    );
    const schedules = new PostgresDiscoveryScheduleRepository(poolA!);
    const due = createDueSchedule(projectId);
    expect(await schedules.saveSchedule(due)).toBe('CREATED');
    expect(await schedules.findSchedule(projectId, due.scheduleId)).toEqual(due);

    const runtimeA = new PostgresDiscoveryRuntimeRepository(poolA!);
    const runtimeB = new PostgresDiscoveryRuntimeRepository(poolB!);
    let sequence = 0;
    const source: DiscoveryCanonicalCommittedSourcePort = {
      async resolve() {
        throw new Error('not used');
      },
    };
    const readiness: DiscoveryProjectionReadinessPort = {
      async read(input) {
        return aggregateDiscoveryProjectionReadinessV1({
          requiredBase: input.requiredBase,
          observedAt: input.observedAt,
          observations: input.projectionKinds.map((projectionKind) => ({
            projectionKind,
            requiredIdentity: input.requiredBase,
            status: 'READY',
            observedIdentity: input.requiredBase,
          })),
        });
      },
    };
    const authority = {
      resolve: async (requestedProjectId: string) => ({
        projectId: requestedProjectId,
        canonicalBase: {
          schemaVersion: '1.0.0' as const,
          canonicalVersion: 1,
          snapshotDigest: `sha256:${projectId}:canonical`,
        },
        requiredDiscoveryBase: {
          schemaVersion: '1.0.0' as const,
          projectionRevision: 'semantic-corpus-source:v1:1',
          projectionDigest: `sha256:${projectId}:source`,
        },
      }),
    };
    const makeCoordinator = (runtime: PostgresDiscoveryRuntimeRepository) =>
      new DiscoveryTriggerCoordinator(
        source,
        readiness,
        runtime,
        new StaticDiscoveryTriggerPolicy(createDefaultDiscoveryTriggerPolicyV1()),
        { now: () => '2026-08-30T00:00:00.000Z' },
        { jobId: () => `job:${++sequence}`, currentAuthority: authority },
      );
    const [left, right] = await Promise.all([
      new PersistentDiscoveryScheduler(schedules, makeCoordinator(runtimeA), {
        now: () => '2026-08-30T00:00:00.000Z',
      }).tick(),
      new PersistentDiscoveryScheduler(schedules, makeCoordinator(runtimeB), {
        now: () => '2026-08-30T00:00:00.000Z',
      }).tick(),
    ]);
    expect(left.jobsAccepted + right.jobsAccepted).toBeGreaterThanOrEqual(1);
    expect(left.occurrencesAdvanced + right.occurrencesAdvanced).toBe(1);
    expect(
      await poolA!.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM discovery.jobs
         WHERE project_id = $1 AND trigger_class = 'SCHEDULED_FULL_SCAN'`,
        [projectId],
      ),
    ).toMatchObject({ rows: [{ count: '1' }] });
    expect((await schedules.findSchedule(projectId, due.scheduleId))?.nextOccurrenceKey).toBe(
      '2026-08-31T09:00@UTC',
    );
  });

  it('keeps the durable manual Job binding across mutable-base replay and concurrent delivery', async () => {
    const projectId = `akp-4-wp3-manual-${randomUUID()}`;
    await poolA!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, $2, 'ACTIVE', true)`,
      [projectId, 'AKP-4 WP3 manual test'],
    );
    const runtimeA = new PostgresDiscoveryRuntimeRepository(poolA!);
    const runtimeB = new PostgresDiscoveryRuntimeRepository(poolB!);
    const source: DiscoveryCanonicalCommittedSourcePort = {
      async resolve() {
        throw new Error('not used');
      },
    };
    const readiness: DiscoveryProjectionReadinessPort = {
      async read(input) {
        return aggregateDiscoveryProjectionReadinessV1({
          requiredBase: input.requiredBase,
          observedAt: input.observedAt,
          observations: input.projectionKinds.map((projectionKind) => ({
            projectionKind,
            requiredIdentity: input.requiredBase,
            status: 'READY',
            observedIdentity: input.requiredBase,
          })),
        });
      },
    };
    let version = 1;
    const authority = {
      resolve: async (requestedProjectId: string) => ({
        projectId: requestedProjectId,
        canonicalBase: {
          schemaVersion: '1.0.0' as const,
          canonicalVersion: version,
          snapshotDigest: `sha256:${requestedProjectId}:canonical:${version}`,
        },
        requiredDiscoveryBase: {
          schemaVersion: '1.0.0' as const,
          projectionRevision: `semantic-corpus-source:v1:${version}`,
          projectionDigest: `sha256:${requestedProjectId}:source:${version}`,
        },
      }),
    };
    const coordinator = (runtime: PostgresDiscoveryRuntimeRepository) =>
      new DiscoveryTriggerCoordinator(
        source,
        readiness,
        runtime,
        new StaticDiscoveryTriggerPolicy(createDefaultDiscoveryTriggerPolicyV1()),
        { now: () => '2026-08-30T00:00:00.000Z' },
        { currentAuthority: authority },
      );
    const request = manual(projectId, 'request-1');
    const [first, duplicate] = await Promise.all([
      coordinator(runtimeA).coordinateManual(request),
      coordinator(runtimeB).coordinateManual({
        ...request,
        messageId: 'different-physical-delivery',
      }),
    ]);
    expect(new Set([first.jobId, duplicate.jobId])).toHaveLength(1);
    const original = await runtimeA.findJob({ projectId, jobId: first.jobId });
    version = 2;
    const replay = await coordinator(runtimeA).coordinateManual({
      ...request,
      messageId: 'replay',
    });
    const stored = await runtimeA.findJob({ projectId, jobId: first.jobId });
    expect(replay).toMatchObject({ disposition: 'ALREADY_EXISTS', jobId: first.jobId });
    expect(stored?.canonicalBase).toEqual(original?.canonicalBase);
    expect(stored?.requiredDiscoveryBase).toEqual(original?.requiredDiscoveryBase);
    expect(
      await poolA!.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM discovery.jobs WHERE project_id = $1`,
        [projectId],
      ),
    ).toMatchObject({ rows: [{ count: '1' }] });
  });
});
