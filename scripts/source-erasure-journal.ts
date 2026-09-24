import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm, rmdir, lstat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type SourceErasureJournalPhase = 'PREPARED' | 'VERIFIED';

export type SourceErasureJournalConfig = Readonly<{
  root: string;
  hmacKey: string;
}>;

export type SourceErasureJournalRecord = Readonly<{
  schemaVersion: '1.0.0';
  sequence: number;
  previousHmac: `sha256:${string}` | null;
  projectId: string;
  knowledgeEpoch: number;
  requestId: string;
  phase: SourceErasureJournalPhase;
  recordedAt: string;
  hmac: `sha256:${string}`;
}>;

export class SourceErasureJournalError extends Error {
  constructor(
    readonly code:
      | 'ERASURE_JOURNAL_CONFIG_INVALID'
      | 'ERASURE_JOURNAL_UNAVAILABLE'
      | 'ERASURE_JOURNAL_LOCKED'
      | 'ERASURE_JOURNAL_CORRUPT'
      | 'ERASURE_JOURNAL_TRANSITION_INVALID'
      | 'ERASURE_JOURNAL_PATH_OVERLAP'
      | 'BACKUP_KNOWLEDGE_EPOCH_STALE',
    message: string,
  ) {
    super(message);
    this.name = 'SourceErasureJournalError';
  }
}

const JOURNAL_FILE = 'source-erasure-journal.jsonl';
const LOCK_DIRECTORY = '.source-erasure-journal.lock';
const KEY_MINIMUM_BYTES = 32;

const fail = (
  code: SourceErasureJournalError['code'],
  message: string,
): SourceErasureJournalError => new SourceErasureJournalError(code, message);

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
};

const isWithin = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
};

const resolvedPath = async (value: string, allowMissing: boolean): Promise<string> => {
  let cursor = path.resolve(value);
  const suffix: string[] = [];
  while (true) {
    try {
      const existingParent = await realpath(cursor);
      return path.resolve(existingParent, ...suffix.reverse());
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
};

const validateConfig = (config: SourceErasureJournalConfig): void => {
  if (!path.isAbsolute(config.root)) {
    throw fail('ERASURE_JOURNAL_CONFIG_INVALID', 'Erasure journal root must be absolute.');
  }
  if (Buffer.byteLength(config.hmacKey, 'utf8') < KEY_MINIMUM_BYTES) {
    throw fail(
      'ERASURE_JOURNAL_CONFIG_INVALID',
      `Erasure journal HMAC key must contain at least ${KEY_MINIMUM_BYTES} bytes.`,
    );
  }
};

export const sourceErasureJournalConfigFromEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): SourceErasureJournalConfig | null => {
  const root = environment.SHOTGUN_ERASURE_JOURNAL_ROOT?.trim();
  const hmacKey = environment.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY;
  if (!root && !hmacKey) return null;
  if (!root || !hmacKey) {
    throw fail(
      'ERASURE_JOURNAL_CONFIG_INVALID',
      'Both SHOTGUN_ERASURE_JOURNAL_ROOT and SHOTGUN_ERASURE_JOURNAL_HMAC_KEY are required.',
    );
  }
  const config = { root, hmacKey };
  validateConfig(config);
  return config;
};

const ensureRoot = async (config: SourceErasureJournalConfig): Promise<string> => {
  validateConfig(config);
  await mkdir(path.resolve(config.root), { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(config.root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw fail('ERASURE_JOURNAL_CONFIG_INVALID', 'Erasure journal root must be a real directory.');
  }
  return realpath(config.root);
};

export const assertErasureJournalOutsideBackupRoot = async (
  config: SourceErasureJournalConfig,
  backupRoot: string,
): Promise<void> => {
  const journalRoot = await ensureRoot(config);
  const resolvedBackupRoot = await resolvedPath(backupRoot, true);
  if (isWithin(journalRoot, resolvedBackupRoot) || isWithin(resolvedBackupRoot, journalRoot)) {
    throw fail(
      'ERASURE_JOURNAL_PATH_OVERLAP',
      'Erasure journal root and backup root must be separate trees.',
    );
  }
};

const journalPathFor = (root: string): string => path.join(root, JOURNAL_FILE);

const ensureJournalFile = async (root: string, create: boolean): Promise<string> => {
  const journalPath = journalPathFor(root);
  try {
    const info = await lstat(journalPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw fail('ERASURE_JOURNAL_CONFIG_INVALID', 'Erasure journal must be a regular file.');
    }
    return journalPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) {
      if (error instanceof SourceErasureJournalError) throw error;
      throw fail('ERASURE_JOURNAL_UNAVAILABLE', 'Initialized erasure journal file is unavailable.');
    }
    const handle = await open(journalPath, 'wx', 0o600);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return journalPath;
  }
};

export const initializeSourceErasureJournal = async (
  config: SourceErasureJournalConfig,
  backupRoot: string,
): Promise<void> => {
  await assertErasureJournalOutsideBackupRoot(config, backupRoot);
  const root = await ensureRoot(config);
  await ensureJournalFile(root, true);
};

type UnsignedRecord = Omit<SourceErasureJournalRecord, 'hmac'>;

const signatureFor = (payload: UnsignedRecord, key: string): `sha256:${string}` =>
  `sha256:${createHmac('sha256', key).update(stableJson(payload)).digest('hex')}`;

const unsigned = (record: SourceErasureJournalRecord): UnsignedRecord => ({
  schemaVersion: record.schemaVersion,
  sequence: record.sequence,
  previousHmac: record.previousHmac,
  projectId: record.projectId,
  knowledgeEpoch: record.knowledgeEpoch,
  requestId: record.requestId,
  phase: record.phase,
  recordedAt: record.recordedAt,
});

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  return stableJson(actual) === stableJson([...expected].sort());
};

const validRecordShape = (value: unknown): value is SourceErasureJournalRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    exactKeys(record, [
      'schemaVersion',
      'sequence',
      'previousHmac',
      'projectId',
      'knowledgeEpoch',
      'requestId',
      'phase',
      'recordedAt',
      'hmac',
    ]) &&
    record.schemaVersion === '1.0.0' &&
    Number.isSafeInteger(record.sequence) &&
    (record.previousHmac === null ||
      (typeof record.previousHmac === 'string' &&
        /^sha256:[a-f0-9]{64}$/u.test(record.previousHmac))) &&
    typeof record.projectId === 'string' &&
    record.projectId.length > 0 &&
    Number.isSafeInteger(record.knowledgeEpoch) &&
    Number(record.knowledgeEpoch) > 0 &&
    typeof record.requestId === 'string' &&
    record.requestId.length > 0 &&
    record.requestId.length <= 200 &&
    (record.phase === 'PREPARED' || record.phase === 'VERIFIED') &&
    typeof record.recordedAt === 'string' &&
    !Number.isNaN(Date.parse(record.recordedAt)) &&
    typeof record.hmac === 'string' &&
    /^sha256:[a-f0-9]{64}$/u.test(record.hmac)
  );
};

