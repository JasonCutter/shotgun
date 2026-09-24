import type { Pool } from 'pg';

import {
  assertCompleteKnowledgeResetOwnerSet,
  createKnowledgeResetMaintenanceExecutor,
  type KnowledgeResetExecutionDependencies,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';
import { PostgresActionKnowledgeResetOwner } from './action-owner.js';
import {
  PostgresActivityKnowledgeResetOwner,
  type ProjectActivityResetRebuilder,
} from './activity-owner.js';
import { PostgresAiOutputKnowledgeResetOwner } from './ai-output-owner.js';
import { PostgresAskKnowledgeResetOwner } from './ask-owner.js';
import { PostgresAssetKnowledgeResetOwner } from './asset-owner.js';
import { PostgresCandidateKnowledgeResetOwner } from './candidate-owner.js';
import { PostgresCanonicalKnowledgeResetOwner } from './canonical-owner.js';
import { PostgresComparisonKnowledgeResetOwner } from './comparison-owner.js';
import { PostgresConnectorKnowledgeResetOwner } from './connector-owner.js';
import { PostgresDiscoveryKnowledgeResetOwner } from './discovery-owner.js';
import { PostgresEvidenceKnowledgeResetOwner } from './evidence-owner.js';
import { PostgresExternalActionKnowledgeResetOwner } from './external-action-owner.js';
import { PostgresFrontendCommandKnowledgeResetOwner } from './frontend-command-owner.js';
import {
  PostgresHistoryKnowledgeResetOwner,
  type ProjectHistoryResetRebuilder,
} from './history-owner.js';
import { PostgresIntakeKnowledgeResetOwner } from './intake-owner.js';
import { PostgresKnowledgeDraftResetOwner } from './knowledge-draft-owner.js';
import { PostgresKnowledgeGraphResetOwner } from './knowledge-graph-owner.js';
import { PostgresKnowledgeModelResetOwner } from './knowledge-owner.js';
import { PostgresProjectAuditKnowledgeResetOwner } from './project-audit-owner.js';
import {
  PostgresProjectionKnowledgeResetOwner,
  type ProjectProjectionRebuilder,
} from './projection-owner.js';
import { PostgresReviewKnowledgeResetOwner } from './review-owner.js';
import { PostgresSettingsKnowledgeResetOwner } from './settings-owner.js';
import { PostgresSourceProductKnowledgeResetOwner } from './source-product-owner.js';
import { PostgresTransformationKnowledgeResetOwner } from './transformation-owner.js';
import { PostgresValidationKnowledgeResetOwner } from './validation-owner.js';

export type PostgresKnowledgeResetRebuilders = Readonly<{
  activity: ProjectActivityResetRebuilder;
  history: ProjectHistoryResetRebuilder;
  projection: ProjectProjectionRebuilder;
}>;

/**
 * The one production owner composition for T3 maintenance. Rebuild adapters
 * are mandatory inputs so a command cannot quietly substitute an empty or
 * test-only projection after destructive owners have been added.
 */
export const composePostgresKnowledgeResetOwners = (
  pool: Pool,
  rebuilders: PostgresKnowledgeResetRebuilders,
): readonly KnowledgeResetOwnerPort[] =>
  assertCompleteKnowledgeResetOwnerSet([
    new PostgresExternalActionKnowledgeResetOwner(pool),
    new PostgresActionKnowledgeResetOwner(pool),
    new PostgresAskKnowledgeResetOwner(pool),
    new PostgresReviewKnowledgeResetOwner(pool),
    new PostgresKnowledgeDraftResetOwner(pool),
    new PostgresComparisonKnowledgeResetOwner(pool),
    new PostgresValidationKnowledgeResetOwner(pool),
    new PostgresCandidateKnowledgeResetOwner(pool),
    new PostgresAiOutputKnowledgeResetOwner(pool),
    new PostgresProjectionKnowledgeResetOwner(pool, rebuilders.projection),
    new PostgresKnowledgeGraphResetOwner(pool),
    new PostgresActivityKnowledgeResetOwner(pool, rebuilders.activity),
    new PostgresHistoryKnowledgeResetOwner(pool, rebuilders.history),
    new PostgresCanonicalKnowledgeResetOwner(pool),
    new PostgresDiscoveryKnowledgeResetOwner(pool),
    new PostgresKnowledgeModelResetOwner(pool),
    new PostgresSourceProductKnowledgeResetOwner(pool),
    new PostgresIntakeKnowledgeResetOwner(pool),
    new PostgresEvidenceKnowledgeResetOwner(pool),
    new PostgresTransformationKnowledgeResetOwner(pool),
    new PostgresAssetKnowledgeResetOwner(pool),
    new PostgresConnectorKnowledgeResetOwner(pool),
    new PostgresFrontendCommandKnowledgeResetOwner(pool),
    new PostgresProjectAuditKnowledgeResetOwner(pool),
    new PostgresSettingsKnowledgeResetOwner(pool),
  ]);

export const createPostgresKnowledgeResetMaintenanceExecutor = (input: {
  readonly pool: Pool;
  readonly rebuilders: PostgresKnowledgeResetRebuilders;
  readonly dependencies: Omit<KnowledgeResetExecutionDependencies, 'owners'>;
}) =>
  createKnowledgeResetMaintenanceExecutor({
    ...input.dependencies,
    owners: composePostgresKnowledgeResetOwners(input.pool, input.rebuilders),
  });
