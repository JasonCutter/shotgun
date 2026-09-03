import type {
  DiscoveryFindingEnvelopeV1,
  DiscoveryFollowUpQualificationProofV1,
  DiscoveryResourceRefV1,
  DiscoveryStageV1,
} from '../../../packages/contracts/src/index.js';
import { decodeDiscoveryFindingEnvelopeV1 } from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryRuntimeBudgetCheckpointV1,
  DiscoveryRuntimeCandidateProofV1,
  DiscoveryRuntimeCandidateV1,
  DiscoveryRuntimeConflictSelectionSignalV1,
  DiscoveryRuntimeBudgetSnapshotV1,
  DiscoveryRuntimeClaimV1,
  DiscoveryRuntimeExecutionRepositoryPort,
  DiscoveryRuntimeFailureFinalizationInputV1,
  DiscoveryRuntimeGeneratedFindingsStageValueV1,
  DiscoveryRuntimeLeaseV1,
  DiscoveryRuntimeStageOutputV1,
} from './index.js';

export type DiscoveryExecutionContextV1 = {
  readonly claim: DiscoveryRuntimeClaimV1;
  /** Claim-scoped cancellation owned by PersistentDiscoveryWorker. */
  readonly signal: AbortSignal;
  readonly budgetSnapshot: DiscoveryRuntimeBudgetSnapshotV1;
  readonly checkpointRevision: number;
  /** The worker clock used for all lease-fenced operational writes. */
  readonly now?: string;
  readonly stage?: {
    readonly stageId: string;
    readonly stageRevision: number;
    readonly stageType: DiscoveryStageV1['stageType'];
  };
  readonly saveBudgetSnapshot: (
    snapshot: DiscoveryRuntimeBudgetSnapshotV1,
  ) => Promise<'SAVED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'>;
};

export type DiscoveryExecutionStageResultV1<T> = {
  readonly value: T;
  readonly completion?: 'COMPLETE' | 'PARTIAL';
  /** Keep the stage retryable when a durable, resumable stage ran out of its
   * frozen work budget. The worker then finalizes the Job/Run/Attempt PARTIAL
   * without losing the stage cursor. */
  readonly retryStage?: boolean;
  readonly budgetSnapshot?: DiscoveryRuntimeBudgetSnapshotV1;
};

export type DiscoveryExecutionPortV1 = {
  loadSignals(
    context: DiscoveryExecutionContextV1,
  ): Promise<DiscoveryExecutionStageResultV1<unknown>>;
  generateFindings(
    context: DiscoveryExecutionContextV1,
    signals: unknown,
  ): Promise<
    DiscoveryExecutionStageResultV1<
      readonly unknown[] | DiscoveryRuntimeGeneratedFindingsStageValueV1
    >
  >;
  qualityGate(
    context: DiscoveryExecutionContextV1,
    candidates: readonly unknown[],
    qualityInputs?: unknown,
  ): Promise<DiscoveryExecutionStageResultV1<readonly DiscoveryFindingEnvelopeV1[]>>;
  persistFindings(
    context: DiscoveryExecutionContextV1,
    findings: readonly DiscoveryFindingEnvelopeV1[],
  ): Promise<DiscoveryExecutionStageResultV1<readonly DiscoveryFindingEnvelopeV1[]>>;
  /** Rehydrates durable findings after a process restart without re-running a
   * completed persistence stage. */
  loadPersistedFindings?(
    context: DiscoveryExecutionContextV1,
  ): Promise<readonly DiscoveryFindingEnvelopeV1[]>;
  publishFindingReady?(
    context: DiscoveryExecutionContextV1,
    finding: DiscoveryFindingEnvelopeV1,
  ): Promise<void>;
  reconcileFindings?(
    context: DiscoveryExecutionContextV1,
  ): Promise<DiscoveryExecutionStageResultV1<undefined> | void>;
};

export type PersistentDiscoveryWorkerOptionsV1 = {
  readonly workerId: string;
  readonly pollIntervalMs?: number;
  readonly leaseDurationMs?: number;
  readonly maxAttempts?: number;
  readonly retryBackoffMs?: number;
  readonly loopBackoffMaxMs?: number;
  readonly clock?: () => Date;
  /** Deterministic observer for loop-level infrastructure failures. */
  readonly observer?: PersistentDiscoveryWorkerObserverV1;
  /** Optional injected delay used by bounded loop backoff tests. */
  readonly sleep?: (delayMs: number) => Promise<void>;
};

export type PersistentDiscoveryWorkerObserverV1 = {
  onLoopError?(input: {
    readonly workerId: string;
    readonly code: string;
    readonly consecutiveFailures: number;
    readonly backoffMs: number;
    readonly observedAt: string;
  }): void | Promise<void>;
  onLoopHealthy?(input: {
    readonly workerId: string;
    readonly observedAt: string;
  }): void | Promise<void>;
};

export type PersistentDiscoveryWorkerStatusV1 = {
  readonly state: 'RUNNING' | 'STOPPING' | 'STOPPED';
  readonly health: 'HEALTHY' | 'DEGRADED';
  readonly consecutiveLoopFailures: number;
  readonly lastLoopErrorCode?: string;
};

export type PersistentDiscoveryWorkerRunResultV1 =
  'IDLE' | 'COMPLETED' | 'PARTIAL' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL' | 'STALE' | 'STOPPED';

export class DiscoveryWorkerFailureV1 extends Error {
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly safeMessage: string;

  public constructor(input: {
    readonly code: string;
    readonly retryable: boolean;
    readonly safeMessage: string;
  }) {
    super(input.safeMessage);
    this.name = 'DiscoveryWorkerFailureV1';
    this.code = input.code;
    this.retryable = input.retryable;
    this.safeMessage = input.safeMessage;
  }
}

const nonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must be non-empty`);
  return normalized;
};

const positiveBounded = (value: number, field: string, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${field} must be between 1 and ${maximum}`);
  }
  return value;
};

const emptySnapshot: DiscoveryRuntimeBudgetSnapshotV1 = {
  resources: 0,
  semanticNeighbors: 0,
  candidatePairs: 0,
  candidateGroups: 0,
  findings: 0,
  providerCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostMicros: 0,
  activeProviderCalls: 0,
};

