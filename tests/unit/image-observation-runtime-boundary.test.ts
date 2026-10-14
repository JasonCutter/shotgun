import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  createImageObservationRuntime,
  type ImageObservationRuntimeOptions,
} from '../../assemblies/shotgun-app/src/image-observation-runtime.js';
import { imageExecutionFixtureInput } from '../helpers/image-observation-execution-fixture.js';
import { ShotgunError } from '../../packages/contracts/src/index.js';

const fixture = () => {
  const pin = imageExecutionFixtureInput();
  const query = vi.fn(async () => ({ rows: [] }));
  const read = vi.fn(async () => pin.imageBytes);
  const resolve = vi.fn(async () => {
    throw Error('No image execution expected');
  });
  const authorize = vi.fn(async () => {});
  const options: ImageObservationRuntimeOptions = {
    runtimeProfile: 'runtime-test',
    pool: { query } as unknown as Pool,
    storage: { read, put: vi.fn(async () => 'unused') },
    authorizeSourceInput: authorize,
    imageExecutionResolver: { resolve },
    transformationRepository: {
      save: vi.fn(),
      findByRevision: vi.fn(),
      findBySourceVersion: vi.fn(),
      findTransformationRevisionSecurity: vi.fn(),
    },
    ledger: { append: vi.fn(), listCurrent: vi.fn(), findHistorical: vi.fn() },
  };
  const input = {
    projectId: pin.projectId,
    sourceId: pin.sourceId,
    sourceVersionId: pin.sourceVersionId,
    storageKey: 'original/image.blob',
    mediaType: 'image/png' as const,
    contentHash: pin.sourceContentHash,
    accessScope: pin.accessScope,
    sensitivity: pin.sensitivity,
  };
  return { options, input, query, read, resolve, authorize };
};
describe('isolated image application authority boundary', () => {
  it('does not create an image pipeline for a normal/live-capable runtime', () => {
    const f = fixture();
    expect(() =>
      createImageObservationRuntime({ ...f.options, runtimeProfile: 'normal' }),
    ).toThrowError(expect.objectContaining({ code: 'POLICY_DENIED' }));
    expect(f.query).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it('project/standing authorization failure prevents source bytes and credential/execution resolution', async () => {
    const f = fixture();
    f.authorize.mockRejectedValue(
      new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'Synthetic unauthorized project',
        module: 'test',
        operation: 'authorize-image',
        retryable: false,
      }),
    );
    await expect(
      createImageObservationRuntime(f.options).runForSourceVersion(f.input),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.resolve).not.toHaveBeenCalled();
  });
  it('missing or stale authoritative SourceVersion prevents byte read and any model attempt', async () => {
    const f = fixture();
    await expect(
      createImageObservationRuntime(f.options).runForSourceVersion(f.input),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(f.authorize).toHaveBeenCalledTimes(1);
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.resolve).not.toHaveBeenCalled();
  });
});
