import { describe, expect, it, vi } from 'vitest';

import { InMemoryActionCenterProjection } from '../../../adapters/frontend-product-read-in-memory/src/index.js';
import { CoordinatorActionCenterAttentionProjection } from './action-center-attention-projection.js';

const now = '2026-08-14T01:00:00.000Z';
const project = {
  id: 'project-1',
  label: 'Project One',
  isOwner: true,
  sensitivityClearance: 'private' as const,
};
const scope = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: project,
  accessibleProjects: [project],
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  accessScope: ['owner'],
};

describe('CoordinatorActionCenterAttentionProjection', () => {
  it('projects existing bounded read models into sorted navigation-only owner attention', async () => {
    const review = {
      listReviewQueue: vi.fn(async () => ({
        schemaVersion: '1.0.0' as const,
        acceptedContext: {
          schemaVersion: '1.0.0' as const,
          resourceProjectId: project.id,
          accessRevision: scope.accessRevision,
          policyContextRevision: scope.policyContextRevision,
        },
        queueSnapshotRevision: 'queue-1',
        items: [
          {
            schemaVersion: '1.0.0' as const,
            reviewContextId: 'review-1',
            contextRevision: 2,
            targetKind: 'KNOWLEDGE_OPERATION' as const,
            targetId: 'target-1',
            targetLabel: 'Review the project brief',
            aggregateState: 'PENDING' as const,
            itemCount: 1,
            updatedAt: now,
            attentionReasons: ['REQUIRES_ACTION' as const],
            capabilities: ['READ_CONTEXT' as const],
          },
          {
            schemaVersion: '1.0.0' as const,
            reviewContextId: 'restricted-1',
            contextRevision: 1,
            targetKind: 'KNOWLEDGE_OPERATION' as const,
            targetId: 'hidden-target',
            targetLabel: 'Must not disclose',
            aggregateState: 'ACCESS_RESTRICTED' as const,
            itemCount: 0,
            updatedAt: now,
            attentionReasons: ['ACCESS_RESTRICTED' as const],
            capabilities: [] as const,
          },
        ],
        totalCountStatus: 'EXACT' as const,
        capabilities: ['LIST_QUEUE' as const],
      })),
    };
    const externalAction = {
      listExternalActions: vi.fn(async () => ({
        schemaVersion: '1.0.0' as const,
        items: [
          {
            schemaVersion: '1.0.0' as const,
            actionId: 'action-1',
            actionRevision: 3,
            operation: 'UPDATE_REVERSIBLE' as const,
            resourceProjectId: project.id,
            effectiveProjectId: project.id,
            status: 'OUTCOME_UNKNOWN' as const,
            aggregateState: 'AVAILABLE' as const,
            capabilities: [] as const,
            riskLevel: 'R2' as const,
            updatedAt: '2026-08-14T02:00:00.000Z',
          },
        ],
        capabilities: [] as const,
      })),
    };
    const activity = {
      listActivityQueue: vi.fn(async () => ({
        items: [
          {
            root: {
              schemaVersion: '1.0.0' as const,
              rootKind: 'JOB' as const,
              activityId: 'activity-1',
              domainKind: 'SOURCES' as const,
              domainResourceKind: 'IntakeSubmission',
              domainResourceId: 'submission-1',
              resourceProjectId: project.id,
              resourceHref: '/sources',
              jobId: 'job-1',
              runId: 'run-1',
            },
            summary: 'Source processing failed',
            state: 'FAILED' as const,
            dimensions: {
              schemaVersion: '1.0.0' as const,
              attention: 'NEEDS_ATTENTION' as const,
              failure: {
                schemaVersion: '1.0.0' as const,
                kind: 'TRANSIENT' as const,
                code: 'SOURCE_TEMPORARY_FAILURE',
                message: 'The source could not be processed. Try again.',
                occurredAt: now,
              },
              retryability: 'RETRYABLE' as const,
              freshness: 'CURRENT' as const,
              adapterStatus: 'AVAILABLE' as const,
            },
            updatedAt: now,
          },
        ],
        metadata: {
          schemaVersion: '1.0.0' as const,
          snapshotRevision: 1,
          generatedAt: now,
          sourceUpdatedAt: now,
          freshness: 'CURRENT' as const,
          adapterStatus: 'AVAILABLE' as const,
          partial: false,
        },
      })),
    };

    const attention = new CoordinatorActionCenterAttentionProjection(
      review as never,
      externalAction as never,
      activity as never,
    );
    const home = await new InMemoryActionCenterProjection(attention).getHome(scope);

    expect(home.attention.map((item) => item.label)).toEqual([
      'Resolve an unknown external outcome',
      'Source processing failed',
      'Review the project brief',
    ]);
    expect(home.attention.map((item) => item.targetRoute)).toEqual([
      { routeId: 'external-action', href: '/external-action' },
      { routeId: 'activity', href: '/activity' },
      { routeId: 'review', href: '/review' },
    ]);
    expect(home.attention.some((item) => item.label === 'Must not disclose')).toBe(false);
    expect(home.attention.every((item) => !('command' in item))).toBe(true);
    expect(review.listReviewQueue).toHaveBeenCalledWith(
      expect.objectContaining({ activeProjectId: project.id, accessScope: ['owner'] }),
      expect.objectContaining({
        attentionReasons: ['REQUIRES_ACTION', 'STALE', 'OUTCOME_UNKNOWN', 'DEPENDENCY_BLOCKED'],
      }),
    );
    expect(activity.listActivityQueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ attention: 'NEEDS_ATTENTION' }),
    );
  });
});
