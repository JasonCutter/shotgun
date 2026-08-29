import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  decodeDiscoveryFindingEnvelopeV1,
  deserializeDiscoveryFindingEnvelopeV1,
  type DiscoveryFindingEnvelopeV1,
} from '../../packages/contracts/src/index.js';
import {
  createBackup,
  createIsolatedRestoreDatabase,
  dropIsolatedRestoreDatabase,
  restoreBackup,
  type BackupManifest,
} from '../../scripts/backup-restore.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const canRunBackupAcceptance =
  Boolean(process.env.TEST_DATABASE_URL?.trim()) &&
  (process.env.SHOTGUN_PG_TOOL_MODE === 'docker-compose' ||
    process.env.CI === 'true' ||
    Boolean(process.env.PG_DUMP_BIN?.trim() && process.env.PG_RESTORE_BIN?.trim()));
const databaseUrl = canRunBackupAcceptance ? await requireTestDatabaseTarget() : undefined;
const toolMode = process.env.SHOTGUN_PG_TOOL_MODE === 'docker-compose' ? 'docker-compose' : 'local';
const isolatedDatabases: string[] = [];
const pools: Pool[] = [];

const projectId = `akp-2-wp4-backup-${randomUUID()}`;

const findingForBackup = (): DiscoveryFindingEnvelopeV1 => {
  const fixture = deserializeDiscoveryFindingEnvelopeV1(
    JSON.stringify({
      schemaVersion: '1.0.0',
      findingId: 'finding-wp4-backup-001',
      findingRevision: 1,
      projectId,
      findingType: 'EVIDENCE_GAP',
      status: 'DERIVED_INFERENCE',
      generationMethod: 'HYBRID',
      lifecycleState: 'NEW',
      payload: {
        schemaVersion: '1.0.0',
        payloadType: 'EVIDENCE_GAP',
        coverageKind: 'INSUFFICIENT',
        affectedResourceRef: {
          schemaVersion: '1.0.0',
          resourceKind: 'CANONICAL_DECISION',
          resourceId: 'decision-wp4-backup-001',
          projectId,
          resourceState: 'APPROVED',
          resourceRevision: '4',
        },
        coverageGap: 'The approved decision has incomplete evidence.',
        requiredEvidence: 'A current source version is required.',
      },
      relatedResourceRefs: [
        {
          schemaVersion: '1.0.0',
          resourceKind: 'CANONICAL_DECISION',
          resourceId: 'decision-wp4-backup-001',
          projectId,
          resourceState: 'APPROVED',
          resourceRevision: '4',
        },
      ],
      evidenceIds: ['evidence-wp4-backup-001'],
      sourceProjectionDigest: 'sha256:wp4-backup-source',
      canonicalBase: {
        schemaVersion: '1.0.0',
        canonicalVersion: 12,
        snapshotDigest: 'sha256:wp4-backup-canonical',
      },
      discoveryBase: {
        schemaVersion: '1.0.0',
        projectionRevision: 'projection-wp4-backup-12',
        projectionDigest: 'sha256:wp4-backup-discovery',
      },
      runId: 'run-wp4-backup-001',
      signalSummary: { evidenceCoverage: 0.2, novelty: 0.4 },
      rationale: 'A durable bounded signal is retained for governed review.',
      derivationSummary: 'Derived from a pinned decision and discovery projection.',
      provenance: {
        schemaVersion: '1.0.0',
        kind: 'HYBRID',
        deterministic: {
          ruleId: 'discovery.wp4.backup',
          ruleVersion: '1',
          inputDigest: 'sha256:wp4-backup-input',
        },
        aiExecution: {
          providerId: 'provider-wp4',
          modelId: 'model-wp4',
          modelVersion: '2026-08',
          aiConfigurationRevision: 'config-wp4-1',
          credentialId: 'credential-wp4-1',
          credentialRevision: 'credential-revision-1',
          providerPolicyFingerprint: 'sha256:wp4-policy',
          privacyPolicyRevision: 'privacy-1',
          dataPolicyRevision: 'data-1',
          promptVersion: 'prompt-1',
          outputSchemaVersion: 'output-1',
        },
      },
      accessScope: ['owner', 'reviewer'],
      sensitivity: 'internal',
      fingerprint: 'sha256:wp4-backup-fingerprint',
      fingerprintVersion: 'discovery-fingerprint:v1',
      retentionClass: 'DURABLE_DERIVED_RECORD',
      createdAt: '2026-08-29T00:00:00.000Z',
    }),
  );
  return createDiscoveryFindingEnvelopeV1({ ...fixture, lifecycleState: 'NEW' });
};

