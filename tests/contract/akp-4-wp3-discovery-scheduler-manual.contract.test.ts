import { describe, expect, it } from 'vitest';

import type {
  CommandEnvelope,
  DiscoveryManualTriggerRequestV1,
  DiscoveryProjectionReadinessPort,
  DiscoveryScheduleV1,
  DiscoveryCanonicalCommittedSourcePort,
} from '../../packages/contracts/src/index.js';
import {
  aggregateDiscoveryProjectionReadinessV1,
  createDefaultDiscoveryTriggerPolicyV1,
  DiscoveryTriggerCoordinator,
  PersistentDiscoveryScheduler,
  StaticDiscoveryTriggerPolicy,
  nextDiscoveryWeeklyOccurrenceV1,
} from '../../modules/discovery-trigger-coordinator/src/index.js';
import {
  InMemoryDiscoveryRuntimeRepository,
  InMemoryDiscoveryScheduleRepository,
} from '../../adapters/discovery-trigger-coordinator/src/index.js';

const projectId = 'wp3-project';
const canonicalBase = {
  schemaVersion: '1.0.0' as const,
  canonicalVersion: 7,
  snapshotDigest: 'sha256:canonical-7',
};
const requiredBase = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'semantic-corpus-source:v1:7',
  projectionDigest: 'sha256:source-7',
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

const manualEnvelope = (
  payload: DiscoveryManualTriggerRequestV1,
  overrides: Partial<CommandEnvelope<DiscoveryManualTriggerRequestV1>> = {},
): CommandEnvelope<DiscoveryManualTriggerRequestV1> => ({
  messageId: 'physical-delivery-1',
  messageType: 'RunKnowledgeDiscoveryDurable',
  messageKind: 'command',
  schemaVersion: '1.0.0',
  producerModule: 'shotgun-app',
  producerVersion: '1.0.0',
  correlationId: 'correlation-1',
  projectId,
  actor: { type: 'user', id: 'principal-1' },
  security: { accessScope: ['owner'], sensitivity: 'private', dataClassification: 'canonical' },
  payload,
  createdAt: '2026-08-30T00:00:00.000Z',
  traceId: 'trace-1',
  idempotencyKey: 'manual-envelope-1',
  ...overrides,
});

const createCoordinator = (runtime = new InMemoryDiscoveryRuntimeRepository()) => {
  let authority = { canonicalBase, requiredDiscoveryBase: requiredBase };
  let sequence = 0;
  const source: DiscoveryCanonicalCommittedSourcePort = {
    async resolve() {
      throw new Error('not used by manual/schedule tests');
    },
  };
  const coordinator = new DiscoveryTriggerCoordinator(
    source,
    readiness,
    runtime,
    new StaticDiscoveryTriggerPolicy({
      ...createDefaultDiscoveryTriggerPolicyV1(),
      waitTimeoutMs: 60_000,
    }),
    { now: () => '2026-08-30T00:00:00.000Z' },
    {
      jobId: () => `job-${++sequence}`,
      currentAuthority: {
        async resolve(requestedProjectId) {
          if (requestedProjectId !== projectId) throw new Error('wrong project');
          return { projectId: requestedProjectId, ...authority };
        },
      },
    },
  );
  return {
    coordinator,
    runtime,
    setAuthority(value: typeof authority) {
      authority = value;
    },
  };
};

const dueSchedule: DiscoveryScheduleV1 = {
  schemaVersion: '1.0.0',
  projectId,
  scheduleId: 'weekly-main',
  scheduleRevision: '1',
  status: 'ENABLED',
  timezone: 'UTC',
  dayOfWeek: 1,
  localTime: '09:00',
  nextOccurrenceAt: '2026-08-24T09:00:00.000Z',
  nextOccurrenceKey: '2026-08-24T09:00@UTC',
  updatedAt: '2026-08-23T00:00:00.000Z',
};

