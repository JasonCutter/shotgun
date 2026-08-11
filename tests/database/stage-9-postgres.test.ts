import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  createPostgresPool,
  PostgresIntakeRepository,
  PostgresOriginalAssetRepository,
} from '../../adapters/postgres/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import { PostgresKnowledgeModelRepository } from '../../adapters/postgres-stage9/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { createEvidenceModule } from '../../modules/evidence/src/index.js';
import { createIntakeModule } from '../../modules/intake/src/index.js';
import { createKnowledgeModelModule } from '../../modules/knowledge-model/src/index.js';
import { createOriginalAssetModule } from '../../modules/original-asset/src/index.js';
import { createTransformationModule } from '../../modules/transformation/src/index.js';
import type {
  EntityVaultImport,
  KnowledgeImpactResult,
  KnowledgeReviewGroup,
} from '../../packages/contracts/src/index.js';
import { createChildQuery, createCommand, ShotgunKernel } from '../../packages/kernel/src/index.js';
import { directTextCommand, evidenceListQuery, intakeResultQuery } from '../helpers/stage-3.js';
import {
  entityCandidate,
  impactQuery,
  modelOutput,
  reviewGroupCommand,
  stageGroupCommand,
} from '../helpers/stage-9.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const createHarness = async (storage: InMemoryAssetStorage) => {
  const adapter = new LucasAugmentedPlainTextAdapter();
  const kernel = new ShotgunKernel(new InProcessTransport());
  kernel.register(
    createIntakeModule(new PostgresIntakeRepository(pool!)),
    createOriginalAssetModule(new PostgresOriginalAssetRepository(pool!), storage),
    createTransformationModule(new PostgresTransformationRepository(pool!), adapter),
    createEvidenceModule(new PostgresEvidenceRepository(pool!), adapter),
    createKnowledgeModelModule(new PostgresKnowledgeModelRepository(pool!), {
      now: () => '2026-07-17T09:00:00.000Z',
    }),
  );
  await kernel.start();
  return kernel;
};

