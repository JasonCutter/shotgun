import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import { Client } from 'pg';

import { sha256Text, stableJson } from '../packages/contracts/src/index.js';
import {
  acquireMaintenanceLock,
  releaseMaintenanceLock,
} from '../adapters/postgres-maintenance-lock/src/index.js';
import {
  createIsolatedPostgresDatabase,
  dropIsolatedPostgresDatabase,
} from './isolated-postgres-database.js';
import {
  assertBackupKnowledgeEpochsAllowed,
  assertErasureJournalOutsideBackupRoot,
  readSourceErasureJournal,
  sourceErasureJournalConfigFromEnvironment,
  verifyBackupKnowledgeEpochBarrier,
  type SourceErasureJournalRecord,
  type SourceErasureJournalConfig,
} from './source-erasure-journal.js';

export const BACKUP_FORMAT_VERSION = 'shotgun-backup-v1';
const DATABASE_DUMP_FILE = 'database.dump';
const MANIFEST_FILE = 'manifest.json';
const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const baseAuthoritativeTables = [
  'runtime.schema_migrations',
  'intake.submissions',
  'asset.original_assets',
  'asset.sources',
  'asset.source_versions',
  'asset.storage_receipts',
  'transformation.revisions',
  'transformation.attempts',
  'evidence.spans',
  'ai.provider_calls',
  'ai.provider_attempts',
  'ai.provider_outputs',
  'candidate.batches',
  'candidate.claim_candidates',
  'candidate.materializations',
  'validation.results',
  'comparison.results',
  'review.change_sets',
  'review.decisions',
  'canonical.project_state',
  'canonical.claims',
  'canonical.commits',
  'canonical.revisions',
  'canonical.history_events',
  'canonical.outbox',
  'knowledge.review_groups',
  'knowledge.entity_vault_imports',
  'auth.principals',
  'auth.credentials',
  'auth.project_memberships',
  'auth.sessions',
  'auth.api_tokens',
  'auth.audit_events',
  'action.candidates',
  'action.preview_snapshots',
  'action.approval_records',
  'action.executions',
  'action.approvals',
  'action.audit_events',
] as const;

const DISCOVERY_FINDING_MIGRATION = '045_akp_2_wp2_discovery_finding_persistence.sql';
const DISCOVERY_LIFECYCLE_MIGRATION = '046_akp_2_wp3_discovery_finding_lifecycle.sql';
const DISCOVERY_MODEL_PROFILE_MIGRATION = '047_akp_3_wp3_discovery_model_profiles.sql';
const DISCOVERY_FEEDBACK_MIGRATION = '055_akp_7_wp1_feedback_suppression_ranking_storage.sql';
const DISCOVERY_SEMANTIC_FAMILY_PROJECTION_MIGRATION =
  '056_akp_7_wp3_semantic_family_projection.sql';
const DISCOVERY_EPISTEMIC_REENTRY_MIGRATION = '057_akp_7_wp4_epistemic_feedback_reentry.sql';
const TYPED_PROPOSITION_CONFLICT_MIGRATION = '058_akp8_typed_proposition_conflict_authority.sql';
const CANONICAL_RELATION_MIGRATION = '059_akp8_canonical_relation_authority.sql';
const WP10_ACTION_REVIEW_DIAGNOSTICS_MIGRATION =
  '065_runtime_data_integrity_wp10_action_review_discovery_diagnostics.sql';
const STAGE5_COMPARISON_V2_MIGRATION = '066_stage5_semantic_comparison_v2_persistence.sql';
const STAGE5_BLOCKED_OUTCOME_MIGRATION = '071_stage5_blocked_outcome_observability.sql';
const STAGE5_COMPARISON_REVIEW_V2_MIGRATION = '067_stage5_comparison_review_v2_persistence.sql';
const ADR163_REVIEW_OPERATION_RESOLUTION_V2_MIGRATION =
  '070_adr163_review_operation_resolution_v2.sql';
const STAGE6_COMPARISON_REVIEW_V2_HANDOFF_MIGRATION = '068_stage6_comparison_review_v2_handoff.sql';
const ACTION_FEEDBACK_OUTBOX_MIGRATION = '074_adr166_stage11_action_feedback_outbox.sql';
const TS5_STAGING_LEASE_MIGRATION = '077_ts5_asset_cas_lifecycle.sql';
const T3_PROJECT_RESET_MIGRATION = '078_t3_project_source_knowledge_reset.sql';
const RESTORE_SECURITY_PROFILE = 'postgres-owners-and-acls-v1' as const;
const T3_CANONICAL_ERASURE_MIGRATION = '101_t3_canonical_erasure.sql';
const FRONTEND_ACTIVITY_MIGRATION = '029_frontend_activity_read_model.sql';
const FRONTEND_HISTORY_MIGRATION = '030_frontend_history_projection.sql';
const KNOWLEDGE_MODEL_MIGRATION = '009_stage9_knowledge_model.sql';

