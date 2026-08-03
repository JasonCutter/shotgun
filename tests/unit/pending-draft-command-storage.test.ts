import { describe, expect, it } from 'vitest';

import {
  clearAllPendingKnowledgeDraftCommandIdentities,
  clearPendingKnowledgeDraftCommandIdentity,
  decodePendingKnowledgeDraftCommandIdentity,
  encodePendingKnowledgeDraftCommandIdentity,
  pendingKnowledgeDraftCommandStorageKey,
  readPendingKnowledgeDraftCommandIdentity,
  writePendingKnowledgeDraftCommandIdentity,
  type PendingCommandStorage,
  type PendingKnowledgeDraftCommandIdentityV1,
} from '../../apps/shotgun-web/src/knowledge/pending-draft-command-storage.js';

class MemoryStorage implements PendingCommandStorage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

const identity = (
  overrides: Partial<PendingKnowledgeDraftCommandIdentityV1> = {},
): PendingKnowledgeDraftCommandIdentityV1 => ({
  clientRequestId: 'req-1',
  idempotencyKey: 'idem-1',
  semanticDigest: 'sha256:save',
  sessionId: 'session-1',
  projectId: 'project-1',
  draftId: 'draft-seed-1',
  ...overrides,
});

describe('pending Knowledge Draft command identity storage', () => {
  it('round-trips an identity through the session-scoped key', () => {
    const storage = new MemoryStorage();
    const entry = identity();
    writePendingKnowledgeDraftCommandIdentity(storage, entry);

    const key = pendingKnowledgeDraftCommandStorageKey(
      entry.sessionId,
      entry.projectId,
      entry.draftId,
    );
    expect(storage.getItem(key)).toBe(encodePendingKnowledgeDraftCommandIdentity(entry));
    expect(
      readPendingKnowledgeDraftCommandIdentity(
        storage,
        entry.sessionId,
        entry.projectId,
        entry.draftId,
      ),
    ).toEqual(entry);
  });

  it('is scoped per Session / Project / Draft and never read across them', () => {
    const storage = new MemoryStorage();
    writePendingKnowledgeDraftCommandIdentity(storage, identity());

    // Another Session with the same Project / Draft must not see the entry.
    expect(
      readPendingKnowledgeDraftCommandIdentity(
        storage,
        'session-other',
        'project-1',
        'draft-seed-1',
      ),
    ).toBeNull();
    // Another Project with the same Session / Draft must not see the entry.
    expect(
      readPendingKnowledgeDraftCommandIdentity(
        storage,
        'session-1',
        'project-other',
        'draft-seed-1',
      ),
    ).toBeNull();
    // Another Draft with the same Session / Project must not see the entry.
    expect(
      readPendingKnowledgeDraftCommandIdentity(storage, 'session-1', 'project-1', 'draft-other'),
    ).toBeNull();
  });

  it('clear removes only the scoped entry and clearAll removes every pending entry', () => {
    const storage = new MemoryStorage();
    writePendingKnowledgeDraftCommandIdentity(storage, identity());
    writePendingKnowledgeDraftCommandIdentity(
      storage,
      identity({ sessionId: 'session-2', draftId: 'draft-2' }),
    );
    storage.setItem('unrelated-key', 'keep');

    clearPendingKnowledgeDraftCommandIdentity(storage, 'session-1', 'project-1', 'draft-seed-1');
    expect(
      readPendingKnowledgeDraftCommandIdentity(storage, 'session-1', 'project-1', 'draft-seed-1'),
    ).toBeNull();
    expect(
      readPendingKnowledgeDraftCommandIdentity(storage, 'session-2', 'project-1', 'draft-2'),
    ).not.toBeNull();
    expect(storage.getItem('unrelated-key')).toBe('keep');

    clearAllPendingKnowledgeDraftCommandIdentities(storage);
    expect(storage.length).toBe(1);
    expect(storage.getItem('unrelated-key')).toBe('keep');
  });

  it('rejects malformed entries and defensively removes them on read', () => {
    expect(decodePendingKnowledgeDraftCommandIdentity('not-json')).toBeNull();
    expect(decodePendingKnowledgeDraftCommandIdentity('{}')).toBeNull();
    expect(
      decodePendingKnowledgeDraftCommandIdentity(
        JSON.stringify({
          clientRequestId: 'req-1',
          idempotencyKey: 'idem-1',
          semanticDigest: 'sha256:save',
          sessionId: 7,
          projectId: 'project-1',
          draftId: 'draft-seed-1',
        }),
      ),
    ).toBeNull();
    expect(
      decodePendingKnowledgeDraftCommandIdentity(
        JSON.stringify({
          clientRequestId: 'req-1',
          idempotencyKey: 'idem-1',
          semanticDigest: 'sha256:save',
          sessionId: 'session-1',
          projectId: 'project-1',
          draftId: 'draft-seed-1',
        }),
      ),
    ).toEqual(identity());

    const storage = new MemoryStorage();
    storage.setItem(
      pendingKnowledgeDraftCommandStorageKey('session-1', 'project-1', 'draft-seed-1'),
      'garbage',
    );
    expect(
      readPendingKnowledgeDraftCommandIdentity(storage, 'session-1', 'project-1', 'draft-seed-1'),
    ).toBeNull();
    expect(
      storage.getItem(
        pendingKnowledgeDraftCommandStorageKey('session-1', 'project-1', 'draft-seed-1'),
      ),
    ).toBeNull();
  });
});
