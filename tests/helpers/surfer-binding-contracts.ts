import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeSurferBindingCaptureV2,
  type SurferBindingStorePortV2,
} from '../../packages/contracts/src/surfer-source-binding-v2.js';
export function surferBindingContracts(label: string, factory: () => SurferBindingStorePortV2) {
  describe(label, () => {
    it('keeps v1/unknown authority/query fields out of the versioned capture codec', () => {
      const request = {
        schemaVersion: '2.0.0',
        sourceIds: [],
        artifacts: [],
        queries: [{ kind: 'OPEN_QUERY' }],
      };
      expect(decodeSurferBindingCaptureV2(request)).toEqual(request);
      expect(() => decodeSurferBindingCaptureV2({ ...request, schemaVersion: '1.0.0' })).toThrow();
      expect(() => decodeSurferBindingCaptureV2({ ...request, authorized: true })).toThrow();
      expect(() =>
        decodeSurferBindingCaptureV2({
          ...request,
          queries: [{ kind: 'SEMANTICALLY_UNRELATED', confidence: 1 }],
        }),
      ).toThrow();
    });
    it('serializes concurrent watermark updates without losing a revision', async () => {
      const store = factory(),
        id = randomUUID();
      await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          store.transaction(id, (state) => {
            state.watermarks.push({
              principalId: String(i),
              sourceSnapshotDigest: `fixture-${i}`,
              observedAt: '2026-10-27T00:00:00.000Z',
            });
            state.sequence++;
          }),
        ),
      );
      const value = await store.transaction(id, (s) => s);
      expect(value.sequence).toBe(6);
      expect(value.watermarks).toHaveLength(6);
    });
    it('copies returned state and rolls back throw/identity/schema mutations', async () => {
      const store = factory(),
        id = randomUUID();
      const copy = await store.transaction(id, (s) => s);
      copy.spaceId = 'changed';
      await expect(
        store.transaction(id, (s) => {
          s.spaceId = 'changed';
          s.sequence++;
        }),
      ).rejects.toThrow();
      await expect(
        store.transaction(id, (s) => {
          s.sequence++;
          throw new Error('rollback');
        }),
      ).rejects.toThrow();
      await expect(store.transaction(id, (() => Promise.resolve(null)) as never)).rejects.toThrow();
      expect((await store.transaction(id, (s) => s)).spaceId).toBe(id);
      expect((await store.transaction(id, (s) => s)).sequence).toBe(0);
    });
    it('separates projects and rejects unversioned mutations', async () => {
      const store = factory(),
        a = randomUUID(),
        b = randomUUID();
      await expect(
        store.transaction(a, (s) => {
          s.activeSnapshotId = 'unversioned';
        }),
      ).rejects.toThrow();
      await store.transaction(a, (s) => {
        s.activeSnapshotId = 'v2';
        s.sequence++;
      });
      expect((await store.transaction(b, (s) => s)).activeSnapshotId).toBeNull();
    });
  });
}