export const authoritativeIntegrityTablesForMigrations = (
  migrations: readonly string[],
): readonly string[] => {
  const applied = new Set(migrations);
  if (
    applied.has(STAGE6_COMPARISON_REVIEW_V2_HANDOFF_MIGRATION) &&
    !applied.has(STAGE5_COMPARISON_REVIEW_V2_MIGRATION)
  ) {
    throw new Error(
      `Backup migration identity is invalid: ${STAGE6_COMPARISON_REVIEW_V2_HANDOFF_MIGRATION} requires ${STAGE5_COMPARISON_REVIEW_V2_MIGRATION}.`,
    );
  }
  if (applied.has(DISCOVERY_LIFECYCLE_MIGRATION) && !applied.has(DISCOVERY_FINDING_MIGRATION)) {
    throw new Error(
      `Backup migration identity is invalid: ${DISCOVERY_LIFECYCLE_MIGRATION} requires ${DISCOVERY_FINDING_MIGRATION}.`,
    );
  }
  if (
    applied.has(DISCOVERY_MODEL_PROFILE_MIGRATION) &&
    !applied.has(DISCOVERY_LIFECYCLE_MIGRATION)
  ) {
    throw new Error(
      `Backup migration identity is invalid: ${DISCOVERY_MODEL_PROFILE_MIGRATION} requires ${DISCOVERY_LIFECYCLE_MIGRATION}.`,
    );
  }
  if (applied.has(DISCOVERY_FEEDBACK_MIGRATION) && !applied.has(DISCOVERY_FINDING_MIGRATION)) {
    throw new Error(
      `Backup migration identity is invalid: ${DISCOVERY_FEEDBACK_MIGRATION} requires ${DISCOVERY_FINDING_MIGRATION}.`,
    );
  }
  if (
    applied.has(DISCOVERY_SEMANTIC_FAMILY_PROJECTION_MIGRATION) &&
    !applied.has(DISCOVERY_FEEDBACK_MIGRATION)
  ) {
    throw new Error(
      `Backup migration identity is invalid: ${DISCOVERY_SEMANTIC_FAMILY_PROJECTION_MIGRATION} requires ${DISCOVERY_FEEDBACK_MIGRATION}.`,
    );
  }
  if (
    applied.has(DISCOVERY_EPISTEMIC_REENTRY_MIGRATION) &&
    !applied.has(DISCOVERY_SEMANTIC_FAMILY_PROJECTION_MIGRATION)
  ) {
    throw new Error(
      `Backup migration identity is invalid: ${DISCOVERY_EPISTEMIC_REENTRY_MIGRATION} requires ${DISCOVERY_SEMANTIC_FAMILY_PROJECTION_MIGRATION}.`,
    );
  }
  if (
    applied.has(TYPED_PROPOSITION_CONFLICT_MIGRATION) &&
    !applied.has(DISCOVERY_EPISTEMIC_REENTRY_MIGRATION)
  ) {
    throw new Error(
      `Backup migration identity is invalid: ${TYPED_PROPOSITION_CONFLICT_MIGRATION} requires ${DISCOVERY_EPISTEMIC_REENTRY_MIGRATION}.`,
    );
  }
  if (
    applied.has(CANONICAL_RELATION_MIGRATION) &&
    !applied.has(TYPED_PROPOSITION_CONFLICT_MIGRATION)
  ) {
    throw new Error(
      `Backup migration identity is invalid: ${CANONICAL_RELATION_MIGRATION} requires ${TYPED_PROPOSITION_CONFLICT_MIGRATION}.`,
    );
  }
  return [
    ...baseAuthoritativeTables,
    ...(applied.has(STAGE5_COMPARISON_V2_MIGRATION)
      ? ['comparison.results_v2', 'comparison.analysis_revisions_v2', 'comparison.relationships_v2']
      : []),
    ...(applied.has(STAGE5_BLOCKED_OUTCOME_MIGRATION) ? ['comparison.blocked_outcomes_v2'] : []),
    ...(applied.has(STAGE5_COMPARISON_REVIEW_V2_MIGRATION)
      ? ['review.change_sets_v2', 'review.decisions_v2', 'review.approved_manifests_v2']
      : []),
    ...(applied.has(ADR163_REVIEW_OPERATION_RESOLUTION_V2_MIGRATION)
      ? ['review.change_set_revisions_v2', 'review.operation_resolutions_v2']
      : []),
    ...(applied.has(DISCOVERY_FINDING_MIGRATION) ? ['discovery.findings'] : []),
    ...(applied.has(DISCOVERY_LIFECYCLE_MIGRATION)
      ? ['discovery.finding_lifecycle_current', 'discovery.finding_lifecycle_history']
      : []),
    ...(applied.has(DISCOVERY_MODEL_PROFILE_MIGRATION) ? ['discovery.model_profiles'] : []),
    ...(applied.has(DISCOVERY_FEEDBACK_MIGRATION)
      ? [
          'discovery.feedback_events',
          'discovery.suppression_directives',
          'discovery.ranking_policy_revisions',
        ]
      : []),
    ...(applied.has(DISCOVERY_EPISTEMIC_REENTRY_MIGRATION)
      ? ['discovery.epistemic_reentry_triggers']
      : []),
    ...(applied.has(TYPED_PROPOSITION_CONFLICT_MIGRATION)
      ? ['knowledge.typed_proposition_conflict_rules', 'knowledge.typed_incompatibility_assertions']
      : []),
    ...(applied.has(CANONICAL_RELATION_MIGRATION)
      ? ['canonical.relations', 'canonical.relation_precursors']
      : []),
    ...(applied.has(WP10_ACTION_REVIEW_DIAGNOSTICS_MIGRATION)
      ? ['action.action_review_work_items', 'discovery.semantic_essence_diagnostics']
      : []),
    ...(applied.has(ACTION_FEEDBACK_OUTBOX_MIGRATION) ? ['action.action_feedback_outbox'] : []),
    ...(applied.has(TS5_STAGING_LEASE_MIGRATION) ? ['asset.staging_asset_leases'] : []),
    ...(applied.has(T3_PROJECT_RESET_MIGRATION)
      ? [
          'project_admin.project_knowledge_epoch',
          'project_admin.project_knowledge_reset_requests',
          'canonical.knowledge_reset_events',
        ]
      : []),
    ...(applied.has(T3_CANONICAL_ERASURE_MIGRATION)
      ? [
          'canonical.t3_reset_owner_snapshots',
          'canonical.t3_reset_owner_snapshot_rows',
          'canonical.history_payload_state',
          'canonical.history_payload_audit_events',
        ]
      : []),
    ...(applied.has(FRONTEND_ACTIVITY_MIGRATION)
      ? ['frontend_activity.activity_index', 'frontend_activity.projection_watermarks']
      : []),
    ...(applied.has(FRONTEND_HISTORY_MIGRATION)
      ? ['frontend_history.history_projection_index', 'frontend_history.projection_watermarks']
      : []),
    ...(applied.has(KNOWLEDGE_MODEL_MIGRATION)
      ? ['knowledge.review_groups', 'knowledge.entity_vault_imports']
      : []),
  ];
};

