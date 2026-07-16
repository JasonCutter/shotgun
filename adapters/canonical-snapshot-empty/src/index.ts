import type { CanonicalSnapshotPort } from '../../../modules/comparison/src/index.js';
import {
  canonicalSnapshotDigest,
  type CanonicalSnapshot,
} from '../../../packages/contracts/src/index.js';

export class EmptyCanonicalSnapshotAdapter implements CanonicalSnapshotPort {
  async getSnapshot(projectId: string): Promise<CanonicalSnapshot> {
    const claims = [] as const;
    return {
      snapshotId: `canonical-empty:${projectId}:0`,
      projectId,
      version: 0,
      digest: canonicalSnapshotDigest(projectId, 0, claims),
      claims,
      createdAt: '1970-01-01T00:00:00.000Z',
    };
  }
}
