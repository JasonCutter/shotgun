import type { ErrorCode } from './errors.js';
import { FrontendContractError } from './frontend-foundation.js';
import { sha256Text, stableJson } from './document-evidence.js';

/**
 * FE-P4-S1 Review Center — exact V1 contracts.
 *
 * Frozen by FE-P4-S1 Contract Snapshot revision 1 (approved 2026-08-04) and
 * ADR-128 (accepted 2026-08-04). Every type carries schemaVersion '1.0.0',
 * decoders reject unknown fields, empty/whitespace-only IDs, unknown
 * discriminants, and never use `any`.
 *
 * Review is server-authoritative. The Browser never submits Actor, Project,
 * Capability, policy, access or Approval purpose. Decision, comment and
 * revalidation commands flow through the existing Frontend Command Ledger.
 */

export type ReviewSchemaVersion = '1.0.0';

export const FRONTEND_REVIEW_API_VERSION = '1.0.0' as const;

export const FRONTEND_REVIEW_COMMAND_TYPES = {
  revalidateContext: 'frontend.review.revalidate.v1',
  recordDecisions: 'frontend.review.record-decisions.v1',
  addComment: 'frontend.review.add-comment.v1',
} as const;

export type FrontendReviewCommandType =
  (typeof FRONTEND_REVIEW_COMMAND_TYPES)[keyof typeof FRONTEND_REVIEW_COMMAND_TYPES];

/** Domain version tag shared by server and browser digest computation. */
export const FRONTEND_REVIEW_DOMAIN_VERSION = '1.0.0' as const;

// ---------------------------------------------------------------------------
// V1 enums (exact, exhaustive)
// ---------------------------------------------------------------------------

export type ReviewTargetKindV1 =
  'KNOWLEDGE_DRAFT_CHANGE_SET' | 'DISCOVERY_CANDIDATE' | 'USER_DIRECTIVE_PROPOSAL';

export type ReviewSourceItemKindV1 =
  'KNOWLEDGE_OPERATION' | 'DISCOVERY_CANDIDATE' | 'USER_DIRECTIVE_CLAUSE';

export type ReviewDependencyKindV1 = 'REQUIRES' | 'ATOMIC_WITH' | 'CONFLICTS_WITH';

export type ReviewDecisionIntentV1 = 'APPROVE' | 'REJECT' | 'REQUEST_REVISION' | 'HOLD';

export type ReviewItemDecisionStateV1 =
  'PENDING' | 'APPROVED' | 'REJECTED' | 'REVISION_REQUESTED' | 'ON_HOLD';

export type ReviewAggregateStateV1 =
  | 'PENDING'
  | 'PARTIALLY_DECIDED'
  | 'ON_HOLD'
  | 'REVISION_REQUESTED'
  | 'REJECTED'
  | 'APPROVED_READY'
  | 'ACCEPTED_FOR_AUTHORING'
  | 'STALE'
  | 'ACCESS_RESTRICTED'
  | 'UNAVAILABLE';

export type ApprovalPurposeV1 = 'KNOWLEDGE_CANONICAL_CHANGE' | 'USER_DIRECTIVE_CHANGE';

export type ApprovalStatusV1 = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'CONSUMED' | 'INVALIDATED';

export type ReviewArtifactKindV1 = 'VALIDATION' | 'EVIDENCE' | 'CONFLICT' | 'IMPACT';

export type ReviewAccessMaskingStateV1 = 'VISIBLE' | 'MASKED' | 'HIDDEN';

export type ReviewSensitivityV1 = 'NORMAL' | 'SENSITIVE' | 'RESTRICTED';

export type ReviewCapabilityV1 =
  | 'LIST_QUEUE'
  | 'READ_CONTEXT'
  | 'READ_ITEM'
  | 'READ_APPROVAL'
  | 'REVALIDATE'
  | 'RECORD_DECISIONS'
  | 'ADD_COMMENT'
  | 'RESOLVE_OUTCOME';

export type ReviewAttentionReasonV1 =
  'REQUIRES_ACTION' | 'STALE' | 'OUTCOME_UNKNOWN' | 'ACCESS_RESTRICTED' | 'DEPENDENCY_BLOCKED';

export type ReviewTotalCountStatusV1 = 'EXACT' | 'LOWER_BOUND' | 'UNAVAILABLE';

export type ReviewFailureReasonV1 =
  | 'REVIEW_CONTEXT_NOT_FOUND'
  | 'REVIEW_CONTEXT_STALE'
  | 'REVIEW_TARGET_CHANGED'
  | 'REVIEW_ITEM_NOT_FOUND'
  | 'REVIEW_DECISION_NOT_ALLOWED'
  | 'REVIEW_DEPENDENCY_UNSATISFIED'
  | 'REVIEW_ATOMIC_GROUP_SPLIT'
  | 'REVIEW_CONFLICTING_APPROVAL_SET'
  | 'REVIEW_DANGLING_REFERENCE'
  | 'REVIEW_EVIDENCE_CHANGED'
  | 'REVIEW_POLICY_CHANGED'
  | 'REVIEW_ACCESS_CHANGED'
  | 'REVIEW_APPROVAL_NOT_ISSUED'
  | 'REVIEW_APPROVAL_EXPIRED'
  | 'REVIEW_REVISION_ROUTE_UNAVAILABLE'
  | 'EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2';

export const REVIEW_TARGET_KINDS: readonly ReviewTargetKindV1[] = [
  'KNOWLEDGE_DRAFT_CHANGE_SET',
  'DISCOVERY_CANDIDATE',
  'USER_DIRECTIVE_PROPOSAL',
];

export const REVIEW_SOURCE_ITEM_KINDS: readonly ReviewSourceItemKindV1[] = [
  'KNOWLEDGE_OPERATION',
  'DISCOVERY_CANDIDATE',
  'USER_DIRECTIVE_CLAUSE',
];

export const REVIEW_DEPENDENCY_KINDS: readonly ReviewDependencyKindV1[] = [
  'REQUIRES',
  'ATOMIC_WITH',
  'CONFLICTS_WITH',
];

export const REVIEW_DECISION_INTENTS: readonly ReviewDecisionIntentV1[] = [
  'APPROVE',
  'REJECT',
  'REQUEST_REVISION',
  'HOLD',
];

export const REVIEW_ITEM_DECISION_STATES: readonly ReviewItemDecisionStateV1[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'REVISION_REQUESTED',
  'ON_HOLD',
];

export const REVIEW_AGGREGATE_STATES: readonly ReviewAggregateStateV1[] = [
  'PENDING',
  'PARTIALLY_DECIDED',
  'ON_HOLD',
  'REVISION_REQUESTED',
  'REJECTED',
  'APPROVED_READY',
  'ACCEPTED_FOR_AUTHORING',
  'STALE',
  'ACCESS_RESTRICTED',
  'UNAVAILABLE',
];

export const APPROVAL_PURPOSES: readonly ApprovalPurposeV1[] = [
  'KNOWLEDGE_CANONICAL_CHANGE',
  'USER_DIRECTIVE_CHANGE',
];

export const APPROVAL_STATUSES: readonly ApprovalStatusV1[] = [
  'ACTIVE',
  'EXPIRED',
  'REVOKED',
  'CONSUMED',
  'INVALIDATED',
];

export const REVIEW_ARTIFACT_KINDS: readonly ReviewArtifactKindV1[] = [
  'VALIDATION',
  'EVIDENCE',
  'CONFLICT',
  'IMPACT',
];

export const REVIEW_ACCESS_MASKING_STATES: readonly ReviewAccessMaskingStateV1[] = [
  'VISIBLE',
  'MASKED',
  'HIDDEN',
];

export const REVIEW_SENSITIVITIES: readonly ReviewSensitivityV1[] = [
  'NORMAL',
  'SENSITIVE',
  'RESTRICTED',
];

