export const semanticEmbeddingCredentialReplacementStorageKey =
  'shotgun:semantic-embedding-credential-replacement:v1';

export type PendingSemanticEmbeddingCredentialReplacementV1 = {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly providerId: string;
  readonly embeddingModelId: string;
  readonly clientRequestId: string;
  readonly operation: 'REPLACE';
  readonly credentialId: string;
  readonly expectedRevision: number;
};

const storage = (): Storage | undefined => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isPendingIdentity = (
  value: unknown,
): value is PendingSemanticEmbeddingCredentialReplacementV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 1 &&
    nonEmptyString(candidate.projectId) &&
    nonEmptyString(candidate.providerId) &&
    nonEmptyString(candidate.embeddingModelId) &&
    nonEmptyString(candidate.clientRequestId) &&
    candidate.operation === 'REPLACE' &&
    nonEmptyString(candidate.credentialId) &&
    Number.isSafeInteger(candidate.expectedRevision) &&
    (candidate.expectedRevision as number) > 0
  );
};

export const readPendingSemanticEmbeddingCredentialReplacement = (
  projectId: string,
): PendingSemanticEmbeddingCredentialReplacementV1 | undefined => {
  const target = storage();
  if (!target) return undefined;
  try {
    const raw = target.getItem(semanticEmbeddingCredentialReplacementStorageKey);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isPendingIdentity(parsed) && parsed.projectId === projectId ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const writePendingSemanticEmbeddingCredentialReplacement = (
  identity: PendingSemanticEmbeddingCredentialReplacementV1,
): void => {
  const target = storage();
  if (!target) return;
  try {
    target.setItem(semanticEmbeddingCredentialReplacementStorageKey, JSON.stringify(identity));
  } catch {
    // Recovery remains best-effort when the browser disables session storage.
  }
};

export const clearPendingSemanticEmbeddingCredentialReplacement = (
  identity?: PendingSemanticEmbeddingCredentialReplacementV1,
): void => {
  const target = storage();
  if (!target) return;
  try {
    if (!identity) {
      target.removeItem(semanticEmbeddingCredentialReplacementStorageKey);
      return;
    }
    const current = readPendingSemanticEmbeddingCredentialReplacement(identity.projectId);
    if (current?.clientRequestId === identity.clientRequestId) {
      target.removeItem(semanticEmbeddingCredentialReplacementStorageKey);
    }
  } catch {
    // Clearing is best-effort; no secret is stored in this record.
  }
};

export class SemanticEmbeddingCredentialReplacementOutcomeIndeterminateError extends Error {
  readonly code = 'OUTCOME_INDETERMINATE';

  constructor() {
    super('The previous embedding credential replacement could not be confirmed.');
    this.name = 'SemanticEmbeddingCredentialReplacementOutcomeIndeterminateError';
  }
}
