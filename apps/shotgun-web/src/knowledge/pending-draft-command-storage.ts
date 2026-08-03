/**
 * Pending FE-P3-S2 Knowledge Draft command identity persistence.
 *
 * Only the original command identity is persisted to sessionStorage so an
 * OUTCOME_UNKNOWN command can be recovered after a page reload. The Draft
 * content and operations are NEVER stored (ADR-119 MVP). The entry is scoped
 * by sessionId + projectId + draftId so it can never be applied to another
 * Session / Project / Draft, and recovery resolves by the original identity
 * without ever resubmitting the Save command.
 */

export type PendingKnowledgeDraftCommandIdentityV1 = {
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly semanticDigest: string;
  readonly sessionId: string;
  readonly projectId: string;
  readonly draftId: string;
};

export const PENDING_KNOWLEDGE_DRAFT_COMMAND_PREFIX = 'shotgun:draft-command:v1:';

export const pendingKnowledgeDraftCommandStorageKey = (
  sessionId: string,
  projectId: string,
  draftId: string,
): string => `${PENDING_KNOWLEDGE_DRAFT_COMMAND_PREFIX}${sessionId}:${projectId}:${draftId}`;

export type PendingCommandStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'> & {
  readonly length?: number;
  readonly key?: (index: number) => string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const decodePendingKnowledgeDraftCommandIdentity = (
  value: unknown,
): PendingKnowledgeDraftCommandIdentityV1 | null => {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (
    !nonEmptyString(parsed.clientRequestId) ||
    !nonEmptyString(parsed.idempotencyKey) ||
    !nonEmptyString(parsed.semanticDigest) ||
    !nonEmptyString(parsed.sessionId) ||
    !nonEmptyString(parsed.projectId) ||
    !nonEmptyString(parsed.draftId)
  ) {
    return null;
  }
  return {
    clientRequestId: parsed.clientRequestId,
    idempotencyKey: parsed.idempotencyKey,
    semanticDigest: parsed.semanticDigest,
    sessionId: parsed.sessionId,
    projectId: parsed.projectId,
    draftId: parsed.draftId,
  };
};

export const encodePendingKnowledgeDraftCommandIdentity = (
  identity: PendingKnowledgeDraftCommandIdentityV1,
): string => JSON.stringify(identity);

export const readPendingKnowledgeDraftCommandIdentity = (
  storage: PendingCommandStorage,
  sessionId: string,
  projectId: string,
  draftId: string,
): PendingKnowledgeDraftCommandIdentityV1 | null => {
  const key = pendingKnowledgeDraftCommandStorageKey(sessionId, projectId, draftId);
  const raw = storage.getItem(key);
  if (raw === null) return null;
  const decoded = decodePendingKnowledgeDraftCommandIdentity(raw);
  // A malformed entry is dropped defensively instead of being used.
  if (decoded === null) {
    storage.removeItem(key);
    return null;
  }
  return decoded;
};

export const writePendingKnowledgeDraftCommandIdentity = (
  storage: PendingCommandStorage,
  identity: PendingKnowledgeDraftCommandIdentityV1,
): void => {
  storage.setItem(
    pendingKnowledgeDraftCommandStorageKey(
      identity.sessionId,
      identity.projectId,
      identity.draftId,
    ),
    encodePendingKnowledgeDraftCommandIdentity(identity),
  );
};

export const clearPendingKnowledgeDraftCommandIdentity = (
  storage: PendingCommandStorage,
  sessionId: string,
  projectId: string,
  draftId: string,
): void => {
  storage.removeItem(pendingKnowledgeDraftCommandStorageKey(sessionId, projectId, draftId));
};

/** Clears every pending Draft command identity (used on logout). */
export const clearAllPendingKnowledgeDraftCommandIdentities = (
  storage: PendingCommandStorage,
): void => {
  if (typeof storage.key !== 'function' || storage.length === undefined) return;
  const keysToRemove: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && key.startsWith(PENDING_KNOWLEDGE_DRAFT_COMMAND_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) storage.removeItem(key);
};
