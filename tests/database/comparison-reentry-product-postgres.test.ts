import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import {
  canonicalSnapshotDigest,
  sha256Text,
  ShotgunError,
  type HybridRetrievalCoordinatorPort,
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
    const candidateAId = randomUUID();
    const candidateId = randomUUID();
    const candidateASourceVersionId = randomUUID();
    const candidateSourceVersionId = randomUUID();
    const candidateASourceId = randomUUID();
    const candidateSourceId = randomUUID();
    const candidateAAssetId = randomUUID();
    const candidateAssetId = randomUUID();
    const candidateARevisionId = randomUUID();
    const candidateRevisionId = randomUUID();
    const candidateAEvidenceId = randomUUID();
    const candidateEvidenceId = randomUUID();
    const candidateABatchId = randomUUID();
    const candidateBatchId = randomUUID();
    const canonicalSourceVersionId = randomUUID();
    const canonicalSourceId = randomUUID();
    const canonicalAssetId = randomUUID();
    const canonicalRevisionId = randomUUID();
    const canonicalEvidenceId = randomUUID();
    const claimId = `claim-${randomUUID()}`;
    const manifestId = randomUUID();
    const now = new Date().toISOString();
    const candidateAText = 'Candidate A to approve at the initial Canonical snapshot.';
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
      sourceId: candidateASourceId,
      sourceVersionId: candidateASourceVersionId,
      assetId: candidateAAssetId,
      revisionId: candidateARevisionId,
      evidenceId: candidateAEvidenceId,
      content: candidateAText,
    });
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
    const insertCandidate = async (input: {
      readonly candidateId: string;
      readonly batchId: string;
      readonly sourceVersionId: string;
      readonly claimText: string;
      readonly evidenceId: string;
      readonly status?: 'READY' | 'REJECTED';
      readonly accessScope?: readonly string[];
      readonly sensitivity?: 'public' | 'internal' | 'private';
    }) => {
      await pool.query(
        `INSERT INTO candidate.batches (batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at)
         VALUES ($1, $2, $3, $4, '{}', $5)`,
        [input.batchId, projectId, input.sourceVersionId, `batch-${input.candidateId}`, now],
      );
      await pool.query(
        `INSERT INTO candidate.claim_candidates (
           candidate_id, batch_id, project_id, source_version_id, revision_number, claim_text,
           evidence_id, evidence_mode, extraction_profile, status, provider_call,
           access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, 1, $5, $6, 'DIRECT_EVIDENCE', 'direct-only', $7, '{}', $8, $9, $10)`,
        [
          input.candidateId,
          input.batchId,
          projectId,
          input.sourceVersionId,
          input.claimText,
          input.evidenceId,
          input.status ?? 'READY',
          input.accessScope ?? ['owner'],
          input.sensitivity ?? 'private',
          now,
        ],
      );
    };
    await insertCandidate({
      candidateId: candidateAId,
      batchId: candidateABatchId,
      sourceVersionId: candidateASourceVersionId,
      claimText: candidateAText,
      evidenceId: candidateAEvidenceId,
    });
    await insertCandidate({
      candidateId,
      batchId: candidateBatchId,
      sourceVersionId: candidateSourceVersionId,
      claimText: candidateText,
      evidenceId: candidateEvidenceId,
    });

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
    const snapshotDigest = canonicalSnapshotDigest(projectId, 0, [
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
       VALUES ($1, 0, $2, $3)`,
      [projectId, snapshotDigest, now],
    );

    const canonical = new PostgresCanonicalKnowledgeRepository(pool);
    let generationEpoch = 0;
    let rolloutState: 'V1_ONLY' | 'V2_ACTIVE' = 'V1_ONLY';
    const generationFor = (canonicalVersion: number): SemanticProjectionGeneration => ({
      projectId,
      generationId: `generation-${projectId}-e${generationEpoch}`,
      sourceProjectionDigest: hash(`semantic-source-${generationEpoch}`),
      canonicalBaseVersion: canonicalVersion,
      credentialId: 'deepseek-credential',
      credentialRevision: 1,
      providerPolicyFingerprint: 'policy-fingerprint-v1',
      providerId: 'deepseek',
      embeddingModelId: 'embedding-test',
      embeddingProfileId: 'embedding-profile',
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'provider-registry-v1',
      capabilityCatalogRevision: 'capability-catalog-v1',
      representationVersion: 'representation-version-v1',
      dimension: 3,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt: now,
    });
    const searchProjection: SearchProjectionRepositoryPort = {
      applyCommit: async () => undefined,
      rebuild: async () => undefined,
      markDegraded: async () => undefined,
      async findWatermark(project) {
        const snapshot = await canonical.getSnapshot(project);
        return {
          projectId: project,
          canonicalVersion: snapshot.version,
          snapshotDigest: snapshot.digest,
          status: 'READY',
          updatedAt: snapshot.createdAt,
          lastCommitId: `canonical-${project}-${snapshot.version}`,
        };
      },
      search: async () => [],
    };
    const hybridRetrieval: HybridRetrievalCoordinatorPort = {
      async search(input) {
        const snapshot = await canonical.getSnapshot(projectId);
        const generation = generationFor(snapshot.version);
        return {
          schemaVersion: '1.0.0',
          projectId,
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
            sourceProjectionDigest: generation.sourceProjectionDigest,
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
              lastCommitId: `canonical-${projectId}-${snapshot.version}`,
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
    let semanticFailure = false;
    let semanticRelationshipType: 'UNRELATED' | 'SUPPORTS' = 'UNRELATED';
    const executionResolver = {
      async resolve() {
        const modelId = `deepseek-chat-e${generationEpoch}`;
        const executionIdentity = {
          providerId: 'deepseek',
          modelId,
          aiConfigurationRevision: 1,
          credentialId: 'deepseek-credential',
          credentialRevision: 1,
          policyContextRevision: 'policy-context-v1',
          providerPolicyFingerprint: 'policy-fingerprint-v1',
        } as const;
        return {
          executionIdentity,
          adapter: {
            identity: {
              provider: 'deepseek',
              model: modelId,
              adapterVersion: 'test-adapter-v1',
              dataPolicyVersion: 'test-policy-v1',
            },
            async generateStructured(request: { readonly prompt: string }) {
              providerCalls += 1;
              if (semanticFailure) {
                throw new ShotgunError({
                  code: 'TERMINAL_FAILURE',
                  safeMessage:
                    'Deterministic V2 semantic provider failure for Product bridge test.',
                  module: 'stage5.product-reentry-test',
                  operation: 'semantic-provider',
                });
              }
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
                    type: semanticRelationshipType,
                    rationale: 'The candidate is distinct from this existing Canonical claim.',
                  })),
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
    const candidateRepository: CandidateRepositoryPort = new PostgresCandidateRepository(pool);
    const generationReader = {
      async getActiveGeneration(project: string) {
        const current = await canonical.getSnapshot(project);
        return generationFor(current.version);
      },
    };
    const reviewV1 = new PostgresChangeSetReviewRepository(pool);
    const reviewV2 = new PostgresChangeSetReviewV2Repository(pool);
    const application = await createApplication({
      authRepository: auth,
      candidateRepository,
      comparisonRepository: new PostgresComparisonRepository(pool),
      comparisonV2Repository: new PostgresComparisonV2Repository(pool),
      changeSetReviewRepository: reviewV1,
      changeSetReviewV2Repository: reviewV2,
      canonicalSnapshot: canonical,
      canonicalKnowledgeRepository: canonical,
      searchProjectionRepository: searchProjection,
      hybridRetrievalCoordinator: hybridRetrieval,
      semanticActiveGenerationReader: generationReader,
      comparisonV2ExecutionResolver: executionResolver,
      settingsRepository: {
        getProjectSettingValue: async () => rolloutState,
      } as never,
    });
    try {
      const csrfFor = async (sessionCookie: string) =>
        (
          await application.server.inject({
            method: 'GET',
            url: '/api/v1/security/csrf',
            headers: { cookie: sessionCookie },
          })
        ).json<{ csrfToken: string }>().csrfToken;
      const csrf = await csrfFor(cookie);
      const invoke = async (candidateOrKey: string, maybeIdempotencyKey?: string) => {
        const requestCandidateId = maybeIdempotencyKey === undefined ? candidateId : candidateOrKey;
        const idempotencyKey = maybeIdempotencyKey ?? candidateOrKey;
        return application.server.inject({
          method: 'POST',
          url: '/comparisons/recompare',
          headers: { cookie, 'x-csrf-token': csrf },
          payload: { candidateId: requestCandidateId, idempotencyKey },
        });
      };
      const decideV1 = async (changeSet: {
        readonly changeSetId: string;
        readonly contentDigest: string;
      }) =>
        application.server.inject({
          method: 'POST',
          url: '/reviews/decision',
          headers: { cookie, 'x-csrf-token': csrf },
          payload: {
            changeSetId: changeSet.changeSetId,
            expectedRevisionNumber: 1,
            expectedContentDigest: changeSet.contentDigest,
            decision: 'APPROVE',
            reason: 'PostgreSQL sequential stale re-entry acceptance.',
          },
        });
      const decideV2 = async (changeSet: {
        readonly changeSetId: string;
        readonly contentDigest: string;
      }) =>
        application.server.inject({
          method: 'POST',
          url: '/reviews/v2/decision',
          headers: { cookie, 'x-csrf-token': csrf },
          payload: {
            changeSetId: changeSet.changeSetId,
            expectedRevisionNumber: 1,
            expectedContentDigest: changeSet.contentDigest,
            decision: 'APPROVE',
            reason: 'Approve the current V2 comparison after review.',
          },
        });

      // A/B are first materialized by the normal legacy Product comparison and
      // review path while the Canonical authority is still V1_ONLY at version 0.
      const initialA = await invoke(candidateAId, 'product-key-a-v0');
      const initialB = await invoke(candidateId, 'product-key-b-v0');
      expect(initialA.statusCode).toBe(200);
      expect(initialB.statusCode).toBe(200);
      expect(initialA.json()).toMatchObject({
        result: { rollout: 'V1_ONLY', v1Executed: true, snapshotVersion: 0 },
      });
      expect(initialB.json()).toMatchObject({
        result: { rollout: 'V1_ONLY', v1Executed: true, snapshotVersion: 0 },
      });
      const initialAResult = initialA.json().result as { comparisonId: string };
      const initialBResult = initialB.json().result as { comparisonId: string };
      const oldA = await reviewV1.findByComparisonId(projectId, initialAResult.comparisonId);
      const oldB = await reviewV1.findByComparisonId(projectId, initialBResult.comparisonId);
      if (!oldA || !oldB) throw new Error('Initial PostgreSQL ChangeSets were not materialized.');
      expect(oldA.expectedCanonicalVersion).toBe(0);
      expect(oldB.expectedCanonicalVersion).toBe(0);
      expect((await canonical.getSnapshot(projectId)).version).toBe(0);

      // Approve A through the normal Product legacy Review route. The required
      // ChangeSetApproved handoff advances the real PostgreSQL Canonical state.
      const approvedA = await decideV1(oldA);
      expect(approvedA.statusCode).toBe(200);
      const afterA = await canonical.getSnapshot(projectId);
      expect(afterA.version).toBe(1);
      expect(afterA.claims).toHaveLength(2);

      // B's old approval is now stale. The review adapter marks the old row
      // STALE while preserving its original Comparison/ChangeSet evidence.
      const staleOldB = await decideV1(oldB);
      expect(staleOldB.statusCode).toBe(409);
      expect(staleOldB.json()).toMatchObject({ code: 'STALE_VERSION' });
      const oldBAfterFailure = await reviewV1.findById(projectId, oldB.changeSetId);
      expect(oldBAfterFailure).toMatchObject({ status: 'STALE' });
      const staleEvidence = await pool.query(
        `SELECT comparison_id, change_set_id, status
           FROM review.change_sets
          WHERE project_id = $1 AND change_set_id = $2`,
        [projectId, oldB.changeSetId],
      );
      expect(staleEvidence.rows[0]).toMatchObject({
        comparison_id: oldB.comparisonId,
        change_set_id: oldB.changeSetId,
        status: 'STALE',
      });
      expect(
        application.kernel.connector.deadLetters
          .list()
          .some((entry) => entry.error.code === 'STALE_VERSION'),
      ).toBe(true);

      // Enable V2 only after the stale legacy evidence exists. Recompare is
      // server-bound to the current Canonical v1 snapshot.
      rolloutState = 'V2_ACTIVE';
      const reenteredB = await invoke('product-key-b-v1');
      expect(reenteredB.statusCode).toBe(200);
      const reenteredBody = reenteredB.json<{
        result: {
          rollout: string;
          v1Executed: boolean;
          v2: { status: string; comparisonId?: string; snapshotVersion?: number };
          review: { status: string };
        };
      }>();
      expect(reenteredBody.result).toMatchObject({
        rollout: 'V2_ACTIVE',
        v1Executed: false,
        v2: { status: 'COMPLETED', snapshotVersion: 1 },
        review: { status: 'DRAFT_CREATED' },
      });
      const reenteredComparisonId = reenteredBody.result.v2.comparisonId;
      if (!reenteredComparisonId) throw new Error('V2 re-entry did not return comparisonId.');
      const reenteredDraft = await reviewV2.findDraftByComparisonId(
        projectId,
        reenteredComparisonId,
      );
      if (!reenteredDraft) throw new Error('V2 re-entry did not materialize a Review draft.');
      expect(reenteredDraft.expectedCanonicalVersion).toBe(1);
      expect((await canonical.getSnapshot(projectId)).version).toBe(1);

      // G1 connector replay and G2 governed-identity replay are both exercised.
      const duplicateKey = await invoke('product-key-b-v1');
      expect(duplicateKey.statusCode).toBe(200);
      expect(duplicateKey.json()).toMatchObject({ commandStatus: 'duplicate' });
      const sameIdentityDifferentKey = await invoke('product-key-b-v1-alt');
      expect(sameIdentityDifferentKey.statusCode).toBe(200);
      expect(sameIdentityDifferentKey.json()).toMatchObject({
        result: {
          v2: { status: 'COMPLETED', comparisonId: reenteredComparisonId, snapshotVersion: 1 },
        },
      });
      expect(providerCalls).toBe(1);
      expect((await canonical.getSnapshot(projectId)).version).toBe(1);

      // G3 changes the governed provider/generation identity while Candidate B
      // and the authoritative Canonical v1 snapshot remain unchanged.
      generationEpoch = 1;
      const changedIdentity = await invoke('product-key-b-v1-governed-change');
      expect(changedIdentity.statusCode).toBe(200);
      const changedBody = changedIdentity.json<typeof reenteredBody>();
      expect(changedBody.result).toMatchObject({
        rollout: 'V2_ACTIVE',
        v1Executed: false,
        v2: { status: 'COMPLETED', snapshotVersion: 1 },
        review: { status: 'DRAFT_CREATED' },
      });
      expect(changedBody.result.v2.comparisonId).toBeTruthy();
      expect(changedBody.result.v2.comparisonId).not.toBe(reenteredComparisonId);
      expect(providerCalls).toBe(2);
      const changedDraft = await reviewV2.findDraftByComparisonId(
        projectId,
        changedBody.result.v2.comparisonId!,
      );
      if (!changedDraft) throw new Error('Changed governed identity did not create a new Draft.');
      expect(changedDraft.expectedCanonicalVersion).toBe(1);
      expect((await canonical.getSnapshot(projectId)).version).toBe(1);

      // The Product bridge must surface the exact durable AnalysisRevision
      // identity for a terminal V2 semantic failure without falling back to
      // the legacy V1 comparison path.
      const failureCandidateId = randomUUID();
      await insertCandidate({
        candidateId: failureCandidateId,
        batchId: randomUUID(),
        sourceVersionId: candidateSourceVersionId,
        claimText: 'Candidate that deterministically fails at V2 provider execution.',
        evidenceId: candidateEvidenceId,
      });
      semanticFailure = true;
      const failedReentry = await invoke(failureCandidateId, 'product-key-v2-terminal-failure');
      expect(failedReentry.statusCode).toBe(200);
      const failedBody = failedReentry.json<{
        result: {
          rollout: string;
          v1Executed: boolean;
          v2: {
            status: string;
            comparisonId: string;
            snapshotVersion: number;
            snapshotDigest: string;
            analysisRevisionId: string;
            analysisState: string;
            safeFailureCode: string;
          };
          review: { status: string };
        };
      }>();
      expect(failedBody.result).toMatchObject({
        rollout: 'V2_ACTIVE',
        v1Executed: false,
        v2: {
          status: 'FAILED',
          analysisState: 'FAILED_TERMINAL',
          safeFailureCode: 'TERMINAL_FAILURE',
        },
        review: { status: 'NOT_ATTEMPTED' },
      });
      const failedAnalysis = await pool.query<{
        analysis_revision_id: string;
        comparison_id: string;
        snapshot_version: number;
        snapshot_digest: string;
        state: string;
        safe_failure_code: string;
      }>(
        `SELECT analysis_revision_id,comparison_id,snapshot_version,snapshot_digest,state,safe_failure_code
           FROM comparison.analysis_revisions_v2
          WHERE project_id = $1 AND candidate_id = $2
          ORDER BY attempt DESC`,
        [projectId, failureCandidateId],
      );
      expect(failedAnalysis.rows).toHaveLength(1);
      const durableFailure = failedAnalysis.rows[0]!;
      expect(failedBody.result.v2).toEqual(
        expect.objectContaining({
          comparisonId: durableFailure.comparison_id,
          snapshotVersion: durableFailure.snapshot_version,
          snapshotDigest: durableFailure.snapshot_digest,
          analysisRevisionId: durableFailure.analysis_revision_id,
          analysisState: durableFailure.state,
          safeFailureCode: durableFailure.safe_failure_code,
        }),
      );
      expect(failedBody.result).not.toHaveProperty('v2.rawText');
      expect(failedBody.result).not.toHaveProperty('v2.providerError');
      const legacyFailureComparison = await pool.query(
        `SELECT comparison_id FROM comparison.results WHERE project_id = $1 AND candidate_id = $2`,
        [projectId, failureCandidateId],
      );
      expect(legacyFailureComparison.rows).toHaveLength(0);
      semanticFailure = false;

      // A source-supported relationship produces a REVIEW_REQUIRED /
      // MODIFY_REVIEW Draft.  The Product Review route must fail closed for
      // APPROVE before it persists a decision or publishes a Canonical event.
      const modifyReviewCandidateId = randomUUID();
      await insertCandidate({
        candidateId: modifyReviewCandidateId,
        batchId: randomUUID(),
        sourceVersionId: candidateSourceVersionId,
        claimText: 'Candidate requiring a governed review-only resolution.',
        evidenceId: candidateEvidenceId,
      });
      semanticRelationshipType = 'SUPPORTS';
      const modifyReviewResponse = await invoke(
        modifyReviewCandidateId,
        'product-key-v2-modify-review-approval',
      );
      expect(modifyReviewResponse.statusCode).toBe(200);
      const modifyReviewBody = modifyReviewResponse.json<{
        result: {
          v2: { status: string; comparisonId?: string };
          review: { status: string };
        };
      }>();
      expect(modifyReviewBody.result).toMatchObject({
        v2: { status: 'COMPLETED' },
        review: { status: 'DRAFT_CREATED' },
      });
      const modifyReviewComparisonId = modifyReviewBody.result.v2.comparisonId;
      if (!modifyReviewComparisonId) {
        throw new Error('MODIFY_REVIEW regression did not return a comparisonId.');
      }
      const modifyReviewDraft = await reviewV2.findDraftByComparisonId(
        projectId,
        modifyReviewComparisonId,
      );
      if (!modifyReviewDraft) throw new Error('MODIFY_REVIEW Draft was not persisted.');
      expect(modifyReviewDraft).toMatchObject({
        operation: 'MODIFY_REVIEW',
        reviewRecommendation: 'MODIFY_REVIEW',
        status: 'PENDING_REVIEW',
      });
      const beforeModifyDecision = await pool.query<{ decisions: string; manifests: string }>(
        `SELECT
           (SELECT count(*)::text FROM review.decisions_v2 WHERE project_id = $1) AS decisions,
           (SELECT count(*)::text FROM review.approved_manifests_v2 WHERE project_id = $1) AS manifests`,
        [projectId],
      );
      const deadLettersBeforeModifyDecision =
        application.kernel.connector.deadLetters.list().length;
      const blockedModifyReview = await decideV2(modifyReviewDraft);
      expect(blockedModifyReview.statusCode).toBe(409);
      expect(blockedModifyReview.json()).toEqual({
        status: 'BLOCKED',
        reason: 'REVIEW_NOT_ELIGIBLE',
      });
      const afterModifyDecision = await pool.query<{ decisions: string; manifests: string }>(
        `SELECT
           (SELECT count(*)::text FROM review.decisions_v2 WHERE project_id = $1) AS decisions,
           (SELECT count(*)::text FROM review.approved_manifests_v2 WHERE project_id = $1) AS manifests`,
        [projectId],
      );
      expect(afterModifyDecision.rows[0]).toEqual(beforeModifyDecision.rows[0]);
      expect(application.kernel.connector.deadLetters.list()).toHaveLength(
        deadLettersBeforeModifyDecision,
      );
      const modifyReviewDraftAfterBlock = await reviewV2.findDraftByComparisonId(
        projectId,
        modifyReviewComparisonId,
      );
      expect(modifyReviewDraftAfterBlock).toMatchObject({
        operation: 'MODIFY_REVIEW',
        status: 'PENDING_REVIEW',
      });
      semanticRelationshipType = 'UNRELATED';

      const counts = await pool.query<{
        comparisons: string;
        analyses: string;
        relationships: string;
        reviews: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM comparison.results_v2 WHERE project_id = $1) AS comparisons,
           (SELECT count(*)::text FROM comparison.analysis_revisions_v2 WHERE project_id = $1) AS analyses,
           (SELECT count(*)::text FROM comparison.relationships_v2 WHERE project_id = $1) AS relationships,
           (SELECT count(*)::text FROM review.change_sets_v2 WHERE project_id = $1) AS reviews`,
        [projectId],
      );
      expect(counts.rows[0]).toEqual({
        comparisons: '3',
        analyses: '4',
        relationships: '6',
        reviews: '3',
      });

      // Only the refreshed B draft is approved. This is the normal V2 Product
      // Review -> ChangeSetApprovedV2 -> PostgreSQL Canonical commit path.
      const approvedB = await decideV2(changedDraft);
      expect(approvedB.statusCode).toBe(200);
      expect(approvedB.json()).toMatchObject({ commandStatus: 'succeeded' });
      const afterB = await canonical.getSnapshot(projectId);
      expect(afterB.version).toBe(2);
      expect(afterB.claims).toHaveLength(3);

      // H/I fail-closed checks use the same authenticated Product route.
      const rejectedId = randomUUID();
      const restrictedId = randomUUID();
      await insertCandidate({
        candidateId: rejectedId,
        batchId: randomUUID(),
        sourceVersionId: candidateSourceVersionId,
        claimText: 'Rejected candidate must not re-enter.',
        evidenceId: candidateEvidenceId,
        status: 'REJECTED',
      });
      await insertCandidate({
        candidateId: restrictedId,
        batchId: randomUUID(),
        sourceVersionId: candidateSourceVersionId,
        claimText: 'Restricted candidate must fail access closed.',
        evidenceId: candidateEvidenceId,
        accessScope: ['finance'],
      });
      const rejected = await application.server.inject({
        method: 'POST',
        url: '/comparisons/recompare',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: { candidateId: rejectedId, idempotencyKey: 'rejected-candidate' },
      });
      expect(rejected.statusCode).not.toBe(200);
      const restricted = await application.server.inject({
        method: 'POST',
        url: '/comparisons/recompare',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: { candidateId: restrictedId, idempotencyKey: 'restricted-candidate' },
      });
      expect(restricted.statusCode).not.toBe(200);

      // A session bound to a different project cannot use this project's
      // Candidate identity, regardless of client-supplied payload fields.
      const otherProjectId = `${projectId}-other`;
      await auth.bootstrapOwner({
        accountId: `other-account-${projectId}`,
        projectId: otherProjectId,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });
      const otherPrincipal = await auth.findPrincipalByAccountId(`other-account-${projectId}`);
      if (!otherPrincipal) throw new Error('Cross-project fixture principal was not created.');
      const otherSession = await auth.createSession(
        otherPrincipal.principalId,
        otherProjectId,
        new Date(Date.now() + 60_000).toISOString(),
      );
      const crossProject = await application.server.inject({
        method: 'POST',
        url: '/comparisons/recompare',
        headers: {
          cookie: `shotgun_session=${otherSession.sessionToken}`,
          'x-csrf-token': await csrfFor(`shotgun_session=${otherSession.sessionToken}`),
        },
        payload: { candidateId, idempotencyKey: 'cross-project-candidate' },
      });
      expect(crossProject.statusCode).not.toBe(200);

      const publicPrincipal = await auth.bootstrapLocalOwnerPrincipal({
        accountId: `public-account-${projectId}`,
      });
      await auth.createProjectOwnerMembership({
        principalId: publicPrincipal.principalId,
        projectId,
        scopes: ['owner'],
        sensitivityClearance: 'public',
      });
      const publicSession = await auth.createSession(
        publicPrincipal.principalId,
        projectId,
        new Date(Date.now() + 60_000).toISOString(),
      );
      const publicCookie = `shotgun_session=${publicSession.sessionToken}`;
      const sensitivityMismatch = await application.server.inject({
        method: 'POST',
        url: '/comparisons/recompare',
        headers: {
          cookie: publicCookie,
          'x-csrf-token': await csrfFor(publicCookie),
        },
        payload: { candidateId, idempotencyKey: 'sensitivity-mismatch' },
      });
      expect(sensitivityMismatch.statusCode).not.toBe(200);

      const malformed = await application.server.inject({
        method: 'POST',
        url: '/comparisons/recompare',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: { candidateId, idempotencyKey: 'product-key-c', authority: 'V1' },
      });
      expect(malformed.statusCode).toBe(400);
    } finally {
      await application.server.close();
      await pool.query('DELETE FROM review.decisions WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM review.change_sets WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM comparison.results WHERE project_id = $1', [projectId]);
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
      await pool.query(
        'DELETE FROM asset.source_versions WHERE source_id IN (SELECT source_id FROM asset.sources WHERE project_id = $1)',
        [projectId],
      );
      await pool.query('DELETE FROM asset.sources WHERE project_id = $1', [projectId]);
      // Canonical claims are append-only by contract. The fixture uses a
      // unique project id and is intentionally retained for audit/replay
      // evidence rather than issuing a destructive delete.
    }
  });
});