const isSnapshot = (value: unknown): value is DiscoveryRuntimeBudgetSnapshotV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.keys(emptySnapshot).every((key) => {
    const dimension = (value as Record<string, unknown>)[key];
    return typeof dimension === 'number' && Number.isSafeInteger(dimension) && dimension >= 0;
  });
};

const recordValue = (value: unknown, field: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DiscoveryWorkerFailureV1({
      code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
      retryable: false,
      safeMessage: `${field} stage output contained invalid candidate proof.`,
    });
  }
  return value as Record<string, unknown>;
};

const strictRecord = (
  value: unknown,
  keys: readonly string[],
  field: string,
): Record<string, unknown> => {
  const record = recordValue(value, field);
  if (Object.keys(record).some((key) => !keys.includes(key))) {
    throw new DiscoveryWorkerFailureV1({
      code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
      retryable: false,
      safeMessage: `${field} stage output contained unsupported proof fields.`,
    });
  }
  return record;
};

const textValue = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DiscoveryWorkerFailureV1({
      code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
      retryable: false,
      safeMessage: `${field} stage output contained invalid proof text.`,
    });
  }
  return value;
};

const decodeCandidateProof = (
  value: unknown,
  field: string,
): DiscoveryRuntimeCandidateProofV1 | undefined => {
  if (value === undefined) return undefined;
  const proof = strictRecord(value, ['selectionSignals', 'qualifiedFollowUp'], field);
  let selectionSignals: readonly DiscoveryRuntimeConflictSelectionSignalV1[] | undefined;
  if (proof.selectionSignals !== undefined) {
    if (!Array.isArray(proof.selectionSignals)) {
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
        retryable: false,
        safeMessage: `${field}.selectionSignals is invalid.`,
      });
    }
    selectionSignals = proof.selectionSignals.map((value, index) => {
      const signal = strictRecord(
        value,
        ['kind', 'incompatibilityKind', 'source', 'signalId'],
        `${field}.selectionSignals[${index}]`,
      );
      const kinds = ['FACTUAL', 'TEMPORAL', 'IDENTITY', 'MODEL_DISAGREEMENT'] as const;
      const sources = [
        'TYPED_PROPOSITION',
        'TEMPORAL_QUALIFICATION',
        'IDENTITY_ASSIGNMENT',
        'EXPLICIT_CONFLICT_SIGNAL',
      ] as const;
      if (
        signal.kind !== 'EXPLICIT_INCOMPATIBILITY' ||
        !kinds.includes(signal.incompatibilityKind as (typeof kinds)[number]) ||
        !sources.includes(signal.source as (typeof sources)[number]) ||
        signal.source !==
          (
            {
              FACTUAL: 'TYPED_PROPOSITION',
              TEMPORAL: 'TEMPORAL_QUALIFICATION',
              IDENTITY: 'IDENTITY_ASSIGNMENT',
              MODEL_DISAGREEMENT: 'EXPLICIT_CONFLICT_SIGNAL',
            } as const
          )[signal.incompatibilityKind as (typeof kinds)[number]]
      ) {
        throw new DiscoveryWorkerFailureV1({
          code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
          retryable: false,
          safeMessage: `${field}.selectionSignals[${index}] is invalid.`,
        });
      }
      return {
        kind: 'EXPLICIT_INCOMPATIBILITY',
        incompatibilityKind:
          signal.incompatibilityKind as DiscoveryRuntimeConflictSelectionSignalV1['incompatibilityKind'],
        source: signal.source as DiscoveryRuntimeConflictSelectionSignalV1['source'],
        signalId: textValue(signal.signalId, `${field}.selectionSignals[${index}].signalId`),
      };
    });
  }
  if (proof.qualifiedFollowUp !== undefined) {
    const qualification = strictRecord(
      proof.qualifiedFollowUp,
      [
        'originIdentity',
        'projectId',
        'sourceProjectionDigest',
        'canonicalBase',
        'discoveryBase',
        'accessScope',
        'sensitivity',
        'relatedResourceRefs',
      ],
      `${field}.qualifiedFollowUp`,
    );
    const origin = strictRecord(
      qualification.originIdentity,
      ['schemaVersion', 'originFindingType', 'fingerprintVersion', 'fingerprint'],
      `${field}.qualifiedFollowUp.originIdentity`,
    );
    const originTypes = [
      'KNOWLEDGE_GAP',
      'EVIDENCE_GAP',
      'RELATION_HYPOTHESIS',
      'PATTERN_HYPOTHESIS',
      'CONFLICT_HYPOTHESIS',
    ] as const;
    if (
      origin.schemaVersion !== '1.0.0' ||
      !originTypes.includes(origin.originFindingType as (typeof originTypes)[number]) ||
      origin.fingerprintVersion !== 'discovery-fingerprint:v1' ||
      !/^sha256:[0-9a-f]{64}$/.test(
        textValue(origin.fingerprint, `${field}.originIdentity.fingerprint`),
      )
    ) {
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
        retryable: false,
        safeMessage: `${field}.qualifiedFollowUp.originIdentity is invalid.`,
      });
    }
    const canonicalBase = strictRecord(
      qualification.canonicalBase,
      ['schemaVersion', 'canonicalVersion', 'snapshotDigest'],
      `${field}.qualifiedFollowUp.canonicalBase`,
    );
    const discoveryBase = strictRecord(
      qualification.discoveryBase,
      ['schemaVersion', 'projectionRevision', 'projectionDigest'],
      `${field}.qualifiedFollowUp.discoveryBase`,
    );
    if (
      canonicalBase.schemaVersion !== '1.0.0' ||
      typeof canonicalBase.canonicalVersion !== 'number' ||
      !Number.isSafeInteger(canonicalBase.canonicalVersion) ||
      canonicalBase.canonicalVersion < 0 ||
      typeof canonicalBase.snapshotDigest !== 'string' ||
      discoveryBase.schemaVersion !== '1.0.0' ||
      typeof discoveryBase.projectionRevision !== 'string' ||
      typeof discoveryBase.projectionDigest !== 'string'
    ) {
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
        retryable: false,
        safeMessage: `${field}.qualifiedFollowUp base identity is invalid.`,
      });
    }
    if (!Array.isArray(qualification.accessScope) || qualification.accessScope.length === 0) {
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
        retryable: false,
        safeMessage: `${field}.qualifiedFollowUp.accessScope is invalid.`,
      });
    }
    const sensitivity = qualification.sensitivity;
    if (!['public', 'internal', 'private', 'restricted'].includes(String(sensitivity))) {
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
        retryable: false,
        safeMessage: `${field}.qualifiedFollowUp.sensitivity is invalid.`,
      });
    }
    const projectId = textValue(qualification.projectId, `${field}.qualifiedFollowUp.projectId`);
    const sourceProjectionDigest = textValue(
      qualification.sourceProjectionDigest,
      `${field}.qualifiedFollowUp.sourceProjectionDigest`,
    );
    const accessScope = qualification.accessScope.map((scope, index) =>
      textValue(scope, `${field}.qualifiedFollowUp.accessScope[${index}]`),
    );
    if (!Array.isArray(qualification.relatedResourceRefs)) {
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
        retryable: false,
        safeMessage: `${field}.qualifiedFollowUp.relatedResourceRefs is invalid.`,
      });
    }
    const relatedResourceRefs = qualification.relatedResourceRefs.map((value, index) => {
      const resource = strictRecord(
        value,
        [
          'schemaVersion',
          'resourceKind',
          'resourceId',
          'projectId',
          'resourceState',
          'resourceRevision',
        ],
        `${field}.qualifiedFollowUp.relatedResourceRefs[${index}]`,
      );
      const resourceKinds = [
        'CANONICAL_CLAIM',
        'CANONICAL_ENTITY',
        'CANONICAL_EVENT',
        'CANONICAL_RELATION',
        'CANONICAL_CONFLICT',
        'CANONICAL_DECISION',
        'SOURCE',
        'SOURCE_VERSION',
        'COMPILED_TRUTH_ITEM',
      ] as const;
      const resourceStates = ['CURRENT', 'APPROVED'] as const;
      if (
        resource.schemaVersion !== '1.0.0' ||
        !resourceKinds.includes(resource.resourceKind as (typeof resourceKinds)[number]) ||
        !resourceStates.includes(resource.resourceState as (typeof resourceStates)[number])
      ) {
        throw new DiscoveryWorkerFailureV1({
          code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
          retryable: false,
          safeMessage: `${field}.qualifiedFollowUp.relatedResourceRefs[${index}] is invalid.`,
        });
      }
      const resourceProjectId = textValue(
        resource.projectId,
        `${field}.qualifiedFollowUp.relatedResourceRefs[${index}].projectId`,
      );
      if (resourceProjectId !== projectId) {
        throw new DiscoveryWorkerFailureV1({
          code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
          retryable: false,
          safeMessage: `${field}.qualifiedFollowUp.relatedResourceRefs cross the Project boundary.`,
        });
      }
      const resourceId = textValue(
        resource.resourceId,
        `${field}.qualifiedFollowUp.relatedResourceRefs[${index}].resourceId`,
      );
      const resourceRevision =
        resource.resourceRevision === undefined
          ? undefined
          : textValue(
              resource.resourceRevision,
              `${field}.qualifiedFollowUp.relatedResourceRefs[${index}].resourceRevision`,
            );
      return {
        schemaVersion: '1.0.0' as const,
        resourceKind: resource.resourceKind as DiscoveryResourceRefV1['resourceKind'],
        resourceId,
        projectId: resourceProjectId,
        resourceState: resource.resourceState as DiscoveryResourceRefV1['resourceState'],
        ...(resourceRevision === undefined ? {} : { resourceRevision }),
      } satisfies DiscoveryResourceRefV1;
    });
    const qualifiedFollowUp: DiscoveryFollowUpQualificationProofV1 = {
      originIdentity: {
        schemaVersion: '1.0.0',
        originFindingType:
          origin.originFindingType as DiscoveryFollowUpQualificationProofV1['originIdentity']['originFindingType'],
        fingerprintVersion: 'discovery-fingerprint:v1',
        fingerprint: origin.fingerprint as `sha256:${string}`,
      },
      projectId,
      sourceProjectionDigest,
      canonicalBase: {
        schemaVersion: '1.0.0',
        canonicalVersion: canonicalBase.canonicalVersion,
        snapshotDigest: canonicalBase.snapshotDigest,
      },
      discoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: discoveryBase.projectionRevision,
        projectionDigest: discoveryBase.projectionDigest,
      },
      accessScope,
      sensitivity: sensitivity as DiscoveryFollowUpQualificationProofV1['sensitivity'],
      relatedResourceRefs,
    };
    return {
      ...(selectionSignals === undefined ? {} : { selectionSignals }),
      qualifiedFollowUp,
    };
  }
  return selectionSignals === undefined ? {} : { selectionSignals };
};

