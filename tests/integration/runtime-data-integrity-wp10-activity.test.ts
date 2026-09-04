import { describe, expect, it } from 'vitest';

import { InMemoryExternalActionStore } from '../../adapters/frontend-external-action-in-memory/src/index.js';
import { ExternalActionActivityAdapter } from '../../adapters/frontend-activity-external-action/src/index.js';
import {
  DiscoveryActivityAdapter,
  InMemoryDiscoveryActivityRead,
} from '../../adapters/frontend-activity-discovery/src/index.js';
import { InMemoryActionFeedbackReviewRepository } from '../../modules/action-feedback-review/src/index.js';
import { withActionReviewActivity } from '../../assemblies/shotgun-app/src/server.js';
import type {
  ActivityAdapterScopeV1,
  DiscoveryActivityReadPort,
} from '../../modules/frontend-activity/src/index.js';

const activityScope: ActivityAdapterScopeV1 = {
  principalId: 'principal-wp10',
  activeProjectId: 'project-wp10',
  accessRevision: 'access-wp10',
  policyContextRevision: 'policy-wp10',
  accessScope: ['action:read'],
};

class DiagnosticDiscoveryActivityRead extends InMemoryDiscoveryActivityRead {
  async getSemanticEssenceDiagnosticAggregate() {
    return {
      diagnosticCount: 2,
      excludedCount: 3,
      candidateCount: 7,
      completion: 'PARTIAL' as const,
      updatedAt: '2026-09-04T00:00:04.000Z',
    };
  }
}

