import type {
  CanonicalCommittedPayload,
  CompiledTruthProjection,
  DiscoveryCanonicalCommittedEventEnvelopeV1,
  DiscoveryCanonicalCommittedSourceV1,
  DiscoveryProjectionBaseIdentityV1,
  DiscoveryProjectionKindV1,
  DiscoveryProjectionObservationV1,
  DiscoveryProjectionReadinessPort,
  DiscoveryJobV1,
  SemanticCorpusSourceSnapshotReaderPort,
} from '../../../packages/contracts/src/index.js';
import {
  assertDiscoveryRuntimeLifecycleTransitionV1,
  decodeDiscoveryJobV1,
  semanticStableJson,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { CanonicalKnowledgeRepositoryPort } from '../../../modules/canonical-knowledge/src/index.js';
import type { CompiledTruthRepositoryPort } from '../../../modules/compiled-truth/src/index.js';
import type {
  DiscoveryTriggerRuntimeJobLookupV1,
  DiscoveryTriggerRuntimeJobTransitionInputV1,
  DiscoveryTriggerRuntimeLogicalJobLookupV1,
  DiscoveryTriggerRuntimeRepositoryPort,
} from '../../../modules/discovery-trigger-coordinator/src/index.js';
import { aggregateDiscoveryProjectionReadinessV1 } from '../../../modules/discovery-trigger-coordinator/src/index.js';

type CanonicalSourceRepository = Pick<
  CanonicalKnowledgeRepositoryPort,
  'findOutbox' | 'findCommit'
>;

type SemanticWatermarkReader = Pick<SemanticCorpusSourceSnapshotReaderPort, 'readWatermark'>;

const outboxPrefix = 'canonical-outbox:';

const failClosed = (operation: string, safeMessage: string): never => {
  throw new ShotgunError({
    code: 'POLICY_DENIED',
    safeMessage,
    module: 'akp-4.discovery-trigger-coordinator',
    operation,
  });
};

const payloadMatches = (
  left: CanonicalCommittedPayload,
  right: CanonicalCommittedPayload,
): boolean => semanticStableJson(left) === semanticStableJson(right);

export class PostgresCanonicalCommittedSourceAdapter {
  constructor(
    private readonly canonical: CanonicalSourceRepository,
    private readonly watermark: SemanticWatermarkReader,
  ) {}

  async resolve(
    envelope: DiscoveryCanonicalCommittedEventEnvelopeV1,
  ): Promise<DiscoveryCanonicalCommittedSourceV1> {
    if (
      envelope.messageKind !== 'event' ||
      envelope.messageType !== 'CanonicalCommitted' ||
      envelope.schemaVersion !== '1.0.0'
    ) {
      return failClosed(
        'resolve-canonical-event',
        'Only CanonicalCommitted@1.0.0 events are accepted.',
      );
    }
    const projectId = envelope.projectId?.trim();
    if (!projectId)
      return failClosed(
        'resolve-canonical-event',
        'Canonical event Project authority is required.',
      );
    const payload = envelope.payload;
    const outboxId = envelope.idempotencyKey.startsWith(outboxPrefix)
      ? envelope.idempotencyKey.slice(outboxPrefix.length)
      : '';
    if (!outboxId) {
      return failClosed(
        'resolve-canonical-event',
        'CanonicalCommitted coordination requires the existing Canonical Outbox identity.',
      );
    }
    const outbox = await this.canonical.findOutbox(projectId, outboxId);
    if (!outbox)
      return failClosed('resolve-canonical-event', 'Canonical Outbox record was not found.');
    if (
      outbox.projectId !== projectId ||
      outbox.eventType !== 'CanonicalCommitted' ||
      !payloadMatches(outbox.payload, payload)
    ) {
      return failClosed(
        'resolve-canonical-event',
        'Canonical Outbox and event Project/payload authority disagree.',
      );
    }
    const commit = await this.canonical.findCommit(projectId, payload.commitId);
    if (!commit)
      return failClosed('resolve-canonical-event', 'Canonical Commit authority was not found.');
    if (
      commit.projectId !== projectId ||
      commit.commitId !== payload.commitId ||
      commit.operation !== payload.operation ||
      commit.status !== payload.status ||
      commit.afterVersion !== payload.canonicalVersion ||
      commit.snapshotDigest !== payload.snapshotDigest ||
      commit.outboxId !== outbox.outboxId
    ) {
      return failClosed(
        'resolve-canonical-event',
        'CanonicalCommitted does not match its durable Commit authority.',
      );
    }
    const sourceWatermark = await this.watermark.readWatermark(projectId);
    if (sourceWatermark.projectId !== projectId) {
      return failClosed(
        'resolve-canonical-event',
        'Semantic source watermark belongs to another Project.',
      );
    }
    return {
      projectId,
      eventIdentity: {
        eventId: commit.commitId,
        eventRevision: String(commit.afterVersion),
      },
      canonicalBase: {
        schemaVersion: '1.0.0',
        canonicalVersion: commit.afterVersion,
        snapshotDigest: commit.snapshotDigest,
      },
      requiredDiscoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: `semantic-corpus-source:v1:${sourceWatermark.canonicalVersion}`,
        projectionDigest: sourceWatermark.sourceSnapshotDigest,
      },
      createdAt: envelope.createdAt,
      ...(envelope.causationId === undefined ? {} : { causationId: envelope.causationId }),
      ...(envelope.correlationId === undefined ? {} : { correlationId: envelope.correlationId }),
    };
  }
}