export const REVIEW_CAPABILITIES: readonly ReviewCapabilityV1[] = [
  'LIST_QUEUE',
  'READ_CONTEXT',
  'READ_ITEM',
  'READ_APPROVAL',
  'REVALIDATE',
  'RECORD_DECISIONS',
  'ADD_COMMENT',
  'RESOLVE_OUTCOME',
];

export const REVIEW_ATTENTION_REASONS: readonly ReviewAttentionReasonV1[] = [
  'REQUIRES_ACTION',
  'STALE',
  'OUTCOME_UNKNOWN',
  'ACCESS_RESTRICTED',
  'DEPENDENCY_BLOCKED',
];

export const REVIEW_TOTAL_COUNT_STATUSES: readonly ReviewTotalCountStatusV1[] = [
  'EXACT',
  'LOWER_BOUND',
  'UNAVAILABLE',
];

export const REVIEW_FAILURE_REASONS: readonly ReviewFailureReasonV1[] = [
  'REVIEW_CONTEXT_NOT_FOUND',
  'REVIEW_CONTEXT_STALE',
  'REVIEW_TARGET_CHANGED',
  'REVIEW_ITEM_NOT_FOUND',
  'REVIEW_DECISION_NOT_ALLOWED',
  'REVIEW_DEPENDENCY_UNSATISFIED',
  'REVIEW_ATOMIC_GROUP_SPLIT',
  'REVIEW_CONFLICTING_APPROVAL_SET',
  'REVIEW_DANGLING_REFERENCE',
  'REVIEW_EVIDENCE_CHANGED',
  'REVIEW_POLICY_CHANGED',
  'REVIEW_ACCESS_CHANGED',
  'REVIEW_APPROVAL_NOT_ISSUED',
  'REVIEW_APPROVAL_EXPIRED',
  'REVIEW_REVISION_ROUTE_UNAVAILABLE',
  'EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2',
];

export const isReviewTargetKindV1 = (value: unknown): value is ReviewTargetKindV1 =>
  typeof value === 'string' && REVIEW_TARGET_KINDS.includes(value as ReviewTargetKindV1);

export const isReviewFailureReasonV1 = (value: unknown): value is ReviewFailureReasonV1 =>
  typeof value === 'string' && REVIEW_FAILURE_REASONS.includes(value as ReviewFailureReasonV1);

// ---------------------------------------------------------------------------
// References and artifact refs
// ---------------------------------------------------------------------------

export type ReviewTargetRefV1 = {
  schemaVersion: '1.0.0';
  targetKind: ReviewTargetKindV1;
  targetId: string;
  targetRevision: string;
};

export type ReviewCanonicalBaseRefV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  revision: string;
  digest: string;
};

export type ReviewArtifactRefV1 = {
  schemaVersion: '1.0.0';
  artifactKind: ReviewArtifactKindV1;
  artifactId: string;
  artifactRevision: string;
  digest: string;
};

export type ReviewArtifactRefsV1 = {
  schemaVersion: '1.0.0';
  validation?: ReviewArtifactRefV1;
  evidence?: ReviewArtifactRefV1;
  conflict?: ReviewArtifactRefV1;
  impact?: ReviewArtifactRefV1;
};

export type ReviewActorRefV1 = {
  schemaVersion: '1.0.0';
  principalId: string;
  actorId: string;
};

// ---------------------------------------------------------------------------
// Content representation (safe, screen-reader equivalent)
// ---------------------------------------------------------------------------

export type ReviewContentRepresentationV1 = {
  schemaVersion: '1.0.0';
  representationKind: 'OPAQUE_TEXT';
  summary: string;
  detailText: string;
};

// ---------------------------------------------------------------------------
// Review Items
// ---------------------------------------------------------------------------

export type ReviewItemV1 = {
  schemaVersion: '1.0.0';
  reviewItemId: string;
  sourceItemKind: ReviewSourceItemKindV1;
  sourceItemId: string;
  sourceItemRevision: string;
  sourceItemDigest: string;
  targetRef: ReviewTargetRefV1;
  label: string;
  before?: ReviewContentRepresentationV1;
  after?: ReviewContentRepresentationV1;
  rationale: string;
  expectedImpact?: string;
  artifactRefs: ReviewArtifactRefsV1;
  allowedDecisions: readonly ReviewDecisionIntentV1[];
  decisionState: ReviewItemDecisionStateV1;
  sensitivity: ReviewSensitivityV1;
  maskedFields: readonly string[];
  accessMasking: ReviewAccessMaskingStateV1;
};

// ---------------------------------------------------------------------------
// Dependencies (server-owned)
// ---------------------------------------------------------------------------

export type ReviewDependencyV1 = {
  schemaVersion: '1.0.0';
  dependencyId: string;
  fromReviewItemId: string;
  toReviewItemId: string;
  kind: ReviewDependencyKindV1;
  reasonCode: string;
  description: string;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
};

// ---------------------------------------------------------------------------
// Decisions and comments (append-only)
// ---------------------------------------------------------------------------

export type ReviewDecisionRecordV1 = {
  schemaVersion: '1.0.0';
  decisionId: string;
  reviewContextId: string;
  contextRevision: number;
  reviewItemId: string;
  intent: ReviewDecisionIntentV1;
  reason?: string;
  decidedBy: ReviewActorRefV1;
  decidedAt: string;
  terminal: boolean;
};

export type ReviewCommentRecordV1 = {
  schemaVersion: '1.0.0';
  commentId: string;
  reviewContextId: string;
  contextRevision: number;
  reviewItemId?: string;
  text: string;
  authoredBy: ReviewActorRefV1;
  authoredAt: string;
};

// ---------------------------------------------------------------------------
// Approval Resource
// ---------------------------------------------------------------------------

export type ReviewApprovalV1 = {
  schemaVersion: '1.0.0';
  approvalId: string;
  purpose: ApprovalPurposeV1;
  reviewContextId: string;
  contextRevision: number;
  targetKind: ReviewTargetKindV1;
  targetId: string;
  targetRevision: string;
  targetDigest: string;
  approvedItemIds: readonly string[];
  approvedManifestDigest: string;
  actor: ReviewActorRefV1;
  projectId: string;
  accessRevision: string;
  policyContextRevision: string;
  reason: string;
  issuedAt: string;
  expiresAt: string;
  status: ApprovalStatusV1;
  invalidationReason?: string;
};

// ---------------------------------------------------------------------------
// Review Context revision
// ---------------------------------------------------------------------------

export type ReviewContextRevisionV1 = {
  schemaVersion: '1.0.0';
  reviewContextId: string;
  contextRevision: number;
  reviewResourceId: string;
  targetKind: ReviewTargetKindV1;
  targetId: string;
  targetRevision: string;
  targetDigest: string;
  resourceProjectId: string;
  effectiveProjectId: string;
  accessRevision: string;
  policyContextRevision: string;
  canonicalBase?: ReviewCanonicalBaseRefV1;
  artifactRefs: ReviewArtifactRefsV1;
  items: readonly ReviewItemV1[];
  dependencies: readonly ReviewDependencyV1[];
  aggregateState: ReviewAggregateStateV1;
  capabilities: readonly ReviewCapabilityV1[];
  generatedAt: string;
  staleReason?: string;
};

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export type ReviewQueueAcceptedContextV1 = {
  schemaVersion: '1.0.0';
  resourceProjectId: string;
  accessRevision: string;
  policyContextRevision: string;
};

export type ReviewQueueItemV1 = {
  schemaVersion: '1.0.0';
  reviewContextId: string;
  contextRevision: number;
  targetKind: ReviewTargetKindV1;
  targetId: string;
  targetLabel: string;
  aggregateState: ReviewAggregateStateV1;
  itemCount: number;
  updatedAt: string;
  attentionReasons: readonly ReviewAttentionReasonV1[];
  capabilities: readonly ReviewCapabilityV1[];
};

