import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import path from 'node:path';

import {
  acquireMaintenanceLock,
  releaseMaintenanceLock,
} from '../adapters/postgres-maintenance-lock/src/index.js';

const STAGING_LEASE_MIGRATION = '077_ts5_asset_cas_lifecycle.sql';
const DAY_MS = 24 * 60 * 60 * 1_000;

export type CasClassification =
  | 'DB_LIVE'
  | 'STAGING_LIVE'
  | 'CAS_UNREFERENCED'
  | 'DB_ORPHAN_ROW'
  | 'CAS_CORRUPT'
  | 'CAS_TEMP'
  | 'CAS_UNKNOWN_PATH'
  | 'TOO_YOUNG';

export type CasCandidate = {
  readonly storageKey: string;
  readonly absolutePath: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly modifiedAtMs: number;
};

export type CasScan = {
  readonly candidates: readonly CasCandidate[];
  readonly corruptCount: number;
  readonly tempCount: number;
  readonly unknownCount: number;
};

export type QuarantineManifestItem = {
  readonly storageKey: string;
  readonly quarantinePath: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
};

export type QuarantineManifest = {
  readonly runId: string;
  readonly quarantinedAt: string;
  readonly recovered?: boolean;
  readonly anomalies?: readonly string[];
  readonly moved: readonly QuarantineManifestItem[];
};

export type GcReport = {
  readonly mode: 'dry-run' | 'apply';
  readonly scannedCanonicalBlobCount: number;
  readonly scannedCanonicalBlobBytes: number;
  readonly finalDbProtectedCount: number;
  readonly activeStagingProtectedCount: number;
  readonly candidateCount: number;
  readonly candidateBytes: number;
  readonly selectedMutationBatchCount: number;
  readonly maxCandidates?: number;
  readonly tooYoungCount: number;
  readonly corruptCount: number;
  readonly tempCount: number;
  readonly unknownCount: number;
  readonly dbAnomalyCount: number;
  readonly legacyCutover: 'NOT_APPLIED' | 'WAITING' | 'OPEN';
  readonly exclusiveMaintenanceAvailable: boolean;
  readonly quarantinedCount: number;
  readonly sweptCount: number;
  readonly expiredLeaseRowsPruned: number;
  readonly auditPath?: string;
};

const digest = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const CANONICAL_STORAGE_KEY = /^original\/sha256\/([a-f0-9]{2})\/([a-f0-9]{64})\.blob$/u;

const isReparseOrSymlink = (entry: { isSymbolicLink(): boolean }): boolean =>
  entry.isSymbolicLink();

const scanDirectory = async (
  directory: string,
  relative: string,
  result: {
    candidates: CasCandidate[];
    corruptCount: number;
    tempCount: number;
    unknownCount: number;
  },
): Promise<void> => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    result.unknownCount += 1;
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (isReparseOrSymlink(entry)) {
      result.unknownCount += 1;
      continue;
    }
    if (entry.isDirectory()) {
      await scanDirectory(absolute, childRelative, result);
      continue;
    }
    if (!entry.isFile()) {
      result.unknownCount += 1;
      continue;
    }
    if (entry.name.endsWith('.tmp')) {
      result.tempCount += 1;
      continue;
    }
    const match = CANONICAL_STORAGE_KEY.exec(childRelative);
    const prefix = match?.[1];
    const hash = match?.[2];
    if (prefix === undefined || hash === undefined || prefix !== hash.slice(0, 2)) {
      result.unknownCount += 1;
      continue;
    }
    try {
      const bytes = await readFile(absolute);
      const metadata = await lstat(absolute);
      const expected = `sha256:${hash}`;
      if (digest(bytes) !== expected) {
        result.corruptCount += 1;
        continue;
      }
      result.candidates.push({
        storageKey: childRelative,
        absolutePath: absolute,
        contentHash: expected,
        sizeBytes: bytes.byteLength,
        modifiedAtMs: metadata.mtimeMs,
      });
    } catch {
      result.corruptCount += 1;
    }
  }
};

export const scanCanonicalCas = async (assetRoot: string): Promise<CasScan> => {
  const result = { candidates: [], corruptCount: 0, tempCount: 0, unknownCount: 0 } as {
    candidates: CasCandidate[];
    corruptCount: number;
    tempCount: number;
    unknownCount: number;
  };
  await scanDirectory(path.resolve(assetRoot), '', result);
  result.candidates.sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  return result;
};

