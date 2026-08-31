import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { PostgresOriginalAssetRepository } from '../../adapters/postgres/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import { PostgresFrontendDiscoveryProductReadSource } from '../../adapters/frontend-discovery-product-postgres/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeV1,
} from '../../packages/contracts/src/index.js';
import type { StoredIntakeResult } from '../../modules/original-asset/src/index.js';
import { createHash, randomUUID } from 'node:crypto';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectId = `akp-6-wp1-product-${randomUUID()}`;
let storedSource: StoredIntakeResult | undefined;
const finding: DiscoveryFindingEnvelopeV1 = createDiscoveryFindingEnvelopeV1({
  schemaVersion: '1.0.0',
  findingId: 'finding-product-1',
  findingRevision: 1,
  projectId,
  findingType: 'KNOWLEDGE_GAP',
  generationMethod: 'DETERMINISTIC',
  lifecycleState: 'NEW',
  payload: {
    schemaVersion: '1.0.0',
    payloadType: 'KNOWLEDGE_GAP',
    gapKind: 'MISSING_FACT',
    subject: 'Product',
    missingFact: 'database authority',
    question: 'Which persisted authority is used?',
  },
  relatedResourceRefs: [],
  evidenceIds: ['missing-evidence'],
  sourceProjectionDigest: 'sha256:projection',
  canonicalBase: {
    schemaVersion: '1.0.0',
    canonicalVersion: 1,
    snapshotDigest: 'sha256:canonical',
  },
  discoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'projection-1',
    projectionDigest: 'sha256:discovery',
  },
  runId: 'run-product-1',
  signalSummary: { novelty: 0.1 },
  rationale: 'A database product read test.',
  derivationSummary: 'Created only for the WP1 adapter test.',
  provenance: {
    schemaVersion: '1.0.0',
    kind: 'DETERMINISTIC',
    ruleId: 'test',
    ruleVersion: '1',
    inputDigest: 'sha256:input',
  },
  accessScope: ['owner'],
  sensitivity: 'public',
  fingerprint: 'sha256:finding-product-1',
  fingerprintVersion: 'discovery-fingerprint:v1',
  retentionClass: 'DURABLE_DERIVED_RECORD',
  createdAt: '2026-08-31T00:00:00.000Z',
});