type CompiledTruthReader = Pick<CompiledTruthRepositoryPort, 'findProjection'>;
type SemanticGenerationReader = {
  getActiveGenerationPointer(projectId: string): Promise<
    | {
        readonly projectId: string;
        readonly activeGenerationId: string;
        readonly pointerRevision: number;
        readonly sourceProjectionDigest: string;
        readonly canonicalBaseVersion: number;
      }
    | undefined
  >;
  getGeneration(
    projectId: string,
    generationId: string,
  ): Promise<
    | {
        readonly projectId: string;
        readonly generationId: string;
        readonly sourceProjectionDigest: string;
        readonly canonicalBaseVersion: number;
        readonly buildStatus: 'BUILDING' | 'READY' | 'FAILED';
      }
    | undefined
  >;
};

const sourceBaseVersion = (requiredBase: DiscoveryProjectionBaseIdentityV1): number | undefined => {
  const match = /^semantic-corpus-source:v1:(\d+)$/.exec(requiredBase.projectionRevision);
  return match ? Number(match[1]) : undefined;
};

const observed = (
  projectionKind: DiscoveryProjectionKindV1,
  requiredIdentity: DiscoveryProjectionBaseIdentityV1,
  status: DiscoveryProjectionObservationV1['status'],
  observedIdentity?: DiscoveryProjectionBaseIdentityV1,
  reason?: string,
): DiscoveryProjectionObservationV1 => ({
  projectionKind,
  requiredIdentity,
  ...(observedIdentity === undefined ? {} : { observedIdentity }),
  status,
  ...(reason === undefined ? {} : { reason }),
});

const compiledTruthObservation = async (
  projectId: string,
  requiredBase: DiscoveryProjectionBaseIdentityV1,
  compiledTruth: CompiledTruthProjection | undefined,
): Promise<DiscoveryProjectionObservationV1> => {
  if (!compiledTruth) {
    return observed('COMPILED_TRUTH', requiredBase, 'BEHIND', undefined, 'projection-not-built');
  }
  if (compiledTruth.projectId !== projectId) {
    return failClosed(
      'read-projection-readiness',
      'Compiled Truth projection belongs to another Project.',
    );
  }
  const baseVersion = sourceBaseVersion(requiredBase);
  const identity: DiscoveryProjectionBaseIdentityV1 = {
    schemaVersion: '1.0.0',
    projectionRevision: `compiled-truth:${compiledTruth.projectorVersion}:${compiledTruth.canonicalVersion}`,
    projectionDigest: compiledTruth.sourceSnapshotDigest,
  };
  const ready =
    baseVersion !== undefined &&
    compiledTruth.canonicalVersion === baseVersion &&
    compiledTruth.sourceSnapshotDigest === requiredBase.projectionDigest;
  return observed(
    'COMPILED_TRUTH',
    requiredBase,
    ready ? 'READY' : 'BEHIND',
    identity,
    ready ? undefined : 'projection-base-mismatch',
  );
};