// ---------------------------------------------------------------------------
// Evidence and impact entries (lazy detail)
// ---------------------------------------------------------------------------

export type ReviewEvidenceEntryV1 = {
  schemaVersion: '1.0.0';
  sourceId: string;
  sourceVersionId: string;
  evidenceSpanId: string;
  snippet: string;
};

export type ReviewImpactEntryV1 = {
  schemaVersion: '1.0.0';
  impactId: string;
  targetKind: string;
  targetId: string;
  description: string;
};

// ---------------------------------------------------------------------------
// Revision-request return target
// ---------------------------------------------------------------------------

export type ReviewRevisionReturnTargetV1 = {
  schemaVersion: '1.0.0';
  workspace: 'KNOWLEDGE_EDITOR' | 'DIRECTIVE_AUTHORING';
  resourceId: string;
  draftId?: string;
  draftRevision?: number;
  reason: string;
};

// ---------------------------------------------------------------------------
// Operations — requests and results
// ---------------------------------------------------------------------------

export type ListReviewQueueRequestV1 = {
  schemaVersion: '1.0.0';
  targetKinds?: readonly ReviewTargetKindV1[];
  aggregateStates?: readonly ReviewAggregateStateV1[];
  attentionReasons?: readonly ReviewAttentionReasonV1[];
  query?: string;
  pageSize: number;
  cursor?: string;
};

export type ListReviewQueueResultV1 = {
  schemaVersion: '1.0.0';
  acceptedContext: ReviewQueueAcceptedContextV1;
  queueSnapshotRevision: string;
  items: readonly ReviewQueueItemV1[];
  nextCursor?: string;
  totalCountStatus: ReviewTotalCountStatusV1;
  capabilities: readonly ReviewCapabilityV1[];
};

export type GetReviewContextRequestV1 = {
  schemaVersion: '1.0.0';
  reviewContextId: string;
  contextRevision: number;
};

export type GetReviewContextResultV1 = {
  schemaVersion: '1.0.0';
  context: ReviewContextRevisionV1;
  decisions: readonly ReviewDecisionRecordV1[];
  comments: readonly ReviewCommentRecordV1[];
};

export type GetReviewItemDetailRequestV1 = {
  schemaVersion: '1.0.0';
  reviewContextId: string;
  contextRevision: number;
  reviewItemId: string;
  includeEvidence?: boolean;
  includeImpact?: boolean;
};

export type GetReviewItemDetailResultV1 = {
  schemaVersion: '1.0.0';
  item: ReviewItemV1;
  dependencies: readonly ReviewDependencyV1[];
  evidence?: readonly ReviewEvidenceEntryV1[];
  impact?: readonly ReviewImpactEntryV1[];
  decisions: readonly ReviewDecisionRecordV1[];
};

export type RevalidateReviewContextRequestV1 = {
  schemaVersion: '1.0.0';
  clientRequestId: string;
  idempotencyKey: string;
  reviewContextId: string;
  contextRevision: number;
  reason?: string;
};

export type RevalidateReviewContextResultV1 = {
  schemaVersion: '1.0.0';
  outcome: 'COMPLETED';
  clientRequestId: string;
  idempotencyKey: string;
  commandSemanticDigest: string;
  context: ReviewContextRevisionV1;
};

export type ReviewItemDecisionInputV1 = {
  schemaVersion: '1.0.0';
  reviewItemId: string;
  intent: ReviewDecisionIntentV1;
  reason?: string;
};

export type RecordReviewDecisionsRequestV1 = {
  schemaVersion: '1.0.0';
  clientRequestId: string;
  idempotencyKey: string;
  reviewContextId: string;
  expectedContextRevision: number;
  expectedTargetRevision: string;
  expectedTargetDigest: string;
  itemDecisions: readonly ReviewItemDecisionInputV1[];
  comment?: string;
};

export type RecordReviewDecisionsResultV1 = {
  schemaVersion: '1.0.0';
  outcome: 'COMPLETED';
  clientRequestId: string;
  idempotencyKey: string;
  commandSemanticDigest: string;
  reviewContextId: string;
  contextRevision: number;
  decisions: readonly ReviewDecisionRecordV1[];
  aggregateState: ReviewAggregateStateV1;
  approvals?: readonly ReviewApprovalV1[];
  acceptedForAuthoring?: boolean;
  revisionRequestReturnTarget?: ReviewRevisionReturnTargetV1;
};

export type AddReviewCommentRequestV1 = {
  schemaVersion: '1.0.0';
  clientRequestId: string;
  idempotencyKey: string;
  reviewContextId: string;
  contextRevision: number;
  reviewItemId?: string;
  comment: string;
};

export type AddReviewCommentResultV1 = {
  schemaVersion: '1.0.0';
  outcome: 'COMPLETED';
  clientRequestId: string;
  idempotencyKey: string;
  commandSemanticDigest: string;
  comment: ReviewCommentRecordV1;
};

export type GetReviewApprovalRequestV1 = {
  schemaVersion: '1.0.0';
  approvalId: string;
};

export type GetReviewApprovalResultV1 = {
  schemaVersion: '1.0.0';
  approval: ReviewApprovalV1;
};

export type ResolveReviewCommandOutcomeRequestV1 = {
  schemaVersion: '1.0.0';
  clientRequestId: string;
  idempotencyKey: string;
  semanticDigest: string;
};

export type ReviewCommandCompletedResultV1 =
  | {
      commandType: 'frontend.review.record-decisions.v1';
      result: RecordReviewDecisionsResultV1;
    }
  | {
      commandType: 'frontend.review.add-comment.v1';
      result: AddReviewCommentResultV1;
    }
  | {
      commandType: 'frontend.review.revalidate.v1';
      result: RevalidateReviewContextResultV1;
    };

export type ResolveReviewCommandOutcomeResultV1 = {
  schemaVersion: '1.0.0';
  outcome: 'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN';
  originalClientRequestId: string;
  originalIdempotencyKey: string;
  completed?: ReviewCommandCompletedResultV1;
  rejection?: { code: string; message: string };
};

// ---------------------------------------------------------------------------
// Semantic digests (identity fields excluded; shared with browser client)
// ---------------------------------------------------------------------------

export const frontendReviewRevalidateDigest = (request: RevalidateReviewContextRequestV1): string =>
  sha256Text(
    stableJson({
      reviewContextId: request.reviewContextId,
      contextRevision: request.contextRevision,
      reason: request.reason ?? null,
    }),
  );

export const frontendReviewRecordDecisionsDigest = (
  request: RecordReviewDecisionsRequestV1,
): string =>
  sha256Text(
    stableJson({
      reviewContextId: request.reviewContextId,
      expectedContextRevision: request.expectedContextRevision,
      expectedTargetRevision: request.expectedTargetRevision,
      expectedTargetDigest: request.expectedTargetDigest,
      itemDecisions: request.itemDecisions,
      comment: request.comment ?? null,
    }),
  );

export const frontendReviewAddCommentDigest = (request: AddReviewCommentRequestV1): string =>
  sha256Text(
    stableJson({
      reviewContextId: request.reviewContextId,
      contextRevision: request.contextRevision,
      reviewItemId: request.reviewItemId ?? null,
      comment: request.comment,
    }),
  );

// ---------------------------------------------------------------------------
// Strict decoders
// ---------------------------------------------------------------------------

type ObjectValue = Record<string, unknown>;

const fail = (path: string, message: string): never => {
  throw new FrontendContractError('INVALID_REQUEST', `${path}: ${message}`);
};

const asObject = (value: unknown, path: string): ObjectValue => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(path, 'must be a non-null object');
  }
  return value as ObjectValue;
};

const strictObject = (
  value: unknown,
  allowedKeys: readonly string[],
  path: string,
): ObjectValue => {
  const object = asObject(value, path);
  const unexpected = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    return fail(path, `contains unsupported fields: ${unexpected.join(', ')}`);
  }
  return object;
};