describe.runIf(databaseUrl)('AKP-6 WP1 Discovery Product PostgreSQL authority', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    await pool!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, $2, 'ACTIVE', true) ON CONFLICT (id) DO NOTHING`,
      [projectId, 'AKP-6 WP1 Product Test'],
    );
    const originalAssetRepository = new PostgresOriginalAssetRepository(pool!);
    storedSource = await originalAssetRepository.store({
      submissionId: `submission-${projectId}`,
      projectId,
      actorId: 'akp-6-wp1-test-actor',
      channel: 'direct_text',
      materialKind: 'plain_text',
      mediaType: 'text/plain',
      contentHash: `sha256:${createHash('sha256').update(projectId).digest('hex')}`,
      sizeBytes: projectId.length,
      storageKey: `test/${projectId}`,
      accessScope: ['owner'],
      sensitivity: 'public',
      createdAt: '2026-08-31T00:00:00.000Z',
    });
    const transformed = new LucasAugmentedPlainTextAdapter().transform({
      sourceId: storedSource.sourceId,
      sourceVersionId: storedSource.sourceVersionId,
      sourceContentHash: storedSource.assetReference.contentHash,
      mediaType: 'text/plain',
      text: 'A persisted Discovery Product evidence fixture.',
    });
    const transformer = new LucasAugmentedPlainTextAdapter();
    const transformation = await new PostgresTransformationRepository(pool!).save({
      projectId,
      sourceId: storedSource.sourceId,
      sourceVersionId: storedSource.sourceVersionId,
      sourceContentHash: storedSource.assetReference.contentHash,
      transformer: transformer.identity,
      output: transformed,
      accessScope: ['owner'],
      sensitivity: 'public',
      createdAt: '2026-08-31T00:00:00.000Z',
    });
    const entry = transformed.sourceMap.entries[0];
    if (!entry || entry.origin !== 'source')
      throw new Error('Evidence fixture source map was empty or not source-backed.');
    await new PostgresEvidenceRepository(pool!).index([
      {
        revisionId: transformation.revision.revisionId,
        projectId,
        sourceId: storedSource.sourceId,
        sourceVersionId: storedSource.sourceVersionId,
        pointer: entry.pointer,
        nodeKind: entry.nodeKind,
        origin: entry.origin,
        position: entry.position,
        quote: entry.quote,
        selectors: entry.selectors ?? [],
        exactHash: entry.exactHash,
        accessScope: ['owner'],
        sensitivity: 'public',
        createdAt: '2026-08-31T00:00:00.000Z',
      },
    ]);
    expect(await new PostgresDiscoveryFindingRepository(pool!).save(finding)).toBe('CREATED');
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      // Teardown only: the lifecycle history trigger is intentionally
      // immutable during normal runtime and must not be bypassed by Product.
      await client.query('SET session_replication_role = replica');
      await client.query('DELETE FROM discovery.finding_lifecycle_history WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.finding_lifecycle_current WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.findings WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM evidence.spans WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM transformation.revisions WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM asset.storage_receipts WHERE project_id = $1', [projectId]);
      await client.query(
        `DELETE FROM asset.source_versions
         WHERE source_id IN (SELECT source_id FROM asset.sources WHERE project_id = $1)`,
        [projectId],
      );
      await client.query('DELETE FROM asset.sources WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM asset.original_assets WHERE storage_key = $1', [
        `test/${projectId}`,
      ]);
      await client.query('DELETE FROM project_admin.projects WHERE id = $1', [projectId]);
    } finally {
      await client.query('SET session_replication_role = origin');
      client.release();
      await pool.end();
    }
  });

  it('reads project-bound findings and authoritative lifecycle without fabricating evidence', async () => {
    const originalAssetRepository = new PostgresOriginalAssetRepository(pool!);
    const evidenceRepository = new PostgresEvidenceRepository(pool!);
    const source = new PostgresFrontendDiscoveryProductReadSource(pool!, {
      evidenceRepository,
      sourceSecurityReader: originalAssetRepository,
    });
    const rows = await source.listFindings(projectId, undefined, 2);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.findingId).toBe(finding.findingId);
    expect(
      (await source.findLifecycle({ projectId, findingId: finding.findingId, findingRevision: 1 }))
        ?.lifecycleState,
    ).toBe('NEW');
    expect(await source.findEvidence(projectId, 'missing-evidence')).toBeUndefined();
    expect(storedSource).toBeDefined();
    const sourceVersion = await source.findResourceAuthorization({
      schemaVersion: '1.0.0',
      resourceKind: 'SOURCE_VERSION',
      resourceId: storedSource!.sourceVersionId,
      projectId,
      resourceState: 'CURRENT',
      resourceRevision: '1',
    });
    expect(sourceVersion).toMatchObject({
      projectId,
      resourceId: storedSource!.sourceVersionId,
      resourceRevision: '1',
      accessScope: ['owner'],
      sensitivity: 'public',
    });
    const persistedEvidence = await evidenceRepository.listBySourceVersion(
      projectId,
      storedSource!.sourceVersionId,
    );
    expect(persistedEvidence).toHaveLength(1);
    expect(await source.findEvidence(projectId, persistedEvidence[0]!.evidenceId)).toMatchObject({
      evidenceId: persistedEvidence[0]!.evidenceId,
      revisionId: persistedEvidence[0]!.revisionId,
      sourceId: storedSource!.sourceId,
      sourceVersionId: storedSource!.sourceVersionId,
    });
    expect(
      await source.findResourceAuthorization({
        schemaVersion: '1.0.0',
        resourceKind: 'SOURCE_VERSION',
        resourceId: storedSource!.sourceVersionId,
        projectId: `${projectId}-other`,
        resourceState: 'CURRENT',
      }),
    ).toBeUndefined();
    expect(await source.findEvidence(`${projectId}-other`, 'missing-evidence')).toBeUndefined();

    const transitioned = await new PostgresDiscoveryFindingRepository(pool!).transitionLifecycle({
      projectId,
      findingId: finding.findingId,
      findingRevision: finding.findingRevision,
      expectedLifecycleRevision: 1,
      targetState: 'VALIDATING',
      cause: 'GOVERNED_WORKFLOW',
      reasonCode: 'VALIDATION_STARTED',
      occurredAt: '2026-08-31T00:02:00.000Z',
    });
    expect(transitioned.status).toBe('APPLIED');
    expect(
      (await source.findLifecycle({ projectId, findingId: finding.findingId, findingRevision: 1 }))
        ?.lifecycleState,
    ).toBe('VALIDATING');
  });
});
