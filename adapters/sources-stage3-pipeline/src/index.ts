import type { AssetStoragePort } from '../../../modules/original-asset/src/index.js';
import {
  buildEvidenceCandidates,
  type EvidenceLocatorPort,
  type EvidenceRepositoryPort,
} from '../../../modules/evidence/src/index.js';
import type {
  DocumentTransformerPort,
  SavedTransformation,
  TransformationRepositoryPort,
} from '../../../modules/transformation/src/index.js';
import type {
  SourcesStage3AtomicPersistencePort,
  SourcesStage3EvidenceIndexedInput,
  SourcesStage3PipelineOutcome,
  SourcesStage3PipelinePort,
  SourcesStage3ProgressPort,
  SourcesStage3RecoveryItem,
  SourcesStage4ContinuationPort,
} from '../../../modules/frontend-sources-write/src/index.js';
import { classifySourcesStage3Failure } from '../../../modules/frontend-sources-write/src/index.js';
import { ShotgunError } from '../../../packages/contracts/src/index.js';

import type { SourcesStage4ContinuationStorePort } from '../../../modules/frontend-sources-write/src/index.js';

const assertStage3Input = (
  input: Parameters<SourcesStage3PipelinePort['runForSourceVersion']>[0],
): void => {
  const validSensitivity = ['public', 'internal', 'private', 'restricted'].includes(
    input.sensitivity,
  );
  if (
    !input.projectId ||
    !input.sourceId ||
    !input.sourceVersionId ||
    !input.storageKey ||
    !/^sha256:[a-f0-9]{64}$/.test(input.contentHash) ||
    !['text/plain', 'text/markdown'].includes(input.mediaType) ||
    input.accessScope.length === 0 ||
    !validSensitivity
  ) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'The SourceVersion Stage 3 input is invalid.',
      module: 'sources-stage3-pipeline',
      operation: 'validate-stage3-input',
    });
  }
};

/**
 * FE-P5-XP Correction C — Source Intake → Stage 3 Transformation/Evidence
 * production pipeline (real adapters, no fixture bridging).
 *
 * Reads the staged Source bytes through the AssetStorage port, transforms the
 * immutable SourceVersion with the configured `DocumentTransformerPort`,
 * persists the Transformation Revision and indexes its Evidence candidates
 * with the real Stage 3 repositories. The pipeline is idempotent:
 * `TransformationRepositoryPort.save` reuses the stored revision for the same
 * SourceVersion/transformer output, and the evidence index upserts.
 */
export type SharedSourcesStage3PipelineDependencies = {
  readonly storage: AssetStoragePort;
  readonly transformer: DocumentTransformerPort;
  readonly locator: EvidenceLocatorPort;
  readonly transformationRepository: TransformationRepositoryPort;
  readonly evidenceRepository: EvidenceRepositoryPort;
  readonly progress?: SourcesStage3ProgressPort;
  readonly atomicPersistence?: SourcesStage3AtomicPersistencePort;
  readonly stage4?: SourcesStage4ContinuationPort;
};

export type ProductionSourcesStage3PipelineDependencies = Omit<
  SharedSourcesStage3PipelineDependencies,
  'progress' | 'atomicPersistence'
> & {
  readonly progress: SourcesStage3ProgressPort;
  readonly atomicPersistence: SourcesStage3AtomicPersistencePort;
};

/** Shared implementation used by the durable production pipeline and the
 * explicitly test-only non-durable harness. */
class SourcesStage3PipelineRuntime implements SourcesStage3PipelinePort {
  constructor(private readonly deps: SharedSourcesStage3PipelineDependencies) {}

