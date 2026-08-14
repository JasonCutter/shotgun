import type {
  ActionCenterItem,
  ActivityQueueItemV1,
  ExternalActionAggregateStatusV1,
  ExternalActionQueueItemV1,
  ReviewQueueItemV1,
  TargetRouteView,
} from '../../../packages/contracts/src/index.js';
import type {
  ActionCenterAttentionProjectionPort,
  FrontendReadScope,
} from '../../../modules/frontend-product-read/src/index.js';
import type { FrontendReviewProductCoordinator } from '../../../modules/frontend-review/src/index.js';
import type { FrontendExternalActionProductCoordinator } from '../../../modules/frontend-external-action/src/index.js';
import type { ActivityProductCoordinator } from '../../../modules/frontend-activity/src/index.js';

type ReviewAttentionReader = Pick<FrontendReviewProductCoordinator, 'listReviewQueue'>;
type ExternalActionAttentionReader = Pick<
  FrontendExternalActionProductCoordinator,
  'listExternalActions'
>;
type ActivityAttentionReader = Pick<ActivityProductCoordinator, 'listActivityQueue'>;

const route = (
  routeId: TargetRouteView['routeId'],
  href: TargetRouteView['href'],
): TargetRouteView => ({
  routeId,
  href,
});

const reviewReason = (item: ReviewQueueItemV1): string => {
  if (item.attentionReasons.includes('OUTCOME_UNKNOWN')) {
    return 'The result is not known yet. Open Review to resolve it safely.';
  }
  if (item.attentionReasons.includes('STALE')) {
    return 'This review changed and needs to be checked again.';
  }
  if (item.attentionReasons.includes('DEPENDENCY_BLOCKED')) {
    return 'A related decision must be resolved before this review can continue.';
  }
  return 'A decision is waiting for you.';
};

const externalPresentation = (
  status: ExternalActionAggregateStatusV1,
): { readonly label: string; readonly reason: string; readonly priority: number } | null => {
  switch (status) {
    case 'MANIFEST_READY':
      return {
        label: 'Review an external action',
        reason: 'Approval is required before anything can be sent or changed.',
        priority: 90,
      };
    case 'READY_TO_EXECUTE':
      return {
        label: 'Continue an approved external action',
        reason: 'The approved action is ready for an explicit owner decision.',
        priority: 85,
      };
    case 'VERIFYING':
      return {
        label: 'Check external action verification',
        reason: 'Verification is still in progress.',
        priority: 75,
      };
    case 'PREFLIGHT_FAILED':
    case 'FAILED':
      return {
        label: 'Resolve a failed external action',
        reason: 'The action failed and needs owner attention.',
        priority: 95,
      };
    case 'VERIFICATION_FAILED':
      return {
        label: 'Resolve failed verification',
        reason: 'The external result could not be verified.',
        priority: 100,
      };
    case 'OUTCOME_UNKNOWN':
      return {
        label: 'Resolve an unknown external outcome',
        reason: 'The result is unknown. Verify it before retrying or changing anything.',
        priority: 110,
      };
    case 'ROLLBACK_AVAILABLE':
      return {
        label: 'Review rollback options',
        reason: 'A rollback is available for this external action.',
        priority: 80,
      };
    case 'COMPENSATION_REQUIRED':
      return {
        label: 'Resolve required compensation',
        reason: 'The external action requires owner-led recovery.',
        priority: 105,
      };
    default:
      return null;
  }
};

const activityReason = (item: ActivityQueueItemV1): string => {
  if (item.dimensions.failure) return item.dimensions.failure.message;
  if (item.state === 'OUTCOME_UNKNOWN') return 'The result is unknown and needs to be checked.';
  if (item.state === 'WAITING_FOR_USER') return 'This work is waiting for your input.';
  if (item.dimensions.freshness === 'STALE') return 'The status is stale and needs a refresh.';
  if (item.dimensions.adapterStatus !== 'AVAILABLE') {
    return 'Part of this work is temporarily unavailable.';
  }
  return 'This work needs attention.';
};

