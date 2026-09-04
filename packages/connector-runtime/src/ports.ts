import type { AnyEnvelope, Actor } from '../../contracts/src/index.js';
import type { AttemptRecord, JobRecord, JobRunResult } from '../../job-runtime/src/index.js';
import type { DeadLetterEntry, ReplayRecord } from './stores.js';

/**
 * Infrastructure-neutral identity owned by Shotgun.  Adapters must persist
 * this identity as the single semantic delivery key; provider/job IDs are not
 * interchangeable with it.
 */
export type ConnectorSemanticIdentity = {
  readonly projectId: string;
  readonly securityScope: string;
  readonly consumerId: string;
  readonly messageKind: 'command' | 'event' | 'query';
  readonly messageType: string;
  readonly semanticKey: string;
  readonly fingerprint: string;
};

export type DedupState = 'IN_PROGRESS' | 'OUTCOME_UNKNOWN' | 'COMPLETED' | 'FAILED';

export type DedupRecord<TResult = unknown> = ConnectorSemanticIdentity & {
  readonly state: DedupState;
  readonly jobId?: string;
  readonly fenceToken: number;
  readonly result?: TResult;
  readonly safeErrorCode?: string;
  readonly safeErrorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type DedupBeginResult<TResult = unknown> =
  | { readonly kind: 'ACQUIRED'; readonly record: DedupRecord<TResult> }
  | { readonly kind: 'DUPLICATE'; readonly record: DedupRecord<TResult> }
  | { readonly kind: 'CONFLICT'; readonly record: DedupRecord<TResult> };

export type ReplayAuthorization = {
  readonly actor: Actor;
  readonly projectId: string;
  /** Canonical serialized security scope for the original delivery. */
  readonly securityScope: string;
  readonly reason: string;
};

export type DedupStorePort = {
  begin<TResult>(
    input: ConnectorSemanticIdentity & { readonly jobId: string },
  ): Promise<DedupBeginResult<TResult>>;
  complete<TResult>(input: {
    readonly identity: ConnectorSemanticIdentity;
    readonly fenceToken: number;
    readonly jobId: string;
    readonly result: TResult;
  }): Promise<void>;
  fail(input: {
    readonly identity: ConnectorSemanticIdentity;
    readonly fenceToken: number;
    readonly jobId: string;
    readonly safeErrorCode: string;
    readonly safeErrorMessage: string;
  }): Promise<void>;
  markOutcomeUnknown(input: {
    readonly identity: ConnectorSemanticIdentity;
    readonly fenceToken: number;
    readonly jobId: string;
    readonly safeErrorMessage: string;
  }): Promise<void>;
  reconcile<TResult>(input: {
    readonly identity: ConnectorSemanticIdentity;
    readonly result?: TResult;
    readonly safeErrorCode?: string;
    readonly safeErrorMessage?: string;
  }): Promise<DedupRecord<TResult> | undefined>;
  get<TResult>(identity: ConnectorSemanticIdentity): Promise<DedupRecord<TResult> | undefined>;
};

export type JobRuntimePort = {
  enqueue(input: {
    readonly jobId: string;
    readonly dedupRecordId: string;
    readonly identity: ConnectorSemanticIdentity;
    readonly correlationId: string;
  }): Promise<JobRecord>;
  claim(input: {
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly leaseDurationMs: number;
  }): Promise<{ readonly fencingToken: number; readonly leaseExpiresAt: string } | undefined>;
  renew(input: {
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly fencingToken: number;
    readonly leaseDurationMs: number;
  }): Promise<boolean>;
  complete(input: {
    readonly jobId: string;
    readonly fencingToken: number;
    readonly result: unknown;
  }): Promise<boolean>;
  retry(input: {
    readonly jobId: string;
    readonly fencingToken: number;
    readonly nextAttemptAt: string;
    readonly safeErrorCode: string;
    readonly safeErrorMessage: string;
  }): Promise<boolean>;
  terminal(input: {
    readonly jobId: string;
    readonly fencingToken: number;
    readonly status: 'failed' | 'outcome-unknown' | 'dead-letter';
    readonly safeErrorCode: string;
    readonly safeErrorMessage: string;
  }): Promise<boolean>;
  cancel(input: { readonly jobId: string; readonly fencingToken: number }): Promise<boolean>;
  run<TResult>(
    identity: ConnectorSemanticIdentity,
    correlationId: string,
    operation: (attempt: AttemptRecord) => Promise<TResult>,
  ): Promise<JobRunResult<TResult>>;
  list(): Promise<readonly JobRecord[]>;
  find(identity: ConnectorSemanticIdentity): Promise<JobRecord | undefined>;
};

export type DeadLetterStorePort = {
  add(
    input: Omit<DeadLetterEntry, 'deadLetterId' | 'createdAt' | 'status' | 'replays'>,
  ): Promise<DeadLetterEntry>;
  get(deadLetterId: string): Promise<DeadLetterEntry>;
  list(): Promise<readonly DeadLetterEntry[]>;
  authorizeReplay(deadLetterId: string, authorization: ReplayAuthorization): Promise<void>;
  appendReplay(deadLetterId: string, replay: ReplayRecord): Promise<void>;
  updateReplay(replayId: string, status: ReplayRecord['status']): Promise<void>;
  resolve(deadLetterId: string): Promise<void>;
};

export type OrderingStorePort = {
  acquireNext(
    identity: ConnectorSemanticIdentity,
    envelope: AnyEnvelope,
    jobId: string,
    leaseDurationMs: number,
  ): Promise<{ readonly fencingToken: number }>;
  commit(
    identity: ConnectorSemanticIdentity,
    envelope: AnyEnvelope,
    fencingToken: number,
  ): Promise<void>;
  release(
    identity: ConnectorSemanticIdentity,
    envelope: AnyEnvelope,
    fencingToken: number,
  ): Promise<void>;
};

export type ConnectorRuntimeStatePort = {
  readonly dedup: DedupStorePort;
  readonly jobs: JobRuntimePort;
  readonly deadLetters: DeadLetterStorePort;
  readonly ordering: OrderingStorePort;
  readonly lifecycle?: ConnectorRuntimeLifecyclePort;
};

export type ConnectorRuntimeLifecyclePort = {
  start(): Promise<void>;
  stop(options?: { readonly graceMs?: number }): Promise<void>;
};
