import { FrontendContractError } from './frontend-foundation.js';

/**
 * FE-P5-S2 History 쨌 Audit 쨌 Rollback ??exact V1 contracts (WP1).
 *
 * Frozen by FE-P5-S2 Contract Snapshot revision 1 (approved 2026-08-08) and
 * ADR-131 (accepted 2026-08-08).
 *
 * Authority vs Projection boundary:
 * - Existing Domain History remains authoritative (Canonical, Review,
 *   External Action, Policy). The History Workspace is a federated read
 *   projection; it never becomes a second authoritative ledger.
 * - `historyEntryId` is projection identity only; it never replaces the source
 *   Domain event identity (`sourceEventId`).
 * - Ordering/cursor uses the frozen tuple
 *   `occurred_at + domainKind + sourceEventKind + sourceEventId + sourceSequence`.
 * - Event identity is never deleted or overwritten. `PURGED_BY_POLICY` means
 *   payload redaction/tombstone, never identity deletion.
 * - Historical approval is evidence/reference only; historical approval
 *   authority reuse is FORBIDDEN. Reversal requires current server-derived
 *   capability + current Review + current Approval.
 *
 * Decoders are strict: unknown fields, empty/whitespace-only IDs and unknown
 * discriminants are rejected.
 */

export type FrontendHistorySchemaVersion = '1.0.0';

export const FRONTEND_HISTORY_API_VERSION = '1.0.0' as const;

/** Federated History projection source domains. */
export type HistorySourceDomainKindV1 = 'CANONICAL' | 'REVIEW' | 'EXTERNAL_ACTION' | 'POLICY';

/** Payload availability is a separate state from Event identity. */
export type PayloadAvailabilityV1 = 'AVAILABLE' | 'REDACTED' | 'PURGED_BY_POLICY' | 'UNAVAILABLE';

/**
 * One federated History entry. `historyEntryId` is projection identity only;
 * the frozen tuple (occurred_at, domainKind, sourceEventKind, sourceEventId,
 * sourceSequence) is the stable ordering/cursor key (ADR-131 짠2).
 */
export type HistoryEntryV1 = {
  readonly schemaVersion: '1.0.0';
  readonly historyEntryId: string;
  readonly resourceProjectId: string;
  readonly domainKind: HistorySourceDomainKindV1;
  readonly domainResourceKind: string;
  readonly domainResourceId: string;
  readonly sourceEventKind: string;
  readonly sourceEventId: string;
  readonly sourceSequence?: number;
  readonly occurredAt: string;
  readonly payloadAvailability: PayloadAvailabilityV1;
  readonly payloadSnapshot?: unknown;
  readonly projectedAt: string;
};

/**
 * Continuation cursor over the frozen ordering tuple. Never a global
 * chronology authority; ties resolved by the full frozen tuple.
 */
export type HistoryCursorV1 = {
  readonly schemaVersion: '1.0.0';
  readonly occurredAt: string;
  readonly domainKind: HistorySourceDomainKindV1;
  readonly sourceEventKind: string;
  readonly sourceEventId: string;
  readonly sourceSequence?: number;
};

export type ListHistoryWorkspaceRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly resourceProjectId: string;
  readonly cursor?: HistoryCursorV1;
  readonly limit: number;
  readonly domainKinds?: readonly HistorySourceDomainKindV1[];
};

export type ListHistoryWorkspaceResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly entries: readonly HistoryEntryV1[];
  readonly nextCursor?: HistoryCursorV1;
};

export type GetHistoryEntryRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly resourceProjectId: string;
  readonly historyEntryId: string;
};

export type GetHistoryEntryResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly entry: HistoryEntryV1;
};

/** Deleted Project tombstone (ADR-112 짠11 / ADR-131 짠6). */
export type ProjectTombstoneV1 = {
  readonly schemaVersion: '1.0.0';
  readonly projectId: string;
  readonly deletedAt: string;
  readonly deletedBy: string;
  readonly reason: string;
  readonly retentionClass: string;
  readonly lineageDigest: string;
};

/**
 * Separately authorized deleted-project audit scope. Past membership alone
 * never grants access; current Capability revalidation is always required.
 */
export type DeletedProjectAuditScopeV1 = {
  readonly schemaVersion: '1.0.0';
  readonly scopeId: string;
  readonly projectId: string;
  readonly grantedPrincipalIds: readonly string[];
  readonly grantedAt: string;
  readonly grantedBy: string;
  readonly revokedAt?: string;
};

/**
 * Reversal DraftChangeSet candidate (ADR-112 짠5/짠6, ADR-131 짠4).
 * Historical approval is evidence/reference only; current Review + current
 * Approval are required before a Reversal becomes a Canonical Commit.
 */