const databaseNameOf = (database: { readonly databaseName: string }): string => {
  isolatedDatabases.push(database.databaseName);
  return database.databaseName;
};

describe.runIf(databaseUrl)('AKP-2 WP4 Discovery backup and isolated restore', () => {
  afterAll(async () => {
    for (const pool of pools) await pool.end();
    for (const databaseName of isolatedDatabases.reverse()) {
      await dropIsolatedRestoreDatabase(databaseUrl!, databaseName);
    }
  });

  it('backs up and restores the durable finding and complete lifecycle history', async () => {
    const source = await createIsolatedRestoreDatabase(databaseUrl!);
    const target = await createIsolatedRestoreDatabase(databaseUrl!);
    databaseNameOf(source);
    databaseNameOf(target);
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-wp4-backup-'));
    const backupDirectory = path.join(temporaryRoot, 'backup');
    const sourceAssetRoot = path.join(temporaryRoot, 'source-assets');
    const targetAssetRoot = path.join(temporaryRoot, 'target-assets');
    let manifest: BackupManifest | undefined;

    try {
      await migrateUpTo(undefined, source.databaseUrl);
      const sourcePool = createPostgresPool(source.databaseUrl);
      const sourceRepository = new PostgresDiscoveryFindingRepository(sourcePool);
      pools.push(sourcePool);
      const finding = findingForBackup();
      const identity = {
        projectId: finding.projectId,
        findingId: finding.findingId,
        findingRevision: finding.findingRevision,
      };

      expect(await sourceRepository.save(finding)).toBe('CREATED');
      expect(
        await sourceRepository.transitionLifecycle({
          ...identity,
          expectedLifecycleRevision: 1,
          targetState: 'VALIDATING',
          cause: 'GOVERNED_WORKFLOW',
          reasonCode: 'VALIDATION_STARTED',
          occurredAt: '2026-08-29T00:01:00.000Z',
        }),
      ).toMatchObject({ status: 'APPLIED' });
      expect(
        await sourceRepository.transitionLifecycle({
          ...identity,
          expectedLifecycleRevision: 2,
          targetState: 'REVIEW_READY',
          cause: 'GOVERNED_WORKFLOW',
          reasonCode: 'REVIEW_READY',
          occurredAt: '2026-08-29T00:02:00.000Z',
        }),
      ).toMatchObject({ status: 'APPLIED' });
      expect(
        await sourceRepository.transitionLifecycle({
          ...identity,
          expectedLifecycleRevision: 3,
          targetState: 'RESOLVED',
          cause: 'SYSTEM_RECONCILIATION',
          reasonCode: 'CANONICAL_EQUIVALENT_ACCEPTED',
          occurredAt: '2026-08-29T00:03:00.000Z',
          context: { canonicalBase: finding.canonicalBase, discoveryBase: finding.discoveryBase },
        }),
      ).toMatchObject({ status: 'APPLIED' });

      manifest = await createBackup({
        databaseUrl: source.databaseUrl,
        assetRoot: sourceAssetRoot,
        outputDirectory: backupDirectory,
        toolMode,
      });
      expect(manifest.formatVersion).toBe('shotgun-backup-v1');
      for (const table of [
        'discovery.findings',
        'discovery.finding_lifecycle_current',
        'discovery.finding_lifecycle_history',
      ]) {
        expect(manifest.integrity.tables[table]).toMatchObject({ rows: expect.any(Number) });
        expect(manifest.integrity.tables[table]!.digest).toMatch(/^sha256:/u);
      }

      await restoreBackup({
        sourceDatabaseUrl: source.databaseUrl,
        targetDatabaseUrl: target.databaseUrl,
        targetAssetRoot,
        backupDirectory,
        toolMode,
      });

      const targetPool = createPostgresPool(target.databaseUrl);
      const targetRepository = new PostgresDiscoveryFindingRepository(targetPool);
      pools.push(targetPool);
      expect(await targetRepository.findRevision(identity)).toEqual(finding);
      expect(await targetRepository.findLifecycle(identity)).toEqual({
        ...identity,
        lifecycleState: 'RESOLVED',
        lifecycleRevision: 4,
        updatedAt: '2026-08-29T00:03:00.000Z',
      });
      expect(await targetRepository.listLifecycleHistory(identity)).toHaveLength(4);
      expect(await targetRepository.listLifecycleHistory(identity)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toState: 'RESOLVED',
            cause: 'SYSTEM_RECONCILIATION',
            reasonCode: 'CANONICAL_EQUIVALENT_ACCEPTED',
          }),
        ]),
      );

      const canonicalRows = await targetPool.query<{ project_state: string; claims: string }>(
        `SELECT
           (SELECT count(*)::text FROM canonical.project_state WHERE project_id = $1) AS project_state,
           (SELECT count(*)::text FROM canonical.claims WHERE project_id = $1) AS claims`,
        [projectId],
      );
      expect(canonicalRows.rows[0]).toEqual({ project_state: '0', claims: '0' });
      expect((await targetRepository.findRevision(identity))?.provenance).toMatchObject({
        kind: 'HYBRID',
        aiExecution: {
          credentialId: 'credential-wp4-1',
          credentialRevision: 'credential-revision-1',
          providerPolicyFingerprint: 'sha256:wp4-policy',
        },
      });
      expect((await targetRepository.findRevision(identity))?.retentionClass).toBe(
        'DURABLE_DERIVED_RECORD',
      );
      expect(
        decodeDiscoveryFindingEnvelopeV1(await targetRepository.findRevision(identity)),
      ).toEqual(finding);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it('restores a pre-Discovery shotgun-backup-v1 bundle without Discovery integrity tables', async () => {
    const source = await createIsolatedRestoreDatabase(databaseUrl!);
    const target = await createIsolatedRestoreDatabase(databaseUrl!);
    databaseNameOf(source);
    databaseNameOf(target);
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-wp4-historical-backup-'));
    const backupDirectory = path.join(temporaryRoot, 'backup');
    const sourceAssetRoot = path.join(temporaryRoot, 'source-assets');
    const targetAssetRoot = path.join(temporaryRoot, 'target-assets');

    try {
      await migrateUpTo('044_akp_1r_semantic_generation_lifecycle.sql', source.databaseUrl);
      const manifest = await createBackup({
        databaseUrl: source.databaseUrl,
        assetRoot: sourceAssetRoot,
        outputDirectory: backupDirectory,
        toolMode,
      });

      expect(manifest.formatVersion).toBe('shotgun-backup-v1');
      expect(manifest.database.migrations).toContain(
        '044_akp_1r_semantic_generation_lifecycle.sql',
      );
      expect(manifest.database.migrations).not.toContain(
        '045_akp_2_wp2_discovery_finding_persistence.sql',
      );
      expect(manifest.database.migrations).not.toContain(
        '046_akp_2_wp3_discovery_finding_lifecycle.sql',
      );
      expect(
        Object.keys(manifest.integrity.tables).some((table) => table.startsWith('discovery.')),
      ).toBe(false);

      await expect(
        restoreBackup({
          sourceDatabaseUrl: source.databaseUrl,
          targetDatabaseUrl: target.databaseUrl,
          targetAssetRoot,
          backupDirectory,
          toolMode,
        }),
      ).resolves.toEqual(manifest);

      const targetPool = createPostgresPool(target.databaseUrl);
      pools.push(targetPool);
      const migrations = await targetPool.query<{ name: string }>(
        'SELECT name FROM runtime.schema_migrations ORDER BY name',
      );
      expect(migrations.rows.map((row) => row.name)).toEqual(manifest.database.migrations);
      expect(migrations.rows.map((row) => row.name)).not.toContain(
        '045_akp_2_wp2_discovery_finding_persistence.sql',
      );
      expect(migrations.rows.map((row) => row.name)).not.toContain(
        '046_akp_2_wp3_discovery_finding_lifecycle.sql',
      );
      const discoveryTable = await targetPool.query<{ tableName: string | null }>(
        'SELECT to_regclass(\'discovery.findings\')::text AS "tableName"',
      );
      expect(discoveryTable.rows).toEqual([{ tableName: null }]);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