describe('AKP-4 WP3 persistent scheduler and manual normalization contracts', () => {
  it('computes a strictly future weekly local occurrence and rejects a DST gap', () => {
    expect(
      nextDiscoveryWeeklyOccurrenceV1({
        after: '2026-08-30T10:00:00.000Z',
        timezone: 'Asia/Seoul',
        dayOfWeek: 1,
        localTime: '09:00',
      }),
    ).toEqual({ at: '2026-08-31T00:00:00.000Z', key: '2026-08-31T09:00@Asia/Seoul' });
    expect(() =>
      nextDiscoveryWeeklyOccurrenceV1({
        after: '2026-03-08T00:00:00.000Z',
        timezone: 'America/New_York',
        dayOfWeek: 7,
        localTime: '02:30',
      }),
    ).toThrow(/does not exist/i);
    expect(() =>
      nextDiscoveryWeeklyOccurrenceV1({
        after: '2026-08-30T00:00:00.000Z',
        timezone: 'Not/IANA',
        dayOfWeek: 1,
        localTime: '09:00',
      }),
    ).toThrow(/timezone/i);
  });

  it('persists and reconstructs a schedule, and advances only after a durable Job outcome', async () => {
    const schedules = new InMemoryDiscoveryScheduleRepository();
    expect(await schedules.saveSchedule(dueSchedule)).toBe('CREATED');
    const reconstructed = await schedules.findSchedule(projectId, dueSchedule.scheduleId);
    expect(reconstructed).toEqual(dueSchedule);

    let fail = true;
    const first = createCoordinator();
    const scheduler = new PersistentDiscoveryScheduler(
      schedules,
      {
        coordinateScheduledFullScan: async (schedule) => {
          if (fail) throw new Error('authority unavailable');
          return first.coordinator.coordinateScheduledFullScan(schedule);
        },
      } as DiscoveryTriggerCoordinator,
      { now: () => '2026-08-30T00:00:00.000Z' },
    );
    await scheduler.tick();
    expect(await schedules.findSchedule(projectId, dueSchedule.scheduleId)).toMatchObject({
      nextOccurrenceKey: dueSchedule.nextOccurrenceKey,
    });
    fail = false;
    const result = await scheduler.tick();
    expect(result).toMatchObject({ jobsAccepted: 1, occurrencesAdvanced: 1 });
    const next = await schedules.findSchedule(projectId, dueSchedule.scheduleId);
    expect(next?.nextOccurrenceKey).toBe('2026-08-31T09:00@UTC');
  });

  it('deduplicates scheduled occurrences and manual redelivery/concurrency by stable identities', async () => {
    const first = createCoordinator();
    const schedules = new InMemoryDiscoveryScheduleRepository();
    await schedules.saveSchedule(dueSchedule);
    const scheduler = new PersistentDiscoveryScheduler(schedules, first.coordinator, {
      now: () => '2026-08-30T00:00:00.000Z',
    });
    await scheduler.tick();
    const scheduleReplay = await first.coordinator.coordinateScheduledFullScan({
      ...(await schedules.findSchedule(projectId, dueSchedule.scheduleId))!,
      nextOccurrenceAt: dueSchedule.nextOccurrenceAt,
      nextOccurrenceKey: dueSchedule.nextOccurrenceKey,
    });
    expect(scheduleReplay.disposition).toBe('ALREADY_EXISTS');

    const request = {
      commandId: 'command-1',
      requestId: 'request-1',
      requestedScanMode: 'FULL_SCAN' as const,
    };
    const results = await Promise.all([
      first.coordinator.coordinateManual(manualEnvelope(request)),
      first.coordinator.coordinateManual(
        manualEnvelope(request, {
          messageId: 'physical-delivery-2',
          idempotencyKey: 'different-delivery',
        }),
      ),
    ]);
    expect(new Set(results.map((result) => result.jobId))).toHaveLength(1);
    expect(results[1]?.disposition).toBe('ALREADY_EXISTS');
    const stored = await first.runtime.findJob({ projectId, jobId: results[0]!.jobId });
    expect(stored?.trigger.triggerClass).toBe('MANUAL');
    expect(stored?.effectiveScanMode).toBe('FULL_SCAN');
  });

  it('keeps the first server-owned binding on manual replay and rejects missing owner context', async () => {
    const first = createCoordinator();
    const request = {
      commandId: 'command-2',
      requestId: 'request-2',
      requestedScanMode: 'INCREMENTAL' as const,
    };
    const created = await first.coordinator.coordinateManual(manualEnvelope(request));
    first.setAuthority({
      canonicalBase: {
        ...canonicalBase,
        canonicalVersion: 8,
        snapshotDigest: 'sha256:canonical-8',
      },
      requiredDiscoveryBase: { ...requiredBase, projectionRevision: 'semantic-corpus-source:v1:8' },
    });
    const replay = await first.coordinator.coordinateManual(
      manualEnvelope(request, { messageId: 'physical-delivery-3' }),
    );
    expect(replay).toMatchObject({ disposition: 'ALREADY_EXISTS', jobId: created.jobId });
    const stored = await first.runtime.findJob({ projectId, jobId: created.jobId });
    expect(stored?.canonicalBase).toEqual(canonicalBase);
    await expect(
      first.coordinator.coordinateManual(
        manualEnvelope(request, { actor: undefined, security: undefined }),
      ),
    ).rejects.toThrow(/owner-authorized/i);
  });
});