  async runForSourceVersion(
    input: Parameters<SourcesStage3PipelinePort['runForSourceVersion']>[0],
  ): Promise<SourcesStage3PipelineOutcome> {
    assertStage3Input(input);
    const workerId = `sources-stage3:${process.pid}`;
    const progressEnabled = Boolean(this.deps.progress && this.deps.atomicPersistence);
    let claim;
    if (progressEnabled) {
      try {
        await this.deps.progress!.ensureMaterialized({
          projectId: input.projectId,
          sourceId: input.sourceId,
          sourceVersionId: input.sourceVersionId,
        });
        claim = await this.deps.progress!.claim({
          projectId: input.projectId,
          sourceId: input.sourceId,
          sourceVersionId: input.sourceVersionId,
          workerId,
          leaseDurationMs: 30_000,
        });
      } catch (error) {
        const failure = classifySourcesStage3Failure(error);
        try {
          await this.deps.progress!.recordPreClaimFailure({
            projectId: input.projectId,
            sourceId: input.sourceId,
            sourceVersionId: input.sourceVersionId,
            ...failure,
          });
        } catch {
          // Preserve the original claim error. If the database is unavailable,
          // the durable failure record cannot become a false success signal.
        }
        throw error;
      }
    }
    if (claim?.status === 'DEFERRED') {
      throw new ShotgunError({
        code: 'RETRYABLE_DEPENDENCY',
        safeMessage:
          claim.reason === 'ACTIVE_LEASE'
            ? 'Stage 3 is already running for this SourceVersion.'
            : 'Stage 3 retry is not due yet.',
        module: 'sources-stage3-pipeline',
        operation: 'claim-stage3',
      });
    }
    if (claim?.status === 'BLOCKED') {
      throw new ShotgunError({
        code: 'TERMINAL_FAILURE',
        safeMessage: 'Stage 3 requires reconciliation before it can continue.',
        module: 'sources-stage3-pipeline',
        operation: 'claim-stage3',
      });
    }
    if (claim?.status === 'COMPLETED') {
      return {
        stage3: {
          revisionId: claim.revisionId,
          evidenceCount: claim.evidenceCount,
          reusedCount: claim.reusedCount,
        },
        stage4: { status: 'PENDING' },
      };
    }
    let saved: SavedTransformation;
    let indexed: Awaited<ReturnType<EvidenceRepositoryPort['index']>>;
    let continuationId: string | undefined;
    let indexingResultId: string | undefined;
    try {
      const bytes = await this.deps.storage.read(input.storageKey);
      // TextDecoder's default UTF-8 mode consumes a leading BOM. The original
      // asset hash is byte-addressed, so dropping that character makes the
      // document root hash disagree with the immutable SourceVersion hash.
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
      const sourceContentHash = input.contentHash;
      const output = await this.deps.transformer.transform({
        sourceId: input.sourceId,
        sourceVersionId: input.sourceVersionId,
        sourceContentHash,
        mediaType: input.mediaType,
        text,
      });
      const transformation = {
        projectId: input.projectId,
        sourceId: input.sourceId,
        sourceVersionId: input.sourceVersionId,
        sourceContentHash,
        transformer: this.deps.transformer.identity,
        output,
        accessScope: [...input.accessScope],
        sensitivity: input.sensitivity,
        createdAt: new Date().toISOString(),
      };
      if (this.deps.atomicPersistence && claim?.status === 'CLAIMED') {
        const persisted = await this.deps.atomicPersistence.persist({
          transformation,
          locator: this.deps.locator,
          lease: claim.lease,
          continuation: {
            projectId: input.projectId,
            sourceId: input.sourceId,
            sourceVersionId: input.sourceVersionId,
            accessScope: [...input.accessScope],
            sensitivity: input.sensitivity,
            dataClassification: 'source-content',
          },
        });
        saved = persisted.saved;
        indexed = persisted.indexed;
        continuationId = persisted.continuationId;
        indexingResultId = persisted.indexingResultId;
      } else {
        saved = await this.deps.transformationRepository.save(transformation);
        indexed = await this.deps.evidenceRepository.index(
          buildEvidenceCandidates(saved.revision, this.deps.locator),
        );
      }
    } catch (error) {
      if (claim?.status === 'CLAIMED') {
        const failure = classifySourcesStage3Failure(error);
        await this.deps.progress!.markFailure({ lease: claim.lease, ...failure });
      }
      throw error;
    }
    let stage4: SourcesStage3PipelineOutcome['stage4'] = { status: 'NOT_CONFIGURED' };
    if (indexed.items.length > 0 && this.deps.atomicPersistence && continuationId) {
      stage4 = { status: 'PENDING' };
    } else if (indexed.items.length > 0 && this.deps.stage4) {
      const continuation: SourcesStage3EvidenceIndexedInput = {
        projectId: input.projectId,
        sourceId: input.sourceId,
        sourceVersionId: input.sourceVersionId,
        revisionId: saved.revision.revisionId,
        evidenceCount: indexed.items.length,
        reusedCount: indexed.reusedCount,
        accessScope: [...input.accessScope],
        sensitivity: input.sensitivity,
        dataClassification: 'source-content',
      };
      try {
        await this.deps.stage4.onEvidenceIndexed(continuation);
        stage4 = { status: 'SUCCEEDED' };
      } catch {
        // Evidence is already durable at this point. Keep the downstream
        // failure in Stage 4's event/dead-letter recovery boundary; never
        // reinterpret a completed Source/Stage 3 intake as indeterminate.
        stage4 = { status: 'FAILED' };
      }
    }
    if (claim?.status === 'CLAIMED' && this.deps.progress && indexingResultId) {
      await this.deps.progress.finalize({
        lease: claim.lease,
        state: indexed.items.length === 0 ? 'NO_EVIDENCE' : 'STAGE3_COMPLETED',
        indexingResultId,
      });
    }
    return {
      stage3: {
        revisionId: saved.revision.revisionId,
        evidenceCount: indexed.items.length,
        reusedCount: indexed.reusedCount,
      },
      stage4,
    };
  }
}

