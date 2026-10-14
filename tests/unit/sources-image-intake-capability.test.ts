import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';
import { decodeSourcesStagingReceipt } from '../../packages/contracts/src/frontend-sources-staging.js';
import { decodeSourceLibraryPageView } from '../../packages/contracts/src/frontend-sources.js';

const secret = 'image-test-staging-secret-at-least-32-characters';
const values = new Map<string, Uint8Array>();
const storage = {
  put: async (hash: string, bytes: Uint8Array) => {
    values.set(hash, Uint8Array.from(bytes));
    return hash;
  },
  read: async (key: string) => Uint8Array.from(values.get(key)!),
};
const service = (capability?: { imageObservationEnabled: boolean }) =>
  new SealedSourcesStagingService(
    storage,
    secret,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    capability,
  );
const input = async () => ({
  draftId: 'draft',
  itemId: 'image',
  projectId: 'project',
  principalId: 'owner',
  kind: 'FILE' as const,
  label: 'Original image',
  fileName: 'golden.png',
  mediaType: 'image/png' as const,
  bytes: await readFile('tests/fixtures/stage-8/golden.png'),
});
const resolveInput = (reference: string) => ({
  draftId: 'draft',
  itemId: 'image',
  projectId: 'project',
  principalId: 'owner',
  kind: 'FILE' as const,
  stagingReference: reference,
});

describe('server-owned image intake capability', () => {
  it('decodes only an explicit boolean capability and preserves legacy absence', () => {
    const page = {
      schemaVersion: '1.0.0',
      principalId: 'owner',
      sessionId: 'session',
      projectId: 'project',
      items: [],
      queryDigest: `sha256:${'a'.repeat(64)}`,
      projectionRevision: '1',
      accessRevision: '1',
      policyContextRevision: '1',
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
    expect(decodeSourceLibraryPageView(page).intakeCapabilities).toBeUndefined();
    expect(
      decodeSourceLibraryPageView({
        ...page,
        intakeCapabilities: { imageObservationEnabled: false },
      }).intakeCapabilities?.imageObservationEnabled,
    ).toBe(false);
    expect(
      decodeSourceLibraryPageView({
        ...page,
        intakeCapabilities: { imageObservationEnabled: true },
      }).intakeCapabilities?.imageObservationEnabled,
    ).toBe(true);
    for (const capability of [
      {},
      { imageObservationEnabled: 'true' },
      { imageObservationEnabled: 1 },
      { imageObservationEnabled: true, providerAllowed: true },
    ]) {
      expect(() =>
        decodeSourceLibraryPageView({ ...page, intakeCapabilities: capability }),
      ).toThrow();
    }
  });
  it('rejects images with absent or disabled runtime capability before storage', async () => {
    const original = await input();
    for (const capability of [undefined, { imageObservationEnabled: false }]) {
      await expect(service(capability).stageBytes(original)).rejects.toThrow(/unavailable/);
    }
  });
  it('preserves original PNG bytes, hash and sealed lineage only with captured opt-in', async () => {
    const original = await input();
    const capability = { imageObservationEnabled: true };
    const staging = service(capability);
    capability.imageObservationEnabled = false;
    const receipt = decodeSourcesStagingReceipt(await staging.stageBytes(original));
    const artifact = await staging.resolve(resolveInput(receipt.stagingReference));
    expect(artifact).toMatchObject({
      mediaType: 'image/png',
      projectId: 'project',
      principalId: 'owner',
      fileName: 'golden.png',
    });
    expect(Buffer.from(await storage.read(artifact.storageKey))).toEqual(original.bytes);
    expect(artifact.contentHash).toBe(
      `sha256:${createHash('sha256').update(original.bytes).digest('hex')}`,
    );
  });
  it('rejects an enabled-runtime image receipt on an OFF runtime with the same seal key', async () => {
    const receipt = await service({ imageObservationEnabled: true }).stageBytes(await input());
    await expect(service().resolve(resolveInput(receipt.stagingReference))).rejects.toThrow(
      /unavailable/,
    );
    await expect(
      service({ imageObservationEnabled: true }).resolve({
        ...resolveInput(receipt.stagingReference),
        projectId: 'other',
      }),
    ).rejects.toThrow(/does not match/);
  });
  it('keeps a disabled capability disabled after its input object is mutated', async () => {
    const capability = { imageObservationEnabled: false };
    const staging = service(capability);
    capability.imageObservationEnabled = true;
    await expect(staging.stageBytes(await input())).rejects.toThrow(/unavailable/);
  });
  it('rejects wrong extension, MIME spoofing, corrupt signatures and unsupported image kinds', async () => {
    const staging = service({ imageObservationEnabled: true });
    const original = await input();
    await expect(staging.stageBytes({ ...original, fileName: 'image.txt' })).rejects.toThrow(
      /extension/,
    );
    await expect(staging.stageBytes({ ...original, mediaType: 'image/jpeg' })).rejects.toThrow(
      /extension/,
    );
    await expect(
      staging.stageBytes({ ...original, bytes: Buffer.from('not PNG') }),
    ).rejects.toThrow(/PNG signature/);
    await expect(
      staging.stageBytes({ ...original, fileName: 'image.jpg', mediaType: 'image/jpeg' }),
    ).rejects.toThrow(/JPEG signature/);
    await expect(staging.stageBytes({ ...original, kind: 'DIRECT_TEXT' })).rejects.toThrow(
      /unavailable/,
    );
    expect(() =>
      decodeSourcesStagingReceipt({
        schemaVersion: '1.0.0',
        draftId: 'draft',
        itemId: 'image',
        kind: 'URL',
        label: 'Image',
        stagingReference: 'opaque',
        mediaType: 'image/png',
        sizeBytes: 8,
        contentHash: `sha256:${'a'.repeat(64)}`,
        expiresAt: new Date().toISOString(),
      }),
    ).toThrow(/requires a file/);
  });
  it('rejects oversized original image bytes without truncation', async () => {
    const original = await input();
    await expect(
      service({ imageObservationEnabled: true }).stageBytes({
        ...original,
        bytes: new Uint8Array(10 * 1024 * 1024 + 1),
      }),
    ).rejects.toThrow(/10 MiB/);
  });
});
