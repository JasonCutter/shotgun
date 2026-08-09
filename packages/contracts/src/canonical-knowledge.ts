import type { Actor, SecurityContext } from './types.js';

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
  readonly operation: 'ADD_CLAIM' | 'NO_OP';
  readonly status: CanonicalCommitStatus;
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly snapshotDigest: string;
  readonly claimId?: string;
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
  readonly operation: 'ADD_CLAIM' | 'NO_OP';
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly claimId?: string;
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
  readonly eventType: 'CANONICAL_CLAIM_ADDED' | 'CHANGESET_NO_OP';
  readonly beforeVersion: number;
  readonly afterVersion: number;
  readonly claimId?: string;
  readonly reason: string;
  readonly actor: Actor;
  readonly createdAt: string;
};

export type CanonicalCommittedPayload = {
  readonly commitId: string;
  readonly manifestId: string | null;
  readonly changeSetId: string | null;
  readonly operation: 'ADD_CLAIM' | 'NO_OP';
  readonly status: CanonicalCommitStatus;
  readonly canonicalVersion: number;
  readonly snapshotDigest: string;
  readonly claimId?: string;
  readonly actorId: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
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
