import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  createPostgresReviewDiscoveryCandidateReader,
  PostgresDiscoveryAuthoringBridge,
  PostgresDiscoveryReviewResourceRepository,
  PostgresFrontendReviewRepository,
} from '../../adapters/frontend-review-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { PostgresDiscoveryReentryRepository } from '../../adapters/discovery-reentry-postgres/src/index.js';
import { DiscoveryCandidateReviewTargetAdapter } from '../../adapters/frontend-review-in-memory/src/index.js';
import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresFrontendKnowledgeDraftRepository } from '../../adapters/frontend-knowledge-draft-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  DiscoveryReentryConsumer,
  DiscoveryReviewMaterializer,
} from '../../modules/discovery-reentry/src/index.js';
import {
  FrontendReviewProductCoordinator,
  type FrontendReviewScopeV1,
} from '../../modules/frontend-review/src/index.js';
import {
  canonicalSnapshotDigest,
  createDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeV1,
  type FrontendKnowledgeDraftChangeSetV1,
} from '../../packages/contracts/src/index.js';
import { frontendKnowledgeDraftOperationDigestV1 } from '../../modules/frontend-knowledge-draft/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectId = `akp-8-wp2a-review-draft-${Date.now()}`;
const now = '2026-09-01T03:00:00.000Z';
const sourceId = '77777777-7777-4777-8777-777777777777';
const sourceVersionId = '88888888-8888-4888-8888-888888888888';
const assetId = '99999999-9999-4999-8999-999999999999';
const emptyCanonicalDigest = canonicalSnapshotDigest(projectId, 0, []);
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

const endpoint = (resourceId: string) => ({
  schemaVersion: '1.0.0' as const,
  resourceKind: 'CANONICAL_ENTITY' as const,
  resourceId,
  projectId,
  resourceState: 'APPROVED' as const,
  resourceRevision: '1',
});

const finding = (): DiscoveryFindingEnvelopeV1 =>
  createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: 'finding-wp2a-relation-1',
    findingRevision: 1,
    projectId,
    findingType: 'RELATION_HYPOTHESIS',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'RELATION_HYPOTHESIS',
      sourceEndpoint: endpoint('entity-a'),
      targetEndpoint: endpoint('entity-b'),
      proposedRelationType: 'RELATED_TO',
      direction: 'DIRECTED',
      temporalQualification: {
        schemaVersion: '1.0.0',
        validFrom: '2026-01-01T00:00:00.000Z',
        description: 'The relation applies during the governed period.',
      },
    },
    relatedResourceRefs: [endpoint('entity-a'), endpoint('entity-b')],
    evidenceIds: ['evidence-wp2a-relation-1'],
    sourceProjectionDigest: digest('a'),
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 0,
      snapshotDigest: emptyCanonicalDigest,
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-wp2a-0',
      projectionDigest: digest('b'),
    },
    runId: 'run-wp2a-relation-1',
    signalSummary: {},
    rationale: 'The exact approved Entity revisions support a proposed relation.',
    derivationSummary: 'Database-backed AKP-8 WP2A Review→Draft fixture.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'wp2a-review-draft-test',
      ruleVersion: '1',
      inputDigest: digest('c'),
    },
    accessScope: ['owner'],
    sensitivity: 'private',
    fingerprint: digest('d'),
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: now,
  });

const publicationFor = (value: DiscoveryFindingEnvelopeV1) => ({
  schemaVersion: '1.0.0' as const,
  publicationId: 'publication-wp2a-relation-1',
  projectId,
  findingId: value.findingId,
  findingRevision: value.findingRevision,
  fingerprint: value.fingerprint,
  fingerprintVersion: value.fingerprintVersion,
  jobId: 'job-wp2a-relation-1',
  runId: value.runId,
  attemptId: 'attempt-wp2a-relation-1',
  canonicalBase: value.canonicalBase,
  requiredDiscoveryBase: value.discoveryBase,
  occurredAt: now,
});

const scope: FrontendReviewScopeV1 = {
  principalId: 'principal-wp2a-review-draft',
  sessionId: 'session-wp2a-review-draft',
  activeProjectId: projectId,
  accessRevision: 'access-wp2a',
  policyContextRevision: 'policy-wp2a',
  sensitivityClearance: 'private',
  accessScope: ['owner', 'review'],
};

