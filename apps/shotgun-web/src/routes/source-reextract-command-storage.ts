/**
 * Browser recovery identity for SourceVersion candidate re-extraction.
 *
 * Only opaque request identities and their exact target are persisted. The
 * Product command itself remains server-authoritative, and the identity is
 * removed only after a terminally resolved result.
 */

export type PendingSourceReextractCommandIdentityV1 = {
  readonly schemaVersion: '1.0.0';
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
};

export const PENDING_SOURCE_REEXTRACT_COMMAND_PREFIX = 'shotgun:source-reextract-command:v1:';

export type PendingCommandStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export const pendingSourceReextractCommandStorageKey = (
  projectId: string,
  sourceId: string,
  sourceVersionId: string,
): string =>
  `${PENDING_SOURCE_REEXTRACT_COMMAND_PREFIX}${encodeURIComponent(projectId)}:${encodeURIComponent(sourceId)}:${encodeURIComponent(sourceVersionId)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const decodePendingSourceReextractCommandIdentity = (
  value: unknown,
): PendingSourceReextractCommandIdentityV1 | null => {
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
    !nonEmptyString(parsed.clientRequestId) ||
    !nonEmptyString(parsed.idempotencyKey)
  ) {
    return null;
  }
  return {
    schemaVersion: '1.0.0',
    projectId: parsed.projectId,
    sourceId: parsed.sourceId,
    sourceVersionId: parsed.sourceVersionId,
    clientRequestId: parsed.clientRequestId,
    idempotencyKey: parsed.idempotencyKey,
  };
};

export const readPendingSourceReextractCommandIdentity = (
  storage: PendingCommandStorage,
  projectId: string,
  sourceId: string,
  sourceVersionId: string,
): PendingSourceReextractCommandIdentityV1 | null => {
  const key = pendingSourceReextractCommandStorageKey(projectId, sourceId, sourceVersionId);
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const decoded = decodePendingSourceReextractCommandIdentity(raw);
  if (
    decoded === null ||
    decoded.projectId !== projectId ||
    decoded.sourceId !== sourceId ||
    decoded.sourceVersionId !== sourceVersionId
  ) {
    storage.removeItem(key);
    return null;
  }
  return decoded;
};

export const writePendingSourceReextractCommandIdentity = (
  storage: PendingCommandStorage,
  identity: PendingSourceReextractCommandIdentityV1,
): void => {
  storage.setItem(
    pendingSourceReextractCommandStorageKey(
      identity.projectId,
      identity.sourceId,
      identity.sourceVersionId,
    ),
    JSON.stringify(identity),
  );
};

export const clearPendingSourceReextractCommandIdentity = (
  storage: PendingCommandStorage,
  projectId: string,
  sourceId: string,
  sourceVersionId: string,
): void => {
  storage.removeItem(pendingSourceReextractCommandStorageKey(projectId, sourceId, sourceVersionId));
};

export const getSourceReextractCommandStorage = (): PendingCommandStorage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};