const required = (object: ObjectValue, key: string, path: string): unknown => {
  if (!(key in object) || object[key] === undefined) return fail(`${path}.${key}`, 'is required');
  return object[key];
};

const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(path, 'must be a non-empty string');
  }
  return value;
};

const optionalText = (value: unknown, path: string): string | undefined => {
  if (value === undefined) return undefined;
  return text(value, path);
};

const integer = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fail(path, 'must be a non-negative safe integer');
  }
  return value;
};

const booleanValue = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') return fail(path, 'must be a boolean');
  return value;
};

const enumValue = <T extends string>(value: unknown, values: readonly T[], path: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return fail(path, `must be one of ${values.join(', ')}`);
  }
  return value as T;
};

const arrayValue = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) return fail(path, 'must be an array');
  return value;
};

const isoTimestamp = (value: unknown, path: string): string => {
  const result = text(value, path);
  if (Number.isNaN(Date.parse(result))) return fail(path, 'must be an ISO timestamp');
  return result;
};

const decodeReviewSchemaVersion = (object: ObjectValue, path: string): void => {
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
};

export const decodeReviewTargetRefV1 = (value: unknown, path = 'targetRef'): ReviewTargetRefV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'targetKind', 'targetId', 'targetRevision'],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    targetKind: enumValue(
      required(object, 'targetKind', path),
      REVIEW_TARGET_KINDS,
      `${path}.targetKind`,
    ),
    targetId: text(required(object, 'targetId', path), `${path}.targetId`),
    targetRevision: text(required(object, 'targetRevision', path), `${path}.targetRevision`),
  };
};

export const decodeReviewCanonicalBaseRefV1 = (
  value: unknown,
  path = 'canonicalBase',
): ReviewCanonicalBaseRefV1 => {
  const object = strictObject(value, ['schemaVersion', 'snapshotId', 'revision', 'digest'], path);
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    revision: text(required(object, 'revision', path), `${path}.revision`),
    digest: text(required(object, 'digest', path), `${path}.digest`),
  };
};

export const decodeReviewArtifactRefV1 = (
  value: unknown,
  path = 'artifactRef',
): ReviewArtifactRefV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'artifactKind', 'artifactId', 'artifactRevision', 'digest'],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    artifactKind: enumValue(
      required(object, 'artifactKind', path),
      REVIEW_ARTIFACT_KINDS,
      `${path}.artifactKind`,
    ),
    artifactId: text(required(object, 'artifactId', path), `${path}.artifactId`),
    artifactRevision: text(required(object, 'artifactRevision', path), `${path}.artifactRevision`),
    digest: text(required(object, 'digest', path), `${path}.digest`),
  };
};

export const decodeReviewArtifactRefsV1 = (
  value: unknown,
  path = 'artifactRefs',
): ReviewArtifactRefsV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'validation', 'evidence', 'conflict', 'impact'],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    validation:
      object.validation === undefined
        ? undefined
        : decodeReviewArtifactRefV1(object.validation, `${path}.validation`),
    evidence:
      object.evidence === undefined
        ? undefined
        : decodeReviewArtifactRefV1(object.evidence, `${path}.evidence`),
    conflict:
      object.conflict === undefined
        ? undefined
        : decodeReviewArtifactRefV1(object.conflict, `${path}.conflict`),
    impact:
      object.impact === undefined
        ? undefined
        : decodeReviewArtifactRefV1(object.impact, `${path}.impact`),
  };
};

export const decodeReviewActorRefV1 = (value: unknown, path = 'actor'): ReviewActorRefV1 => {
  const object = strictObject(value, ['schemaVersion', 'principalId', 'actorId'], path);
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    principalId: text(required(object, 'principalId', path), `${path}.principalId`),
    actorId: text(required(object, 'actorId', path), `${path}.actorId`),
  };
};

export const decodeReviewContentRepresentationV1 = (
  value: unknown,
  path = 'representation',
): ReviewContentRepresentationV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'representationKind', 'summary', 'detailText'],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  const representationKind = enumValue(
    required(object, 'representationKind', path),
    ['OPAQUE_TEXT'],
    `${path}.representationKind`,
  );
  return {
    schemaVersion: '1.0.0',
    representationKind,
    summary: text(required(object, 'summary', path), `${path}.summary`),
    detailText: text(required(object, 'detailText', path), `${path}.detailText`),
  };
};

export const decodeReviewItemV1 = (value: unknown, path = 'item'): ReviewItemV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'reviewItemId',
      'sourceItemKind',
      'sourceItemId',
      'sourceItemRevision',
      'sourceItemDigest',
      'targetRef',
      'label',
      'before',
      'after',
      'rationale',
      'expectedImpact',
      'artifactRefs',
      'allowedDecisions',
      'decisionState',
      'sensitivity',
      'maskedFields',
      'accessMasking',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    reviewItemId: text(required(object, 'reviewItemId', path), `${path}.reviewItemId`),
    sourceItemKind: enumValue(
      required(object, 'sourceItemKind', path),
      REVIEW_SOURCE_ITEM_KINDS,
      `${path}.sourceItemKind`,
    ),
    sourceItemId: text(required(object, 'sourceItemId', path), `${path}.sourceItemId`),
    sourceItemRevision: text(
      required(object, 'sourceItemRevision', path),
      `${path}.sourceItemRevision`,
    ),
    sourceItemDigest: text(required(object, 'sourceItemDigest', path), `${path}.sourceItemDigest`),
    targetRef: decodeReviewTargetRefV1(required(object, 'targetRef', path), `${path}.targetRef`),
    label: text(required(object, 'label', path), `${path}.label`),
    before:
      object.before === undefined
        ? undefined
        : decodeReviewContentRepresentationV1(object.before, `${path}.before`),
    after:
      object.after === undefined
        ? undefined
        : decodeReviewContentRepresentationV1(object.after, `${path}.after`),
    rationale: text(required(object, 'rationale', path), `${path}.rationale`),
    expectedImpact: optionalText(object.expectedImpact, `${path}.expectedImpact`),
    artifactRefs: decodeReviewArtifactRefsV1(
      required(object, 'artifactRefs', path),
      `${path}.artifactRefs`,
    ),
    allowedDecisions: arrayValue(
      required(object, 'allowedDecisions', path),
      `${path}.allowedDecisions`,
    ).map((entry) => enumValue(entry, REVIEW_DECISION_INTENTS, `${path}.allowedDecisions`)),
    decisionState: enumValue(
      required(object, 'decisionState', path),
      REVIEW_ITEM_DECISION_STATES,
      `${path}.decisionState`,
    ),
    sensitivity: enumValue(
      required(object, 'sensitivity', path),
      REVIEW_SENSITIVITIES,
      `${path}.sensitivity`,
    ),
    maskedFields: arrayValue(required(object, 'maskedFields', path), `${path}.maskedFields`).map(
      (entry) => text(entry, `${path}.maskedFields`),
    ),
    accessMasking: enumValue(
      required(object, 'accessMasking', path),
      REVIEW_ACCESS_MASKING_STATES,
      `${path}.accessMasking`,
    ),
  };
};

export const decodeReviewDependencyV1 = (
  value: unknown,
  path = 'dependency',
): ReviewDependencyV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'dependencyId',
      'fromReviewItemId',
      'toReviewItemId',
      'kind',
      'reasonCode',
      'description',
      'availability',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    dependencyId: text(required(object, 'dependencyId', path), `${path}.dependencyId`),
    fromReviewItemId: text(required(object, 'fromReviewItemId', path), `${path}.fromReviewItemId`),
    toReviewItemId: text(required(object, 'toReviewItemId', path), `${path}.toReviewItemId`),
    kind: enumValue(required(object, 'kind', path), REVIEW_DEPENDENCY_KINDS, `${path}.kind`),
    reasonCode: text(required(object, 'reasonCode', path), `${path}.reasonCode`),
    description: text(required(object, 'description', path), `${path}.description`),
    availability: enumValue(
      required(object, 'availability', path),
      ['AVAILABLE', 'UNAVAILABLE'],
      `${path}.availability`,
    ),
  };
};