type ProtectedRoots = {
  readonly finalDb: Map<string, { contentHash: string; sizeBytes: number }>;
  readonly staging: Map<string, { contentHash: string; sizeBytes: number }>;
  readonly dbAnomalyCount: number;
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

const databaseNow = async (client: Pick<Client, 'query'>): Promise<Date> => {
  const result = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  const value = result.rows[0]?.now;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error('PostgreSQL clock_timestamp() returned an invalid value.');
  }
  return value;
};

const appliedMigrations = async (
  client: Pick<Client, 'query'>,
): Promise<readonly { name: string; appliedAt: Date }[]> => {
  const result = await client.query<{ name: string; applied_at: Date }>(
    'SELECT name, applied_at FROM runtime.schema_migrations ORDER BY name',
  );
  return result.rows.map((row) => ({ name: row.name, appliedAt: row.applied_at }));
};

const protectedRoots = async (
  client: Pick<Client, 'query'>,
  now: Date,
): Promise<ProtectedRoots> => {
  const finalRows = await client.query<{
    storage_key: string;
    content_hash: string;
    size_bytes: string;
  }>(
    `SELECT storage_key, content_hash, size_bytes::text FROM asset.original_assets ORDER BY storage_key`,
  );
  const finalDb = new Map<string, { contentHash: string; sizeBytes: number }>();
  for (const row of finalRows.rows) {
    const prior = finalDb.get(row.storage_key);
    const next = { contentHash: row.content_hash, sizeBytes: Number(row.size_bytes) };
    if (prior && (prior.contentHash !== next.contentHash || prior.sizeBytes !== next.sizeBytes)) {
      throw new Error(`DB_ORPHAN_ROW authority disagreement for ${row.storage_key}.`);
    }
    finalDb.set(row.storage_key, next);
  }
  const anomalyResult = await client.query<{ count: string }>(
    `SELECT COUNT(*) FILTER (WHERE version.original_asset_id IS NULL)::text AS count
     FROM asset.original_assets AS original
     LEFT JOIN asset.source_versions AS version
       ON version.original_asset_id = original.asset_id`,
  );
  const staging = new Map<string, { contentHash: string; sizeBytes: number }>();
  const migrations = await appliedMigrations(client);
  if (migrations.some((migration) => migration.name === STAGING_LEASE_MIGRATION)) {
    const leases = await client.query<{
      storage_key: string;
      content_hash: string;
      size_bytes: string;
    }>(
      `SELECT storage_key, content_hash, size_bytes::text
       FROM asset.staging_asset_leases WHERE expires_at > $1 ORDER BY storage_key`,
      [now.toISOString()],
    );
    for (const row of leases.rows) {
      const prior = staging.get(row.storage_key);
      const next = { contentHash: row.content_hash, sizeBytes: Number(row.size_bytes) };
      if (prior && (prior.contentHash !== next.contentHash || prior.sizeBytes !== next.sizeBytes)) {
        throw new Error(`STAGING_LIVE authority disagreement for ${row.storage_key}.`);
      }
      staging.set(row.storage_key, next);
    }
  }
  return { finalDb, staging, dbAnomalyCount: Number(anomalyResult.rows[0]?.count ?? 0) };
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RUN_ID = /^[0-9]{17}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const isCanonicalStorageKey = (storageKey: string): boolean => {
  const match = CANONICAL_STORAGE_KEY.exec(storageKey);
  return match !== null && match[1] === match[2]?.slice(0, 2);
};

export const expectedContentHash = (storageKey: string): string => {
  if (!isCanonicalStorageKey(storageKey)) {
    throw new Error(`Invalid canonical storage key: ${storageKey}`);
  }
  const hash = CANONICAL_STORAGE_KEY.exec(storageKey)?.[2];
  if (hash === undefined) throw new Error(`Invalid canonical storage key: ${storageKey}`);
  return `sha256:${hash}`;
};

export const isQuarantineRunId = (runId: string): boolean => RUN_ID.test(runId);

export const assertRunId = (runId: string): void => {
  if (!isQuarantineRunId(runId)) throw new Error(`Invalid quarantine run id: ${runId}`);
};

export const createQuarantineRunId = (now = new Date(), uuid = randomUUID()): string => {
  if (Number.isNaN(now.getTime())) throw new Error('Invalid quarantine run timestamp.');
  if (!UUID_V4.test(uuid)) throw new Error(`Invalid quarantine run UUID: ${uuid}`);
  const timestamp = [
    now.getUTCFullYear().toString().padStart(4, '0'),
    (now.getUTCMonth() + 1).toString().padStart(2, '0'),
    now.getUTCDate().toString().padStart(2, '0'),
    now.getUTCHours().toString().padStart(2, '0'),
    now.getUTCMinutes().toString().padStart(2, '0'),
    now.getUTCSeconds().toString().padStart(2, '0'),
    now.getUTCMilliseconds().toString().padStart(3, '0'),
  ].join('');
  const runId = `${timestamp}-${uuid}`;
  assertRunId(runId);
  return runId;
};

const resolveContained = (root: string, relativePath: string): string => {
  if (path.isAbsolute(relativePath)) throw new Error('Absolute quarantine path is forbidden.');
  const rootPath = path.resolve(root);
  const resolved = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, resolved);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Quarantine path escapes the asset root.');
  }
  return resolved;
};

