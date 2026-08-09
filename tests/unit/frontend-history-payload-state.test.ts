import { describe, expect, it } from 'vitest';

import { InMemoryPayloadStateStore } from '../../adapters/frontend-history-in-memory/src/index.js';

const now = '2026-08-09T00:00:00.000Z';

describe('frontend-history WP2-B Payload Availability / Retention / Tombstone', () => {
  it('sets availability state and reads it back', async () => {
    const store = new InMemoryPayloadStateStore('CANONICAL');
    const record = await store.setPayloadState({
      resourceProjectId: 'p1',
      sourceEventKind: 'DECISION',
      sourceEventId: 'event:1',
      payloadAvailability: 'AVAILABLE',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });
    expect(record.payloadAvailability).toBe('AVAILABLE');
    expect(await store.getPayloadState('p1', 'DECISION', 'event:1')).toEqual(record);
    expect(await store.getPayloadState('p1', 'DECISION', 'missing')).toBeNull();
  });

  it('purges by policy: flips sidecar AND appends purge audit atomically', async () => {
    const store = new InMemoryPayloadStateStore('CANONICAL');
    await store.setPayloadState({
      resourceProjectId: 'p1',
      sourceEventKind: 'DECISION',
      sourceEventId: 'event:1',
      payloadAvailability: 'AVAILABLE',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });
    const purged = await store.purgeByPolicy({
      resourceProjectId: 'p1',
      sourceEventKind: 'DECISION',
      sourceEventId: 'event:1',
      policyRevision: 'policy/1',
      reason: 'retention',
      tombstoneMetadata: { digest: 'sha256:aaaa' },
      actorId: 'admin-1',
      occurredAt: now,
    });
    expect(purged.payloadAvailability).toBe('PURGED_BY_POLICY');
    expect(purged.tombstoneMetadata).toEqual({ digest: 'sha256:aaaa' });
    // purge audit appended
    const audit = store.listPurgeAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.reason).toBe('retention');
    expect(audit[0]!.policyRevision).toBe('policy/1');
  });

  it('rejects re-purge (already PURGED_BY_POLICY)', async () => {
    const store = new InMemoryPayloadStateStore('REVIEW');
    await store.setPayloadState({
      resourceProjectId: 'p1',
      sourceEventKind: 'APPROVAL',
      sourceEventId: 'event:1',
      payloadAvailability: 'REDACTED',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });
    await store.purgeByPolicy({
      resourceProjectId: 'p1',
      sourceEventKind: 'APPROVAL',
      sourceEventId: 'event:1',
      reason: 'first purge',
      actorId: 'admin-1',
      occurredAt: now,
    });
    await expect(
      store.purgeByPolicy({
        resourceProjectId: 'p1',
        sourceEventKind: 'APPROVAL',
        sourceEventId: 'event:1',
        reason: 'second purge',
        actorId: 'admin-1',
        occurredAt: now,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects direct set of PURGED_BY_POLICY (purgeByPolicy is the only purge authority)', async () => {
    const store = new InMemoryPayloadStateStore('CANONICAL');
    await store.setPayloadState({
      resourceProjectId: 'p1',
      sourceEventKind: 'DECISION',
      sourceEventId: 'event:1',
      payloadAvailability: 'AVAILABLE',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });
    await expect(
      store.setPayloadState({
        resourceProjectId: 'p1',
        sourceEventKind: 'DECISION',
        sourceEventId: 'event:1',
        payloadAvailability: 'PURGED_BY_POLICY',
        reason: 'bypass',
        actorId: 'actor-1',
        changedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    // No purge audit was appended
    expect(store.listPurgeAudit()).toHaveLength(0);
    // State remains AVAILABLE
    expect((await store.getPayloadState('p1', 'DECISION', 'event:1'))?.payloadAvailability).toBe(
      'AVAILABLE',
    );
  });

  it('rejects resurrection after purge (PURGED_BY_POLICY -> AVAILABLE/REDACTED)', async () => {
    const store = new InMemoryPayloadStateStore('REVIEW');
    await store.setPayloadState({
      resourceProjectId: 'p1',
      sourceEventKind: 'APPROVAL',
      sourceEventId: 'event:1',
      payloadAvailability: 'AVAILABLE',
      reason: 'initial',
      actorId: 'actor-1',
      changedAt: now,
    });
    await store.purgeByPolicy({
      resourceProjectId: 'p1',
      sourceEventKind: 'APPROVAL',
      sourceEventId: 'event:1',
      reason: 'purge',
      actorId: 'admin-1',
      occurredAt: now,
    });
    await expect(
      store.setPayloadState({
        resourceProjectId: 'p1',
        sourceEventKind: 'APPROVAL',
        sourceEventId: 'event:1',
        payloadAvailability: 'AVAILABLE',
        reason: 'resurrect',
        actorId: 'actor-1',
        changedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      store.setPayloadState({
        resourceProjectId: 'p1',
        sourceEventKind: 'APPROVAL',
        sourceEventId: 'event:1',
        payloadAvailability: 'REDACTED',
        reason: 'resurrect',
        actorId: 'actor-1',
        changedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects invalid inputs', async () => {
    const store = new InMemoryPayloadStateStore('SETTINGS');
    await expect(
      store.setPayloadState({
        resourceProjectId: '',
        sourceEventKind: 'DECISION',
        sourceEventId: 'e',
        payloadAvailability: 'AVAILABLE',
        reason: 'x',
        actorId: 'a',
        changedAt: now,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
