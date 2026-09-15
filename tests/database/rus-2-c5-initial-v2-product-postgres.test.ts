import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresEvidenceRepository } from '../../adapters/postgres-stage3/src/index.js';
import { PostgresCandidateRepository } from '../../adapters/postgres-stage4/src/index.js';
import {
  PostgresChangeSetReviewRepository,
  PostgresChangeSetReviewV2Repository,
  PostgresComparisonRepository,
  PostgresComparisonV2Repository,
} from '../../adapters/postgres-stage5/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { PostgresFrontendReviewRepository } from '../../adapters/frontend-review-postgres/src/index.js';
import {
  PostgresOriginalAssetRepository,
  createPostgresPool,
} from '../../adapters/postgres/src/index.js';
import { InMemorySettingsRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import type { CandidateRepositoryPort } from '../../modules/candidate-generation/src/index.js';
import type { SearchProjectionRepositoryPort } from '../../modules/projection-search/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import {
  canonicalSnapshotDigest,
  sha256Text,
  type HybridRetrievalCoordinatorPort,
  type SemanticProjectionGeneration,
} from '../../packages/contracts/src/index.js';
import { createShotgunApiClient } from '../../packages/shotgun-api-client/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const describeDatabase = describe.runIf(Boolean(databaseUrl));

