import { FrontendContractError } from './frontend-foundation.js';
import type {
  ClaimValueV1,
  ConflictProposalValueV1,
  DecisionValueV1,
  EntityValueV1,
  EventValueV1,
  EvidenceLinkValueV1,
  FactValueV1,
  KnowledgeGapProposalValueV1,
  RelationValueV1,
} from './frontend-knowledge-draft.js';

/**
 * FE-P3-S3 Semantic Graph and Relationship Exploration — exact V1 contracts.
 *
 * Frozen by FE-P3-S3 Contract Snapshot revision 5 (approved 2026-08-04) and
 * ADR-127 (accepted 2026-08-04). Every type carries schemaVersion '1.0.0',
 * decoders reject unknown fields, empty/whitespace-only IDs, unknown
 * discriminants, and never use `any`.
 */

export type GraphSchemaVersion = '1.0.0';

// Axis 1 — resource/node kind
export type GraphResourceKindV1 =
  | 'ENTITY'
  | 'FACT'
  | 'CLAIM'
  | 'RELATION'
  | 'EVENT'
  | 'DECISION'
  | 'EVIDENCE'
  | 'SOURCE'
  | 'CONFLICT'
  | 'KNOWLEDGE_GAP';

// Axis 2 — edge semantic kind
export type GraphEdgeSemanticKindV1 =
  | 'CANONICAL_RELATION'
  | 'CANONICAL_STATEMENT_ASSOCIATION'
  | 'DERIVED_INFERENCE'
  | 'DISCOVERY_CANDIDATE'
  | 'POSSIBLY_SAME'
  | 'EVIDENCE_LINKAGE'
  | 'CONFLICT'
  | 'KNOWLEDGE_GAP'
  | 'TEMPORAL_RELATIONSHIP'
  | 'GOVERNANCE_IMPACT'
  | 'OPERATIONAL_DEPENDENCY';

// Axis 3 — authority / provenance-lineage classification (reduced; never edge
// semantic kinds, resource states, overlay kinds or ACTION_CANDIDATE)
export type GraphAuthorityClassificationV1 =
  'CANONICAL' | 'DERIVED_INFERENCE' | 'DISCOVERY_CANDIDATE';

// Axis 4 — base view membership
export type GraphBaseViewKindV1 =
  'KNOWLEDGE_SEMANTIC' | 'GOVERNANCE_IMPACT' | 'OPERATIONAL_DEPENDENCY';

// Axis 5 — overlay membership
export type GraphOverlayKindV1 = 'CONFLICT' | 'KNOWLEDGE_GAP' | 'RECURSIVE_IMPACT';

// Axis 6 — projection health
export type GraphProjectionHealthV1 =
  | 'COMPLETE'
  | 'PARTIAL'
  | 'TRUNCATED'
  | 'STALE'
  | 'REBUILDING'
  | 'FAILED'
  | 'UNAVAILABLE'
  | 'ACCESS_RESTRICTED';

// Axis 7 — result completeness
export type GraphResultCompletenessV1 = 'COMPLETE' | 'PARTIAL' | 'TRUNCATED';

// Axis 8 — access / masking state
export type GraphAccessMaskingStateV1 = 'VISIBLE' | 'MASKED' | 'HIDDEN';

// Axis 9 — traversal-relative direction (derived, never intrinsic)
export type GraphTraversalDirectionV1 = 'OUTGOING_FROM_ROOT' | 'INCOMING_TO_ROOT';

export type GraphNodeReferenceV1 = {
  schemaVersion: '1.0.0';
  resourceKind: GraphResourceKindV1;
  resourceId: string;
};

export type GraphEdgeReferenceV1 = {
  schemaVersion: '1.0.0';
  edgeId: string;
  from: GraphNodeReferenceV1;
  to: GraphNodeReferenceV1;
};

export type GraphRelationReferenceV1 = {
  schemaVersion: '1.0.0';
  relationId: string;
  qualifier?: string;
};

export type GraphRelationPayloadV1 = {
  schemaVersion: '1.0.0';
  relationRef: GraphRelationReferenceV1;
  relationType: string;
  subjectRef: GraphNodeReferenceV1;
  objectRef: GraphNodeReferenceV1;
  otherEndpointRefs?: readonly GraphNodeReferenceV1[];
};

export type GraphSourcePayloadV1 = {
  schemaVersion: '1.0.0';
  sourceId: string;
  sourceVersionId?: string;
  title: string;
};

export type GraphNodePayloadV1 =
  | { schemaVersion: '1.0.0'; nodeKind: 'ENTITY'; entity: EntityValueV1 }
  | { schemaVersion: '1.0.0'; nodeKind: 'FACT'; fact: FactValueV1 }
  | { schemaVersion: '1.0.0'; nodeKind: 'CLAIM'; claim: ClaimValueV1 }
  | { schemaVersion: '1.0.0'; nodeKind: 'RELATION'; relation: GraphRelationPayloadV1 }
  | { schemaVersion: '1.0.0'; nodeKind: 'EVENT'; event: EventValueV1 }
  | { schemaVersion: '1.0.0'; nodeKind: 'DECISION'; decision: DecisionValueV1 }
  | { schemaVersion: '1.0.0'; nodeKind: 'EVIDENCE'; evidence: EvidenceLinkValueV1 }
  | { schemaVersion: '1.0.0'; nodeKind: 'SOURCE'; source: GraphSourcePayloadV1 }
  | { schemaVersion: '1.0.0'; nodeKind: 'CONFLICT'; conflict: ConflictProposalValueV1 }
  | {
      schemaVersion: '1.0.0';
      nodeKind: 'KNOWLEDGE_GAP';
      knowledgeGap: KnowledgeGapProposalValueV1;
    };

export type GraphProvenanceSummaryV1 = {
  schemaVersion: '1.0.0';
  sourceProjectId: string;
  canonicalRevision?: string;
  generatedBy: 'CANONICAL' | 'STAGE9_MODEL' | 'COMPILED_TRUTH' | 'IMPACT_ANALYZER';
  provenanceNote?: string;
};

export type GraphEvidenceSummaryV1 = {
  schemaVersion: '1.0.0';
  evidenceCount: number;
  sourceIds: readonly string[];
  evidenceSpanIds: readonly string[];
};

export type GraphTemporalValidityV1 = {
  schemaVersion: '1.0.0';
  validFrom?: string;
  validTo?: string;
  status: 'KNOWN' | 'OPEN' | 'UNKNOWN';
};

export type GraphRevisionBindingV1 = {
  schemaVersion: '1.0.0';
  projectionRevision: string;
  policyContextRevision: string;
  accessRevision: string;
};

export type GraphNodeV1 = {
  schemaVersion: '1.0.0';
  nodeId: string;
  resourceRef: GraphNodeReferenceV1;
  label: string;
  nodeKind: GraphResourceKindV1;
  authority: GraphAuthorityClassificationV1;
  baseViewMembership: GraphBaseViewKindV1;
  overlayMemberships: readonly GraphOverlayKindV1[];
  provenance?: GraphProvenanceSummaryV1;
  evidence?: GraphEvidenceSummaryV1;
  temporalValidity?: GraphTemporalValidityV1;
  revisionBinding: GraphRevisionBindingV1;
  accessMasking: GraphAccessMaskingStateV1;
  payload?: GraphNodePayloadV1;
};

export type GraphEdgePayloadV1 = {
  schemaVersion: '1.0.0';
  relationType?: string;
  qualifier?: string;
};

export type GraphEdgeV1 = {
  schemaVersion: '1.0.0';
  edgeId: string;
  from: GraphNodeReferenceV1;
  to: GraphNodeReferenceV1;
  relationRef?: GraphRelationReferenceV1;
  edgeSemanticKind: GraphEdgeSemanticKindV1;
  authority: GraphAuthorityClassificationV1;
  baseViewMembership: GraphBaseViewKindV1;
  overlayMemberships: readonly GraphOverlayKindV1[];
  provenance?: GraphProvenanceSummaryV1;
  evidence?: GraphEvidenceSummaryV1;
  temporalValidity?: GraphTemporalValidityV1;
  revisionBinding: GraphRevisionBindingV1;
  accessMasking: GraphAccessMaskingStateV1;
  traversalDirection?: GraphTraversalDirectionV1;
  payload?: GraphEdgePayloadV1;
};

export type GraphTraversalLimitsV1 = {
  schemaVersion: '1.0.0';
  maxDepth: number;
  maxNodes: number;
  maxEdges: number;
  traversalBudget: number;
  serverTimeoutBudgetMs: number;
};

export type GraphAppliedLimitsV1 = GraphTraversalLimitsV1 & {
  schemaVersion: '1.0.0';
  requestedMaxDepth: number | null;
  requestedMaxNodes: number | null;
  requestedMaxEdges: number | null;
  clamped: boolean;
};

