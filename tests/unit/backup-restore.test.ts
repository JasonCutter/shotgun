import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  BACKUP_FORMAT_VERSION,
  authoritativeIntegrityTablesForMigrations,
  type BackupManifest,
  readManifest,
  restoreBackup,
  verifyBackup,
} from '../../scripts/backup-restore.js';

const temporaryDirectories: string[] = [];
const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const fixture = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'shotgun-backup-unit-'));
  temporaryDirectories.push(directory);
  const dump = Buffer.from('custom-dump-fixture');
  const asset = Buffer.from('original-asset-fixture');
  const contract = Buffer.from('{"type":"object"}\n');
  await mkdir(path.join(directory, 'assets', 'original'), { recursive: true });
  await mkdir(path.join(directory, 'contracts', 'packages'), { recursive: true });
  await writeFile(path.join(directory, 'database.dump'), dump);
  await writeFile(path.join(directory, 'assets', 'original', 'asset.blob'), asset);
  await writeFile(path.join(directory, 'contracts', 'packages', 'contract.json'), contract);
  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    backupId: '00000000-0000-4000-8000-000000000001',
    createdAt: '2026-07-21T00:00:00.000Z',
    database: {
      engine: 'postgresql',
      majorVersion: 16,
      dumpFormat: 'custom',
      dumpFile: 'database.dump',
      dumpSha256: sha256(dump),
      migrations: ['001_runtime.sql'],
    },
    assets: {
      storage: 'local-content-addressed',
      files: [
        {
          storageKey: 'original/asset.blob',
          contentHash: sha256(asset),
          sizeBytes: asset.byteLength,
          backupPath: 'assets/original/asset.blob',
          backupDigest: sha256(asset),
        },
      ],
    },
    contracts: {
      files: [
        {
          repositoryPath: 'packages/contract.json',
          backupPath: 'contracts/packages/contract.json',
          sizeBytes: contract.byteLength,
          sha256: sha256(contract),
        },
      ],
    },
    integrity: { tables: {} },
    configuration: {
      secretsIncluded: false,
      projectionAuthority: 'rebuild-from-canonical',
    },
  };
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
  return { directory, manifest };
};

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('Backup Bundle verification', () => {
  it('verifies the Bundle and fails closed after Database dump tampering', async () => {
    const { directory, manifest } = await fixture();
    await expect(verifyBackup(directory)).resolves.toEqual(manifest);

    await writeFile(path.join(directory, 'database.dump'), 'tampered-dump');
    await expect(verifyBackup(directory)).rejects.toThrow(
      'Database dump digest does not match the Backup Manifest.',
    );
  });

  it('accepts historical shotgun-backup-v1 manifests without newer Discovery tables', async () => {
    const { directory, manifest } = await fixture();
    expect(manifest.formatVersion).toBe('shotgun-backup-v1');
    expect(manifest.integrity.tables).not.toHaveProperty('discovery.findings');
    await expect(readManifest(directory)).resolves.toEqual(manifest);
    await expect(verifyBackup(directory)).resolves.toEqual(manifest);
  });

  it('rejects T3 bundles that cannot prove owners and ACLs were preserved', async () => {
    const { directory, manifest } = await fixture();
    const legacyT3Manifest: BackupManifest = {
      ...manifest,
      database: {
        ...manifest.database,
        migrations: [...manifest.database.migrations, '078_t3_project_source_knowledge_reset.sql'],
      },
      projectKnowledgeEpochs: {},
    };
    await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(legacyT3Manifest)}\n`);

    await expect(verifyBackup(directory)).rejects.toThrow(
      'T3 Backup does not declare the owner-and-ACL-preserving restore security profile.',
    );
  });

  it('selects Discovery integrity tables from migration identity and fails closed', () => {
    const discoveryTables = (migrations: readonly string[]) =>
      authoritativeIntegrityTablesForMigrations(migrations).filter((table) =>
        table.startsWith('discovery.'),
      );

    expect(discoveryTables(['044_akp_1r_semantic_generation_lifecycle.sql'])).toEqual([]);
    expect(
      discoveryTables([
        '044_akp_1r_semantic_generation_lifecycle.sql',
        '045_akp_2_wp2_discovery_finding_persistence.sql',
      ]),
    ).toEqual(['discovery.findings']);
    expect(
      discoveryTables([
        '044_akp_1r_semantic_generation_lifecycle.sql',
        '045_akp_2_wp2_discovery_finding_persistence.sql',
        '046_akp_2_wp3_discovery_finding_lifecycle.sql',
        '047_akp_3_wp3_discovery_model_profiles.sql',
      ]),
    ).toEqual([
      'discovery.findings',
      'discovery.finding_lifecycle_current',
      'discovery.finding_lifecycle_history',
      'discovery.model_profiles',
    ]);
    expect(
      discoveryTables([
        '044_akp_1r_semantic_generation_lifecycle.sql',
        '045_akp_2_wp2_discovery_finding_persistence.sql',
        '055_akp_7_wp1_feedback_suppression_ranking_storage.sql',
      ]),
    ).toEqual([
      'discovery.findings',
      'discovery.feedback_events',
      'discovery.suppression_directives',
      'discovery.ranking_policy_revisions',
    ]);
    const allTables = authoritativeIntegrityTablesForMigrations([
      '044_akp_1r_semantic_generation_lifecycle.sql',
      '045_akp_2_wp2_discovery_finding_persistence.sql',
      '046_akp_2_wp3_discovery_finding_lifecycle.sql',
      '047_akp_3_wp3_discovery_model_profiles.sql',
      '055_akp_7_wp1_feedback_suppression_ranking_storage.sql',
      '056_akp_7_wp3_semantic_family_projection.sql',
      '057_akp_7_wp4_epistemic_feedback_reentry.sql',
      '058_akp8_typed_proposition_conflict_authority.sql',
      '059_akp8_canonical_relation_authority.sql',
    ]);
    expect(allTables).toEqual(
      expect.arrayContaining([
        'knowledge.typed_proposition_conflict_rules',
        'knowledge.typed_incompatibility_assertions',
        'canonical.relations',
        'canonical.relation_precursors',
      ]),
    );
    expect(() =>
      authoritativeIntegrityTablesForMigrations(['046_akp_2_wp3_discovery_finding_lifecycle.sql']),
    ).toThrow('requires 045_akp_2_wp2_discovery_finding_persistence.sql');
    expect(() =>
      authoritativeIntegrityTablesForMigrations([
        '055_akp_7_wp1_feedback_suppression_ranking_storage.sql',
      ]),
    ).toThrow('requires 045_akp_2_wp2_discovery_finding_persistence.sql');
    expect(() =>
      authoritativeIntegrityTablesForMigrations(['056_akp_7_wp3_semantic_family_projection.sql']),
    ).toThrow('requires 055_akp_7_wp1_feedback_suppression_ranking_storage.sql');
    expect(() =>
      authoritativeIntegrityTablesForMigrations([
        '058_akp8_typed_proposition_conflict_authority.sql',
      ]),
    ).toThrow('requires 057_akp_7_wp4_epistemic_feedback_reentry.sql');
    expect(() =>
      authoritativeIntegrityTablesForMigrations(['059_akp8_canonical_relation_authority.sql']),
    ).toThrow('requires 058_akp8_typed_proposition_conflict_authority.sql');
  });

  it('includes ADR-163 immutable Review resolution tables in authoritative backups', () => {
    expect(
      authoritativeIntegrityTablesForMigrations([
        '067_stage5_comparison_review_v2_persistence.sql',
        '070_adr163_review_operation_resolution_v2.sql',
      ]),
    ).toEqual(
      expect.arrayContaining(['review.change_set_revisions_v2', 'review.operation_resolutions_v2']),
    );
  });

  it('includes Issue #245 blocked outcomes in authoritative backups only after its migration', () => {
    expect(
      authoritativeIntegrityTablesForMigrations([
        '066_stage5_semantic_comparison_v2_persistence.sql',
      ]),
    ).not.toContain('comparison.blocked_outcomes_v2');
    expect(
      authoritativeIntegrityTablesForMigrations([
        '066_stage5_semantic_comparison_v2_persistence.sql',
        '071_stage5_blocked_outcome_observability.sql',
      ]),
    ).toEqual(expect.arrayContaining(['comparison.blocked_outcomes_v2']));
  });

  it('includes staging lease authority only after migration 077', () => {
    expect(
      authoritativeIntegrityTablesForMigrations(['076_stage4_candidate_revision_lineage.sql']),
    ).not.toContain('asset.staging_asset_leases');
    expect(
      authoritativeIntegrityTablesForMigrations([
        '076_stage4_candidate_revision_lineage.sql',
        '077_ts5_asset_cas_lifecycle.sql',
      ]),
    ).toContain('asset.staging_asset_leases');
  });

  it('includes Knowledge Model source-linked tables after migration 009', () => {
    expect(authoritativeIntegrityTablesForMigrations(['009_stage9_knowledge_model.sql'])).toEqual(
      expect.arrayContaining(['knowledge.review_groups', 'knowledge.entity_vault_imports']),
    );
  });

  it('requires Project knowledge epochs with migration 078 and backs up reset control state', async () => {
    const { directory, manifest } = await fixture();
    const t3Manifest: BackupManifest = {
      ...manifest,
      database: {
        ...manifest.database,
        restoreSecurityProfile: 'postgres-owners-and-acls-v1',
        migrations: [
          '009_stage9_knowledge_model.sql',
          '029_frontend_activity_read_model.sql',
          '030_frontend_history_projection.sql',
          '077_ts5_asset_cas_lifecycle.sql',
          '078_t3_project_source_knowledge_reset.sql',
          '101_t3_canonical_erasure.sql',
          '102_t3_activity_erasure.sql',
        ],
      },
      projectKnowledgeEpochs: { 'project-a': 0 },
    };
    await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(t3Manifest)}\n`);
    await expect(readManifest(directory)).resolves.toEqual(t3Manifest);
    expect(authoritativeIntegrityTablesForMigrations(t3Manifest.database.migrations)).toEqual(
      expect.arrayContaining([
        'project_admin.project_knowledge_epoch',
        'project_admin.project_knowledge_reset_requests',
        'canonical.knowledge_reset_events',
        'canonical.t3_reset_owner_snapshots',
        'canonical.t3_reset_owner_snapshot_rows',
        'canonical.history_payload_state',
        'canonical.history_payload_audit_events',
        'frontend_activity.activity_index',
        'frontend_activity.projection_watermarks',
        'frontend_history.history_projection_index',
        'frontend_history.projection_watermarks',
        'knowledge.review_groups',
        'knowledge.entity_vault_imports',
      ]),
    );

    const { projectKnowledgeEpochs: _discardedEpochs, ...missingEpochs } = t3Manifest;
    await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(missingEpochs)}\n`);
    await expect(readManifest(directory)).rejects.toThrow(
      'Backup Manifest Project knowledge epochs do not match its migration identity.',
    );
  });

  it('fails closed when a referenced Original Asset is corrupt or missing', async () => {
    const corrupt = await fixture();
    const corruptAsset = path.join(corrupt.directory, corrupt.manifest.assets.files[0]!.backupPath);
    await writeFile(corruptAsset, 'tampered-asset');
    await expect(verifyBackup(corrupt.directory)).rejects.toThrow(
      'Backup Asset failed verification: original/asset.blob',
    );

    const missing = await fixture();
    const missingAsset = path.join(missing.directory, missing.manifest.assets.files[0]!.backupPath);
    await rm(missingAsset);
    await expect(verifyBackup(missing.directory)).rejects.toThrow();
  });

  it('refuses an in-place restore before touching the Backup or target Asset root', async () => {
    const databaseUrl = 'postgres://shotgun:secret@localhost:5432/shotgun';
    await expect(
      restoreBackup({
        sourceDatabaseUrl: databaseUrl,
        targetDatabaseUrl: databaseUrl,
        targetAssetRoot: path.join(os.tmpdir(), 'must-not-be-created'),
        backupDirectory: path.join(os.tmpdir(), 'missing-backup'),
      }),
    ).rejects.toThrow('Restore target must not be the source Database.');
  });
});
