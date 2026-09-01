import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  PostgresOriginalAssetRepository,
  createPostgresPool,
} from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import {
  PostgresKnowledgeModelRepository,
  PostgresTypedPropositionConflictAssertionRepository,
  PostgresTypedPropositionConflictRuleRepository,
} from '../../adapters/postgres-stage9/src/index.js';
import {
  createTypedPropositionConflictDiscoveryPort,
  startShotgunApplication,
} from '../../assemblies/shotgun-app/src/application.js';
import {
  buildTypedPropositionConflictAssertion,
  TypedPropositionConflictRuleService,
} from '../../modules/knowledge-model/src/index.js';
import {
  createWp2DiscoveryNeighborhoodStrategyRegistry,
  selectDiscoveryNeighborhood,
  type DiscoverySignalReadContextV1,
} from '../../modules/discovery-finding-fingerprint/src/index.js';
import {
  knowledgeCandidateDigest,
  sha256Text,
  type DiscoveryResourceRefV1,
  type RelationCandidate,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

let databaseUrl: string | undefined;
if (process.env.TEST_DATABASE_URL?.trim()) {
  try {
    databaseUrl = await requireTestDatabaseTarget();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|ENOTFOUND|timeout|connect/i.test(message)) {
      console.warn(`WP2R PostgreSQL proof skipped: ${message}`);
    } else {
      throw error;
    }
  }
}

const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const relation = (input: {
  readonly id: string;
  readonly type: string;
  readonly from: string;
  readonly to: string;
  readonly sourceVersionId: string;
}): RelationCandidate => ({
  candidateId: input.id,
  candidateType: 'RELATION',
  revisionNumber: 1,
  sourceVersionId: input.sourceVersionId,
  evidenceIds: [randomUUID()],
  modelOutputs: [],
  fromCandidateId: input.from,
  toCandidateId: input.to,
  relationType: input.type,
  direction: 'DIRECTED',
});

const resource = (projectId: string, candidate: RelationCandidate): DiscoveryResourceRefV1 => ({
  schemaVersion: '1.0.0',
  resourceKind: 'CANONICAL_RELATION',
  resourceId: candidate.candidateId,
  projectId,
  resourceState: 'APPROVED',
  resourceRevision: String(candidate.revisionNumber),
});

