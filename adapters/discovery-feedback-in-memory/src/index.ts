import type {
  DiscoveryFeedbackEventV1,
  DiscoveryRankingPolicyRevisionV1,
  DiscoverySuppressionDirectiveV1,
} from '../../../packages/contracts/src/index.js';
import {
  assertDiscoveryFeedbackEventV1,
  assertDiscoveryRankingPolicyRevisionV1,
  assertDiscoverySuppressionDirectiveV1,
  assertPolicyId,
  assertPrincipalId,
  assertProjectId,
} from '../../../modules/discovery-feedback/src/index.js';
import type {
  DiscoveryFeedbackFindingLookupV1,
  DiscoveryFeedbackRepositoryPort,
  DiscoveryRankingPolicyLookupV1,
  DiscoverySuppressionLookupV1,
} from '../../../modules/discovery-feedback/src/index.js';

const clone = <T>(value: T): T => structuredClone(value);

const timestamp = (value: string): number => Date.parse(value);

const subjectId = (value: {
  readonly principalId?: string;
  readonly actor: { readonly id: string };
}): string => value.principalId ?? value.actor.id;

const sameFinding = (
  left: {
    readonly projectId: string;
    readonly findingId: string;
    readonly findingRevision: number;
  },
  right: {
    readonly projectId: string;
    readonly findingId: string;
    readonly findingRevision: number;
  },
): boolean =>
  left.projectId === right.projectId &&
  left.findingId === right.findingId &&
  left.findingRevision === right.findingRevision;

export class InMemoryDiscoveryFeedbackRepository implements DiscoveryFeedbackRepositoryPort {
  private readonly feedback = new Map<string, DiscoveryFeedbackEventV1>();
  private readonly suppressions = new Map<string, DiscoverySuppressionDirectiveV1>();
  private readonly rankingPolicies = new Map<string, DiscoveryRankingPolicyRevisionV1>();

  async appendFeedback(event: DiscoveryFeedbackEventV1): Promise<'CREATED' | 'CONFLICT'> {
    const normalized = assertDiscoveryFeedbackEventV1(event);
    const key = `${normalized.projectId}\u0000${normalized.feedbackId}`;
    if (this.feedback.has(key)) return 'CONFLICT';
    this.feedback.set(key, clone(normalized));
    return 'CREATED';
  }

  async listFeedbackForFinding(
    lookup: DiscoveryFeedbackFindingLookupV1,
  ): Promise<readonly DiscoveryFeedbackEventV1[]> {
    const projectId = assertProjectId(lookup.projectId);
    return [...this.feedback.values()]
      .filter((event) => sameFinding(event, { ...lookup, projectId }))
      .sort(
        (left, right) =>
          timestamp(left.createdAt) - timestamp(right.createdAt) ||
          left.feedbackId.localeCompare(right.feedbackId),
      )
      .map(clone);
  }

  async appendSuppression(
    directive: DiscoverySuppressionDirectiveV1,
  ): Promise<'CREATED' | 'CONFLICT'> {
    const normalized = assertDiscoverySuppressionDirectiveV1(directive);
    const key = `${normalized.projectId}\u0000${normalized.suppressionId}`;
    if (this.suppressions.has(key)) return 'CONFLICT';
    this.suppressions.set(key, clone(normalized));
    return 'CREATED';
  }

  async listRelevantSuppression(
    lookup: DiscoverySuppressionLookupV1,
  ): Promise<readonly DiscoverySuppressionDirectiveV1[]> {
    const projectId = assertProjectId(lookup.projectId);
    const principalId = assertPrincipalId(lookup.principalId);
    const at = lookup.at === undefined ? Date.now() : timestamp(lookup.at);
    if (!Number.isFinite(at)) throw new TypeError('at must be a valid date-time');
    return [...this.suppressions.values()]
      .filter((directive) => {
        if (directive.projectId !== projectId || subjectId(directive) !== principalId) return false;
        if (directive.expiresAt !== undefined && timestamp(directive.expiresAt) <= at) return false;
        const findingMatches =
          directive.projectId === projectId &&
          directive.sourceFindingId === lookup.findingId &&
          directive.sourceFindingRevision === lookup.findingRevision;
        if (directive.scope === 'FINDING' && !findingMatches) return false;
        if (directive.suppressionKind === 'SNOOZE') return true;
        if (directive.suppressionKind === 'SUPPRESS_EXACT') {
          return (
            lookup.fingerprint !== undefined &&
            lookup.fingerprintVersion !== undefined &&
            directive.fingerprint === lookup.fingerprint &&
            directive.fingerprintVersion === lookup.fingerprintVersion
          );
        }
        // Similarity is never inferred here. A later, project-scoped matcher
        // explicitly selects the version whose candidate directives it needs.
        return (
          lookup.semanticMatcherVersion !== undefined &&
          directive.matcherVersion === lookup.semanticMatcherVersion
        );
      })
      .sort(
        (left, right) =>
          timestamp(left.createdAt) - timestamp(right.createdAt) ||
          left.suppressionId.localeCompare(right.suppressionId),
      )
      .map(clone);
  }

  async insertRankingPolicyRevision(
    policy: DiscoveryRankingPolicyRevisionV1,
  ): Promise<'CREATED' | 'CONFLICT'> {
    const normalized = assertDiscoveryRankingPolicyRevisionV1(policy);
    const key = `${normalized.policyId}\u0000${normalized.policyRevision}`;
    if (this.rankingPolicies.has(key)) return 'CONFLICT';
    this.rankingPolicies.set(key, clone(normalized));
    return 'CREATED';
  }

  async listRankingPolicyRevisions(
    lookup: DiscoveryRankingPolicyLookupV1,
  ): Promise<readonly DiscoveryRankingPolicyRevisionV1[]> {
    assertProjectId(lookup.projectId);
    const policyId = assertPolicyId(lookup.policyId);
    const at = lookup.at === undefined ? Number.POSITIVE_INFINITY : timestamp(lookup.at);
    if (!Number.isFinite(at) && at !== Number.POSITIVE_INFINITY) {
      throw new TypeError('at must be a valid date-time');
    }
    return [...this.rankingPolicies.values()]
      .filter((policy) => policy.policyId === policyId && timestamp(policy.effectiveFrom) <= at)
      .sort(
        (left, right) =>
          timestamp(right.effectiveFrom) - timestamp(left.effectiveFrom) ||
          right.policyRevision - left.policyRevision,
      )
      .map(clone);
  }

  async resolveEffectiveRankingPolicy(
    lookup: DiscoveryRankingPolicyLookupV1,
  ): Promise<DiscoveryRankingPolicyRevisionV1 | undefined> {
    return (await this.listRankingPolicyRevisions(lookup))[0];
  }
}