export const decodeReviewDecisionRecordV1 = (
  value: unknown,
  path = 'decision',
): ReviewDecisionRecordV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'decisionId',
      'reviewContextId',
      'contextRevision',
      'reviewItemId',
      'intent',
      'reason',
      'decidedBy',
      'decidedAt',
      'terminal',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    decisionId: text(required(object, 'decisionId', path), `${path}.decisionId`),
    reviewContextId: text(required(object, 'reviewContextId', path), `${path}.reviewContextId`),
    contextRevision: integer(required(object, 'contextRevision', path), `${path}.contextRevision`),
    reviewItemId: text(required(object, 'reviewItemId', path), `${path}.reviewItemId`),
    intent: enumValue(required(object, 'intent', path), REVIEW_DECISION_INTENTS, `${path}.intent`),
    reason: optionalText(object.reason, `${path}.reason`),
    decidedBy: decodeReviewActorRefV1(required(object, 'decidedBy', path), `${path}.decidedBy`),
    decidedAt: isoTimestamp(required(object, 'decidedAt', path), `${path}.decidedAt`),
    terminal: booleanValue(required(object, 'terminal', path), `${path}.terminal`),
  };
};

export const decodeReviewCommentRecordV1 = (
  value: unknown,
  path = 'comment',
): ReviewCommentRecordV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'commentId',
      'reviewContextId',
      'contextRevision',
      'reviewItemId',
      'text',
      'authoredBy',
      'authoredAt',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    commentId: text(required(object, 'commentId', path), `${path}.commentId`),
    reviewContextId: text(required(object, 'reviewContextId', path), `${path}.reviewContextId`),
    contextRevision: integer(required(object, 'contextRevision', path), `${path}.contextRevision`),
    reviewItemId: optionalText(object.reviewItemId, `${path}.reviewItemId`),
    text: text(required(object, 'text', path), `${path}.text`),
    authoredBy: decodeReviewActorRefV1(required(object, 'authoredBy', path), `${path}.authoredBy`),
    authoredAt: isoTimestamp(required(object, 'authoredAt', path), `${path}.authoredAt`),
  };
};

export const decodeReviewApprovalV1 = (value: unknown, path = 'approval'): ReviewApprovalV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'approvalId',
      'purpose',
      'reviewContextId',
      'contextRevision',
      'targetKind',
      'targetId',
      'targetRevision',
      'targetDigest',
      'approvedItemIds',
      'approvedManifestDigest',
      'actor',
      'projectId',
      'accessRevision',
      'policyContextRevision',
      'reason',
      'issuedAt',
      'expiresAt',
      'status',
      'invalidationReason',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    approvalId: text(required(object, 'approvalId', path), `${path}.approvalId`),
    purpose: enumValue(required(object, 'purpose', path), APPROVAL_PURPOSES, `${path}.purpose`),
    reviewContextId: text(required(object, 'reviewContextId', path), `${path}.reviewContextId`),
    contextRevision: integer(required(object, 'contextRevision', path), `${path}.contextRevision`),
    targetKind: enumValue(
      required(object, 'targetKind', path),
      REVIEW_TARGET_KINDS,
      `${path}.targetKind`,
    ),
    targetId: text(required(object, 'targetId', path), `${path}.targetId`),
    targetRevision: text(required(object, 'targetRevision', path), `${path}.targetRevision`),
    targetDigest: text(required(object, 'targetDigest', path), `${path}.targetDigest`),
    approvedItemIds: arrayValue(
      required(object, 'approvedItemIds', path),
      `${path}.approvedItemIds`,
    ).map((entry) => text(entry, `${path}.approvedItemIds`)),
    approvedManifestDigest: text(
      required(object, 'approvedManifestDigest', path),
      `${path}.approvedManifestDigest`,
    ),
    actor: decodeReviewActorRefV1(required(object, 'actor', path), `${path}.actor`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    accessRevision: text(required(object, 'accessRevision', path), `${path}.accessRevision`),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    reason: text(required(object, 'reason', path), `${path}.reason`),
    issuedAt: isoTimestamp(required(object, 'issuedAt', path), `${path}.issuedAt`),
    expiresAt: isoTimestamp(required(object, 'expiresAt', path), `${path}.expiresAt`),
    status: enumValue(required(object, 'status', path), APPROVAL_STATUSES, `${path}.status`),
    invalidationReason: optionalText(object.invalidationReason, `${path}.invalidationReason`),
  };
};

export const decodeReviewContextRevisionV1 = (
  value: unknown,
  path = 'context',
): ReviewContextRevisionV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'reviewContextId',
      'contextRevision',
      'reviewResourceId',
      'targetKind',
      'targetId',
      'targetRevision',
      'targetDigest',
      'resourceProjectId',
      'effectiveProjectId',
      'accessRevision',
      'policyContextRevision',
      'canonicalBase',
      'artifactRefs',
      'items',
      'dependencies',
      'aggregateState',
      'capabilities',
      'generatedAt',
      'staleReason',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    reviewContextId: text(required(object, 'reviewContextId', path), `${path}.reviewContextId`),
    contextRevision: integer(required(object, 'contextRevision', path), `${path}.contextRevision`),
    reviewResourceId: text(required(object, 'reviewResourceId', path), `${path}.reviewResourceId`),
    targetKind: enumValue(
      required(object, 'targetKind', path),
      REVIEW_TARGET_KINDS,
      `${path}.targetKind`,
    ),
    targetId: text(required(object, 'targetId', path), `${path}.targetId`),
    targetRevision: text(required(object, 'targetRevision', path), `${path}.targetRevision`),
    targetDigest: text(required(object, 'targetDigest', path), `${path}.targetDigest`),
    resourceProjectId: text(
      required(object, 'resourceProjectId', path),
      `${path}.resourceProjectId`,
    ),
    effectiveProjectId: text(
      required(object, 'effectiveProjectId', path),
      `${path}.effectiveProjectId`,
    ),
    accessRevision: text(required(object, 'accessRevision', path), `${path}.accessRevision`),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    canonicalBase:
      object.canonicalBase === undefined
        ? undefined
        : decodeReviewCanonicalBaseRefV1(object.canonicalBase, `${path}.canonicalBase`),
    artifactRefs: decodeReviewArtifactRefsV1(
      required(object, 'artifactRefs', path),
      `${path}.artifactRefs`,
    ),
    items: arrayValue(required(object, 'items', path), `${path}.items`).map((entry) =>
      decodeReviewItemV1(entry, `${path}.items`),
    ),
    dependencies: arrayValue(required(object, 'dependencies', path), `${path}.dependencies`).map(
      (entry) => decodeReviewDependencyV1(entry, `${path}.dependencies`),
    ),
    aggregateState: enumValue(
      required(object, 'aggregateState', path),
      REVIEW_AGGREGATE_STATES,
      `${path}.aggregateState`,
    ),
    capabilities: arrayValue(required(object, 'capabilities', path), `${path}.capabilities`).map(
      (entry) => enumValue(entry, REVIEW_CAPABILITIES, `${path}.capabilities`),
    ),
    generatedAt: isoTimestamp(required(object, 'generatedAt', path), `${path}.generatedAt`),
    staleReason: optionalText(object.staleReason, `${path}.staleReason`),
  };
};

export const decodeReviewQueueAcceptedContextV1 = (
  value: unknown,
  path = 'acceptedContext',
): ReviewQueueAcceptedContextV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'resourceProjectId', 'accessRevision', 'policyContextRevision'],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    resourceProjectId: text(
      required(object, 'resourceProjectId', path),
      `${path}.resourceProjectId`,
    ),
    accessRevision: text(required(object, 'accessRevision', path), `${path}.accessRevision`),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
  };
};

