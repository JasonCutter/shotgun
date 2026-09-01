import type { Actor, SecurityContext } from './types.js';
import type { ClaimCandidate } from './ai-candidate-validation.js';
import { sha256Text, stableJson } from './document-evidence.js';

export type CanonicalSnapshotClaim = {
  readonly claimId: string;
  readonly text: string;
  readonly revisionNumber: number;
  readonly evidenceIds: readonly string[];
};

export type CanonicalSnapshotRelation = {
  readonly relationId: string;
  readonly logicalIdentityKey: string;
  readonly revisionNumber: number;
  readonly relationType: string;
  readonly fromEndpoint: {
    readonly authority: 'APPROVED_KNOWLEDGE';
    readonly resourceType: 'ENTITY';
    readonly resourceId: string;
    readonly resourceRevision: number;
  };
  readonly toEndpoint: {
    readonly authority: 'APPROVED_KNOWLEDGE';
    readonly resourceType: 'ENTITY';
    readonly resourceId: string;
    readonly resourceRevision: number;
  };
  readonly direction: 'DIRECTED' | 'UNDIRECTED';
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly evidenceIds: readonly string[];
};

export type CanonicalSnapshot = {
  readonly snapshotId: string;
  readonly projectId: string;
  readonly version: number;
  readonly digest: string;
  readonly claims: readonly CanonicalSnapshotClaim[];
  readonly relations?: readonly CanonicalSnapshotRelation[];
  readonly createdAt: string;
};

export type TextDiffSegment = {
  readonly type: 'equal' | 'insert' | 'delete';
  readonly value: string;
};

export type ComparisonClassification = 'NEW_CLAIM' | 'EXACT_DUPLICATE' | 'POSSIBLE_CONFLICT';

export type ComparisonResult = {
  readonly comparisonId: string;
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly candidateId: string;
  readonly candidateRevisionNumber: 1;
  readonly candidateDigest: string;
  readonly snapshotId: string;
  readonly snapshotVersion: number;
  readonly snapshotDigest: string;
  readonly classification: ComparisonClassification;
  readonly matchedClaim?: CanonicalSnapshotClaim;
  readonly similarity: number;
  readonly diff: readonly TextDiffSegment[];
  readonly diffDigest: string;
  readonly recommendation: 'ADD_CLAIM' | 'NO_OP';
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
};

export type ReviewDecisionType = 'APPROVE' | 'HOLD' | 'REJECT';

export type ApprovalToken = {
  readonly tokenId: string;
  readonly changeSetId: string;
  readonly changeSetRevisionNumber: 1;
  readonly actorId: string;
  readonly contentDigest: string;
  readonly expectedCanonicalVersion: number;
  readonly snapshotDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly tokenDigest: string;
};

export type ReviewDecisionRecord = {
  readonly decisionId: string;
  readonly decision: ReviewDecisionType;
  readonly reason: string;
  readonly actor: Actor;
  readonly contentDigest: string;
  readonly decidedAt: string;
  readonly approvalToken?: ApprovalToken;
};

export type DraftChangeSetStatus = 'PENDING_REVIEW' | 'ON_HOLD' | 'APPROVED' | 'REJECTED' | 'STALE';

export type DraftChangeSet = {
  readonly changeSetId: string;
  readonly revisionNumber: 1;
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly candidateId: string;
  readonly comparisonId: string;
  readonly operation: 'ADD_CLAIM' | 'NO_OP';
  readonly classification: ComparisonClassification;
  readonly status: DraftChangeSetStatus;
  readonly expectedCanonicalVersion: number;
  readonly snapshotDigest: string;
  readonly candidateDigest: string;
  readonly diffDigest: string;
  readonly contentDigest: string;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly decisions: readonly ReviewDecisionRecord[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type ApprovedChangeSetManifest = {
  readonly manifestId: string;
  readonly changeSetId: string;
  readonly changeSetRevisionNumber: 1;
  readonly projectId: string;
  readonly sourceVersionId: string;
  readonly candidateId: string;
  readonly candidateRevisionNumber: 1;
  readonly claimText: string;
  readonly operation: DraftChangeSet['operation'];
  readonly classification: ComparisonClassification;
  readonly candidateDigest: string;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly expectedCanonicalVersion: number;
  readonly snapshotDigest: string;
  readonly diffDigest: string;
  readonly contentDigest: string;
  readonly approvalToken: ApprovalToken;
  readonly reason: string;
  readonly createdAt: string;
  readonly manifestDigest: string;
};

export type ChangeSetContentDigestInput = {
  readonly operation: DraftChangeSet['operation'];
  readonly classification: ComparisonClassification;
  readonly candidateId: string;
  readonly candidateRevisionNumber: 1;
  readonly candidateDigest: string;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly expectedCanonicalVersion: number;
  readonly snapshotDigest: string;
  readonly diffDigest: string;
};

export const claimCandidateDigest = (candidate: {
  readonly candidateId: ClaimCandidate['candidateId'];
  readonly revisionNumber: ClaimCandidate['revisionNumber'];
  readonly sourceVersionId: ClaimCandidate['sourceVersionId'];
  readonly claimText: ClaimCandidate['claimText'];
  readonly evidenceIds: readonly string[];
  readonly status: ClaimCandidate['status'];
}): string =>
  sha256Text(
    stableJson({
      candidateId: candidate.candidateId,
      revisionNumber: candidate.revisionNumber,
      sourceVersionId: candidate.sourceVersionId,
      claimText: candidate.claimText,
      evidenceIds: candidate.evidenceIds,
      status: candidate.status,
    }),
  );

export const changeSetContentDigest = (input: ChangeSetContentDigestInput): string =>
  sha256Text(stableJson(input));

export const approvalTokenDigest = (token: Omit<ApprovalToken, 'tokenDigest'>): string =>
  sha256Text(stableJson(token));

export const approvedChangeSetManifestDigest = (
  manifest: Omit<ApprovedChangeSetManifest, 'manifestDigest'>,
): string => sha256Text(stableJson(manifest));

export const canonicalSnapshotDigest = (
  projectId: string,
  version: number,
  claims: readonly CanonicalSnapshotClaim[],
  relations?: readonly CanonicalSnapshotRelation[],
): string =>
  sha256Text(
    stableJson({
      projectId,
      version,
      claims: [...claims].sort((left, right) => left.claimId.localeCompare(right.claimId)),
      ...(relations === undefined
        ? {}
        : {
            relations: [...relations].sort((left, right) =>
              left.relationId.localeCompare(right.relationId),
            ),
          }),
    }),
  );
