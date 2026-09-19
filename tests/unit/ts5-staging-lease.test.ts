import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';
import type { AssetStoragePort } from '../../modules/original-asset/src/index.js';
import type {
  SecureUrlAcquisitionCoordinator,
  UrlAcquisitionReceipt,
} from '../../modules/url-acquisition/src/index.js';
import type {
  MaintenanceBarrierPort,
  StagingAssetLeaseInput,
  StagingAssetLeasePersistencePort,
  StagingTimeAuthorityPort,
} from '../../modules/frontend-sources-staging/src/index.js';

class MemoryStorage implements AssetStoragePort {
  readonly values = new Map<string, Uint8Array>();

  async put(contentHash: string, bytes: Uint8Array): Promise<string> {
    const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (actual !== contentHash) throw new Error('hash mismatch');
    const key = `original/sha256/${contentHash.slice(7, 9)}/${contentHash.slice(7)}.blob`;
    this.values.set(key, Uint8Array.from(bytes));
    return key;
  }

  async read(storageKey: string): Promise<Uint8Array> {
    const value = this.values.get(storageKey);
    if (!value) throw new Error('not found');
    return Uint8Array.from(value);
  }
}

class RecordingLeasePersistence implements StagingAssetLeasePersistencePort {
  readonly leases: StagingAssetLeaseInput[] = [];
  fail = false;

  async createLease(input: StagingAssetLeaseInput): Promise<void> {
    if (this.fail) throw new Error('lease persistence unavailable');
    this.leases.push(input);
  }
}

class RecordingBarrier implements MaintenanceBarrierPort {
  calls = 0;

  async runShared<T>(action: () => Promise<T>): Promise<T> {
    this.calls += 1;
    return action();
  }
}

class FixedTimeAuthority implements StagingTimeAuthorityPort {
  constructor(public current: Date) {}

  async now(): Promise<Date> {
    return new Date(this.current);
  }
}

const base = {
  draftId: 'draft-1',
  itemId: 'item-1',
  projectId: 'project-1',
  principalId: 'principal-1',
  kind: 'DIRECT_TEXT' as const,
  label: 'Notes',
  mediaType: 'text/plain' as const,
  bytes: new TextEncoder().encode('durable staging bytes'),
};

