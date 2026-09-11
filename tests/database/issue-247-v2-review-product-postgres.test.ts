import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresCandidateRepository } from '../../adapters/postgres-stage4/src/index.js';
import { PostgresConnectorRuntimeState } from '../../adapters/connector-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  PostgresChangeSetReviewV2Repository,
  PostgresComparisonV2Repository,
} from '../../adapters/postgres-stage5/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { PostgresFrontendReviewRepository } from '../../adapters/frontend-review-postgres/src/index.js';
import {
  createPostgresHistoryReadModelStore,
  PostgresPayloadStateStore,
} from '../../adapters/frontend-history-postgres/src/index.js';
import { ReviewHistoryAdapter } from '../../adapters/frontend-history-review/src/index.js';
import {
  ComparisonV2ReviewTargetAdapter,
  type ComparisonV2ReviewSourceReader,
} from '../../adapters/frontend-review-in-memory/src/index.js';
import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { InMemoryAuthRepository } from '../../packages/authentication/src/index.js';
import { InMemorySettingsRepository } from '../../adapters/settings-project-admin-in-memory/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { FrontendReviewProductCoordinator } from '../../modules/frontend-review/src/index.js';
import {
  createHistoryAdapterRegistry,
  HistoryProductCoordinator,
  HistoryProjectionBuilder,
  type HistoryAdapterPort,
} from '../../modules/frontend-history/src/index.js';
import type { SearchProjectionRepositoryPort } from '../../modules/projection-search/src/index.js';
import { COMPARISON_ROLLOUT_SETTING_KEY } from '../../modules/settings-policy/src/index.js';
import {
  canonicalSnapshotDigest,
  sha256Text,
  stableJson,
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

const describeDatabase = describe.runIf(Boolean(databaseUrl));

const emptyHistoryAdapter = (domainKind: HistoryAdapterPort['domainKind']): HistoryAdapterPort => ({
  adapterId: `issue-265-empty-${domainKind.toLowerCase()}`,
  domainKind,
  readHistory: async () => [],
  resolveHistoryEntry: async () => undefined,
  redactEntry: async (entry) => entry,
});

describeDatabase('Issue #247 V2 Review Product PostgreSQL contract', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('keeps V2 Review authoritative across queue, decision replay, HOLD, and MODIFY revalidation', async () => {
    if (!pool) return;

    const suffix = randomUUID();
    const projectId = `issue-247-${suffix}`;
    const createdAt = '2026-09-09T00:00:00.000Z';
    const canonicalVersion = 0;
    const snapshot = {
      snapshotId: `canonical:${projectId}:${canonicalVersion}`,
      projectId,
      version: canonicalVersion,
      claims: [],
      createdAt,
      digest: canonicalSnapshotDigest(projectId, canonicalVersion, []),
    };
    const lexicalReadiness: ProjectionReadiness = {
      status: 'READY',
      projectedCanonicalVersion: snapshot.version,
      canonicalVersion: snapshot.version,
      lag: 0,
      projectedSnapshotDigest: snapshot.digest,
      canonicalSnapshotDigest: snapshot.digest,
      lastCommitId: `commit:issue-247:${suffix}`,
      updatedAt: createdAt,
    };
    const generation: SemanticProjectionGeneration = {
      projectId,
      generationId: `generation:issue-247:${suffix}`,
      sourceProjectionDigest: sha256Text(`source-projection:${suffix}`),
      canonicalBaseVersion: snapshot.version,
      credentialId: `credential:issue-247:${suffix}`,
      credentialRevision: 1,
      providerPolicyFingerprint: 'issue-247-provider-policy:v1',
      providerId: 'fixture-provider',
      embeddingModelId: 'fixture-model',
      embeddingProfileId: `embedding-profile:${suffix}`,
      embeddingProfileRevision: 1,
      providerRegistryRevision: 'issue-247-provider-registry:v1',
      capabilityCatalogRevision: 'issue-247-capability-catalog:v1',
      representationVersion: 'semantic-representation:v2',
      dimension: 3,
      distanceMetric: 'cosine',
      normalizationPolicy: 'unit_length',
      buildStatus: 'READY',
      createdAt,
    };
    const rolloutRevision = sha256Text(
      stableJson({ policy: 'comparison-stage5-rollout:v1', state: 'V2_ACTIVE' }),
    );
    const makeFixture = (name: string) => {
      const fixture = createAdr163ReviewFixture({
        suffix: `issue-247-${name}-${suffix}`,
        projectId,
        claimText: `Issue #247 ${name} Product Review fixture.`,
        candidateId: randomUUID(),
        batchId: randomUUID(),
        evidenceId: randomUUID(),
        sourceVersionId: randomUUID(),
        snapshot,
        createdAt,
        rolloutAuthorityRevision: rolloutRevision,
        semanticFreshness: {
          lexicalReadiness,
          semanticGeneration: generation,
          providerModelCapabilityIdentity:
            'fixture-provider/fixture-model/comparison-semantic-analysis:v1',
          shortlistPolicyRevision: `shortlist-policy:issue-247:${suffix}`,
        },
      });
      return { fixture };
    };

    const pending = makeFixture('pending');
    const hold = makeFixture('hold');
    const modify = makeFixture('modify');
    const drafts = [pending.fixture.draft, hold.fixture.draft, modify.fixture.draft];
    const reviewRepository = new PostgresChangeSetReviewV2Repository(pool);
    const frontendReviewStore = new PostgresFrontendReviewRepository(pool);
    const comparisonRepository = new PostgresComparisonV2Repository(pool);
    const candidateRepository = new PostgresCandidateRepository(pool);
    const canonicalRepository = new PostgresCanonicalKnowledgeRepository(pool);

    const insertLineage = async (fixture: ReturnType<typeof makeFixture>['fixture']) => {
      const candidate = fixture.candidate;
      const sourceHash = sha256Text(candidate.claimText);
      const sourceId = randomUUID();
      const revisionId = randomUUID();
      await pool.query(
        `INSERT INTO transformation.revisions (
           revision_id, project_id, source_id, source_version_id, source_content_hash,
           transformer_id, transformer_version, document_ir, source_map, document_hash,
           source_map_hash, access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'fixture', '1', '{}', '{}', $5, $5, '{owner}', 'private', $6)`,
        [revisionId, projectId, sourceId, candidate.sourceVersionId, sourceHash, createdAt],
      );
      await pool.query(
        `INSERT INTO evidence.spans (
           evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
           node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, $5, '/claim', 'sentence', 'source',
           '{"start":0,"end":1}', $6::jsonb, $7, '{owner}', 'private', $8)`,
        [
          candidate.evidenceIds[0],
          revisionId,
          projectId,
          sourceId,
          candidate.sourceVersionId,
          JSON.stringify({ text: candidate.claimText }),
          sourceHash,
          createdAt,
        ],
      );
      await pool.query(
        `INSERT INTO candidate.batches (
           batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          candidate.batchId,
          projectId,
          candidate.sourceVersionId,
          `batch:${candidate.batchId}`,
          JSON.stringify(candidate.providerCall),
          createdAt,
        ],
      );
      await pool.query(
        `INSERT INTO candidate.claim_candidates (
           candidate_id, batch_id, project_id, source_version_id, revision_number, claim_text,
           evidence_id, evidence_mode, extraction_profile, status, provider_call,
           access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, 1, $5, $6, 'DIRECT_EVIDENCE', 'direct-only', 'READY', $7, '{owner}', 'private', $8)`,
        [
          candidate.candidateId,
          candidate.batchId,
          projectId,
          candidate.sourceVersionId,
          candidate.claimText,
          candidate.evidenceIds[0],
          JSON.stringify(candidate.providerCall),
          createdAt,
        ],
      );
      await comparisonRepository.saveCompletedAggregate(fixture.aggregate);
    };

    await Promise.all([pending, hold, modify].map(({ fixture }) => insertLineage(fixture)));
    await Promise.all(drafts.map((draft) => reviewRepository.saveDraft(draft)));
    await pool.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, $2, $3, $4)`,
      [projectId, snapshot.version, snapshot.digest, createdAt],
    );

    const settings = new InMemorySettingsRepository();
    await settings.applySettingsCommand({
      commandId: `settings:${suffix}`,
      clientRequestId: `settings-client:${suffix}`,
      idempotencyKey: `settings-idem:${suffix}`,
      projectId,
      expectedSettingsRevision: 1,
      observedPolicyContextRevision: 1,
      settings: { [COMPARISON_ROLLOUT_SETTING_KEY]: 'V2_ACTIVE' },
      actorId: `issue-247:${suffix}`,
    });
    const searchProjection: SearchProjectionRepositoryPort = {
      applyCommit: async () => undefined,
      rebuild: async () => undefined,
      markDegraded: async () => undefined,
      findWatermark: async () => ({
        projectId,
        canonicalVersion: snapshot.version,
        snapshotDigest: snapshot.digest,
        status: 'READY',
        updatedAt: createdAt,
        lastCommitId: lexicalReadiness.lastCommitId,
      }),
      search: async () => [],
    };
    const auth = new InMemoryAuthRepository();
    const accountId = `issue-247-account:${suffix}`;
    await auth.bootstrapOwner({
      accountId,
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const principal = await auth.findPrincipalByAccountId(accountId);
    if (!principal) throw new Error('Issue #247 Product fixture principal was not created.');
    const session = await auth.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    let providerCalls = 0;
    const application = await createApplication({
      authRepository: auth,
      connectorRuntimeState: new PostgresConnectorRuntimeState(pool),
      candidateRepository,
      comparisonV2Repository: comparisonRepository,
      changeSetReviewV2Repository: reviewRepository,
      comparisonV2ExecutionResolver: {
        resolve: async () => ({
          executionIdentity: {
            providerId: 'fixture-provider',
            modelId: 'fixture-model',
            aiConfigurationRevision: 1,
            credentialId: `credential:issue-247:${suffix}`,
            credentialRevision: 1,
            policyContextRevision: `policy:issue-247:${suffix}`,
            providerPolicyFingerprint: 'issue-247-provider-policy:v1',
          },
          adapter: {
            identity: {
              provider: 'fixture-provider',
              model: 'fixture-model',
              adapterVersion: 'issue-247-fixture:v1',
              dataPolicyVersion: 'issue-247-data-policy:v1',
            },
            async generateStructured() {
              providerCalls += 1;
              throw new Error('provider generation must not run during Review verification');
            },
          },
        }),
      },
      frontendReviewStore,
      semanticActiveGenerationReader: { getActiveGeneration: async () => generation },
      canonicalSnapshot: canonicalRepository,
      canonicalKnowledgeRepository: canonicalRepository,
      searchProjectionRepository: searchProjection,
      settingsRepository: settings,
      aiDurableMaterializationRecoveryEnabled: false,
    });

    const csrf = (
      await application.server.inject({
        method: 'GET',
        url: '/api/v1/security/csrf',
        headers: { cookie },
      })
    ).json<{ csrfToken: string }>().csrfToken;
    const post = async (url: string, payload: unknown) =>
      application.server.inject({
        method: 'POST',
        url,
        headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
    const queuePayload = {
      schemaVersion: '1.0.0',
      pageSize: 20,
      attentionReasons: ['REQUIRES_ACTION'],
    };

    const beforeCanonical = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM canonical.commits WHERE project_id = $1',
      [projectId],
    );
    try {
      const queue = await post('/product-api/frontend/review/queue', queuePayload);
      expect(queue.statusCode).toBe(200);
      const queueItems = queue.json<{
        items: Array<{ reviewContextId: string; contextRevision: number; targetId: string }>;
      }>().items;
      expect(queueItems.map((item) => item.targetId)).toEqual(
        expect.arrayContaining(drafts.map((draft) => draft.changeSetId)),
      );
      const pendingQueueItem = queueItems.find((item) => item.targetId === drafts[0]!.changeSetId)!;
      const context = await post('/product-api/frontend/review/contexts/read', {
        schemaVersion: '1.0.0',
        reviewContextId: pendingQueueItem.reviewContextId,
        contextRevision: pendingQueueItem.contextRevision,
      });
      expect(context.statusCode).toBe(200);
      expect(context.json().context.targetKind).toBe('COMPARISON_V2_CHANGE_SET');
      const feShadow = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM frontend_knowledge_draft.drafts WHERE draft_id = $1',
        [drafts[0]!.changeSetId],
      );
      expect(feShadow.rows[0]?.count).toBe('0');

      const holdDecision = await post('/reviews/v2/decision', {
        changeSetId: drafts[1]!.changeSetId,
        expectedRevisionNumber: 1,
        expectedContentDigest: drafts[1]!.contentDigest,
        decision: 'HOLD',
        reason: 'Pause until the owner verifies the evidence.',
        decisionId: `decision:issue-247:${suffix}:hold`,
      });
      expect(holdDecision.statusCode).toBe(200);
      expect(
        (await reviewRepository.findDraftById(projectId, drafts[1]!.changeSetId))?.status,
      ).toBe('ON_HOLD');
      const holdQueue = await post('/product-api/frontend/review/queue', queuePayload);
      expect(
        holdQueue.json<{ items: Array<{ targetId: string; aggregateState: string }> }>().items,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ targetId: drafts[1]!.changeSetId, aggregateState: 'ON_HOLD' }),
        ]),
      );

      const modifyQueueItem = queueItems.find((item) => item.targetId === drafts[2]!.changeSetId)!;
      const wrongDigest = await post('/reviews/v2/decision', {
        changeSetId: drafts[2]!.changeSetId,
        expectedRevisionNumber: 1,
        expectedContentDigest: sha256Text('stale-draft'),
        decision: 'APPROVE',
        reason: 'Must fail closed on stale content.',
        decisionId: `decision:issue-247:${suffix}:stale`,
      });
      expect(wrongDigest.statusCode).toBe(409);
      const resolved = await post('/reviews/v2/resolve-operation', {
        changeSetId: drafts[2]!.changeSetId,
        expectedDraftRevision: 1,
        expectedDraftDigest: drafts[2]!.contentDigest,
        chosenOperation: 'ADD_CLAIM',
        clientRequestId: `resolution:issue-247:${suffix}`,
        idempotencyKey: `resolution-idem:issue-247:${suffix}`,
      });
      expect(resolved.statusCode).toBe(200);
      const resolvedDraft = await reviewRepository.findDraftById(projectId, drafts[2]!.changeSetId);
      expect(resolvedDraft?.revisionNumber).toBe(2);
      expect(resolvedDraft?.operation).toBe('ADD_CLAIM');
      const revalidated = await post('/product-api/frontend/review/contexts/revalidate', {
        schemaVersion: '1.0.0',
        clientRequestId: `revalidate:issue-247:${suffix}`,
        idempotencyKey: `revalidate-idem:issue-247:${suffix}`,
        reviewContextId: modifyQueueItem.reviewContextId,
        contextRevision: modifyQueueItem.contextRevision,
        reason: 'Use the authoritative N+1 V2 draft after operation resolution.',
      });
      expect(revalidated.statusCode).toBe(200);
      expect(revalidated.json()).toMatchObject({
        outcome: 'COMPLETED',
        context: { contextRevision: 2, targetKind: 'COMPARISON_V2_CHANGE_SET' },
      });
      const resolvedDecisionBody = {
        changeSetId: drafts[2]!.changeSetId,
        expectedRevisionNumber: 2,
        expectedContentDigest: resolvedDraft!.contentDigest,
        decision: 'APPROVE',
        reason: 'Approve the rematerialized ADD_CLAIM operation.',
        decisionId: `decision:issue-247:${suffix}:resolved-approve`,
      };
      const resolvedApproval = await post('/reviews/v2/decision', resolvedDecisionBody);
      expect(resolvedApproval.statusCode).toBe(200);
      expect(resolvedApproval.json()).toMatchObject({
        commandStatus: 'succeeded',
        decision: { decision: 'APPROVE' },
        manifest: {},
      });
      const resolvedReplay = await post('/reviews/v2/decision', resolvedDecisionBody);
      expect(resolvedReplay.statusCode).toBe(200);
      const approvalCounts = await pool.query<{ decisions: string; manifests: string }>(
        `SELECT
           (SELECT count(*)::text FROM review.decisions_v2 WHERE project_id = $1 AND change_set_id = $2) AS decisions,
           (SELECT count(*)::text FROM review.approved_manifests_v2 WHERE project_id = $1 AND change_set_id = $2) AS manifests`,
        [projectId, drafts[2]!.changeSetId],
      );
      expect(approvalCounts.rows[0]).toEqual({ decisions: '1', manifests: '1' });
      expect(providerCalls).toBe(0);

      const afterCanonical = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM canonical.commits WHERE project_id = $1',
        [projectId],
      );
      expect(Number(afterCanonical.rows[0]?.count)).toBe(
        Number(beforeCanonical.rows[0]?.count) + 1,
      );
    } finally {
      await application.server.close();
      const changeSetIds = drafts.map((draft) => draft.changeSetId);
      const comparisonIds = [pending, hold, modify].map(
        ({ fixture }) => fixture.draft.comparisonId,
      );
      const candidateIds = [pending, hold, modify].map(
        ({ fixture }) => fixture.candidate.candidateId,
      );
      const batchIds = [pending, hold, modify].map(({ fixture }) => fixture.candidate.batchId);
      const evidenceIds = [pending, hold, modify].map(
        ({ fixture }) => fixture.candidate.evidenceIds[0],
      );
      const sourceVersionIds = [pending, hold, modify].map(
        ({ fixture }) => fixture.candidate.sourceVersionId,
      );
      const cleanupClient = await pool.connect();
      try {
        await cleanupClient.query('SET session_replication_role = replica');
        await cleanupClient.query(
          'DELETE FROM frontend_history.history_projection_index WHERE resource_project_id = $1',
          [projectId],
        );
        await cleanupClient.query(
          'DELETE FROM frontend_history.projection_watermarks WHERE resource_project_id = $1',
          [projectId],
        );
        await cleanupClient.query(
          `DELETE FROM frontend_review.dependency
           WHERE review_context_id IN (
             SELECT review_context_id FROM frontend_review.context_revision
             WHERE resource_project_id = $1
           )`,
          [projectId],
        );
        await cleanupClient.query(
          `DELETE FROM frontend_review.item
           WHERE review_context_id IN (
             SELECT review_context_id FROM frontend_review.context_revision
             WHERE resource_project_id = $1
           )`,
          [projectId],
        );
        await cleanupClient.query(
          `DELETE FROM frontend_review.decision
           WHERE review_context_id IN (
             SELECT review_context_id FROM frontend_review.context_revision
             WHERE resource_project_id = $1
           )`,
          [projectId],
        );
        await cleanupClient.query(
          `DELETE FROM frontend_review.comment
           WHERE review_context_id IN (
             SELECT review_context_id FROM frontend_review.context_revision
             WHERE resource_project_id = $1
           )`,
          [projectId],
        );
        await cleanupClient.query(
          `DELETE FROM frontend_review.approval
           WHERE project_id = $1`,
          [projectId],
        );
        await cleanupClient.query(
          `DELETE FROM frontend_review.context_revision WHERE resource_project_id = $1`,
          [projectId],
        );
        await cleanupClient.query(
          'DELETE FROM review.decisions_v2 WHERE project_id = $1 AND change_set_id = ANY($2::text[])',
          [projectId, changeSetIds],
        );
        await cleanupClient.query(
          'DELETE FROM review.approved_manifests_v2 WHERE project_id = $1 AND change_set_id = ANY($2::text[])',
          [projectId, changeSetIds],
        );
        await cleanupClient.query(
          'DELETE FROM review.operation_resolutions_v2 WHERE project_id = $1 AND change_set_id = ANY($2::text[])',
          [projectId, changeSetIds],
        );
        await cleanupClient.query(
          'DELETE FROM review.change_set_revisions_v2 WHERE project_id = $1 AND change_set_id = ANY($2::text[])',
          [projectId, changeSetIds],
        );
        await cleanupClient.query(
          'DELETE FROM review.change_sets_v2 WHERE project_id = $1 AND change_set_id = ANY($2::text[])',
          [projectId, changeSetIds],
        );
        await cleanupClient.query(
          'DELETE FROM comparison.relationships_v2 WHERE project_id = $1 AND comparison_id = ANY($2::text[])',
          [projectId, comparisonIds],
        );
        await cleanupClient.query(
          'DELETE FROM comparison.results_v2 WHERE project_id = $1 AND comparison_id = ANY($2::text[])',
          [projectId, comparisonIds],
        );
        await cleanupClient.query(
          'DELETE FROM comparison.analysis_revisions_v2 WHERE project_id = $1 AND comparison_id = ANY($2::text[])',
          [projectId, comparisonIds],
        );
        await cleanupClient.query(
          'DELETE FROM candidate.claim_candidates WHERE project_id = $1 AND candidate_id = ANY($2::uuid[])',
          [projectId, candidateIds],
        );
        await cleanupClient.query(
          'DELETE FROM candidate.batches WHERE project_id = $1 AND batch_id = ANY($2::uuid[])',
          [projectId, batchIds],
        );
        await cleanupClient.query(
          'DELETE FROM evidence.spans WHERE project_id = $1 AND evidence_id = ANY($2::uuid[])',
          [projectId, evidenceIds],
        );
        await cleanupClient.query(
          'DELETE FROM transformation.revisions WHERE project_id = $1 AND source_version_id = ANY($2::uuid[])',
          [projectId, sourceVersionIds],
        );
        await cleanupClient.query('DELETE FROM canonical.revisions WHERE project_id = $1', [
          projectId,
        ]);
        await cleanupClient.query('DELETE FROM canonical.history_events WHERE project_id = $1', [
          projectId,
        ]);
        await cleanupClient.query('DELETE FROM canonical.outbox WHERE project_id = $1', [
          projectId,
        ]);
        await cleanupClient.query('DELETE FROM canonical.claims WHERE project_id = $1', [
          projectId,
        ]);
        await cleanupClient.query('DELETE FROM canonical.commits WHERE project_id = $1', [
          projectId,
        ]);
        await cleanupClient.query('DELETE FROM canonical.project_state WHERE project_id = $1', [
          projectId,
        ]);
      } finally {
        await cleanupClient.query('SET session_replication_role = origin');
        cleanupClient.release();
      }
    }
  });

  it('projects a persisted V2 REJECT through PostgreSQL Review reads without a frontend shadow', async () => {
    if (!pool) return;

    const suffix = randomUUID();
    const projectId = `issue-251-${suffix}`;
    const fixture = createAdr163ReviewFixture({
      suffix: `issue-251-reject-${suffix}`,
      projectId,
      candidateId: randomUUID(),
      batchId: randomUUID(),
      evidenceId: randomUUID(),
      sourceVersionId: randomUUID(),
      claimText: 'A V2 rejection whose history must remain authoritative.',
      createdAt: '2026-09-10T00:00:00.000Z',
    });
    const reviewRepository = new PostgresChangeSetReviewV2Repository(pool);
    const comparisonRepository = new PostgresComparisonV2Repository(pool);
    const frontendReviewStore = new PostgresFrontendReviewRepository(pool);
    const reader: ComparisonV2ReviewSourceReader = {
      async listDrafts(currentProjectId) {
        return currentProjectId === projectId ? await reviewRepository.listDrafts(projectId) : [];
      },
      async findDraft(currentProjectId, changeSetId) {
        return currentProjectId === projectId
          ? await reviewRepository.findDraftById(projectId, changeSetId)
          : undefined;
      },
      async listDecisions(currentProjectId, changeSetId) {
        return currentProjectId === projectId
          ? await reviewRepository.listDecisions(projectId, changeSetId)
          : [];
      },
    };
    const coordinator = new FrontendReviewProductCoordinator(
      frontendReviewStore,
      new InMemoryFrontendCommandGateway(),
      [new ComparisonV2ReviewTargetAdapter(reader)],
    );
    const scope = {
      principalId: `issue-251-owner:${suffix}`,
      sessionId: `issue-251-session:${suffix}`,
      activeProjectId: projectId,
      accessRevision: `access:${suffix}`,
      policyContextRevision: `policy:${suffix}`,
      sensitivityClearance: 'private',
      accessScope: ['owner'],
    } as const;
    const rejectDecisionId = `decision:issue-251:${suffix}:reject`;
    const rejectedAt = '2026-09-10T00:01:00.000Z';
    const candidate = fixture.candidate;

    try {
      const sourceHash = sha256Text(candidate.claimText);
      const sourceId = randomUUID();
      const revisionId = randomUUID();
      await pool.query(
        `INSERT INTO transformation.revisions (
           revision_id, project_id, source_id, source_version_id, source_content_hash,
           transformer_id, transformer_version, document_ir, source_map, document_hash,
           source_map_hash, access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'fixture', '1', '{}', '{}', $5, $5, '{owner}', 'private', $6)`,
        [
          revisionId,
          projectId,
          sourceId,
          candidate.sourceVersionId,
          sourceHash,
          fixture.draft.createdAt,
        ],
      );
      await pool.query(
        `INSERT INTO evidence.spans (
           evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
           node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, $5, '/claim', 'sentence', 'source',
           '{"start":0,"end":1}', $6::jsonb, $7, '{owner}', 'private', $8)`,
        [
          candidate.evidenceIds[0],
          revisionId,
          projectId,
          sourceId,
          candidate.sourceVersionId,
          JSON.stringify({ text: candidate.claimText }),
          sourceHash,
          fixture.draft.createdAt,
        ],
      );
      await pool.query(
        `INSERT INTO candidate.batches (
           batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          candidate.batchId,
          projectId,
          candidate.sourceVersionId,
          `batch:${candidate.batchId}`,
          JSON.stringify(candidate.providerCall),
          fixture.draft.createdAt,
        ],
      );
      await pool.query(
        `INSERT INTO candidate.claim_candidates (
           candidate_id, batch_id, project_id, source_version_id, revision_number, claim_text,
           evidence_id, evidence_mode, extraction_profile, status, provider_call,
           access_scope, sensitivity, created_at
         ) VALUES ($1, $2, $3, $4, 1, $5, $6, 'DIRECT_EVIDENCE', 'direct-only', 'READY', $7, '{owner}', 'private', $8)`,
        [
          candidate.candidateId,
          candidate.batchId,
          projectId,
          candidate.sourceVersionId,
          candidate.claimText,
          candidate.evidenceIds[0],
          JSON.stringify(candidate.providerCall),
          fixture.draft.createdAt,
        ],
      );
      await comparisonRepository.saveCompletedAggregate(fixture.aggregate);
      await reviewRepository.saveDraft(fixture.draft);
      const queue = await coordinator.listReviewQueue(scope, {
        schemaVersion: '1.0.0',
        pageSize: 10,
        attentionReasons: ['REQUIRES_ACTION'],
      });
      expect(queue.items).toHaveLength(1);
      const queueItem = queue.items[0]!;
      const context = await coordinator.getReviewContext(scope, {
        schemaVersion: '1.0.0',
        reviewContextId: queueItem.reviewContextId,
        contextRevision: queueItem.contextRevision,
      });
      const item = context.context.items[0]!;
      const updated = { ...fixture.draft, status: 'REJECTED' as const, updatedAt: rejectedAt };
      await reviewRepository.recordDecision({
        projectId,
        changeSetId: fixture.draft.changeSetId,
        expectedRevisionNumber: fixture.draft.revisionNumber,
        expectedContentDigest: fixture.draft.contentDigest,
        decision: {
          decisionId: rejectDecisionId,
          decision: 'REJECT',
          actor: { type: 'user', id: scope.principalId },
          reason: 'The owner rejected this candidate after reviewing its evidence.',
          decidedAt: rejectedAt,
        },
        updated,
      });

      const persisted = await reviewRepository.listDecisions(projectId, fixture.draft.changeSetId);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({
        projectId,
        changeSetId: fixture.draft.changeSetId,
        decision: {
          decisionId: rejectDecisionId,
          decision: 'REJECT',
          actor: { type: 'user', id: scope.principalId },
          reason: 'The owner rejected this candidate after reviewing its evidence.',
          decidedAt: rejectedAt,
        },
      });

      // Issue #265: the same PostgreSQL V2 authority is projected directly
      // into federated History. No V1 Review shadow is required or created.
      const historyAdapter = new ReviewHistoryAdapter(
        frontendReviewStore,
        new PostgresPayloadStateStore(pool, 'REVIEW'),
        () => new Date('2026-09-10T00:02:00.000Z'),
        reviewRepository,
      );
      const historyEntries = await historyAdapter.readHistory(projectId);
      const historyDecision = historyEntries.filter(
        (entry) => entry.sourceEventId === rejectDecisionId,
      );
      expect(historyDecision).toHaveLength(1);
      expect(historyDecision[0]).toMatchObject({
        domainKind: 'REVIEW',
        sourceEventKind: 'DECISION',
        sourceEventId: rejectDecisionId,
        domainResourceId: fixture.draft.changeSetId,
        occurredAt: rejectedAt,
      });
      expect(historyDecision[0]!.payloadSnapshot).toMatchObject({
        changeSetId: fixture.draft.changeSetId,
        expectedRevisionNumber: fixture.draft.revisionNumber,
        expectedContentDigest: fixture.draft.contentDigest,
        intent: 'REJECT',
        reason: 'The owner rejected this candidate after reviewing its evidence.',
        owningV2Target: { comparisonId: fixture.draft.comparisonId },
      });
      await expect(
        historyAdapter.resolveHistoryEntry(projectId, 'DECISION', rejectDecisionId),
      ).resolves.toMatchObject({ sourceEventId: rejectDecisionId });

      // Issue #265 full-path proof: the same authoritative V2 decision must
      // survive the operator-rebuildable federated History projection and be
      // readable through the real History Product coordinator. The remaining
      // mandatory domains are deliberately empty test adapters; no unrelated
      // authority fixtures are needed for this focused Review test.
      const historyReadModelStore = createPostgresHistoryReadModelStore(pool);
      const historyRegistry = createHistoryAdapterRegistry([
        emptyHistoryAdapter('CANONICAL'),
        historyAdapter,
        emptyHistoryAdapter('EXTERNAL_ACTION'),
        emptyHistoryAdapter('POLICY'),
      ]);
      const historyProjectionBuilder = new HistoryProjectionBuilder(
        historyRegistry,
        historyReadModelStore,
        () => new Date('2026-09-10T00:03:00.000Z'),
      );
      const projection = await historyProjectionBuilder.buildProjectProjection(projectId);
      expect(projection.partial).toBe(false);
      expect(projection.indexCount).toBe(1);
      const historyProduct = new HistoryProductCoordinator(
        historyReadModelStore.index,
        historyRegistry,
      );
      const historyScope = {
        principalId: scope.principalId,
        activeProjectId: projectId,
        accessRevision: scope.accessRevision,
        policyContextRevision: scope.policyContextRevision,
        sensitivityClearance: scope.sensitivityClearance,
        accessScope: scope.accessScope,
      } as const;
      const historyList = await historyProduct.listHistoryWorkspace(historyScope, {
        schemaVersion: '1.0.0',
        resourceProjectId: projectId,
        domainKinds: ['REVIEW'],
        limit: 20,
      });
      expect(historyList.entries).toHaveLength(1);
      const projectedHistoryEntry = historyList.entries[0]!;
      expect(projectedHistoryEntry).toMatchObject({
        domainKind: 'REVIEW',
        sourceEventKind: 'DECISION',
        sourceEventId: rejectDecisionId,
        domainResourceId: fixture.draft.changeSetId,
        occurredAt: rejectedAt,
      });
      expect(projectedHistoryEntry.payloadSnapshot).toMatchObject({
        changeSetId: fixture.draft.changeSetId,
        expectedRevisionNumber: fixture.draft.revisionNumber,
        expectedContentDigest: fixture.draft.contentDigest,
        intent: 'REJECT',
        actor: { type: 'user', id: scope.principalId },
        reason: 'The owner rejected this candidate after reviewing its evidence.',
        decidedAt: rejectedAt,
        owningV2Target: { comparisonId: fixture.draft.comparisonId },
      });
      expect(projectedHistoryEntry.sourceEventId).toBe(rejectDecisionId);
      const historyDetail = await historyProduct.getHistoryEntry(historyScope, {
        schemaVersion: '1.0.0',
        resourceProjectId: projectId,
        historyEntryId: projectedHistoryEntry.historyEntryId,
      });
      expect(historyDetail.entry).toMatchObject({
        historyEntryId: projectedHistoryEntry.historyEntryId,
        domainKind: 'REVIEW',
        sourceEventKind: 'DECISION',
        sourceEventId: rejectDecisionId,
      });
      expect(historyDetail.entry.payloadSnapshot).toMatchObject({
        changeSetId: fixture.draft.changeSetId,
        intent: 'REJECT',
        actor: { type: 'user', id: scope.principalId },
        reason: 'The owner rejected this candidate after reviewing its evidence.',
        decidedAt: rejectedAt,
      });

      const rejectedContext = await coordinator.getReviewContext(scope, {
        schemaVersion: '1.0.0',
        reviewContextId: context.context.reviewContextId,
        contextRevision: context.context.contextRevision,
      });
      expect(rejectedContext.decisions).toEqual([
        expect.objectContaining({
          decisionId: rejectDecisionId,
          intent: 'REJECT',
          reason: 'The owner rejected this candidate after reviewing its evidence.',
          reviewItemId: item.reviewItemId,
        }),
      ]);
      const itemDetail = await coordinator.getReviewItemDetail(scope, {
        schemaVersion: '1.0.0',
        reviewContextId: context.context.reviewContextId,
        contextRevision: context.context.contextRevision,
        reviewItemId: item.reviewItemId,
      });
      expect(itemDetail.decisions).toEqual(rejectedContext.decisions);

      const freshQueue = await coordinator.listReviewQueue(scope, {
        schemaVersion: '1.0.0',
        pageSize: 10,
        attentionReasons: ['REQUIRES_ACTION'],
      });
      expect(freshQueue.items).toEqual([]);
      const counts = await pool.query<{ shadow: string; manifests: string; commits: string }>(
        `SELECT
           (SELECT count(*)::text FROM frontend_review.decision
            WHERE review_context_id = $1) AS shadow,
           (SELECT count(*)::text FROM review.approved_manifests_v2
            WHERE project_id = $2 AND change_set_id = $3) AS manifests,
           (SELECT count(*)::text FROM canonical.commits
            WHERE project_id = $2) AS commits`,
        [context.context.reviewContextId, projectId, fixture.draft.changeSetId],
      );
      expect(counts.rows[0]).toEqual({ shadow: '0', manifests: '0', commits: '0' });
    } finally {
      const cleanupClient = await pool.connect();
      try {
        await cleanupClient.query('SET session_replication_role = replica');
        await cleanupClient.query(
          `DELETE FROM frontend_review.dependency
           WHERE review_context_id IN (
             SELECT review_context_id FROM frontend_review.context_revision
             WHERE resource_project_id = $1
           )`,
          [projectId],
        );
        await cleanupClient.query(
          `DELETE FROM frontend_review.item
           WHERE review_context_id IN (
             SELECT review_context_id FROM frontend_review.context_revision
             WHERE resource_project_id = $1
           )`,
          [projectId],
        );
        await cleanupClient.query(
          `DELETE FROM frontend_review.decision
           WHERE review_context_id IN (
             SELECT review_context_id FROM frontend_review.context_revision
             WHERE resource_project_id = $1
           )`,
          [projectId],
        );
        await cleanupClient.query(
          'DELETE FROM frontend_review.context_revision WHERE resource_project_id = $1',
          [projectId],
        );
        await cleanupClient.query(
          'DELETE FROM review.decisions_v2 WHERE project_id = $1 AND change_set_id = $2',
          [projectId, fixture.draft.changeSetId],
        );
        await cleanupClient.query(
          'DELETE FROM review.approved_manifests_v2 WHERE project_id = $1 AND change_set_id = $2',
          [projectId, fixture.draft.changeSetId],
        );
        await cleanupClient.query(
          'DELETE FROM review.change_set_revisions_v2 WHERE project_id = $1 AND change_set_id = $2',
          [projectId, fixture.draft.changeSetId],
        );
        await cleanupClient.query(
          'DELETE FROM review.change_sets_v2 WHERE project_id = $1 AND change_set_id = $2',
          [projectId, fixture.draft.changeSetId],
        );
        await cleanupClient.query(
          'DELETE FROM comparison.relationships_v2 WHERE project_id = $1 AND comparison_id = $2',
          [projectId, fixture.draft.comparisonId],
        );
        await cleanupClient.query(
          'DELETE FROM comparison.results_v2 WHERE project_id = $1 AND comparison_id = $2',
          [projectId, fixture.draft.comparisonId],
        );
        await cleanupClient.query(
          'DELETE FROM comparison.analysis_revisions_v2 WHERE project_id = $1 AND comparison_id = $2',
          [projectId, fixture.draft.comparisonId],
        );
        await cleanupClient.query(
          'DELETE FROM candidate.claim_candidates WHERE project_id = $1 AND candidate_id = $2',
          [projectId, candidate.candidateId],
        );
        await cleanupClient.query(
          'DELETE FROM candidate.batches WHERE project_id = $1 AND batch_id = $2',
          [projectId, candidate.batchId],
        );
        await cleanupClient.query(
          'DELETE FROM evidence.spans WHERE project_id = $1 AND evidence_id = $2',
          [projectId, candidate.evidenceIds[0]],
        );
        await cleanupClient.query(
          'DELETE FROM transformation.revisions WHERE project_id = $1 AND source_version_id = $2',
          [projectId, candidate.sourceVersionId],
        );
      } finally {
        await cleanupClient.query('SET session_replication_role = origin');
        cleanupClient.release();
      }
    }
  });
});