export type ReversalDraftChangeSetV1 = {
  readonly schemaVersion: '1.0.0';
  readonly reversalId: string;
  readonly resourceProjectId: string;
  readonly sourceRevisionId: string;
  readonly sourceCommitId: string;
  readonly historicalApprovalRef?: string;
  readonly status:
    'CANDIDATE' | 'IMPACT_ASSESSED' | 'REVIEW_REQUIRED' | 'APPROVED' | 'REJECTED' | 'STALE';
  readonly createdAt: string;
  readonly createdBy: string;
};

export type ReversalEligibilityV1 = {
  readonly schemaVersion: '1.0.0';
  readonly sourceRevisionId: string;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
};

export type CreateReversalDraftChangeSetRequestV1 = {
  readonly schemaVersion: '1.0.0';
  readonly resourceProjectId: string;
  readonly sourceRevisionId: string;
  readonly reason: string;
};

export type CreateReversalDraftChangeSetResultV1 = {
  readonly schemaVersion: '1.0.0';
  readonly reversal: ReversalDraftChangeSetV1;
  readonly eligibility: ReversalEligibilityV1;
};

// ---- strict field helpers --------------------------------------------------

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const requireString = (object: Record<string, unknown>, path: string, key: string): string => {
  const value = object[key];
  if (!isNonEmptyString(value)) {
    throw new FrontendContractError('INVALID_REQUEST', `${path}.${key} must be a non-empty string`);
  }
  return value;
};

const requireOptionalString = (
  object: Record<string, unknown>,
  path: string,
  key: string,
): string | undefined => {
  const value = object[key];
  if (value === undefined) return undefined;
  if (!isNonEmptyString(value)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path}.${key} must be a non-empty string when present`,
    );
  }
  return value;
};

const requireOptionalNumber = (
  object: Record<string, unknown>,
  path: string,
  key: string,
): number | undefined => {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path}.${key} must be a non-negative integer when present`,
    );
  }
  return value;
};

const requireOptionalUnknown = (
  object: Record<string, unknown>,
  path: string,
  key: string,
): unknown | undefined => {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path}.${key} must be an object when present`,
    );
  }
  return value;
};

// ---- decoders ---------------------------------------------------------------

const HISTORY_DOMAINS: readonly string[] = ['CANONICAL', 'REVIEW', 'EXTERNAL_ACTION', 'POLICY'];
const PAYLOAD_AVAILABILITIES: readonly string[] = [
  'AVAILABLE',
  'REDACTED',
  'PURGED_BY_POLICY',
  'UNAVAILABLE',
];

export const decodePayloadAvailabilityV1 = (
  value: unknown,
  path: string,
): PayloadAvailabilityV1 => {
  if (typeof value !== 'string' || !PAYLOAD_AVAILABILITIES.includes(value)) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be a PayloadAvailabilityV1`);
  }
  return value as PayloadAvailabilityV1;
};

export const decodeHistoryCursorV1 = (value: unknown, path: string): HistoryCursorV1 => {
  if (typeof value !== 'object' || value === null) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (object.schemaVersion !== '1.0.0') {
    throw new FrontendContractError('INVALID_REQUEST', `${path}.schemaVersion must be 1.0.0`);
  }
  const occurredAt = requireString(object, path, 'occurredAt');
  const domainKind = requireString(object, path, 'domainKind');
  if (!HISTORY_DOMAINS.includes(domainKind)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path}.domainKind must be a HistorySourceDomainKindV1`,
    );
  }
  const sourceEventKind = requireString(object, path, 'sourceEventKind');
  const sourceEventId = requireString(object, path, 'sourceEventId');
  const sourceSequence = requireOptionalNumber(object, path, 'sourceSequence');
  return {
    schemaVersion: '1.0.0',
    occurredAt,
    domainKind: domainKind as HistorySourceDomainKindV1,
    sourceEventKind,
    sourceEventId,
    sourceSequence,
  };
};

export const decodeHistoryEntryV1 = (value: unknown, path: string): HistoryEntryV1 => {
  if (typeof value !== 'object' || value === null) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (object.schemaVersion !== '1.0.0') {
    throw new FrontendContractError('INVALID_REQUEST', `${path}.schemaVersion must be 1.0.0`);
  }
  const historyEntryId = requireString(object, path, 'historyEntryId');
  const resourceProjectId = requireString(object, path, 'resourceProjectId');
  const domainKind = requireString(object, path, 'domainKind');
  if (!HISTORY_DOMAINS.includes(domainKind)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path}.domainKind must be a HistorySourceDomainKindV1`,
    );
  }
  const domainResourceKind = requireString(object, path, 'domainResourceKind');
  const domainResourceId = requireString(object, path, 'domainResourceId');
  const sourceEventKind = requireString(object, path, 'sourceEventKind');
  const sourceEventId = requireString(object, path, 'sourceEventId');
  const sourceSequence = requireOptionalNumber(object, path, 'sourceSequence');
  const occurredAt = requireString(object, path, 'occurredAt');
  const payloadAvailability = decodePayloadAvailabilityV1(
    object.payloadAvailability,
    `${path}.payloadAvailability`,
  );
  const payloadSnapshot = requireOptionalUnknown(object, path, 'payloadSnapshot');
  const projectedAt = requireString(object, path, 'projectedAt');
  return {
    schemaVersion: '1.0.0',
    historyEntryId,
    resourceProjectId,
    domainKind: domainKind as HistorySourceDomainKindV1,
    domainResourceKind,
    domainResourceId,
    sourceEventKind,
    sourceEventId,
    sourceSequence,
    occurredAt,
    payloadAvailability,
    payloadSnapshot,
    projectedAt,
  };
};

