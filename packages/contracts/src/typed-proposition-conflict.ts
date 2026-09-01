import type { Actor, SecurityContext } from './types.js';
import type {
  DiscoveryCanonicalBaseIdentityV1,
  DiscoveryProjectionBaseIdentityV1,
  DiscoveryResourceRefV1,
} from './discovery-finding.js';
import type { RelationCandidate } from './knowledge-model.js';
import { sha256Text } from './document-evidence.js';
import { semanticStableJson, utf16OrdinalCompare } from './semantic-representation.js';

export const TYPED_PROPOSITION_CONFLICT_RULE_SCHEMA_VERSION = '1.0.0' as const;
export const TYPED_PROPOSITION_CONFLICT_ASSERTION_SCHEMA_VERSION = '1.0.0' as const;
export const TYPED_PROPOSITION_CONFLICT_RULE_COMMAND_TYPE =
  'frontend.discovery.conflict-rule.v1' as const;

export type TypedPropositionConflictParticipantBindingV1 = 'SAME_EXACT_ENDPOINT_PAIR';
export type TypedPropositionConflictDirectionSemanticsV1 =
  'DIRECTED_SAME_ORIENTATION' | 'UNDIRECTED_CANONICAL_PAIR';
export type TypedPropositionConflictRuleStatusV1 = 'ACTIVE' | 'RETIRED' | 'SUPERSEDED';

export type TypedPropositionConflictRuleApprovalV1 = {
  readonly authority: 'USER_APPROVAL';
  readonly actor: Actor;
  readonly approvedAt: string;
};

export type TypedPropositionConflictRuleProvenanceV1 = {
  readonly authority: 'USER_DIRECTIVE';
  readonly actor: Actor;
  readonly createdAt: string;
};

export type TypedPropositionConflictRuleV1 = {
  readonly schemaVersion: typeof TYPED_PROPOSITION_CONFLICT_RULE_SCHEMA_VERSION;
  readonly ruleId: string;
  readonly ruleRevision: number;
  readonly projectId: string;
  readonly leftRelationType: string;
  readonly rightRelationType: string;
  readonly participantBinding: TypedPropositionConflictParticipantBindingV1;
  readonly directionSemantics: TypedPropositionConflictDirectionSemanticsV1;
  readonly kind: 'FACTUAL';
  readonly source: 'TYPED_PROPOSITION';
  readonly status: TypedPropositionConflictRuleStatusV1;
  readonly approval: TypedPropositionConflictRuleApprovalV1;
  readonly provenance: TypedPropositionConflictRuleProvenanceV1;
  readonly semanticKey: string;
  readonly createdAt: string;
  readonly retiredAt?: string;
  readonly supersedes?: { readonly ruleId: string; readonly ruleRevision: number };
  readonly supersededBy?: { readonly ruleId: string; readonly ruleRevision: number };
};

export type TypedPropositionConflictRuleLifecycleV1 = {
  readonly currentRevision: number;
  readonly activeRevision?: number;
  readonly retiredAt?: string;
  readonly supersededBy?: { readonly ruleId: string; readonly ruleRevision: number };
};

export type TypedPropositionConflictRuleViewV1 = Pick<
  TypedPropositionConflictRuleV1,
  | 'schemaVersion'
  | 'ruleId'
  | 'ruleRevision'
  | 'leftRelationType'
  | 'rightRelationType'
  | 'directionSemantics'
  | 'status'
  | 'createdAt'
> & {
  readonly lifecycle: TypedPropositionConflictRuleLifecycleV1;
};

export type TypedPropositionConflictRuleCommandOperationV1 = 'CREATE' | 'REVISE' | 'RETIRE';

/** Browser-owned intent only. Server-owned authority is deliberately absent. */
export type TypedPropositionConflictRuleCommandPayloadV1 = {
  readonly operation: TypedPropositionConflictRuleCommandOperationV1;
  readonly ruleId?: string;
  readonly expectedRuleRevision?: number;
  readonly leftRelationType?: string;
  readonly rightRelationType?: string;
  readonly directionSemantics?: TypedPropositionConflictDirectionSemanticsV1;
};

export type TypedPropositionConflictRuleCommandRequestV1 = {
  readonly schemaVersion: typeof TYPED_PROPOSITION_CONFLICT_RULE_COMMAND_TYPE;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly operation: TypedPropositionConflictRuleCommandOperationV1;
  readonly ruleId?: string;
  readonly expectedRuleRevision?: number;
  readonly leftRelationType?: string;
  readonly rightRelationType?: string;
  readonly directionSemantics?: TypedPropositionConflictDirectionSemanticsV1;
};

export type TypedPropositionConflictAssertionStatusV1 = 'ACTIVE' | 'SUPERSEDED' | 'RETIRED';