const quarantinePath = (root: string, runId: string, storageKey: string): string => {
  assertRunId(runId);
  if (!isCanonicalStorageKey(storageKey))
    throw new Error(`Invalid canonical storage key: ${storageKey}`);
  return resolveContained(root, path.join('.gc', 'quarantine', runId, ...storageKey.split('/')));
};

const relativeAssetPath = (root: string, absolutePath: string): string =>
  path.relative(path.resolve(root), absolutePath).split(path.sep).join('/');

const assertNoReparseBoundary = async (root: string, target: string): Promise<void> => {
  const rootPath = path.resolve(root);
  const resolved = path.resolve(target);
  const relative = path.relative(rootPath, resolved);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('Path is outside the asset root.');
  }
  let current = rootPath;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) throw new Error(`Reparse boundary is forbidden: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
};

const quarantineCandidate = async (
  root: string,
  candidate: CasCandidate,
  runId: string,
): Promise<string> => {
  const canonical = resolveContained(root, candidate.storageKey);
  if (path.resolve(candidate.absolutePath) !== canonical) {
    throw new Error('Candidate canonical path identity changed.');
  }
  await assertNoReparseBoundary(root, canonical);
  const metadata = await lstat(canonical);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Candidate canonical path is not a regular file.');
  }
  const bytes = await readFile(canonical);
  if (digest(bytes) !== candidate.contentHash || bytes.byteLength !== candidate.sizeBytes) {
    throw new Error('Candidate canonical bytes changed before quarantine.');
  }
  const target = quarantinePath(root, runId, candidate.storageKey);
  await assertNoReparseBoundary(root, path.dirname(target));
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await lstat(target);
    throw new Error(`Quarantine destination already exists: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await rename(canonical, target);
  return target;
};

const parseDuration = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const match = /^(\d+)(ms|s|m|h|d)$/u.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const units: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: DAY_MS };
  const amount = match[1];
  const unit = match[2];
  if (amount === undefined || unit === undefined) throw new Error(`Invalid duration: ${value}`);
  return Number(amount) * units[unit]!;
};

export type AssetCasGcOptions = {
  readonly databaseUrl: string;
  readonly assetRoot: string;
  readonly apply?: boolean;
  readonly minAgeMs?: number;
  readonly quarantineAgeMs?: number;
  readonly maxCandidates?: number;
  readonly now?: () => Date;
};