export type GraphContinuationTokenV1 = {
  schemaVersion: '1.0.0';
  token: string;
  expiresAt: string;
};

export type GraphContinuationBindingV1 = {
  schemaVersion: '1.0.0';
  principalId: string;
  sessionId: string;
  projectId: string;
  accessRevision: string;
  policyContextRevision: string;
  snapshotId: string;
  rootRef?: GraphNodeReferenceV1;
  filtersDigest: string;
  viewKind: GraphBaseViewKindV1;
  overlayKinds: readonly GraphOverlayKindV1[];
  limits: GraphTraversalLimitsV1;
};

export type GraphOverlayIdentityV1 = {
  schemaVersion: '1.0.0';
  overlayKind: GraphOverlayKindV1;
  overlaySnapshotId: string;
  overlayRevision: string;
  sourceRef?:
    | { kind: 'RESOURCE'; resourceRef: GraphNodeReferenceV1 }
    | { kind: 'DRAFT_CHANGE_SET'; draftId: string; revision: number };
  analyzerRevision: string;
  policyContextRevision: string;
  generatedAt: string;
  completeness: GraphResultCompletenessV1;
  truncation?: GraphTruncationStateV1;
  unavailableReason?: GraphUnavailableReasonV1;
};

export type GraphTruncationStateV1 = {
  schemaVersion: '1.0.0';
  truncated: true;
  reason: 'MAX_DEPTH' | 'MAX_NODES' | 'MAX_EDGES' | 'TRAVERSAL_BUDGET' | 'SERVER_TIMEOUT';
  omittedNodeCount: number;
  omittedEdgeCount: number;
};

export type GraphNeighborhoodResultV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  centerRef: GraphNodeReferenceV1;
  addedNodes: readonly GraphNodeV1[];
  addedEdges: readonly GraphEdgeV1[];
  completeness: GraphResultCompletenessV1;
  appliedLimits: GraphAppliedLimitsV1;
  continuation?: GraphContinuationTokenV1;
  truncation?: GraphTruncationStateV1;
};

export type GraphPathSegmentV1 =
  | {
      schemaVersion: '1.0.0';
      kind: 'ORIGIN';
      step: 0;
      nodeRef: GraphNodeReferenceV1;
      direction: GraphTraversalDirectionV1;
    }
  | {
      schemaVersion: '1.0.0';
      kind: 'TRAVERSAL';
      step: number;
      nodeRef: GraphNodeReferenceV1;
      edgeRef: GraphEdgeReferenceV1;
      direction: GraphTraversalDirectionV1;
    };

export type GraphPathResultV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  fromRef: GraphNodeReferenceV1;
  toRef: GraphNodeReferenceV1;
  paths: readonly { pathId: string; segments: readonly GraphPathSegmentV1[] }[];
  completeness: GraphResultCompletenessV1;
  appliedLimits: GraphAppliedLimitsV1;
  truncation?: GraphTruncationStateV1;
};

export type GraphPathDescriptionSegmentV1 =
  | {
      schemaVersion: '1.0.0';
      kind: 'ORIGIN';
      step: 0;
      narration: string;
      nodeRef: GraphNodeReferenceV1;
    }
  | {
      schemaVersion: '1.0.0';
      kind: 'TRAVERSAL';
      step: number;
      narration: string;
      nodeRef: GraphNodeReferenceV1;
      edgeRef: GraphEdgeReferenceV1;
    };

export type GraphPathDescriptionV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  pathId: string;
  segments: readonly GraphPathDescriptionSegmentV1[];
  summary: string;
};

export type GraphCapabilityV1 =
  | 'SNAPSHOT'
  | 'NEIGHBORHOOD'
  | 'PATH'
  | 'PATH_DESCRIPTION'
  | 'CONFLICT_OVERLAY'
  | 'GAP_OVERLAY'
  | 'IMPACT_OVERLAY'
  | 'EVIDENCE_DETAIL'
  | 'SNAPSHOT_REFRESH'
  | 'DEEP_LINK_RESTORE';

export type GraphUnavailableReasonV1 =
  | 'PROJECTION_UNAVAILABLE'
  | 'PROJECTION_REBUILDING'
  | 'SNAPSHOT_STALE'
  | 'CONTINUATION_EXPIRED'
  | 'ACCESS_CHANGED'
  | 'PROJECT_CHANGED'
  | 'POLICY_CHANGED'
  | 'ROOT_RESOURCE_DELETED'
  | 'ROOT_RESOURCE_ARCHIVED'
  | 'OVERLAY_UNAVAILABLE'
  | 'ANALYZER_TIMEOUT'
  | 'DEEP_LINK_TARGET_UNAVAILABLE'
  | 'NETWORK_FAILURE';

export type GraphCapabilitiesViewV1 = {
  schemaVersion: '1.0.0';
  capabilities: readonly GraphCapabilityV1[];
  unavailable?: { reason: GraphUnavailableReasonV1; message: string }[];
};

export type GraphSnapshotIdentityV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectId: string;
  viewKind: GraphBaseViewKindV1;
  projectionRevision: string;
  generatedAt: string;
};

export type GraphOperationFailureV1 = {
  schemaVersion: '1.0.0';
  reason: GraphUnavailableReasonV1;
  message: string;
  retryable: boolean;
};

export type GraphFilterSetV1 = {
  schemaVersion: '1.0.0';
  nodeKindFilters?: readonly GraphResourceKindV1[];
  edgeSemanticKindFilters?: readonly GraphEdgeSemanticKindV1[];
  authorityFilters?: readonly GraphAuthorityClassificationV1[];
  temporalFilters?: GraphTemporalValidityV1;
  evidenceFilters?: { sourceId?: string; evidenceSpanId?: string };
};

export type GraphSnapshotRequestV1 = {
  schemaVersion: '1.0.0';
  rootRefs?: readonly GraphNodeReferenceV1[];
  viewKind: GraphBaseViewKindV1;
  overlayKinds: readonly GraphOverlayKindV1[];
  filters?: GraphFilterSetV1;
  limits?: GraphTraversalLimitsV1;
  expectedSnapshotRevision?: string;
};

export type GraphSnapshotResultV1 = {
  schemaVersion: '1.0.0';
  identity: GraphSnapshotIdentityV1;
  health: GraphProjectionHealthV1;
  completeness: GraphResultCompletenessV1;
  nodes: readonly GraphNodeV1[];
  edges: readonly GraphEdgeV1[];
  appliedLimits: GraphAppliedLimitsV1;
  truncation?: GraphTruncationStateV1;
  overlays: readonly GraphOverlayIdentityV1[];
  capabilities: GraphCapabilitiesViewV1;
  continuation?: GraphContinuationTokenV1;
};

export type GraphNeighborhoodRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  centerRef: GraphNodeReferenceV1;
  filters?: GraphFilterSetV1;
  limits?: GraphTraversalLimitsV1;
  continuationToken?: string;
};

export type GraphPathRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  fromRef: GraphNodeReferenceV1;
  toRef: GraphNodeReferenceV1;
  edgeSemanticKinds?: readonly GraphEdgeSemanticKindV1[];
  limits?: GraphTraversalLimitsV1;
};

export type GraphPathDescribeRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  pathId: string;
};

export type GraphConflictOverlayRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  overlayKind: 'CONFLICT';
  filters?: GraphFilterSetV1;
  limits?: GraphTraversalLimitsV1;
  expectedOverlayRevision?: string;
};

export type GraphKnowledgeGapOverlayRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  overlayKind: 'KNOWLEDGE_GAP';
  filters?: GraphFilterSetV1;
  limits?: GraphTraversalLimitsV1;
  expectedOverlayRevision?: string;
};

export type GraphRecursiveImpactOverlayRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  overlayKind: 'RECURSIVE_IMPACT';
  filters?: GraphFilterSetV1;
  limits?: GraphTraversalLimitsV1;
  expectedOverlayRevision?: string;
  continuationToken?: string;
};

export type GraphOverlayResultV1 = {
  schemaVersion: '1.0.0';
  baseSnapshotId: string;
  projectionRevision: string;
  identity: GraphOverlayIdentityV1;
  health: GraphProjectionHealthV1;
  completeness: GraphResultCompletenessV1;
  nodes: readonly GraphNodeV1[];
  edges: readonly GraphEdgeV1[];
  appliedLimits: GraphAppliedLimitsV1;
  truncation?: GraphTruncationStateV1;
  continuation?: GraphContinuationTokenV1;
};

export type GraphEvidenceTargetV1 =
  { kind: 'NODE'; nodeRef: GraphNodeReferenceV1 } | { kind: 'EDGE'; edgeRef: GraphEdgeReferenceV1 };

export type GraphEvidenceDetailRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  target: GraphEvidenceTargetV1;
  evidenceRef?: { sourceId: string; evidenceSpanId: string };
};

