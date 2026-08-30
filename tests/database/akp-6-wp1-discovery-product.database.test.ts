import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { PostgresFrontendDiscoveryProductReadSource } from '../../adapters/frontend-discovery-product-postgres/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectId = `akp-6-wp1-product-${Date.now()}`;
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
    expect(await new PostgresDiscoveryFindingRepository(pool!).save(finding)).toBe('CREATED');
  });

  afterAll(async () => {
    await pool?.query('DELETE FROM discovery.findings WHERE project_id = $1', [projectId]);
    await pool?.query('DELETE FROM project_admin.projects WHERE id = $1', [projectId]);
    await pool?.end();
  });

  it('reads project-bound findings and authoritative lifecycle without fabricating evidence', async () => {
    const source = new PostgresFrontendDiscoveryProductReadSource(pool!);
    const rows = await source.listFindings(projectId, undefined, 2);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.findingId).toBe(finding.findingId);
    expect(
      (await source.findLifecycle({ projectId, findingId: finding.findingId, findingRevision: 1 }))
        ?.lifecycleState,
    ).toBe('NEW');
    expect(await source.findEvidence(projectId, 'missing-evidence')).toBeUndefined();
  });
});