export type BackupToolMode = 'local' | 'docker-compose';

export type BackupAssetEntry = {
  readonly storageKey: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly backupPath: string;
  readonly backupDigest: string;
};

export type BackupFileEntry = {
  readonly repositoryPath: string;
  readonly backupPath: string;
  readonly sizeBytes: number;
  readonly sha256: string;
};

export type BackupIntegrityEntry = {
  readonly rows: number;
  readonly digest: string;
};

export type BackupManifest = {
  readonly formatVersion: typeof BACKUP_FORMAT_VERSION;
  readonly backupId: string;
  readonly createdAt: string;
  readonly database: {
    readonly engine: 'postgresql';
    readonly majorVersion: 16;
    readonly dumpFormat: 'custom';
    readonly dumpFile: typeof DATABASE_DUMP_FILE;
    readonly dumpSha256: string;
    readonly migrations: readonly string[];
    /** Present when the custom dump preserves database owners and ACLs. */
    readonly restoreSecurityProfile?: typeof RESTORE_SECURITY_PROFILE;
  };
  readonly assets: {
    readonly storage: 'local-content-addressed';
    readonly files: readonly BackupAssetEntry[];
  };
  readonly contracts: {
    readonly files: readonly BackupFileEntry[];
  };
  readonly integrity: {
    readonly tables: Readonly<Record<string, BackupIntegrityEntry>>;
  };
  /** Present when migration 078 is included; absent in historical backups. */
  readonly projectKnowledgeEpochs?: Readonly<Record<string, number>>;
  readonly configuration: {
    readonly secretsIncluded: false;
    readonly projectionAuthority: 'rebuild-from-canonical';
  };
};

export type CreateBackupOptions = {
  readonly databaseUrl: string;
  readonly assetRoot: string;
  readonly outputDirectory: string;
  readonly toolMode?: BackupToolMode;
  readonly postgresService?: string;
  readonly now?: () => string;
};

export type RestoreBackupOptions = {
  readonly sourceDatabaseUrl: string;
  readonly targetDatabaseUrl: string;
  readonly targetAssetRoot: string;
  readonly backupDirectory: string;
  readonly backupRoot?: string;
  readonly toolMode?: BackupToolMode;
  readonly postgresService?: string;
};

type ConnectionEnvironment = {
  readonly database: string;
  readonly values: Readonly<Record<string, string>>;
};

const sha256Bytes = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const sha256File = async (file: string): Promise<string> => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
};

const existingEntries = async (directory: string): Promise<readonly string[]> => {
  try {
    return await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

const ensureEmptyDirectory = async (directory: string, label: string): Promise<void> => {
  const resolved = path.resolve(directory);
  const entries = await existingEntries(resolved);
  if (entries.length > 0) throw new Error(`${label} must be empty: ${resolved}`);
  await mkdir(resolved, { recursive: true });
};

const resolveWithin = (root: string, relativePath: string): string => {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes('..')) {
    throw new Error(`Backup path is not relative: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...relativePath.split('/'));
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Backup path escaped its root: ${relativePath}`);
  }
  return target;
};

const connectionEnvironment = (databaseUrl: string): ConnectionEnvironment => {
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('Only PostgreSQL connection URLs are supported.');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ''));
  if (!database) throw new Error('The PostgreSQL URL must include a database name.');
  const values: Record<string, string> = {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: database,
  };
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode) values.PGSSLMODE = sslMode;
  return { database, values };
};

