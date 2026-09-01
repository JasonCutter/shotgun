import type { Actor, SecurityContext } from './types.js';
import type { ApprovedKnowledgeEntityRefV1 } from './frontend-knowledge-draft.js';
import { sha256Text, stableJson } from './document-evidence.js';
import { utf16OrdinalCompare } from './semantic-representation.js';

const canonicalRelationEndpointIdentityV1 = (endpoint: ApprovedKnowledgeEntityRefV1): string =>
  [
    endpoint.projectId,
    endpoint.authority,
    endpoint.resourceType,
    endpoint.resourceId,
    String(endpoint.resourceRevision),
  ].join('\u0000');

/**
 * Server/domain-owned logical identity for a Canonical relation. Endpoint
 * authority and exact revision are part of identity; temporal absence is
 * deliberately distinct from an explicitly supplied value. UNDIRECTED
 * relations use the same complete endpoint identity in either order.
 */
export const canonicalRelationLogicalIdentityV1 = (input: {
  readonly projectId: string;
  readonly relationType: string;
  readonly fromEndpoint: ApprovedKnowledgeEntityRefV1;
  readonly toEndpoint: ApprovedKnowledgeEntityRefV1;
  readonly direction: 'DIRECTED' | 'UNDIRECTED';
  readonly validFrom?: string;
  readonly validTo?: string;
}): string => {
  const endpoints = [input.fromEndpoint, input.toEndpoint];
  if (input.direction === 'UNDIRECTED') {
    endpoints.sort((left, right) =>
      utf16OrdinalCompare(
        canonicalRelationEndpointIdentityV1(left),
        canonicalRelationEndpointIdentityV1(right),
      ),
    );
  }
  return `canonical-relation:v1:${sha256Text(
    stableJson({
      projectId: input.projectId,
      relationType: input.relationType,
      fromEndpoint: endpoints[0],
      toEndpoint: endpoints[1],
      direction: input.direction,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
    }),
  )}`;
};

/** Cross-Phase Correction B: frontend commit authority provenance. */
export type FrontendCanonicalAuthorityV1 = {
  readonly kind: 'FRONTEND_REVIEW_APPROVAL';
  readonly approvalId: string;
  readonly approvalBindingDigest: string;
  readonly reviewContextId: string;
  readonly contextRevision: number;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draftContentDigest: string;
  readonly approvedItemIds: readonly string[];
};

export type FrontendCanonicalCommitWrite =
  | {
      readonly commitId: string;
      readonly revisionId: string;
      readonly historyEventId: string;
      readonly outboxId: string;
      readonly projectId: string;
      readonly operation: 'ADD_CLAIM';
      readonly claimId: string;
      readonly claimText: string;
      readonly sourceVersionId: string;
      readonly evidenceIds: readonly string[];
      readonly accessScope: readonly string[];
      readonly sensitivity: SecurityContext['sensitivity'];
      readonly expectedCanonicalVersion: number;
      readonly snapshotDigest: string;
      readonly authority: FrontendCanonicalAuthorityV1;
      readonly reason: string;
      readonly actor: Actor;
      readonly committedAt: string;
    }
  | {
      readonly commitId: string;
      readonly revisionId: string;
      readonly historyEventId: string;
      readonly outboxId: string;
      readonly projectId: string;
      readonly operation: 'ADD_RELATION';
      readonly relationId: string;
      readonly logicalIdentityKey: string;
      readonly relationType: string;
      readonly fromEndpoint: ApprovedKnowledgeEntityRefV1;
      readonly toEndpoint: ApprovedKnowledgeEntityRefV1;
      readonly direction: 'DIRECTED' | 'UNDIRECTED';
      readonly validFrom?: string;
      readonly validTo?: string;
      readonly evidenceIds: readonly string[];
      readonly accessScope: readonly string[];
      readonly sensitivity: SecurityContext['sensitivity'];
      readonly discoveryProvenanceRef?: string;
      readonly discoveryProvenanceRevision?: number;
      readonly expectedCanonicalVersion: number;
      readonly snapshotDigest: string;
      readonly authority: FrontendCanonicalAuthorityV1;
      readonly reason: string;
      readonly actor: Actor;
      readonly committedAt: string;
    }
  | {
      readonly commitId: string;
      readonly revisionId: string;
      readonly historyEventId: string;
      readonly outboxId: string;
      readonly projectId: string;
      readonly operation: 'NO_OP';
      readonly expectedCanonicalVersion: number;
      readonly snapshotDigest: string;
      readonly authority: FrontendCanonicalAuthorityV1;
      readonly reason: string;
      readonly actor: Actor;
      readonly committedAt: string;
    };