export type TypedPropositionConflictAssertionV1 = {
  readonly schemaVersion: typeof TYPED_PROPOSITION_CONFLICT_ASSERTION_SCHEMA_VERSION;
  readonly assertionId: string;
  readonly assertionRevision: number;
  readonly identityKey: string;
  readonly projectId: string;
  readonly ruleId: string;
  readonly ruleRevision: number;
  readonly kind: 'FACTUAL';
  readonly source: 'TYPED_PROPOSITION';
  readonly leftRelationCandidateId: string;
  readonly leftRelationRevision: number;
  readonly leftSourceVersionId: string;
  readonly rightRelationCandidateId: string;
  readonly rightRelationRevision: number;
  readonly rightSourceVersionId: string;
  readonly resourceRefs: readonly [DiscoveryResourceRefV1, DiscoveryResourceRefV1];
  readonly evidenceIds: readonly string[];
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly security: Pick<SecurityContext, 'accessScope' | 'sensitivity'> & {
    readonly projectId: string;
  };
  readonly status: TypedPropositionConflictAssertionStatusV1;
  readonly sourceAuthorityId: 'stage9.typed-proposition-conflict-evaluator';
  readonly sourceAuthorityRevision: '1.0.0';
  readonly createdAt: string;
  readonly supersededAt?: string;
  readonly retiredAt?: string;
  readonly provenance: {
    readonly evaluatorVersion: string;
    readonly createdAt: string;
    readonly sourceAuthorityId: 'stage9.typed-proposition-conflict-evaluator';
    readonly sourceAuthorityRevision: '1.0.0';
  };
};

const normalizedTypePair = (left: string, right: string): readonly [string, string] =>
  utf16OrdinalCompare(left, right) <= 0 ? [left, right] : [right, left];

export const normalizeTypedPropositionConflictRelationTypes = (
  leftRelationType: string,
  rightRelationType: string,
): readonly [string, string] => normalizedTypePair(leftRelationType, rightRelationType);

export const typedPropositionConflictRuleSemanticKey = (input: {
  readonly projectId: string;
  readonly leftRelationType: string;
  readonly rightRelationType: string;
  readonly directionSemantics: TypedPropositionConflictDirectionSemanticsV1;
}): string => {
  const [leftRelationType, rightRelationType] = normalizedTypePair(
    input.leftRelationType,
    input.rightRelationType,
  );
  return sha256Text(
    semanticStableJson({
      schemaVersion: 'typed-proposition-conflict-rule-key:v1',
      projectId: input.projectId,
      leftRelationType,
      rightRelationType,
      directionSemantics: input.directionSemantics,
    }),
  );
};

export const typedPropositionConflictRuleMatches = (
  rule: Pick<
    TypedPropositionConflictRuleV1,
    | 'leftRelationType'
    | 'rightRelationType'
    | 'directionSemantics'
    | 'participantBinding'
    | 'status'
  >,
  left: RelationCandidate,
  right: RelationCandidate,
): boolean => {
  if (rule.status !== 'ACTIVE' || rule.participantBinding !== 'SAME_EXACT_ENDPOINT_PAIR') {
    return false;
  }
  const relationTypes = normalizedTypePair(left.relationType, right.relationType);
  if (relationTypes[0] !== rule.leftRelationType || relationTypes[1] !== rule.rightRelationType) {
    return false;
  }
  if (rule.directionSemantics === 'DIRECTED_SAME_ORIENTATION') {
    if (left.direction !== 'DIRECTED' || right.direction !== 'DIRECTED') return false;
    const typedLeft = left.relationType === rule.leftRelationType ? left : right;
    const typedRight = left.relationType === rule.leftRelationType ? right : left;
    return (
      typedLeft.fromCandidateId === typedRight.fromCandidateId &&
      typedLeft.toCandidateId === typedRight.toCandidateId
    );
  }
  if (left.direction !== 'UNDIRECTED' || right.direction !== 'UNDIRECTED') return false;
  const leftEndpoints = [left.fromCandidateId, left.toCandidateId].sort(utf16OrdinalCompare);
  const rightEndpoints = [right.fromCandidateId, right.toCandidateId].sort(utf16OrdinalCompare);
  return leftEndpoints[0] === rightEndpoints[0] && leftEndpoints[1] === rightEndpoints[1];
};

export const typedPropositionConflictAssertionIdentity = (input: {
  readonly projectId: string;
  readonly ruleId: string;
  readonly ruleRevision: number;
  readonly left: Pick<RelationCandidate, 'candidateId' | 'revisionNumber' | 'sourceVersionId'>;
  readonly right: Pick<RelationCandidate, 'candidateId' | 'revisionNumber' | 'sourceVersionId'>;
  readonly canonicalBase: DiscoveryCanonicalBaseIdentityV1;
  readonly discoveryBase: DiscoveryProjectionBaseIdentityV1;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
}): string => {
  const participants = [input.left, input.right]
    .map((participant) => ({
      candidateId: participant.candidateId,
      revisionNumber: participant.revisionNumber,
      sourceVersionId: participant.sourceVersionId,
    }))
    .sort(
      (left, right) =>
        utf16OrdinalCompare(left.candidateId, right.candidateId) ||
        left.revisionNumber - right.revisionNumber ||
        utf16OrdinalCompare(left.sourceVersionId, right.sourceVersionId),
    );
  return sha256Text(
    semanticStableJson({
      schemaVersion: 'typed-proposition-conflict-assertion-identity:v1',
      projectId: input.projectId,
      ruleId: input.ruleId,
      ruleRevision: input.ruleRevision,
      participants,
      canonicalBase: input.canonicalBase,
      discoveryBase: input.discoveryBase,
      accessScope: [...new Set(input.accessScope)].sort(utf16OrdinalCompare),
      sensitivity: input.sensitivity,
    }),
  );
};
