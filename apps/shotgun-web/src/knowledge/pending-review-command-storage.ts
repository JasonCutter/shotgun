import type { ReviewCommandIdentityV1 } from './review-command-identity.js';

/**
 * FE-P4-S1 pending Review command identity storage (ADR-119/ADR-101).
 *
 * Only the command identity (clientRequestId / idempotencyKey / semantic
 * digest) is persisted — never decision content. The server Ledger is the
 * recovery authority; a reload resolves OUTCOME_UNKNOWN through this identity
 * and never resubmits the decision with a new key.
 */

export const PENDING_REVIEW_COMMAND_PREFIX = 'shotgun:review-command:v1:';

export const pendingReviewCommandStorageKey = (
  sessionId: string,
  projectId: string,
  reviewContextId: string,
  contextRevision: number,
): string =>
  `${PENDING_REVIEW_COMMAND_PREFIX}${sessionId}:${projectId}:${reviewContextId}:${contextRevision}`;

export const decodePendingReviewCommandIdentity = (
  value: unknown,
): ReviewCommandIdentityV1 | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.clientRequestId !== 'string' ||
    record.clientRequestId.length === 0 ||
    typeof record.idempotencyKey !== 'string' ||
    record.idempotencyKey.length === 0 ||
    typeof record.semanticDigest !== 'string' ||
    record.semanticDigest.length === 0
  ) {
    return null;
  }
  return {
    clientRequestId: record.clientRequestId,
    idempotencyKey: record.idempotencyKey,
    semanticDigest: record.semanticDigest,
  };
};

export const readPendingReviewCommandIdentity = (
  storage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>,
  key: string,
): ReviewCommandIdentityV1 | null => {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return decodePendingReviewCommandIdentity(JSON.parse(raw));
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // storage unavailable: recovery falls back to the in-memory state
    }
    return null;
  }
};

export const writePendingReviewCommandIdentity = (
  storage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>,
  key: string,
  identity: ReviewCommandIdentityV1,
): void => {
  try {
    storage.setItem(key, JSON.stringify(identity));
  } catch {
    // storage unavailable: recovery falls back to the in-memory state
  }
};

export const clearPendingReviewCommandIdentity = (
  storage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>,
  key: string,
): void => {
  try {
    storage.removeItem(key);
  } catch {
    // storage unavailable: nothing to clear
  }
};

export const clearAllPendingReviewCommandIdentities = (storage: Storage): void => {
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && key.startsWith(PENDING_REVIEW_COMMAND_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // storage unavailable: nothing to clear
  }
};
