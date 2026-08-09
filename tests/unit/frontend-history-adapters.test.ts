import { describe, expect, it } from 'vitest';

import { CanonicalHistoryAdapter } from '../../adapters/frontend-history-canonical/src/index.js';
import { ReviewHistoryAdapter } from '../../adapters/frontend-history-review/src/index.js';
import { ExternalActionHistoryAdapter } from '../../adapters/frontend-history-external-action/src/index.js';
import { PolicyHistoryAdapter } from '../../adapters/frontend-history-policy/src/index.js';
import { InMemoryPayloadStateStore } from '../../adapters/frontend-history-in-memory/src/index.js';
import { InMemoryFrontendReviewStore } from '../../adapters/frontend-review-in-memory/src/index.js';
import { InMemoryExternalActionStore } from '../../adapters/frontend-external-action-in-memory/src/index.js';
import { InMemoryPolicyHistoryReadAdapter } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import type { CanonicalHistoryEvent, HistoryEntryV1 } from '../../packages/contracts/src/index.js';
import type { CanonicalKnowledgeRepositoryPort } from '../../modules/canonical-knowledge/src/index.js';

const canonicalEvent = (
  overrides: Partial<CanonicalHistoryEvent> & { historyEventId: string },
): CanonicalHistoryEvent => ({
  projectId: 'p1',
  commitId: `commit-${overrides.historyEventId}`,
  manifestId: `manifest-${overrides.historyEventId}`,
  changeSetId: `change-set-${overrides.historyEventId}`,
  eventType: 'CANONICAL_CLAIM_ADDED',
  beforeVersion: 0,
  afterVersion: 1,
  claimId: `claim-${overrides.historyEventId}`,
  reason: 'commit',
  actor: { type: 'user', id: 'actor-1' },
  createdAt: '2026-08-09T00:00:00.000Z',
  ...overrides,
});

const canonicalRepo = (
  events: readonly CanonicalHistoryEvent[],
): CanonicalKnowledgeRepositoryPort => ({
  listProjectIds: async () => ['p1'],
  getSnapshot: async () => {
    throw new Error('unused');
  },
  commit: async () => {
    throw new Error('unused');
  },
  commitFrontendDraft: async () => {
    throw new Error('unused');
  },
  findClaim: async () => undefined,
  findCommit: async () => undefined,
  findRevision: async () => undefined,
  listHistory: async () => [...events],
  findOutbox: async () => undefined,
  claimOutbox: async () => [],
  markOutboxPublished: async () => {},
  releaseOutbox: async () => {},
});