export type GraphEvidenceEntryV1 = {
  schemaVersion: '1.0.0';
  sourceId: string;
  sourceVersionId: string;
  evidenceSpanId: string;
  snippet: string;
};

export type GraphEvidenceDetailResultV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  targetRef: GraphNodeReferenceV1 | GraphEdgeReferenceV1;
  provenance?: GraphProvenanceSummaryV1;
  evidence: readonly GraphEvidenceEntryV1[];
  accessMasking: GraphAccessMaskingStateV1;
};

export type GraphSnapshotRefreshRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  expectedSnapshotRevision: string;
};

export type GraphRestoreRequestV1 = {
  schemaVersion: '1.0.0';
  snapshotId: string;
  projectionRevision: string;
  viewKind: GraphBaseViewKindV1;
  overlayKinds: readonly GraphOverlayKindV1[];
  selectedNodeRefs: readonly GraphNodeReferenceV1[];
  expectedSnapshotRevision?: string;
};

export type GraphRestoreResultV1 = {
  schemaVersion: '1.0.0';
  snapshot: GraphSnapshotResultV1;
  focusRefs: readonly GraphNodeReferenceV1[];
};

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

export const GRAPH_RESOURCE_KINDS: readonly GraphResourceKindV1[] = [
  'ENTITY',
  'FACT',
  'CLAIM',
  'RELATION',
  'EVENT',
  'DECISION',
  'EVIDENCE',
  'SOURCE',
  'CONFLICT',
  'KNOWLEDGE_GAP',
];

export const GRAPH_EDGE_SEMANTIC_KINDS: readonly GraphEdgeSemanticKindV1[] = [
  'CANONICAL_RELATION',
  'CANONICAL_STATEMENT_ASSOCIATION',
  'DERIVED_INFERENCE',
  'DISCOVERY_CANDIDATE',
  'POSSIBLY_SAME',
  'EVIDENCE_LINKAGE',
  'CONFLICT',
  'KNOWLEDGE_GAP',
  'TEMPORAL_RELATIONSHIP',
  'GOVERNANCE_IMPACT',
  'OPERATIONAL_DEPENDENCY',
];

export const GRAPH_AUTHORITY_CLASSIFICATIONS: readonly GraphAuthorityClassificationV1[] = [
  'CANONICAL',
  'DERIVED_INFERENCE',
  'DISCOVERY_CANDIDATE',
];

export const GRAPH_BASE_VIEW_KINDS: readonly GraphBaseViewKindV1[] = [
  'KNOWLEDGE_SEMANTIC',
  'GOVERNANCE_IMPACT',
  'OPERATIONAL_DEPENDENCY',
];

export const GRAPH_OVERLAY_KINDS: readonly GraphOverlayKindV1[] = [
  'CONFLICT',
  'KNOWLEDGE_GAP',
  'RECURSIVE_IMPACT',
];

export const GRAPH_PROJECTION_HEALTHS: readonly GraphProjectionHealthV1[] = [
  'COMPLETE',
  'PARTIAL',
  'TRUNCATED',
  'STALE',
  'REBUILDING',
  'FAILED',
  'UNAVAILABLE',
  'ACCESS_RESTRICTED',
];

export const GRAPH_RESULT_COMPLETENESS: readonly GraphResultCompletenessV1[] = [
  'COMPLETE',
  'PARTIAL',
  'TRUNCATED',
];

export const GRAPH_ACCESS_MASKING_STATES: readonly GraphAccessMaskingStateV1[] = [
  'VISIBLE',
  'MASKED',
  'HIDDEN',
];

export const GRAPH_TRAVERSAL_DIRECTIONS: readonly GraphTraversalDirectionV1[] = [
  'OUTGOING_FROM_ROOT',
  'INCOMING_TO_ROOT',
];

export const GRAPH_CAPABILITIES: readonly GraphCapabilityV1[] = [
  'SNAPSHOT',
  'NEIGHBORHOOD',
  'PATH',
  'PATH_DESCRIPTION',
  'CONFLICT_OVERLAY',
  'GAP_OVERLAY',
  'IMPACT_OVERLAY',
  'EVIDENCE_DETAIL',
  'SNAPSHOT_REFRESH',
  'DEEP_LINK_RESTORE',
];

export const GRAPH_UNAVAILABLE_REASONS: readonly GraphUnavailableReasonV1[] = [
  'PROJECTION_UNAVAILABLE',
  'PROJECTION_REBUILDING',
  'SNAPSHOT_STALE',
  'CONTINUATION_EXPIRED',
  'ACCESS_CHANGED',
  'PROJECT_CHANGED',
  'POLICY_CHANGED',
  'ROOT_RESOURCE_DELETED',
  'ROOT_RESOURCE_ARCHIVED',
  'OVERLAY_UNAVAILABLE',
  'ANALYZER_TIMEOUT',
  'DEEP_LINK_TARGET_UNAVAILABLE',
  'NETWORK_FAILURE',
];

export const decodeGraphNodeReferenceV1 = (
  value: unknown,
  path = 'nodeRef',
): GraphNodeReferenceV1 => {
  const object = strictObject(value, ['schemaVersion', 'resourceKind', 'resourceId'], path);
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const resourceKind = enumValue(
    required(object, 'resourceKind', path),
    GRAPH_RESOURCE_KINDS,
    `${path}.resourceKind`,
  );
  const resourceId = text(required(object, 'resourceId', path), `${path}.resourceId`);
  return { schemaVersion: '1.0.0', resourceKind, resourceId };
};

export const decodeGraphEdgeReferenceV1 = (
  value: unknown,
  path = 'edgeRef',
): GraphEdgeReferenceV1 => {
  const object = strictObject(value, ['schemaVersion', 'edgeId', 'from', 'to'], path);
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const edgeId = text(required(object, 'edgeId', path), `${path}.edgeId`);
  const from = decodeGraphNodeReferenceV1(required(object, 'from', path), `${path}.from`);
  const to = decodeGraphNodeReferenceV1(required(object, 'to', path), `${path}.to`);
  return { schemaVersion: '1.0.0', edgeId, from, to };
};

export const decodeGraphRelationReferenceV1 = (
  value: unknown,
  path = 'relationRef',
): GraphRelationReferenceV1 => {
  const object = strictObject(value, ['schemaVersion', 'relationId', 'qualifier'], path);
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const relationId = text(required(object, 'relationId', path), `${path}.relationId`);
  const qualifier = optionalText(object.qualifier, `${path}.qualifier`);
  return { schemaVersion: '1.0.0', relationId, qualifier };
};

export const decodeGraphProvenanceSummaryV1 = (
  value: unknown,
  path = 'provenance',
): GraphProvenanceSummaryV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'sourceProjectId', 'canonicalRevision', 'generatedBy', 'provenanceNote'],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const generatedBy = enumValue(
    required(object, 'generatedBy', path),
    ['CANONICAL', 'STAGE9_MODEL', 'COMPILED_TRUTH', 'IMPACT_ANALYZER'],
    `${path}.generatedBy`,
  );
  return {
    schemaVersion: '1.0.0',
    sourceProjectId: text(required(object, 'sourceProjectId', path), `${path}.sourceProjectId`),
    canonicalRevision: optionalText(object.canonicalRevision, `${path}.canonicalRevision`),
    generatedBy,
    provenanceNote: optionalText(object.provenanceNote, `${path}.provenanceNote`),
  };
};

export const decodeGraphEvidenceSummaryV1 = (
  value: unknown,
  path = 'evidence',
): GraphEvidenceSummaryV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'evidenceCount', 'sourceIds', 'evidenceSpanIds'],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const sourceIds = arrayValue(required(object, 'sourceIds', path), `${path}.sourceIds`).map(
    (entry) => text(entry, `${path}.sourceIds`),
  );
  const evidenceSpanIds = arrayValue(
    required(object, 'evidenceSpanIds', path),
    `${path}.evidenceSpanIds`,
  ).map((entry) => text(entry, `${path}.evidenceSpanIds`));
  return {
    schemaVersion: '1.0.0',
    evidenceCount: integer(required(object, 'evidenceCount', path), `${path}.evidenceCount`),
    sourceIds,
    evidenceSpanIds,
  };
};

export const decodeGraphTemporalValidityV1 = (
  value: unknown,
  path = 'temporalValidity',
): GraphTemporalValidityV1 => {
  const object = strictObject(value, ['schemaVersion', 'validFrom', 'validTo', 'status'], path);
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const status = enumValue(
    required(object, 'status', path),
    ['KNOWN', 'OPEN', 'UNKNOWN'],
    `${path}.status`,
  );
  return {
    schemaVersion: '1.0.0',
    validFrom:
      object.validFrom === undefined
        ? undefined
        : isoTimestamp(object.validFrom, `${path}.validFrom`),
    validTo:
      object.validTo === undefined ? undefined : isoTimestamp(object.validTo, `${path}.validTo`),
    status,
  };
};

