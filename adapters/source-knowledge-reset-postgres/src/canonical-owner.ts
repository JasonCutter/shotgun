import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

const STATUS_KEYS = [
  'sourceDerivedRecordCount',
  'unclassifiedRecordCount',
  'redactedIdentityCount',
  'activeOutboxCount',
  'canonicalVersion',
  'canonicalSnapshotDigest',
  'fingerprint',
  'resetEventCount',
  'resetEventStateVersion',
  'resetEventEmptyDigest',
  'resetEventManifestDigest',
] as const;

type Status = Readonly<{
  sourceDerivedRecordCount: number;
  unclassifiedRecordCount: number;
  redactedIdentityCount: number;
  activeOutboxCount: number;
  canonicalVersion: number;
  canonicalSnapshotDigest: string | null;
  fingerprint: string;
  resetEventCount: number;
  resetEventStateVersion: number | null;
  resetEventEmptyDigest: string | null;
  resetEventManifestDigest: string | null;
}>;

const isDigest = (value: unknown): value is string =>
  typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);

const optionalDigest = (value: unknown): value is string | null =>
  value === null || isDigest(value);

const readStatus = async (pool: Pool, context: KnowledgeResetOwnerContext): Promise<Status> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT canonical.t3_project_canonical_status($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  let value = result.rows[0]?.status;
  if (typeof value === 'string') value = JSON.parse(value) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Canonical status routine returned a malformed object.');
  }
  const status = value as Record<string, unknown>;
  const countKeys = [
    'sourceDerivedRecordCount',
    'unclassifiedRecordCount',
    'redactedIdentityCount',
    'activeOutboxCount',
    'canonicalVersion',
    'resetEventCount',
  ] as const;
  if (
    Object.keys(status).length !== STATUS_KEYS.length ||
    countKeys.some(
      (key) =>
        typeof status[key] !== 'number' ||
        !Number.isSafeInteger(status[key]) ||
        (status[key] as number) < 0,
    ) ||
    typeof status.fingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(status.fingerprint) ||
    !optionalDigest(status.canonicalSnapshotDigest) ||
    !optionalDigest(status.resetEventEmptyDigest) ||
    !optionalDigest(status.resetEventManifestDigest) ||
    (status.resetEventStateVersion !== null &&
      (typeof status.resetEventStateVersion !== 'number' ||
        !Number.isSafeInteger(status.resetEventStateVersion) ||
        status.resetEventStateVersion < 1))
  ) {
    throw new Error('Canonical status routine returned malformed counts or digests.');
  }
  return status as Status;
};

const mapDatabaseError = (error: unknown): KnowledgeResetExecutionError | undefined => {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  const constraint = error.constraint;
  if (constraint === 'active_job_outcome_unknown') {
    return new KnowledgeResetExecutionError(
      'ACTIVE_JOB_OUTCOME_UNKNOWN',
      'Canonical event delivery must reach a known terminal state.',
    );
  }
  if (constraint === 't3_canonical_unclassified') {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Canonical claim, relation, or history lineage is incomplete.',
    );
  }
  if (constraint === 't3_canonical_state_version_stale') {
    return new KnowledgeResetExecutionError(
      'STALE_PREVIEW',
      'Canonical state changed after the approved reset preview.',
    );
  }
  if (
    constraint === 't3_canonical_snapshot_missing' ||
    constraint === 't3_canonical_state_version_exhausted'
  ) {
    return new KnowledgeResetExecutionError(
      'UNCLASSIFIED_CONTENT',
      'Canonical reset approval or monotonic state version is unavailable.',
      'ERASURE_UNVERIFIED',
    );
  }
  if (constraint === 't3_erasure_executor_required') {
    return new KnowledgeResetExecutionError(
      'ERASURE_EXECUTOR_UNAVAILABLE',
      'Canonical reset requires the dedicated erasure executor.',
    );
  }
  return undefined;
};

const execute = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    throw mapDatabaseError(error) ?? error;
  }
};

/** Erases Source-derived Canonical knowledge and records one empty-state reset event. */
export class PostgresCanonicalKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'canonical' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT canonical.t3_snapshot_project_canonical($1, $2::uuid, $3)', [
        context.projectId,
        context.requestId,
        context.manifestDigest,
      ]),
    );
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT canonical.t3_erase_project_canonical($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async rebuild(): Promise<void> {
    // Projection owners rebuild from the empty Canonical state after this owner advances it.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await execute(() => readStatus(this.pool, context));
    const verified =
      status.sourceDerivedRecordCount === 0 &&
      status.unclassifiedRecordCount === 0 &&
      status.activeOutboxCount === 0 &&
      status.resetEventCount === 1 &&
      status.resetEventStateVersion === status.canonicalVersion &&
      status.resetEventEmptyDigest === status.canonicalSnapshotDigest &&
      status.resetEventManifestDigest === context.manifestDigest;
    return {
      verified,
      blockerCodes: verified
        ? []
        : status.activeOutboxCount > 0
          ? (['ACTIVE_JOB_OUTCOME_UNKNOWN'] as const)
          : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