export const decodeReviewQueueItemV1 = (value: unknown, path = 'queueItem'): ReviewQueueItemV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'reviewContextId',
      'contextRevision',
      'targetKind',
      'targetId',
      'targetLabel',
      'aggregateState',
      'itemCount',
      'updatedAt',
      'attentionReasons',
      'capabilities',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    reviewContextId: text(required(object, 'reviewContextId', path), `${path}.reviewContextId`),
    contextRevision: integer(required(object, 'contextRevision', path), `${path}.contextRevision`),
    targetKind: enumValue(
      required(object, 'targetKind', path),
      REVIEW_TARGET_KINDS,
      `${path}.targetKind`,
    ),
    targetId: text(required(object, 'targetId', path), `${path}.targetId`),
    targetLabel: text(required(object, 'targetLabel', path), `${path}.targetLabel`),
    aggregateState: enumValue(
      required(object, 'aggregateState', path),
      REVIEW_AGGREGATE_STATES,
      `${path}.aggregateState`,
    ),
    itemCount: integer(required(object, 'itemCount', path), `${path}.itemCount`),
    updatedAt: isoTimestamp(required(object, 'updatedAt', path), `${path}.updatedAt`),
    attentionReasons: arrayValue(
      required(object, 'attentionReasons', path),
      `${path}.attentionReasons`,
    ).map((entry) => enumValue(entry, REVIEW_ATTENTION_REASONS, `${path}.attentionReasons`)),
    capabilities: arrayValue(required(object, 'capabilities', path), `${path}.capabilities`).map(
      (entry) => enumValue(entry, REVIEW_CAPABILITIES, `${path}.capabilities`),
    ),
  };
};

export const decodeReviewEvidenceEntryV1 = (
  value: unknown,
  path = 'evidenceEntry',
): ReviewEvidenceEntryV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'sourceId', 'sourceVersionId', 'evidenceSpanId', 'snippet'],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    sourceId: text(required(object, 'sourceId', path), `${path}.sourceId`),
    sourceVersionId: text(required(object, 'sourceVersionId', path), `${path}.sourceVersionId`),
    evidenceSpanId: text(required(object, 'evidenceSpanId', path), `${path}.evidenceSpanId`),
    snippet: text(required(object, 'snippet', path), `${path}.snippet`),
  };
};

export const decodeReviewImpactEntryV1 = (
  value: unknown,
  path = 'impactEntry',
): ReviewImpactEntryV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'impactId', 'targetKind', 'targetId', 'description'],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    impactId: text(required(object, 'impactId', path), `${path}.impactId`),
    targetKind: text(required(object, 'targetKind', path), `${path}.targetKind`),
    targetId: text(required(object, 'targetId', path), `${path}.targetId`),
    description: text(required(object, 'description', path), `${path}.description`),
  };
};

export const decodeReviewRevisionReturnTargetV1 = (
  value: unknown,
  path = 'revisionRequestReturnTarget',
): ReviewRevisionReturnTargetV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'workspace', 'resourceId', 'draftId', 'draftRevision', 'reason'],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    workspace: enumValue(
      required(object, 'workspace', path),
      ['KNOWLEDGE_EDITOR', 'DIRECTIVE_AUTHORING'],
      `${path}.workspace`,
    ),
    resourceId: text(required(object, 'resourceId', path), `${path}.resourceId`),
    draftId: optionalText(object.draftId, `${path}.draftId`),
    draftRevision:
      object.draftRevision === undefined
        ? undefined
        : integer(object.draftRevision, `${path}.draftRevision`),
    reason: text(required(object, 'reason', path), `${path}.reason`),
  };
};

export const decodeListReviewQueueRequestV1 = (
  value: unknown,
  path = 'request',
): ListReviewQueueRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'targetKinds',
      'aggregateStates',
      'attentionReasons',
      'query',
      'pageSize',
      'cursor',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  const pageSize = integer(required(object, 'pageSize', path), `${path}.pageSize`);
  if (pageSize < 1 || pageSize > 50) {
    return fail(`${path}.pageSize`, 'must be between 1 and 50');
  }
  return {
    schemaVersion: '1.0.0',
    targetKinds:
      object.targetKinds === undefined
        ? undefined
        : arrayValue(object.targetKinds, `${path}.targetKinds`).map((entry) =>
            enumValue(entry, REVIEW_TARGET_KINDS, `${path}.targetKinds`),
          ),
    aggregateStates:
      object.aggregateStates === undefined
        ? undefined
        : arrayValue(object.aggregateStates, `${path}.aggregateStates`).map((entry) =>
            enumValue(entry, REVIEW_AGGREGATE_STATES, `${path}.aggregateStates`),
          ),
    attentionReasons:
      object.attentionReasons === undefined
        ? undefined
        : arrayValue(object.attentionReasons, `${path}.attentionReasons`).map((entry) =>
            enumValue(entry, REVIEW_ATTENTION_REASONS, `${path}.attentionReasons`),
          ),
    query: optionalText(object.query, `${path}.query`),
    pageSize,
    cursor: optionalText(object.cursor, `${path}.cursor`),
  };
};

export const decodeListReviewQueueResultV1 = (
  value: unknown,
  path = 'result',
): ListReviewQueueResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'acceptedContext',
      'queueSnapshotRevision',
      'items',
      'nextCursor',
      'totalCountStatus',
      'capabilities',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    acceptedContext: decodeReviewQueueAcceptedContextV1(
      required(object, 'acceptedContext', path),
      `${path}.acceptedContext`,
    ),
    queueSnapshotRevision: text(
      required(object, 'queueSnapshotRevision', path),
      `${path}.queueSnapshotRevision`,
    ),
    items: arrayValue(required(object, 'items', path), `${path}.items`).map((entry) =>
      decodeReviewQueueItemV1(entry, `${path}.items`),
    ),
    nextCursor: optionalText(object.nextCursor, `${path}.nextCursor`),
    totalCountStatus: enumValue(
      required(object, 'totalCountStatus', path),
      REVIEW_TOTAL_COUNT_STATUSES,
      `${path}.totalCountStatus`,
    ),
    capabilities: arrayValue(required(object, 'capabilities', path), `${path}.capabilities`).map(
      (entry) => enumValue(entry, REVIEW_CAPABILITIES, `${path}.capabilities`),
    ),
  };
};

export const decodeGetReviewContextRequestV1 = (
  value: unknown,
  path = 'request',
): GetReviewContextRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'reviewContextId', 'contextRevision'], path);
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    reviewContextId: text(required(object, 'reviewContextId', path), `${path}.reviewContextId`),
    contextRevision: integer(required(object, 'contextRevision', path), `${path}.contextRevision`),
  };
};

export const decodeGetReviewContextResultV1 = (
  value: unknown,
  path = 'result',
): GetReviewContextResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'context', 'decisions', 'comments'], path);
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    context: decodeReviewContextRevisionV1(required(object, 'context', path), `${path}.context`),
    decisions: arrayValue(required(object, 'decisions', path), `${path}.decisions`).map((entry) =>
      decodeReviewDecisionRecordV1(entry, `${path}.decisions`),
    ),
    comments: arrayValue(required(object, 'comments', path), `${path}.comments`).map((entry) =>
      decodeReviewCommentRecordV1(entry, `${path}.comments`),
    ),
  };
};

export const decodeGetReviewItemDetailRequestV1 = (
  value: unknown,
  path = 'request',
): GetReviewItemDetailRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'reviewContextId',
      'contextRevision',
      'reviewItemId',
      'includeEvidence',
      'includeImpact',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    reviewContextId: text(required(object, 'reviewContextId', path), `${path}.reviewContextId`),
    contextRevision: integer(required(object, 'contextRevision', path), `${path}.contextRevision`),
    reviewItemId: text(required(object, 'reviewItemId', path), `${path}.reviewItemId`),
    includeEvidence:
      object.includeEvidence === undefined
        ? undefined
        : booleanValue(object.includeEvidence, `${path}.includeEvidence`),
    includeImpact:
      object.includeImpact === undefined
        ? undefined
        : booleanValue(object.includeImpact, `${path}.includeImpact`),
  };
};

