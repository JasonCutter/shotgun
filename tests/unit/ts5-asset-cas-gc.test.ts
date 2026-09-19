import { createHash } from 'node:crypto';
import {
  access,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createQuarantineRunId,
  isQuarantineRunId,
  isCanonicalStorageKey,
  scanCanonicalCas,
  sweepQuarantine,
} from '../../scripts/asset-cas-gc.js';

const roots: string[] = [];
const runId = '20260919000000000-00000000-0000-4000-8000-000000000001';
const emptyDatabase = (options?: {
  readonly final?: { storageKey: string; contentHash: string; sizeBytes: number };
  readonly staging?: { storageKey: string; contentHash: string; sizeBytes: number };
}) =>
  ({
    query: async (sql: string) => {
      if (sql.includes('asset.original_assets AS original')) {
        return { rows: [{ count: '0' }] };
      }
      if (sql.includes('FROM asset.original_assets')) {
        return {
          rows:
            options?.final === undefined
              ? []
              : [
                  {
                    storage_key: options.final.storageKey,
                    content_hash: options.final.contentHash,
                    size_bytes: String(options.final.sizeBytes),
                  },
                ],
        };
      }
      if (sql.includes('runtime.schema_migrations')) {
        return { rows: [{ name: '077_ts5_asset_cas_lifecycle.sql', applied_at: new Date() }] };
      }
      if (sql.includes('asset.staging_asset_leases')) {
        return {
          rows:
            options?.staging === undefined
              ? []
              : [
                  {
                    storage_key: options.staging.storageKey,
                    content_hash: options.staging.contentHash,
                    size_bytes: String(options.staging.sizeBytes),
                  },
                ],
        };
      }
      throw new Error(`Unexpected test query: ${sql}`);
    },
  }) as never;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('TS-5 CAS scanner', () => {
  it('recognizes only verified canonical blobs and reports anomalies', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-cas-'));
    roots.push(root);
    const bytes = Buffer.from('verified canonical bytes', 'utf8');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const canonical = path.join(root, 'original', 'sha256', hash.slice(0, 2));
    await mkdir(canonical, { recursive: true });
    const canonicalPath = path.join(canonical, `${hash}.blob`);
    await writeFile(canonicalPath, bytes);
    await utimes(
      canonicalPath,
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-01T00:00:00.000Z'),
    );
    await writeFile(path.join(canonical, 'not-a-canonical.tmp'), bytes);
    await writeFile(path.join(canonical, 'wrong-hash.blob'), bytes);
    await writeFile(path.join(root, 'unexpected.txt'), bytes);

    const scan = await scanCanonicalCas(root);
    expect(scan.candidates).toHaveLength(1);
    expect(scan.candidates[0]).toMatchObject({
      storageKey: `original/sha256/${hash.slice(0, 2)}/${hash}.blob`,
      contentHash: `sha256:${hash}`,
      sizeBytes: bytes.byteLength,
    });
    expect(scan.tempCount).toBe(1);
    expect(scan.unknownCount).toBeGreaterThanOrEqual(2);
    expect(scan.corruptCount).toBe(0);
  });

  it('accepts only canonical storage keys and rejects traversal-shaped keys', () => {
    expect(isCanonicalStorageKey(`original/sha256/${'a'.repeat(2)}/${'a'.repeat(64)}.blob`)).toBe(
      true,
    );
    expect(isCanonicalStorageKey('../../outside.txt')).toBe(false);
    expect(isCanonicalStorageKey(`original/sha256/aa/${'A'.repeat(64)}.blob`)).toBe(false);
    expect(isCanonicalStorageKey(`original/sha256/ab/${'a'.repeat(64)}.blob`)).toBe(false);
  });

  it('generates run ids that round-trip through the production validator', () => {
    const run = createQuarantineRunId(
      new Date('2026-09-19T12:34:56.789Z'),
      '00000000-0000-4000-8000-000000000001',
    );
    expect(run).toBe('20260919123456789-00000000-0000-4000-8000-000000000001');
    expect(isQuarantineRunId(run)).toBe(true);
  });

  it('fails closed on a malicious manifest without touching an outside file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-cas-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-outside-'));
    roots.push(root, outside);
    const outsideFile = path.join(outside, 'outside.blob');
    await writeFile(outsideFile, 'must remain');
    const runPath = path.join(root, '.gc', 'quarantine', runId);
    await mkdir(runPath, { recursive: true });
    await writeFile(
      path.join(runPath, 'manifest.json'),
      JSON.stringify({
        runId,
        quarantinedAt: '2026-01-01T00:00:00.000Z',
        moved: [
          {
            storageKey: `original/sha256/${'a'.repeat(2)}/${'a'.repeat(64)}.blob`,
            quarantinePath: `../../${path.basename(outside)}/outside.blob`,
            contentHash: `sha256:${'a'.repeat(64)}`,
            sizeBytes: 10,
          },
        ],
      }),
    );

    await expect(
      sweepQuarantine(root, emptyDatabase(), new Date('2026-02-01T00:00:00.000Z'), 1),
    ).resolves.toBe(0);
    await expect(readFile(outsideFile, 'utf8')).resolves.toBe('must remain');
  });

  it('fails closed on a future quarantine timestamp', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-cas-'));
    roots.push(root);
    const runPath = path.join(root, '.gc', 'quarantine', runId);
    await mkdir(runPath, { recursive: true });
    await writeFile(
      path.join(runPath, 'manifest.json'),
      JSON.stringify({ runId, quarantinedAt: '2027-01-01T00:00:00.000Z', moved: [] }),
    );

    await expect(
      sweepQuarantine(root, emptyDatabase(), new Date('2026-02-01T00:00:00.000Z'), 1),
    ).resolves.toBe(0);
    await expect(lstat(path.join(runPath, 'manifest.json'))).resolves.toBeTruthy();
  });

  it('recovers a manifest-less rename and starts a fresh second safety period', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-cas-'));
    roots.push(root);
    const bytes = Buffer.from('recovered quarantine bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const runPath = path.join(root, '.gc', 'quarantine', runId);
    const file = path.join(runPath, 'original', 'sha256', hash.slice(0, 2), `${hash}.blob`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);

    await expect(
      sweepQuarantine(root, emptyDatabase(), new Date('2026-02-01T00:00:00.000Z'), 86_400_000),
    ).resolves.toBe(0);
    const recovered = JSON.parse(await readFile(path.join(runPath, 'manifest.json'), 'utf8')) as {
      recovered?: boolean;
      quarantinedAt?: string;
      moved?: readonly { storageKey: string }[];
    };
    expect(recovered.recovered).toBe(true);
    expect(recovered.quarantinedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(recovered.moved?.[0]?.storageKey).toBe(
      `original/sha256/${hash.slice(0, 2)}/${hash}.blob`,
    );
    await expect(lstat(file)).resolves.toBeTruthy();

    await expect(
      sweepQuarantine(root, emptyDatabase(), new Date('2026-02-03T00:00:00.000Z'), 86_400_000),
    ).resolves.toBe(1);
    await expect(access(file)).rejects.toThrow();
  });

  it('restores newly protected staging content and leaves protected duplicates report-only', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-cas-'));
    roots.push(root);
    const bytes = Buffer.from('staging resurrection bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `original/sha256/${hash.slice(0, 2)}/${hash}.blob`;
    const file = path.join(root, '.gc', 'quarantine', runId, ...storageKey.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(
      path.join(root, '.gc', 'quarantine', runId, 'manifest.json'),
      JSON.stringify({
        runId,
        quarantinedAt: '2026-01-01T00:00:00.000Z',
        moved: [
          {
            storageKey,
            quarantinePath: `.gc/quarantine/${runId}/${storageKey}`,
            contentHash: `sha256:${hash}`,
            sizeBytes: bytes.byteLength,
          },
        ],
      }),
    );

    await expect(
      sweepQuarantine(
        root,
        emptyDatabase({
          staging: { storageKey, contentHash: `sha256:${hash}`, sizeBytes: bytes.byteLength },
        }),
        new Date('2026-02-01T00:00:00.000Z'),
        1,
      ),
    ).resolves.toBe(0);
    await expect(readFile(path.join(root, storageKey))).resolves.toEqual(bytes);

    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    const canonical = path.join(root, storageKey);
    await expect(
      sweepQuarantine(
        root,
        emptyDatabase({
          final: { storageKey, contentHash: `sha256:${hash}`, sizeBytes: bytes.byteLength },
        }),
        new Date('2026-02-01T00:00:00.000Z'),
        1,
      ),
    ).resolves.toBe(0);
    await expect(readFile(canonical)).resolves.toEqual(bytes);
    await expect(lstat(file)).resolves.toBeTruthy();
  });

  it('fails closed when manifest content hash disagrees with its storage-key identity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-cas-'));
    roots.push(root);
    const bytes = Buffer.from('manifest bytes with hash B');
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    const pathHash = 'a'.repeat(64);
    const storageKey = `original/sha256/aa/${pathHash}.blob`;
    const file = path.join(root, '.gc', 'quarantine', runId, ...storageKey.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(
      path.join(root, '.gc', 'quarantine', runId, 'manifest.json'),
      JSON.stringify({
        runId,
        quarantinedAt: '2026-01-01T00:00:00.000Z',
        moved: [
          {
            storageKey,
            quarantinePath: `.gc/quarantine/${runId}/${storageKey}`,
            contentHash: `sha256:${actualHash}`,
            sizeBytes: bytes.byteLength,
          },
        ],
      }),
    );

    await expect(
      sweepQuarantine(root, emptyDatabase(), new Date('2026-02-01T00:00:00.000Z'), 1),
    ).resolves.toBe(0);
    await expect(readFile(file)).resolves.toEqual(bytes);
    await expect(access(path.join(root, storageKey))).rejects.toThrow();
  });

  it('fails closed when final protection metadata disagrees with quarantine identity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-cas-'));
    roots.push(root);
    const bytes = Buffer.from('final authority mismatch bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `original/sha256/${hash.slice(0, 2)}/${hash}.blob`;
    const file = path.join(root, '.gc', 'quarantine', runId, ...storageKey.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(
      path.join(root, '.gc', 'quarantine', runId, 'manifest.json'),
      JSON.stringify({
        runId,
        quarantinedAt: '2026-01-01T00:00:00.000Z',
        moved: [
          {
            storageKey,
            quarantinePath: `.gc/quarantine/${runId}/${storageKey}`,
            contentHash: `sha256:${hash}`,
            sizeBytes: bytes.byteLength,
          },
        ],
      }),
    );

    await expect(
      sweepQuarantine(
        root,
        emptyDatabase({
          final: {
            storageKey,
            contentHash: `sha256:${'b'.repeat(64)}`,
            sizeBytes: bytes.byteLength,
          },
        }),
        new Date('2026-02-01T00:00:00.000Z'),
        1,
      ),
    ).resolves.toBe(0);
    await expect(readFile(file)).resolves.toEqual(bytes);
    await expect(access(path.join(root, storageKey))).rejects.toThrow();
  });

  it('fails closed when active staging metadata disagrees with quarantine identity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-cas-'));
    roots.push(root);
    const bytes = Buffer.from('staging authority mismatch bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `original/sha256/${hash.slice(0, 2)}/${hash}.blob`;
    const file = path.join(root, '.gc', 'quarantine', runId, ...storageKey.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(
      path.join(root, '.gc', 'quarantine', runId, 'manifest.json'),
      JSON.stringify({
        runId,
        quarantinedAt: '2026-01-01T00:00:00.000Z',
        moved: [
          {
            storageKey,
            quarantinePath: `.gc/quarantine/${runId}/${storageKey}`,
            contentHash: `sha256:${hash}`,
            sizeBytes: bytes.byteLength,
          },
        ],
      }),
    );

    await expect(
      sweepQuarantine(
        root,
        emptyDatabase({
          staging: {
            storageKey,
            contentHash: `sha256:${'c'.repeat(64)}`,
            sizeBytes: bytes.byteLength,
          },
        }),
        new Date('2026-02-01T00:00:00.000Z'),
        1,
      ),
    ).resolves.toBe(0);
    await expect(readFile(file)).resolves.toEqual(bytes);
    await expect(access(path.join(root, storageKey))).rejects.toThrow();
  });

  it('fails closed when final and staging roots disagree with each other', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-cas-'));
    roots.push(root);
    const bytes = Buffer.from('cross-authority mismatch bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `original/sha256/${hash.slice(0, 2)}/${hash}.blob`;
    const file = path.join(root, '.gc', 'quarantine', runId, ...storageKey.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(
      path.join(root, '.gc', 'quarantine', runId, 'manifest.json'),
      JSON.stringify({
        runId,
        quarantinedAt: '2026-01-01T00:00:00.000Z',
        moved: [
          {
            storageKey,
            quarantinePath: `.gc/quarantine/${runId}/${storageKey}`,
            contentHash: `sha256:${hash}`,
            sizeBytes: bytes.byteLength,
          },
        ],
      }),
    );

    await expect(
      sweepQuarantine(
        root,
        emptyDatabase({
          final: { storageKey, contentHash: `sha256:${hash}`, sizeBytes: bytes.byteLength },
          staging: {
            storageKey,
            contentHash: `sha256:${'d'.repeat(64)}`,
            sizeBytes: bytes.byteLength,
          },
        }),
        new Date('2026-02-01T00:00:00.000Z'),
        1,
      ),
    ).resolves.toBe(0);
    await expect(readFile(file)).resolves.toEqual(bytes);
    await expect(access(path.join(root, storageKey))).rejects.toThrow();
  });

  it('fails closed on a canonical collision symlink without reading outside the root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-cas-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-outside-'));
    roots.push(root, outside);
    const bytes = Buffer.from('canonical collision bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `original/sha256/${hash.slice(0, 2)}/${hash}.blob`;
    const outsideFile = path.join(outside, 'outside.blob');
    const canonical = path.join(root, storageKey);
    const quarantineFile = path.join(root, '.gc', 'quarantine', runId, ...storageKey.split('/'));
    await writeFile(outsideFile, bytes);
    await mkdir(path.dirname(canonical), { recursive: true });
    await mkdir(path.dirname(quarantineFile), { recursive: true });
    try {
      await symlink(outsideFile, canonical, 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'EINVAL') return;
      throw error;
    }
    await writeFile(quarantineFile, bytes);
    await writeFile(
      path.join(root, '.gc', 'quarantine', runId, 'manifest.json'),
      JSON.stringify({
        runId,
        quarantinedAt: '2026-01-01T00:00:00.000Z',
        moved: [
          {
            storageKey,
            quarantinePath: `.gc/quarantine/${runId}/${storageKey}`,
            contentHash: `sha256:${hash}`,
            sizeBytes: bytes.byteLength,
          },
        ],
      }),
    );

    await expect(
      sweepQuarantine(root, emptyDatabase(), new Date('2026-02-01T00:00:00.000Z'), 1),
    ).resolves.toBe(0);
    await expect(readFile(outsideFile)).resolves.toEqual(bytes);
    await expect(readFile(quarantineFile)).resolves.toEqual(bytes);
  });

  it('fails closed on a quarantine-side symlink without reading outside the root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-cas-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'shotgun-ts5-outside-'));
    roots.push(root, outside);
    const bytes = Buffer.from('quarantine symlink bytes');
    const hash = createHash('sha256').update(bytes).digest('hex');
    const storageKey = `original/sha256/${hash.slice(0, 2)}/${hash}.blob`;
    const outsideFile = path.join(outside, 'outside.blob');
    const quarantineFile = path.join(root, '.gc', 'quarantine', runId, ...storageKey.split('/'));
    await writeFile(outsideFile, bytes);
    await mkdir(path.dirname(quarantineFile), { recursive: true });
    try {
      await symlink(outsideFile, quarantineFile, 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'EINVAL') return;
      throw error;
    }
    await writeFile(
      path.join(root, '.gc', 'quarantine', runId, 'manifest.json'),
      JSON.stringify({
        runId,
        quarantinedAt: '2026-01-01T00:00:00.000Z',
        moved: [
          {
            storageKey,
            quarantinePath: `.gc/quarantine/${runId}/${storageKey}`,
            contentHash: `sha256:${hash}`,
            sizeBytes: bytes.byteLength,
          },
        ],
      }),
    );

    await expect(
      sweepQuarantine(root, emptyDatabase(), new Date('2026-02-01T00:00:00.000Z'), 1),
    ).resolves.toBe(0);
    await expect(readFile(outsideFile)).resolves.toEqual(bytes);
  });
});