const sameDatabase = (left: string, right: string): boolean => {
  const a = connectionEnvironment(left).values;
  const b = connectionEnvironment(right).values;
  return ['PGHOST', 'PGPORT', 'PGDATABASE'].every((key) => a[key] === b[key]);
};

type RunPostgresToolOptions = {
  readonly tool: 'pg_dump' | 'pg_restore';
  readonly databaseUrl: string;
  readonly args: readonly string[];
  readonly mode: BackupToolMode;
  readonly postgresService: string;
  readonly inputFile?: string;
  readonly outputFile?: string;
};

const runPostgresTool = async (options: RunPostgresToolOptions): Promise<void> => {
  const connection = connectionEnvironment(options.databaseUrl);
  const childEnvironment = { ...process.env, ...connection.values };
  const executable =
    options.mode === 'local'
      ? options.tool === 'pg_dump'
        ? process.env.PG_DUMP_BIN || 'pg_dump'
        : process.env.PG_RESTORE_BIN || 'pg_restore'
      : 'docker';
  const args =
    options.mode === 'local'
      ? [
          ...(options.tool === 'pg_restore' ? [`--dbname=${connection.database}`] : []),
          ...options.args,
        ]
      : [
          'compose',
          'exec',
          '-T',
          ...Object.keys(connection.values).flatMap((name) => ['-e', name]),
          options.postgresService,
          options.tool,
          ...(options.tool === 'pg_restore' ? [`--dbname=${connection.database}`] : []),
          ...options.args,
        ];
  const child = spawn(executable, args, {
    cwd: rootDirectory,
    env: childEnvironment,
    stdio: [options.inputFile ? 'pipe' : 'ignore', options.outputFile ? 'pipe' : 'ignore', 'pipe'],
    windowsHide: true,
  });
  const stderr: Buffer[] = [];
  const stderrStream = child.stderr;
  if (!stderrStream) throw new Error(`${options.tool} stderr pipe was not created.`);
  stderrStream.on('data', (chunk: Buffer) => stderr.push(chunk));
  const transfers: Promise<unknown>[] = [];
  if (options.inputFile) {
    const input = child.stdin;
    if (!input) throw new Error(`${options.tool} stdin pipe was not created.`);
    transfers.push(pipeline(createReadStream(options.inputFile), input));
  }
  if (options.outputFile) {
    const output = child.stdout;
    if (!output) throw new Error(`${options.tool} stdout pipe was not created.`);
    transfers.push(pipeline(output, createWriteStream(options.outputFile, { flags: 'wx' })));
  }
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
  const transferResults = await Promise.allSettled(transfers);
  if (exitCode !== 0 || transferResults.some((result) => result.status === 'rejected')) {
    const detail = Buffer.concat(stderr).toString('utf8').trim().slice(-2000);
    throw new Error(
      `${options.tool} failed with exit code ${exitCode}.${detail ? ` ${detail}` : ''}`,
    );
  }
};

const withClient = async <T>(databaseUrl: string, action: (client: Client) => Promise<T>) => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
};

export const snapshotAuthoritativeIntegrity = async (
  databaseUrl: string,
  migrations?: readonly string[],
): Promise<Readonly<Record<string, BackupIntegrityEntry>>> =>
  withClient(databaseUrl, async (client) => {
    const appliedMigrations = migrations ?? (await listMigrations(databaseUrl));
    const entries: Record<string, BackupIntegrityEntry> = {};
    for (const table of authoritativeIntegrityTablesForMigrations(appliedMigrations)) {
      const result = await client.query<{ value: unknown }>(
        `SELECT to_jsonb(row_value) AS value FROM ${table} AS row_value`,
      );
      const rows = result.rows
        .map((row) => row.value)
        .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
      entries[table] = { rows: rows.length, digest: sha256Text(stableJson(rows)) };
    }
    return entries;
  });

export const snapshotProjectKnowledgeEpochs = async (
  databaseUrl: string,
  migrations: readonly string[],
): Promise<Readonly<Record<string, number>> | undefined> => {
  if (!migrations.includes(T3_PROJECT_RESET_MIGRATION)) return undefined;
  return withClient(databaseUrl, async (client) => {
    const result = await client.query<{ project_id: string; epoch: string }>(
      `SELECT p.id AS project_id, COALESCE(e.epoch, 0)::text AS epoch
       FROM project_admin.projects AS p
       LEFT JOIN project_admin.project_knowledge_epoch AS e ON e.project_id = p.id
       ORDER BY p.id`,
    );
    return Object.fromEntries(result.rows.map((row) => [row.project_id, Number(row.epoch)]));
  });
};