describeDatabase('RUS-2 C5 fresh initial V2 Product PostgreSQL lifecycle', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('enters V2 through the Product Candidate path and converges Home and Review', async () => {
    if (!pool) return;

    const suffix = randomUUID();
    const projectId = `rus-2-c5-fresh-${suffix}`;
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    const transformationRevisionId = randomUUID();
    const candidateAId = randomUUID();
    const candidateBId = randomUUID();
    const candidateABatchId = randomUUID();
    const candidateBBatchId = randomUUID();
    const candidateAEvidenceId = randomUUID();
    const candidateBEvidenceId = randomUUID();
    const canonicalEvidenceId = randomUUID();
    const canonicalClaimId = `claim-${randomUUID()}`;
    const canonicalManifestId = randomUUID();
    const now = new Date().toISOString();
    const canonicalText = 'The existing Canonical claim used by the fresh V2 comparison.';
    const candidateAText = 'Candidate A enters the initial V2 Product path.';
    const candidateBText = 'Candidate B remains independently actionable after Candidate A.';
    const hash = (value: string): string => sha256Text(`${projectId}:${value}`);

    await pool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 100, $3, $4)`,
      [assetId, hash(candidateAText), `storage-${assetId}`, now],
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
       ) VALUES ($1, $2, $3, $4, $5, 'c5-fresh-fixture', '1', '{}', '{}', $5, $5, '{owner}', 'private', $6)`,
      [transformationRevisionId, projectId, sourceId, sourceVersionId, hash(candidateAText), now],
    );

    const insertEvidence = async (evidenceId: string, text: string, start: number) => {
      await pool.query(
        `INSERT INTO evidence.spans (
           evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
           node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'sentence', 'source', $7::jsonb, $8::jsonb, $9, '{owner}', 'private', $10)`,
        [
          evidenceId,
          transformationRevisionId,
          projectId,
          sourceId,
          sourceVersionId,
          `/claim-${start}`,
          JSON.stringify({ start, end: start + 1 }),
          JSON.stringify({ text }),
          hash(text),
          now,
        ],
      );
    };
    await insertEvidence(canonicalEvidenceId, canonicalText, 0);
    await insertEvidence(candidateAEvidenceId, candidateAText, 1);
    await insertEvidence(candidateBEvidenceId, candidateBText, 2);

    const insertCandidate = async (input: {
      readonly candidateId: string;
      readonly batchId: string;
      readonly claimText: string;
      readonly evidenceId: string;
    }) => {
      await pool.query(
        `INSERT INTO candidate.batches (batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at)
         VALUES ($1, $2, $3, $4, '{}', $5)`,
        [input.batchId, projectId, sourceVersionId, `batch-${input.candidateId}`, now],
      );
      await pool.query(
        `INSERT INTO candidate.claim_candidates (
           candidate_id, batch_id, project_id, source_version_id, revision_number, claim_text,
           evidence_id, evidence_mode, extraction_profile, status, provider_call,
           access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, 1, $5, $6, 'DIRECT_EVIDENCE', 'direct-only', 'READY', '{}', '{owner}', 'private', $7)`,
        [
          input.candidateId,
          input.batchId,
          projectId,
          sourceVersionId,
          input.claimText,
          input.evidenceId,
          now,
        ],
      );
    };
    await insertCandidate({
      candidateId: candidateAId,
      batchId: candidateABatchId,
      claimText: candidateAText,
      evidenceId: candidateAEvidenceId,
    });
    await insertCandidate({
      candidateId: candidateBId,
      batchId: candidateBBatchId,
      claimText: candidateBText,
      evidenceId: candidateBEvidenceId,
    });

    const canonicalClaim = {
      claimId: canonicalClaimId,
      projectId,
      revisionNumber: 1 as const,
      claimText: canonicalText,
      sourceVersionId,
      evidenceIds: [canonicalEvidenceId],
      createdFromManifestId: canonicalManifestId,
      authorityId: null,
      authorityDigest: null,
      accessScope: ['owner'],
      sensitivity: 'private' as const,
      createdAt: now,
    };
    const snapshotDigest = canonicalSnapshotDigest(projectId, 0, [
      {
        claimId: canonicalClaimId,
        text: canonicalText,
        revisionNumber: 1,
        evidenceIds: [canonicalEvidenceId],
      },
    ]);
    await pool.query(
      `INSERT INTO canonical.claims (claim_id, project_id, source_version_id, manifest_id, claim_json, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        canonicalClaimId,
        projectId,
        sourceVersionId,
        canonicalManifestId,
        JSON.stringify(canonicalClaim),
        now,
      ],
    );
    await pool.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, 0, $2, $3)`,
      [projectId, snapshotDigest, now],
    );

    const canonical = new PostgresCanonicalKnowledgeRepository(pool);
    const generation: SemanticProjectionGeneration = {
      projectId,
      generationId: `generation:c5-fresh:${suffix}`,
      sourceProjectionDigest: hash('semantic-source-projection'),
      canonicalBaseVersion: 0,
      credentialId: `fixture-credential:${suffix}`,
      credentialRevision: 1,
      providerPolicyFingerprint: 'fixture-provider-policy:v1',
      providerId: 'fixture-provider',
      embeddingModelId: 'fixture-embedding-model',
      embeddingProfileId: `fixture-embedding-profile:${suffix}`,
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'fixture-provider-registry:v1',
      capabilityCatalogRevision: 'fixture-capability-catalog:v1',
      representationVersion: 'fixture-semantic-representation:v1',
      dimension: 3,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: now,
    };
    const generationReader = {
      async getActiveGeneration(requestProjectId: string) {
        const snapshot = await canonical.getSnapshot(requestProjectId);
        return { ...generation, canonicalBaseVersion: snapshot.version };
      },
    };
    const activeGeneration = await generationReader.getActiveGeneration(projectId);
    expect(activeGeneration).toMatchObject({
      projectId,
      buildStatus: 'READY',
      embeddingProfileId: generation.embeddingProfileId,
      embeddingProfileRevision: 1,
      canonicalBaseVersion: 0,
    });

    const searchProjection: SearchProjectionRepositoryPort = {
      applyCommit: async () => undefined,
      rebuild: async () => undefined,
      markDegraded: async () => undefined,
      async findWatermark(requestProjectId) {
        const snapshot = await canonical.getSnapshot(requestProjectId);
        return {
          projectId: requestProjectId,
          canonicalVersion: snapshot.version,
          snapshotDigest: snapshot.digest,
          status: 'READY',
          updatedAt: snapshot.createdAt,
          lastCommitId: `canonical:${requestProjectId}:${snapshot.version}`,
        };
      },
      search: async () => [],
    };
    const hybridRetrieval: HybridRetrievalCoordinatorPort = {
      async search(input) {
        const snapshot = await canonical.getSnapshot(input.projectId);
        const currentGeneration = { ...generation, canonicalBaseVersion: snapshot.version };
        return {
          schemaVersion: '1.0.0',
          projectId: input.projectId,
          query: input.query,
          items: snapshot.claims.map((claim, index) => ({
            resourceType: 'CLAIM' as const,
            resourceId: claim.claimId,
            text: claim.text,
            authority: 'CANONICAL' as const,
            authorityRevision: claim.revisionNumber,
            resourceRevision: claim.revisionNumber,
            canonicalVersion: snapshot.version,
            sourceSnapshotDigest: snapshot.digest,
            sourceProjectionDigest: currentGeneration.sourceProjectionDigest,
            evidenceIds: [...claim.evidenceIds],
            citations: [],
            accessScope: ['owner'],
            sensitivity: 'private' as const,
            signals: ['SEMANTIC' as const],
            semanticRank: index + 1,
            fusionRank: index + 1,
            fusionScore: 1 / (index + 1),
          })),
          fusionPolicy: { version: 'rrf:v1', k: 60 },
          readiness: {
            lexical: {
              status: 'READY',
              projectedCanonicalVersion: snapshot.version,
              canonicalVersion: snapshot.version,
              lag: 0,
              canonicalSnapshotDigest: snapshot.digest,
              projectedSnapshotDigest: snapshot.digest,
              lastCommitId: `canonical:${input.projectId}:${snapshot.version}`,
            },
            semantic: {
              status: 'READY',
              data: 'READY',
              execution: 'AVAILABLE',
              activeGenerationId: currentGeneration.generationId,
            },
            degraded: false,
          },
          generatedAt: now,
        };
      },
    };
    const executionResolver = {
      async resolve() {
        return {
          executionIdentity: {
            providerId: 'fixture-provider',
            modelId: 'fixture-generation-model',
            aiConfigurationRevision: 1,
            credentialId: generation.credentialId,
            credentialRevision: generation.credentialRevision,
            policyContextRevision: 'fixture-policy-context:v1',
            providerPolicyFingerprint: generation.providerPolicyFingerprint,
          },
          adapter: {
            identity: {
              provider: 'fixture-provider',
              model: 'fixture-generation-model',
              adapterVersion: 'fixture-adapter:v1',
              dataPolicyVersion: 'fixture-data-policy:v1',
            },
            async generateStructured(request: { readonly prompt: string }) {
              const parsed = JSON.parse(request.prompt) as {
                readonly claims?: readonly {
                  readonly resourceId: string;
                  readonly resourceRevision: number;
                }[];
              };
              return {
                rawText: JSON.stringify({
                  relationships: (parsed.claims ?? []).map((claim) => ({
                    resourceId: claim.resourceId,
                    resourceRevision: claim.resourceRevision,
                    type: 'UNRELATED',
                    rationale: 'The fixture Candidate is distinct from the Canonical claim.',
                  })),
                }),
                providerResponseId: `fixture-provider-response:${randomUUID()}`,
              };
            },
          },
        };
      },
    };

    const auth = new InMemoryAuthRepository();
    await auth.bootstrapOwner({
      accountId: `account:${projectId}`,
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId(`account:${projectId}`);
    if (!principal) throw new Error('Fresh C5 Product fixture principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const settingsRepository = new InMemorySettingsRepository();
    settingsRepository.getProjectSettingValue = async () => 'V2_ACTIVE';
    const candidateRepository: CandidateRepositoryPort = new PostgresCandidateRepository(pool);
    const comparisonV2Repository = new PostgresComparisonV2Repository(pool);
    const reviewV2Repository = new PostgresChangeSetReviewV2Repository(pool);
    const application = await createApplication({
      authRepository: auth,
      candidateRepository,
      evidenceRepository: new PostgresEvidenceRepository(pool),
      comparisonRepository: new PostgresComparisonRepository(pool),
      comparisonV2Repository,
      changeSetReviewRepository: new PostgresChangeSetReviewRepository(pool),
      changeSetReviewV2Repository: reviewV2Repository,
      frontendReviewStore: new PostgresFrontendReviewRepository(pool),
      canonicalSnapshot: canonical,
      canonicalKnowledgeRepository: canonical,
      searchProjectionRepository: searchProjection,
      hybridRetrievalCoordinator: hybridRetrieval,
      semanticActiveGenerationReader: generationReader,
      comparisonV2ExecutionResolver: executionResolver,
      settingsRepository,
      sourcesProjectionRepository: new PostgresOriginalAssetRepository(pool),
    });

    try {
      const clientFetch: typeof globalThis.fetch = async (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const headers = new Headers(init?.headers);
        headers.set('cookie', cookie);
        const payload =
          typeof init?.body === 'string' && init.body.length > 0
            ? JSON.parse(init.body)
            : undefined;
        const response = await application.server.inject({
          method: (init?.method ?? 'GET') as 'GET' | 'POST',
          url,
          headers: Object.fromEntries(headers.entries()),
          ...(payload === undefined ? {} : { payload }),
        });
        return new Response(response.body, {
          status: response.statusCode,
          headers: { 'content-type': 'application/json' },
        });
      };
      const apiClient = createShotgunApiClient({ fetch: clientFetch });
      const reviewRoute = { routeId: 'review' as const, href: '/review' as const };

      const beforeCounts = await pool.query<{ comparisons: string; commits: string }>(
        `SELECT
           (SELECT count(*)::text FROM comparison.results_v2 WHERE project_id = $1) AS comparisons,
           (SELECT count(*)::text FROM canonical.commits WHERE project_id = $1) AS commits`,
        [projectId],
      );
      expect(beforeCounts.rows[0]).toEqual({ comparisons: '0', commits: '0' });
      expect(await reviewV2Repository.listDrafts(projectId)).toHaveLength(0);

      const beforeHome = await apiClient.getHomeActionCenter();
      expect(beforeHome.attention.some((item) => item.kind === 'REVIEW_DECISION')).toBe(false);
      const beforeGuard = await apiClient.getRouteGuardDecision(reviewRoute);
      expect(beforeGuard).toMatchObject({ decision: 'FEATURE_UNAVAILABLE', masked: false });

      const candidates = await apiClient.getSourceCandidates(sourceId, sourceVersionId);
      expect(candidates.items).toHaveLength(2);
      expect(candidates.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            candidateId: candidateAId,
            revisionNumber: 1,
            status: 'READY',
            sourceVersionId,
          }),
          expect.objectContaining({
            candidateId: candidateBId,
            revisionNumber: 1,
            status: 'READY',
            sourceVersionId,
          }),
        ]),
      );
      const [candidateA, candidateB] = candidates.items;
      if (!candidateA || !candidateB)
        throw new Error('Fresh Product Candidate list was incomplete.');
      expect(candidateA.candidateId).not.toBe(candidateB.candidateId);
      expect(new Set(candidates.items.map((item) => item.candidateId))).toEqual(
        new Set([candidateAId, candidateBId]),
      );

      const canonicalBefore = await canonical.getSnapshot(projectId);
      const canonicalIdentityBefore = {
        version: canonicalBefore.version,
        digest: canonicalBefore.digest,
        claims: canonicalBefore.claims,
      };
      const keyA = `c5-fresh-a:${suffix}`;
      const resultA = await apiClient.recompareCandidate({
        candidateId: candidateA.candidateId,
        idempotencyKey: keyA,
      });
      expect(resultA).toMatchObject({
        commandStatus: 'processed',
        result: {
          candidateId: candidateA.candidateId,
          candidateRevisionNumber: 1,
          rollout: 'V2_ACTIVE',
          v1Executed: false,
          v2: { status: 'COMPLETED' },
          review: { status: 'DRAFT_CREATED' },
        },
      });
      const v2A = resultA.result.v2;
      if (v2A?.status !== 'COMPLETED' || !v2A.comparisonId) {
        throw new Error('Candidate A did not return a completed V2 Comparison ID.');
      }
      const comparisonAId = v2A.comparisonId;
      const aggregateA = await comparisonV2Repository.findComparisonById(projectId, comparisonAId);
      if (!aggregateA) throw new Error('Candidate A V2 aggregate was not persisted.');
      expect(aggregateA.comparison.candidate).toMatchObject({
        id: candidateA.candidateId,
        revision: candidateA.revisionNumber,
        sourceVersionId,
      });
      expect(aggregateA.comparison.canonicalSnapshot).toEqual({
        id: canonicalBefore.snapshotId,
        version: canonicalBefore.version,
        digest: canonicalBefore.digest,
      });
      expect(aggregateA.comparison.shortlist).toMatchObject({
        semanticGenerationId: activeGeneration.generationId,
        semanticSourceProjectionDigest: activeGeneration.sourceProjectionDigest,
        semanticCanonicalBaseVersion: activeGeneration.canonicalBaseVersion,
        querySemanticReadiness: 'READY',
      });
      const analysisA = aggregateA.analyses[0];
      expect(analysisA).toMatchObject({
        state: 'COMPLETED',
        providerIdentity: {
          providerId: 'fixture-provider',
          modelId: 'fixture-generation-model',
        },
        credentialRevisionRef: expect.stringContaining(`${generation.credentialId}:`),
      });
      const draftA = await reviewV2Repository.findDraftByComparisonId(projectId, comparisonAId);
      if (!draftA) throw new Error('Candidate A Review V2 draft was not persisted.');
      expect(draftA).toMatchObject({
        comparisonId: comparisonAId,
        candidate: {
          id: candidateA.candidateId,
          revision: candidateA.revisionNumber,
          sourceVersionId,
        },
        canonicalSnapshot: aggregateA.comparison.canonicalSnapshot,
        status: 'PENDING_REVIEW',
      });

      const afterAHome = await apiClient.getHomeActionCenter();
      expect(afterAHome.attention).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: 'REVIEW_DECISION', projectId })]),
      );
      const afterAGuard = await apiClient.getRouteGuardDecision(reviewRoute);
      expect(afterAGuard).toMatchObject({
        decision: 'ALLOW',
        targetRoute: reviewRoute,
        activeProjectId: projectId,
      });

      const candidatesAfterA = await apiClient.getSourceCandidates(sourceId, sourceVersionId);
      expect(candidatesAfterA.items.map((item) => item.candidateId).sort()).toEqual(
        [candidateA.candidateId, candidateB.candidateId].sort(),
      );
      const keyB = `c5-fresh-b:${suffix}`;
      const resultB = await apiClient.recompareCandidate({
        candidateId: candidateB.candidateId,
        idempotencyKey: keyB,
      });
      expect(resultB).toMatchObject({
        commandStatus: 'processed',
        result: {
          candidateId: candidateB.candidateId,
          candidateRevisionNumber: 1,
          rollout: 'V2_ACTIVE',
          v1Executed: false,
          v2: { status: 'COMPLETED' },
          review: { status: 'DRAFT_CREATED' },
        },
      });
      expect(keyB).not.toBe(keyA);
      const v2B = resultB.result.v2;
      if (v2B?.status !== 'COMPLETED' || !v2B.comparisonId) {
        throw new Error('Candidate B did not return a completed V2 Comparison ID.');
      }
      const comparisonBId = v2B.comparisonId;
      expect(comparisonBId).not.toBe(comparisonAId);
      const draftB = await reviewV2Repository.findDraftByComparisonId(projectId, comparisonBId);
      expect(draftB).toMatchObject({
        comparisonId: comparisonBId,
        candidate: { id: candidateB.candidateId, revision: candidateB.revisionNumber },
        status: 'PENDING_REVIEW',
      });

      const beforeReplayDrafts = await reviewV2Repository.listDrafts(projectId);
      expect(beforeReplayDrafts).toHaveLength(2);
      const replayA = await apiClient.recompareCandidate({
        candidateId: candidateA.candidateId,
        idempotencyKey: keyA,
      });
      expect(replayA).toMatchObject({
        commandStatus: 'duplicate',
        result: {
          candidateId: candidateA.candidateId,
          rollout: 'V2_ACTIVE',
          v1Executed: false,
          v2: { status: 'COMPLETED', comparisonId: comparisonAId },
          review: { status: 'DRAFT_CREATED' },
        },
      });
      expect(await reviewV2Repository.listDrafts(projectId)).toHaveLength(2);
      const afterCounts = await pool.query<{ comparisons: string; commits: string }>(
        `SELECT
           (SELECT count(*)::text FROM comparison.results_v2 WHERE project_id = $1) AS comparisons,
           (SELECT count(*)::text FROM canonical.commits WHERE project_id = $1) AS commits`,
        [projectId],
      );
      expect(afterCounts.rows[0]).toEqual({ comparisons: '2', commits: '0' });
      const canonicalAfter = await canonical.getSnapshot(projectId);
      expect({
        version: canonicalAfter.version,
        digest: canonicalAfter.digest,
        claims: canonicalAfter.claims,
      }).toEqual(canonicalIdentityBefore);
      expect(canonicalAfter.version).toBe(0);
    } finally {
      await application.server.close();
    }
  });
});