const readAndVerifyRecords = async (
  journalPath: string,
  key: string,
): Promise<readonly SourceErasureJournalRecord[]> => {
  let contents: string;
  try {
    contents = await readFile(journalPath, 'utf8');
  } catch {
    throw fail('ERASURE_JOURNAL_UNAVAILABLE', 'Erasure journal could not be read.');
  }
  if (contents.length === 0) return [];
  if (!contents.endsWith('\n')) {
    throw fail('ERASURE_JOURNAL_CORRUPT', 'Erasure journal ends with an incomplete record.');
  }
  const lines = contents.slice(0, -1).split('\n');
  const records: SourceErasureJournalRecord[] = [];
  let previousHmac: `sha256:${string}` | null = null;
  for (const [index, line] of lines.entries()) {
    let candidate: unknown;
    try {
      candidate = JSON.parse(line) as unknown;
    } catch {
      throw fail('ERASURE_JOURNAL_CORRUPT', `Erasure journal record ${index + 1} is invalid JSON.`);
    }
    if (!validRecordShape(candidate)) {
      throw fail(
        'ERASURE_JOURNAL_CORRUPT',
        `Erasure journal record ${index + 1} has an invalid shape.`,
      );
    }
    const expected = signatureFor(unsigned(candidate), key);
    const actualBytes = Buffer.from(candidate.hmac.slice('sha256:'.length), 'hex');
    const expectedBytes = Buffer.from(expected.slice('sha256:'.length), 'hex');
    if (
      candidate.sequence !== index + 1 ||
      candidate.previousHmac !== previousHmac ||
      actualBytes.byteLength !== expectedBytes.byteLength ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      throw fail(
        'ERASURE_JOURNAL_CORRUPT',
        `Erasure journal record ${index + 1} failed sequence or HMAC verification.`,
      );
    }
    records.push(candidate);
    previousHmac = candidate.hmac;
  }
  return records;
};