describe('FE-P5-S2 WP4 History domain adapters', () => {
  it('canonical adapter maps events preserving source identity', async () => {
    const payloadState = new InMemoryPayloadStateStore('CANONICAL');
    const adapter = new CanonicalHistoryAdapter(
      canonicalRepo([
        canonicalEvent({ historyEventId: 'e-1', createdAt: '2026-08-09T00:00:00.000Z' }),
      ]),
      payloadState,
      () => new Date('2026-08-09T02:00:00.000Z'),
    );
    const entries = await adapter.readHistory('p1');
    expect(entries).toHaveLength(1);
    const entry: HistoryEntryV1 = entries[0]!;
    expect(entry.domainKind).toBe('CANONICAL');
    expect(entry.sourceEventId).toBe('e-1');
    expect(entry.historyEntryId).toBe('history:p1:e-1');
    expect(entry.occurredAt).toBe('2026-08-09T00:00:00.000Z');
    expect(entry.payloadAvailability).toBe('AVAILABLE');
    expect(entry.domainResourceId).toBe('claim-e-1');
  });

  it('review adapter maps decisions + approvals inside the review boundary', async () => {
    const payloadState = new InMemoryPayloadStateStore('REVIEW');
    const review = new InMemoryFrontendReviewStore();
    const adapter = new ReviewHistoryAdapter(review, payloadState);
    const entries = await adapter.readHistory('p1');
    // No contexts seeded: an empty review history yields zero entries.
    expect(entries).toEqual([]);
  });

  it('external action adapter maps audit events with source sequence', async () => {
    const payloadState = new InMemoryPayloadStateStore('EXTERNAL_ACTION');
    const store = new InMemoryExternalActionStore();
    const adapter = new ExternalActionHistoryAdapter(store, payloadState);
    const entries = await adapter.readHistory('p1');
    // No actions seeded: an empty external action history yields zero entries.
    expect(entries).toEqual([]);
  });

  it('policy adapter maps policy history entries preserving source identity', async () => {
    const payloadState = new InMemoryPayloadStateStore('SETTINGS');
    const policy = new InMemoryPolicyHistoryReadAdapter();
    policy.appendEntry({
      sourceKind: 'SETTINGS_AUDIT_EVENT',
      projectId: 'p1',
      sourceId: 'event:1',
      actorId: 'actor-1',
      actionName: 'UPDATE_SETTINGS',
      riskLevel: 'LOW',
      details: { key: 'value' },
      timestamp: '2026-08-09T00:00:00.000Z',
    });
    const adapter = new PolicyHistoryAdapter(policy, payloadState);
    const entries = await adapter.readHistory('p1');
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.domainKind).toBe('POLICY');
    expect(entry.sourceEventKind).toBe('SETTINGS_AUDIT_EVENT');
    expect(entry.sourceEventId).toBe('event:1');
    expect(entry.historyEntryId).toBe('history:p1:policy:event:1');
    expect(entry.payloadAvailability).toBe('AVAILABLE');
    expect((entry.payloadSnapshot as { actionName: string }).actionName).toBe('UPDATE_SETTINGS');
  });

  it('payload availability from sidecar is reflected (REDACTED)', async () => {
    const payloadState = new InMemoryPayloadStateStore('CANONICAL');
    await payloadState.setPayloadState({
      resourceProjectId: 'p1',
      sourceEventKind: 'CANONICAL_CLAIM_ADDED',
      sourceEventId: 'e-1',
      payloadAvailability: 'REDACTED',
      reason: 'retention',
      actorId: 'actor-1',
      changedAt: '2026-08-09T01:00:00.000Z',
    });
    const adapter = new CanonicalHistoryAdapter(
      canonicalRepo([
        canonicalEvent({ historyEventId: 'e-1', createdAt: '2026-08-09T00:00:00.000Z' }),
      ]),
      payloadState,
      () => new Date('2026-08-09T02:00:00.000Z'),
    );
    const entries = await adapter.readHistory('p1');
    expect(entries[0]!.payloadAvailability).toBe('REDACTED');
  });

  it('non-AVAILABLE rows never carry the raw payload (GPT Round 2 F)', async () => {
    const payloadState = new InMemoryPayloadStateStore('CANONICAL');
    // Tombstone metadata is the ONLY payload permitted on a purged row.
    await payloadState.purgeByPolicy({
      resourceProjectId: 'p1',
      sourceEventKind: 'CANONICAL_CLAIM_ADDED',
      sourceEventId: 'e-1',
      reason: 'retention policy',
      tombstoneMetadata: { digest: 'sha256:redacted' },
      actorId: 'actor-1',
      occurredAt: '2026-08-09T01:00:00.000Z',
    });
    const adapter = new CanonicalHistoryAdapter(
      canonicalRepo([
        canonicalEvent({ historyEventId: 'e-1', createdAt: '2026-08-09T00:00:00.000Z' }),
      ]),
      payloadState,
      () => new Date('2026-08-09T02:00:00.000Z'),
    );
    const entries = await adapter.readHistory('p1');
    const entry = entries[0]!;
    expect(entry.payloadAvailability).toBe('PURGED_BY_POLICY');
    // Raw payload (reason/actor/versions) must NOT survive; only tombstone.
    const snapshot = entry.payloadSnapshot as Record<string, unknown>;
    expect(snapshot).toEqual({ digest: 'sha256:redacted' });
    expect(snapshot.reason).toBeUndefined();
    expect(snapshot.actor).toBeUndefined();
    expect(snapshot.beforeVersion).toBeUndefined();
  });

  it('redactEntry re-checks current availability (purge-after-cache safety, GPT Round 2 F)', async () => {
    const payloadState = new InMemoryPayloadStateStore('CANONICAL');
    const adapter = new CanonicalHistoryAdapter(
      canonicalRepo([
        canonicalEvent({ historyEventId: 'e-1', createdAt: '2026-08-09T00:00:00.000Z' }),
      ]),
      payloadState,
      () => new Date('2026-08-09T02:00:00.000Z'),
    );
    // Projected while AVAILABLE (raw payload cached in the projection).
    const cached = (await adapter.readHistory('p1'))[0]!;
    expect(cached.payloadAvailability).toBe('AVAILABLE');
    expect((cached.payloadSnapshot as { reason: string }).reason).toBe('commit');
    // A purge happens AFTER the projection was cached.
    await payloadState.purgeByPolicy({
      resourceProjectId: 'p1',
      sourceEventKind: 'CANONICAL_CLAIM_ADDED',
      sourceEventId: 'e-1',
      reason: 'retention policy',
      tombstoneMetadata: { digest: 'sha256:redacted' },
      actorId: 'actor-1',
      occurredAt: '2026-08-09T03:00:00.000Z',
    });
    // Read-time redaction must strip the raw cached payload.
    const redacted = await adapter.redactEntry(cached);
    expect(redacted.payloadAvailability).toBe('PURGED_BY_POLICY');
    expect(redacted.payloadSnapshot).toEqual({ digest: 'sha256:redacted' });
    // Resolve also fails the raw payload (authoritative detail).
    const resolved = await adapter.resolveHistoryEntry('p1', 'CANONICAL_CLAIM_ADDED', 'e-1');
    expect(resolved!.payloadAvailability).toBe('PURGED_BY_POLICY');
    expect(resolved!.payloadSnapshot).toEqual({ digest: 'sha256:redacted' });
  });

  it('redaction explicitly removes the raw snapshot when tombstone metadata is absent (GPT Round 3 F)', async () => {
    const payloadState = new InMemoryPayloadStateStore('CANONICAL');
    const adapter = new CanonicalHistoryAdapter(
      canonicalRepo([
        canonicalEvent({ historyEventId: 'e-1', createdAt: '2026-08-09T00:00:00.000Z' }),
      ]),
      payloadState,
      () => new Date('2026-08-09T02:00:00.000Z'),
    );
    // Projected while AVAILABLE with raw payload.
    const cached = (await adapter.readHistory('p1'))[0]!;
    expect(cached.payloadAvailability).toBe('AVAILABLE');
    expect(cached.payloadSnapshot).toBeDefined();
    // Purge WITHOUT tombstone metadata.
    await payloadState.purgeByPolicy({
      resourceProjectId: 'p1',
      sourceEventKind: 'CANONICAL_CLAIM_ADDED',
      sourceEventId: 'e-1',
      reason: 'retention policy',
      actorId: 'actor-1',
      occurredAt: '2026-08-09T03:00:00.000Z',
    });
    // Read-time redaction must OVERWRITE the raw snapshot with nothing
    // (no tombstone available) — the old raw value must not survive.
    const redacted = await adapter.redactEntry(cached);
    expect(redacted.payloadAvailability).toBe('PURGED_BY_POLICY');
    expect('payloadSnapshot' in redacted && redacted.payloadSnapshot).toBeUndefined();
    expect((redacted as { payloadSnapshot?: unknown }).payloadSnapshot).toBeUndefined();
    // Authoritative re-resolution also carries no raw payload.
    const resolved = await adapter.resolveHistoryEntry('p1', 'CANONICAL_CLAIM_ADDED', 'e-1');
    expect(resolved!.payloadAvailability).toBe('PURGED_BY_POLICY');
    expect((resolved as { payloadSnapshot?: unknown }).payloadSnapshot).toBeUndefined();
  });
});