export type CanonicalClaim = {
  readonly claimId: string;
  readonly projectId: string;
  readonly revisionNumber: 1;
  readonly claimText: string;
  readonly sourceVersionId: string;
  readonly evidenceIds: readonly string[];
  readonly createdFromManifestId: string | null;
  /** Frontend Review Approval authority reference (null for legacy rows). */
  readonly authorityId: string | null;
  readonly authorityDigest: string | null;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
};

export type CanonicalCommitStatus = 'COMMITTED' | 'NO_OP';

export type CanonicalCommitResult = {
  readonly commitId: string;
  readonly projectId: string;
  readonly manifestId: string | null;
  readonly manifestDigest: string | null;
  readonly changeSetId: string | null;
  /** Frontend Review Approval authority reference (null for legacy rows). */
  readonly authorityId: string | null;
  readonly authorityDigest: string | null;
  readonly operation: 'ADD_CLAIM' | 'ADD_RELATION' | 'NO_OP';
  readonly status: CanonicalCommitStatus;
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly snapshotDigest: string;
  readonly claimId?: string;
  readonly relationId?: string;
  readonly logicalIdentityKey?: string;
  readonly revisionId: string;
  readonly historyEventId: string;
  readonly outboxId: string;
  readonly committedAt: string;
};

export type CanonicalRevision = {
  readonly revisionId: string;
  readonly projectId: string;
  readonly commitId: string;
  readonly manifestId: string | null;
  readonly operation: 'ADD_CLAIM' | 'ADD_RELATION' | 'NO_OP';
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly claimId?: string;
  readonly relationId?: string;
  readonly reason: string;
  readonly actor: Actor;
  readonly createdAt: string;
};

export type CanonicalHistoryEvent = {
  readonly historyEventId: string;
  readonly projectId: string;
  readonly commitId: string;
  readonly manifestId: string | null;
  readonly changeSetId: string | null;
  readonly eventType: 'CANONICAL_CLAIM_ADDED' | 'CANONICAL_RELATION_ADDED' | 'CHANGESET_NO_OP';
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly claimId?: string;
  readonly relationId?: string;
  readonly reason: string;
  readonly actor: Actor;
  readonly createdAt: string;
};

export type CanonicalCommittedPayload = {
  readonly commitId: string;
  readonly manifestId: string | null;
  readonly changeSetId: string | null;
  readonly operation: 'ADD_CLAIM' | 'ADD_RELATION' | 'NO_OP';
  readonly status: CanonicalCommitStatus;
  readonly canonicalVersion: number;
  readonly snapshotDigest: string;
  readonly claimId?: string;
  readonly relationId?: string;
  readonly logicalIdentityKey?: string;
  readonly actorId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
};

export type CanonicalRelationV1 = {
  readonly relationId: string;
  readonly logicalIdentityKey: string;
  readonly projectId: string;
  readonly revisionNumber: 1;
  readonly relationType: string;
  readonly fromEndpoint: ApprovedKnowledgeEntityRefV1;
  readonly toEndpoint: ApprovedKnowledgeEntityRefV1;
  readonly direction: 'DIRECTED' | 'UNDIRECTED';
  readonly validFrom?: string;
  readonly validTo?: string;
  readonly evidenceIds: readonly string[];
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly authority: FrontendCanonicalAuthorityV1;
  readonly discoveryProvenanceRef?: string;
  readonly discoveryProvenanceRevision?: number;
  readonly createdAt: string;
};

export type CanonicalRelationPrecursorLinkV1 = {
  readonly projectId: string;
  readonly reviewResourceId: string;
  readonly reviewResourceRevision: number;
  readonly relationId: string;
  readonly relationRevision: 1;
  readonly linkedAt: string;
};

export type CanonicalOutboxRecord = {
  readonly outboxId: string;
  readonly projectId: string;
  readonly aggregateId: string;
  readonly eventType: 'CanonicalCommitted';
  readonly payload: CanonicalCommittedPayload;
  readonly status: 'pending' | 'processing' | 'published';
  readonly attempts: number;
  readonly availableAt: string;
  readonly claimedAt?: string;
  readonly publishedAt?: string;
  readonly lastError?: string;
};