export const readSourceErasureJournal = async (
  config: SourceErasureJournalConfig,
): Promise<readonly SourceErasureJournalRecord[]> => {
  const root = await ensureRoot(config);
  const journalPath = await ensureJournalFile(root, false);
  return readAndVerifyRecords(journalPath, config.hmacKey);
};

type LockOwner = Readonly<{ pid: number; hostname: string; lockId: string }>;

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
};

const acquireJournalLock = async (root: string): Promise<() => Promise<void>> => {
  const lockPath = path.join(root, LOCK_DIRECTORY);
  const owner: LockOwner = { pid: process.pid, hostname: os.hostname(), lockId: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      const ownerPath = path.join(lockPath, 'owner.json');
      const handle = await open(ownerPath, 'wx', 0o600);
      try {
        await handle.writeFile(`${stableJson(owner)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      return async () => {
        await rm(ownerPath, { force: false });
        await rmdir(lockPath);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw fail('ERASURE_JOURNAL_UNAVAILABLE', 'Could not acquire erasure journal lock.');
      }
      let prior: LockOwner;
      try {
        prior = JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8')) as LockOwner;
      } catch {
        throw fail('ERASURE_JOURNAL_LOCKED', 'Erasure journal lock needs owner recovery.');
      }
      if (
        prior.hostname !== os.hostname() ||
        !Number.isSafeInteger(prior.pid) ||
        typeof prior.lockId !== 'string' ||
        processIsAlive(prior.pid)
      ) {
        throw fail('ERASURE_JOURNAL_LOCKED', 'Another process holds the erasure journal lock.');
      }
      const stalePath = path.join(root, `${LOCK_DIRECTORY}.stale-${randomUUID()}`);
      try {
        await rename(lockPath, stalePath);
        await rm(stalePath, { recursive: true, force: false });
      } catch {
        throw fail('ERASURE_JOURNAL_LOCKED', 'Stale erasure journal lock could not be recovered.');
      }
    }
  }
  throw fail('ERASURE_JOURNAL_LOCKED', 'Erasure journal lock acquisition did not converge.');
};

export const appendSourceErasureJournalRecord = async (
  input: Readonly<{
    config: SourceErasureJournalConfig;
    backupRoot: string;
    projectId: string;
    knowledgeEpoch: number;
    requestId: string;
    phase: SourceErasureJournalPhase;
    now?: () => Date;
  }>,
): Promise<SourceErasureJournalRecord> => {
  if (!input.projectId || !input.requestId || input.requestId.length > 200) {
    throw fail('ERASURE_JOURNAL_CONFIG_INVALID', 'Erasure journal identity is invalid.');
  }
  if (!Number.isSafeInteger(input.knowledgeEpoch) || input.knowledgeEpoch <= 0) {
    throw fail(
      'ERASURE_JOURNAL_CONFIG_INVALID',
      'Erasure journal epoch must be a positive integer.',
    );
  }
  await assertErasureJournalOutsideBackupRoot(input.config, input.backupRoot);
  const root = await ensureRoot(input.config);
  const journalPath = await ensureJournalFile(root, false);
  const release = await acquireJournalLock(root);
  try {
    const records = await readAndVerifyRecords(journalPath, input.config.hmacKey);
    const sameRequest = records.filter((record) => record.requestId === input.requestId);
    if (
      sameRequest.some(
        (record) =>
          record.projectId !== input.projectId || record.knowledgeEpoch !== input.knowledgeEpoch,
      )
    ) {
      throw fail(
        'ERASURE_JOURNAL_TRANSITION_INVALID',
        'Reset request identity conflicts with its journal record.',
      );
    }
    const samePhase = sameRequest.find((record) => record.phase === input.phase);
    if (samePhase) return samePhase;
    const prepared = sameRequest.find((record) => record.phase === 'PREPARED');
    if (input.phase === 'VERIFIED' && !prepared) {
      throw fail(
        'ERASURE_JOURNAL_TRANSITION_INVALID',
        'VERIFIED requires a durable PREPARED record.',
      );
    }
    const previousHmac = records.at(-1)?.hmac ?? null;
    const payload: UnsignedRecord = {
      schemaVersion: '1.0.0',
      sequence: records.length + 1,
      previousHmac,
      projectId: input.projectId,
      knowledgeEpoch: input.knowledgeEpoch,
      requestId: input.requestId,
      phase: input.phase,
      recordedAt: (input.now ?? (() => new Date()))().toISOString(),
    };
    const record: SourceErasureJournalRecord = {
      ...payload,
      hmac: signatureFor(payload, input.config.hmacKey),
    };
    const handle = await open(journalPath, 'a');
    try {
      await handle.writeFile(`${stableJson(record)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return record;
  } finally {
    await release();
  }
};

export const assertBackupKnowledgeEpochsAllowed = (
  input: Readonly<{
    backupEpochs: Readonly<Record<string, number>>;
    journalRecords: readonly SourceErasureJournalRecord[];
  }>,
): void => {
  const byRequest = new Map<string, SourceErasureJournalRecord[]>();
  const byProjectEpoch = new Map<string, Map<number, SourceErasureJournalRecord[]>>();
  for (const record of input.journalRecords) {
    const requestRecords = byRequest.get(record.requestId) ?? [];
    requestRecords.push(record);
    byRequest.set(record.requestId, requestRecords);
    const projectEpochs =
      byProjectEpoch.get(record.projectId) ?? new Map<number, SourceErasureJournalRecord[]>();
    const epochRecords = projectEpochs.get(record.knowledgeEpoch) ?? [];
    epochRecords.push(record);
    projectEpochs.set(record.knowledgeEpoch, epochRecords);
    byProjectEpoch.set(record.projectId, projectEpochs);
  }

  for (const [requestId, records] of byRequest) {
    const prepared = records.find((record) => record.phase === 'PREPARED');
    const verified = records.find((record) => record.phase === 'VERIFIED');
    if (!prepared || !verified || prepared.sequence >= verified.sequence) {
      throw fail(
        'BACKUP_KNOWLEDGE_EPOCH_STALE',
        `Reset request ${requestId} does not have a completed erasure journal transition.`,
      );
    }
  }

  const projects = new Set([...Object.keys(input.backupEpochs), ...byProjectEpoch.keys()]);
  for (const projectId of projects) {
    const backupEpoch = input.backupEpochs[projectId] ?? 0;
    if (!Number.isSafeInteger(backupEpoch) || backupEpoch < 0) {
      throw fail(
        'BACKUP_KNOWLEDGE_EPOCH_STALE',
        'Backup contains an invalid Project knowledge epoch.',
      );
    }
    const journalEpochs =
      byProjectEpoch.get(projectId) ?? new Map<number, SourceErasureJournalRecord[]>();
    const journalMaximum = Math.max(0, ...journalEpochs.keys());
    if (backupEpoch < journalMaximum) {
      throw fail(
        'BACKUP_KNOWLEDGE_EPOCH_STALE',
        `Backup knowledge epoch is older than the external reset journal for Project ${projectId}.`,
      );
    }
    for (let epoch = 1; epoch <= backupEpoch; epoch += 1) {
      const transitions = journalEpochs.get(epoch) ?? [];
      if (
        transitions.filter((record) => record.phase === 'VERIFIED').length !== 1 ||
        transitions.filter((record) => record.phase === 'PREPARED').length !== 1
      ) {
        throw fail(
          'BACKUP_KNOWLEDGE_EPOCH_STALE',
          `Project ${projectId} knowledge epoch ${epoch} lacks a unique verified reset record.`,
        );
      }
    }
  }
};

export const verifyBackupKnowledgeEpochBarrier = async (
  input: Readonly<{
    backupEpochs: Readonly<Record<string, number>>;
    config: SourceErasureJournalConfig | null;
    backupRoot: string;
    journalRequired?: boolean;
  }>,
): Promise<void> => {
  if (!input.config) {
    if (input.journalRequired || Object.values(input.backupEpochs).some((epoch) => epoch > 0)) {
      throw fail(
        'BACKUP_KNOWLEDGE_EPOCH_STALE',
        'External erasure journal configuration is required for T3 backup and restore operations.',
      );
    }
    return;
  }
  await assertErasureJournalOutsideBackupRoot(input.config, input.backupRoot);
  const records = await readSourceErasureJournal(input.config);
  assertBackupKnowledgeEpochsAllowed({ backupEpochs: input.backupEpochs, journalRecords: records });
};

export const backupEpochsFromEnvironment = (input: {
  readonly root: string;
  readonly hmacKey: string;
}): SourceErasureJournalConfig => {
  const config = { root: input.root, hmacKey: input.hmacKey };
  validateConfig(config);
  return config;
};
