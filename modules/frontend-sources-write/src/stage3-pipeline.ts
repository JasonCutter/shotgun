import type {
  DocumentIR,
  EvidenceSpan,
  SecurityContext,
  SourceMap,
  SourcesSensitivity,
  TextPositionSelector,
  TextQuoteSelector,
  TransformationRevision,
} from '../../../packages/contracts/src/index.js';

/** Historical backfill rows require explicit reconciliation and are never
 * picked up by the normal Stage 3/provider recovery loop. */
export const HISTORICAL_RECONCILIATION_REQUIRED_CODE =
  'HISTORICAL_RECONCILIATION_REQUIRED' as const;

/** Durable classification used by both the Stage 3 worker and submission
 * lifecycle. Runtime/SQL contract defects must not be retried as if they were
 * transient infrastructure failures. */
export type SourcesStage3FailureClassification = {
  readonly retryable: boolean;
  readonly code: string;
  readonly message: string;
};

export const STAGE3_RUNTIME_CONTRACT_ERROR_CODE = 'STAGE3_RUNTIME_CONTRACT_ERROR' as const;

export const classifySourcesStage3Failure = (
  error: unknown,
): SourcesStage3FailureClassification => {
  const candidate = error as { readonly code?: unknown; readonly safeMessage?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  const message =
    typeof candidate.safeMessage === 'string'
      ? candidate.safeMessage
      : error instanceof Error
        ? error.message
        : 'Stage 3 processing failed.';
  if (code === 'VALIDATION_ERROR' || code === 'POLICY_DENIED' || code === 'TERMINAL_FAILURE') {
    return { retryable: false, code, message };
  }
  if (code === 'RETRYABLE_DEPENDENCY' || code === 'TIMEOUT' || code === 'OUTCOME_UNKNOWN') {
    return { retryable: true, code, message };
  }
  if (code && /^(08|40001$|40P01$|55P03$)/.test(code)) {
    return { retryable: true, code: 'STAGE3_DB_TRANSIENT', message };
  }
  if (code && ['42P08', '42601', '42703', '42804'].includes(code)) {
    return { retryable: false, code: STAGE3_RUNTIME_CONTRACT_ERROR_CODE, message };
  }
  return { retryable: true, code: 'STAGE3_RETRYABLE_FAILURE', message };
};

/** Structural Stage 3 contracts kept in the Sources module boundary. The
 * implementation adapters may satisfy these shapes without making this
 * module depend on Evidence or Transformation domain modules. */
export type SourcesStage3EvidenceLocatorPort = {
  locate(source: string, quote: TextQuoteSelector): TextPositionSelector | undefined;
};

export type SourcesStage3EvidenceIndexResult = {
  readonly items: readonly EvidenceSpan[];
  readonly reusedCount: number;
};

export type SourcesStage3SavedTransformation = {
  readonly attemptId: string;
  readonly revision: TransformationRevision;
  readonly reusedRevision: boolean;
};

export type SourcesStage3TransformationInput = {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly sourceContentHash: string;
  readonly transformer: { readonly id: string; readonly version: string };
  readonly output: {
    readonly documentIR: DocumentIR;
    readonly sourceMap: SourceMap;
    readonly documentHash: string;
    readonly sourceMapHash: string;
  };
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
};

export type SourcesStage3TransformationRepositoryPort = {
  save(input: SourcesStage3TransformationInput): Promise<SourcesStage3SavedTransformation>;
};

export type SourcesStage3EvidenceRepositoryPort = {
  index(
    candidates: readonly Omit<EvidenceSpan, 'evidenceId'>[],
  ): Promise<SourcesStage3EvidenceIndexResult>;
};

/**
 * FE-P5-XP Correction C — Source Intake → Stage 3 Transformation/Evidence
 * production wiring port.
 *
 * The Sources product service invokes this after a SourceVersion is
 * materialized by a successful intake, so the SAME SourceVersion flows through
 * the real production Transformation/Evidence pipeline (never fixture-side
 * bridging). Implementations run the real Stage 3 adapters
 * (`DocumentTransformerPort` + `EvidenceLocatorPort` +
 * `TransformationRepositoryPort` + `EvidenceRepositoryPort` +
 * `AssetStoragePort`); the pipeline is idempotent (transformation save reuses
 * the stored revision for the same SourceVersion/transformer output and the
 * evidence index upserts).
 */
export type SourcesStage3PipelinePort = {
  runForSourceVersion(input: {
    readonly projectId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly storageKey: string;
    readonly mediaType: 'text/plain' | 'text/markdown';
    readonly contentHash: string;
    readonly accessScope: readonly string[];
    readonly sensitivity: SourcesSensitivity;
  }): Promise<SourcesStage3PipelineOutcome>;
};

export type SourcesStage3ProgressState =
  | 'MATERIALIZED'
  | 'STAGE3_RUNNING'
  | 'STAGE3_COMPLETED'
  | 'NO_EVIDENCE'
  | 'STAGE3_RETRYABLE'
  | 'RECONCILIATION_REQUIRED';

export type SourcesStage3ProgressLease = {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly fencingToken: number;
  readonly leaseToken: string;
};

export type SourcesStage3ClaimResult =
  | { readonly status: 'CLAIMED'; readonly lease: SourcesStage3ProgressLease }
  | {
      readonly status: 'COMPLETED';
      readonly state: 'STAGE3_COMPLETED' | 'NO_EVIDENCE';
      readonly revisionId: string;
      readonly indexingResultId: string;
      readonly evidenceCount: number;
      readonly reusedCount: number;
    }
  | { readonly status: 'DEFERRED'; readonly reason: 'ACTIVE_LEASE' | 'RETRY_NOT_DUE' }
  | {
      readonly status: 'BLOCKED';
      readonly reason: 'HISTORICAL_RECONCILIATION' | 'RUNTIME_CONTRACT';
    };

export type SourcesStage3RecoveryItem = {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly storageKey: string;
  readonly mediaType: 'text/plain' | 'text/markdown';
  readonly contentHash: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SourcesSensitivity;
  readonly state: SourcesStage3ProgressState;
};

export type SourcesStage3ProgressPort = {
  ensureMaterialized(input: {
    readonly projectId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly createdAt?: string;
  }): Promise<void>;
  claim(input: {
    readonly projectId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now?: string;
  }): Promise<SourcesStage3ClaimResult>;
  recordPreClaimFailure(input: {
    readonly projectId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly retryable: boolean;
    readonly code: string;
    readonly message: string;
    readonly nextAttemptAt?: string;
  }): Promise<void>;
  finalize(input: {
    readonly lease: SourcesStage3ProgressLease;
    readonly state: 'STAGE3_COMPLETED' | 'NO_EVIDENCE';
    readonly indexingResultId: string;
  }): Promise<void>;
  markRetryable(input: {
    readonly lease: SourcesStage3ProgressLease;
    readonly code: string;
    readonly message: string;
    readonly nextAttemptAt?: string;
  }): Promise<void>;
  markFailure(input: {
    readonly lease: SourcesStage3ProgressLease;
    readonly retryable: boolean;
    readonly code: string;
    readonly message: string;
    readonly nextAttemptAt?: string;
  }): Promise<void>;
  findRecoverable(input?: {
    readonly limit?: number;
    readonly now?: string;
  }): Promise<readonly SourcesStage3RecoveryItem[]>;
};

/**
 * A PostgreSQL Stage 3 adapter implements this port when transformation,
 * Evidence spans, indexing result and continuation intent must share one
 * transaction. The default repositories remain usable for isolated module
 * tests, but production wiring supplies this atomic adapter.
 */
export type SourcesStage3AtomicPersistencePort = {
  persist(input: {
    readonly transformation: SourcesStage3TransformationInput;
    readonly locator: SourcesStage3EvidenceLocatorPort;
    readonly continuation: Omit<
      SourcesStage3EvidenceIndexedInput,
      'revisionId' | 'evidenceCount' | 'reusedCount'
    >;
    readonly lease: SourcesStage3ProgressLease;
  }): Promise<{
    readonly saved: SourcesStage3SavedTransformation;
    readonly indexed: SourcesStage3EvidenceIndexResult;
    readonly indexingResultId: string;
    readonly continuationId?: string;
  }>;
};

export type SourcesStage4ContinuationStorePort = {
  claimNext(input: {
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now?: string;
  }): Promise<
    | {
        readonly status: 'CLAIMED';
        readonly continuation: SourcesStage3EvidenceIndexedInput;
        readonly continuationId: string;
        readonly leaseToken: string;
        readonly fencingToken: number;
      }
    | { readonly status: 'EMPTY' }
  >;
  complete(input: {
    readonly continuationId: string;
    readonly leaseToken: string;
    readonly fencingToken: number;
    readonly generationRequestId?: string;
    readonly executionPinRef?: string;
  }): Promise<void>;
  fail(input: {
    readonly continuationId: string;
    readonly leaseToken: string;
    readonly fencingToken: number;
    readonly retryable: boolean;
    readonly code: string;
    readonly message: string;
    readonly nextAttemptAt?: string;
  }): Promise<void>;
  recoverExpired(input?: { readonly now?: string }): Promise<number>;
};

/**
 * Stage 3 is the Source product's authoritative completion boundary. A
 * downstream Stage 4 continuation is reported separately so its failure can
 * be recovered in the Stage 4 domain without changing the Source intake
 * outcome.
 */
export type SourcesStage3PipelineOutcome = {
  readonly stage3: {
    readonly revisionId: string;
    readonly evidenceCount: number;
    readonly reusedCount: number;
  };
  readonly stage4:
    | { readonly status: 'NOT_CONFIGURED' }
    | { readonly status: 'PENDING' }
    | { readonly status: 'SUCCEEDED' }
    | { readonly status: 'FAILED' };
};

/** Stage 4 is started only after the Stage 3 Evidence transaction has
 * committed. The callback is intentionally a narrow event boundary so the
 * Sources domain never owns Candidate or AI persistence. */
export type SourcesStage3EvidenceIndexedInput = {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly revisionId: string;
  readonly evidenceCount: number;
  readonly reusedCount: number;
  readonly accessScope: readonly string[];
  readonly sensitivity: SourcesSensitivity;
  readonly dataClassification: string;
};

export type SourcesStage4ContinuationPort = {
  onEvidenceIndexed(input: SourcesStage3EvidenceIndexedInput): Promise<void>;
};