export const decodeGraphRevisionBindingV1 = (
  value: unknown,
  path = 'revisionBinding',
): GraphRevisionBindingV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'projectionRevision', 'policyContextRevision', 'accessRevision'],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return {
    schemaVersion: '1.0.0',
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    accessRevision: text(required(object, 'accessRevision', path), `${path}.accessRevision`),
  };
};

export const decodeGraphFilterSetV1 = (value: unknown, path = 'filters'): GraphFilterSetV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'nodeKindFilters',
      'edgeSemanticKindFilters',
      'authorityFilters',
      'temporalFilters',
      'evidenceFilters',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const evidenceFilters =
    object.evidenceFilters === undefined
      ? undefined
      : (() => {
          const eo = strictObject(
            object.evidenceFilters,
            ['sourceId', 'evidenceSpanId'],
            `${path}.evidenceFilters`,
          );
          return {
            sourceId: optionalText(eo.sourceId, `${path}.evidenceFilters.sourceId`),
            evidenceSpanId: optionalText(
              eo.evidenceSpanId,
              `${path}.evidenceFilters.evidenceSpanId`,
            ),
          };
        })();
  return {
    schemaVersion: '1.0.0',
    nodeKindFilters:
      object.nodeKindFilters === undefined
        ? undefined
        : arrayValue(object.nodeKindFilters, `${path}.nodeKindFilters`).map((entry) =>
            enumValue(entry, GRAPH_RESOURCE_KINDS, `${path}.nodeKindFilters`),
          ),
    edgeSemanticKindFilters:
      object.edgeSemanticKindFilters === undefined
        ? undefined
        : arrayValue(object.edgeSemanticKindFilters, `${path}.edgeSemanticKindFilters`).map(
            (entry) =>
              enumValue(entry, GRAPH_EDGE_SEMANTIC_KINDS, `${path}.edgeSemanticKindFilters`),
          ),
    authorityFilters:
      object.authorityFilters === undefined
        ? undefined
        : arrayValue(object.authorityFilters, `${path}.authorityFilters`).map((entry) =>
            enumValue(entry, GRAPH_AUTHORITY_CLASSIFICATIONS, `${path}.authorityFilters`),
          ),
    temporalFilters:
      object.temporalFilters === undefined
        ? undefined
        : decodeGraphTemporalValidityV1(object.temporalFilters, `${path}.temporalFilters`),
    evidenceFilters,
  };
};

export const decodeGraphTraversalLimitsV1 = (
  value: unknown,
  path = 'limits',
): GraphTraversalLimitsV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'maxDepth',
      'maxNodes',
      'maxEdges',
      'traversalBudget',
      'serverTimeoutBudgetMs',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return decodeTraversalBaseFields(object, path);
};

const decodeTraversalBaseFields = (object: ObjectValue, path: string): GraphTraversalLimitsV1 => {
  const maxDepth = integer(required(object, 'maxDepth', path), `${path}.maxDepth`);
  if (maxDepth < 1 || maxDepth > 10) return fail(`${path}.maxDepth`, 'must be an integer in 1..10');
  const maxNodes = integer(required(object, 'maxNodes', path), `${path}.maxNodes`);
  if (maxNodes < 1 || maxNodes > 500)
    return fail(`${path}.maxNodes`, 'must be an integer in 1..500');
  const maxEdges = integer(required(object, 'maxEdges', path), `${path}.maxEdges`);
  if (maxEdges < 1 || maxEdges > 1000)
    return fail(`${path}.maxEdges`, 'must be an integer in 1..1000');
  const traversalBudget = integer(
    required(object, 'traversalBudget', path),
    `${path}.traversalBudget`,
  );
  const serverTimeoutBudgetMs = integer(
    required(object, 'serverTimeoutBudgetMs', path),
    `${path}.serverTimeoutBudgetMs`,
  );
  if (serverTimeoutBudgetMs < 1000 || serverTimeoutBudgetMs > 30000) {
    return fail(`${path}.serverTimeoutBudgetMs`, 'must be an integer in 1000..30000');
  }
  return {
    schemaVersion: '1.0.0',
    maxDepth,
    maxNodes,
    maxEdges,
    traversalBudget,
    serverTimeoutBudgetMs,
  };
};

export const decodeGraphAppliedLimitsV1 = (
  value: unknown,
  path = 'appliedLimits',
): GraphAppliedLimitsV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'maxDepth',
      'maxNodes',
      'maxEdges',
      'traversalBudget',
      'serverTimeoutBudgetMs',
      'requestedMaxDepth',
      'requestedMaxNodes',
      'requestedMaxEdges',
      'clamped',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const base = decodeTraversalBaseFields(object, path);
  const nullableInt = (entry: unknown, key: string): number | null => {
    if (entry === null) return null;
    return integer(entry, `${path}.${key}`);
  };
  return {
    ...base,
    schemaVersion: '1.0.0',
    requestedMaxDepth: nullableInt(object.requestedMaxDepth, 'requestedMaxDepth'),
    requestedMaxNodes: nullableInt(object.requestedMaxNodes, 'requestedMaxNodes'),
    requestedMaxEdges: nullableInt(object.requestedMaxEdges, 'requestedMaxEdges'),
    clamped: booleanValue(required(object, 'clamped', path), `${path}.clamped`),
  };
};

export const decodeGraphTruncationStateV1 = (
  value: unknown,
  path = 'truncation',
): GraphTruncationStateV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'truncated', 'reason', 'omittedNodeCount', 'omittedEdgeCount'],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const truncated = booleanValue(required(object, 'truncated', path), `${path}.truncated`);
  if (truncated !== true) return fail(`${path}.truncated`, 'must be true');
  const reason = enumValue(
    required(object, 'reason', path),
    ['MAX_DEPTH', 'MAX_NODES', 'MAX_EDGES', 'TRAVERSAL_BUDGET', 'SERVER_TIMEOUT'],
    `${path}.reason`,
  );
  return {
    schemaVersion: '1.0.0',
    truncated: true,
    reason,
    omittedNodeCount: integer(
      required(object, 'omittedNodeCount', path),
      `${path}.omittedNodeCount`,
    ),
    omittedEdgeCount: integer(
      required(object, 'omittedEdgeCount', path),
      `${path}.omittedEdgeCount`,
    ),
  };
};

export const decodeGraphContinuationTokenV1 = (
  value: unknown,
  path = 'continuation',
): GraphContinuationTokenV1 => {
  const object = strictObject(value, ['schemaVersion', 'token', 'expiresAt'], path);
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return {
    schemaVersion: '1.0.0',
    token: text(required(object, 'token', path), `${path}.token`),
    expiresAt: isoTimestamp(required(object, 'expiresAt', path), `${path}.expiresAt`),
  };
};

export const decodeGraphOverlayIdentityV1 = (
  value: unknown,
  path = 'identity',
): GraphOverlayIdentityV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'overlayKind',
      'overlaySnapshotId',
      'overlayRevision',
      'sourceRef',
      'analyzerRevision',
      'policyContextRevision',
      'generatedAt',
      'completeness',
      'truncation',
      'unavailableReason',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const sourceRef =
    object.sourceRef === undefined
      ? undefined
      : (() => {
          const so = asObject(object.sourceRef, `${path}.sourceRef`);
          const kind = enumValue(
            required(so, 'kind', `${path}.sourceRef`),
            ['RESOURCE', 'DRAFT_CHANGE_SET'],
            `${path}.sourceRef.kind`,
          );
          if (kind === 'RESOURCE') {
            const ro = strictObject(so, ['kind', 'resourceRef'], `${path}.sourceRef`);
            return {
              kind: 'RESOURCE' as const,
              resourceRef: decodeGraphNodeReferenceV1(
                required(ro, 'resourceRef', `${path}.sourceRef`),
                `${path}.sourceRef.resourceRef`,
              ),
            };
          }
          const ro = strictObject(so, ['kind', 'draftId', 'revision'], `${path}.sourceRef`);
          return {
            kind: 'DRAFT_CHANGE_SET' as const,
            draftId: text(
              required(ro, 'draftId', `${path}.sourceRef`),
              `${path}.sourceRef.draftId`,
            ),
            revision: integer(
              required(ro, 'revision', `${path}.sourceRef`),
              `${path}.sourceRef.revision`,
            ),
          };
        })();
  const completeness = enumValue(
    required(object, 'completeness', path),
    GRAPH_RESULT_COMPLETENESS,
    `${path}.completeness`,
  );
  const truncation =
    object.truncation === undefined
      ? undefined
      : decodeGraphTruncationStateV1(object.truncation, `${path}.truncation`);
  if (completeness === 'TRUNCATED' && truncation === undefined) {
    return fail(`${path}.completeness`, 'TRUNCATED requires truncation');
  }
  if (completeness !== 'TRUNCATED' && truncation !== undefined) {
    return fail(`${path}.truncation`, 'must be absent unless completeness is TRUNCATED');
  }
  return {
    schemaVersion: '1.0.0',
    overlayKind: enumValue(
      required(object, 'overlayKind', path),
      GRAPH_OVERLAY_KINDS,
      `${path}.overlayKind`,
    ),
    overlaySnapshotId: text(
      required(object, 'overlaySnapshotId', path),
      `${path}.overlaySnapshotId`,
    ),
    overlayRevision: text(required(object, 'overlayRevision', path), `${path}.overlayRevision`),
    sourceRef,
    analyzerRevision: text(required(object, 'analyzerRevision', path), `${path}.analyzerRevision`),
    policyContextRevision: text(
      required(object, 'policyContextRevision', path),
      `${path}.policyContextRevision`,
    ),
    generatedAt: isoTimestamp(required(object, 'generatedAt', path), `${path}.generatedAt`),
    completeness,
    truncation,
    unavailableReason:
      object.unavailableReason === undefined
        ? undefined
        : enumValue(
            object.unavailableReason,
            GRAPH_UNAVAILABLE_REASONS,
            `${path}.unavailableReason`,
          ),
  };
};

