import {
  FRONTEND_REVIEW_DOMAIN_VERSION,
  REVIEW_CONTEXT_ITEM_MAX,
  REVIEW_DEPENDENCY_EDGE_MAX,
  sha256Text,
  stableJson,
  type ReviewAggregateStateV1,
  type ReviewAttentionReasonV1,
  type ReviewContextRevisionV1,
  type ReviewDecisionIntentV1,
  type ReviewDecisionRecordV1,
  type ReviewDependencyV1,
  type ReviewItemDecisionStateV1,
  type ReviewItemV1,
  type ReviewSensitivityV1,
  type ReviewTargetKindV1,
} from '../../../packages/contracts/src/index.js';
import { reviewFailure } from './review-error.js';
import type { FrontendReviewScopeV1, ReviewSourceTargetV1 } from './review-target-port.js';
import type { ReviewContextRecordV1 } from './review-store-port.js';

/**
 * FE-P4-S1 pure Review domain logic. Aggregate state and dependency closure
 * are Server-derived and never accepted from the Browser.
 */

export const REVIEW_TERMINAL_INTENTS: readonly ReviewDecisionIntentV1[] = [
  'APPROVE',
  'REJECT',
  'REQUEST_REVISION',
];

/** Frozen bounded-contract maxima (Contract Snapshot §18), re-exported. */
export { REVIEW_CONTEXT_ITEM_MAX, REVIEW_DEPENDENCY_EDGE_MAX };

const SENSITIVITY_RANK: Record<ReviewSensitivityV1, number> = {
  NORMAL: 0,
  SENSITIVE: 1,
  RESTRICTED: 3,
};

const CLEARANCE_RANK: Record<string, number> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
  ALL: 4,
};

/** True when the given sensitivity clearance may read the item sensitivity. */
export const canReadSensitivity = (
  clearance: string | undefined,
  sensitivity: ReviewSensitivityV1,
): boolean => {
  const clearanceRank = clearance === undefined ? 0 : (CLEARANCE_RANK[clearance] ?? 0);
  return clearanceRank >= SENSITIVITY_RANK[sensitivity];
};

/**
 * Fail-closed sensitivity masking. Items whose sensitivity exceeds the
 * current clearance are removed before counts and descriptions are created;
 * a dependency touching a removed Item is removed with it so no hidden
 * identity leaks (Contract Snapshot §4/§5). A visible Item that depends on
 * hidden content is marked unavailable (`MASKED`) without leaking the hidden
 * identity.
 */
export const applySensitivityMasking = (
  context: ReviewContextRevisionV1,
  scope: Pick<FrontendReviewScopeV1, 'sensitivityClearance'>,
): ReviewContextRevisionV1 => {
  const visible = new Set<string>();
  const items = context.items.filter((item) => {
    const readable = canReadSensitivity(scope.sensitivityClearance, item.sensitivity);
    if (!readable) return false;
    visible.add(item.reviewItemId);
    return true;
  });
  // A visible Item that depends on hidden content is projected unavailable
  // (masked) without leaking the hidden identity (Contract Snapshot §5).
  // REQUIRES is directional: from = prerequisite, to = dependent. A visible
  // dependent (to) whose hidden prerequisite (from) is removed is
  // unavailable; a hidden dependent over a visible prerequisite does not
  // make the visible Item unavailable. ATOMIC_WITH / CONFLICTS_WITH are
  // symmetric, so either hidden endpoint makes the visible endpoint
  // unavailable.
  const touchesHidden = new Set<string>();
  for (const dependency of context.dependencies) {
    const fromVisible = visible.has(dependency.fromReviewItemId);
    const toVisible = visible.has(dependency.toReviewItemId);
    if (fromVisible === toVisible) continue;
    if (dependency.kind === 'REQUIRES') {
      if (!fromVisible && toVisible) touchesHidden.add(dependency.toReviewItemId);
    } else {
      if (fromVisible) touchesHidden.add(dependency.fromReviewItemId);
      if (toVisible) touchesHidden.add(dependency.toReviewItemId);
    }
  }
  const maskedItems = items.map((item) => {
    if (!touchesHidden.has(item.reviewItemId)) return item;
    return {
      ...item,
      accessMasking: 'MASKED' as const,
      maskedFields: ['label', 'rationale', 'before', 'after', 'expectedImpact'],
    };
  });
  const dependencies = context.dependencies.filter(
    (dependency) =>
      visible.has(dependency.fromReviewItemId) && visible.has(dependency.toReviewItemId),
  );
  return { ...context, items: maskedItems, dependencies };
};

/** True when an Item is not available for decisions in the current scope. */
export const isItemUnavailable = (item: ReviewItemV1): boolean =>
  item.accessMasking === 'HIDDEN' || item.accessMasking === 'MASKED';

export const isTerminalDecisionIntent = (intent: ReviewDecisionIntentV1): boolean =>
  intent === 'APPROVE' || intent === 'REJECT' || intent === 'REQUEST_REVISION';

