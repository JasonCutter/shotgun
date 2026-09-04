import type {
  AskAnswerRunEventView,
  AskAnswerRunState,
  AskCapability,
  DiscoveryAttemptV1,
  DiscoveryJobV1,
  DiscoveryRunV1,
  DiscoveryRuntimeLifecycleStateV1,
  DiscoveryRuntimeStageStateV1,
  DiscoveryStageV1,
  IntakeSubmissionSnapshot,
  IntakeSubmissionState,
} from '../../../packages/contracts/src/index.js';

/**
 * FE-P5-S1 WP3 — owning-Domain read ports for the concrete Activity adapters.
 *
 * These are server-side SPI surfaces that the owning Domains expose so the
 * Activity adapters can observe real Domain state (intake submissions and
 * attempts, answer runs and their events, external action aggregates,
 * executions, attempts and audit events) without acquiring any execution
 * authority. The browser never authors anything on these ports.
 *
 * Sources and Ask do not expose a project-scoped list today, so the owning
 * domain provides it here; External Action already exposes everything through
 * `ExternalActionRepositoryBoundaryPort`.
 */

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** One intake submission queue row (Job root for the Activity projection). */
export type SourcesActivitySubmissionRow = {
  readonly submissionId: string;
  readonly projectId: string;
  readonly principalId: string;
  readonly state: IntakeSubmissionState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly itemCount: number;
  readonly attentionReason?: string;
};

/** One intake attempt (event evidence for an intake item). */
export type SourcesActivityAttemptRow = {
  readonly intakeAttemptId: string;
  readonly projectId: string;
  readonly submissionId: string;
  readonly submissionItemId: string;
  readonly attemptNumber: number;
  readonly attemptKind: string;
  readonly state: string;
  readonly correlationId: string;
  readonly causationAttemptId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
};

export type SourcesActivityCursorV1 = {
  readonly updatedAt: string;
  readonly submissionId: string;
};

export const encodeSourcesActivityCursor = (cursor: SourcesActivityCursorV1): string =>
  Buffer.from(
    JSON.stringify({ updatedAt: cursor.updatedAt, submissionId: cursor.submissionId }),
    'utf8',
  ).toString('base64url');

export const decodeSourcesActivityCursor = (value: string): SourcesActivityCursorV1 => {
  const parsed = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  ) as Partial<SourcesActivityCursorV1>;
  if (typeof parsed.updatedAt !== 'string' || typeof parsed.submissionId !== 'string') {
    throw new Error('SOURCES_ACTIVITY_INVALID_CURSOR: malformed cursor');
  }
  return { updatedAt: parsed.updatedAt, submissionId: parsed.submissionId };
};

export type SourcesActivityAttemptCursorV1 = {
  /** Position in the flattened submission attempt list (0-based). */
  readonly offset: number;
};

export const encodeSourcesActivityAttemptCursor = (
  cursor: SourcesActivityAttemptCursorV1,
): string => Buffer.from(JSON.stringify({ offset: cursor.offset }), 'utf8').toString('base64url');

export const decodeSourcesActivityAttemptCursor = (
  value: string,
): SourcesActivityAttemptCursorV1 => {
  const parsed = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  ) as Partial<SourcesActivityAttemptCursorV1>;
  if (
    typeof parsed.offset !== 'number' ||
    !Number.isSafeInteger(parsed.offset) ||
    parsed.offset < 0
  ) {
    throw new Error('SOURCES_ACTIVITY_INVALID_CURSOR: attempt cursor malformed');
  }
  return { offset: parsed.offset };
};

/**
 * Read surface the Sources domain exposes to the Activity adapter.
 */
