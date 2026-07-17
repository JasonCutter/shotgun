import type { Actor, SecurityContext } from './types.js';
import { sha256Text, stableJson } from './document-evidence.js';

export type KnowledgeCandidateType =
  'ENTITY' | 'RELATION' | 'EVENT' | 'DECISION' | 'ACTION' | 'CONFLICT' | 'KNOWLEDGE_GAP';

export type ModelAssessment = {
  readonly provider: string;
  readonly model: string;
  readonly value: string;
  readonly evidenceIds: readonly string[];
};

type CandidateBase<TType extends KnowledgeCandidateType> = {
  readonly candidateId: string;
  readonly candidateType: TType;
  readonly revisionNumber: number;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
  readonly modelOutputs: readonly ModelAssessment[];
};

export type EntityCandidate = CandidateBase<'ENTITY'> & {
  readonly name: string;
  readonly entityKind: 'PERSON' | 'ORGANIZATION' | 'PLACE' | 'CONCEPT' | 'OTHER';
  readonly aliases: readonly string[];
  readonly resolution:
    | { readonly status: 'NEW' }
    | { readonly status: 'EXACT_MATCH'; readonly canonicalEntityId: string }
    | { readonly status: 'POSSIBLY_SAME'; readonly possibleCanonicalEntityIds: readonly string[] };
};

export type RelationCandidate = CandidateBase<'RELATION'> & {
  readonly fromCandidateId: string;
  readonly toCandidateId: string;
  readonly relationType: string;
  readonly direction: 'DIRECTED' | 'UNDIRECTED';
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly temporalEvidenceIds?: readonly string[];
};

export type EventCandidate = CandidateBase<'EVENT'> & {
  readonly title: string;
  readonly participantCandidateIds: readonly string[];
  readonly occurredAt?: string;
  readonly temporalEvidenceIds?: readonly string[];
};

export type DecisionCandidate = CandidateBase<'DECISION'> & {
  readonly decisionText: string;
  readonly actorCandidateId?: string;
};

export type ActionCandidate = CandidateBase<'ACTION'> & {
  readonly actionText: string;
  readonly actorCandidateId?: string;
  readonly dueAt?: string;
  readonly temporalEvidenceIds?: readonly string[];
  readonly executionStatus: 'CANDIDATE_ONLY';
};

export type ConflictCandidate = CandidateBase<'CONFLICT'> & {
  readonly subjectCandidateIds: readonly string[];
  readonly summary: string;
  readonly conflictKind: 'FACTUAL' | 'TEMPORAL' | 'IDENTITY' | 'MODEL_DISAGREEMENT';
};

export type KnowledgeGapCandidate = CandidateBase<'KNOWLEDGE_GAP'> & {
  readonly question: string;
  readonly relatedCandidateIds: readonly string[];
};

export type KnowledgeCandidate =
  | EntityCandidate
  | RelationCandidate
  | EventCandidate
  | DecisionCandidate
  | ActionCandidate
  | ConflictCandidate
  | KnowledgeGapCandidate;

export type KnowledgeReviewStatus =
  'PENDING_REVIEW' | 'ON_HOLD' | 'APPROVED' | 'REJECTED' | 'EDIT_REENTRY';

export type KnowledgeReentryPhase =
  'EVIDENCE' | 'VALIDATION' | 'COMPARISON_IMPACT' | 'PROJECTION_ONLY';

export type KnowledgeReviewDecision = {
  readonly decisionId: string;
  readonly decision: 'APPROVE' | 'HOLD' | 'REJECT' | 'EDIT';
  readonly reason: string;
  readonly actor: Actor;
  readonly itemIds: readonly string[];
  readonly decidedAt: string;
  readonly editKind?:
    'WORDING_LAYOUT' | 'FACTUAL_CORRECTION' | 'NEW_KNOWLEDGE' | 'REFERENCE_CHANGE';
  readonly reentryPhase?: KnowledgeReentryPhase;
};

export type KnowledgeReviewGroup = {
  readonly groupId: string;
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly revisionNumber: number;
  readonly status: KnowledgeReviewStatus;
  readonly contentDigest: string;
  readonly items: readonly KnowledgeCandidate[];
  readonly decisions: readonly KnowledgeReviewDecision[];
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ModelDisagreementView = {
  readonly candidateId: string;
  readonly present: boolean;
  readonly variants: readonly string[];
  readonly outputs: readonly ModelAssessment[];
};

export type KnowledgeImpactPath = {
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly depth: number;
};

export type KnowledgeImpactResult = {
  readonly rootCandidateId: string;
  readonly paths: readonly KnowledgeImpactPath[];
  readonly visitedNodeIds: readonly string[];
  readonly traversedEdgeIds: readonly string[];
  readonly truncated: boolean;
  readonly cycleSafe: true;
  readonly source: 'APPROVED_TYPED_EDGES';
};

export type KnowledgeGraphView = {
  readonly nodes: readonly {
    readonly id: string;
    readonly type: KnowledgeCandidateType;
    readonly label: string;
    readonly modelDisagreement: boolean;
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly relationType: string;
    readonly direction: RelationCandidate['direction'];
  }[];
  readonly tableRows: readonly {
    readonly id: string;
    readonly type: KnowledgeCandidateType;
    readonly label: string;
    readonly evidenceCount: number;
    readonly modelDisagreement: boolean;
  }[];
  readonly fallback: { readonly available: true; readonly modes: readonly ['LIST', 'TABLE'] };
};

export type EntityVaultImport = {
  readonly importId: string;
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly status: 'PENDING_APPROVAL' | 'APPROVED_FOR_REVIEW' | 'REJECTED';
  readonly contentDigest: string;
  readonly entityCount: number;
  readonly entities: readonly EntityCandidate[];
  readonly canonicalWrite: false;
  readonly nextAction: 'REVIEW_AND_STAGE_KNOWLEDGE_GROUP';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvedBy?: string;
};

export const knowledgeCandidateDigest = (items: readonly KnowledgeCandidate[]): string =>
  sha256Text(
    stableJson(
      [...items]
        .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
        .map((item) => ({ ...item })),
    ),
  );

export const modelDisagreementView = (candidate: KnowledgeCandidate): ModelDisagreementView => {
  const variants = [
    ...new Set(candidate.modelOutputs.map((output) => output.value.trim().toLocaleLowerCase())),
  ].sort();
  return {
    candidateId: candidate.candidateId,
    present: variants.length > 1,
    variants,
    outputs: candidate.modelOutputs,
  };
};

export const entityVaultImportDigest = (
  sourceVersionId: string,
  entities: readonly EntityCandidate[],
): string => sha256Text(stableJson({ sourceVersionId, entities }));