export const decodeGraphNodeV1 = (value: unknown, path = 'node'): GraphNodeV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'nodeId',
      'resourceRef',
      'label',
      'nodeKind',
      'authority',
      'baseViewMembership',
      'overlayMemberships',
      'provenance',
      'evidence',
      'temporalValidity',
      'revisionBinding',
      'accessMasking',
      'payload',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const nodeId = text(required(object, 'nodeId', path), `${path}.nodeId`);
  const resourceRef = decodeGraphNodeReferenceV1(
    required(object, 'resourceRef', path),
    `${path}.resourceRef`,
  );
  const nodeKind = enumValue(
    required(object, 'nodeKind', path),
    GRAPH_RESOURCE_KINDS,
    `${path}.nodeKind`,
  );
  if (nodeKind !== resourceRef.resourceKind) {
    return fail(
      `${path}.nodeKind`,
      `must match resourceRef.resourceKind (${resourceRef.resourceKind})`,
    );
  }
  const accessMasking = enumValue(
    required(object, 'accessMasking', path),
    GRAPH_ACCESS_MASKING_STATES,
    `${path}.accessMasking`,
  );
  if (accessMasking === 'HIDDEN')
    return fail(`${path}.accessMasking`, 'HIDDEN items never appear in a response');
  const label = text(required(object, 'label', path), `${path}.label`);
  const payload =
    object.payload === undefined
      ? undefined
      : (asObject(object.payload, `${path}.payload`) as GraphNodePayloadV1);
  if (accessMasking === 'VISIBLE' && payload === undefined) {
    return fail(`${path}.payload`, 'required when accessMasking is VISIBLE');
  }
  if (accessMasking === 'MASKED') {
    if (payload !== undefined)
      return fail(`${path}.payload`, 'forbidden when accessMasking is MASKED');
    if (object.provenance !== undefined)
      return fail(`${path}.provenance`, 'forbidden when accessMasking is MASKED');
    if (object.evidence !== undefined)
      return fail(`${path}.evidence`, 'forbidden when accessMasking is MASKED');
    if (object.temporalValidity !== undefined) {
      return fail(`${path}.temporalValidity`, 'forbidden when accessMasking is MASKED');
    }
  }
  return {
    schemaVersion: '1.0.0',
    nodeId,
    resourceRef,
    label,
    nodeKind,
    authority: enumValue(
      required(object, 'authority', path),
      GRAPH_AUTHORITY_CLASSIFICATIONS,
      `${path}.authority`,
    ),
    baseViewMembership: enumValue(
      required(object, 'baseViewMembership', path),
      GRAPH_BASE_VIEW_KINDS,
      `${path}.baseViewMembership`,
    ),
    overlayMemberships: arrayValue(
      required(object, 'overlayMemberships', path),
      `${path}.overlayMemberships`,
    ).map((entry) => enumValue(entry, GRAPH_OVERLAY_KINDS, `${path}.overlayMemberships`)),
    provenance:
      object.provenance === undefined
        ? undefined
        : decodeGraphProvenanceSummaryV1(object.provenance, `${path}.provenance`),
    evidence:
      object.evidence === undefined
        ? undefined
        : decodeGraphEvidenceSummaryV1(object.evidence, `${path}.evidence`),
    temporalValidity:
      object.temporalValidity === undefined
        ? undefined
        : decodeGraphTemporalValidityV1(object.temporalValidity, `${path}.temporalValidity`),
    revisionBinding: decodeGraphRevisionBindingV1(
      required(object, 'revisionBinding', path),
      `${path}.revisionBinding`,
    ),
    accessMasking,
    payload: payload as GraphNodePayloadV1 | undefined,
  };
};

export const decodeGraphEdgeV1 = (value: unknown, path = 'edge'): GraphEdgeV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'edgeId',
      'from',
      'to',
      'relationRef',
      'edgeSemanticKind',
      'authority',
      'baseViewMembership',
      'overlayMemberships',
      'provenance',
      'evidence',
      'temporalValidity',
      'revisionBinding',
      'accessMasking',
      'traversalDirection',
      'payload',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const edgeId = text(required(object, 'edgeId', path), `${path}.edgeId`);
  const from = decodeGraphNodeReferenceV1(required(object, 'from', path), `${path}.from`);
  const to = decodeGraphNodeReferenceV1(required(object, 'to', path), `${path}.to`);
  const accessMasking = enumValue(
    required(object, 'accessMasking', path),
    GRAPH_ACCESS_MASKING_STATES,
    `${path}.accessMasking`,
  );
  if (accessMasking === 'HIDDEN')
    return fail(`${path}.accessMasking`, 'HIDDEN items never appear in a response');
  if (accessMasking === 'MASKED') {
    if (object.payload !== undefined)
      return fail(`${path}.payload`, 'forbidden when accessMasking is MASKED');
    if (object.provenance !== undefined)
      return fail(`${path}.provenance`, 'forbidden when accessMasking is MASKED');
    if (object.evidence !== undefined)
      return fail(`${path}.evidence`, 'forbidden when accessMasking is MASKED');
    if (object.temporalValidity !== undefined) {
      return fail(`${path}.temporalValidity`, 'forbidden when accessMasking is MASKED');
    }
  }
  return {
    schemaVersion: '1.0.0',
    edgeId,
    from,
    to,
    relationRef:
      object.relationRef === undefined
        ? undefined
        : decodeGraphRelationReferenceV1(object.relationRef, `${path}.relationRef`),
    edgeSemanticKind: enumValue(
      required(object, 'edgeSemanticKind', path),
      GRAPH_EDGE_SEMANTIC_KINDS,
      `${path}.edgeSemanticKind`,
    ),
    authority: enumValue(
      required(object, 'authority', path),
      GRAPH_AUTHORITY_CLASSIFICATIONS,
      `${path}.authority`,
    ),
    baseViewMembership: enumValue(
      required(object, 'baseViewMembership', path),
      GRAPH_BASE_VIEW_KINDS,
      `${path}.baseViewMembership`,
    ),
    overlayMemberships: arrayValue(
      required(object, 'overlayMemberships', path),
      `${path}.overlayMemberships`,
    ).map((entry) => enumValue(entry, GRAPH_OVERLAY_KINDS, `${path}.overlayMemberships`)),
    provenance:
      object.provenance === undefined
        ? undefined
        : decodeGraphProvenanceSummaryV1(object.provenance, `${path}.provenance`),
    evidence:
      object.evidence === undefined
        ? undefined
        : decodeGraphEvidenceSummaryV1(object.evidence, `${path}.evidence`),
    temporalValidity:
      object.temporalValidity === undefined
        ? undefined
        : decodeGraphTemporalValidityV1(object.temporalValidity, `${path}.temporalValidity`),
    revisionBinding: decodeGraphRevisionBindingV1(
      required(object, 'revisionBinding', path),
      `${path}.revisionBinding`,
    ),
    accessMasking,
    traversalDirection:
      object.traversalDirection === undefined
        ? undefined
        : enumValue(
            object.traversalDirection,
            GRAPH_TRAVERSAL_DIRECTIONS,
            `${path}.traversalDirection`,
          ),
    payload:
      object.payload === undefined
        ? undefined
        : (() => {
            const po = strictObject(
              object.payload,
              ['schemaVersion', 'relationType', 'qualifier'],
              `${path}.payload`,
            );
            const ps = text(
              required(po, 'schemaVersion', `${path}.payload`),
              `${path}.payload.schemaVersion`,
            );
            if (ps !== '1.0.0') return fail(`${path}.payload.schemaVersion`, 'must be 1.0.0');
            return {
              schemaVersion: '1.0.0' as const,
              relationType: optionalText(po.relationType, `${path}.payload.relationType`),
              qualifier: optionalText(po.qualifier, `${path}.payload.qualifier`),
            };
          })(),
  };
};