const bridgeScope = {
  ...scope,
  sensitivityClearance: 'private' as const,
};

let activeReviewResourceId: string | undefined;

const cleanup = async (): Promise<void> => {
  if (pool === undefined) return;
  const client = await pool.connect();
  try {
    // The review bridge is immutable in normal operation; cleanup is the
    // controlled administrative path for this isolated test project.
    await client.query('SET session_replication_role = replica');
    // Review Context/Item rows are immutable by database trigger. The
    // database suite runs files serially after its guarded reset, so use the
    // existing trigger-safe table cleanup rather than issuing DELETE against
    // immutable rows.
    await client.query(
      `TRUNCATE frontend_review.context_revision,
                frontend_review.item,
                frontend_review.dependency,
                frontend_review.decision,
                frontend_review.comment,
                frontend_review.approval
       CASCADE`,
    );
    await client.query(
      'DELETE FROM frontend_knowledge_draft.drafts WHERE resource_project_id = $1',
      [projectId],
    );
    await client.query('DELETE FROM frontend_command.command_ledger WHERE target_project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM canonical.project_state WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM discovery.reentry_review_resources WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_review_roots WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_consumption WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_candidates WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.reentry_manifests WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.finding_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.finding_lifecycle_current WHERE project_id = $1', [
      projectId,
    ]);
    await client.query('DELETE FROM discovery.findings WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM knowledge.review_groups WHERE project_id = $1', [projectId]);
    await client.query('DELETE FROM asset.source_versions WHERE source_id = $1', [sourceId]);
    await client.query('DELETE FROM asset.sources WHERE source_id = $1', [sourceId]);
    await client.query('DELETE FROM asset.original_assets WHERE asset_id = $1', [assetId]);
    await client.query('DELETE FROM project_admin.projects WHERE id = $1', [projectId]);
    activeReviewResourceId = undefined;
  } finally {
    await client.query('SET session_replication_role = origin');
    client.release();
  }
};

