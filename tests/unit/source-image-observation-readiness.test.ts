import { describe, expect, it, vi } from 'vitest';
import { SourcesStage3TestPipeline } from '../../adapters/sources-stage3-pipeline/src/index.js';
import type { SharedSourcesStage3PipelineDependencies } from '../../adapters/sources-stage3-pipeline/src/index.js';
import type {
  SourcesStage3ProgressPort,
  SourcesStage3PipelinePort,
  SourcesImageObservationPipelinePort,
} from '../../modules/frontend-sources-write/src/index.js';
import { ShotgunError, sha256Text } from '../../packages/contracts/src/index.js';

const input: Parameters<SourcesStage3PipelinePort['runForSourceVersion']>[0] = {
  projectId: 'project',
  sourceId: 'source',
  sourceVersionId: 'version',
  storageKey: 'original',
  mediaType: 'image/png',
  contentHash: sha256Text('pinned original'),
  accessScope: ['owner'],
  sensitivity: 'private',
};
const lease = {
  projectId: input.projectId,
  sourceId: input.sourceId,
  sourceVersionId: input.sourceVersionId,
  fencingToken: 1,
  leaseToken: 'lease',
};
const observation = { observationId: 'observation', revisionId: 'revision', reused: false };
function setup() {
  let completed = false,
    blocked = false;
  const progress: SourcesStage3ProgressPort = {
    ensureMaterialized: vi.fn(async () => {}),
    claim: vi.fn(async () =>
      blocked
        ? { status: 'BLOCKED' as const, reason: 'TERMINAL_FAILURE' as const }
        : completed
          ? {
              status: 'COMPLETED' as const,
              state: 'IMAGE_OBSERVATION_COMPLETED' as const,
              observationId: 'observation',
              revisionId: 'revision',
            }
          : { status: 'CLAIMED' as const, lease },
    ),
    finalize: vi.fn(async () => {}),
    finalizeImageObservation: vi.fn(async () => {
      completed = true;
    }),
    recordPreClaimFailure: vi.fn(async () => {}),
    markFailure: vi.fn(async (failure) => {
      blocked = !failure.retryable;
    }),
    markRetryable: vi.fn(async () => {}),
    findRecoverable: vi.fn(async () => []),
  };
  const transform = vi.fn().mockRejectedValue(new Error('generic transformation must not run'));
  const read = vi.fn().mockRejectedValue(new Error('generic storage read must not run'));
  const index = vi.fn().mockRejectedValue(new Error('source Evidence must not be manufactured'));
  const stage4 = vi.fn(async () => {});
  const image = vi
    .fn<SourcesImageObservationPipelinePort['runForSourceVersion']>()
    .mockResolvedValue(observation);
  const deps: SharedSourcesStage3PipelineDependencies = {
    storage: { put: vi.fn(), read },
    transformer: { identity: { id: 'base', version: '1' }, transform },
    locator: { locate: () => undefined },
    transformationRepository: {
      save: vi.fn(),
      findTransformationRevisionSecurity: vi.fn(),
      findBySourceVersion: vi.fn(),
      findByRevision: vi.fn(),
    },
    evidenceRepository: {
      index,
      listBySourceVersion: vi.fn(),
      findManyByIds: vi.fn(),
      findById: vi.fn(),
    },
    progress,
    stage4: { onEvidenceIndexed: stage4 },
    imageObservationPipeline: { runForSourceVersion: image },
  };
  return { deps, progress, transform, read, index, stage4, image };
}
describe('distinct durable Source image observation readiness', () => {
  it('holds a lease, finalizes the actual observation, and never enters literal Evidence or Stage 4', async () => {
    const s = setup();
    const result = await new SourcesStage3TestPipeline(s.deps).runForSourceVersion(input);
    expect(result).toEqual({
      status: 'IMAGE_OBSERVATION_COMPLETED',
      imageObservation: observation,
    });
    expect(result).not.toHaveProperty('stage3');
    expect(s.progress.claim).toHaveBeenCalledOnce();
    expect(s.progress.finalizeImageObservation).toHaveBeenCalledWith({
      lease,
      observationId: 'observation',
      revisionId: 'revision',
    });
    expect(s.progress.finalize).not.toHaveBeenCalled();
    expect(s.image).toHaveBeenCalledOnce();
    expect(s.transform).not.toHaveBeenCalled();
    expect(s.read).not.toHaveBeenCalled();
    expect(s.index).not.toHaveBeenCalled();
    expect(s.stage4).not.toHaveBeenCalled();
    expect(Object.isFrozen(s.image.mock.calls[0]?.[0])).toBe(true);
  });
  it('reuses completed image readiness without invoking another image execution', async () => {
    const s = setup(),
      pipeline = new SourcesStage3TestPipeline(s.deps);
    await pipeline.runForSourceVersion(input);
    expect(await pipeline.runForSourceVersion(input)).toEqual({
      status: 'IMAGE_OBSERVATION_COMPLETED',
      imageObservation: { ...observation, reused: true },
    });
    expect(s.image).toHaveBeenCalledOnce();
    expect(s.progress.finalizeImageObservation).toHaveBeenCalledOnce();
  });
  it('requires both an explicitly configured image pipeline and durable finalization before execution', async () => {
    for (const remove of ['pipeline', 'finalizer', 'progress'] as const) {
      const s = setup();
      if (remove === 'pipeline')
        delete (s.deps as { imageObservationPipeline?: unknown }).imageObservationPipeline;
      if (remove === 'finalizer') delete s.progress.finalizeImageObservation;
      if (remove === 'progress') delete (s.deps as { progress?: unknown }).progress;
      await expect(
        new SourcesStage3TestPipeline(s.deps).runForSourceVersion(input),
      ).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE', retryable: false });
      expect(s.image).not.toHaveBeenCalled();
      expect(s.transform).not.toHaveBeenCalled();
    }
  });
  it('does not invoke an image callback under an active lease owned by another worker', async () => {
    const s = setup();
    s.progress.claim = vi
      .fn<SourcesStage3ProgressPort['claim']>()
      .mockResolvedValue({ status: 'DEFERRED', reason: 'ACTIVE_LEASE' });
    expect(await new SourcesStage3TestPipeline(s.deps).runForSourceVersion(input)).toEqual({
      status: 'DEFERRED',
      reason: 'ACTIVE_LEASE',
    });
    expect(s.image).not.toHaveBeenCalled();
  });
  it('UNKNOWN remains nonretryable reconciliation and cannot blindly call the image pipeline again', async () => {
    const s = setup();
    s.image.mockRejectedValueOnce(
      new ShotgunError({
        code: 'OUTCOME_UNKNOWN',
        safeMessage: 'provider outcome unknown',
        module: 'test',
        operation: 'fake',
        retryable: true,
      }),
    );
    const pipeline = new SourcesStage3TestPipeline(s.deps);
    await expect(pipeline.runForSourceVersion(input)).rejects.toMatchObject({
      code: 'OUTCOME_UNKNOWN',
      retryable: false,
    });
    expect(s.progress.markFailure).toHaveBeenCalledWith(
      expect.objectContaining({ lease, code: 'OUTCOME_UNKNOWN', retryable: false }),
    );
    await expect(pipeline.runForSourceVersion(input)).rejects.toThrow('requires reconciliation');
    expect(s.image).toHaveBeenCalledOnce();
    expect(s.progress.finalizeImageObservation).not.toHaveBeenCalled();
  });
});