describe.runIf(pool)('Stage 9 PostgreSQL persistence', () => {
  beforeEach(async () => {
    await pool!.query(`
      TRUNCATE
        knowledge.entity_vault_imports,
        knowledge.review_groups,
        evidence.spans,
        transformation.attempts,
        transformation.revisions,
        intake.submissions,
        asset.storage_receipts,
        asset.source_versions,
        asset.sources,
        asset.original_assets
      CASCADE
    `);
  });

  afterAll(async () => {
    await pool!.end();
  });

  it('persists one approved Atomic Group and rebuilds deterministic Impact after restart', async () => {
    const storage = new InMemoryAssetStorage();
    const first = await createHarness(storage);
    const parent = directTextCommand('stage9-postgres', 'Alpha affects Beta. Beta affects Gamma.');
    await first.connector.sendCommand(parent);
    const sourceVersionId = (
      await first.connector.query<{ sourceVersionId: string }>(intakeResultQuery(parent))
    ).result.payload.sourceVersionId;
    const evidenceId = (
      await first.connector.query<{ items: readonly { evidenceId: string }[] }>(
        evidenceListQuery(parent, sourceVersionId),
      )
    ).result.payload.items[0]!.evidenceId;
    const items = [
      entityCandidate('entity:alpha', sourceVersionId, evidenceId, 'Alpha'),
      entityCandidate('entity:beta', sourceVersionId, evidenceId, 'Beta'),
      entityCandidate('entity:gamma', sourceVersionId, evidenceId, 'Gamma'),
      {
        candidateId: 'relation:alpha-beta',
        candidateType: 'RELATION' as const,
        revisionNumber: 1,
        sourceVersionId,
        evidenceIds: [evidenceId],
        modelOutputs: [modelOutput(evidenceId, 'affects')],
        fromCandidateId: 'entity:alpha',
        toCandidateId: 'entity:beta',
        relationType: 'AFFECTS',
        direction: 'DIRECTED' as const,
      },
      {
        candidateId: 'relation:beta-gamma',
        candidateType: 'RELATION' as const,
        revisionNumber: 1,
        sourceVersionId,
        evidenceIds: [evidenceId],
        modelOutputs: [modelOutput(evidenceId, 'affects')],
        fromCandidateId: 'entity:beta',
        toCandidateId: 'entity:gamma',
        relationType: 'AFFECTS',
        direction: 'DIRECTED' as const,
      },
    ];
    const staged = (
      await first.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(parent, 'group:postgres', sourceVersionId, items),
      )
    ).result;
    await first.connector.sendCommand(reviewGroupCommand(parent, staged, 'APPROVE'));
    await first.shutdown();

    const second = await createHarness(storage);
    const impact = (
      await second.connector.query<KnowledgeImpactResult>(impactQuery(parent, 'entity:alpha'))
    ).result.payload;
    expect(impact.visitedNodeIds).toEqual(['entity:alpha', 'entity:beta', 'entity:gamma']);
    expect(impact.traversedEdgeIds).toEqual(['relation:alpha-beta', 'relation:beta-gamma']);
    const rows = await pool!.query<{ status: string; item_count: number; decision_count: number }>(
      `SELECT status, jsonb_array_length(items) AS item_count,
              jsonb_array_length(decisions) AS decision_count
       FROM knowledge.review_groups
       WHERE project_id = 'project-a' AND group_id = 'group:postgres'`,
    );
    expect(rows.rows[0]).toEqual({ status: 'APPROVED', item_count: 5, decision_count: 1 });

    const entity = entityCandidate('entity:vault', sourceVersionId, evidenceId, 'Vault Entity');
    const stagedImport = (
      await second.connector.sendCommand<EntityVaultImport>(
        createCommand({
          messageType: 'StageEntityVaultImport',
          schemaVersion: '1.0.0',
          producerModule: 'stage9-test',
          producerVersion: '1.0.0',
          correlationId: parent.correlationId,
          traceId: parent.traceId,
          projectId: parent.projectId!,
          actor: parent.actor!,
          security: parent.security!,
          idempotencyKey: 'stage9-vault:postgres',
          payload: { importId: 'import:postgres', sourceVersionId, entities: [entity] },
        }),
      )
    ).result;
    await second.connector.sendCommand(
      createCommand({
        messageType: 'ReviewEntityVaultImport',
        schemaVersion: '1.0.0',
        producerModule: 'stage9-test',
        producerVersion: '1.0.0',
        correlationId: parent.correlationId,
        traceId: parent.traceId,
        projectId: parent.projectId!,
        actor: parent.actor!,
        security: parent.security!,
        idempotencyKey: 'stage9-vault-review:postgres',
        payload: {
          importId: stagedImport.importId,
          expectedContentDigest: stagedImport.contentDigest,
          decision: 'APPROVE',
        },
      }),
    );
    const persistedImport = (
      await second.connector.query<EntityVaultImport>(
        createChildQuery(parent, {
          messageType: 'GetEntityVaultImport',
          schemaVersion: '1.0.0',
          producerModule: 'stage9-test',
          producerVersion: '1.0.0',
          payload: { importId: stagedImport.importId },
        }),
      )
    ).result.payload;
    expect(persistedImport).toMatchObject({
      status: 'APPROVED_FOR_REVIEW',
      entities: [{ candidateId: 'entity:vault' }],
      canonicalWrite: false,
    });
    await second.shutdown();
  });

  it('allows only one concurrent final decision for an Atomic Group', async () => {
    const storage = new InMemoryAssetStorage();
    const kernel = await createHarness(storage);
    const parent = directTextCommand('stage9-postgres-race', 'Alpha is a concept.');
    await kernel.connector.sendCommand(parent);
    const sourceVersionId = (
      await kernel.connector.query<{ sourceVersionId: string }>(intakeResultQuery(parent))
    ).result.payload.sourceVersionId;
    const evidenceId = (
      await kernel.connector.query<{ items: readonly { evidenceId: string }[] }>(
        evidenceListQuery(parent, sourceVersionId),
      )
    ).result.payload.items[0]!.evidenceId;
    const group = (
      await kernel.connector.sendCommand<KnowledgeReviewGroup>(
        stageGroupCommand(parent, 'group:race', sourceVersionId, [
          entityCandidate('entity:race', sourceVersionId, evidenceId, 'Alpha'),
        ]),
      )
    ).result;

    const results = await Promise.allSettled([
      kernel.connector.sendCommand(reviewGroupCommand(parent, group, 'APPROVE')),
      kernel.connector.sendCommand(reviewGroupCommand(parent, group, 'REJECT')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const row = await pool!.query<{ status: string; decisions: number }>(
      `SELECT status, jsonb_array_length(decisions) AS decisions
       FROM knowledge.review_groups
       WHERE project_id = 'project-a' AND group_id = 'group:race'`,
    );
    expect(['APPROVED', 'REJECTED']).toContain(row.rows[0]?.status);
    expect(row.rows[0]?.decisions).toBe(1);
    await kernel.shutdown();
  });
});