const verifyKnowledgeEpochsAgainstJournal = async (input: {
  readonly epochs: Readonly<Record<string, number>>;
  readonly journalConfig: SourceErasureJournalConfig | null;
  readonly backupRoot: string;
  readonly journalRequired?: boolean;
}): Promise<readonly SourceErasureJournalRecord[]> => {
  await verifyBackupKnowledgeEpochBarrier({
    backupEpochs: input.epochs,
    config: input.journalConfig,
    backupRoot: input.backupRoot,
    journalRequired: input.journalRequired,
  });
  if (!input.journalConfig) return [];
  const records = await readSourceErasureJournal(input.journalConfig);
  assertBackupKnowledgeEpochsAllowed({ backupEpochs: input.epochs, journalRecords: records });
  return records;
};

const listMigrations = async (databaseUrl: string): Promise<readonly string[]> =>
  withClient(databaseUrl, async (client) => {
    const result = await client.query<{ name: string }>(
      'SELECT name FROM runtime.schema_migrations ORDER BY name',
    );
    return result.rows.map((row) => row.name);
  });

const assertManifestIntegrityTableSet = (manifest: BackupManifest): void => {
  const expected = [
    ...new Set(authoritativeIntegrityTablesForMigrations(manifest.database.migrations)),
  ].sort();
  const actual = Object.keys(manifest.integrity.tables).sort();
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(
      'Backup Manifest integrity tables do not match its recorded migration identity.',
    );
  }
};

const assertPostgresMajorVersion = async (databaseUrl: string, expected = 16): Promise<void> =>
  withClient(databaseUrl, async (client) => {
    const result = await client.query<{ version: string }>(
      "SELECT current_setting('server_version_num') AS version",
    );
    const major = Math.floor(Number(result.rows[0]?.version ?? 0) / 10_000);
    if (major !== expected) {
      throw new Error(`PostgreSQL major version ${expected} is required; found ${major}.`);
    }
  });

export const listReferencedAssets = async (
  databaseUrl: string,
  migrations: readonly string[],
): Promise<readonly { storageKey: string; contentHash: string; sizeBytes: number }[]> =>
  withClient(databaseUrl, async (client) => {
    const query = migrations.includes(TS5_STAGING_LEASE_MIGRATION)
      ? `SELECT storage_key, content_hash, size_bytes::text
         FROM asset.original_assets
         UNION ALL
         SELECT storage_key, content_hash, size_bytes::text
         FROM asset.staging_asset_leases
         WHERE expires_at > clock_timestamp()
         ORDER BY storage_key, content_hash`
      : `SELECT storage_key, content_hash, size_bytes::text
         FROM asset.original_assets ORDER BY storage_key`;
    const result = await client.query<{
      storage_key: string;
      content_hash: string;
      size_bytes: string;
    }>(query);
    const deduplicated = new Map<
      string,
      { storageKey: string; contentHash: string; sizeBytes: number }
    >();
    for (const row of result.rows) {
      const next = {
        storageKey: row.storage_key,
        contentHash: row.content_hash,
        sizeBytes: Number(row.size_bytes),
      };
      const prior = deduplicated.get(next.storageKey);
      if (prior && (prior.contentHash !== next.contentHash || prior.sizeBytes !== next.sizeBytes)) {
        throw new Error(`Backup asset authority disagrees for storage key: ${next.storageKey}`);
      }
      deduplicated.set(next.storageKey, next);
    }
    return [...deduplicated.values()].sort((left, right) =>
      left.storageKey.localeCompare(right.storageKey),
    );
  });

const walkFiles = async (directory: string): Promise<readonly string[]> => {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walkFiles(child)));
    else if (entry.isFile()) result.push(child);
  }
  return result.sort();
};

