import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import {
  canonicalSnapshotDigest,
  sha256Text,
  type HybridRetrievalCoordinatorPort,
  type ProjectionWatermark,
  type SemanticProjectionGeneration,
} from '../../packages/contracts/src/index.js';
import type { SearchProjectionRepositoryPort } from '../../modules/projection-search/src/index.js';
import type { CandidateRepositoryPort } from '../../modules/candidate-generation/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { PostgresCandidateRepository } from '../../adapters/postgres-stage4/src/index.js';
import {
  PostgresChangeSetReviewRepository,
  PostgresChangeSetReviewV2Repository,
  PostgresComparisonRepository,
  PostgresComparisonV2Repository,
} from '../../adapters/postgres-stage5/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const describeDatabase = describe.runIf(Boolean(databaseUrl));

describeDatabase('Stage 5 Product re-entry on PostgreSQL application composition', () => {
  afterAll(async () => {
    await pool?.end();
  });

  it('executes V2 through the authenticated Product route and reuses the persisted lineage before provider execution', async () => {
    if (!pool) return;
    const projectId = `pg-reentry-${randomUUID()}`;
    const candidateId = randomUUID();
    const candidateSourceVersionId = randomUUID();
    const candidateSourceId = randomUUID();
    const candidateAssetId = randomUUID();
    const candidateRevisionId = randomUUID();
    const candidateEvidenceId = randomUUID();
    const candidateBatchId = randomUUID();
    const canonicalSourceVersionId = randomUUID();
    const canonicalSourceId = randomUUID();
    const canonicalAssetId = randomUUID();
    const canonicalRevisionId = randomUUID();
    const canonicalEvidenceId = randomUUID();
    const claimId = `claim-${randomUUID()}`;
    const manifestId = randomUUID();
    const now = new Date().toISOString();
    const candidateText = 'A new candidate claim requiring semantic comparison.';
    const canonicalText = 'An existing canonical claim for semantic comparison.';
    const hash = (value: string) => sha256Text(`${projectId}:${value}`);

    const insertSource = async (input: {
      sourceId: string;
      sourceVersionId: string;
      assetId: string;
      revisionId: string;
      evidenceId: string;
      content: string;
    }) => {
      await pool.query(
        `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
         VALUES ($1, $2, 100, $3, $4)`,
        [input.assetId, hash(input.content), `storage-${input.assetId}`, now],
      );
      await pool.query(
        `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
         VALUES ($1, $2, 'owner', $3)`,
        [input.sourceId, projectId, now],
      );
      await pool.query(
        `INSERT INTO asset.source_versions (
           source_version_id, source_id, version_number, original_asset_id,
           media_type, access_scope, sensitivity, created_at
         ) VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', 'private', $4)`,
        [input.sourceVersionId, input.sourceId, input.assetId, now],
      );
      await pool.query(
        `INSERT INTO transformation.revisions (
           revision_id, project_id, source_id, source_version_id, source_content_hash,
           transformer_id, transformer_version, document_ir, source_map, document_hash,
           source_map_hash, access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'test', '1', '{}', '{}', $5, $5, '{owner}', 'private', $6)`,
        [
          input.revisionId,
          projectId,
          input.sourceId,
          input.sourceVersionId,
          hash(input.content),
          now,
        ],
      );
      await pool.query(
        `INSERT INTO evidence.spans (
           evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
           node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, $5, '/claim', 'sentence', 'source',
           '{"start":0,"end":1}', $6::jsonb, $7, '{owner}', 'private', $8)`,
        [
          input.evidenceId,
          input.revisionId,
          projectId,
          input.sourceId,
          input.sourceVersionId,
          JSON.stringify({ text: input.content }),
          hash(input.content),
          now,
        ],
      );
    };

    await insertSource({
      sourceId: candidateSourceId,
      sourceVersionId: candidateSourceVersionId,
      assetId: candidateAssetId,
      revisionId: candidateRevisionId,
      evidenceId: candidateEvidenceId,
      content: candidateText,
    });
    await insertSource({
      sourceId: canonicalSourceId,
      sourceVersionId: canonicalSourceVersionId,
      assetId: canonicalAssetId,
      revisionId: canonicalRevisionId,
      evidenceId: canonicalEvidenceId,
      content: canonicalText,
    });
    await pool.query(
      `INSERT INTO candidate.batches (batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at)
       VALUES ($1, $2, $3, $4, '{}', $5)`,
      [candidateBatchId, projectId, candidateSourceVersionId, `batch-${candidateId}`, now],
    );
    await pool.query(
      `INSERT INTO candidate.claim_candidates (
         candidate_id, batch_id, project_id, source_version_id, revision_number, claim_text,
         evidence_id, evidence_mode, extraction_profile, status, provider_call,
         access_scope, sensitivity, created_at
       ) VALUES ($1, $2, $3, $4, 1, $5, $6, 'DIRECT_EVIDENCE', 'direct-only', 'READY', '{}', '{owner}', 'private', $7)`,
      [
        candidateId,
        candidateBatchId,
        projectId,
        candidateSourceVersionId,
        candidateText,
        candidateEvidenceId,
        now,
      ],
    );

    const canonicalClaim = {
      claimId,
      projectId,
      revisionNumber: 1 as const,
      claimText: canonicalText,
      sourceVersionId: canonicalSourceVersionId,
      evidenceIds: [canonicalEvidenceId],
      createdFromManifestId: manifestId,
      authorityId: null,
      authorityDigest: null,
      accessScope: ['owner'],
      sensitivity: 'private' as const,
      createdAt: now,
    };
    const snapshotDigest = canonicalSnapshotDigest(projectId, 1, [
      {
        claimId,
        text: canonicalText,
        revisionNumber: 1,
        evidenceIds: [canonicalEvidenceId],
      },
    ]);
    await pool.query(
      `INSERT INTO canonical.claims (claim_id, project_id, source_version_id, manifest_id, claim_json, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        claimId,
        projectId,
        canonicalSourceVersionId,
        manifestId,
        JSON.stringify(canonicalClaim),
        now,
      ],
    );
    await pool.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, 1, $2, $3)`,
      [projectId, snapshotDigest, now],
    );

    const generation: SemanticProjectionGeneration = {
      projectId,
      generationId: `generation-${projectId}`,
      sourceProjectionDigest: hash('semantic-source'),
      canonicalBaseVersion: 1,
      credentialId: 'deepseek-credential',
      credentialRevision: 1,
      providerPolicyFingerprint: 'policy-fingerprint-v1',
      providerId: 'deepseek',
      embeddingModelId: 'embedding-test',
      embeddingProfileId: 'embedding-profile',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'provider-registry-v1',
      capabilityCatalogRevision: 'capability-catalog-v1',
      representationVersion: 'representation-v1',
      dimension: 3,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: now,
    };
    const watermark: ProjectionWatermark = {
      projectId,
      canonicalVersion: 1,
      snapshotDigest,
      status: 'READY',
      updatedAt: now,
    };
    const searchProjection: SearchProjectionRepositoryPort = {
      applyCommit: async () => undefined,
      rebuild: async () => undefined,
      markDegraded: async () => undefined,
      findWatermark: async () => watermark,
      search: async () => [],
    };
    const hybridRetrieval: HybridRetrievalCoordinatorPort = {
      async search(input) {
        return {
          schemaVersion: '1.0.0',
          projectId,
          query: input.query,
          items: [
            {
              resourceType: 'CLAIM',
              resourceId: claimId,
              text: canonicalText,
              authority: 'CANONICAL',
              authorityRevision: 1,
              resourceRevision: 1,
              canonicalVersion: 1,
              sourceSnapshotDigest: snapshotDigest,
              sourceProjectionDigest: generation.sourceProjectionDigest,
              evidenceIds: [canonicalEvidenceId],
              citations: [],
              accessScope: ['owner'],
              sensitivity: 'private',
              signals: ['SEMANTIC'],
              semanticRank: 1,
              fusionRank: 1,
              fusionScore: 1,
            },
          ],
          fusionPolicy: { version: 'rrf:v1', k: 60 },
          readiness: {
            lexical: {
              status: 'READY',
              projectedCanonicalVersion: 1,
              canonicalVersion: 1,
              lag: 0,
              canonicalSnapshotDigest: snapshotDigest,
              projectedSnapshotDigest: snapshotDigest,
            },
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
    const executionIdentity = {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      aiConfigurationRevision: 1,
      credentialId: 'deepseek-credential',
      credentialRevision: 1,
      policyContextRevision: 'policy-context-v1',
      providerPolicyFingerprint: 'policy-fingerprint-v1',
    } as const;
    const executionResolver = {
      async resolve() {
        return {
          executionIdentity,
          adapter: {
            identity: {
              provider: 'deepseek',
              model: 'deepseek-chat',
              adapterVersion: 'test-adapter-v1',
              dataPolicyVersion: 'test-policy-v1',
            },
            async generateStructured() {
              providerCalls += 1;
              return {
                rawText: JSON.stringify({
                  relationships: [
                    {
                      resourceId: claimId,
                      resourceRevision: 1,
                      type: 'SUPPORTS',
                      rationale: 'The candidate extends the existing canonical claim.',
                    },
                  ],
                }),
                providerResponseId: `deepseek-test-${providerCalls}`,
              };
            },
          },
        };
      },
    };
    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: `account-${projectId}`,
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId(`account-${projectId}`);
    if (!principal) throw new Error('PostgreSQL Product fixture principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const canonical = new PostgresCanonicalKnowledgeRepository(pool);
    const candidateRepository: CandidateRepositoryPort = new PostgresCandidateRepository(pool);
    const application = await createApplication({
      authRepository: auth,
      candidateRepository,
      comparisonRepository: new PostgresComparisonRepository(pool),
      comparisonV2Repository: new PostgresComparisonV2Repository(pool),
      changeSetReviewRepository: new PostgresChangeSetReviewRepository(pool),
      changeSetReviewV2Repository: new PostgresChangeSetReviewV2Repository(pool),
      canonicalSnapshot: canonical,
      canonicalKnowledgeRepository: canonical,
      searchProjectionRepository: searchProjection,
      hybridRetrievalCoordinator: hybridRetrieval,
      semanticActiveGenerationReader: { getActiveGeneration: async () => generation },
      comparisonV2ExecutionResolver: executionResolver,
      settingsRepository: {
        getProjectSettingValue: async () => 'V2_ACTIVE',
      } as never,
    });
    try {
      const csrf = (
        await application.server.inject({
          method: 'GET',
          url: '/api/v1/security/csrf',
          headers: { cookie },
        })
      ).json<{ csrfToken: string }>().csrfToken;
      const invoke = async (idempotencyKey: string) =>
        application.server.inject({
          method: 'POST',
          url: '/comparisons/recompare',
          headers: { cookie, 'x-csrf-token': csrf },
          payload: { candidateId, idempotencyKey },
        });

      const first = await invoke('product-key-a');
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
        v2: { status: 'COMPLETED', snapshotVersion: 1 },
        review: { status: 'DRAFT_CREATED' },
      });
      expect(firstBody.result.v2.comparisonId).toBeTruthy();
      const second = await invoke('product-key-b');
      expect(second.statusCode).toBe(200);
      const secondBody = second.json<typeof firstBody>();
      expect(secondBody.result.v2.comparisonId).toBe(firstBody.result.v2.comparisonId);
      expect(providerCalls).toBe(1);

      const counts = await pool.query<{
        comparisons: string;
        analyses: string;
        relationships: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM comparison.results_v2 WHERE project_id = $1) AS comparisons,
           (SELECT count(*)::text FROM comparison.analysis_revisions_v2 WHERE project_id = $1) AS analyses,
           (SELECT count(*)::text FROM comparison.relationships_v2 WHERE project_id = $1) AS relationships`,
        [projectId],
      );
      expect(counts.rows[0]).toEqual({ comparisons: '1', analyses: '1', relationships: '1' });

      const malformed = await application.server.inject({
        method: 'POST',
        url: '/comparisons/recompare',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: { candidateId, idempotencyKey: 'product-key-c', authority: 'V1' },
      });
      expect(malformed.statusCode).toBe(400);
    } finally {
      await application.server.close();
      await pool.query('DELETE FROM review.decisions_v2 WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM review.approved_manifests_v2 WHERE project_id = $1', [
        projectId,
      ]);
      await pool.query('DELETE FROM review.change_sets_v2 WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM comparison.relationships_v2 WHERE project_id = $1', [
        projectId,
      ]);
      await pool.query('DELETE FROM comparison.results_v2 WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM comparison.analysis_revisions_v2 WHERE project_id = $1', [
        projectId,
      ]);
      await pool.query('DELETE FROM candidate.claim_candidates WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM candidate.batches WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM evidence.spans WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM transformation.revisions WHERE project_id = $1', [projectId]);
      // Canonical claims are append-only by contract. The fixture uses a
      // unique project id and is intentionally retained for audit/replay
      // evidence rather than issuing a destructive delete.
    }
  });
});