export const decodeGraphSnapshotIdentityV1 = (
  value: unknown,
  path = 'identity',
): GraphSnapshotIdentityV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'snapshotId', 'projectId', 'viewKind', 'projectionRevision', 'generatedAt'],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    projectId: text(required(object, 'projectId', path), `${path}.projectId`),
    viewKind: enumValue(
      required(object, 'viewKind', path),
      GRAPH_BASE_VIEW_KINDS,
      `${path}.viewKind`,
    ),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    generatedAt: isoTimestamp(required(object, 'generatedAt', path), `${path}.generatedAt`),
  };
};

export const decodeGraphCapabilitiesViewV1 = (
  value: unknown,
  path = 'capabilities',
): GraphCapabilitiesViewV1 => {
  const object = strictObject(value, ['schemaVersion', 'capabilities', 'unavailable'], path);
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return {
    schemaVersion: '1.0.0',
    capabilities: arrayValue(required(object, 'capabilities', path), `${path}.capabilities`).map(
      (entry) => enumValue(entry, GRAPH_CAPABILITIES, `${path}.capabilities`),
    ),
    unavailable:
      object.unavailable === undefined
        ? undefined
        : arrayValue(object.unavailable, `${path}.unavailable`).map((entry) => {
            const uo = strictObject(entry, ['reason', 'message'], `${path}.unavailable`);
            return {
              reason: enumValue(
                required(uo, 'reason', `${path}.unavailable`),
                GRAPH_UNAVAILABLE_REASONS,
                `${path}.unavailable.reason`,
              ),
              message: text(
                required(uo, 'message', `${path}.unavailable`),
                `${path}.unavailable.message`,
              ),
            };
          }),
  };
};

const decodeTruncationOptional = (
  object: ObjectValue,
  completeness: GraphResultCompletenessV1,
  path: string,
): GraphTruncationStateV1 | undefined => {
  const truncation =
    object.truncation === undefined
      ? undefined
      : decodeGraphTruncationStateV1(object.truncation, `${path}.truncation`);
  if (completeness === 'TRUNCATED' && truncation === undefined) {
    return fail(`${path}.completeness`, 'TRUNCATED requires truncation');
  }
  if (completeness !== 'TRUNCATED' && truncation !== undefined) {
    return fail(`${path}.truncation`, 'must be absent unless completeness is TRUNCATED');
  }
  return truncation;
};

export const decodeGraphSnapshotResultV1 = (
  value: unknown,
  path = 'result',
): GraphSnapshotResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'identity',
      'health',
      'completeness',
      'nodes',
      'edges',
      'appliedLimits',
      'truncation',
      'overlays',
      'capabilities',
      'continuation',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const completeness = enumValue(
    required(object, 'completeness', path),
    GRAPH_RESULT_COMPLETENESS,
    `${path}.completeness`,
  );
  const truncation = decodeTruncationOptional(object, completeness, path);
  return {
    schemaVersion: '1.0.0',
    identity: decodeGraphSnapshotIdentityV1(required(object, 'identity', path), `${path}.identity`),
    health: enumValue(required(object, 'health', path), GRAPH_PROJECTION_HEALTHS, `${path}.health`),
    completeness,
    nodes: arrayValue(required(object, 'nodes', path), `${path}.nodes`).map((entry) =>
      decodeGraphNodeV1(entry, `${path}.nodes`),
    ),
    edges: arrayValue(required(object, 'edges', path), `${path}.edges`).map((entry) =>
      decodeGraphEdgeV1(entry, `${path}.edges`),
    ),
    appliedLimits: decodeGraphAppliedLimitsV1(
      required(object, 'appliedLimits', path),
      `${path}.appliedLimits`,
    ),
    truncation,
    overlays: arrayValue(required(object, 'overlays', path), `${path}.overlays`).map((entry) =>
      decodeGraphOverlayIdentityV1(entry, `${path}.overlays`),
    ),
    capabilities: decodeGraphCapabilitiesViewV1(
      required(object, 'capabilities', path),
      `${path}.capabilities`,
    ),
    continuation:
      object.continuation === undefined
        ? undefined
        : decodeGraphContinuationTokenV1(object.continuation, `${path}.continuation`),
  };
};

export const decodeGraphNeighborhoodResultV1 = (
  value: unknown,
  path = 'result',
): GraphNeighborhoodResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'snapshotId',
      'projectionRevision',
      'centerRef',
      'addedNodes',
      'addedEdges',
      'completeness',
      'appliedLimits',
      'continuation',
      'truncation',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const completeness = enumValue(
    required(object, 'completeness', path),
    GRAPH_RESULT_COMPLETENESS,
    `${path}.completeness`,
  );
  const truncation = decodeTruncationOptional(object, completeness, path);
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    centerRef: decodeGraphNodeReferenceV1(required(object, 'centerRef', path), `${path}.centerRef`),
    addedNodes: arrayValue(required(object, 'addedNodes', path), `${path}.addedNodes`).map(
      (entry) => decodeGraphNodeV1(entry, `${path}.addedNodes`),
    ),
    addedEdges: arrayValue(required(object, 'addedEdges', path), `${path}.addedEdges`).map(
      (entry) => decodeGraphEdgeV1(entry, `${path}.addedEdges`),
    ),
    completeness,
    appliedLimits: decodeGraphAppliedLimitsV1(
      required(object, 'appliedLimits', path),
      `${path}.appliedLimits`,
    ),
    continuation:
      object.continuation === undefined
        ? undefined
        : decodeGraphContinuationTokenV1(object.continuation, `${path}.continuation`),
    truncation,
  };
};

export const decodeGraphPathSegmentV1 = (value: unknown, path = 'segments'): GraphPathSegmentV1 => {
  const object = asObject(value, path);
  const kind = enumValue(required(object, 'kind', path), ['ORIGIN', 'TRAVERSAL'], `${path}.kind`);
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const step = integer(required(object, 'step', path), `${path}.step`);
  const nodeRef = decodeGraphNodeReferenceV1(required(object, 'nodeRef', path), `${path}.nodeRef`);
  if (kind === 'ORIGIN') {
    const so = strictObject(
      object,
      ['schemaVersion', 'kind', 'step', 'nodeRef', 'direction'],
      path,
    );
    if (step !== 0) return fail(`${path}.step`, 'ORIGIN step must be 0');
    return {
      schemaVersion: '1.0.0',
      kind: 'ORIGIN',
      step: 0,
      nodeRef,
      direction: enumValue(
        required(so, 'direction', path),
        GRAPH_TRAVERSAL_DIRECTIONS,
        `${path}.direction`,
      ),
    };
  }
  const so = strictObject(
    object,
    ['schemaVersion', 'kind', 'step', 'nodeRef', 'edgeRef', 'direction'],
    path,
  );
  if (step < 1) return fail(`${path}.step`, 'TRAVERSAL step must be >= 1');
  return {
    schemaVersion: '1.0.0',
    kind: 'TRAVERSAL',
    step,
    nodeRef,
    edgeRef: decodeGraphEdgeReferenceV1(required(so, 'edgeRef', path), `${path}.edgeRef`),
    direction: enumValue(
      required(so, 'direction', path),
      GRAPH_TRAVERSAL_DIRECTIONS,
      `${path}.direction`,
    ),
  };
};

export const decodeGraphPathResultV1 = (value: unknown, path = 'result'): GraphPathResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'snapshotId',
      'projectionRevision',
      'fromRef',
      'toRef',
      'paths',
      'completeness',
      'appliedLimits',
      'truncation',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const completeness = enumValue(
    required(object, 'completeness', path),
    GRAPH_RESULT_COMPLETENESS,
    `${path}.completeness`,
  );
  const truncation = decodeTruncationOptional(object, completeness, path);
  const paths = arrayValue(required(object, 'paths', path), `${path}.paths`).map((entry) => {
    const po = strictObject(entry, ['pathId', 'segments'], `${path}.paths`);
    return {
      pathId: text(required(po, 'pathId', `${path}.paths`), `${path}.paths.pathId`),
      segments: arrayValue(required(po, 'segments', `${path}.paths`), `${path}.paths.segments`).map(
        (segment) => decodeGraphPathSegmentV1(segment, `${path}.paths.segments`),
      ),
    };
  });
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    fromRef: decodeGraphNodeReferenceV1(required(object, 'fromRef', path), `${path}.fromRef`),
    toRef: decodeGraphNodeReferenceV1(required(object, 'toRef', path), `${path}.toRef`),
    paths,
    completeness,
    appliedLimits: decodeGraphAppliedLimitsV1(
      required(object, 'appliedLimits', path),
      `${path}.appliedLimits`,
    ),
    truncation,
  };
};