/** Deterministic stable Review Context identity derived from the source. */
export const reviewContextIdForSource = (
  targetKind: ReviewTargetKindV1,
  reviewResourceId: string,
): string =>
  sha256Text(
    stableJson({
      domain: 'frontend-review',
      version: FRONTEND_REVIEW_DOMAIN_VERSION,
      kind: 'context',
      targetKind,
      reviewResourceId,
    }),
  );

/** Last decision wins per Item on the same context revision (HOLD supersedable). */
export const deriveItemDecisionState = (
  reviewItemId: string,
  decisions: readonly ReviewDecisionRecordV1[],
): ReviewItemDecisionStateV1 => {
  const itemDecisions = decisions.filter((decision) => decision.reviewItemId === reviewItemId);
  if (itemDecisions.length === 0) return 'PENDING';
  const latest = itemDecisions[itemDecisions.length - 1];
  if (!latest) return 'PENDING';
  switch (latest.intent) {
    case 'APPROVE':
      return 'APPROVED';
    case 'REJECT':
      return 'REJECTED';
    case 'REQUEST_REVISION':
      return 'REVISION_REQUESTED';
    case 'HOLD':
      return 'ON_HOLD';
  }
};

export const computeAggregateState = (input: {
  readonly items: readonly ReviewItemV1[];
  readonly decisions: readonly ReviewDecisionRecordV1[];
  readonly contextRevision: number;
  readonly targetKind: ReviewTargetKindV1;
}): ReviewAggregateStateV1 => {
  const currentDecisions = input.decisions.filter(
    (decision) => decision.contextRevision === input.contextRevision,
  );
  const itemStates = input.items.map((item) =>
    deriveItemDecisionState(item.reviewItemId, currentDecisions),
  );
  const rejected = itemStates.includes('REJECTED');
  const revisionRequested = itemStates.includes('REVISION_REQUESTED');
  const approvedCount = itemStates.filter((state) => state === 'APPROVED').length;
  const onHoldCount = itemStates.filter((state) => state === 'ON_HOLD').length;
  const pendingCount = itemStates.filter((state) => state === 'PENDING').length;

  if (rejected) return 'REJECTED';
  if (revisionRequested) return 'REVISION_REQUESTED';
  if (pendingCount === 0 && approvedCount === input.items.length) {
    return input.targetKind === 'DISCOVERY_CANDIDATE' ? 'ACCEPTED_FOR_AUTHORING' : 'APPROVED_READY';
  }
  if (approvedCount > 0) return 'PARTIALLY_DECIDED';
  if (pendingCount === 0 && onHoldCount > 0) return 'ON_HOLD';
  return 'PENDING';
};

/** Server-derived read view with staleness/access overlays. */
export const deriveContextView = (input: {
  readonly record: ReviewContextRecordV1;
  readonly currentSource: ReviewSourceTargetV1 | undefined;
  readonly scope: FrontendReviewScopeV1;
  readonly decisions: readonly ReviewDecisionRecordV1[];
}): {
  context: ReviewContextRevisionV1;
  aggregateState: ReviewAggregateStateV1;
  staleReason?: string;
} => {
  const context = input.record.context;
  const accessChanged = context.accessRevision !== input.scope.accessRevision;
  const policyChanged = context.policyContextRevision !== input.scope.policyContextRevision;
  const targetChanged =
    input.currentSource === undefined ||
    input.currentSource.targetRevision !== input.record.sourceRevision ||
    input.currentSource.targetDigest !== input.record.sourceDigest;

  let aggregateState: ReviewAggregateStateV1;
  let staleReason: string | undefined;
  let readableContext: ReviewContextRevisionV1;
  if (accessChanged || policyChanged) {
    // Fail-closed read: the protected payload (Items, dependencies,
    // capabilities) is not returned when access or policy changed. Only the
    // restricted shell with the ACCESS_RESTRICTED aggregate state is exposed
    // (Contract Snapshot §7/§13). Decisions/comments are suppressed by the
    // caller for the same reason.
    aggregateState = 'ACCESS_RESTRICTED';
    staleReason = accessChanged
      ? 'the access scope changed since this context was generated'
      : 'the policy context changed since this context was generated';
    readableContext = {
      ...context,
      items: [],
      dependencies: [],
      capabilities: [],
      aggregateState,
      staleReason,
    };
  } else {
    readableContext = applySensitivityMasking(context, input.scope);
    if (targetChanged) {
      aggregateState = 'STALE';
      staleReason = 'the reviewed target changed since this context was generated';
    } else {
      aggregateState = computeAggregateState({
        items: readableContext.items,
        decisions: input.decisions,
        contextRevision: context.contextRevision,
        targetKind: context.targetKind,
      });
      if (readableContext.items.length === 0) {
        aggregateState = 'UNAVAILABLE';
        staleReason = 'this context contains no visible Review Items';
      }
    }
  }
  return {
    context: { ...readableContext, aggregateState, staleReason },
    aggregateState,
    staleReason,
  };
};