const graphObservation = async (
  projectId: string,
  requiredBase: DiscoveryProjectionBaseIdentityV1,
  compiledTruth: CompiledTruthProjection | undefined,
): Promise<DiscoveryProjectionObservationV1> => {
  if (!compiledTruth) {
    return observed('GRAPH_PROJECTION', requiredBase, 'BEHIND', undefined, 'projection-not-built');
  }
  if (compiledTruth.projectId !== projectId) {
    return failClosed('read-projection-readiness', 'Graph projection belongs to another Project.');
  }
  const identity: DiscoveryProjectionBaseIdentityV1 = {
    schemaVersion: '1.0.0',
    projectionRevision: `compiled-truth-graph:${compiledTruth.projectorVersion}:${compiledTruth.canonicalVersion}`,
    projectionDigest: compiledTruth.sourceSnapshotDigest,
  };
  const baseVersion = sourceBaseVersion(requiredBase);
  const graphIsObservable =
    compiledTruth.graph !== undefined &&
    Array.isArray(compiledTruth.graph.nodes) &&
    Array.isArray(compiledTruth.graph.edges) &&
    compiledTruth.graph.fallback?.available === true;
  if (!graphIsObservable) {
    return observed(
      'GRAPH_PROJECTION',
      requiredBase,
      'UNAVAILABLE',
      identity,
      'graph-not-observable',
    );
  }
  const ready =
    baseVersion !== undefined &&
    compiledTruth.canonicalVersion === baseVersion &&
    compiledTruth.sourceSnapshotDigest === requiredBase.projectionDigest;
  return observed(
    'GRAPH_PROJECTION',
    requiredBase,
    ready ? 'READY' : 'BEHIND',
    identity,
    ready ? undefined : 'projection-base-mismatch',
  );
};

const semanticIndexObservation = async (
  projectId: string,
  requiredBase: DiscoveryProjectionBaseIdentityV1,
  repository: SemanticGenerationReader | undefined,
): Promise<DiscoveryProjectionObservationV1> => {
  if (!repository) {
    return observed(
      'SEMANTIC_INDEX',
      requiredBase,
      'UNAVAILABLE',
      undefined,
      'capability-unavailable',
    );
  }
  const pointer = await repository.getActiveGenerationPointer(projectId);
  if (!pointer) {
    return observed(
      'SEMANTIC_INDEX',
      requiredBase,
      'BEHIND',
      undefined,
      'active-generation-not-built',
    );
  }
  if (pointer.projectId !== projectId) {
    return failClosed(
      'read-projection-readiness',
      'Semantic generation pointer belongs to another Project.',
    );
  }
  const generation = await repository.getGeneration(projectId, pointer.activeGenerationId);
  if (!generation) {
    return observed(
      'SEMANTIC_INDEX',
      requiredBase,
      'UNAVAILABLE',
      undefined,
      'active-generation-missing',
    );
  }
  if (generation.projectId !== projectId) {
    return failClosed(
      'read-projection-readiness',
      'Semantic generation belongs to another Project.',
    );
  }
  const identity: DiscoveryProjectionBaseIdentityV1 = {
    schemaVersion: '1.0.0',
    projectionRevision: `semantic-generation:${generation.generationId}:${pointer.pointerRevision}`,
    projectionDigest: generation.sourceProjectionDigest,
  };
  const baseVersion = sourceBaseVersion(requiredBase);
  const ready =
    generation.buildStatus === 'READY' &&
    baseVersion !== undefined &&
    generation.canonicalBaseVersion === baseVersion &&
    generation.sourceProjectionDigest === requiredBase.projectionDigest &&
    pointer.canonicalBaseVersion === baseVersion &&
    pointer.sourceProjectionDigest === requiredBase.projectionDigest;
  return observed(
    'SEMANTIC_INDEX',
    requiredBase,
    ready ? 'READY' : 'BEHIND',
    identity,
    ready ? undefined : 'generation-base-mismatch-or-not-ready',
  );
};

