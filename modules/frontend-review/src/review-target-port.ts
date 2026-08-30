import type {
  ReviewContextRevisionV1,
  ReviewEvidenceEntryV1,
  ReviewImpactEntryV1,
  ReviewSourceItemKindV1,
  ReviewTargetKindV1,
} from '../../../packages/contracts/src/index.js';

/** Server-derived Review scope. The Browser never submits any of these values. */
export type FrontendReviewScopeV1 = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProjectId: string;
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  readonly sensitivityClearance?: string;
  readonly accessScope: readonly string[];
};

export type ReviewSourceKindV1 =
  'FE_P3_S2_SUBMISSION' | 'DISCOVERY_CANDIDATE' | 'USER_DIRECTIVE_PROPOSAL';

export type ReviewSourceTargetV1 = {
  readonly reviewResourceId: string;
  readonly targetId: string;
  readonly targetRevision: string;
  readonly targetDigest: string;
  readonly targetLabel: string;
  readonly resourceProjectId: string;
  readonly effectiveProjectId: string;
  readonly updatedAt: string;
  readonly source: ReviewSourceKindV1;
};

export type ReviewContextMaterializationInputV1 = {
  readonly scope: FrontendReviewScopeV1;
  readonly source: ReviewSourceTargetV1;
  readonly reviewContextId: string;
  readonly contextRevision: number;
  readonly generatedAt: string;
};

export type ReviewMaterializedContextV1 = {
  readonly context: ReviewContextRevisionV1;
};

/**
 * A Review target adapter enumerates source resources (FE-P3-S2 Review
 * Submissions, Discovery Candidates, UserDirectiveProposals) and materializes
 * them into immutable Review Context revisions. Hidden Items are removed
 * before counts and descriptions are created; a visible Item that depends on
 * hidden content is marked unavailable without leaking the hidden identity.
 */
export type ReviewTargetAdapterPort = {
  readonly targetKind: ReviewTargetKindV1;
  readonly sourceItemKind: ReviewSourceItemKindV1;
  listSourceTargets(
    projectId: string,
    scope?: FrontendReviewScopeV1,
  ): Promise<readonly ReviewSourceTargetV1[]>;
  findSourceTarget(
    projectId: string,
    reviewResourceId: string,
    scope?: FrontendReviewScopeV1,
  ): Promise<ReviewSourceTargetV1 | undefined>;
  materializeContext(
    input: ReviewContextMaterializationInputV1,
  ): Promise<ReviewMaterializedContextV1>;
  /** Lazy evidence detail for one Review Item. */
  readEvidence(input: {
    readonly scope: FrontendReviewScopeV1;
    readonly source: ReviewSourceTargetV1;
    readonly reviewItemId: string;
  }): Promise<readonly ReviewEvidenceEntryV1[]>;
  /** Lazy impact detail for one Review Item. */
  readImpact(input: {
    readonly scope: FrontendReviewScopeV1;
    readonly source: ReviewSourceTargetV1;
    readonly reviewItemId: string;
  }): Promise<readonly ReviewImpactEntryV1[]>;
  /**
   * Current Evidence artifact digest derived from the live source. Used to
   * revalidate REVIEW_EVIDENCE_CHANGED at decision time. Returns undefined
   * when the source carries no Evidence artifact.
   */
  currentEvidenceDigest(input: {
    readonly scope: FrontendReviewScopeV1;
    readonly source: ReviewSourceTargetV1;
  }): Promise<string | undefined>;
};
