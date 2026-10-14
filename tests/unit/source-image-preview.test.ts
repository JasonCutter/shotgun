import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  FrontendSourcesReadCoordinator,
  type SourcesImageReadOptions,
  type SourcesProjectionRecord,
} from '../../modules/frontend-sources-product/src/index.js';
import { decodeSourcePreviewView } from '../../packages/contracts/src/frontend-sources.js';
import { imageObservationFixture } from '../helpers/vp-image-observation.js';

async function fixture() {
  const bytes = await readFile('tests/fixtures/stage-8/golden.png');
  const observation = {
    ...imageObservationFixture(),
    sourceContentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
  const record: SourcesProjectionRecord = {
    projectId: observation.projectId,
    sourceId: observation.sourceId,
    sourceVersionId: observation.sourceVersionId,
    originalAssetId: observation.originalAssetId,
    contentHash: observation.sourceContentHash,
    mediaType: 'image/png',
    sizeBytes: bytes.length,
    storageKey: 'image',
    accessScope: ['owner'],
    sensitivity: 'private',
    versionNumber: 1,
    createdAt: observation.createdAt,
    stage3State: 'IMAGE_OBSERVATION_COMPLETED',
    imageObservationId: observation.observationId,
  };
  let records: readonly SourcesProjectionRecord[] = [record];
  const repository = { listProjectSourceVersions: vi.fn(async () => records) };
  const storage = { read: vi.fn(async () => bytes) };
  const evidence = {
    listBySourceVersion: vi.fn(async () => []),
    listByRevision: vi.fn(async () => []),
  };
  const validator = {
    preflightImage: vi.fn(async () => ({
      width: 320,
      height: 180,
      pixels: 57600,
      contentHash: observation.sourceContentHash,
    })),
  };
  const ledger = { findHistorical: vi.fn(async () => observation) };
  const options: SourcesImageReadOptions = {
    imageValidator: validator,
    imageObservationLedger: ledger,
  };
  const scope = {
    principalId: 'owner',
    sessionId: 'session',
    authorizedProjectId: observation.projectId,
    accessScopes: ['owner'],
    sensitivityClearance: 'private' as const,
    accessRevision: 'a',
    policyContextRevision: 'p',
  };
  const coordinator = new FrontendSourcesReadCoordinator(
    repository,
    storage,
    evidence,
    undefined,
    () => new Date(observation.createdAt),
    options,
  );
  return {
    bytes,
    observation,
    record,
    repository,
    storage,
    evidence,
    validator,
    ledger,
    scope,
    coordinator,
    setRecords: (value: readonly SourcesProjectionRecord[]) => {
      records = value;
    },
  };
}

describe('authenticated immutable source image preview', () => {
  it('preserves original bytes and exposes generated observations separately with no literal Evidence', async () => {
    const f = await fixture();
    const image = await f.coordinator.originalImage(
      f.scope,
      f.record.sourceId,
      f.record.sourceVersionId,
    );
    expect(Buffer.from(image!.bytes)).toEqual(f.bytes);
    expect(image!.contentHash).toBe(f.observation.sourceContentHash);
    const preview = await f.coordinator.preview(
      f.scope,
      f.record.sourceId,
      f.record.sourceVersionId,
      'ORIGINAL',
    );
    expect(preview?.text).toBeUndefined();
    expect(preview?.image).toMatchObject({
      contentHash: f.record.contentHash,
      width: 320,
      height: 180,
    });
    expect(preview?.generatedObservationReferences?.[0]).toMatchObject({
      observationId: f.observation.observationId,
      semanticStatus: 'UNVERIFIED',
      observationText: f.observation.text,
    });
    expect(preview?.generatedObservationReferences?.[0]).not.toHaveProperty('evidenceId');
    expect(preview?.locators).toEqual([]);
    expect(
      (await f.coordinator.evidenceList(f.scope, f.record.sourceId, f.record.sourceVersionId))
        ?.items,
    ).toEqual([]);
    expect(f.evidence.listByRevision).not.toHaveBeenCalled();
    expect((await f.coordinator.detail(f.scope, f.record.sourceId))?.askUsageState).toBe(
      'IMAGE_OBSERVATION_COMPLETED',
    );
    const history = await f.coordinator.history(
      f.scope,
      f.record.sourceId,
      f.record.sourceVersionId,
    );
    expect(history?.versions[0]).toMatchObject({
      transformationState: 'IMAGE_OBSERVATION_COMPLETED',
      evidenceCount: 0,
    });
  });
  it('keeps old version pixels and observation when a newer accessible version exists', async () => {
    const f = await fixture();
    f.setRecords([
      f.record,
      {
        ...f.record,
        sourceVersionId: 'newer-version',
        versionNumber: 2,
        stage3State: 'MATERIALIZED',
        imageObservationId: undefined,
      },
    ]);
    const preview = await f.coordinator.preview(
      f.scope,
      f.record.sourceId,
      f.record.sourceVersionId,
      'ORIGINAL',
    );
    expect(preview?.sourceVersionId).toBe(f.record.sourceVersionId);
    expect(preview?.generatedObservationReferences?.[0]?.observationId).toBe(
      f.observation.observationId,
    );
    expect((await f.coordinator.detail(f.scope, f.record.sourceId))?.askUsageState).toBe(
      'NOT_READY',
    );
  });
  it('rejects cross-project, hidden latest and inaccessible selected versions before reading bytes', async () => {
    const f = await fixture();
    expect(
      await f.coordinator.originalImage(
        { ...f.scope, authorizedProjectId: 'other' },
        f.record.sourceId,
        f.record.sourceVersionId,
      ),
    ).toBeNull();
    f.setRecords([
      f.record,
      { ...f.record, sourceVersionId: 'hidden', versionNumber: 2, sensitivity: 'restricted' },
    ]);
    expect(
      await f.coordinator.originalImage(f.scope, f.record.sourceId, f.record.sourceVersionId),
    ).toBeNull();
    expect(f.storage.read).not.toHaveBeenCalled();
    f.setRecords([{ ...f.record, accessScope: ['other'] }]);
    expect(
      await f.coordinator.originalImage(f.scope, f.record.sourceId, f.record.sourceVersionId),
    ).toBeNull();
  });
  it('refuses post-decode authority changes and does not invent a success after a read error', async () => {
    const f = await fixture();
    f.validator.preflightImage.mockImplementationOnce(async () => {
      f.setRecords([{ ...f.record, sensitivity: 'restricted' }]);
      return { width: 320, height: 180, pixels: 57600, contentHash: f.record.contentHash };
    });
    expect(
      await f.coordinator.originalImage(f.scope, f.record.sourceId, f.record.sourceVersionId),
    ).toBeNull();
    f.repository.listProjectSourceVersions.mockRejectedValueOnce(
      new Error('authority unavailable'),
    );
    await expect(
      f.coordinator.originalImage(f.scope, f.record.sourceId, f.record.sourceVersionId),
    ).rejects.toThrow('authority unavailable');
  });
  it('rejects altered bytes, dimension/hash mismatches and missing typed observation authority', async () => {
    const f = await fixture();
    f.storage.read.mockResolvedValueOnce(Buffer.alloc(f.bytes.length));
    await expect(
      f.coordinator.originalImage(f.scope, f.record.sourceId, f.record.sourceVersionId),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    f.validator.preflightImage.mockResolvedValueOnce({
      width: 0,
      height: 180,
      pixels: 0,
      contentHash: f.record.contentHash,
    });
    await expect(
      f.coordinator.originalImage(f.scope, f.record.sourceId, f.record.sourceVersionId),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    f.ledger.findHistorical.mockResolvedValueOnce({
      ...f.observation,
      sourceVersionId: 'different-version',
    });
    await expect(
      f.coordinator.preview(f.scope, f.record.sourceId, f.record.sourceVersionId, 'ORIGINAL'),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    const disabled = new FrontendSourcesReadCoordinator(f.repository, f.storage, f.evidence);
    expect(
      await disabled.originalImage(f.scope, f.record.sourceId, f.record.sourceVersionId),
    ).toBeNull();
  });
  it('rejects foreign URL, caption-as-original and mismatched source pins in public preview payloads', async () => {
    const f = await fixture();
    const preview = await f.coordinator.preview(
      f.scope,
      f.record.sourceId,
      f.record.sourceVersionId,
      'ORIGINAL',
    );
    expect(() =>
      decodeSourcePreviewView({
        ...preview,
        image: { ...preview!.image, url: 'https://example.com/private.png' },
      }),
    ).toThrow();
    expect(() =>
      decodeSourcePreviewView({ ...preview, text: 'caption pretending to be original' }),
    ).toThrow();
    expect(() =>
      decodeSourcePreviewView({
        ...preview,
        generatedObservationReferences: [
          { ...preview!.generatedObservationReferences![0], sourceVersionId: 'other' },
        ],
      }),
    ).toThrow();
  });
});