const failureFrom = (error: unknown): DiscoveryWorkerFailureV1 => {
  if (error instanceof DiscoveryWorkerFailureV1) return error;
  return new DiscoveryWorkerFailureV1({
    code: 'DISCOVERY_EXECUTION_UNCLASSIFIED',
    retryable: false,
    safeMessage: 'Discovery execution failed closed.',
  });
};

const nowIso = (clock: () => Date): string => {
  const now = clock();
  if (!Number.isFinite(now.getTime())) throw new TypeError('clock must return a valid Date');
  return now.toISOString();
};

const shutdownAbort = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

export class PersistentDiscoveryWorker {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly maxAttempts: number;
  private readonly retryBackoffMs: number;
  private readonly loopBackoffMaxMs: number;
  private readonly clock: () => Date;
  private readonly observer: PersistentDiscoveryWorkerObserverV1 | undefined;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private running = false;
  private stopping = false;
  private loopPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;
  private wakePoll: (() => void) | undefined;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly activeClaims = new Set<AbortController>();
  private loopHealth: 'HEALTHY' | 'DEGRADED' = 'HEALTHY';
  private consecutiveLoopFailures = 0;
  private lastLoopErrorCode: string | undefined;

  public constructor(
    private readonly repository: DiscoveryRuntimeExecutionRepositoryPort,
    private readonly execution: DiscoveryExecutionPortV1,
    options: PersistentDiscoveryWorkerOptionsV1,
  ) {
    this.workerId = nonEmpty(options.workerId, 'workerId');
    this.pollIntervalMs = positiveBounded(
      options.pollIntervalMs ?? 1_000,
      'pollIntervalMs',
      60_000,
    );
    this.leaseDurationMs = positiveBounded(
      options.leaseDurationMs ?? 30_000,
      'leaseDurationMs',
      300_000,
    );
    this.maxAttempts = positiveBounded(options.maxAttempts ?? 3, 'maxAttempts', 20);
    this.retryBackoffMs = positiveBounded(
      options.retryBackoffMs ?? 1_000,
      'retryBackoffMs',
      60_000,
    );
    this.loopBackoffMaxMs = positiveBounded(
      options.loopBackoffMaxMs ?? 30_000,
      'loopBackoffMaxMs',
      300_000,
    );
    this.clock = options.clock ?? (() => new Date());
    this.observer = options.observer;
    this.sleep =
      options.sleep ??
      ((delayMs) =>
        new Promise((resolve) => {
          const timer = setTimeout(resolve, delayMs);
          timer.unref?.();
        }));
  }

