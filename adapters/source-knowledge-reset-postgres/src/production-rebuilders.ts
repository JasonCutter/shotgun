import type { Pool } from 'pg';

import { PostgresCandidateRepository } from '../../../adapters/postgres-stage4/src/index.js';
import {
  PostgresChangeSetReviewV2Repository,
  PostgresComparisonV2Repository,
} from '../../../adapters/postgres-stage5/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../../adapters/postgres-stage6/src/index.js';
import { PostgresActionExecutionRepository } from '../../../adapters/postgres-stage11/src/index.js';
import {
  PostgresSettingsRepository,
  PostgresPolicyHistoryReadAdapter,
} from '../../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../../adapters/postgres-auth/src/index.js';
import { PostgresAskActivityRead } from '../../../adapters/frontend-ask-execution-postgres/src/activity-read.js';
import { PostgresExternalActionStore } from '../../../adapters/frontend-external-action-postgres/src/index.js';
import { PostgresFrontendReviewRepository } from '../../../adapters/frontend-review-postgres/src/index.js';
import { PostgresDiscoveryRuntimeRepository } from '../../../adapters/discovery-runtime-postgres/src/index.js';
import { PostgresSourcesActivityRead } from '../../../adapters/frontend-sources-write-postgres/src/activity-read.js';
import { PostgresPayloadStateStore } from '../../../adapters/frontend-history-postgres/src/index.js';
import { createProjectActivityResetRebuilder } from './activity-reset-rebuilder.js';
import { createProjectHistoryResetRebuilder } from './history-reset-rebuilder.js';
import { PostgresKnowledgeResetPersistence } from './index.js';
import type { PostgresKnowledgeResetRebuilders } from './maintenance-composition.js';
import { createPostgresProjectProjectionResetRebuilder } from './projection-reset-rebuilder.js';

import {
  type ActivityAdapterPort,
  type ActivityAdapterRegistryPort,
} from '../../../modules/frontend-activity/src/index.js';
import {
  createHistoryAdapterRegistry,
  type HistoryAdapterRegistryPort,
} from '../../../modules/frontend-history/src/index.js';
import { createInMemoryHistoryReadModelStore } from '../../../adapters/frontend-history-in-memory/src/index.js';
import { createInMemoryActivityReadModelStore } from '../../../adapters/frontend-activity-in-memory/src/index.js';
import { SourcesActivityAdapter } from '../../../adapters/frontend-activity-sources/src/index.js';
import { AskActivityAdapter } from '../../../adapters/frontend-activity-ask/src/index.js';
import { DiscoveryActivityAdapter } from '../../../adapters/frontend-activity-discovery/src/index.js';
import { ExternalActionActivityAdapter } from '../../../adapters/frontend-activity-external-action/src/index.js';
import { ComparisonActivityAdapter } from '../../../adapters/frontend-activity-comparison/src/index.js';
import { CanonicalHistoryAdapter } from '../../../adapters/frontend-history-canonical/src/index.js';
import { ReviewHistoryAdapter } from '../../../adapters/frontend-history-review/src/index.js';
import { ExternalActionHistoryAdapter } from '../../../adapters/frontend-history-external-action/src/index.js';
import { PolicyHistoryAdapter } from '../../../adapters/frontend-history-policy/src/index.js';
import { withActionReviewActivity } from '../../../assemblies/shotgun-app/src/server.js';