export const decodeGetReviewItemDetailResultV1 = (
  value: unknown,
  path = 'result',
): GetReviewItemDetailResultV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'item', 'dependencies', 'evidence', 'impact', 'decisions'],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    item: decodeReviewItemV1(required(object, 'item', path), `${path}.item`),
    dependencies: arrayValue(required(object, 'dependencies', path), `${path}.dependencies`).map(
      (entry) => decodeReviewDependencyV1(entry, `${path}.dependencies`),
    ),
    evidence:
      object.evidence === undefined
        ? undefined
        : arrayValue(object.evidence, `${path}.evidence`).map((entry) =>
            decodeReviewEvidenceEntryV1(entry, `${path}.evidence`),
          ),
    impact:
      object.impact === undefined
        ? undefined
        : arrayValue(object.impact, `${path}.impact`).map((entry) =>
            decodeReviewImpactEntryV1(entry, `${path}.impact`),
          ),
    decisions: arrayValue(required(object, 'decisions', path), `${path}.decisions`).map((entry) =>
      decodeReviewDecisionRecordV1(entry, `${path}.decisions`),
    ),
  };
};

export const decodeRevalidateReviewContextRequestV1 = (
  value: unknown,
  path = 'request',
): RevalidateReviewContextRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'reviewContextId',
      'contextRevision',
      'reason',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    reviewContextId: text(required(object, 'reviewContextId', path), `${path}.reviewContextId`),
    contextRevision: integer(required(object, 'contextRevision', path), `${path}.contextRevision`),
    reason: optionalText(object.reason, `${path}.reason`),
  };
};

export const decodeRevalidateReviewContextResultV1 = (
  value: unknown,
  path = 'result',
): RevalidateReviewContextResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'context',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  const outcome = enumValue(required(object, 'outcome', path), ['COMPLETED'], `${path}.outcome`);
  return {
    schemaVersion: '1.0.0',
    outcome,
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    context: decodeReviewContextRevisionV1(required(object, 'context', path), `${path}.context`),
  };
};

export const decodeReviewItemDecisionInputV1 = (
  value: unknown,
  path = 'itemDecision',
): ReviewItemDecisionInputV1 => {
  const object = strictObject(value, ['schemaVersion', 'reviewItemId', 'intent', 'reason'], path);
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    reviewItemId: text(required(object, 'reviewItemId', path), `${path}.reviewItemId`),
    intent: enumValue(required(object, 'intent', path), REVIEW_DECISION_INTENTS, `${path}.intent`),
    reason: optionalText(object.reason, `${path}.reason`),
  };
};

export const decodeRecordReviewDecisionsRequestV1 = (
  value: unknown,
  path = 'request',
): RecordReviewDecisionsRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'reviewContextId',
      'expectedContextRevision',
      'expectedTargetRevision',
      'expectedTargetDigest',
      'itemDecisions',
      'comment',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  const itemDecisions = arrayValue(
    required(object, 'itemDecisions', path),
    `${path}.itemDecisions`,
  ).map((entry) => decodeReviewItemDecisionInputV1(entry, `${path}.itemDecisions`));
  if (itemDecisions.length === 0) {
    return fail(`${path}.itemDecisions`, 'must contain at least one item decision');
  }
  const seen = new Set<string>();
  for (const decision of itemDecisions) {
    if (seen.has(decision.reviewItemId)) {
      return fail(
        `${path}.itemDecisions`,
        `contains duplicate reviewItemId '${decision.reviewItemId}'`,
      );
    }
    seen.add(decision.reviewItemId);
    if (
      decision.intent !== 'HOLD' &&
      (decision.reason === undefined || decision.reason.trim() === '')
    ) {
      return fail(
        `${path}.itemDecisions`,
        `terminal decision '${decision.intent}' for '${decision.reviewItemId}' requires a non-empty reason`,
      );
    }
  }
  return {
    schemaVersion: '1.0.0',
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    reviewContextId: text(required(object, 'reviewContextId', path), `${path}.reviewContextId`),
    expectedContextRevision: integer(
      required(object, 'expectedContextRevision', path),
      `${path}.expectedContextRevision`,
    ),
    expectedTargetRevision: text(
      required(object, 'expectedTargetRevision', path),
      `${path}.expectedTargetRevision`,
    ),
    expectedTargetDigest: text(
      required(object, 'expectedTargetDigest', path),
      `${path}.expectedTargetDigest`,
    ),
    itemDecisions,
    comment: optionalText(object.comment, `${path}.comment`),
  };
};

export const decodeRecordReviewDecisionsResultV1 = (
  value: unknown,
  path = 'result',
): RecordReviewDecisionsResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'reviewContextId',
      'contextRevision',
      'decisions',
      'aggregateState',
      'approvals',
      'acceptedForAuthoring',
      'revisionRequestReturnTarget',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  const outcome = enumValue(required(object, 'outcome', path), ['COMPLETED'], `${path}.outcome`);
  return {
    schemaVersion: '1.0.0',
    outcome,
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    reviewContextId: text(required(object, 'reviewContextId', path), `${path}.reviewContextId`),
    contextRevision: integer(required(object, 'contextRevision', path), `${path}.contextRevision`),
    decisions: arrayValue(required(object, 'decisions', path), `${path}.decisions`).map((entry) =>
      decodeReviewDecisionRecordV1(entry, `${path}.decisions`),
    ),
    aggregateState: enumValue(
      required(object, 'aggregateState', path),
      REVIEW_AGGREGATE_STATES,
      `${path}.aggregateState`,
    ),
    approvals:
      object.approvals === undefined
        ? undefined
        : arrayValue(object.approvals, `${path}.approvals`).map((entry) =>
            decodeReviewApprovalV1(entry, `${path}.approvals`),
          ),
    acceptedForAuthoring:
      object.acceptedForAuthoring === undefined
        ? undefined
        : booleanValue(object.acceptedForAuthoring, `${path}.acceptedForAuthoring`),
    revisionRequestReturnTarget:
      object.revisionRequestReturnTarget === undefined
        ? undefined
        : decodeReviewRevisionReturnTargetV1(
            object.revisionRequestReturnTarget,
            `${path}.revisionRequestReturnTarget`,
          ),
  };
};

export const decodeAddReviewCommentRequestV1 = (
  value: unknown,
  path = 'request',
): AddReviewCommentRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'clientRequestId',
      'idempotencyKey',
      'reviewContextId',
      'contextRevision',
      'reviewItemId',
      'comment',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    reviewContextId: text(required(object, 'reviewContextId', path), `${path}.reviewContextId`),
    contextRevision: integer(required(object, 'contextRevision', path), `${path}.contextRevision`),
    reviewItemId: optionalText(object.reviewItemId, `${path}.reviewItemId`),
    comment: text(required(object, 'comment', path), `${path}.comment`),
  };
};

export const decodeAddReviewCommentResultV1 = (
  value: unknown,
  path = 'result',
): AddReviewCommentResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'clientRequestId',
      'idempotencyKey',
      'commandSemanticDigest',
      'comment',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  const outcome = enumValue(required(object, 'outcome', path), ['COMPLETED'], `${path}.outcome`);
  return {
    schemaVersion: '1.0.0',
    outcome,
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    commandSemanticDigest: text(
      required(object, 'commandSemanticDigest', path),
      `${path}.commandSemanticDigest`,
    ),
    comment: decodeReviewCommentRecordV1(required(object, 'comment', path), `${path}.comment`),
  };
};

