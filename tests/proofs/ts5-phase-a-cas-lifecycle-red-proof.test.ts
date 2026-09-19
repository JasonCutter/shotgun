import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalAssetStorage } from '../../adapters/asset-storage-local/src/index.js';

const roots: string[] = [];

const contentHash = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const walkFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(child)));
    else if (entry.isFile()) files.push(child);
  }
  return files.sort();
};

class FakeOriginalAssetAuthority {
  readonly rows = new Map<string, string>();
  failNext = false;

  async store(submissionId: string, storageKey: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated repository.store failure');
    }
    this.rows.set(submissionId, storageKey);
  }
}

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('TS-5 Phase A CAS lifecycle characterization', () => {
  it('proves the real CAS_UNREFERENCED orphan window after storage success and DB failure', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'shotgun-ts5-cas-red-'));
    roots.push(root);
    const storage = new LocalAssetStorage(root);
    const authority = new FakeOriginalAssetAuthority();
    const bytes = Buffer.from('TS-5 orphan window proof\n', 'utf8');
    const hash = contentHash(bytes);

    const storageKey = await storage.put(hash, bytes);
    authority.failNext = true;
    await expect(authority.store('failed-submission', storageKey)).rejects.toThrow(
      'simulated repository.store failure',
    );

    expect(authority.rows.has('failed-submission')).toBe(false);
    expect(Buffer.from(await storage.read(storageKey))).toEqual(bytes);
    await expect(stat(path.resolve(root, ...storageKey.split('/')))).resolves.toMatchObject({
      isFile: expect.any(Function),
      size: bytes.byteLength,
    });
  });

  it('proves a failed retry does not exclusively own a reused live CAS key', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'shotgun-ts5-cas-reuse-'));
    roots.push(root);
    const storage = new LocalAssetStorage(root);
    const authority = new FakeOriginalAssetAuthority();
    const bytes = Buffer.from('TS-5 shared CAS reuse proof\n', 'utf8');
    const hash = contentHash(bytes);

    const firstKey = await storage.put(hash, bytes);
    await authority.store('first-live-submission', firstKey);
    const secondKey = await storage.put(hash, bytes);
    authority.failNext = true;
    await expect(authority.store('second-failed-submission', secondKey)).rejects.toThrow(
      'simulated repository.store failure',
    );

    expect(secondKey).toBe(firstKey);
    expect(authority.rows.get('first-live-submission')).toBe(firstKey);
    expect(authority.rows.has('second-failed-submission')).toBe(false);

    const canonicalPath = path.resolve(root, ...firstKey.split('/'));
    await rm(canonicalPath);
    await expect(storage.read(firstKey)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('characterizes concurrent identical puts as one immutable canonical object', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'shotgun-ts5-cas-concurrent-'));
    roots.push(root);
    const storage = new LocalAssetStorage(root);
    const bytes = Buffer.from('TS-5 concurrent identical put proof\n', 'utf8');
    const hash = contentHash(bytes);

    const keys = await Promise.all(Array.from({ length: 32 }, () => storage.put(hash, bytes)));
    const files = await walkFiles(root);

    expect(new Set(keys)).toEqual(new Set([keys[0]]));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.blob$/u);
    expect(files.some((file) => file.endsWith('.tmp'))).toBe(false);
    expect(Buffer.from(await storage.read(keys[0]!))).toEqual(bytes);
  });

  it('records canonical path, temp-file, and traversal boundaries in an isolated root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'shotgun-ts5-cas-namespace-'));
    roots.push(root);
    const storage = new LocalAssetStorage(root);
    const bytes = Buffer.from('TS-5 namespace proof\n', 'utf8');
    const hash = contentHash(bytes);
    const storageKey = await storage.put(hash, bytes);
    const canonicalPath = path.resolve(root, ...storageKey.split('/'));
    const staleTemporaryPath = `${canonicalPath}.stale-proof.tmp`;

    expect(storageKey).toMatch(/^original\/sha256\/[0-9a-f]{2}\/[0-9a-f]{64}\.blob$/u);
    await writeFile(staleTemporaryPath, bytes, { flag: 'wx' });
    expect((await walkFiles(root)).some((file) => file.endsWith('.stale-proof.tmp'))).toBe(true);
    expect(Buffer.from(await readFile(canonicalPath))).toEqual(bytes);
    await expect(storage.read('../outside-root')).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
  });
});