export const runAssetCasGc = async (options: AssetCasGcOptions): Promise<GcReport> => {
  const now = options.now ?? (() => new Date());
  const scan = await scanCanonicalCas(options.assetRoot);
  return withClient(options.databaseUrl, async (client) => {
    const migrations = await appliedMigrations(client);
    const migration = migrations.find((entry) => entry.name === STAGING_LEASE_MIGRATION);
    const dbNow = await databaseNow(client);
    const legacyCutover = !migration
      ? 'NOT_APPLIED'
      : dbNow.getTime() < migration.appliedAt.getTime() + 30 * DAY_MS
        ? 'WAITING'
        : 'OPEN';
    const roots = await protectedRoots(client, dbNow);
    const eligible = scan.candidates.filter((candidate) => {
      if (roots.finalDb.has(candidate.storageKey) || roots.staging.has(candidate.storageKey))
        return false;
      if (options.minAgeMs === undefined) return true;
      return now().getTime() - candidate.modifiedAtMs >= options.minAgeMs;
    });
    const tooYoungCount = scan.candidates.filter(
      (candidate) =>
        !roots.finalDb.has(candidate.storageKey) &&
        !roots.staging.has(candidate.storageKey) &&
        options.minAgeMs !== undefined &&
        now().getTime() - candidate.modifiedAtMs < options.minAgeMs,
    ).length;
    let exclusiveMaintenanceAvailable = false;
    let quarantinedCount = 0;
    let selectedMutationBatchCount = 0;
    let sweptCount = 0;
    let expiredLeaseRowsPruned = 0;
    let auditPath: string | undefined;
    if (options.apply) {
      if (legacyCutover !== 'OPEN') throw new Error('Legacy 30-day cutover gate is not open.');
      if (!Number.isFinite(options.minAgeMs) || options.minAgeMs! <= 0) {
        throw new Error('Apply mode requires an explicit positive --min-age.');
      }
      if (!Number.isFinite(options.quarantineAgeMs) || options.quarantineAgeMs! <= 0) {
        throw new Error('Apply mode requires an explicit positive --quarantine-age.');
      }
      if (!Number.isInteger(options.maxCandidates) || options.maxCandidates! <= 0) {
        throw new Error('Apply mode requires an explicit positive --max-candidates.');
      }
      const selectedCandidates = eligible.slice(0, options.maxCandidates);
      selectedMutationBatchCount = selectedCandidates.length;
      exclusiveMaintenanceAvailable = await acquireMaintenanceLock(client, 'exclusive', true);
      if (!exclusiveMaintenanceAvailable)
        throw new Error('Exclusive maintenance lock unavailable.');
      try {
        const lockedDbNow = await databaseNow(client);
        const rechecked = await protectedRoots(client, lockedDbNow);
        const runId = createQuarantineRunId(now());
        const moved: Array<{
          storageKey: string;
          quarantinePath: string;
          contentHash: string;
          sizeBytes: number;
        }> = [];
        for (const candidate of selectedCandidates) {
          if (
            rechecked.finalDb.has(candidate.storageKey) ||
            rechecked.staging.has(candidate.storageKey)
          )
            continue;
          const movedPath = await quarantineCandidate(options.assetRoot, candidate, runId);
          moved.push({
            storageKey: candidate.storageKey,
            quarantinePath: path.relative(options.assetRoot, movedPath).split(path.sep).join('/'),
            contentHash: candidate.contentHash,
            sizeBytes: candidate.sizeBytes,
          });
          quarantinedCount += 1;
        }
        if (migration) {
          const expiredLeases = await client.query(
            'DELETE FROM asset.staging_asset_leases WHERE expires_at <= $1',
            [lockedDbNow.toISOString()],
          );
          expiredLeaseRowsPruned = expiredLeases.rowCount ?? 0;
        }
        if (moved.length > 0) {
          auditPath = path.resolve(options.assetRoot, '.gc', 'quarantine', runId, 'manifest.json');
          await writeFile(
            auditPath,
            `${JSON.stringify({ runId, quarantinedAt: lockedDbNow.toISOString(), moved }, null, 2)}\n`,
            { flag: 'wx' },
          );
        }
      } finally {
        await releaseMaintenanceLock(client, 'exclusive');
      }
      const reacquired = await acquireMaintenanceLock(client, 'exclusive', true);
      if (!reacquired) throw new Error('Exclusive maintenance lock unavailable for final sweep.');
      try {
        sweptCount = await sweepQuarantine(
          options.assetRoot,
          client,
          await databaseNow(client),
          options.quarantineAgeMs!,
        );
      } finally {
        await releaseMaintenanceLock(client, 'exclusive');
      }
    } else {
      exclusiveMaintenanceAvailable = await acquireMaintenanceLock(client, 'exclusive', true);
      if (exclusiveMaintenanceAvailable) await releaseMaintenanceLock(client, 'exclusive');
    }
    return {
      mode: options.apply ? 'apply' : 'dry-run',
      scannedCanonicalBlobCount: scan.candidates.length,
      scannedCanonicalBlobBytes: scan.candidates.reduce(
        (sum, candidate) => sum + candidate.sizeBytes,
        0,
      ),
      finalDbProtectedCount: roots.finalDb.size,
      activeStagingProtectedCount: roots.staging.size,
      candidateCount: eligible.length,
      candidateBytes: eligible.reduce((sum, candidate) => sum + candidate.sizeBytes, 0),
      selectedMutationBatchCount,
      ...(options.maxCandidates === undefined ? {} : { maxCandidates: options.maxCandidates }),
      tooYoungCount,
      corruptCount: scan.corruptCount,
      tempCount: scan.tempCount,
      unknownCount: scan.unknownCount,
      dbAnomalyCount: roots.dbAnomalyCount,
      legacyCutover,
      exclusiveMaintenanceAvailable,
      quarantinedCount,
      sweptCount,
      expiredLeaseRowsPruned,
      ...(auditPath === undefined ? {} : { auditPath }),
    };
  });
};