describe('WP-10 Activity diagnostic boundary', () => {
  it('keeps the diagnostic read surface aggregate-only and project scoped', () => {
    const read: DiscoveryActivityReadPort = {} as DiscoveryActivityReadPort;
    expect('getSemanticEssenceDiagnosticAggregate' in read).toBe(false);
    // The public Activity contract is unchanged: no diagnostic payload/body or
    // new Review target is introduced by this work package.
    expect(Object.keys(read)).not.toContain('rawError');
  });

  it('overlays pending Action review on an existing authorized root only', async () => {
    const store = new InMemoryExternalActionStore();
    await store.transaction(async (repositories) => {
      await repositories.aggregates.insert({
        schemaVersion: '1.0.0',
        actionId: 'action-wp10',
        actionRevision: 1,
        operation: 'UPDATE_REVERSIBLE',
        resourceProjectId: 'project-wp10',
        effectiveProjectId: 'project-wp10',
        accessRevision: 'access-wp10',
        policyContextRevision: 'policy-wp10',
        status: 'FAILED',
        aggregateState: 'AVAILABLE',
        accessMasking: 'VISIBLE',
        maskedFields: [],
        capabilities: ['READ_EXTERNAL_ACTION'],
        updatedAt: '2026-09-04T00:00:00.000Z',
        createdAt: '2026-09-04T00:00:00.000Z',
      });
    });

    const reviewRepository = new InMemoryActionFeedbackReviewRepository();
    const adapter = withActionReviewActivity(
      new ExternalActionActivityAdapter(store),
      reviewRepository,
    );
    const initial = await adapter.readQueue(activityScope, { limit: 10 });
    expect(initial.items).toHaveLength(1);
    expect(initial.items[0]!.dimensions.attention).toBe('NONE');

    await reviewRepository.upsertFromFeedback({
      projectId: 'project-wp10',
      semanticKey: 'action-feedback:action-wp10:FAILED',
      actionId: 'action-wp10',
      outcome: 'FAILED',
      phase: 'ACTION_REVIEW',
      evidenceRef: 'action-audit:action-wp10:FAILED',
      feedbackOccurredAt: '2026-09-04T00:00:01.000Z',
      now: '2026-09-04T00:00:01.000Z',
    });

    const queue = await adapter.readQueue(activityScope, { limit: 10 });
    expect(queue.items[0]!.root.domainResourceId).toBe('action-wp10');
    expect(queue.items[0]!.dimensions.attention).toBe('NEEDS_ATTENTION');
    expect(
      (await adapter.readQueue(activityScope, { limit: 10, attention: 'NEEDS_ATTENTION' })).items,
    ).toHaveLength(1);
    const detail = await adapter.readDetail(activityScope, queue.items[0]!.root);
    expect(detail.dimensions.attention).toBe('NEEDS_ATTENTION');

    const otherProject = await adapter.readQueue(
      { ...activityScope, activeProjectId: 'project-other' },
      { limit: 10 },
    );
    expect(otherProject.items).toHaveLength(0);
  });

  it('exposes one aggregate diagnostic event without numeric analysis progress', async () => {
    const read = new DiagnosticDiscoveryActivityRead();
    const job = {
      schemaVersion: '1.0.0',
      jobId: 'job-wp10-discovery',
      logicalIdentity: {
        schemaVersion: '1.0.0',
        identityVersion: 'discovery-job-logical:v1',
        value: 'logical-wp10-discovery',
      },
      projectId: 'project-wp10',
      trigger: {
        schemaVersion: '1.0.0',
        triggerId: 'trigger-wp10',
        triggerClass: 'MANUAL',
        triggerIdentity: { kind: 'MANUAL', commandId: 'command-wp10', requestId: 'request-wp10' },
        projectId: 'project-wp10',
        requestedScanMode: 'INCREMENTAL',
        effectiveScanMode: 'INCREMENTAL',
        canonicalBase: {
          schemaVersion: '1.0.0',
          canonicalVersion: 1,
          snapshotDigest: 'sha256:' + '1'.repeat(64),
        },
        requiredDiscoveryBase: {
          schemaVersion: '1.0.0',
          projectionRevision: 'projection-wp10',
          projectionDigest: 'sha256:' + '2'.repeat(64),
        },
        policyRevision: 'policy-wp10',
        strategyRevision: 'strategy-wp10',
        createdAt: '2026-09-04T00:00:00.000Z',
        observedAt: '2026-09-04T00:00:00.000Z',
        correlationId: 'correlation-wp10',
        actor: { actorId: 'actor-wp10', principalId: 'principal-wp10' },
      },
      requestedScanMode: 'INCREMENTAL',
      effectiveScanMode: 'INCREMENTAL',
      canonicalBase: {
        schemaVersion: '1.0.0',
        canonicalVersion: 1,
        snapshotDigest: 'sha256:' + '1'.repeat(64),
      },
      requiredDiscoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: 'projection-wp10',
        projectionDigest: 'sha256:' + '2'.repeat(64),
      },
      policyRevision: 'policy-wp10',
      strategyRevision: 'strategy-wp10',
      budget: {
        schemaVersion: '1.0.0',
        budgetVersion: 'discovery-work-budget:v1',
        budgetId: 'budget-wp10',
        budgetRevision: 'budget-wp10:1',
        maxResources: 10,
        maxSemanticNeighbors: 10,
        maxCandidatePairs: 10,
        maxCandidateGroups: 10,
        maxFindings: 10,
        maxProviderCalls: 1,
        maxInputTokens: 100,
        maxOutputTokens: 100,
        maxOutputTokensPerCall: 100,
        maxEstimatedCostMicros: 100,
        maxConcurrentProviderCalls: 1,
        deadlineAt: '2099-01-01T00:00:00.000Z',
      },
      lifecycleState: 'PARTIAL',
      lifecycleRevision: 2,
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:03.000Z',
    };
    const run = {
      ...job,
      runId: 'run-wp10-discovery',
      jobId: job.jobId,
      runRevision: 1,
      lifecycleState: 'PARTIAL',
      lifecycleRevision: 2,
      createdAt: '2026-09-04T00:00:01.000Z',
      updatedAt: '2026-09-04T00:00:03.000Z',
      completedAt: '2026-09-04T00:00:03.000Z',
    };
    read.seedJob(job as never);
    read.seedRun(run as never);
    const adapter = new DiscoveryActivityAdapter(read);
    const root = {
      schemaVersion: '1.0.0' as const,
      rootKind: 'JOB' as const,
      activityId: job.jobId,
      domainKind: 'DISCOVERY' as const,
      domainResourceKind: 'DiscoveryJob',
      domainResourceId: job.jobId,
      resourceProjectId: 'project-wp10',
      resourceHref: '/activity',
      jobId: job.jobId,
      runId: run.runId,
    };
    const detail = await adapter.readDetail(activityScope, root);
    expect(detail.dimensions.progress).toBeUndefined();
    const diagnosticEvents = detail.events.filter((event) =>
      event.eventId.includes('semantic-essence-diagnostics'),
    );
    expect(diagnosticEvents).toHaveLength(1);
    expect(diagnosticEvents[0]).toMatchObject({
      category: 'PROGRESS',
      summary: 'Semantic-essence exclusions: 3/7 candidates; run completion PARTIAL.',
    });
    expect(JSON.stringify(diagnosticEvents[0])).not.toMatch(
      /HOSTILE_SENTINEL|prompt|source_text|provider_output|raw_error/iu,
    );
  });
});