export class PostgresDiscoveryProjectionReadinessAdapter implements DiscoveryProjectionReadinessPort {
  constructor(
    private readonly compiledTruth: CompiledTruthReader,
    private readonly semanticIndex?: SemanticGenerationReader,
  ) {}

  async read(input: {
    readonly projectId: string;
    readonly requiredBase: DiscoveryProjectionBaseIdentityV1;
    readonly projectionKinds: readonly DiscoveryProjectionKindV1[];
    readonly observedAt: string;
  }) {
    const compiledTruthPromise =
      input.projectionKinds.includes('COMPILED_TRUTH') ||
      input.projectionKinds.includes('GRAPH_PROJECTION')
        ? this.compiledTruth.findProjection(input.projectId)
        : Promise.resolve(undefined);
    const compiledTruth = await compiledTruthPromise;
    const observations = await Promise.all(
      input.projectionKinds.map(async (kind) => {
        if (kind === 'COMPILED_TRUTH') {
          return compiledTruthObservation(input.projectId, input.requiredBase, compiledTruth);
        }
        if (kind === 'GRAPH_PROJECTION') {
          return graphObservation(input.projectId, input.requiredBase, compiledTruth);
        }
        return semanticIndexObservation(input.projectId, input.requiredBase, this.semanticIndex);
      }),
    );
    return aggregateDiscoveryProjectionReadinessV1({
      requiredBase: input.requiredBase,
      observations,
      observedAt: input.observedAt,
    });
  }
}

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryDiscoveryRuntimeRepository implements DiscoveryTriggerRuntimeRepositoryPort {
  private readonly jobs = new Map<string, DiscoveryJobV1>();
  private mutationTail: Promise<void> = Promise.resolve();

  private async mutate<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async saveJob(job: DiscoveryJobV1): Promise<'CREATED' | 'CONFLICT'> {
    const decoded = decodeDiscoveryJobV1(job);
    return this.mutate(() => {
      const sameJobId = this.jobs.get(`${decoded.projectId}:${decoded.jobId}`);
      const sameLogical = [...this.jobs.values()].find(
        (candidate) =>
          candidate.projectId === decoded.projectId &&
          candidate.logicalIdentity.value === decoded.logicalIdentity.value,
      );
      if (sameJobId || sameLogical) return 'CONFLICT';
      this.jobs.set(`${decoded.projectId}:${decoded.jobId}`, clone(decoded));
      return 'CREATED';
    });
  }

  async findJob(lookup: DiscoveryTriggerRuntimeJobLookupV1): Promise<DiscoveryJobV1 | undefined> {
    const job = this.jobs.get(`${lookup.projectId}:${lookup.jobId}`);
    return job ? clone(job) : undefined;
  }

  async findJobByLogicalIdentity(
    lookup: DiscoveryTriggerRuntimeLogicalJobLookupV1,
  ): Promise<DiscoveryJobV1 | undefined> {
    const job = [...this.jobs.values()].find(
      (candidate) =>
        candidate.projectId === lookup.projectId &&
        candidate.logicalIdentity.value === lookup.logicalIdentity.value,
    );
    return job ? clone(job) : undefined;
  }

  async transitionJob(
    input: DiscoveryTriggerRuntimeJobTransitionInputV1,
  ): Promise<DiscoveryJobV1 | 'NOT_FOUND' | 'CONFLICT'> {
    return this.mutate(() => {
      const key = `${input.projectId}:${input.jobId}`;
      const current = this.jobs.get(key);
      if (!current) return 'NOT_FOUND';
      if (current.lifecycleRevision !== input.expectedLifecycleRevision) return 'CONFLICT';
      assertDiscoveryRuntimeLifecycleTransitionV1(current.lifecycleState, input.targetState);
      const updated = decodeDiscoveryJobV1({
        ...current,
        lifecycleState: input.targetState,
        lifecycleRevision: current.lifecycleRevision + 1,
        ...(input.projectionWait === undefined
          ? { projectionWait: undefined }
          : { projectionWait: input.projectionWait }),
        updatedAt: input.updatedAt,
      });
      this.jobs.set(key, clone(updated));
      return clone(updated);
    });
  }
}