export const decodeGraphPathDescriptionSegmentV1 = (
  value: unknown,
  path = 'segments',
): GraphPathDescriptionSegmentV1 => {
  const object = asObject(value, path);
  const kind = enumValue(required(object, 'kind', path), ['ORIGIN', 'TRAVERSAL'], `${path}.kind`);
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const step = integer(required(object, 'step', path), `${path}.step`);
  const narration = text(required(object, 'narration', path), `${path}.narration`);
  const nodeRef = decodeGraphNodeReferenceV1(required(object, 'nodeRef', path), `${path}.nodeRef`);
  if (kind === 'ORIGIN') {
    const so = strictObject(
      object,
      ['schemaVersion', 'kind', 'step', 'narration', 'nodeRef'],
      path,
    );
    if (step !== 0) return fail(`${path}.step`, 'ORIGIN step must be 0');
    return { schemaVersion: '1.0.0', kind: 'ORIGIN', step: 0, narration, nodeRef };
  }
  const so = strictObject(
    object,
    ['schemaVersion', 'kind', 'step', 'narration', 'nodeRef', 'edgeRef'],
    path,
  );
  if (step < 1) return fail(`${path}.step`, 'TRAVERSAL step must be >= 1');
  return {
    schemaVersion: '1.0.0',
    kind: 'TRAVERSAL',
    step,
    narration,
    nodeRef,
    edgeRef: decodeGraphEdgeReferenceV1(required(so, 'edgeRef', path), `${path}.edgeRef`),
  };
};

export const decodeGraphPathDescriptionV1 = (
  value: unknown,
  path = 'result',
): GraphPathDescriptionV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'snapshotId', 'projectionRevision', 'pathId', 'segments', 'summary'],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    pathId: text(required(object, 'pathId', path), `${path}.pathId`),
    segments: arrayValue(required(object, 'segments', path), `${path}.segments`).map((entry) =>
      decodeGraphPathDescriptionSegmentV1(entry, `${path}.segments`),
    ),
    summary: text(required(object, 'summary', path), `${path}.summary`),
  };
};

export const decodeGraphOverlayResultV1 = (
  value: unknown,
  path = 'result',
): GraphOverlayResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'baseSnapshotId',
      'projectionRevision',
      'identity',
      'health',
      'completeness',
      'nodes',
      'edges',
      'appliedLimits',
      'truncation',
      'continuation',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const completeness = enumValue(
    required(object, 'completeness', path),
    GRAPH_RESULT_COMPLETENESS,
    `${path}.completeness`,
  );
  const truncation = decodeTruncationOptional(object, completeness, path);
  const identity = decodeGraphOverlayIdentityV1(
    required(object, 'identity', path),
    `${path}.identity`,
  );
  const continuation =
    object.continuation === undefined
      ? undefined
      : decodeGraphContinuationTokenV1(object.continuation, `${path}.continuation`);
  if (continuation !== undefined && identity.overlayKind !== 'RECURSIVE_IMPACT') {
    return fail(`${path}.continuation`, 'only RECURSIVE_IMPACT overlays may issue continuation');
  }
  return {
    schemaVersion: '1.0.0',
    baseSnapshotId: text(required(object, 'baseSnapshotId', path), `${path}.baseSnapshotId`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    identity,
    health: enumValue(required(object, 'health', path), GRAPH_PROJECTION_HEALTHS, `${path}.health`),
    completeness,
    nodes: arrayValue(required(object, 'nodes', path), `${path}.nodes`).map((entry) =>
      decodeGraphNodeV1(entry, `${path}.nodes`),
    ),
    edges: arrayValue(required(object, 'edges', path), `${path}.edges`).map((entry) =>
      decodeGraphEdgeV1(entry, `${path}.edges`),
    ),
    appliedLimits: decodeGraphAppliedLimitsV1(
      required(object, 'appliedLimits', path),
      `${path}.appliedLimits`,
    ),
    truncation,
    continuation,
  };
};

export const decodeGraphEvidenceDetailResultV1 = (
  value: unknown,
  path = 'result',
): GraphEvidenceDetailResultV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'snapshotId',
      'projectionRevision',
      'targetRef',
      'provenance',
      'evidence',
      'accessMasking',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const targetRef = asObject(required(object, 'targetRef', path), `${path}.targetRef`);
  const decodedTargetRef =
    'edgeId' in targetRef
      ? decodeGraphEdgeReferenceV1(targetRef, `${path}.targetRef`)
      : decodeGraphNodeReferenceV1(targetRef, `${path}.targetRef`);
  const accessMasking = enumValue(
    required(object, 'accessMasking', path),
    GRAPH_ACCESS_MASKING_STATES,
    `${path}.accessMasking`,
  );
  const evidence = arrayValue(required(object, 'evidence', path), `${path}.evidence`).map(
    (entry) => {
      const eo = strictObject(
        entry,
        ['schemaVersion', 'sourceId', 'sourceVersionId', 'evidenceSpanId', 'snippet'],
        `${path}.evidence`,
      );
      const es = text(
        required(eo, 'schemaVersion', `${path}.evidence`),
        `${path}.evidence.schemaVersion`,
      );
      if (es !== '1.0.0') return fail(`${path}.evidence.schemaVersion`, 'must be 1.0.0');
      return {
        schemaVersion: '1.0.0' as const,
        sourceId: text(required(eo, 'sourceId', `${path}.evidence`), `${path}.evidence.sourceId`),
        sourceVersionId: text(
          required(eo, 'sourceVersionId', `${path}.evidence`),
          `${path}.evidence.sourceVersionId`,
        ),
        evidenceSpanId: text(
          required(eo, 'evidenceSpanId', `${path}.evidence`),
          `${path}.evidence.evidenceSpanId`,
        ),
        snippet: text(required(eo, 'snippet', `${path}.evidence`), `${path}.evidence.snippet`),
      };
    },
  );
  if (accessMasking === 'MASKED' && evidence.length > 0) {
    return fail(`${path}.evidence`, 'MASKED targets return no evidence entries');
  }
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    targetRef: decodedTargetRef,
    provenance:
      object.provenance === undefined
        ? undefined
        : decodeGraphProvenanceSummaryV1(object.provenance, `${path}.provenance`),
    evidence,
    accessMasking,
  };
};

export const decodeGraphRestoreResultV1 = (
  value: unknown,
  path = 'result',
): GraphRestoreResultV1 => {
  const object = strictObject(value, ['schemaVersion', 'snapshot', 'focusRefs'], path);
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return {
    schemaVersion: '1.0.0',
    snapshot: decodeGraphSnapshotResultV1(required(object, 'snapshot', path), `${path}.snapshot`),
    focusRefs: arrayValue(required(object, 'focusRefs', path), `${path}.focusRefs`).map((entry) =>
      decodeGraphNodeReferenceV1(entry, `${path}.focusRefs`),
    ),
  };
};

// Request decoders (each enforces its exact shape and continuation union)

export const decodeGraphSnapshotRequestV1 = (
  value: unknown,
  path = 'request',
): GraphSnapshotRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'rootRefs',
      'viewKind',
      'overlayKinds',
      'filters',
      'limits',
      'expectedSnapshotRevision',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const viewKind = enumValue(
    required(object, 'viewKind', path),
    GRAPH_BASE_VIEW_KINDS,
    `${path}.viewKind`,
  );
  const overlayKinds = arrayValue(
    required(object, 'overlayKinds', path),
    `${path}.overlayKinds`,
  ).map((entry) => enumValue(entry, GRAPH_OVERLAY_KINDS, `${path}.overlayKinds`));
  if (new Set(overlayKinds).size !== overlayKinds.length) {
    return fail(`${path}.overlayKinds`, 'each overlay kind may appear at most once');
  }
  return {
    schemaVersion: '1.0.0',
    rootRefs:
      object.rootRefs === undefined
        ? undefined
        : arrayValue(object.rootRefs, `${path}.rootRefs`).map((entry) =>
            decodeGraphNodeReferenceV1(entry, `${path}.rootRefs`),
          ),
    viewKind,
    overlayKinds,
    filters:
      object.filters === undefined
        ? undefined
        : decodeGraphFilterSetV1(object.filters, `${path}.filters`),
    limits:
      object.limits === undefined
        ? undefined
        : decodeGraphTraversalLimitsV1(object.limits, `${path}.limits`),
    expectedSnapshotRevision: optionalText(
      object.expectedSnapshotRevision,
      `${path}.expectedSnapshotRevision`,
    ),
  };
};

