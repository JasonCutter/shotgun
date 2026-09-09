import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresCandidateRepository } from '../../adapters/postgres-stage4/src/index.js';
import {
  PostgresChangeSetReviewV2Repository,
  PostgresComparisonV2Repository,
} from '../../adapters/postgres-stage5/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import {
  canonicalSnapshotDigest,
  sha256Text,
  type HybridRetrievalCoordinatorPort,
  type SemanticProjectionGeneration,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(Boolean(databaseUrl))('Issue #241 empty Canonical PostgreSQL runtime path', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('durably persists NEW/ADD_CLAIM and one pending Review without semantic execution', async () => {
    if (!pool) return;

    const projectId = `issue-241-${randomUUID()}`;
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const revisionId = randomUUID();
    const evidenceId = randomUUID();
    const batchId = randomUUID();
    const candidateId = randomUUID();
    const now = new Date().toISOString();
    const contentDigest = sha256Text(`${projectId}:candidate`);
    const snapshotDigest = canonicalSnapshotDigest(projectId, 0, []);

    await pool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 32, $3, $4)`,
      [assetId, contentDigest, `issue-241-${assetId}`, now],
    );
    await pool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 'owner', $3)`,
      [sourceId, projectId, now],
    );
    await pool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id,
         media_type, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', 'private', $4)`,
      [sourceVersionId, sourceId, assetId, now],
    );
    await pool.query(
      `INSERT INTO transformation.revisions (
         revision_id, project_id, source_id, source_version_id, source_content_hash,
         transformer_id, transformer_version, document_ir, source_map, document_hash,
         source_map_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'issue-241-test', '1', '{}', '{}', $5, $5,
         '{owner}', 'private', $6)`,
      [revisionId, projectId, sourceId, sourceVersionId, contentDigest, now],
    );
    await pool.query(
      `INSERT INTO evidence.spans (
         evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
         node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, $5, '/candidate', 'sentence', 'source',
         '{"start":0,"end":20}', $6::jsonb, $7, '{owner}', 'private', $8)`,
      [
        evidenceId,
        revisionId,
        projectId,
        sourceId,
        sourceVersionId,
        JSON.stringify({ text: 'A first Canonical claim.' }),
        contentDigest,
        now,
      ],
    );
    await pool.query(
      `INSERT INTO candidate.batches (
         batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at
       ) VALUES ($1, $2, $3, $4, '{}', $5)`,
      [batchId, projectId, sourceVersionId, `issue-241-batch-${batchId}`, now],
    );
    await pool.query(
      `INSERT INTO candidate.claim_candidates (
         candidate_id, batch_id, project_id, source_version_id, revision_number, claim_text,
         evidence_id, evidence_mode, extraction_profile, status, provider_call,
         access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, 1, 'A first Canonical claim.', $5,
         'DIRECT_EVIDENCE', 'direct-only', 'READY', '{}', '{owner}', 'private', $6)`,
      [candidateId, batchId, projectId, sourceVersionId, evidenceId, now],
    );
    await pool.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, 0, $2, $3)`,
      [projectId, snapshotDigest, now],
    );

    const canonical = new PostgresCanonicalKnowledgeRepository(pool);
    const generation: SemanticProjectionGeneration = {
      projectId,
      generationId: `generation-${projectId}`,
      sourceProjectionDigest: sha256Text(`${projectId}:semantic-source`),
      canonicalBaseVersion: 0,
      credentialId: 'test-credential',
      credentialRevision: 1,
      providerPolicyFingerprint: 'test-provider-policy',
      providerId: 'deepseek',
      embeddingModelId: 'test-embedding',
      embeddingProfileId: 'test-profile',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'test-provider-registry',
      capabilityCatalogRevision: 'test-capability-catalog',
      representationVersion: 'test-representation',
      dimension: 3,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: now,
    };
    const readiness = {
      status: 'READY' as const,
      projectedCanonicalVersion: 0,
      canonicalVersion: 0,
      lag: 0,
      canonicalSnapshotDigest: snapshotDigest,
      projectedSnapshotDigest: snapshotDigest,
      lastCommitId: `empty-${projectId}`,
    };
    const hybridRetrieval: HybridRetrievalCoordinatorPort = {
      async search(input) {
        return {
          schemaVersion: '1.0.0',
          projectId: input.projectId,
          query: input.query,
          items: [],
          fusionPolicy: { version: 'rrf:v1', k: 60 },
          readiness: {
            lexical: readiness,
            semantic: {
              status: 'READY',
              data: 'READY',
              execution: 'AVAILABLE',
              activeGenerationId: generation.generationId,
            },
            degraded: false,
          },
          generatedAt: now,
        };
      },
    };
    let providerCalls = 0;
    const providerResolver = {
      async resolve() {
        return {
          executionIdentity: {
            providerId: 'deepseek',
            modelId: 'deepseek-chat-test',
            aiConfigurationRevision: 1,
            credentialId: 'test-credential',
            credentialRevision: 1,
            policyContextRevision: 'test-policy-context',
            providerPolicyFingerprint: 'test-provider-policy',
          },
          adapter: {
            identity: {
              provider: 'deepseek',
              model: 'deepseek-chat-test',
              adapterVersion: 'test-adapter',
              dataPolicyVersion: 'test-data-policy',
            },
            async generateStructured() {
              providerCalls += 1;
              throw new Error('semantic provider must not execute for empty Canonical bootstrap');
            },
          },
        };
      },
    } as never;

    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: `account-${projectId}`,
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId(`account-${projectId}`);
    if (!principal) throw new Error('Issue #241 test principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const comparisonRepository = new PostgresComparisonV2Repository(pool);
    const reviewRepository = new PostgresChangeSetReviewV2Repository(pool);
    const application = await createApplication({
      authRepository: auth,
      candidateRepository: new PostgresCandidateRepository(pool),
      comparisonV2Repository: comparisonRepository,
      changeSetReviewV2Repository: reviewRepository,
      canonicalSnapshot: canonical,
      canonicalKnowledgeRepository: canonical,
      hybridRetrievalCoordinator: hybridRetrieval,
      semanticActiveGenerationReader: {
        getActiveGeneration: async () => generation,
      },
      comparisonV2ExecutionResolver: providerResolver,
      settingsRepository: {
        getProjectSettingValue: async () => 'V2_ACTIVE',
      } as never,
    });

    const csrf = (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;
    const invoke = (idempotencyKey: string) =>
      application.server.inject({
        method: 'POST',
        url: '/comparisons/recompare',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: { candidateId, idempotencyKey },
      });

    const first = await invoke('issue-241-first');
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{
      result: {
        rollout: string;
        v1Executed: boolean;
        v2: { status: string; comparisonId?: string; snapshotVersion?: number };
        review: { status: string };
      };
    }>();
    expect(firstBody.result).toMatchObject({
      rollout: 'V2_ACTIVE',
      v1Executed: false,
      v2: { status: 'COMPLETED', snapshotVersion: 0 },
      review: { status: 'DRAFT_CREATED' },
    });
    const comparisonId = firstBody.result.v2.comparisonId;
    if (!comparisonId) throw new Error('Issue #241 comparison identity was not returned.');

    const aggregate = await comparisonRepository.findComparisonById(projectId, comparisonId);
    expect(aggregate?.comparison).toMatchObject({
      disposition: 'NEW',
      reviewRecommendation: 'ADD_CLAIM',
      analysisRevisionIds: [],
      relationshipIds: [],
    });
    const draft = await reviewRepository.findDraftByComparisonId(projectId, comparisonId);
    expect(draft).toMatchObject({
      operation: 'ADD_CLAIM',
      reviewRecommendation: 'ADD_CLAIM',
      status: 'PENDING_REVIEW',
      analysisRevisionIds: [],
      relationshipIds: [],
    });
    expect(draft?.freshnessIdentity.mode).toBe('EMPTY_CANONICAL_BOOTSTRAP');

    const replay = await invoke('issue-241-replay');
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      result: {
        rollout: 'V2_ACTIVE',
        v1Executed: false,
        v2: { status: 'COMPLETED', comparisonId },
        review: { status: 'DRAFT_CREATED' },
      },
    });
    expect(providerCalls).toBe(0);

    const counts = await pool.query<{
      comparisons: string;
      analyses: string;
      relationships: string;
      reviews: string;
      canonicalClaims: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM comparison.results_v2 WHERE project_id = $1) AS comparisons,
         (SELECT count(*)::text FROM comparison.analysis_revisions_v2 WHERE project_id = $1) AS analyses,
         (SELECT count(*)::text FROM comparison.relationships_v2 WHERE project_id = $1) AS relationships,
         (SELECT count(*)::text FROM review.change_sets_v2 WHERE project_id = $1) AS reviews,
         (SELECT count(*)::text FROM canonical.claims WHERE project_id = $1) AS "canonicalClaims"`,
      [projectId],
    );
    expect(counts.rows[0]).toEqual({
      comparisons: '1',
      analyses: '0',
      relationships: '0',
      reviews: '1',
      canonicalClaims: '0',
    });
    expect((await canonical.getSnapshot(projectId)).claims).toEqual([]);
  });
});
