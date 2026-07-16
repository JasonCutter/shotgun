import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalAssetStorage } from '../../adapters/asset-storage-local/src/index.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('Local Asset Storage', () => {
  it('writes once by content hash and returns identical bytes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'shotgun-stage2-'));
    roots.push(root);
    const storage = new LocalAssetStorage(root);
    const bytes = Buffer.from('immutable\r\nbytes', 'utf8');
    const hash = 'sha256:8a9a03dc3010499107faafe421aaab48d03612a0f35a028be5d4d2b699adc016';

    const firstKey = await storage.put(hash, bytes);
    const secondKey = await storage.put(hash, bytes);

    expect(secondKey).toBe(firstKey);
    expect(Buffer.from(await storage.read(firstKey))).toEqual(bytes);
    expect(await readFile(path.resolve(root, ...firstKey.split('/')))).toEqual(bytes);
  });

  it('rejects bytes that do not match the declared content hash', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'shotgun-stage2-'));
    roots.push(root);
    const storage = new LocalAssetStorage(root);

    await expect(
      storage.put(
        'sha256:1dfb6b89c76f093150d473f40659e19070b4c608f90366d884643076c1ce7972',
        Buffer.from('different', 'utf8'),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