/** Production Stage 3 boundary. Durable progress and atomic persistence are
 * required at compile time; the product assembly cannot accidentally select a
 * non-durable path. */
export class SourcesStage3Pipeline extends SourcesStage3PipelineRuntime {
  constructor(deps: ProductionSourcesStage3PipelineDependencies) {
    super(deps);
  }
}

/** The only production construction boundary for Stage 3. */
export const createProductionStage3Pipeline = (
  deps: ProductionSourcesStage3PipelineDependencies,
): SourcesStage3Pipeline => new SourcesStage3Pipeline(deps);

/** Test/module harness only. It intentionally preserves the lightweight
 * in-process path for isolated tests without making that path available from
 * the production factory. */
export class SourcesStage3TestPipeline extends SourcesStage3PipelineRuntime {
  constructor(deps: SharedSourcesStage3PipelineDependencies) {
    super(deps);
  }
}

/**
 * Reclaims durable Stage 3 positions after a process crash or lease expiry.
 * The progress repository is the recovery authority and returns the complete
 * immutable SourceVersion input, so recovery never reconstructs a new
 * SourceVersion or relies on submission state.
 */
export class SourcesStage3RecoveryDispatcher {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeTick: Promise<void> | undefined;

  constructor(
    private readonly progress: SourcesStage3ProgressPort,
    private readonly pipeline: SourcesStage3PipelinePort,
    private readonly options: {
      readonly intervalMs?: number;
      readonly batchSize?: number;
    } = {},
  ) {}

  async dispatchOnce(): Promise<'EMPTY' | 'SUCCEEDED' | 'FAILED'> {
    const recoverable = await this.progress.findRecoverable({
      limit: this.options.batchSize ?? 1,
    });
    const item = recoverable[0] as SourcesStage3RecoveryItem | undefined;
    if (!item) return 'EMPTY';
    try {
      await this.pipeline.runForSourceVersion({
        projectId: item.projectId,
        sourceId: item.sourceId,
        sourceVersionId: item.sourceVersionId,
        storageKey: item.storageKey,
        mediaType: item.mediaType,
        contentHash: item.contentHash,
        accessScope: [...item.accessScope],
        sensitivity: item.sensitivity,
      });
      return 'SUCCEEDED';
    } catch (error) {
      // The pipeline owns the lease-guarded retry transition.  Keep the
      // recovery loop observable and stop this tick so a broken dependency
      // cannot produce a hot loop.
      console.error('[sources-stage3-recovery] item failed', error);
      return 'FAILED';
    }
  }

