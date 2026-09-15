/**
 * Browser recovery identity for an explicit initial V2 Candidate recompare.
 *
 * Only the opaque idempotency key and its exact target are persisted. Candidate
 * text and all server-owned comparison/security state stay out of storage.
 */

export type PendingSourceRecompareCommandIdentityV1 = {
  readonly schemaVersion: '1.0.0';
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly candidateId: string;
  readonly idempotencyKey: string;
};

export const PENDING_SOURCE_RECOMPARE_COMMAND_PREFIX = 'shotgun:source-recompare-command:v1:';

export type SourceRecompareCommandStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export const pendingSourceRecompareCommandStorageKey = (
  projectId: string,
  sourceId: string,
  sourceVersionId: string,
  candidateId: string,
): string =>
  `${PENDING_SOURCE_RECOMPARE_COMMAND_PREFIX}${encodeURIComponent(projectId)}:${encodeURIComponent(sourceId)}:${encodeURIComponent(sourceVersionId)}:${encodeURIComponent(candidateId)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const decodePendingSourceRecompareCommandIdentity = (
  value: unknown,
): PendingSourceRecompareCommandIdentityV1 | null => {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (
    parsed.schemaVersion !== '1.0.0' ||
    !nonEmptyString(parsed.projectId) ||
    !nonEmptyString(parsed.sourceId) ||
    !nonEmptyString(parsed.sourceVersionId) ||
    !nonEmptyString(parsed.candidateId) ||
    !nonEmptyString(parsed.idempotencyKey)
  ) {
    return null;
  }
  return {
    schemaVersion: '1.0.0',
    projectId: parsed.projectId,
    sourceId: parsed.sourceId,
    sourceVersionId: parsed.sourceVersionId,
    candidateId: parsed.candidateId,
    idempotencyKey: parsed.idempotencyKey,
  };
};

export const readPendingSourceRecompareCommandIdentity = (
  storage: SourceRecompareCommandStorage,
  projectId: string,
  sourceId: string,
  sourceVersionId: string,
  candidateId: string,
): PendingSourceRecompareCommandIdentityV1 | null => {
  const key = pendingSourceRecompareCommandStorageKey(
    projectId,
    sourceId,
    sourceVersionId,
    candidateId,
  );
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const decoded = decodePendingSourceRecompareCommandIdentity(raw);
  if (
    decoded === null ||
    decoded.projectId !== projectId ||
    decoded.sourceId !== sourceId ||
    decoded.sourceVersionId !== sourceVersionId ||
    decoded.candidateId !== candidateId
  ) {
    storage.removeItem(key);
    return null;
  }
  return decoded;
};

export const writePendingSourceRecompareCommandIdentity = (
  storage: SourceRecompareCommandStorage,
  identity: PendingSourceRecompareCommandIdentityV1,
): void => {
  storage.setItem(
    pendingSourceRecompareCommandStorageKey(
      identity.projectId,
      identity.sourceId,
      identity.sourceVersionId,
      identity.candidateId,
    ),
    JSON.stringify(identity),
  );
};

export const clearPendingSourceRecompareCommandIdentity = (
  storage: SourceRecompareCommandStorage,
  projectId: string,
  sourceId: string,
  sourceVersionId: string,
  candidateId: string,
): void => {
  storage.removeItem(
    pendingSourceRecompareCommandStorageKey(projectId, sourceId, sourceVersionId, candidateId),
  );
};

export const getSourceRecompareCommandStorage = (): SourceRecompareCommandStorage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

export const newSourceRecompareIdentity = (
  projectId: string,
  sourceId: string,
  sourceVersionId: string,
  candidateId: string,
): PendingSourceRecompareCommandIdentityV1 => ({
  schemaVersion: '1.0.0',
  projectId,
  sourceId,
  sourceVersionId,
  candidateId,
  idempotencyKey:
    typeof crypto.randomUUID === 'function'
      ? `source-recompare:${crypto.randomUUID()}`
      : `source-recompare:${Date.now()}:${Math.random().toString(16).slice(2)}`,
});