export const deriveAttentionReasons = (
  aggregateState: ReviewAggregateStateV1,
  stale: boolean,
): readonly ReviewAttentionReasonV1[] => {
  const reasons: ReviewAttentionReasonV1[] = [];
  if (stale) reasons.push('STALE');
  if (aggregateState === 'PENDING' || aggregateState === 'PARTIALLY_DECIDED') {
    reasons.push('REQUIRES_ACTION');
  }
  if (aggregateState === 'ACCESS_RESTRICTED') reasons.push('ACCESS_RESTRICTED');
  if (aggregateState === 'UNAVAILABLE') reasons.push('OUTCOME_UNKNOWN');
  if (aggregateState === 'STALE') reasons.push('STALE');
  return [...new Set(reasons)];
};

/** ATOMIC_WITH connected components (Server-owned graph). */
export const atomicGroups = (
  dependencies: readonly ReviewDependencyV1[],
  itemIds: ReadonlySet<string>,
): readonly ReadonlySet<string>[] => {
  const atomicEdges = dependencies.filter((dependency) => dependency.kind === 'ATOMIC_WITH');
  const parent = new Map<string, string>();
  for (const itemId of itemIds) parent.set(itemId, itemId);
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (parent.get(root) !== root) {
      const next = parent.get(root);
      if (next === undefined) break;
      root = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const edge of atomicEdges) {
    if (itemIds.has(edge.fromReviewItemId) && itemIds.has(edge.toReviewItemId)) {
      union(edge.fromReviewItemId, edge.toReviewItemId);
    }
  }
  const components = new Map<string, Set<string>>();
  for (const itemId of itemIds) {
    const root = find(itemId);
    const component = components.get(root) ?? new Set<string>();
    component.add(itemId);
    components.set(root, component);
  }
  return [...components.values()];
};

/**
 * Rejects an illegal proposed approval set (§8 partial-approval rules) and
 * returns the approved dependency closure (sorted).
 */
export const validateProposedApprovalSet = (input: {
  readonly items: readonly ReviewItemV1[];
  readonly dependencies: readonly ReviewDependencyV1[];
  readonly approvedItemIds: ReadonlySet<string>;
  readonly previouslyApproved: ReadonlySet<string>;
}): readonly string[] => {
  const itemIds = new Set(input.items.map((item) => item.reviewItemId));
  for (const itemId of input.approvedItemIds) {
    const item = input.items.find((candidate) => candidate.reviewItemId === itemId);
    if (!item) {
      reviewFailure('REVIEW_ITEM_NOT_FOUND', 'The Review Item was not found.');
    }
    if (item?.accessMasking === 'HIDDEN') {
      reviewFailure(
        'REVIEW_ACCESS_CHANGED',
        'A hidden Review Item cannot be part of an approval set.',
      );
    }
  }

  for (const dependency of input.dependencies) {
    if (!itemIds.has(dependency.fromReviewItemId) || !itemIds.has(dependency.toReviewItemId)) {
      // Identity-free: never echo a Dependency or Item ID (a hidden identity
      // must never be exposed through validation errors, Contract §5).
      reviewFailure('REVIEW_DANGLING_REFERENCE', 'A dependency references a missing Review Item.');
    }
  }

  const approved = new Set<string>([...input.approvedItemIds, ...input.previouslyApproved]);

  for (const dependency of input.dependencies) {
    if (
      dependency.kind === 'REQUIRES' &&
      approved.has(dependency.toReviewItemId) &&
      !approved.has(dependency.fromReviewItemId)
    ) {
      // Identity-free: the unapproved prerequisite may be hidden, so no
      // Item/Dependency ID is ever echoed (Contract §5).
      reviewFailure(
        'REVIEW_DEPENDENCY_UNSATISFIED',
        'The approval set leaves a required dependency unapproved.',
      );
    }
    if (
      dependency.kind === 'CONFLICTS_WITH' &&
      approved.has(dependency.fromReviewItemId) &&
      approved.has(dependency.toReviewItemId)
    ) {
      reviewFailure(
        'REVIEW_CONFLICTING_APPROVAL_SET',
        'The approval set contains conflicting Review Items.',
      );
    }
  }

  for (const component of atomicGroups(input.dependencies, itemIds)) {
    const hasApprovedNow = [...component].some((itemId) => input.approvedItemIds.has(itemId));
    if (hasApprovedNow) {
      const missing = [...component].filter((itemId) => !input.approvedItemIds.has(itemId));
      if (missing.length > 0) {
        // Identity-free: the missing ATOMIC_WITH peers may be hidden.
        reviewFailure(
          'REVIEW_ATOMIC_GROUP_SPLIT',
          'An ATOMIC_WITH group cannot be partially approved.',
        );
      }
    }
  }

  // Dependency closure over REQUIRES edges.
  const closure = new Set<string>(input.approvedItemIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const dependency of input.dependencies) {
      if (
        dependency.kind === 'REQUIRES' &&
        closure.has(dependency.toReviewItemId) &&
        !closure.has(dependency.fromReviewItemId)
      ) {
        closure.add(dependency.fromReviewItemId);
        changed = true;
      }
    }
  }
  return [...closure].sort();
};

export { reviewApprovalManifestDigest } from '../../../packages/contracts/src/index.js';
