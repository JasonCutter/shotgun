import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresCompiledTruthRepository } from '../../adapters/postgres-stage10/src/index.js';
import { PostgresSemanticCorpusSourceSnapshotReader } from '../../adapters/semantic-corpus-postgres/src/index.js';
import {
  compiledTruthLogicalDigest,
  type CompiledTruthEdge,
  type CompiledTruthItem,
  type CompiledTruthProjection,
  type KnowledgeCandidate,
} from '../../packages/contracts/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;

describe.runIf(databaseUrl)('AKP-1R R2 PostgreSQL Semantic Corpus Source Snapshot', () => {
  let pool: Pool;
  let reader: PostgresSemanticCorpusSourceSnapshotReader;
  let projectId: string;
  let otherProjectId: string;
  let sourceVersionId: string;
  const queryTexts: string[] = [];

  const digest = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;

  const entity = (candidateId: string, name: string): KnowledgeCandidate =>
    ({
      candidateId,
      candidateType: 'ENTITY',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [`evidence:${candidateId}`],
      modelOutputs: [],
      name,
      entityKind: 'CONCEPT',
      aliases: ['Alias B', 'Alias A'],
      resolution: { status: 'NEW' },
    }) satisfies KnowledgeCandidate;

  const relation = (candidateId: string): KnowledgeCandidate =>
    ({
      candidateId,
      candidateType: 'RELATION',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: [`evidence:${candidateId}`],
      modelOutputs: [],
      fromCandidateId: 'entity:db',
      toCandidateId: 'entity:other',
      relationType: 'RELATED_TO',
      direction: 'DIRECTED',
    }) satisfies KnowledgeCandidate;

  const fact = (): KnowledgeCandidate =>
    ({
      candidateId: 'fact:excluded',
      candidateType: 'FACT',
      revisionNumber: 1,
      sourceVersionId,
      evidenceIds: ['evidence:fact'],
      modelOutputs: [],
    }) as unknown as KnowledgeCandidate;

  const projection = (sourceSnapshotDigest: string): CompiledTruthProjection => {
    const items: CompiledTruthItem[] = [
      {
        id: 'claim:db',
        type: 'CLAIM',
        label: 'Database claim is authoritative.',
        state: 'CURRENT',
        source: 'CANONICAL_CLAIM',
        evidenceIds: ['evidence:claim'],
        accessScope: ['owner'],
        sensitivity: 'public',
      },
      {
        id: 'entity:db',
        type: 'ENTITY',
        label: 'Database Entity',
        state: 'CURRENT',
        source: 'APPROVED_KNOWLEDGE',
        evidenceIds: ['evidence:entity:db'],
        accessScope: ['owner'],
        sensitivity: 'internal',
      },
      {
        id: 'relation:db',
        type: 'RELATION',
        label: 'entity:db RELATED_TO entity:other',
        state: 'CURRENT',
        source: 'APPROVED_KNOWLEDGE',
        evidenceIds: ['evidence:relation:db'],
        accessScope: ['owner'],
        sensitivity: 'internal',
      },
    ];
    const edges: CompiledTruthEdge[] = [
      {
        id: 'relation:db',
        from: 'entity:db',
        to: 'entity:other',
        relationType: 'RELATED_TO',
        direction: 'DIRECTED',
        source: 'APPROVED_TYPED_EDGE',
      },
    ];
    return {
      projectId,
      projectorVersion: '1.0.0',
      sourceSnapshotDigest,
      logicalDigest: compiledTruthLogicalDigest(items, edges),
      canonicalVersion: 1,
      items,
      graph: {
        nodes: items.filter((item) => item.type !== 'RELATION'),
        edges,
        fallback: { available: true, modes: ['LIST', 'TABLE'] },
      },
      projectedAt: '2026-08-26T10:00:00.000Z',
      buildMode: 'FULL_REBUILD',
    };
  };

  beforeAll(async () => {
    pool = createPostgresPool(databaseUrl!);
    projectId = `r2-source-${randomUUID()}`;
    otherProjectId = `r2-other-${randomUUID()}`;
    sourceVersionId = randomUUID();
    const sourceId = randomUUID();
    const assetId = randomUUID();
    const manifestId = randomUUID();
    const claim = {
      claimId: 'claim:db',
      projectId,
      revisionNumber: 1,
      claimText: 'Database claim is authoritative.',
      sourceVersionId,
      evidenceIds: ['evidence:claim'],
      createdFromManifestId: manifestId,
      authorityId: null,
      authorityDigest: null,
      accessScope: ['owner'],
      sensitivity: 'public',
      createdAt: '2026-08-26T09:00:00.000Z',
    };
    const items = [
      entity('entity:db', 'Database Entity'),
      entity('entity:other', 'Other Entity'),
      relation('relation:db'),
      fact(),
    ];
    const group = {
      projectId,
      groupId: 'group:db',
      sourceVersionId,
      revisionNumber: 1,
      status: 'APPROVED',
      contentDigest: digest('b'),
      items,
      decisions: [],
      accessScope: ['owner'],
      sensitivity: 'internal',
      createdAt: '2026-08-26T09:00:00.000Z',
      updatedAt: '2026-08-26T09:30:00.000Z',
    };

    await pool.query(
      `INSERT INTO asset.original_assets (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 1, $3, $4)`,
      [assetId, digest('asset'), `r2-source/${assetId}`, '2026-08-26T08:00:00.000Z'],
    );
    await pool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [sourceId, projectId, 'r2-database-test', '2026-08-26T08:00:00.000Z'],
    );
    await pool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id,
         media_type, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', $4, 'internal', $5)`,
      [sourceVersionId, sourceId, assetId, ['owner'], '2026-08-26T08:00:00.000Z'],
    );
    await pool.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, 1, $2, $3), ($4, 1, $5, $3)`,
      [projectId, digest('a'), '2026-08-26T09:00:00.000Z', otherProjectId, digest('c')],
    );
    await pool.query(
      `INSERT INTO canonical.claims (
         claim_id, project_id, source_version_id, manifest_id, claim_json, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6), ($7, $8, $3, $4, $9::jsonb, $6)`,
      [
        claim.claimId,
        projectId,
        sourceVersionId,
        manifestId,
        JSON.stringify(claim),
        claim.createdAt,
        'claim:other',
        otherProjectId,
        JSON.stringify({ ...claim, claimId: 'claim:other', projectId: otherProjectId }),
      ],
    );
    await pool.query(
      `INSERT INTO knowledge.review_groups (
         project_id, group_id, source_version_id, revision_number, status,
         content_digest, items, decisions, access_scope, sensitivity, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12),
                ($13, $14, $3, $4, $5, $15, $7::jsonb, $8::jsonb, $9, $10, $11, $12)`,
      [
        projectId,
        group.groupId,
        sourceVersionId,
        group.revisionNumber,
        group.status,
        group.contentDigest,
        JSON.stringify(group.items),
        JSON.stringify(group.decisions),
        group.accessScope,
        group.sensitivity,
        group.createdAt,
        group.updatedAt,
        otherProjectId,
        'group:other',
        digest('d'),
      ],
    );

    const trackedPool = new Proxy(pool, {
      get(target, property, receiver) {
        if (property === 'query') {
          return (...args: unknown[]) => {
            if (typeof args[0] === 'string') queryTexts.push(args[0]);
            const query = target.query as unknown as (...values: unknown[]) => unknown;
            return query.apply(target, args);
          };
        }
        if (property === 'connect') return target.connect.bind(target);
        return Reflect.get(target, property, receiver);
      },
    }) as Pool;
    reader = new PostgresSemanticCorpusSourceSnapshotReader(trackedPool);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM knowledge.review_groups WHERE project_id IN ($1, $2)', [
      projectId,
      otherProjectId,
    ]);
    await pool.query('DELETE FROM projection.compiled_truth WHERE project_id = $1', [projectId]);
    await pool.query('DELETE FROM canonical.project_state WHERE project_id IN ($1, $2)', [
      projectId,
      otherProjectId,
    ]);
    await pool.query('DELETE FROM asset.source_versions WHERE source_version_id = $1', [
      sourceVersionId,
    ]);
    await pool.query('DELETE FROM asset.sources WHERE project_id = $1', [projectId]);
    await pool.end();
  });

  it('reads real schemas, preserves identity parity, and gates exact Compiled Truth enrichment', async () => {
    const first = await reader.readSnapshot(projectId);
    const second = await reader.readSnapshot(projectId);
    expect(second.sourceSnapshotDigest).toBe(first.sourceSnapshotDigest);
    expect(first.resources.every((resource) => resource.resourceId !== 'claim:other')).toBe(true);
    expect(first.resources.map((resource) => resource.resourceType)).not.toContain('FACT');
    expect(first.resources.map((resource) => resource.resourceType)).toContain('CLAIM');
    expect(first.resources.map((resource) => resource.resourceType)).toContain('ENTITY');
    expect(first.resources.map((resource) => resource.resourceType)).toContain('RELATION');

    const watermark = await reader.readWatermark(projectId);
    expect(watermark.sourceSnapshotDigest).toBe(first.sourceSnapshotDigest);
    const watermarkSql = queryTexts.at(-1) ?? '';
    expect(watermarkSql).toMatch(/canonical\.project_state/);
    expect(watermarkSql).toMatch(/knowledge\.review_groups/);
    expect(watermarkSql).not.toMatch(/embedding|vector|top.?k/i);

    const compiledTruthRepository = new PostgresCompiledTruthRepository(pool);
    await compiledTruthRepository.synchronize(projection(first.sourceSnapshotDigest));
    const exact = await reader.readSnapshot(projectId);
    expect(
      exact.resources.filter((resource) => resource.authority === 'COMPILED_TRUTH'),
    ).toHaveLength(3);

    await compiledTruthRepository.synchronize(projection(digest('z')));
    const stale = await reader.readSnapshot(projectId);
    expect(stale.resources.some((resource) => resource.authority === 'COMPILED_TRUTH')).toBe(false);

    await pool.query(
      `UPDATE canonical.project_state
       SET version = 2, snapshot_digest = $2, updated_at = $3
       WHERE project_id = $1`,
      [projectId, digest('e'), '2026-08-26T10:00:00.000Z'],
    );
    const canonicalAdvanced = await reader.readSnapshot(projectId);
    expect(canonicalAdvanced.sourceSnapshotDigest).not.toBe(first.sourceSnapshotDigest);
    expect(
      canonicalAdvanced.resources.some((resource) => resource.authority === 'COMPILED_TRUTH'),
    ).toBe(false);

    await pool.query(
      `UPDATE knowledge.review_groups
       SET revision_number = 2, content_digest = $2, updated_at = $3
       WHERE project_id = $1 AND group_id = $4`,
      [projectId, digest('f'), '2026-08-26T10:01:00.000Z', 'group:db'],
    );
    const knowledgeAdvanced = await reader.readSnapshot(projectId);
    expect(knowledgeAdvanced.sourceSnapshotDigest).not.toBe(canonicalAdvanced.sourceSnapshotDigest);
  });
});