const contractFiles = async (): Promise<readonly string[]> => {
  const schemas = await walkFiles(path.join(rootDirectory, 'packages', 'contracts', 'schemas'));
  const moduleDirectories = await readdir(path.join(rootDirectory, 'modules'), {
    withFileTypes: true,
  });
  const manifests = moduleDirectories
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDirectory, 'modules', entry.name, 'module-manifest.json'));
  const existingManifests: string[] = [];
  for (const file of manifests) {
    try {
      if ((await stat(file)).isFile()) existingManifests.push(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return [...schemas, ...existingManifests].sort();
};

const copyContracts = async (backupRoot: string): Promise<readonly BackupFileEntry[]> => {
  const files: BackupFileEntry[] = [];
  for (const source of await contractFiles()) {
    const repositoryPath = path.relative(rootDirectory, source).split(path.sep).join('/');
    const backupPath = path.posix.join('contracts', repositoryPath);
    const target = resolveWithin(backupRoot, backupPath);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    const metadata = await stat(target);
    files.push({
      repositoryPath,
      backupPath,
      sizeBytes: metadata.size,
      sha256: await sha256File(target),
    });
  }
  return files;
};

export const copyAssets = async (
  databaseUrl: string,
  assetRoot: string,
  backupRoot: string,
  migrations: readonly string[],
): Promise<readonly BackupAssetEntry[]> => {
  const files: BackupAssetEntry[] = [];
  for (const asset of await listReferencedAssets(databaseUrl, migrations)) {
    const source = resolveWithin(assetRoot, asset.storageKey);
    const bytes = await readFile(source);
    const digest = sha256Bytes(bytes);
    if (digest !== asset.contentHash || bytes.byteLength !== asset.sizeBytes) {
      throw new Error(`Original Asset failed hash or size verification: ${asset.storageKey}`);
    }
    const backupPath = path.posix.join('assets', asset.storageKey);
    const target = resolveWithin(backupRoot, backupPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
    files.push({
      ...asset,
      backupPath,
      backupDigest: digest,
    });
  }
  return files;
};

const createBackupUnlocked = async (options: CreateBackupOptions): Promise<BackupManifest> => {
  const outputDirectory = path.resolve(options.outputDirectory);
  await ensureEmptyDirectory(outputDirectory, 'Backup output directory');
  await assertPostgresMajorVersion(options.databaseUrl);
  const migrations = await listMigrations(options.databaseUrl);
  const before = await snapshotAuthoritativeIntegrity(options.databaseUrl, migrations);
  const dumpFile = path.join(outputDirectory, DATABASE_DUMP_FILE);
  await runPostgresTool({
    tool: 'pg_dump',
    databaseUrl: options.databaseUrl,
    args: ['--format=custom', '--serializable-deferrable'],
    mode: options.toolMode ?? 'local',
    postgresService: options.postgresService ?? 'db',
    outputFile: dumpFile,
  });
  const after = await snapshotAuthoritativeIntegrity(options.databaseUrl, migrations);
  if (stableJson(before) !== stableJson(after)) {
    throw new Error('Authoritative data changed while the backup was being created.');
  }
  const assets = await copyAssets(
    options.databaseUrl,
    path.resolve(options.assetRoot),
    outputDirectory,
    migrations,
  );
  const contracts = await copyContracts(outputDirectory);
  const final = await snapshotAuthoritativeIntegrity(options.databaseUrl, migrations);
  if (stableJson(after) !== stableJson(final)) {
    throw new Error('Authoritative data changed while Backup assets were being copied.');
  }
  const projectKnowledgeEpochs = await snapshotProjectKnowledgeEpochs(
    options.databaseUrl,
    migrations,
  );
  if (projectKnowledgeEpochs) {
    await verifyKnowledgeEpochsAgainstJournal({
      epochs: projectKnowledgeEpochs,
      journalConfig: sourceErasureJournalConfigFromEnvironment(),
      backupRoot: path.dirname(outputDirectory),
      journalRequired: true,
    });
  }
  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    backupId: randomUUID(),
    createdAt: (options.now ?? (() => new Date().toISOString()))(),
    database: {
      engine: 'postgresql',
      majorVersion: 16,
      dumpFormat: 'custom',
      dumpFile: DATABASE_DUMP_FILE,
      dumpSha256: await sha256File(dumpFile),
      migrations,
      ...(migrations.includes(T3_PROJECT_RESET_MIGRATION)
        ? { restoreSecurityProfile: RESTORE_SECURITY_PROFILE }
        : {}),
    },
    assets: { storage: 'local-content-addressed', files: assets },
    contracts: { files: contracts },
    integrity: { tables: after },
    ...(projectKnowledgeEpochs ? { projectKnowledgeEpochs } : {}),
    configuration: {
      secretsIncluded: false,
      projectionAuthority: 'rebuild-from-canonical',
    },
  };
  await writeFile(
    path.join(outputDirectory, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );
  return manifest;
};

export const createBackup = async (options: CreateBackupOptions): Promise<BackupManifest> => {
  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  let acquired = false;
  try {
    acquired = await acquireMaintenanceLock(client, 'shared', true);
    if (!acquired) throw new Error('Backup cannot start while exclusive maintenance is active.');
    return await createBackupUnlocked(options);
  } finally {
    if (acquired) await releaseMaintenanceLock(client, 'shared');
    await client.end();
  }
};

export const readManifest = async (backupDirectory: string): Promise<BackupManifest> => {
  const parsed = JSON.parse(
    await readFile(path.join(path.resolve(backupDirectory), MANIFEST_FILE), 'utf8'),
  ) as BackupManifest;
  if (parsed.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported Backup format: ${String(parsed.formatVersion)}`);
  }
  if (
    parsed.database.migrations.includes(T3_PROJECT_RESET_MIGRATION) &&
    parsed.database.restoreSecurityProfile !== RESTORE_SECURITY_PROFILE
  ) {
    throw new Error(
      'T3 Backup does not declare the owner-and-ACL-preserving restore security profile.',
    );
  }
  const hasT3Migration = parsed.database.migrations.includes(T3_PROJECT_RESET_MIGRATION);
  if (hasT3Migration !== (parsed.projectKnowledgeEpochs !== undefined)) {
    throw new Error(
      'Backup Manifest Project knowledge epochs do not match its migration identity.',
    );
  }
  if (
    parsed.projectKnowledgeEpochs &&
    Object.entries(parsed.projectKnowledgeEpochs).some(
      ([projectId, epoch]) => !projectId || !Number.isSafeInteger(epoch) || epoch < 0,
    )
  ) {
    throw new Error('Backup Manifest contains an invalid Project knowledge epoch.');
  }
  return parsed;
};

export const verifyBackup = async (backupDirectory: string): Promise<BackupManifest> => {
  const root = path.resolve(backupDirectory);
  const manifest = await readManifest(root);
  const dump = resolveWithin(root, manifest.database.dumpFile);
  if ((await sha256File(dump)) !== manifest.database.dumpSha256) {
    throw new Error('Database dump digest does not match the Backup Manifest.');
  }
  for (const file of manifest.assets.files) {
    const target = resolveWithin(root, file.backupPath);
    const metadata = await stat(target);
    if (metadata.size !== file.sizeBytes || (await sha256File(target)) !== file.backupDigest) {
      throw new Error(`Backup Asset failed verification: ${file.storageKey}`);
    }
  }
  for (const file of manifest.contracts.files) {
    const target = resolveWithin(root, file.backupPath);
    const metadata = await stat(target);
    if (metadata.size !== file.sizeBytes || (await sha256File(target)) !== file.sha256) {
      throw new Error(`Backup Contract failed verification: ${file.repositoryPath}`);
    }
  }
  return manifest;
};

const assertEmptyTargetDatabase = async (databaseUrl: string): Promise<void> =>
  withClient(databaseUrl, async (client) => {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM information_schema.tables
       WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`,
    );
    if (result.rows[0]?.count !== '0') {
      throw new Error('Restore target Database must be empty.');
    }
  });

const assertT3RestoreRolesExist = async (databaseUrl: string): Promise<void> =>
  withClient(databaseUrl, async (client) => {
    const requiredRoles = [
      'shotgun_runtime',
      'shotgun_erasure_executor',
      'shotgun_schema_owner',
      'shotgun_migrator',
    ];
    const result = await client.query<{ readonly rolname: string }>(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname',
      [requiredRoles],
    );
    const present = new Set(result.rows.map((row) => row.rolname));
    const missing = requiredRoles.filter((role) => !present.has(role));
    if (missing.length > 0) {
      throw new Error(
        `T3 Backup restore requires these PostgreSQL roles to be provisioned first: ${missing.join(', ')}.`,
      );
    }
  });

export const copyRestoredAssets = async (
  manifest: BackupManifest,
  backupRoot: string,
  targetRoot: string,
): Promise<void> => {
  await ensureEmptyDirectory(targetRoot, 'Restore Asset root');
  for (const file of manifest.assets.files) {
    const source = resolveWithin(backupRoot, file.backupPath);
    const target = resolveWithin(targetRoot, file.storageKey);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
    if ((await sha256File(target)) !== file.contentHash) {
      throw new Error(`Restored Asset failed verification: ${file.storageKey}`);
    }
  }
};

const restoreBackupUnlocked = async (options: RestoreBackupOptions): Promise<BackupManifest> => {
  if (sameDatabase(options.sourceDatabaseUrl, options.targetDatabaseUrl)) {
    throw new Error('Restore target must not be the source Database.');
  }
  const backupDirectory = path.resolve(options.backupDirectory);
  const manifest = await verifyBackup(backupDirectory);
  assertManifestIntegrityTableSet(manifest);
  const journalConfig = sourceErasureJournalConfigFromEnvironment();
  const manifestEpochs = manifest.projectKnowledgeEpochs ?? {};
  const sourceMigrations = await listMigrations(options.sourceDatabaseUrl);
  const journalRequired =
    manifest.database.migrations.includes(T3_PROJECT_RESET_MIGRATION) ||
    sourceMigrations.includes(T3_PROJECT_RESET_MIGRATION);
  const sourceEpochs =
    (await snapshotProjectKnowledgeEpochs(options.sourceDatabaseUrl, sourceMigrations)) ?? {};
  const configuredBackupRoot =
    options.backupRoot ?? process.env.SHOTGUN_BACKUP_ROOT ?? path.dirname(backupDirectory);
  if (journalConfig) {
    await assertErasureJournalOutsideBackupRoot(journalConfig, path.dirname(backupDirectory));
    await assertErasureJournalOutsideBackupRoot(journalConfig, configuredBackupRoot);
  }
  await verifyKnowledgeEpochsAgainstJournal({
    epochs: sourceEpochs,
    journalConfig,
    backupRoot: configuredBackupRoot,
    journalRequired,
  });
  await verifyKnowledgeEpochsAgainstJournal({
    epochs: manifestEpochs,
    journalConfig,
    backupRoot: configuredBackupRoot,
    journalRequired,
  });
  for (const [projectId, backupEpoch] of Object.entries(manifestEpochs)) {
    if ((sourceEpochs[projectId] ?? 0) < backupEpoch) {
      throw new Error('Backup Project knowledge epoch is newer than the active source database.');
    }
  }
  await assertPostgresMajorVersion(options.targetDatabaseUrl, manifest.database.majorVersion);
  if (manifest.database.restoreSecurityProfile === RESTORE_SECURITY_PROFILE) {
    await assertT3RestoreRolesExist(options.targetDatabaseUrl);
  }
  await assertEmptyTargetDatabase(options.targetDatabaseUrl);
  await ensureEmptyDirectory(path.resolve(options.targetAssetRoot), 'Restore Asset root');
  await runPostgresTool({
    tool: 'pg_restore',
    databaseUrl: options.targetDatabaseUrl,
    args: ['--exit-on-error'],
    mode: options.toolMode ?? 'local',
    postgresService: options.postgresService ?? 'db',
    inputFile: resolveWithin(backupDirectory, manifest.database.dumpFile),
  });
  await copyRestoredAssets(manifest, backupDirectory, path.resolve(options.targetAssetRoot));
  const restored = await snapshotAuthoritativeIntegrity(
    options.targetDatabaseUrl,
    manifest.database.migrations,
  );
  if (stableJson(restored) !== stableJson(manifest.integrity.tables)) {
    throw new Error('Restored authoritative data does not match the Backup Manifest.');
  }
  const restoredEpochs =
    (await snapshotProjectKnowledgeEpochs(
      options.targetDatabaseUrl,
      manifest.database.migrations,
    )) ?? {};
  if (
    manifest.projectKnowledgeEpochs &&
    stableJson(restoredEpochs) !== stableJson(manifest.projectKnowledgeEpochs)
  ) {
    throw new Error('Restored Project knowledge epochs do not match the Backup Manifest.');
  }
  await verifyKnowledgeEpochsAgainstJournal({
    epochs: restoredEpochs,
    journalConfig,
    backupRoot: configuredBackupRoot,
    journalRequired: manifest.database.migrations.includes(T3_PROJECT_RESET_MIGRATION),
  });
  await withClient(options.targetDatabaseUrl, async (client) => {
    await client.query(`
      TRUNCATE
        projection.discovery_inferences,
        projection.compiled_truth,
        projection.search_documents,
        projection.watermarks
      CASCADE
    `);
    await client.query('ANALYZE');
  });
  return manifest;
};

export const restoreBackup = async (options: RestoreBackupOptions): Promise<BackupManifest> => {
  if (sameDatabase(options.sourceDatabaseUrl, options.targetDatabaseUrl)) {
    throw new Error('Restore target must not be the source Database.');
  }
  const client = new Client({ connectionString: options.targetDatabaseUrl });
  await client.connect();
  let acquired = false;
  try {
    acquired = await acquireMaintenanceLock(client, 'exclusive', true);
    if (!acquired) throw new Error('Restore cannot start while runtime or backup is active.');
    return await restoreBackupUnlocked(options);
  } finally {
    if (acquired) await releaseMaintenanceLock(client, 'exclusive');
    await client.end();
  }
};

export const createIsolatedRestoreDatabase = async (
  sourceDatabaseUrl: string,
): Promise<{ readonly databaseName: string; readonly databaseUrl: string }> =>
  createIsolatedPostgresDatabase(sourceDatabaseUrl, 'restore');

export const dropIsolatedRestoreDatabase = async (
  sourceDatabaseUrl: string,
  databaseName: string,
): Promise<void> => dropIsolatedPostgresDatabase(sourceDatabaseUrl, 'restore', databaseName);

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const main = async () => {
  const command = process.argv[2];
  const mode = (process.env.SHOTGUN_PG_TOOL_MODE ?? 'local') as BackupToolMode;
  if (!['local', 'docker-compose'].includes(mode)) {
    throw new Error('SHOTGUN_PG_TOOL_MODE must be local or docker-compose.');
  }
  if (command === 'backup') {
    const outputDirectory = argument('--output');
    if (!outputDirectory) throw new Error('backup requires --output <directory>.');
    const manifest = await createBackup({
      databaseUrl: requiredEnvironment('DATABASE_URL'),
      assetRoot: requiredEnvironment('ASSET_STORAGE_ROOT'),
      outputDirectory,
      toolMode: mode,
    });
    console.log(`Backup created: ${manifest.backupId}`);
  } else if (command === 'verify') {
    const backupDirectory = argument('--backup');
    if (!backupDirectory) throw new Error('verify requires --backup <directory>.');
    const manifest = await verifyBackup(backupDirectory);
    console.log(`Backup verified: ${manifest.backupId}`);
  } else if (command === 'restore') {
    const backupDirectory = argument('--backup');
    if (!backupDirectory) throw new Error('restore requires --backup <directory>.');
    const manifest = await restoreBackup({
      sourceDatabaseUrl: requiredEnvironment('DATABASE_URL'),
      targetDatabaseUrl: requiredEnvironment('RESTORE_DATABASE_URL'),
      targetAssetRoot: requiredEnvironment('RESTORE_ASSET_STORAGE_ROOT'),
      backupDirectory,
      backupRoot: process.env.SHOTGUN_BACKUP_ROOT ?? path.dirname(path.resolve(backupDirectory)),
      toolMode: mode,
    });
    console.log(`Backup restored and verified: ${manifest.backupId}`);
  } else {
    throw new Error('Use one of: backup, verify, restore.');
  }
};

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entrypoint === fileURLToPath(import.meta.url)) {
  await main();
}

export const temporaryRestoreAssetRoot = (databaseName: string): string =>
  path.join(os.tmpdir(), databaseName, 'assets');