export const decodeProjectTombstoneV1 = (value: unknown, path: string): ProjectTombstoneV1 => {
  if (typeof value !== 'object' || value === null) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (object.schemaVersion !== '1.0.0') {
    throw new FrontendContractError('INVALID_REQUEST', `${path}.schemaVersion must be 1.0.0`);
  }
  return {
    schemaVersion: '1.0.0',
    projectId: requireString(object, path, 'projectId'),
    deletedAt: requireString(object, path, 'deletedAt'),
    deletedBy: requireString(object, path, 'deletedBy'),
    reason: requireString(object, path, 'reason'),
    retentionClass: requireString(object, path, 'retentionClass'),
    lineageDigest: requireString(object, path, 'lineageDigest'),
  };
};

export const decodeDeletedProjectAuditScopeV1 = (
  value: unknown,
  path: string,
): DeletedProjectAuditScopeV1 => {
  if (typeof value !== 'object' || value === null) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (object.schemaVersion !== '1.0.0') {
    throw new FrontendContractError('INVALID_REQUEST', `${path}.schemaVersion must be 1.0.0`);
  }
  const grantedPrincipalIds = object.grantedPrincipalIds;
  if (
    !Array.isArray(grantedPrincipalIds) ||
    grantedPrincipalIds.length === 0 ||
    grantedPrincipalIds.some((id) => !isNonEmptyString(id))
  ) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path}.grantedPrincipalIds must be a non-empty array of non-empty strings`,
    );
  }
  return {
    schemaVersion: '1.0.0',
    scopeId: requireString(object, path, 'scopeId'),
    projectId: requireString(object, path, 'projectId'),
    grantedPrincipalIds: grantedPrincipalIds as readonly string[],
    grantedAt: requireString(object, path, 'grantedAt'),
    grantedBy: requireString(object, path, 'grantedBy'),
    revokedAt: requireOptionalString(object, path, 'revokedAt'),
  };
};

const REVERSAL_STATUSES: readonly string[] = [
  'CANDIDATE',
  'IMPACT_ASSESSED',
  'REVIEW_REQUIRED',
  'APPROVED',
  'REJECTED',
  'STALE',
];

export const decodeReversalDraftChangeSetV1 = (
  value: unknown,
  path: string,
): ReversalDraftChangeSetV1 => {
  if (typeof value !== 'object' || value === null) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (object.schemaVersion !== '1.0.0') {
    throw new FrontendContractError('INVALID_REQUEST', `${path}.schemaVersion must be 1.0.0`);
  }
  const status = requireString(object, path, 'status');
  if (!REVERSAL_STATUSES.includes(status)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path}.status must be a valid Reversal status`,
    );
  }
  return {
    schemaVersion: '1.0.0',
    reversalId: requireString(object, path, 'reversalId'),
    resourceProjectId: requireString(object, path, 'resourceProjectId'),
    sourceRevisionId: requireString(object, path, 'sourceRevisionId'),
    sourceCommitId: requireString(object, path, 'sourceCommitId'),
    historicalApprovalRef: requireOptionalString(object, path, 'historicalApprovalRef'),
    status: status as ReversalDraftChangeSetV1['status'],
    createdAt: requireString(object, path, 'createdAt'),
    createdBy: requireString(object, path, 'createdBy'),
  };
};

export const decodeReversalEligibilityV1 = (
  value: unknown,
  path: string,
): ReversalEligibilityV1 => {
  if (typeof value !== 'object' || value === null) {
    throw new FrontendContractError('INVALID_REQUEST', `${path} must be an object`);
  }
  const object = value as Record<string, unknown>;
  if (object.schemaVersion !== '1.0.0') {
    throw new FrontendContractError('INVALID_REQUEST', `${path}.schemaVersion must be 1.0.0`);
  }
  if (typeof object.eligible !== 'boolean') {
    throw new FrontendContractError('INVALID_REQUEST', `${path}.eligible must be a boolean`);
  }
  const reasons = object.reasons;
  if (!Array.isArray(reasons) || reasons.some((r) => !isNonEmptyString(r))) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${path}.reasons must be a non-empty string array`,
    );
  }
  return {
    schemaVersion: '1.0.0',
    sourceRevisionId: requireString(object, path, 'sourceRevisionId'),
    eligible: object.eligible,
    reasons: reasons as readonly string[],
  };
};
