import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresConnectorRuntimeState } from '../../adapters/connector-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresChangeSetReviewV2Repository } from '../../adapters/postgres-stage5/src/index.js';
import { InMemorySettingsRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import type { AIProviderExecutionResolverPort } from '../../modules/ai-provider/src/index.js';
import type { CandidateRepositoryPort } from '../../modules/candidate-generation/src/index.js';
import type { ComparisonV2RepositoryPort } from '../../modules/comparison/src/index.js';
import type { MessageTransport } from '../../packages/connector-runtime/src/index.js';
import type { SearchProjectionRepositoryPort } from '../../modules/projection-search/src/index.js';
import { COMPARISON_ROLLOUT_SETTING_KEY } from '../../modules/settings-policy/src/index.js';
import { COMPARISON_SEMANTIC_ANALYSIS_CAPABILITY_V2 } from '../../modules/comparison/src/index.js';
import {
  resolveReviewOperationV2CommandDigest,
  sha256Text,
  stableJson,
  type CanonicalSnapshot,
  type ProjectionReadiness,
  type SemanticProjectionGeneration,
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
    const lexicalReadiness: ProjectionReadiness = {
      status: 'READY',
      projectedCanonicalVersion: snapshot.version,
      canonicalVersion: snapshot.version,
      lag: 0,
      projectedSnapshotDigest: snapshot.digest,
      canonicalSnapshotDigest: snapshot.digest,
      lastCommitId: `canonical-${suffix}`,
      updatedAt: snapshot.createdAt,
    };
    const semanticGeneration: SemanticProjectionGeneration = {
      projectId: snapshot.projectId,
      generationId: `generation:adr163-product:${suffix}`,
      sourceProjectionDigest: sha256Text(`semantic-source:${suffix}`),
      canonicalBaseVersion: snapshot.version,
      credentialId: `credential:adr163-product:${suffix}`,
      credentialRevision: 1,
      providerPolicyFingerprint: 'fixture-provider-policy:v1',
      providerId: 'fixture-provider',
      embeddingModelId: 'fixture-embedding-model',
      embeddingProfileId: `embedding-profile:${suffix}`,
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'fixture-provider-registry:v1',
      capabilityCatalogRevision: 'fixture-capability-catalog:v1',
      representationVersion: 'semantic-representation:v2',
      dimension: 3,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: snapshot.createdAt,
    };
    const fixture = createAdr163ReviewFixture({
      suffix: `product-r19-${suffix}`,
      claimText: 'Product R19 acknowledgement loss fixture.',
      snapshot,
      freshnessMode: 'SEMANTIC',
      rolloutAuthorityRevision: rolloutRevision,
      semanticFreshness: {
        lexicalReadiness,
        semanticGeneration,
        providerModelCapabilityIdentity: `fixture-provider/fixture-model/${COMPARISON_SEMANTIC_ANALYSIS_CAPABILITY_V2}`,
        shortlistPolicyRevision: 'comparison-shortlist-policy:fixture-v1',
      },
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
    let providerGenerationCalls = 0;
    const comparisonV2ExecutionResolver = {
      resolve: async () => ({
        executionIdentity: {
          providerId: 'fixture-provider',
          modelId: 'fixture-model',
          aiConfigurationRevision: 1,
          credentialId: `credential:adr163-product:${suffix}`,
          credentialRevision: 1,
          policyContextRevision: 'fixture-policy-context:v1',
          providerPolicyFingerprint: 'fixture-provider-policy:v1',
        },
        adapter: {
          identity: {
            provider: 'fixture-provider',
            model: 'fixture-model',
            adapterVersion: 'fixture-adapter:v1',
            dataPolicyVersion: 'fixture-data-policy:v1',
          },
          async generateStructured() {
            providerGenerationCalls += 1;
            throw new Error('provider generation must not run in R19');
          },
        },
      }),
    } as unknown as AIProviderExecutionResolverPort;
    const searchProjection: SearchProjectionRepositoryPort = {
      applyCommit: async () => undefined,
      rebuild: async () => undefined,
      markDegraded: async () => undefined,
      findWatermark: async () => ({
        projectId: snapshot.projectId,
        canonicalVersion: snapshot.version,
        snapshotDigest: snapshot.digest,
        status: 'READY',
        updatedAt: snapshot.createdAt,
        lastCommitId: lexicalReadiness.lastCommitId,
      }),
      search: async () => [],
    };
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
    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: `account:adr163-product:${suffix}`,
      projectId: snapshot.projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId(`account:adr163-product:${suffix}`);
    if (!principal) throw new Error('R19 Product fixture principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      snapshot.projectId,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const app = await createApplication({
      authRepository: auth,
      transport,
      connectorRuntimeState: new PostgresConnectorRuntimeState(pool!),
      changeSetReviewV2Repository: repository,
      candidateRepository,
      comparisonV2Repository,
      comparisonV2ExecutionResolver,
      semanticActiveGenerationReader: {
        getActiveGeneration: async () => semanticGeneration,
      },
      canonicalSnapshot: { getSnapshot: async () => snapshot },
      searchProjectionRepository: searchProjection,
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
      const csrf = (
        await app.server.inject({
          method: 'GET',
          url: '/api/v1/security/csrf',
          headers: { cookie },
        })
      ).json<{ csrfToken: string }>().csrfToken;
      const response = await app.server.inject({
        method: 'POST',
        url: '/reviews/v2/resolve-operation',
        headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrf },
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        commandStatus: 'reconciled',
        resolution: { changeSetId: fixture.draft.changeSetId, chosenOperation: 'ADD_CLAIM' },
      });
      expect(resolverInvocations).toBe(1);
      expect(providerGenerationCalls).toBe(0);
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
