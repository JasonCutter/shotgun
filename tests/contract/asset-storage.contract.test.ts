import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalAssetStorage } from '../../adapters/asset-storage-local/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import type { AssetStoragePort } from '../../modules/original-asset/src/index.js';

type StorageFixture = {
  readonly storage: AssetStoragePort;
  readonly cleanup: () => Promise<void>;
};

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const fixtures = [
  [
    'in-memory',
    async (): Promise<StorageFixture> => ({
      storage: new InMemoryAssetStorage(),
      cleanup: async () => undefined,
    }),
  ],
  [
    'local filesystem',
    async (): Promise<StorageFixture> => {
      const root = await mkdtemp(path.join(tmpdir(), 'shotgun-storage-contract-'));
      return {
        storage: new LocalAssetStorage(root),
        cleanup: async () => rm(root, { recursive: true, force: true }),
      };
    },
  ],
] as const;

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

describe.each(fixtures)('%s AssetStoragePort contract', (_name, createFixture) => {
  it('preserves bytes and makes repeated content-addressed writes idempotent', async () => {
    const fixture = await createFixture();
    cleanups.push(fixture.cleanup);
    const bytes = Buffer.from('immutable\r\noriginal bytes', 'utf8');
    const contentHash = sha256(bytes);

    const firstKey = await fixture.storage.put(contentHash, bytes);
    const secondKey = await fixture.storage.put(contentHash, bytes);

    expect(secondKey).toBe(firstKey);
    expect(Buffer.from(await fixture.storage.read(firstKey))).toEqual(bytes);
  });

  it('rejects a declared hash that does not match the bytes', async () => {
    const fixture = await createFixture();
    cleanups.push(fixture.cleanup);

    await expect(
      fixture.storage.put(sha256(Buffer.from('expected')), Buffer.from('different')),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('returns NOT_FOUND for an unknown storage key', async () => {
    const fixture = await createFixture();
    cleanups.push(fixture.cleanup);

    await expect(fixture.storage.read('missing/object')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
