import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { OriginalAssetAskSourceVersionContextReader } from '../../adapters/frontend-ask-source-context-original-asset/src/index.js';
import type {
  AssetStoragePort,
  OriginalAssetRepositoryPort,
  StoredIntakeResult,
} from '../../modules/original-asset/src/index.js';

const bytes = new TextEncoder().encode(
  '2026-08-11 Shotgun local execution completed. The first project was JasonNote.',
);
const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const stored = (overrides: Partial<StoredIntakeResult> = {}): StoredIntakeResult => ({
  submissionId: 'submission-1',
  projectId: 'project-1',
  sourceId: 'source-1',
  sourceVersionId: 'version-1',
  versionNumber: 1,
  channel: 'direct_text',
  materialKind: 'plain_text',
  assetReference: {
    assetId: 'asset-1',
    versionId: 'version-1',
    mediaType: 'text/plain',
    contentHash,
    sizeBytes: bytes.byteLength,
    storageUri: 'asset://asset-1/versions/version-1',
    accessScope: ['owner'],
  },
  storageKey: 'original/source-1.blob',
  sensitivity: 'private',
  assetReused: false,
  versionCreated: true,
  ...overrides,
});

const repository = (value: StoredIntakeResult | undefined): OriginalAssetRepositoryPort => ({
  assertSource: async () => undefined,
  store: async () => {
    throw new Error('not used');
  },
  findBySubmission: async () => undefined,
  findByVersion: async () => value,
  findSourceVersionSecurity: async () => undefined,
});

const storage = (value: Uint8Array): AssetStoragePort => ({
  put: async () => 'not-used',
  read: async () => value,
});

const scope = {
  principalId: 'principal-1',
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  sensitivityClearance: 'private' as const,
  accessScope: ['owner'],
};

describe('OriginalAssetAskSourceVersionContextReader', () => {
  it('resolves and verifies immutable Direct Text through server-owned ports', async () => {
    const reader = new OriginalAssetAskSourceVersionContextReader(
      repository(stored()),
      storage(bytes),
    );

    await expect(
      reader.resolve({ scope, sourceId: 'source-1', sourceVersionId: 'version-1' }),
    ).resolves.toMatchObject({
      kind: 'SOURCE_VERSION',
      sourceId: 'source-1',
      sourceVersionId: 'version-1',
      contentHash,
      mediaType: 'text/plain',
      sensitivity: 'private',
    });
  });

  it.each([
    ['missing from the Resource Project', undefined],
    ['owned by another Project', stored({ projectId: 'project-other' })],
    ['owned by another Source', stored({ sourceId: 'source-other' })],
  ])('fails closed when the pinned SourceVersion is %s', async (_label, value) => {
    const reader = new OriginalAssetAskSourceVersionContextReader(
      repository(value),
      storage(bytes),
    );

    await expect(
      reader.resolve({ scope, sourceId: 'source-1', sourceVersionId: 'version-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('fails closed for insufficient access scope or sensitivity clearance', async () => {
    const reader = new OriginalAssetAskSourceVersionContextReader(
      repository(stored()),
      storage(bytes),
    );

    await expect(
      reader.resolve({
        scope: { ...scope, accessScope: [] },
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    await expect(
      reader.resolve({
        scope: { ...scope, sensitivityClearance: 'internal' },
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
      }),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
  });

  it.each([
    [
      'size',
      stored({ assetReference: { ...stored().assetReference, sizeBytes: bytes.byteLength + 1 } }),
      bytes,
      'STALE_VERSION',
    ],
    [
      'hash',
      stored({
        assetReference: { ...stored().assetReference, contentHash: `sha256:${'0'.repeat(64)}` },
      }),
      bytes,
      'STALE_VERSION',
    ],
    [
      'UTF-8',
      stored({
        assetReference: {
          ...stored().assetReference,
          contentHash: `sha256:${createHash('sha256')
            .update(Uint8Array.from([0xff]))
            .digest('hex')}`,
          sizeBytes: 1,
        },
      }),
      Uint8Array.from([0xff]),
      'VALIDATION_ERROR',
    ],
  ])('rejects invalid immutable %s verification', async (_label, record, storedBytes, code) => {
    const reader = new OriginalAssetAskSourceVersionContextReader(
      repository(record),
      storage(storedBytes),
    );

    await expect(
      reader.resolve({ scope, sourceId: 'source-1', sourceVersionId: 'version-1' }),
    ).rejects.toMatchObject({ code });
  });
});