  async startWorker(): Promise<() => Promise<void>> {
    this.stopped = false;
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      do {
        const outcome = await this.dispatchOnce();
        if (outcome !== 'SUCCEEDED') break;
      } while (!this.stopped);
      if (!this.stopped) {
        this.timer = setTimeout(() => {
          this.activeTick = tick()
            .catch((error: unknown) => {
              console.error('[sources-stage3-recovery] tick failed', error);
            })
            .finally(() => {
              this.activeTick = undefined;
            });
        }, this.options.intervalMs ?? 1_000);
      }
    };
    await tick();
    return async () => {
      this.stopped = true;
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = undefined;
      const activeTick = this.activeTick;
      if (activeTick) await Promise.allSettled([activeTick]);
    };
  }
}

/** Durable Stage 4 handoff worker. The store owns claim/lease/fence state;
 * this adapter only publishes the already-persisted EvidenceIndexed contract. */
export class SourcesStage4ContinuationDispatcher {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeTick: Promise<void> | undefined;

  constructor(
    private readonly store: SourcesStage4ContinuationStorePort,
    private readonly publisher: SourcesStage4ContinuationPort,
    private readonly options: {
      readonly workerId?: string;
      readonly leaseDurationMs?: number;
      readonly intervalMs?: number;
    } = {},
  ) {}

  async dispatchOnce(): Promise<'EMPTY' | 'SUCCEEDED' | 'FAILED'> {
    const claimed = await this.store.claimNext({
      workerId: this.options.workerId ?? `sources-stage4:${process.pid}`,
      leaseDurationMs: this.options.leaseDurationMs ?? 30_000,
    });
    if (claimed.status === 'EMPTY') return 'EMPTY';
    try {
      await this.publisher.onEvidenceIndexed(claimed.continuation);
      await this.store.complete({
        continuationId: claimed.continuationId,
        leaseToken: claimed.leaseToken,
        fencingToken: claimed.fencingToken,
      });
      return 'SUCCEEDED';
    } catch (error) {
      const sourceCode = error instanceof ShotgunError ? error.code : undefined;
      // A connector timeout or an unknown provider outcome must not be
      // replayed automatically: the external candidate-generation boundary
      // may have completed after the local acknowledgement was lost.  The
      // stable candidate request id is retained for explicit reconciliation.
      const outcomeUnknown = sourceCode === 'TIMEOUT' || sourceCode === 'OUTCOME_UNKNOWN';
      const code = outcomeUnknown ? 'OUTCOME_UNKNOWN' : (sourceCode ?? 'STAGE4_RETRYABLE_FAILURE');
      const retryable =
        !outcomeUnknown && !['POLICY_DENIED', 'VALIDATION_ERROR', 'CONFLICT'].includes(code);
      await this.store.fail({
        continuationId: claimed.continuationId,
        leaseToken: claimed.leaseToken,
        fencingToken: claimed.fencingToken,
        retryable,
        code,
        message:
          error instanceof ShotgunError
            ? error.safeMessage
            : 'Stage 4 continuation publication failed.',
      });
      return 'FAILED';
    }
  }

  async recoverExpired(): Promise<number> {
    return this.store.recoverExpired();
  }

  async startWorker(): Promise<() => Promise<void>> {
    this.stopped = false;
    const tick = async (): Promise<void> => {
      if (this.stopped) return;
      await this.recoverExpired();
      do {
        const outcome = await this.dispatchOnce();
        // A failed continuation has a durable retry schedule. Stop draining
        // this tick so a provider outage cannot turn into a hot retry loop;
        // the next scheduled tick observes next_attempt_at.
        if (outcome !== 'SUCCEEDED') break;
      } while (!this.stopped);
      if (!this.stopped) {
        this.timer = setTimeout(() => {
          this.activeTick = tick()
            .catch((error: unknown) => {
              // A failed scan must remain observable; the next scheduled tick
              // retries the durable queue rather than silently orphaning work.
              console.error('[sources-stage4-worker] tick failed', error);
            })
            .finally(() => {
              this.activeTick = undefined;
            });
        }, this.options.intervalMs ?? 1_000);
      }
    };
    await tick();
    return async () => {
      this.stopped = true;
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = undefined;
      const activeTick = this.activeTick;
      if (activeTick) await Promise.allSettled([activeTick]);
    };
  }
}
