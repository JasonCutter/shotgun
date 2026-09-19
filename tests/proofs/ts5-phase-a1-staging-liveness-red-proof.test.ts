import { createHash } from 'node:crypto';
import { mkdtemp, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { LocalAssetStorage } from '../../adapters/asset-storage-local/src/index.js';
import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';

const secret = 'ts5-a1-staging-liveness-proof-secret-at-least-32';
const bytes = new TextEncoder().encode('TS-5 A.1 staging reuse proof\n');
const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

describe('TS-5 A.1 staging liveness boundary', () => {
  it('proves an old CAS mtime can coexist with a fresh valid staging token', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'shotgun-ts5-a1-staging-'));
    const storage = new LocalAssetStorage(root);
    const firstKey = await storage.put(contentHash, bytes);
    const canonicalPath = path.resolve(root, ...firstKey.split('/'));
    const oldMtime = new Date('2025-01-01T00:00:00.000Z');
    await utimes(canonicalPath, oldMtime, oldMtime);
    const beforeStage = await stat(canonicalPath);

    const now = new Date('2026-09-19T00:00:00.000Z');
    const service = new SealedSourcesStagingService(storage, secret, undefined, () => now);
    const receipt = await service.stageBytes({
      draftId: 'draft-a1',
      itemId: 'item-a1',
      projectId: 'project-a1',
      principalId: 'principal-a1',
      kind: 'DIRECT_TEXT',
      label: 'A.1 staging proof',
      mediaType: 'text/plain',
      bytes,
    });
    const afterStage = await stat(canonicalPath);
    const artifact = await service.resolve({
      stagingReference: receipt.stagingReference,
      draftId: 'draft-a1',
      itemId: 'item-a1',
      projectId: 'project-a1',
      principalId: 'principal-a1',
      kind: 'DIRECT_TEXT',
    });

    expect(artifact.storageKey).toBe(firstKey);
    expect(receipt.contentHash).toBe(contentHash);
    expect(Date.parse(artifact.expiresAt) - Date.parse(artifact.issuedAt)).toBe(
      30 * 24 * 60 * 60 * 1_000,
    );
    expect(Date.parse(artifact.issuedAt)).toBe(now.getTime());
    expect(afterStage.mtimeMs).toBe(beforeStage.mtimeMs);
    expect(afterStage.mtimeMs).toBe(oldMtime.getTime());
    expect(Buffer.from(await storage.read(artifact.storageKey))).toEqual(Buffer.from(bytes));

    const finalDbLiveKeys = new Set<string>();
    expect(finalDbLiveKeys.has(artifact.storageKey)).toBe(false);
    expect(Date.parse(artifact.expiresAt)).toBeGreaterThan(now.getTime());
  });

  it('proves mtime-only orphan classification contradicts a valid staging lease', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'shotgun-ts5-a1-classification-'));
    const storage = new LocalAssetStorage(root);
    const storageKey = await storage.put(contentHash, bytes);
    const canonicalPath = path.resolve(root, ...storageKey.split('/'));
    const oldMtime = new Date('2025-01-01T00:00:00.000Z');
    await utimes(canonicalPath, oldMtime, oldMtime);

    const now = new Date('2026-09-19T00:00:00.000Z');
    const service = new SealedSourcesStagingService(storage, secret, undefined, () => now);
    const receipt = await service.stageBytes({
      draftId: 'draft-a1-classification',
      itemId: 'item-a1-classification',
      projectId: 'project-a1',
      principalId: 'principal-a1',
      kind: 'DIRECT_TEXT',
      label: 'A.1 classification proof',
      mediaType: 'text/plain',
      bytes,
    });
    const resolved = await service.resolve({
      stagingReference: receipt.stagingReference,
      draftId: 'draft-a1-classification',
      itemId: 'item-a1-classification',
      projectId: 'project-a1',
      principalId: 'principal-a1',
      kind: 'DIRECT_TEXT',
    });

    const finalDbLive = false;
    const olderThanGrace = oldMtime.getTime() < now.getTime() - 24 * 60 * 60 * 1_000;
    const naiveMtimeOnlyOrphan = !finalDbLive && olderThanGrace;

    expect(naiveMtimeOnlyOrphan).toBe(true);
    expect(Date.parse(resolved.expiresAt)).toBeGreaterThan(now.getTime());
    expect(resolved.storageKey).toBe(storageKey);
    expect(Buffer.from(await storage.read(resolved.storageKey))).toEqual(Buffer.from(bytes));
    expect(naiveMtimeOnlyOrphan).not.toBe(false);
  });
});