describe('TS-5 durable staging lease boundary', () => {
  it('persists the lease before returning a usable receipt and uses the shared barrier', async () => {
    const persistence = new RecordingLeasePersistence();
    const barrier = new RecordingBarrier();
    const service = new SealedSourcesStagingService(
      new MemoryStorage(),
      'ts5-staging-lease-test-secret-at-least-32',
      undefined,
      () => new Date('2026-09-19T00:00:00.000Z'),
      persistence,
      barrier,
    );

    const receipt = await service.stageBytes(base);
    expect(barrier.calls).toBe(1);
    expect(persistence.leases).toHaveLength(1);
    expect(persistence.leases[0]).toMatchObject({
      projectId: base.projectId,
      draftId: base.draftId,
      itemId: base.itemId,
      principalId: base.principalId,
      inputKind: 'DIRECT_TEXT',
      issuedAt: '2026-09-19T00:00:00.000Z',
      expiresAt: '2026-10-19T00:00:00.000Z',
      contentHash: receipt.contentHash,
      sizeBytes: receipt.sizeBytes,
    });
    expect(persistence.leases[0]?.referenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it('leaves bytes recoverable as a later orphan when lease persistence fails', async () => {
    const storage = new MemoryStorage();
    const persistence = new RecordingLeasePersistence();
    persistence.fail = true;
    const service = new SealedSourcesStagingService(
      storage,
      'ts5-staging-lease-test-secret-at-least-32',
      undefined,
      () => new Date('2026-09-19T00:00:00.000Z'),
      persistence,
    );

    await expect(service.stageBytes(base)).rejects.toThrow('lease persistence unavailable');
    expect(storage.values.size).toBe(1);
  });

  it('allows multiple valid leases for one content-addressed blob', async () => {
    const persistence = new RecordingLeasePersistence();
    const service = new SealedSourcesStagingService(
      new MemoryStorage(),
      'ts5-staging-lease-test-secret-at-least-32',
      undefined,
      () => new Date('2026-09-19T00:00:00.000Z'),
      persistence,
    );

    await service.stageBytes(base);
    await service.stageBytes({ ...base, itemId: 'item-2' });
    expect(persistence.leases).toHaveLength(2);
    expect(persistence.leases[0]?.storageKey).toBe(persistence.leases[1]?.storageKey);
    expect(persistence.leases[0]?.referenceDigest).not.toBe(persistence.leases[1]?.referenceDigest);
  });

  it('persists a durable lease for URL staging as well as byte staging', async () => {
    const persistence = new RecordingLeasePersistence();
    const authority = new FixedTimeAuthority(new Date('2026-09-19T00:00:00.000Z'));
    const body = new TextEncoder().encode('url staging bytes');
    const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
    const receipt: UrlAcquisitionReceipt = {
      normalizedRequestedUrl: 'https://example.test/source.txt',
      redactedRequestedUrl: 'https://example.test/source.txt',
      redactedFinalUrl: 'https://example.test/source.txt',
      redirectChainDigest: `sha256:${'a'.repeat(64)}`,
      redirectObservations: [],
      dnsObservations: [],
      responseStatus: 200,
      responseContentType: 'text/plain',
      responseContentLength: body.byteLength,
      compressedBytes: body.byteLength,
      decompressedBytes: body.byteLength,
      responseMetadata: {},
      contentHash,
      body,
    };
    const acquisition = {
      acquire: async (): Promise<UrlAcquisitionReceipt> => receipt,
    } as unknown as SecureUrlAcquisitionCoordinator;
    const service = new SealedSourcesStagingService(
      new MemoryStorage(),
      'ts5-staging-lease-test-secret-at-least-32',
      acquisition,
      () => new Date('2026-09-19T00:00:00.000Z'),
      persistence,
      undefined,
      authority,
    );

    const staged = await service.stageUrl({
      draftId: base.draftId,
      itemId: 'url-item',
      projectId: base.projectId,
      principalId: base.principalId,
      label: 'URL source',
      requestedUrl: 'https://example.test/source.txt',
    });
    expect(staged.expiresAt).toBe('2026-10-19T00:00:00.000Z');
    expect(persistence.leases).toHaveLength(1);
    expect(persistence.leases[0]?.storageKey).toContain('original/sha256/');
    expect(persistence.leases[0]?.inputKind).toBe('URL');
  });

  it('uses one authoritative staging clock despite process clock skew and expires exactly at the boundary', async () => {
    const persistence = new RecordingLeasePersistence();
    const authority = new FixedTimeAuthority(new Date('2026-09-19T00:00:00.000Z'));
    let processNow = new Date('2040-01-01T00:00:00.000Z');
    const service = new SealedSourcesStagingService(
      new MemoryStorage(),
      'ts5-staging-lease-test-secret-at-least-32',
      undefined,
      () => processNow,
      persistence,
      undefined,
      authority,
    );

    const receipt = await service.stageBytes(base);
    expect(receipt.expiresAt).toBe('2026-10-19T00:00:00.000Z');
    expect(persistence.leases[0]?.issuedAt).toBe('2026-09-19T00:00:00.000Z');
    expect(persistence.leases[0]?.expiresAt).toBe(receipt.expiresAt);

    processNow = new Date('2020-01-01T00:00:00.000Z');
    await expect(
      service.resolve({
        stagingReference: receipt.stagingReference,
        draftId: base.draftId,
        itemId: base.itemId,
        projectId: base.projectId,
        principalId: base.principalId,
        kind: base.kind,
      }),
    ).resolves.toMatchObject({ expiresAt: receipt.expiresAt });

    authority.current = new Date(receipt.expiresAt);
    await expect(
      service.resolve({
        stagingReference: receipt.stagingReference,
        draftId: base.draftId,
        itemId: base.itemId,
        projectId: base.projectId,
        principalId: base.principalId,
        kind: base.kind,
      }),
    ).rejects.toThrow('expired');
  });
});