const recoverManifestlessRun = async (
  root: string,
  runId: string,
  runPath: string,
  now: Date,
): Promise<QuarantineManifest> => {
  const moved: QuarantineManifestItem[] = [];
  const anomalies: string[] = [];
  const walk = async (directory: string, relative: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      anomalies.push(`Unable to scan quarantine entry: ${directory}`);
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        anomalies.push(`Symlink/reparse quarantine entry: ${child}`);
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute, child);
        continue;
      }
      if (!entry.isFile() || child === 'manifest.json') {
        anomalies.push(`Unknown quarantine entry: ${child}`);
        continue;
      }
      const storageKey = child;
      if (!isCanonicalStorageKey(storageKey)) {
        anomalies.push(`Malformed quarantined storage key: ${storageKey}`);
        continue;
      }
      try {
        await assertNoReparseBoundary(root, absolute);
        const bytes = await readFile(absolute);
        const contentHash = expectedContentHash(storageKey);
        if (digest(bytes) !== contentHash) {
          anomalies.push(`Quarantined content hash mismatch: ${storageKey}`);
          continue;
        }
        moved.push({
          storageKey,
          quarantinePath: relativeAssetPath(root, absolute),
          contentHash,
          sizeBytes: bytes.byteLength,
        });
      } catch {
        anomalies.push(`Quarantined entry failed validation: ${storageKey}`);
      }
    }
  };
  await walk(runPath, '');
  const manifest: QuarantineManifest = {
    runId,
    quarantinedAt: now.toISOString(),
    recovered: true,
    ...(anomalies.length === 0 ? {} : { anomalies }),
    moved,
  };
  await writeFile(path.join(runPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
  });
  return manifest;
};