export const decodeGetReviewApprovalRequestV1 = (
  value: unknown,
  path = 'request',
): GetReviewApprovalRequestV1 => {
  const object = strictObject(value, ['schemaVersion', 'approvalId'], path);
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    approvalId: text(required(object, 'approvalId', path), `${path}.approvalId`),
  };
};

export const decodeGetReviewApprovalResultV1 = (
  value: unknown,
  path = 'result',
): GetReviewApprovalResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'approval'], path);
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    approval: decodeReviewApprovalV1(required(object, 'approval', path), `${path}.approval`),
  };
};

export const decodeResolveReviewCommandOutcomeRequestV1 = (
  value: unknown,
  path = 'request',
): ResolveReviewCommandOutcomeRequestV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'clientRequestId', 'idempotencyKey', 'semanticDigest'],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  return {
    schemaVersion: '1.0.0',
    clientRequestId: text(required(object, 'clientRequestId', path), `${path}.clientRequestId`),
    idempotencyKey: text(required(object, 'idempotencyKey', path), `${path}.idempotencyKey`),
    semanticDigest: text(required(object, 'semanticDigest', path), `${path}.semanticDigest`),
  };
};

const decodeReviewCommandCompletedResultV1 = (
  value: unknown,
  path = 'completed',
): ReviewCommandCompletedResultV1 => {
  const object = asObject(value, path);
  const commandType = text(required(object, 'commandType', path), `${path}.commandType`);
  switch (commandType) {
    case FRONTEND_REVIEW_COMMAND_TYPES.recordDecisions:
      return {
        commandType,
        result: decodeRecordReviewDecisionsResultV1(
          required(object, 'result', path),
          `${path}.result`,
        ),
      };
    case FRONTEND_REVIEW_COMMAND_TYPES.addComment:
      return {
        commandType,
        result: decodeAddReviewCommentResultV1(required(object, 'result', path), `${path}.result`),
      };
    case FRONTEND_REVIEW_COMMAND_TYPES.revalidateContext:
      return {
        commandType,
        result: decodeRevalidateReviewContextResultV1(
          required(object, 'result', path),
          `${path}.result`,
        ),
      };
    default:
      return fail(`${path}.commandType`, `unsupported command type '${commandType}'`);
  }
};

export const decodeResolveReviewCommandOutcomeResultV1 = (
  value: unknown,
  path = 'result',
): ResolveReviewCommandOutcomeResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'outcome',
      'originalClientRequestId',
      'originalIdempotencyKey',
      'completed',
      'rejection',
    ],
    path,
  );
  decodeReviewSchemaVersion(object, path);
  const rejection =
    object.rejection === undefined
      ? undefined
      : (() => {
          const ro = strictObject(object.rejection, ['code', 'message'], `${path}.rejection`);
          return {
            code: text(required(ro, 'code', path), `${path}.rejection.code`),
            message: text(required(ro, 'message', path), `${path}.rejection.message`),
          };
        })();
  return {
    schemaVersion: '1.0.0',
    outcome: enumValue(
      required(object, 'outcome', path),
      ['COMPLETED', 'REJECTED', 'OUTCOME_UNKNOWN'],
      `${path}.outcome`,
    ),
    originalClientRequestId: text(
      required(object, 'originalClientRequestId', path),
      `${path}.originalClientRequestId`,
    ),
    originalIdempotencyKey: text(
      required(object, 'originalIdempotencyKey', path),
      `${path}.originalIdempotencyKey`,
    ),
    completed:
      object.completed === undefined
        ? undefined
        : decodeReviewCommandCompletedResultV1(object.completed, `${path}.completed`),
    rejection,
  };
};

// ---------------------------------------------------------------------------
// Cross-field identity validation helpers
// ---------------------------------------------------------------------------

/**
 * Cross-field invariant: an Item source kind must be consistent with the
 * Review target kind. Hidden content never leaks; the caller removes hidden
 * Items before describing dependencies.
 */
export const validateReviewSourceItemKind = (
  targetKind: ReviewTargetKindV1,
  sourceItemKind: ReviewSourceItemKindV1,
): boolean => {
  switch (targetKind) {
    case 'KNOWLEDGE_DRAFT_CHANGE_SET':
      return sourceItemKind === 'KNOWLEDGE_OPERATION';
    case 'DISCOVERY_CANDIDATE':
      return sourceItemKind === 'DISCOVERY_CANDIDATE';
    case 'USER_DIRECTIVE_PROPOSAL':
      return sourceItemKind === 'USER_DIRECTIVE_CLAUSE';
  }
};

/** Cross-field invariant: canonicalBase is required for Knowledge Draft targets. */
export const validateReviewCanonicalBaseRequirement = (
  targetKind: ReviewTargetKindV1,
  canonicalBase: ReviewCanonicalBaseRefV1 | undefined,
): boolean => {
  if (targetKind === 'KNOWLEDGE_DRAFT_CHANGE_SET') return canonicalBase !== undefined;
  return true;
};

/** Dependency references must point at existing Items (no dangling references). */
export const validateReviewDependencyReferences = (
  dependencies: readonly ReviewDependencyV1[],
  itemIds: ReadonlySet<string>,
): boolean =>
  dependencies.every(
    (dependency) =>
      itemIds.has(dependency.fromReviewItemId) && itemIds.has(dependency.toReviewItemId),
  );

/** Cross-field invariant: purpose must be eligible for the target kind. */
export const validateReviewApprovalPurpose = (
  targetKind: ReviewTargetKindV1,
  purpose: ApprovalPurposeV1,
): boolean => {
  switch (targetKind) {
    case 'KNOWLEDGE_DRAFT_CHANGE_SET':
      return purpose === 'KNOWLEDGE_CANONICAL_CHANGE';
    case 'USER_DIRECTIVE_PROPOSAL':
      return purpose === 'USER_DIRECTIVE_CHANGE';
    case 'DISCOVERY_CANDIDATE':
      // Discovery Candidate approval creates no Approval Resource.
      return false;
  }
};

/** Maps the frozen V1 review failure set to the shared typed envelope codes. */
export const REVIEW_FAILURE_ERROR_CODES: Readonly<Record<ReviewFailureReasonV1, ErrorCode>> = {
  REVIEW_CONTEXT_NOT_FOUND: 'REVIEW_CONTEXT_NOT_FOUND',
  REVIEW_CONTEXT_STALE: 'REVIEW_CONTEXT_STALE',
  REVIEW_TARGET_CHANGED: 'REVIEW_TARGET_CHANGED',
  REVIEW_ITEM_NOT_FOUND: 'REVIEW_ITEM_NOT_FOUND',
  REVIEW_DECISION_NOT_ALLOWED: 'REVIEW_DECISION_NOT_ALLOWED',
  REVIEW_DEPENDENCY_UNSATISFIED: 'REVIEW_DEPENDENCY_UNSATISFIED',
  REVIEW_ATOMIC_GROUP_SPLIT: 'REVIEW_ATOMIC_GROUP_SPLIT',
  REVIEW_CONFLICTING_APPROVAL_SET: 'REVIEW_CONFLICTING_APPROVAL_SET',
  REVIEW_DANGLING_REFERENCE: 'REVIEW_DANGLING_REFERENCE',
  REVIEW_EVIDENCE_CHANGED: 'REVIEW_EVIDENCE_CHANGED',
  REVIEW_POLICY_CHANGED: 'REVIEW_POLICY_CHANGED',
  REVIEW_ACCESS_CHANGED: 'REVIEW_ACCESS_CHANGED',
  REVIEW_APPROVAL_NOT_ISSUED: 'REVIEW_APPROVAL_NOT_ISSUED',
  REVIEW_APPROVAL_EXPIRED: 'REVIEW_APPROVAL_EXPIRED',
  REVIEW_REVISION_ROUTE_UNAVAILABLE: 'REVIEW_REVISION_ROUTE_UNAVAILABLE',
  EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2: 'EXTERNAL_ACTION_REVIEW_REQUIRES_FE_P4_S2',
};