const createActivityRegistry = (pool: Pool): ActivityAdapterRegistryPort => {
  const externalAction = new PostgresExternalActionStore(pool);
  const actionFeedback = new PostgresActionExecutionRepository(pool);
  const comparison = new PostgresComparisonV2Repository(pool, { writeEnabled: false });
  const candidates = new PostgresCandidateRepository(pool);
  const sources = new SourcesActivityAdapter(
    new PostgresSourcesActivityRead(pool, {
      async getSubmission() {
        // All Sources submissions must already be erased. Treat an unexpected
        // surviving queue row as an unavailable adapter so rebuild fails closed.
        throw new Error('Source submission remained after the approved reset purge.');
      },
    }),
  );
  const adapters: readonly ActivityAdapterPort[] = [
    sources,
    new AskActivityAdapter(new PostgresAskActivityRead(pool)),
    new DiscoveryActivityAdapter(new PostgresDiscoveryRuntimeRepository(pool)),
    new ComparisonActivityAdapter(
      comparison.blockedOutcomes,
      comparison.terminalAnalysis,
      candidates,
    ),
    withActionReviewActivity(new ExternalActionActivityAdapter(externalAction), actionFeedback),
  ];
  return {
    adapters,
    adapterFor(domainKind) {
      return adapters.find((adapter) => adapter.domainKind === domainKind);
    },
    healthSummaries() {
      return Object.fromEntries(adapters.map((adapter) => [adapter.adapterId, adapter.health()]));
    },
  };
};

const createHistoryRegistry = (pool: Pool): HistoryAdapterRegistryPort => {
  const canonical = new PostgresCanonicalKnowledgeRepository(pool);
  const review = new PostgresFrontendReviewRepository(pool);
  const externalAction = new PostgresExternalActionStore(pool);
  return createHistoryAdapterRegistry([
    new CanonicalHistoryAdapter(canonical, new PostgresPayloadStateStore(pool, 'CANONICAL')),
    new ReviewHistoryAdapter(
      review,
      new PostgresPayloadStateStore(pool, 'REVIEW'),
      undefined,
      new PostgresChangeSetReviewV2Repository(pool),
    ),
    new ExternalActionHistoryAdapter(
      externalAction,
      new PostgresPayloadStateStore(pool, 'EXTERNAL_ACTION'),
    ),
    new PolicyHistoryAdapter(
      new PostgresPolicyHistoryReadAdapter(pool),
      new PostgresPayloadStateStore(pool, 'SETTINGS'),
    ),
  ]);
};

/** Build the exact production owner projections against runtime read ports. */
export const createPostgresKnowledgeResetProductionRebuilders = (input: {
  readonly runtimePool: Pool;
  readonly executorPool: Pool;
}): PostgresKnowledgeResetRebuilders => {
  const { runtimePool, executorPool } = input;
  const resetPersistence = new PostgresKnowledgeResetPersistence(runtimePool);
  const auth = new PostgresAuthRepository(runtimePool);
  const settings = new PostgresSettingsRepository(runtimePool);
  const activityRegistry = createActivityRegistry(runtimePool);
  const historyRegistry: HistoryAdapterRegistryPort = createHistoryRegistry(runtimePool);
  return {
    activity: createProjectActivityResetRebuilder({
      registry: activityRegistry,
      createCaptureStore: createInMemoryActivityReadModelStore,
      async resolveScope(context) {
        const actorPrincipalId = await resetPersistence.readResetActorPrincipalId(
          context.projectId,
          context.requestId,
        );
        if (!actorPrincipalId) {
          throw new Error('Approved Source reset actor identity is unavailable.');
        }
        const membership = await auth.findMembership(actorPrincipalId, context.projectId);
        if (!membership || !membership.isOwner) {
          throw new Error('Approved Source reset actor is no longer a Project Owner.');
        }
        const projectSettings = await settings.getSettingsSnapshot(context.projectId);
        return {
          principalId: actorPrincipalId,
          activeProjectId: context.projectId,
          accessRevision: `${context.projectId}:${membership.scopes.slice().sort().join(',')}`,
          policyContextRevision: String(projectSettings.policyContextRevision),
          accessScope: [...membership.scopes].sort(),
          sensitivityClearance: membership.sensitivityClearance,
        };
      },
    }),
    history: createProjectHistoryResetRebuilder({
      registry: historyRegistry,
      createCaptureStore: createInMemoryHistoryReadModelStore,
    }),
    projection: createPostgresProjectProjectionResetRebuilder({ runtimePool, executorPool }),
  };
};