  public start(): void {
    if (this.running || this.loopPromise !== undefined) return;
    this.stopping = false;
    this.stopPromise = undefined;
    this.running = true;
    const loop = this.runLoop();
    this.loopPromise = loop;
    void loop.then(
      () => {
        if (this.loopPromise === loop) {
          this.loopPromise = undefined;
          if (!this.running) this.stopping = false;
        }
      },
      () => {
        if (this.loopPromise === loop) {
          this.loopPromise = undefined;
          if (!this.running) this.stopping = false;
        }
      },
    );
  }

  public status(): PersistentDiscoveryWorkerStatusV1 {
    return {
      state: this.running ? 'RUNNING' : this.stopping ? 'STOPPING' : 'STOPPED',
      health: this.loopHealth,
      consecutiveLoopFailures: this.consecutiveLoopFailures,
      ...(this.lastLoopErrorCode === undefined
        ? {}
        : { lastLoopErrorCode: this.lastLoopErrorCode }),
    };
  }

  public stop(options: { readonly graceMs?: number } = {}): Promise<void> {
    if (this.stopPromise !== undefined) return this.stopPromise;
    this.running = false;
    this.stopping = true;
    for (const controller of this.activeClaims) {
      controller.abort('SHOTGUN_DISCOVERY_WORKER_SHUTDOWN');
    }
    this.wakePoll?.();
    const loop = this.loopPromise;
    const graceMs = options.graceMs ?? 5_000;
    if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 300_000) {
      return Promise.reject(new TypeError('graceMs must be between 0 and 300000'));
    }
    this.stopPromise = (async () => {
      if (loop === undefined) return;
      if (graceMs === 0) return;
      const settledLoop = loop.then(
        () => undefined,
        () => undefined,
      );
      await Promise.race([
        settledLoop,
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, graceMs);
          timer.unref?.();
        }),
      ]);
      // Keep loopPromise until the actual loop settles. This prevents a new
      // start() from creating a second worker while a provider ignores abort.
    })();
    return this.stopPromise;
  }

  public async runOnce(): Promise<PersistentDiscoveryWorkerRunResultV1> {
    if (this.stopping) return 'IDLE';
    const now = nowIso(this.clock);
    const claim = await this.repository.claimNext({
      workerId: this.workerId,
      now,
      leaseDurationMs: this.leaseDurationMs,
    });
    if (!claim) return 'IDLE';

    const controller = new AbortController();
    this.activeClaims.add(controller);
    if (this.stopping) {
      controller.abort('SHOTGUN_DISCOVERY_WORKER_SHUTDOWN');
    }

    let lease: DiscoveryRuntimeLeaseV1 = {
      projectId: claim.projectId,
      jobId: claim.jobId,
      runId: claim.runId,
      attemptId: claim.attemptId,
      workerId: claim.workerId,
      fencingToken: claim.fencingToken,
      acquiredAt: claim.acquiredAt,
      expiresAt: claim.expiresAt,
    };
    try {
      const checkpoint = await this.repository.readBudgetCheckpoint({
        projectId: claim.projectId,
        jobId: claim.jobId,
        runId: claim.runId,
      });
      let budgetSnapshot = checkpoint?.snapshot ?? emptySnapshot;
      let checkpointRevision = checkpoint?.revision ?? 0;
      if (this.repository.readProviderReservationUsage) {
        const usage = await this.repository.readProviderReservationUsage({
          projectId: claim.projectId,
          jobId: claim.jobId,
          runId: claim.runId,
        });
        if (
          usage.providerCalls > claim.job.budget.maxProviderCalls ||
          usage.activeProviderCalls > claim.job.budget.maxConcurrentProviderCalls ||
          usage.inputTokens > claim.job.budget.maxInputTokens ||
          usage.outputTokens > claim.job.budget.maxOutputTokens ||
          usage.estimatedCostMicros > claim.job.budget.maxEstimatedCostMicros
        ) {
          throw new DiscoveryWorkerFailureV1({
            code: 'DISCOVERY_PROVIDER_RESERVATION_OVER_BUDGET',
            retryable: false,
            safeMessage: 'Discovery provider reservations exceeded the frozen budget.',
          });
        }
        budgetSnapshot = {
          ...budgetSnapshot,
          providerCalls: Math.max(budgetSnapshot.providerCalls, usage.providerCalls),
          inputTokens: Math.max(budgetSnapshot.inputTokens, usage.inputTokens),
          outputTokens: Math.max(budgetSnapshot.outputTokens, usage.outputTokens),
          estimatedCostMicros: Math.max(
            budgetSnapshot.estimatedCostMicros,
            usage.estimatedCostMicros,
          ),
          activeProviderCalls: usage.activeProviderCalls,
        };
      }
      const saveBudgetSnapshot = async (
        snapshot: DiscoveryRuntimeBudgetSnapshotV1,
      ): Promise<'SAVED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'> => {
        if (!isSnapshot(snapshot)) {
          throw new DiscoveryWorkerFailureV1({
            code: 'DISCOVERY_BUDGET_SNAPSHOT_INVALID',
            retryable: false,
            safeMessage: 'Discovery budget checkpoint was invalid.',
          });
        }
        const next: DiscoveryRuntimeBudgetCheckpointV1 = {
          schemaVersion: '1.0.0',
          projectId: claim.projectId,
          jobId: claim.jobId,
          runId: claim.runId,
          revision: checkpointRevision + 1,
          snapshot,
          updatedAt: nowIso(this.clock),
        };
        const result = await this.repository.writeBudgetCheckpoint({
          ...lease,
          checkpoint: next,
        });
        if (result === 'SAVED') {
          budgetSnapshot = snapshot;
          checkpointRevision = next.revision;
        }
        return result;
      };
      const context = (stage?: DiscoveryStageV1): DiscoveryExecutionContextV1 => ({
        claim,
        signal: controller.signal,
        budgetSnapshot,
        checkpointRevision,
        now: nowIso(this.clock),
        ...(stage === undefined
          ? {}
          : {
              stage: {
                stageId: stage.stageId,
                stageRevision: stage.stageRevision,
                stageType: stage.stageType,
              },
            }),
        saveBudgetSnapshot,
      });

      const stages = [
        ...(await this.repository.listStages({
          projectId: claim.projectId,
          runId: claim.runId,
          attemptId: claim.attemptId,
        })),
      ].sort((left, right) => left.stageOrdinal - right.stageOrdinal);
      let signals: unknown;
      let candidates: readonly unknown[] = [];
      let candidateQualityInputs: Record<string, DiscoveryRuntimeCandidateProofV1> | undefined;
      let findings: readonly DiscoveryFindingEnvelopeV1[] = [];
      let candidatesReady = false;
      let findingsReady = false;

      const normalizedFindingOutput = (
        value: unknown,
        field: string,
        allowBareFindings: boolean,
      ): {
        readonly findings: readonly DiscoveryFindingEnvelopeV1[];
        readonly qualityInputs?: Record<string, DiscoveryRuntimeCandidateProofV1>;
      } => {
        let findingValue = value;
        let qualityInputs: Record<string, DiscoveryRuntimeCandidateProofV1> | undefined;
        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          (value as Record<string, unknown>).schemaVersion === '1.0.0' &&
          Array.isArray((value as Record<string, unknown>).candidates)
        ) {
          const generated = strictRecord(
            value,
            ['schemaVersion', 'candidates'],
            field,
          ) as unknown as DiscoveryRuntimeGeneratedFindingsStageValueV1;
          const candidateRecords = generated.candidates.map((entry, index) => {
            const candidate = strictRecord(
              entry,
              ['schemaVersion', 'finding', 'proof'],
              `${field}[${index}]`,
            );
            if (candidate.schemaVersion !== '1.0.0') {
              throw new DiscoveryWorkerFailureV1({
                code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
                retryable: false,
                safeMessage: `${field}[${index}] candidate schema is invalid.`,
              });
            }
            const finding = decodeDiscoveryFindingEnvelopeV1(
              candidate.finding,
              `${field}[${index}].finding`,
            );
            const proof = decodeCandidateProof(candidate.proof, `${field}[${index}].proof`);
            if (
              (proof?.selectionSignals !== undefined &&
                finding.findingType !== 'CONFLICT_HYPOTHESIS') ||
              (proof?.qualifiedFollowUp !== undefined &&
                finding.findingType !== 'CLARIFICATION_QUESTION' &&
                finding.findingType !== 'ACTION_SUGGESTION')
            ) {
              throw new DiscoveryWorkerFailureV1({
                code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
                retryable: false,
                safeMessage: `${field}[${index}] proof does not match the Finding type.`,
              });
            }
            return {
              schemaVersion: '1.0.0' as const,
              finding,
              ...(proof === undefined ? {} : { proof }),
            };
          });
          findingValue = candidateRecords.map((candidate) => candidate.finding);
          qualityInputs = Object.fromEntries(
            candidateRecords.flatMap((candidate) =>
              candidate.proof === undefined ? [] : [[candidate.finding.findingId, candidate.proof]],
            ),
          );
        } else if (!allowBareFindings && Array.isArray(value)) {
          throw new DiscoveryWorkerFailureV1({
            code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
            retryable: false,
            safeMessage: `${field} stage output must preserve server-owned candidate proof.`,
          });
        }
        if (!Array.isArray(findingValue)) {
          throw new DiscoveryWorkerFailureV1({
            code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
            retryable: false,
            safeMessage: `${field} stage output must be a Finding array.`,
          });
        }
        const findings = findingValue.map((entry, index) => {
          try {
            const finding = decodeDiscoveryFindingEnvelopeV1(entry, `${field}[${index}]`);
            if (finding.projectId !== claim.projectId || finding.runId !== claim.runId) {
              throw new Error('Finding identity does not match the leased run.');
            }
            return finding;
          } catch {
            throw new DiscoveryWorkerFailureV1({
              code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
              retryable: false,
              safeMessage: `${field} stage output contained an invalid or cross-run Finding.`,
            });
          }
        });
        return qualityInputs === undefined ? { findings } : { findings, qualityInputs };
      };

      const durableOutputs = this.repository.readStageOutput !== undefined;
      const restoreOutput = async (stage: (typeof stages)[number]): Promise<boolean> => {
        if (!durableOutputs) return false;
        const stored = await this.repository.readStageOutput!({
          projectId: claim.projectId,
          runId: claim.runId,
          attemptId: claim.attemptId,
          stageId: stage.stageId,
        });
        if (!stored) return false;
        if (stored.stageType !== stage.stageType) {
          throw new DiscoveryWorkerFailureV1({
            code: 'DISCOVERY_STAGE_OUTPUT_INVALID',
            retryable: false,
            safeMessage: 'Discovery stage output did not match its stage.',
          });
        }
        if (stage.stageType === 'GENERATE_FINDINGS') {
          const normalized = normalizedFindingOutput(stored.output, 'generation', false);
          candidates = normalized.findings;
          candidateQualityInputs = normalized.qualityInputs;
          candidatesReady = true;
        } else if (stage.stageType === 'QUALITY_GATE' || stage.stageType === 'PERSIST_FINDINGS') {
          findings = normalizedFindingOutput(
            stored.output,
            stage.stageType.toLowerCase(),
            true,
          ).findings;
          findingsReady = true;
        }
        return true;
      };
      let completion: 'COMPLETE' | 'PARTIAL' =
        claim.job.lifecycleState === 'PARTIAL' ||
        claim.run.lifecycleState === 'PARTIAL' ||
        claim.attempt.lifecycleState === 'PARTIAL'
          ? 'PARTIAL'
          : 'COMPLETE';

      for (const stage of stages) {
        if (this.stopping && controller.signal.aborted) return 'STOPPED';
        const renewed = await this.repository.renewLease({
          ...lease,
          now: nowIso(this.clock),
          leaseDurationMs: this.leaseDurationMs,
        });
        if (renewed === 'STALE' || renewed === 'NOT_FOUND') return 'STALE';
        lease = renewed;

        let outputRecovered = false;
        if (stage.state === 'SUCCEEDED') {
          await restoreOutput(stage);
          continue;
        }
        if (
          durableOutputs &&
          ['GENERATE_FINDINGS', 'QUALITY_GATE', 'PERSIST_FINDINGS'].includes(stage.stageType)
        ) {
          outputRecovered = await restoreOutput(stage);
        }
        let currentStage = stage;
        if (currentStage.state === 'FAILED_RETRYABLE') {
          const queued = await this.repository.transitionStageWithLease({
            ...lease,
            stageId: currentStage.stageId,
            expectedStageRevision: currentStage.stageRevision,
            targetState: 'QUEUED',
            updatedAt: nowIso(this.clock),
          });
          if (typeof queued === 'string') return queued === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
          currentStage = queued;
        }
        if (currentStage.state === 'QUEUED') {
          const started = await this.repository.transitionStageWithLease({
            ...lease,
            stageId: currentStage.stageId,
            expectedStageRevision: currentStage.stageRevision,
            targetState: 'RUNNING',
            updatedAt: nowIso(this.clock),
          });
          if (typeof started === 'string') return started === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
          currentStage = started;
        }
        if (currentStage.state !== 'RUNNING') continue;

        if (outputRecovered) {
          const recovered = await this.repository.transitionStageWithLease({
            ...lease,
            stageId: currentStage.stageId,
            expectedStageRevision: currentStage.stageRevision,
            targetState: 'SUCCEEDED',
            updatedAt: nowIso(this.clock),
          });
          if (typeof recovered === 'string') {
            return recovered === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
          }
          continue;
        }

        let leaseLost = false;
        let heartbeatInFlight = false;
        const heartbeatInterval = setInterval(
          () => {
            if (heartbeatInFlight || leaseLost) return;
            heartbeatInFlight = true;
            void this.repository
              .renewLease({
                ...lease,
                now: nowIso(this.clock),
                leaseDurationMs: this.leaseDurationMs,
              })
              .then((renewed) => {
                if (renewed === 'STALE' || renewed === 'NOT_FOUND') {
                  leaseLost = true;
                } else {
                  lease = renewed;
                }
              })
              .catch(() => {
                // A failed heartbeat cannot authorize a provider result. The
                // stage is discarded unless a later heartbeat recovers it.
                leaseLost = true;
              })
              .finally(() => {
                heartbeatInFlight = false;
              });
          },
          Math.max(1_000, Math.floor(this.leaseDurationMs / 3)),
        );
        try {
          if (
            findings.length === 0 &&
            (currentStage.stageType === 'PUBLISH_REENTRY' ||
              currentStage.stageType === 'RECONCILE_FINDINGS') &&
            this.execution.loadPersistedFindings
          ) {
            findings = await this.execution.loadPersistedFindings(context(currentStage));
          }
          let result: DiscoveryExecutionStageResultV1<unknown> = {
            value: undefined,
          };
          switch (currentStage.stageType) {
            case 'WAIT_FOR_PROJECTION':
              break;
            case 'LOAD_SIGNALS':
              result = await this.execution.loadSignals(context(currentStage));
              signals = result.value;
              break;
            case 'GENERATE_FINDINGS':
              result = await this.execution.generateFindings(context(currentStage), signals);
              {
                const normalized = normalizedFindingOutput(result.value, 'generation', true);
                candidates = normalized.findings;
                candidateQualityInputs = normalized.qualityInputs;
              }
              candidatesReady = true;
              break;
            case 'QUALITY_GATE':
              if (durableOutputs && !candidatesReady) {
                throw new DiscoveryWorkerFailureV1({
                  code: 'DISCOVERY_CANDIDATE_CHECKPOINT_MISSING',
                  retryable: false,
                  safeMessage: 'Completed Discovery generation output was not recoverable.',
                });
              }
              result = await this.execution.qualityGate(
                context(currentStage),
                candidates,
                candidateQualityInputs,
              );
              findings = normalizedFindingOutput(result.value, 'quality', true).findings;
              findingsReady = true;
              break;
            case 'PERSIST_FINDINGS':
              if (durableOutputs && !findingsReady) {
                throw new DiscoveryWorkerFailureV1({
                  code: 'DISCOVERY_FINDING_CHECKPOINT_MISSING',
                  retryable: false,
                  safeMessage: 'Completed Discovery quality output was not recoverable.',
                });
              }
              result = await this.execution.persistFindings(context(currentStage), findings);
              findings = normalizedFindingOutput(result.value, 'persistence', true).findings;
              findingsReady = true;
              break;
            case 'PUBLISH_REENTRY':
              if (this.execution.publishFindingReady) {
                for (const finding of findings) {
                  await this.execution.publishFindingReady(context(currentStage), finding);
                }
              }
              break;
            case 'RECONCILE_FINDINGS':
              if (this.execution.reconcileFindings) {
                result = (await this.execution.reconcileFindings(context(currentStage))) ?? result;
              }
              break;
          }
          if (leaseLost) return 'STALE';
          if (this.stopping && controller.signal.aborted) return 'STOPPED';
          if (result.completion === 'PARTIAL') completion = 'PARTIAL';
          if (result.budgetSnapshot !== undefined) {
            const saved = await saveBudgetSnapshot(result.budgetSnapshot);
            if (saved === 'STALE' || saved === 'NOT_FOUND') return 'STALE';
            if (saved === 'CONFLICT') {
              throw new DiscoveryWorkerFailureV1({
                code: 'DISCOVERY_BUDGET_CHECKPOINT_CONFLICT',
                retryable: false,
                safeMessage: 'Discovery budget checkpoint conflicted during execution.',
              });
            }
          }
          if (result.retryStage) {
            if (result.completion !== 'PARTIAL') {
              throw new DiscoveryWorkerFailureV1({
                code: 'DISCOVERY_STAGE_RETRY_CONTRACT_INVALID',
                retryable: false,
                safeMessage: 'A retryable Discovery stage must return PARTIAL completion.',
              });
            }
            const requeued = await this.repository.transitionStageWithLease({
              ...lease,
              stageId: currentStage.stageId,
              expectedStageRevision: currentStage.stageRevision,
              targetState: 'FAILED_RETRYABLE',
              updatedAt: nowIso(this.clock),
            });
            if (typeof requeued === 'string') {
              return requeued === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
            }
            break;
          }
          if (
            this.repository.writeStageOutput !== undefined &&
            ['GENERATE_FINDINGS', 'QUALITY_GATE', 'PERSIST_FINDINGS'].includes(
              currentStage.stageType,
            )
          ) {
            const durableCandidates =
              currentStage.stageType === 'GENERATE_FINDINGS'
                ? candidates.map((entry, index) => {
                    const finding = decodeDiscoveryFindingEnvelopeV1(entry, `generation[${index}]`);
                    return {
                      schemaVersion: '1.0.0' as const,
                      finding,
                      ...(candidateQualityInputs?.[finding.findingId] === undefined
                        ? {}
                        : { proof: candidateQualityInputs[finding.findingId] }),
                    } satisfies DiscoveryRuntimeCandidateV1;
                  })
                : undefined;
            const output: DiscoveryRuntimeStageOutputV1 = {
              schemaVersion: '1.0.0',
              projectId: claim.projectId,
              jobId: claim.jobId,
              runId: claim.runId,
              attemptId: claim.attemptId,
              stageId: currentStage.stageId,
              stageType: currentStage.stageType,
              stageRevision: currentStage.stageRevision + 1,
              output:
                currentStage.stageType === 'GENERATE_FINDINGS'
                  ? {
                      schemaVersion: '1.0.0',
                      candidates: durableCandidates ?? [],
                    }
                  : findings,
              updatedAt: nowIso(this.clock),
            };
            const saved = await this.repository.writeStageOutput({ ...lease, output });
            if (saved === 'STALE' || saved === 'NOT_FOUND') return 'STALE';
            if (saved === 'CONFLICT') {
              throw new DiscoveryWorkerFailureV1({
                code: 'DISCOVERY_STAGE_OUTPUT_CONFLICT',
                retryable: false,
                safeMessage: 'Discovery stage output conflicted during recovery.',
              });
            }
          }
          const finished = await this.repository.transitionStageWithLease({
            ...lease,
            stageId: currentStage.stageId,
            expectedStageRevision: currentStage.stageRevision,
            targetState: 'SUCCEEDED',
            updatedAt: nowIso(this.clock),
          });
          if (typeof finished === 'string')
            return finished === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
        } catch (error) {
          if (this.stopping && (controller.signal.aborted || shutdownAbort(error))) {
            return 'STOPPED';
          }
          return await this.failClaim(
            lease,
            currentStage.stageId,
            currentStage.stageRevision,
            error,
            claim.attempt.attemptNumber,
            claim,
          );
        } finally {
          clearInterval(heartbeatInterval);
        }
      }

      const target = completion === 'PARTIAL' ? 'PARTIAL' : 'SUCCEEDED';
      if (this.stopping && controller.signal.aborted) return 'STOPPED';
      const finalized = await this.repository.finalizeClaimWithLease({
        ...lease,
        expectedAttemptLifecycleRevision: claim.attempt.lifecycleRevision,
        expectedRunLifecycleRevision: claim.run.lifecycleRevision,
        expectedJobLifecycleRevision: claim.job.lifecycleRevision,
        targetState: target,
        updatedAt: nowIso(this.clock),
      });
      if (finalized === 'STALE') return 'STALE';
      if (finalized === 'NOT_FOUND' || finalized === 'CONFLICT') return 'FAILED_TERMINAL';
      return completion === 'PARTIAL' ? 'PARTIAL' : 'COMPLETED';
    } catch (error) {
      if (this.stopping && (controller.signal.aborted || shutdownAbort(error))) {
        return 'STOPPED';
      }
      return await this.failClaim(
        lease,
        undefined,
        undefined,
        error,
        claim.attempt.attemptNumber,
        claim,
      );
    } finally {
      this.activeClaims.delete(controller);
      await this.repository.releaseLease({ ...lease, now: nowIso(this.clock) });
    }
  }

  private async failClaim(
    lease: DiscoveryRuntimeLeaseV1,
    stageId: string | undefined,
    stageRevision: number | undefined,
    error: unknown,
    attemptNumber: number,
    claim: DiscoveryRuntimeClaimV1,
  ): Promise<'FAILED_RETRYABLE' | 'FAILED_TERMINAL' | 'STALE'> {
    const failure = failureFrom(error);
    const retryable = failure.retryable && attemptNumber < this.maxAttempts;
    const occurredAt = nowIso(this.clock);
    const retryNotBefore = retryable
      ? new Date(this.clock().getTime() + this.retryBackoffMs * attemptNumber).toISOString()
      : undefined;
    const target = retryable ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL';
    if (this.repository.finalizeFailureWithLease !== undefined) {
      const finalized = await this.repository.finalizeFailureWithLease({
        ...lease,
        ...(stageId === undefined
          ? {}
          : {
              stageId,
              expectedStageRevision: stageRevision,
            }),
        expectedAttemptLifecycleRevision: claim.attempt.lifecycleRevision,
        expectedRunLifecycleRevision: claim.run.lifecycleRevision,
        expectedJobLifecycleRevision: claim.job.lifecycleRevision,
        targetState: target,
        failure: {
          schemaVersion: '1.0.0',
          code: failure.code,
          classification: retryable ? 'RETRYABLE' : 'TERMINAL',
          retryable,
          safeMessage: failure.safeMessage,
          failedStage: stageId ?? 'DISCOVERY_EXECUTION',
          occurredAt,
          ...(retryNotBefore === undefined ? {} : { retryNotBefore }),
        },
      } satisfies DiscoveryRuntimeFailureFinalizationInputV1);
      if (finalized === 'STALE' || finalized === 'NOT_FOUND') return 'STALE';
      return finalized === 'FAILED_RETRYABLE' ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL';
    }
    const contextResult = await this.repository.saveFailureContext({
      ...lease,
      failure: {
        schemaVersion: '1.0.0',
        code: failure.code,
        classification: retryable ? 'RETRYABLE' : 'TERMINAL',
        retryable,
        safeMessage: failure.safeMessage,
        failedStage: stageId ?? 'DISCOVERY_EXECUTION',
        occurredAt,
        ...(retryNotBefore === undefined ? {} : { retryNotBefore }),
      },
    });
    if (contextResult === 'STALE' || contextResult === 'NOT_FOUND') return 'STALE';
    if (stageId !== undefined && stageRevision !== undefined) {
      const stageResult = await this.repository.transitionStageWithLease({
        ...lease,
        stageId,
        expectedStageRevision: stageRevision,
        targetState: target,
        updatedAt: occurredAt,
      });
      if (typeof stageResult === 'string')
        return stageResult === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
    }
    const attemptResult = await this.repository.transitionAttemptWithLease({
      ...lease,
      expectedLifecycleRevision: await this.currentAttemptRevision(lease),
      targetState: target,
      updatedAt: occurredAt,
    });
    if (attemptResult === 'STALE') return 'STALE';
    if (typeof attemptResult === 'string') return 'FAILED_TERMINAL';
    const runResult = await this.repository.transitionRunWithLease({
      ...lease,
      expectedLifecycleRevision: await this.currentRunRevision(lease),
      targetState: target,
      updatedAt: occurredAt,
    });
    if (runResult === 'STALE') return 'STALE';
    if (typeof runResult === 'string') return 'FAILED_TERMINAL';
    const jobResult = await this.repository.transitionJobWithLease({
      ...lease,
      expectedLifecycleRevision: await this.currentJobRevision(lease),
      targetState: target,
      updatedAt: occurredAt,
    });
    if (typeof jobResult === 'string') return jobResult === 'STALE' ? 'STALE' : 'FAILED_TERMINAL';
    return retryable ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL';
  }

  private async currentAttemptRevision(lease: DiscoveryRuntimeLeaseV1): Promise<number> {
    const attempts = await this.repository.listAttempts({
      projectId: lease.projectId,
      jobId: lease.jobId,
      runId: lease.runId,
    });
    const attempt = attempts.find((candidate) => candidate.attemptId === lease.attemptId);
    if (!attempt)
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_ATTEMPT_MISSING',
        retryable: false,
        safeMessage: 'Discovery attempt disappeared during failure handling.',
      });
    return attempt.lifecycleRevision;
  }

  private async currentRunRevision(lease: DiscoveryRuntimeLeaseV1): Promise<number> {
    const run = await this.repository.findRun({
      projectId: lease.projectId,
      jobId: lease.jobId,
      runId: lease.runId,
    });
    if (!run)
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_RUN_MISSING',
        retryable: false,
        safeMessage: 'Discovery run disappeared during failure handling.',
      });
    return run.lifecycleRevision;
  }

  private async currentJobRevision(lease: DiscoveryRuntimeLeaseV1): Promise<number> {
    const job = await this.repository.findJob({ projectId: lease.projectId, jobId: lease.jobId });
    if (!job)
      throw new DiscoveryWorkerFailureV1({
        code: 'DISCOVERY_JOB_MISSING',
        retryable: false,
        safeMessage: 'Discovery job disappeared during failure handling.',
      });
    return job.lifecycleRevision;
  }

  private async runLoop(): Promise<void> {
    let consecutiveFailures = 0;
    while (this.running) {
      try {
        await this.runOnce();
        if (consecutiveFailures > 0) {
          consecutiveFailures = 0;
          this.consecutiveLoopFailures = 0;
          this.loopHealth = 'HEALTHY';
          this.lastLoopErrorCode = undefined;
          await this.notifyHealthy();
        }
        if (this.running) await this.waitForPoll();
      } catch (error) {
        if (this.stopping && !this.running) break;
        // The lease is finite and the next worker can recover the claim. An
        // unexpected repository error must not kill the worker loop, but it
        // must be observable and bounded so a broken dependency cannot cause
        // an unbounded hot loop.
        consecutiveFailures += 1;
        this.consecutiveLoopFailures = consecutiveFailures;
        this.loopHealth = 'DEGRADED';
        const backoffMs = Math.min(
          this.loopBackoffMaxMs,
          this.retryBackoffMs * 2 ** Math.min(consecutiveFailures - 1, 20),
        );
        const code =
          error instanceof DiscoveryWorkerFailureV1 ? error.code : 'DISCOVERY_LOOP_UNEXPECTED';
        this.lastLoopErrorCode = code;
        await this.notifyLoopError({
          workerId: this.workerId,
          code,
          consecutiveFailures,
          backoffMs,
          observedAt: nowIso(this.clock),
        });
        if (this.running) await this.waitForBackoff(backoffMs);
      }
    }
  }

  private async notifyLoopError(
    input: Parameters<NonNullable<PersistentDiscoveryWorkerObserverV1['onLoopError']>>[0],
  ): Promise<void> {
    try {
      await this.observer?.onLoopError?.(input);
    } catch {
      // Observability must never become a second failure path.
    }
  }

  private async notifyHealthy(): Promise<void> {
    try {
      await this.observer?.onLoopHealthy?.({
        workerId: this.workerId,
        observedAt: nowIso(this.clock),
      });
    } catch {
      // Observability must never become a second failure path.
    }
  }

  private async waitForBackoff(delayMs: number): Promise<void> {
    let wake: (() => void) | undefined;
    const interrupted = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const previousWake = this.wakePoll;
    this.wakePoll = () => {
      previousWake?.();
      wake?.();
    };
    try {
      await Promise.race([this.sleep(delayMs), interrupted]);
    } finally {
      if (this.wakePoll !== undefined) this.wakePoll = previousWake;
    }
  }

  private async waitForPoll(): Promise<void> {
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = (): void => {
        if (settled) return;
        settled = true;
        if (this.pollTimer !== undefined) clearTimeout(this.pollTimer);
        this.pollTimer = undefined;
        this.wakePoll = undefined;
        resolve();
      };
      this.wakePoll = settle;
      this.pollTimer = setTimeout(settle, this.pollIntervalMs);
    });
  }
}
