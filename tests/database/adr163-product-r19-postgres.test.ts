import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresConnectorRuntimeState } from '../../adapters/connector-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresChangeSetReviewV2Repository } from '../../adapters/postgres-stage5/src/index.js';
import { InMemorySettingsRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import type { AIProviderExecutionResolverPort } from '../../modules/ai-provider/src/index.js';
import type { CandidateRepositoryPort } from '../../modules/candidate-generation/src/index.js';
import type { ComparisonV2RepositoryPort } from '../../modules/comparison/src/index.js';
import type { MessageTransport } from '../../packages/connector-runtime/src/index.js';
import { COMPARISON_ROLLOUT_SETTING_KEY } from '../../modules/settings-policy/src/index.js';
import {
  resolveReviewOperationV2CommandDigest,
  sha256Text,
  stableJson,
  type CanonicalSnapshot,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { createAdr163ReviewFixture } from '../helpers/adr163-review-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const rolloutRevision = sha256Text(
  stableJson({ policy: 'comparison-stage5-rollout:v1', state: 'V2_ACTIVE' }),
);

describe.runIf(databaseUrl)('ADR-163 Product R19 PostgreSQL route', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('reconciles Product route ack loss without replaying the resolver', async () => {
    const suffix = randomUUID();
    const snapshot: CanonicalSnapshot = {
      snapshotId: `snapshot:adr163-product:${suffix}`,
      projectId: 'shotgun',
      version: 0,
      claims: [],
      createdAt: '2026-09-08T12:00:00.000Z',
      digest: sha256Text(`snapshot:${suffix}`),
    };
    const fixture = createAdr163ReviewFixture({
      suffix: `product-r19-${suffix}`,
      claimText: 'Product R19 acknowledgement loss fixture.',
      snapshot,
      freshnessMode: 'DETERMINISTIC_EXACT',
      rolloutAuthorityRevision: rolloutRevision,
    });
    const repository = new PostgresChangeSetReviewV2Repository(pool!);
    await repository.saveDraft(fixture.draft);

    let resolverInvocations = 0;
    const candidateRepository = {
      findById: async () => fixture.candidate,
      saveBatch: async (batch: never) => batch,
      failMaterialization: async () => undefined,
      findBatchByIdempotencyKey: async () => undefined,
      listBySourceVersion: async () => [],
      updateStatus: async () => undefined,
    } as unknown as CandidateRepositoryPort;
    const comparisonV2Repository = {
      findComparisonById: async () => {
        resolverInvocations += 1;
        return fixture.aggregate;
      },
      saveAnalysisRevision: async () => {
        throw new Error('not used by this route test');
      },
      transitionAnalysisRevision: async () => {
        throw new Error('not used by this route test');
      },
      findAnalysisRevision: async () => undefined,
      findAnalysisRevisionByInput: async () => undefined,
      saveCompletedAggregate: async () => {
        throw new Error('not used by this route test');
      },
      findComparisonByIdentity: async () => undefined,
    } as unknown as ComparisonV2RepositoryPort;
    const comparisonV2ExecutionResolver = {
      resolve: async () => {
        throw new Error('semantic execution is not used by deterministic R19');
      },
    } as unknown as AIProviderExecutionResolverPort;
    const settingsRepository = new InMemorySettingsRepository();
    await settingsRepository.applySettingsCommand({
      commandId: `command:${suffix}`,
      clientRequestId: `client:${suffix}`,
      idempotencyKey: `settings:${suffix}`,
      projectId: 'shotgun',
      expectedSettingsRevision: 1,
      observedPolicyContextRevision: 1,
      settings: { [COMPARISON_ROLLOUT_SETTING_KEY]: 'V2_ACTIVE' },
      actorId: 'product-r19-test',
    });
    let injectAckLoss = true;
    const transport: MessageTransport = {
      name: 'in-process',
      async execute<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
        const result = await operation();
        if (injectAckLoss) {
          injectAckLoss = false;
          throw Object.assign(new Error('acknowledgement was lost'), { code: 'OUTCOME_UNKNOWN' });
        }
        return result;
      },
    };
    const app = await createApplication({
      transport,
      connectorRuntimeState: new PostgresConnectorRuntimeState(pool!),
      changeSetReviewV2Repository: repository,
      candidateRepository,
      comparisonV2Repository,
      comparisonV2ExecutionResolver,
      semanticActiveGenerationReader: { getActiveGeneration: async () => undefined },
      canonicalSnapshot: { getSnapshot: async () => snapshot },
      settingsRepository,
    });
    const body = {
      changeSetId: fixture.draft.changeSetId,
      expectedDraftRevision: fixture.draft.revisionNumber,
      expectedDraftDigest: fixture.draft.contentDigest,
      chosenOperation: 'ADD_CLAIM' as const,
      clientRequestId: `client-request:${suffix}`,
      idempotencyKey: `idempotency:${suffix}`,
    };
    const commandIdempotencyKey = `review-operation-v2:shotgun:${resolveReviewOperationV2CommandDigest(body)}`;
    try {
      const response = await app.server.inject({
        method: 'POST',
        url: '/reviews/v2/resolve-operation',
        headers: { 'content-type': 'application/json' },
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        commandStatus: 'reconciled',
        resolution: { changeSetId: fixture.draft.changeSetId, chosenOperation: 'ADD_CLAIM' },
      });
      expect(resolverInvocations).toBe(1);
      const dedupState = await pool!.query<{ state: string }>(
        `SELECT state
         FROM connector.dedup_records
         WHERE project_id = $1 AND semantic_key = $2`,
        [fixture.draft.projectId, commandIdempotencyKey],
      );
      expect(dedupState.rows[0]?.state).toBe('COMPLETED');
      const counts = await pool!.query<{ resolutions: string; revisions: string }>(
        `SELECT
           (SELECT count(*)::text FROM review.operation_resolutions_v2
            WHERE project_id = $1 AND change_set_id = $2) AS resolutions,
           (SELECT count(*)::text FROM review.change_set_revisions_v2
            WHERE project_id = $1 AND change_set_id = $2) AS revisions`,
        [fixture.draft.projectId, fixture.draft.changeSetId],
      );
      expect(counts.rows[0]).toEqual({ resolutions: '1', revisions: '2' });
    } finally {
      await app.server.close();
      const dedup = await pool!.query<{ dedup_record_id: string }>(
        `SELECT dedup_record_id FROM connector.dedup_records
         WHERE project_id = $1 AND semantic_key = $2`,
        [fixture.draft.projectId, commandIdempotencyKey],
      );
      if (dedup.rows.length) {
        const ids = dedup.rows.map((row) => row.dedup_record_id);
        await pool!.query(
          `DELETE FROM connector.replays WHERE dead_letter_id IN
           (SELECT dead_letter_id FROM connector.dead_letters WHERE dedup_record_id = ANY($1::uuid[]))`,
          [ids],
        );
        await pool!.query(
          'DELETE FROM connector.dead_letters WHERE dedup_record_id = ANY($1::uuid[])',
          [ids],
        );
        await pool!.query('DELETE FROM connector.jobs WHERE dedup_record_id = ANY($1::uuid[])', [
          ids,
        ]);
        await pool!.query(
          'DELETE FROM connector.dedup_records WHERE dedup_record_id = ANY($1::uuid[])',
          [ids],
        );
      }
      await pool!.query(
        'DELETE FROM review.operation_resolutions_v2 WHERE project_id = $1 AND change_set_id = $2',
        [fixture.draft.projectId, fixture.draft.changeSetId],
      );
      await pool!.query(
        'DELETE FROM review.change_set_revisions_v2 WHERE project_id = $1 AND change_set_id = $2',
        [fixture.draft.projectId, fixture.draft.changeSetId],
      );
      await pool!.query(
        'DELETE FROM review.change_sets_v2 WHERE project_id = $1 AND change_set_id = $2',
        [fixture.draft.projectId, fixture.draft.changeSetId],
      );
    }
  });
});
