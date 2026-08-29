import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeV1,
} from '../../packages/contracts/src/index.js';
import { dropSchemas, migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const findingColumns = `
  schema_version, finding_id, finding_revision, project_id, finding_type,
  status, generation_method, lifecycle_state, payload, related_resource_refs,
  evidence_ids, source_projection_digest, canonical_base_version,
  canonical_snapshot_digest, discovery_projection_revision,
  discovery_projection_digest, run_id, signal_summary, rationale,
  derivation_summary, provenance, access_scope, sensitivity, fingerprint,
  fingerprint_version, retention_class, created_at, supersedes_finding_id`;

const createWp2Finding = (): DiscoveryFindingEnvelopeV1 => {
  const projectId = `akp-2-wp3-backfill-${randomUUID()}`;
  const claimRef = {
    schemaVersion: '1.0.0' as const,
    resourceKind: 'CANONICAL_CLAIM' as const,
    resourceId: 'claim-wp2-backfill',
    projectId,
    resourceState: 'CURRENT' as const,
    resourceRevision: '4',
  };
  return createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: 'finding-wp2-backfill',
    findingRevision: 1,
    projectId,
    findingType: 'EVIDENCE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'REVIEW_READY',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'EVIDENCE_GAP',
      coverageKind: 'INSUFFICIENT',
      affectedResourceRef: claimRef,
      coverageGap: 'The WP2 finding has incomplete evidence.',
      requiredEvidence: 'A current supporting source is required.',
    },
    relatedResourceRefs: [claimRef],
    evidenceIds: ['evidence-wp2-backfill'],
    sourceProjectionDigest: `sha256:${'1'.repeat(64)}`,
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 12,
      snapshotDigest: `sha256:${'2'.repeat(64)}`,
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-wp2-12',
      projectionDigest: `sha256:${'3'.repeat(64)}`,
    },
    runId: 'run-wp2-backfill',
    signalSummary: { evidenceCoverage: 0.4 },
    rationale: 'The WP2 finding is retained for lifecycle initialization.',
    derivationSummary: 'Derived from a WP2-era persisted discovery projection.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'discovery.wp2.backfill.test',
      ruleVersion: '1',
      inputDigest: `sha256:${'4'.repeat(64)}`,
    },
    accessScope: ['owner'],
    sensitivity: 'internal',
    fingerprint: `sha256:${'5'.repeat(64)}`,
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-29T00:00:00.000Z',
  });
};

const insertWp2Finding = async (finding: DiscoveryFindingEnvelopeV1): Promise<void> => {
  await pool!.query(
    `INSERT INTO discovery.findings (${findingColumns})
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
     )`,
    [
      finding.schemaVersion,
      finding.findingId,
      finding.findingRevision,
      finding.projectId,
      finding.findingType,
      finding.status,
      finding.generationMethod,
      finding.lifecycleState,
      JSON.stringify(finding.payload),
      JSON.stringify(finding.relatedResourceRefs),
      finding.evidenceIds,
      finding.sourceProjectionDigest,
      finding.canonicalBase.canonicalVersion,
      finding.canonicalBase.snapshotDigest,
      finding.discoveryBase.projectionRevision,
      finding.discoveryBase.projectionDigest,
      finding.runId,
      JSON.stringify(finding.signalSummary),
      finding.rationale,
      finding.derivationSummary,
      JSON.stringify(finding.provenance),
      finding.accessScope,
      finding.sensitivity,
      finding.fingerprint,
      finding.fingerprintVersion,
      finding.retentionClass,
      finding.createdAt,
      finding.supersedesFindingId ?? null,
    ],
  );
};

describe.runIf(pool)('AKP-2 WP3 migration 045 to 046 lifecycle backfill', () => {
  afterEach(async () => {
    await dropSchemas(databaseUrl!);
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('backfills an existing WP2 finding into lifecycle current and initial history', async () => {
    await dropSchemas(databaseUrl!);
    await migrateUpTo('045_akp_2_wp2_discovery_finding_persistence.sql', databaseUrl!);

    const finding = createWp2Finding();
    await insertWp2Finding(finding);
    const before = await pool!.query(
      `SELECT ${findingColumns}
       FROM discovery.findings
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      [finding.projectId, finding.findingId, finding.findingRevision],
    );
    expect(before.rows).toHaveLength(1);
    expect(
      await pool!.query<{ current_table: string | null; history_table: string | null }>(
        `SELECT to_regclass('discovery.finding_lifecycle_current')::text AS current_table,
                to_regclass('discovery.finding_lifecycle_history')::text AS history_table`,
      ),
    ).toMatchObject({ rows: [{ current_table: null, history_table: null }] });

    await migrateUpTo('046_akp_2_wp3_discovery_finding_lifecycle.sql', databaseUrl!);

    const current = await pool!.query<{
      project_id: string;
      finding_id: string;
      finding_revision: number;
      lifecycle_state: string;
      lifecycle_revision: number;
      updated_at: Date;
    }>(
      `SELECT project_id, finding_id, finding_revision, lifecycle_state,
              lifecycle_revision, updated_at
       FROM discovery.finding_lifecycle_current
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      [finding.projectId, finding.findingId, finding.findingRevision],
    );
    expect(current.rows).toHaveLength(1);
    expect(current.rows[0]).toMatchObject({
      project_id: finding.projectId,
      finding_id: finding.findingId,
      finding_revision: finding.findingRevision,
      lifecycle_state: finding.lifecycleState,
      lifecycle_revision: 1,
    });
    expect(current.rows[0]!.updated_at.toISOString()).toBe(finding.createdAt);

    const history = await pool!.query<{
      project_id: string;
      finding_id: string;
      finding_revision: number;
      lifecycle_revision: number;
      from_state: string | null;
      to_state: string;
      cause: string;
      reason_code: string;
      canonical_base_version: number | null;
      canonical_snapshot_digest: string | null;
      discovery_projection_revision: string | null;
      discovery_projection_digest: string | null;
      occurred_at: Date;
    }>(
      `SELECT project_id, finding_id, finding_revision, lifecycle_revision,
              from_state, to_state, cause, reason_code,
              canonical_base_version, canonical_snapshot_digest,
              discovery_projection_revision, discovery_projection_digest, occurred_at
       FROM discovery.finding_lifecycle_history
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      [finding.projectId, finding.findingId, finding.findingRevision],
    );
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0]).toMatchObject({
      project_id: finding.projectId,
      finding_id: finding.findingId,
      finding_revision: finding.findingRevision,
      lifecycle_revision: 1,
      from_state: null,
      to_state: finding.lifecycleState,
      cause: 'MATERIALIZATION',
      reason_code: 'FINDING_MATERIALIZED',
      canonical_base_version: finding.canonicalBase.canonicalVersion,
      canonical_snapshot_digest: finding.canonicalBase.snapshotDigest,
      discovery_projection_revision: finding.discoveryBase.projectionRevision,
      discovery_projection_digest: finding.discoveryBase.projectionDigest,
    });
    expect(history.rows[0]!.occurred_at.toISOString()).toBe(finding.createdAt);

    const after = await pool!.query(
      `SELECT ${findingColumns}
       FROM discovery.findings
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      [finding.projectId, finding.findingId, finding.findingRevision],
    );
    expect(after.rows).toEqual(before.rows);
  });
});
