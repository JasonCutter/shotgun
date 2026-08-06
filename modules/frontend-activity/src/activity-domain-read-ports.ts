import type {
  AskAnswerRunEventView,
  AskAnswerRunState,
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