const seed = async (): Promise<void> => {
  if (pool === undefined) return;
  await pool.query(
    `INSERT INTO project_admin.projects (id, name, status, active)
     VALUES ($1, 'AKP-8 WP2A Review Draft project', 'ACTIVE', true)`,
    [projectId],
  );
  await pool.query(
    `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
     VALUES ($1, $2, 1, 'wp2a-review-draft-asset', $3)`,
    [assetId, digest('e'), now],
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
     ) VALUES ($1, $2, 1, $3, 'text/plain', ARRAY['owner', 'review'], 'private', $4)`,
    [sourceVersionId, sourceId, assetId, now],
  );
  await pool.query(
    `INSERT INTO knowledge.review_groups (
       project_id, group_id, source_version_id, revision_number, status,
       content_digest, items, decisions, access_scope, sensitivity,
       created_at, updated_at
     ) VALUES ($1, 'knowledge-group-wp2a-entities', $2, 1, 'APPROVED', $3,
       $4::jsonb, '[]'::jsonb, ARRAY['owner', 'review'], 'private', $5, $5)`,
    [
      projectId,
      sourceVersionId,
      digest('f'),
      JSON.stringify([
        { candidateId: 'entity-a', candidateType: 'ENTITY', revisionNumber: 1 },
        { candidateId: 'entity-b', candidateType: 'ENTITY', revisionNumber: 1 },
      ]),
      now,
    ],
  );

  const findingValue = finding();
  const findingRepository = new PostgresDiscoveryFindingRepository(pool);
  await findingRepository.save(findingValue);
  const reentryRepository = new PostgresDiscoveryReentryRepository(pool, {
    lifecycleRepository: findingRepository,
  });
  const consumed = await new DiscoveryReentryConsumer(
    reentryRepository,
    {
      resolve: async () => ({
        status: 'RESOLVED' as const,
        refs: findingValue.relatedResourceRefs.map((ref) => ({
          ...ref,
          resourceState: 'APPROVED' as const,
          resourceRevision: '1',
        })),
      }),
    },
    () => new Date(now),
  ).consume(publicationFor(findingValue));
  if (consumed.status !== 'CREATED') {
    throw new Error(`Discovery intake fixture was not created: ${consumed.status}`);
  }
  const materialized = await new DiscoveryReviewMaterializer(
    reentryRepository,
    new PostgresDiscoveryReviewResourceRepository(pool),
    undefined,
    {
      resolve: async ({ evidenceIds }) =>
        evidenceIds.map((evidenceId) => ({
          schemaVersion: '1.0.0' as const,
          evidenceId,
          sourceId,
          sourceVersionId,
          evidenceSpanId: 'span-wp2a-relation-1',
        })),
    },
  ).materialize({ logicalIdentityKey: consumed.logicalIdentityKey });
  if (materialized.status !== 'CREATED') {
    throw new Error(`Review resource fixture was not created: ${materialized.status}`);
  }
  activeReviewResourceId = materialized.resource.reviewResourceId;
};

const buildCoordinator = (gateway?: PostgresFrontendCommandGateway) => {
  const draftRepository = new PostgresFrontendKnowledgeDraftRepository(pool!);
  const reviewRepository = new PostgresFrontendReviewRepository(pool!);
  const reader = createPostgresReviewDiscoveryCandidateReader(pool!);
  const bridge = new PostgresDiscoveryAuthoringBridge(draftRepository);
  const coordinator = new FrontendReviewProductCoordinator(
    reviewRepository,
    gateway ?? new PostgresFrontendCommandGateway(pool!),
    [new DiscoveryCandidateReviewTargetAdapter(reader)],
    () => new Date(now),
    bridge,
  );
  return { coordinator, draftRepository, reviewRepository, bridge };
};

const reviewRequest = async (coordinator: FrontendReviewProductCoordinator, identity: string) => {
  const queue = await coordinator.listReviewQueue(scope, {
    schemaVersion: '1.0.0',
    pageSize: 50,
  });
  expect(queue.items).toHaveLength(1);
  const item = queue.items[0]!;
  return {
    schemaVersion: '1.0.0' as const,
    clientRequestId: `review-approve-${identity}`,
    idempotencyKey: `review-approve-key-${identity}`,
    reviewContextId: item.reviewContextId,
    expectedContextRevision: item.contextRevision,
    expectedTargetRevision: String(1),
    expectedTargetDigest: (
      await coordinator.getReviewContext(scope, {
        schemaVersion: '1.0.0',
        reviewContextId: item.reviewContextId,
        contextRevision: item.contextRevision,
      })
    ).context.targetDigest,
    itemDecisions: [
      {
        schemaVersion: '1.0.0' as const,
        reviewItemId: 'item-1',
        intent: 'APPROVE' as const,
        reason: 'The exact approved Entity revisions support this relation.',
      },
    ],
  };
};

describe.runIf(pool)('AKP-8 WP2A PostgreSQL Review→Draft authority', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    await cleanup();
    await pool!.end();
  });

  it('accepts Review into one server-materialized Draft and composes restrictive persisted security', async () => {
    const { coordinator, draftRepository, bridge } = buildCoordinator();
    const request = await reviewRequest(coordinator, 'positive');
    const result = await coordinator.recordReviewDecisions(scope, request);
    expect(result.acceptedForAuthoring).toBe(true);
    expect(result.aggregateState).toBe('ACCEPTED_FOR_AUTHORING');
    expect(result.draft).toMatchObject({ draftRevision: 1, resourceProjectId: projectId });

    const draft = await draftRepository.transaction((repositories) =>
      repositories.drafts.findById(projectId, result.draft!.draftId),
    );
    expect(draft?.discoveryProvenance?.review.reviewResourceId).toBe(activeReviewResourceId);
    const operation = draft?.operations[0];
    expect(operation?.kind).toBe('RELATION_ADD');
    expect(operation?.contentDigest).toBe(frontendKnowledgeDraftOperationDigestV1(operation!));

    const authority = await draftRepository.transactionWithHandle((handle) =>
      bridge.revalidateRelation({
        transaction: handle.raw,
        scope: bridgeScope,
        draft: draft!,
        operation: operation as Extract<
          FrontendKnowledgeDraftChangeSetV1['operations'][number],
          { readonly kind: 'RELATION_ADD' }
        >,
      }),
    );
    expect(authority.accessScope).toEqual(['owner']);
    expect(authority.sensitivity).toBe('private');
    await expect(
      draftRepository.transactionWithHandle((handle) =>
        bridge.revalidateRelation({
          transaction: handle.raw,
          scope: { ...bridgeScope, accessScope: ['review'] },
          draft: draft!,
          operation: operation as Extract<
            FrontendKnowledgeDraftChangeSetV1['operations'][number],
            { readonly kind: 'RELATION_ADD' }
          >,
        }),
      ),
    ).rejects.toThrow();

    await pool!.query(
      `UPDATE knowledge.review_groups
          SET revision_number = 2,
              items = jsonb_set(
                jsonb_set(items, '{0,revisionNumber}', '2'::jsonb),
                '{1,revisionNumber}', '2'::jsonb
              ),
              updated_at = $2
        WHERE project_id = $1
          AND group_id = 'knowledge-group-wp2a-entities'`,
      [projectId, now],
    );
    await expect(
      draftRepository.transactionWithHandle((handle) =>
        bridge.revalidateRelation({
          transaction: handle.raw,
          scope: bridgeScope,
          draft: draft!,
          operation: operation as Extract<
            FrontendKnowledgeDraftChangeSetV1['operations'][number],
            { readonly kind: 'RELATION_ADD' }
          >,
        }),
      ),
    ).rejects.toThrow();
  });

  it('rolls back Review decisions and Draft materialization when ledger completion fails', async () => {
    class FailingCompleteGateway extends PostgresFrontendCommandGateway {
      private failed = false;

      override async completeInTransaction(
        transaction: unknown,
        input: Parameters<PostgresFrontendCommandGateway['completeInTransaction']>[1],
      ) {
        if (!this.failed) {
          this.failed = true;
          throw new Error('review completion failpoint');
        }
        return super.completeInTransaction(transaction, input);
      }
    }

    const gateway = new FailingCompleteGateway(pool!);
    const { coordinator, draftRepository, reviewRepository } = buildCoordinator(gateway);
    const request = await reviewRequest(coordinator, 'rollback');
    await expect(coordinator.recordReviewDecisions(scope, request)).rejects.toThrow(
      'review completion failpoint',
    );

    const reviewContextId = request.reviewContextId;
    const context = await reviewRepository.transaction((repositories) =>
      repositories.contexts.findCurrent(reviewContextId),
    );
    expect(context?.context.aggregateState).toBe('PENDING');
    await expect(
      reviewRepository.transaction((repositories) =>
        repositories.decisions.findDecisions(reviewContextId),
      ),
    ).resolves.toEqual([]);
    await expect(
      draftRepository.transaction((repositories) =>
        repositories.drafts.findById(projectId, 'draft:missing'),
      ),
    ).resolves.toBeUndefined();
    const counts = await pool!.query<{ drafts: number; commands: number; unknown: number }>(
      `SELECT
         (SELECT count(*)::int FROM frontend_knowledge_draft.drafts WHERE resource_project_id = $1) AS drafts,
         (SELECT count(*)::int FROM frontend_command.command_ledger WHERE target_project_id = $1) AS commands,
         (SELECT count(*)::int FROM frontend_command.command_ledger WHERE target_project_id = $1 AND outcome_state = 'OUTCOME_UNKNOWN') AS unknown`,
      [projectId],
    );
    expect(counts.rows[0]).toEqual({ drafts: 0, commands: 1, unknown: 1 });
  });

  it('replays the same Review command without duplicating the Draft or decision', async () => {
    const { coordinator } = buildCoordinator();
    const request = await reviewRequest(coordinator, 'replay');
    const first = await coordinator.recordReviewDecisions(scope, request);
    const replay = await coordinator.recordReviewDecisions(scope, request);
    expect(replay).toMatchObject({
      outcome: 'COMPLETED',
      acceptedForAuthoring: true,
      draft: first.draft,
    });
    const counts = await pool!.query<{ drafts: number; decisions: number; commands: number }>(
      `SELECT
         (SELECT count(*)::int FROM frontend_knowledge_draft.drafts WHERE resource_project_id = $1) AS drafts,
         (SELECT count(*)::int FROM frontend_review.decision WHERE review_context_id = $2) AS decisions,
         (SELECT count(*)::int FROM frontend_command.command_ledger WHERE target_project_id = $1) AS commands`,
      [projectId, request.reviewContextId],
    );
    expect(counts.rows[0]).toEqual({ drafts: 1, decisions: 1, commands: 1 });
  });
});
