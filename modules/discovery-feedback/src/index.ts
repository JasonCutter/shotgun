import {
  decodeDiscoveryFeedbackEventV1,
  decodeDiscoveryRankingPolicyRevisionV1,
  decodeDiscoverySuppressionDirectiveV1,
} from '../../../packages/contracts/src/index.js';
import type {
  DiscoveryFeedbackEventV1,
  DiscoveryRankingPolicyRevisionV1,
  DiscoverySuppressionDirectiveV1,
} from '../../../packages/contracts/src/index.js';

export type DiscoveryFeedbackFindingLookupV1 = {
  readonly projectId: string;
  readonly findingId: string;
  readonly findingRevision: number;
};

export type DiscoverySuppressionLookupV1 = DiscoveryFeedbackFindingLookupV1 & {
  /** The principal whose project-scoped directives may be effective. */
  readonly principalId: string;
  /** Required for exact matching; no raw content or unrestricted search is accepted. */
  readonly fingerprint?: string;
  readonly fingerprintVersion?: string;
  /** A caller-selected, versioned matcher may request semantic-family candidates. */
  readonly semanticMatcherVersion?: string;
  readonly at?: string;
};

export type DiscoveryRankingPolicyLookupV1 = {
  /** Required even though the current policy scope is server-global. */
  readonly projectId: string;
  readonly policyId: string;
  readonly at?: string;
};

/**
 * WP1 persistence boundary. It stores explicit, non-Canonical feedback and
 * policy metadata only; it cannot write Findings, Evidence, Facts, Claims,
 * Review, Canonical, Attention, Graph, or Action state.
 */
export type DiscoveryFeedbackRepositoryPort = {
  appendFeedback(event: DiscoveryFeedbackEventV1): Promise<'CREATED' | 'CONFLICT'>;
  listFeedbackForFinding(
    lookup: DiscoveryFeedbackFindingLookupV1,
  ): Promise<readonly DiscoveryFeedbackEventV1[]>;
  appendSuppression(directive: DiscoverySuppressionDirectiveV1): Promise<'CREATED' | 'CONFLICT'>;
  listRelevantSuppression(
    lookup: DiscoverySuppressionLookupV1,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[]>;
  insertRankingPolicyRevision(
    policy: DiscoveryRankingPolicyRevisionV1,
  ): Promise<'CREATED' | 'CONFLICT'>;
  listRankingPolicyRevisions(
    lookup: DiscoveryRankingPolicyLookupV1,
  ): Promise<readonly DiscoveryRankingPolicyRevisionV1[]>;
  resolveEffectiveRankingPolicy(
    lookup: DiscoveryRankingPolicyLookupV1,
  ): Promise<DiscoveryRankingPolicyRevisionV1 | undefined>;
};

export const assertDiscoveryFeedbackEventV1 = (
  event: DiscoveryFeedbackEventV1,
): DiscoveryFeedbackEventV1 => decodeDiscoveryFeedbackEventV1(event);

export const assertDiscoverySuppressionDirectiveV1 = (
  directive: DiscoverySuppressionDirectiveV1,
): DiscoverySuppressionDirectiveV1 => decodeDiscoverySuppressionDirectiveV1(directive);

export const assertDiscoveryRankingPolicyRevisionV1 = (
  policy: DiscoveryRankingPolicyRevisionV1,
): DiscoveryRankingPolicyRevisionV1 => decodeDiscoveryRankingPolicyRevisionV1(policy);

export const assertProjectId = (projectId: string): string => {
  const normalized = projectId.trim();
  if (!normalized) throw new TypeError('projectId must be non-empty');
  return normalized;
};

export const assertPrincipalId = (principalId: string): string => {
  const normalized = principalId.trim();
  if (!normalized) throw new TypeError('principalId must be non-empty');
  return normalized;
};

export const assertPolicyId = (policyId: string): string => {
  const normalized = policyId.trim();
  if (!normalized) throw new TypeError('policyId must be non-empty');
  return normalized;
};