export class CoordinatorActionCenterAttentionProjection implements ActionCenterAttentionProjectionPort {
  constructor(
    private readonly review: ReviewAttentionReader,
    private readonly externalAction: ExternalActionAttentionReader,
    private readonly activity: ActivityAttentionReader,
  ) {}

  async listAttention(
    input: FrontendReadScope & {
      readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
    },
  ): Promise<readonly ActionCenterItem[]> {
    const accessScope = input.accessScope ?? [];
    const [reviews, externalActions, activities] = await Promise.all([
      this.review.listReviewQueue(
        {
          principalId: input.principalId,
          sessionId: input.sessionId,
          activeProjectId: input.activeProject.id,
          accessRevision: input.accessRevision,
          policyContextRevision: input.policyContextRevision,
          sensitivityClearance: input.activeProject.sensitivityClearance,
          accessScope,
        },
        {
          schemaVersion: '1.0.0',
          pageSize: 50,
          attentionReasons: ['REQUIRES_ACTION', 'STALE', 'OUTCOME_UNKNOWN', 'DEPENDENCY_BLOCKED'],
        },
      ),
      this.externalAction.listExternalActions(
        {
          principalId: input.principalId,
          actor: {
            schemaVersion: '1.0.0',
            principalId: input.principalId,
            actorId: input.principalId,
          },
          activeProjectId: input.activeProject.id,
          accessRevision: input.accessRevision,
          policyContextRevision: input.policyContextRevision,
          accessScope,
        },
        { schemaVersion: '1.0.0', pageSize: 50 },
      ),
      this.activity.listActivityQueue(
        {
          principalId: input.principalId,
          activeProjectId: input.activeProject.id,
          accessRevision: input.accessRevision,
          policyContextRevision: input.policyContextRevision,
          accessScope,
          sensitivityClearance: input.activeProject.sensitivityClearance,
        },
        { schemaVersion: '1.0.0', attention: 'NEEDS_ATTENTION', limit: 50 },
      ),
    ]);

    const reviewItems: ActionCenterItem[] = reviews.items
      .filter((item) => !item.attentionReasons.includes('ACCESS_RESTRICTED'))
      .map((item) => ({
        stableId: `review:${item.reviewContextId}:${item.contextRevision}`,
        kind: 'REVIEW_DECISION',
        label: item.targetLabel,
        priority: item.attentionReasons.includes('OUTCOME_UNKNOWN') ? 100 : 80,
        reason: reviewReason(item),
        projectId: input.activeProject.id,
        resourceId: item.reviewContextId,
        targetRoute: route('review', '/review'),
        createdAt: item.updatedAt,
      }));

    const externalItems: ActionCenterItem[] = externalActions.items.flatMap(
      (item: ExternalActionQueueItemV1) => {
        const presentation = externalPresentation(item.status);
        if (!presentation || item.aggregateState === 'ACCESS_RESTRICTED') return [];
        return [
          {
            stableId: `external-action:${item.actionId}:${item.actionRevision}`,
            kind: 'EXTERNAL_ACTION_ATTENTION',
            ...presentation,
            projectId: input.activeProject.id,
            resourceId: item.actionId,
            targetRoute: route('external-action', '/external-action'),
            createdAt: item.updatedAt,
          },
        ];
      },
    );

    const activityItems: ActionCenterItem[] = activities.items
      .filter((item) => item.root.domainKind !== 'EXTERNAL_ACTION')
      .map((item) => ({
        stableId: `activity:${item.root.domainKind}:${item.root.activityId}`,
        kind: 'FAILED_OR_BLOCKED_WORK',
        label: item.summary,
        priority: item.state === 'OUTCOME_UNKNOWN' ? 100 : item.state === 'FAILED' ? 90 : 70,
        reason: activityReason(item),
        projectId: input.activeProject.id,
        resourceId: item.root.activityId,
        targetRoute: route('activity', '/activity'),
        createdAt: item.updatedAt,
      }));

    return [...reviewItems, ...externalItems, ...activityItems].sort(
      (left, right) =>
        right.priority - left.priority ||
        Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
        left.stableId.localeCompare(right.stableId),
    );
  }
}
