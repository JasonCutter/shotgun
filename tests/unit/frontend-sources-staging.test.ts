import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';
import type { AssetStoragePort } from '../../modules/original-asset/src/index.js';

class MemoryStorage implements AssetStoragePort {
  readonly values = new Map<string, Uint8Array>();

  async put(contentHash: string, bytes: Uint8Array): Promise<string> {
    const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (hash !== contentHash) throw new Error('hash mismatch');
    const key = `memory/${contentHash.slice(7)}`;
    this.values.set(key, Uint8Array.from(bytes));
    return key;
  }

  async read(storageKey: string): Promise<Uint8Array> {
    const value = this.values.get(storageKey);
    if (!value) throw new Error('not found');
    return Uint8Array.from(value);
  }
}

const secret = 'sources-staging-test-secret-at-least-32-characters';
const base = {
  draftId: 'draft-1',
  itemId: 'item-1',
  projectId: 'project-1',
  principalId: 'principal-1',
  kind: 'DIRECT_TEXT' as const,
  label: 'Notes',
  mediaType: 'text/plain' as const,
  bytes: new TextEncoder().encode('canonical bytes'),
};

describe('sealed Sources staging service', () => {
  it('stores immutable bytes and returns an opaque context-bound reference', async () => {
    const storage = new MemoryStorage();
    const service = new SealedSourcesStagingService(
      storage,
      secret,
      undefined,
      () => new Date('2026-07-30T00:00:00.000Z'),
    );

    const receipt = await service.stageBytes(base);
    expect(receipt).toMatchObject({
      schemaVersion: '1.0.0',
      draftId: 'draft-1',
      itemId: 'item-1',
      kind: 'DIRECT_TEXT',
      mediaType: 'text/plain',
      sizeBytes: 15,
    });
    expect(receipt.stagingReference).toMatch(/^sources-stage-v1\./);
    expect(receipt.stagingReference).not.toContain('canonical bytes');

    const artifact = await service.resolve({
      stagingReference: receipt.stagingReference,
      draftId: 'draft-1',
      itemId: 'item-1',
      projectId: 'project-1',
      principalId: 'principal-1',
      kind: 'DIRECT_TEXT',
    });
    expect(await storage.read(artifact.storageKey)).toEqual(base.bytes);
    expect(artifact.contentHash).toBe(receipt.contentHash);
    expect(artifact.stagingReference).toBe(receipt.stagingReference);
  });

  it('rejects token tampering and cross-Project or cross-Principal replay', async () => {
    const service = new SealedSourcesStagingService(
      new MemoryStorage(),
      secret,
      undefined,
      () => new Date('2026-07-30T00:00:00.000Z'),
    );
    const receipt = await service.stageBytes(base);
    const tampered = `${receipt.stagingReference.slice(0, -1)}${
      receipt.stagingReference.endsWith('A') ? 'B' : 'A'
    }`;

    await expect(
      service.resolve({
        stagingReference: tampered,
        draftId: 'draft-1',
        itemId: 'item-1',
        projectId: 'project-1',
        principalId: 'principal-1',
        kind: 'DIRECT_TEXT',
      }),
    ).rejects.toThrow(/authenticated|invalid/);

    await expect(
      service.resolve({
        stagingReference: receipt.stagingReference,
        draftId: 'draft-1',
        itemId: 'item-1',
        projectId: 'project-2',
        principalId: 'principal-1',
        kind: 'DIRECT_TEXT',
      }),
    ).rejects.toThrow(/does not match/);

    await expect(
      service.resolve({
        stagingReference: receipt.stagingReference,
        draftId: 'draft-1',
        itemId: 'item-1',
        projectId: 'project-1',
        principalId: 'principal-2',
        kind: 'DIRECT_TEXT',
      }),
    ).rejects.toThrow(/does not match/);
  });

  it('rejects expired references and inputs outside the active one MiB boundary', async () => {
    let now = new Date('2026-07-30T00:00:00.000Z');
    const service = new SealedSourcesStagingService(
      new MemoryStorage(),
      secret,
      undefined,
      () => now,
    );
    const receipt = await service.stageBytes(base);
    now = new Date('2026-08-30T00:00:00.001Z');
    await expect(
      service.resolve({
        stagingReference: receipt.stagingReference,
        draftId: 'draft-1',
        itemId: 'item-1',
        projectId: 'project-1',
        principalId: 'principal-1',
        kind: 'DIRECT_TEXT',
      }),
    ).rejects.toThrow(/expired/);

    await expect(service.stageBytes({ ...base, bytes: new Uint8Array(1_048_577) })).rejects.toThrow(
      /one MiB/,
    );
  });

  it('stages a PDF as a file and rejects mismatched types or signatures', async () => {
    const service = new SealedSourcesStagingService(new MemoryStorage(), secret);
    const pdf = {
      ...base,
      kind: 'FILE' as const,
      mediaType: 'application/pdf' as const,
      fileName: 'paper.pdf',
      bytes: new TextEncoder().encode('%PDF-1.4\n1 0 obj\n'),
    };
    const receipt = await service.stageBytes(pdf);
    expect(receipt).toMatchObject({ kind: 'FILE', mediaType: 'application/pdf' });
    await expect(
      service.resolve({
        stagingReference: receipt.stagingReference,
        draftId: pdf.draftId,
        itemId: pdf.itemId,
        projectId: pdf.projectId,
        principalId: pdf.principalId,
        kind: 'FILE',
      }),
    ).resolves.toMatchObject({ mediaType: 'application/pdf', fileName: 'paper.pdf' });
    await expect(service.stageBytes({ ...pdf, mediaType: 'text/plain' })).rejects.toThrow(
      /extension and media type/,
    );
    await expect(
      service.stageBytes({ ...pdf, bytes: new TextEncoder().encode('not a PDF') }),
    ).rejects.toThrow(/PDF signature/);
  });
});