const readQuarantineManifest = async (
  root: string,
  runId: string,
  runPath: string,
  now: Date,
): Promise<QuarantineManifest> => {
  assertRunId(runId);
  const manifestPath = path.join(runPath, 'manifest.json');
  try {
    await assertNoReparseBoundary(root, manifestPath);
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Partial<QuarantineManifest>;
    if (parsed.runId !== runId || typeof parsed.quarantinedAt !== 'string') {
      throw new Error('Malformed quarantine manifest identity.');
    }
    const quarantinedAt = Date.parse(parsed.quarantinedAt);
    if (Number.isNaN(quarantinedAt) || quarantinedAt > now.getTime()) {
      throw new Error('Malformed quarantine manifest timestamp.');
    }
    if (!Array.isArray(parsed.moved)) throw new Error('Malformed quarantine manifest items.');
    const moved = parsed.moved.map((item) => {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof item.storageKey !== 'string' ||
        typeof item.quarantinePath !== 'string' ||
        typeof item.contentHash !== 'string' ||
        !Number.isInteger(item.sizeBytes) ||
        item.sizeBytes <= 0 ||
        !isCanonicalStorageKey(item.storageKey) ||
        !/^sha256:[a-f0-9]{64}$/u.test(item.contentHash) ||
        item.contentHash !== expectedContentHash(item.storageKey)
      ) {
        throw new Error('Malformed quarantine manifest item.');
      }
      const expected = relativeAssetPath(root, quarantinePath(root, runId, item.storageKey));
      if (item.quarantinePath !== expected) {
        throw new Error('Quarantine manifest path does not match its run and storage key.');
      }
      const file = quarantinePath(root, runId, item.storageKey);
      return {
        storageKey: item.storageKey,
        quarantinePath: expected,
        contentHash: item.contentHash,
        sizeBytes: item.sizeBytes,
        file,
      };
    });
    return {
      runId,
      quarantinedAt: parsed.quarantinedAt,
      ...(parsed.recovered === true ? { recovered: true } : {}),
      ...(Array.isArray(parsed.anomalies) ? { anomalies: parsed.anomalies } : {}),
      moved: moved.map((item) => ({
        storageKey: item.storageKey,
        quarantinePath: item.quarantinePath,
        contentHash: item.contentHash,
        sizeBytes: item.sizeBytes,
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return recoverManifestlessRun(root, runId, runPath, now);
    }
    throw error;
  }
};

export const sweepQuarantine = async (
  root: string,
  client: Pick<Client, 'query'>,
  now: Date,
  quarantineAgeMs: number,
): Promise<number> => {
  const quarantineRoot = resolveContained(root, path.join('.gc', 'quarantine'));
  let runs;
  try {
    runs = await readdir(quarantineRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  let deleted = 0;
  for (const run of runs.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!run.isDirectory() || run.isSymbolicLink() || !RUN_ID.test(run.name)) continue;
    const runPath = resolveContained(root, path.join('.gc', 'quarantine', run.name));
    let manifest: QuarantineManifest;
    try {
      manifest = await readQuarantineManifest(root, run.name, runPath, now);
    } catch {
      continue;
    }
    if (now.getTime() - Date.parse(manifest.quarantinedAt) < quarantineAgeMs) continue;
    for (const item of manifest.moved) {
      try {
        const file = quarantinePath(root, run.name, item.storageKey);
        await assertNoReparseBoundary(root, file);
        const bytes = await readFile(file);
        const expected = expectedContentHash(item.storageKey);
        if (
          item.contentHash !== expected ||
          digest(bytes) !== expected ||
          bytes.byteLength !== item.sizeBytes
        )
          continue;
        const roots = await protectedRoots(client, now);
        const canonical = resolveContained(root, item.storageKey);
        await assertNoReparseBoundary(root, canonical);
        const finalRoot = roots.finalDb.get(item.storageKey);
        const stagingRoot = roots.staging.get(item.storageKey);
        for (const [authority, metadata] of [
          ['final', finalRoot],
          ['staging', stagingRoot],
        ] as const) {
          if (
            metadata !== undefined &&
            (metadata.contentHash !== item.contentHash || metadata.sizeBytes !== item.sizeBytes)
          ) {
            throw new Error(`AUTHORITY_IDENTITY_MISMATCH (${authority}): ${item.storageKey}`);
          }
        }
        if (
          finalRoot !== undefined &&
          stagingRoot !== undefined &&
          (finalRoot.contentHash !== stagingRoot.contentHash ||
            finalRoot.sizeBytes !== stagingRoot.sizeBytes)
        ) {
          throw new Error(`AUTHORITY_IDENTITY_MISMATCH (final/staging): ${item.storageKey}`);
        }
        if (finalRoot !== undefined || stagingRoot !== undefined) {
          try {
            const canonicalBytes = await readFile(canonical);
            if (
              digest(canonicalBytes) !== item.contentHash ||
              canonicalBytes.byteLength !== item.sizeBytes
            )
              continue;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue;
            await assertNoReparseBoundary(root, path.dirname(canonical));
            await mkdir(path.dirname(canonical), { recursive: true });
            await rename(file, canonical);
          }
          continue;
        }
        try {
          const canonicalBytes = await readFile(canonical);
          if (
            digest(canonicalBytes) !== item.contentHash ||
            canonicalBytes.byteLength !== item.sizeBytes
          )
            continue;
          continue;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') continue;
        }
        await rm(file, { force: false });
        deleted += 1;
      } catch {
        // Integrity or path anomalies remain report-only and fail closed.
      }
    }
  }
  return deleted;
};

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

if (process.argv[1]?.endsWith('asset-cas-gc.ts')) {
  const databaseUrl = argument('--database-url') ?? process.env.DATABASE_URL;
  const assetRoot = argument('--root') ?? process.env.ASSET_STORAGE_ROOT ?? '.data/assets';
  if (!databaseUrl) throw new Error('DATABASE_URL or --database-url is required.');
  const apply = process.argv.includes('--apply');
  const report = await runAssetCasGc({
    databaseUrl,
    assetRoot,
    apply,
    minAgeMs: parseDuration(argument('--min-age')),
    quarantineAgeMs: parseDuration(argument('--quarantine-age')),
    maxCandidates:
      argument('--max-candidates') === undefined
        ? undefined
        : Number.parseInt(argument('--max-candidates')!, 10),
  });
  console.log(JSON.stringify(report, null, 2));
}