export const decodeGraphNeighborhoodRequestV1 = (
  value: unknown,
  path = 'request',
): GraphNeighborhoodRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'snapshotId',
      'projectionRevision',
      'centerRef',
      'filters',
      'limits',
      'continuationToken',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    centerRef: decodeGraphNodeReferenceV1(required(object, 'centerRef', path), `${path}.centerRef`),
    filters:
      object.filters === undefined
        ? undefined
        : decodeGraphFilterSetV1(object.filters, `${path}.filters`),
    limits:
      object.limits === undefined
        ? undefined
        : decodeGraphTraversalLimitsV1(object.limits, `${path}.limits`),
    continuationToken: optionalText(object.continuationToken, `${path}.continuationToken`),
  };
};

export const decodeGraphPathRequestV1 = (value: unknown, path = 'request'): GraphPathRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'snapshotId',
      'projectionRevision',
      'fromRef',
      'toRef',
      'edgeSemanticKinds',
      'limits',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    fromRef: decodeGraphNodeReferenceV1(required(object, 'fromRef', path), `${path}.fromRef`),
    toRef: decodeGraphNodeReferenceV1(required(object, 'toRef', path), `${path}.toRef`),
    edgeSemanticKinds:
      object.edgeSemanticKinds === undefined
        ? undefined
        : arrayValue(object.edgeSemanticKinds, `${path}.edgeSemanticKinds`).map((entry) =>
            enumValue(entry, GRAPH_EDGE_SEMANTIC_KINDS, `${path}.edgeSemanticKinds`),
          ),
    limits:
      object.limits === undefined
        ? undefined
        : decodeGraphTraversalLimitsV1(object.limits, `${path}.limits`),
  };
};

export const decodeGraphPathDescribeRequestV1 = (
  value: unknown,
  path = 'request',
): GraphPathDescribeRequestV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'snapshotId', 'projectionRevision', 'pathId'],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    pathId: text(required(object, 'pathId', path), `${path}.pathId`),
  };
};

const decodeOverlayCommon = (
  object: ObjectValue,
  path: string,
): {
  snapshotId: string;
  projectionRevision: string;
  filters?: GraphFilterSetV1;
  limits?: GraphTraversalLimitsV1;
  expectedOverlayRevision?: string;
} => ({
  snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
  projectionRevision: text(
    required(object, 'projectionRevision', path),
    `${path}.projectionRevision`,
  ),
  filters:
    object.filters === undefined
      ? undefined
      : decodeGraphFilterSetV1(object.filters, `${path}.filters`),
  limits:
    object.limits === undefined
      ? undefined
      : decodeGraphTraversalLimitsV1(object.limits, `${path}.limits`),
  expectedOverlayRevision: optionalText(
    object.expectedOverlayRevision,
    `${path}.expectedOverlayRevision`,
  ),
});

export const decodeGraphConflictOverlayRequestV1 = (
  value: unknown,
  path = 'request',
): GraphConflictOverlayRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'snapshotId',
      'projectionRevision',
      'overlayKind',
      'filters',
      'limits',
      'expectedOverlayRevision',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const overlayKind = enumValue(
    required(object, 'overlayKind', path),
    ['CONFLICT'],
    `${path}.overlayKind`,
  );
  return { ...decodeOverlayCommon(object, path), schemaVersion: '1.0.0', overlayKind };
};

export const decodeGraphKnowledgeGapOverlayRequestV1 = (
  value: unknown,
  path = 'request',
): GraphKnowledgeGapOverlayRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'snapshotId',
      'projectionRevision',
      'overlayKind',
      'filters',
      'limits',
      'expectedOverlayRevision',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const overlayKind = enumValue(
    required(object, 'overlayKind', path),
    ['KNOWLEDGE_GAP'],
    `${path}.overlayKind`,
  );
  return { ...decodeOverlayCommon(object, path), schemaVersion: '1.0.0', overlayKind };
};

export const decodeGraphRecursiveImpactOverlayRequestV1 = (
  value: unknown,
  path = 'request',
): GraphRecursiveImpactOverlayRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'snapshotId',
      'projectionRevision',
      'overlayKind',
      'filters',
      'limits',
      'expectedOverlayRevision',
      'continuationToken',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const overlayKind = enumValue(
    required(object, 'overlayKind', path),
    ['RECURSIVE_IMPACT'],
    `${path}.overlayKind`,
  );
  return {
    ...decodeOverlayCommon(object, path),
    schemaVersion: '1.0.0',
    overlayKind,
    continuationToken: optionalText(object.continuationToken, `${path}.continuationToken`),
  };
};

export const decodeGraphEvidenceDetailRequestV1 = (
  value: unknown,
  path = 'request',
): GraphEvidenceDetailRequestV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'snapshotId', 'projectionRevision', 'target', 'evidenceRef'],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const target = (() => {
    const to = asObject(required(object, 'target', path), `${path}.target`);
    const kind = enumValue(
      required(to, 'kind', `${path}.target`),
      ['NODE', 'EDGE'],
      `${path}.target.kind`,
    );
    if (kind === 'NODE') {
      const no = strictObject(to, ['kind', 'nodeRef'], `${path}.target`);
      return {
        kind: 'NODE' as const,
        nodeRef: decodeGraphNodeReferenceV1(
          required(no, 'nodeRef', `${path}.target`),
          `${path}.target.nodeRef`,
        ),
      };
    }
    const eo = strictObject(to, ['kind', 'edgeRef'], `${path}.target`);
    return {
      kind: 'EDGE' as const,
      edgeRef: decodeGraphEdgeReferenceV1(
        required(eo, 'edgeRef', `${path}.target`),
        `${path}.target.edgeRef`,
      ),
    };
  })();
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    target,
    evidenceRef:
      object.evidenceRef === undefined
        ? undefined
        : (() => {
            const eo = strictObject(
              object.evidenceRef,
              ['sourceId', 'evidenceSpanId'],
              `${path}.evidenceRef`,
            );
            return {
              sourceId: text(
                required(eo, 'sourceId', `${path}.evidenceRef`),
                `${path}.evidenceRef.sourceId`,
              ),
              evidenceSpanId: text(
                required(eo, 'evidenceSpanId', `${path}.evidenceRef`),
                `${path}.evidenceRef.evidenceSpanId`,
              ),
            };
          })(),
  };
};

export const decodeGraphSnapshotRefreshRequestV1 = (
  value: unknown,
  path = 'request',
): GraphSnapshotRefreshRequestV1 => {
  const object = strictObject(
    value,
    ['schemaVersion', 'snapshotId', 'projectionRevision', 'expectedSnapshotRevision'],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    expectedSnapshotRevision: text(
      required(object, 'expectedSnapshotRevision', path),
      `${path}.expectedSnapshotRevision`,
    ),
  };
};

export const decodeGraphRestoreRequestV1 = (
  value: unknown,
  path = 'request',
): GraphRestoreRequestV1 => {
  const object = strictObject(
    value,
    [
      'schemaVersion',
      'snapshotId',
      'projectionRevision',
      'viewKind',
      'overlayKinds',
      'selectedNodeRefs',
      'expectedSnapshotRevision',
    ],
    path,
  );
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  const overlayKinds = arrayValue(
    required(object, 'overlayKinds', path),
    `${path}.overlayKinds`,
  ).map((entry) => enumValue(entry, GRAPH_OVERLAY_KINDS, `${path}.overlayKinds`));
  if (new Set(overlayKinds).size !== overlayKinds.length) {
    return fail(`${path}.overlayKinds`, 'each overlay kind may appear at most once');
  }
  return {
    schemaVersion: '1.0.0',
    snapshotId: text(required(object, 'snapshotId', path), `${path}.snapshotId`),
    projectionRevision: text(
      required(object, 'projectionRevision', path),
      `${path}.projectionRevision`,
    ),
    viewKind: enumValue(
      required(object, 'viewKind', path),
      GRAPH_BASE_VIEW_KINDS,
      `${path}.viewKind`,
    ),
    overlayKinds,
    selectedNodeRefs: arrayValue(
      required(object, 'selectedNodeRefs', path),
      `${path}.selectedNodeRefs`,
    ).map((entry) => decodeGraphNodeReferenceV1(entry, `${path}.selectedNodeRefs`)),
    expectedSnapshotRevision: optionalText(
      object.expectedSnapshotRevision,
      `${path}.expectedSnapshotRevision`,
    ),
  };
};

export const decodeGraphOperationFailureV1 = (
  value: unknown,
  path = 'failure',
): GraphOperationFailureV1 => {
  const object = strictObject(value, ['schemaVersion', 'reason', 'message', 'retryable'], path);
  const schemaVersion = text(required(object, 'schemaVersion', path), `${path}.schemaVersion`);
  if (schemaVersion !== '1.0.0') return fail(`${path}.schemaVersion`, 'must be 1.0.0');
  return {
    schemaVersion: '1.0.0',
    reason: enumValue(
      required(object, 'reason', path),
      GRAPH_UNAVAILABLE_REASONS,
      `${path}.reason`,
    ),
    message: text(required(object, 'message', path), `${path}.message`),
    retryable: booleanValue(required(object, 'retryable', path), `${path}.retryable`),
  };
};