export type SourcesActivityReadPort = {
  /** Project-scoped submission queue, stable updatedAt DESC ordering. */
  listSubmissions(input: {
    readonly projectId: string;
    readonly principalId?: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{
    readonly rows: readonly SourcesActivitySubmissionRow[];
    readonly nextCursor?: string;
  }>;
  /** Current authoritative submission snapshot by concrete Domain identity. */
  getSubmission(input: {
    readonly projectId: string;
    readonly submissionId: string;
    readonly principalId?: string;
    /** Server-derived binding for owning-Domain access revalidation. */
    readonly accessScope?: readonly string[];
    readonly sensitivity?: string;
    readonly accessRevision?: string;
    readonly policyContextRevision?: string;
  }): Promise<IntakeSubmissionSnapshot | undefined>;
  /** Append-ordered intake attempts for one submission item (bounded). */
  listItemAttempts(input: {
    readonly projectId: string;
    readonly submissionId: string;
    readonly submissionItemId: string;
    readonly limit: number;
  }): Promise<readonly SourcesActivityAttemptRow[]>;
  /**
   * Submission-scoped FLATTENED attempt evidence across every item, ordered by
   * (item ordinal, attempt number) with a keyset cursor. This is the bounded
   * Event continuation source: an adapter pages `limit + 1` rows at a time and
   * never depends on a per-item or total cap.
   */
  listSubmissionAttempts(input: {
    readonly projectId: string;
    readonly submissionId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{
    readonly attempts: readonly SourcesActivityAttemptRow[];
    readonly nextCursor?: string;
  }>;
};

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

export type AskActivityCursorV1 = {
  readonly updatedAt: string;
  readonly answerRunId: string;
};

export const encodeAskActivityCursor = (cursor: AskActivityCursorV1): string =>
  Buffer.from(
    JSON.stringify({ updatedAt: cursor.updatedAt, answerRunId: cursor.answerRunId }),
    'utf8',
  ).toString('base64url');

export const decodeAskActivityCursor = (value: string): AskActivityCursorV1 => {
  const parsed = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  ) as Partial<AskActivityCursorV1>;
  if (typeof parsed.updatedAt !== 'string' || typeof parsed.answerRunId !== 'string') {
    throw new Error('ASK_ACTIVITY_INVALID_CURSOR: malformed cursor');
  }
  return { updatedAt: parsed.updatedAt, answerRunId: parsed.answerRunId };
};

/** One answer-run queue row (RUN root for the Activity projection). */
export type AskActivityAnswerRunRow = {
  readonly answerRunId: string;
  readonly projectId: string;
  readonly state: AskAnswerRunState;
  readonly attentionReason?: string;
  readonly attemptId?: string;
  readonly attemptNumber?: number;
  readonly failure?: { code: string; message: string; retryable: boolean; outcomeUnknown: boolean };
  /** Owning-Domain server-derived capabilities (drives WP5 available actions). */
  readonly capabilities: readonly AskCapability[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** Read surface the Ask domain exposes to the Activity adapter. */
export type AskActivityReadPort = {
  /** Project-scoped answer-run queue, stable updatedAt DESC ordering. */
  listAnswerRuns(input: {
    readonly projectId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{
    readonly runs: readonly AskActivityAnswerRunRow[];
    readonly nextCursor?: string;
  }>;
  /** Current authoritative answer-run row by concrete Domain identity. */
  getAnswerRun(input: {
    readonly projectId: string;
    readonly answerRunId: string;
    /** Server-derived binding for owning-Domain access revalidation. */
    readonly sensitivityClearance?: string;
    readonly accessRevision?: string;
    readonly policyContextRevision?: string;
  }): Promise<AskActivityAnswerRunRow | undefined>;
  /** Ordinal-ordered bounded answer-run events. */
  listAnswerRunEvents(input: {
    readonly projectId: string;
    readonly answerRunId: string;
    readonly afterOrdinal?: number;
    readonly limit: number;
  }): Promise<readonly AskAnswerRunEventView[]>;
};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Safe attempt failure context persisted by the Discovery runtime (WP4). */
export type DiscoveryActivityFailureContextV1 = {
  readonly schemaVersion: '1.0.0';
  readonly code: string;
  readonly classification: 'RETRYABLE' | 'TERMINAL';
  readonly retryable: boolean;
  readonly safeMessage: string;
  readonly failedStage: string;
  readonly occurredAt: string;
  readonly retryNotBefore?: string;
};

export type DiscoveryActivityAttemptRow = DiscoveryAttemptV1 & {
  readonly failure?: DiscoveryActivityFailureContextV1;
};

export type DiscoveryActivityJobRow = {
  readonly job: DiscoveryJobV1;
  /** Latest durable Run, when the worker has claimed the Job. */
  readonly run?: DiscoveryRunV1;
};

/** Safe, bounded Finding summary used only as an Activity backlink. */
export type DiscoveryActivityFindingRow = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
  readonly runId: string;
  readonly findingType: string;
  readonly lifecycleState: string;
  readonly title: string;
  readonly reviewEligible: boolean;
  readonly resourceHref: string;
};

/** Existing Finding/Review authorities may provide this narrow read surface. */
export type DiscoveryActivityFindingReadPort = {
  listActivityFindings(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
    readonly accessScope?: readonly string[];
    readonly sensitivityClearance?: string;
    readonly limit: number;
  }): Promise<readonly DiscoveryActivityFindingRow[]>;
  /**
   * Authoritative existence check for Attention. This is deliberately
   * separate from the bounded backlink list so presentation pagination
   * cannot suppress a review-eligible Finding beyond the display cap.
   */
  hasReviewEligibleActivityFinding?(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
    readonly accessScope?: readonly string[];
    readonly sensitivityClearance?: string;
  }): Promise<boolean>;
};

/** Safe, bounded aggregate for Discovery semantic-essence exclusions. */
export type DiscoveryActivityDiagnosticAggregateV1 = {
  readonly diagnosticCount: number;
  readonly excludedCount: number;
  readonly candidateCount?: number;
  readonly completion: 'PARTIAL';
  readonly updatedAt: string;
};

/** One durable lifecycle transition; payloads and Finding bodies are excluded. */
export type DiscoveryActivityLifecycleEventV1 = {
  readonly resourceKind: 'DiscoveryJob' | 'DiscoveryRun' | 'DiscoveryAttempt' | 'DiscoveryStage';
  readonly resourceId: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly runId?: string;
  readonly attemptId?: string;
  readonly revision: number;
  readonly fromState?: DiscoveryRuntimeLifecycleStateV1 | DiscoveryRuntimeStageStateV1;
  readonly toState: DiscoveryRuntimeLifecycleStateV1 | DiscoveryRuntimeStageStateV1;
  readonly occurredAt: string;
};

export type DiscoveryActivityHistoryV1 = {
  readonly job: readonly DiscoveryActivityLifecycleEventV1[];
  readonly run: readonly DiscoveryActivityLifecycleEventV1[];
  readonly attempt: readonly DiscoveryActivityLifecycleEventV1[];
  readonly stage: readonly DiscoveryActivityLifecycleEventV1[];
};

export type DiscoveryActivityCursorV1 = {
  readonly updatedAt: string;
  readonly jobId: string;
};

export const encodeDiscoveryActivityCursor = (cursor: DiscoveryActivityCursorV1): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

export const decodeDiscoveryActivityCursor = (value: string): DiscoveryActivityCursorV1 => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error('DISCOVERY_ACTIVITY_INVALID_CURSOR: malformed cursor');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { updatedAt?: unknown }).updatedAt !== 'string' ||
    typeof (parsed as { jobId?: unknown }).jobId !== 'string' ||
    (parsed as { updatedAt: string }).updatedAt.trim().length === 0 ||
    (parsed as { jobId: string }).jobId.trim().length === 0
  ) {
    throw new Error('DISCOVERY_ACTIVITY_INVALID_CURSOR: malformed cursor');
  }
  return {
    updatedAt: (parsed as { updatedAt: string }).updatedAt,
    jobId: (parsed as { jobId: string }).jobId,
  };
};

/** Server-only read surface over durable Discovery runtime authority. */
export type DiscoveryActivityReadPort = {
  listJobs(input: {
    readonly projectId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{ readonly jobs: readonly DiscoveryActivityJobRow[]; readonly nextCursor?: string }>;
  getJob(input: {
    readonly projectId: string;
    readonly jobId: string;
  }): Promise<DiscoveryJobV1 | undefined>;
  getRun(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
  }): Promise<DiscoveryRunV1 | undefined>;
  getLatestRun(input: {
    readonly projectId: string;
    readonly jobId: string;
  }): Promise<DiscoveryRunV1 | undefined>;
  listActivityAttempts(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
  }): Promise<readonly DiscoveryActivityAttemptRow[]>;
  listActivityStages(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
    readonly attemptId: string;
  }): Promise<readonly DiscoveryStageV1[]>;
  listHistory(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
    readonly attemptIds: readonly string[];
    readonly stageIds: readonly string[];
  }): Promise<DiscoveryActivityHistoryV1>;
  /** Optional read-only aggregate; never returns a diagnostic body. */
  getSemanticEssenceDiagnosticAggregate?(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
  }): Promise<DiscoveryActivityDiagnosticAggregateV1 | undefined>;
};