describe('AKP-8 WP2R PostgreSQL production composition', () => {
  afterAll(async () => {
    await pool?.end();
  });

  if (!pool) {
    it.skip('TEST_DATABASE_URL is unavailable; real PostgreSQL proof is deferred to automatic CI.', () => {});
    return;
  }

  it('uses normal application composition and the real Postgres authority to reach Conflict selection', async () => {
    await migrateUpTo(undefined, databaseUrl!);
    const suffix = randomUUID();
    const projectId = `akp8-wp2r-db-${suffix}`;
    const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: `akp8-wp2r-owner-${suffix}`,
    });
    const auth = new PostgresAuthRepository(pool);
    const assetRoot = await mkdtemp(path.join(tmpdir(), 'shotgun-wp2r-db-'));
    let application: Awaited<ReturnType<typeof startShotgunApplication>> | undefined;
    let sourceVersionId: string | undefined;
    try {
      await pool.query(
        `INSERT INTO project_admin.projects
           (id, name, status, active, created_at, updated_at, revision)
         VALUES ($1, $2, 'ACTIVE', true, now(), now(), 1)`,
        [projectId, `AKP-8 WP2R ${suffix}`],
      );
      await pool.query(
        `INSERT INTO auth.project_memberships
           (principal_id, project_id, scopes, sensitivity_clearance, is_owner)
         VALUES ($1, $2, ARRAY['owner'], 'private', true)`,
        [principal.principalId, projectId],
      );
      const session = await auth.createSession(
        principal.principalId,
        projectId,
        '2099-01-01T00:00:00.000Z',
      );

      const sourceText = `WP2R synthetic authority ${suffix}`;
      const originalAssets = new PostgresOriginalAssetRepository(pool);
      const stored = await originalAssets.store({
        submissionId: `akp8-wp2r-source-${suffix}`,
        projectId,
        actorId: principal.principalId,
        channel: 'direct_text',
        materialKind: 'plain_text',
        mediaType: 'text/plain',
        contentHash: sha256Text(sourceText),
        sizeBytes: Buffer.byteLength(sourceText),
        storageKey: `akp8-wp2r/${suffix}.txt`,
        accessScope: ['owner'],
        sensitivity: 'private',
        createdAt: new Date().toISOString(),
      });
      sourceVersionId = stored.sourceVersionId;
      const first = relation({
        id: `relation-a-${suffix}`,
        type: 'supports',
        from: 'entity-1',
        to: 'entity-2',
        sourceVersionId: stored.sourceVersionId,
      });
      const second = relation({
        id: `relation-b-${suffix}`,
        type: 'contradicts',
        from: 'entity-1',
        to: 'entity-2',
        sourceVersionId: stored.sourceVersionId,
      });
      await pool.query(
        `INSERT INTO knowledge.review_groups
           (project_id, group_id, source_version_id, revision_number, status, content_digest,
            items, decisions, access_scope, sensitivity, created_at, updated_at)
         VALUES ($1, $2, $3, 1, 'APPROVED', $4, $5::jsonb, '[]'::jsonb, $6, 'private', now(), now()),
                ($1, $7, $3, 1, 'APPROVED', $8, $9::jsonb, '[]'::jsonb, $6, 'private', now(), now())`,
        [
          projectId,
          `group-a-${suffix}`,
          stored.sourceVersionId,
          knowledgeCandidateDigest([first]),
          JSON.stringify([first]),
          ['owner'],
          `group-b-${suffix}`,
          knowledgeCandidateDigest([second]),
          JSON.stringify([second]),
        ],
      );

      const rules = new PostgresTypedPropositionConflictRuleRepository(pool);
      const assertions = new PostgresTypedPropositionConflictAssertionRepository(pool);
      const service = new TypedPropositionConflictRuleService(rules);
      const rule = await service.execute({
        projectId,
        actorId: principal.principalId,
        payload: {
          operation: 'CREATE',
          leftRelationType: 'supports',
          rightRelationType: 'contradicts',
          directionSemantics: 'DIRECTED_SAME_ORIENTATION',
        },
        now: '2026-09-01T00:00:00.000Z',
      });

      application = await startShotgunApplication({
        databaseUrl,
        assetRoot,
        noSignals: true,
        disableAskWorker: true,
      });
      const readResponse = await application.server.inject({
        method: 'GET',
        url: '/api/v1/discovery/conflict-rules',
        headers: { cookie: `shotgun_session=${session.sessionToken}` },
      });
      expect(readResponse.statusCode).toBe(200);
      expect(readResponse.json().rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ruleId: rule.ruleId, status: 'ACTIVE' }),
        ]),
      );

      const productionPort = createTypedPropositionConflictDiscoveryPort({
        ruleRepository: rules,
        assertionRepository: assertions,
        knowledgeModelRepository: new PostgresKnowledgeModelRepository(pool),
      });
      const context: DiscoverySignalReadContextV1 = {
        schemaVersion: '1.0.0',
        projectId,
        accessScope: ['owner'],
        sensitivity: 'private',
        canonicalBase: {
          schemaVersion: '1.0.0',
          canonicalVersion: 1,
          snapshotDigest: 'sha256:wp2r-canonical',
        },
        discoveryBase: {
          schemaVersion: '1.0.0',
          projectionRevision: 'wp2r-discovery-1',
          projectionDigest: 'sha256:wp2r-discovery',
        },
        sourceProjectionDigest: 'sha256:wp2r-discovery',
        bounds: { maxResourcesRead: 10, maxObservationsReturned: 10, maxFindingsEmitted: 10 },
      };
      const refs = [resource(projectId, first), resource(projectId, second)] as const;
      const signal = await productionPort.read({ context, resourceRefs: refs });
      expect(signal.competitions).toHaveLength(1);
      expect(signal.competitions[0]).toMatchObject({
        kind: 'FACTUAL',
        source: 'TYPED_PROPOSITION',
      });

      const strategy = createWp2DiscoveryNeighborhoodStrategyRegistry().get(
        'akp-3.conflict.competing-current-resources@1.0.0',
      )!;
      const signalResource = (ref: DiscoveryResourceRefV1) => ({
        resource: ref,
        label: ref.resourceId,
        evidenceIds: ref.resourceId === first.candidateId ? first.evidenceIds : second.evidenceIds,
        security: {
          projectId,
          accessScope: ['owner'],
          sensitivity: 'private' as const,
        },
      });
      const semanticNeighborhood = {
        ...context,
        semanticGenerationId: context.discoveryBase.projectionRevision,
        anchor: signalResource(refs[0]),
        neighbors: [
          {
            ...context,
            semanticGenerationId: context.discoveryBase.projectionRevision,
            resource: signalResource(refs[1]),
            semanticRank: 1,
          },
        ],
        completeness: 'COMPLETE' as const,
      };
      const selected = selectDiscoveryNeighborhood(strategy, {
        context,
        anchors: [semanticNeighborhood.anchor],
        semanticNeighborhoods: [semanticNeighborhood],
        competingResource: signal,
        completeness: 'COMPLETE',
      });
      expect(selected.candidates).toHaveLength(1);
      expect(selected.candidates[0]?.targetFindingType).toBe('CONFLICT_HYPOTHESIS');
      expect(await assertions.listActiveAssertions(projectId)).toHaveLength(1);

      const assertion = buildTypedPropositionConflictAssertion({
        projectId,
        rule,
        left: first,
        right: second,
        leftResource: refs[0],
        rightResource: refs[1],
        canonicalBase: context.canonicalBase,
        discoveryBase: context.discoveryBase,
        accessScope: ['owner'],
        sensitivity: 'private',
        createdAt: '2026-09-01T00:00:00.000Z',
      });
      await assertions.supersedeAssertion(projectId, assertion.assertionId, 1);
      await assertions.saveAssertion(assertion);
      const history = await pool.query(
        `SELECT assertion_revision, status,
                assertion->>'kind' AS kind,
                assertion->>'source' AS source,
                assertion->>'sourceAuthorityId' AS source_authority_id,
                assertion->>'sourceAuthorityRevision' AS source_authority_revision
           FROM knowledge.typed_incompatibility_assertions
          WHERE project_id = $1 AND identity_key = $2 ORDER BY assertion_revision`,
        [projectId, assertion.identityKey],
      );
      expect(history.rows).toEqual([
        {
          assertion_revision: 1,
          status: 'SUPERSEDED',
          kind: 'FACTUAL',
          source: 'TYPED_PROPOSITION',
          source_authority_id: 'stage9.typed-proposition-conflict-evaluator',
          source_authority_revision: '1.0.0',
        },
        {
          assertion_revision: 2,
          status: 'ACTIVE',
          kind: 'FACTUAL',
          source: 'TYPED_PROPOSITION',
          source_authority_id: 'stage9.typed-proposition-conflict-evaluator',
          source_authority_revision: '1.0.0',
        },
      ]);
    } finally {
      await application?.close();
      await pool.query(
        'DELETE FROM knowledge.typed_incompatibility_assertions WHERE project_id = $1',
        [projectId],
      );
      await pool.query(
        'DELETE FROM knowledge.typed_proposition_conflict_rules WHERE project_id = $1',
        [projectId],
      );
      await pool.query('DELETE FROM knowledge.review_groups WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM auth.sessions WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM auth.project_memberships WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM asset.storage_receipts WHERE project_id = $1', [projectId]);
      if (sourceVersionId) {
        const source = await pool.query<{ source_id: string; original_asset_id: string }>(
          `SELECT source_id::text, original_asset_id::text
             FROM asset.source_versions
            WHERE source_version_id = $1`,
          [sourceVersionId],
        );
        await pool.query('DELETE FROM asset.source_versions WHERE source_version_id = $1', [
          sourceVersionId,
        ]);
        if (source.rows[0]) {
          await pool.query('DELETE FROM asset.sources WHERE source_id = $1', [
            source.rows[0].source_id,
          ]);
          await pool.query(
            `DELETE FROM asset.original_assets
              WHERE asset_id = $1
                AND NOT EXISTS (SELECT 1 FROM asset.source_versions WHERE original_asset_id = $1)`,
            [source.rows[0].original_asset_id],
          );
        }
      }
      await pool.query('DELETE FROM project_admin.projects WHERE id = $1', [projectId]);
      await rm(assetRoot, { recursive: true, force: true });
    }
  });
});
