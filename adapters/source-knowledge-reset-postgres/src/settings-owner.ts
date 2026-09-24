import type { Pool } from 'pg';

import {
  KnowledgeResetExecutionError,
  type KnowledgeResetOwnerContext,
  type KnowledgeResetOwnerPort,
} from '../../../modules/source-knowledge-reset/src/index.js';

type SettingsImpact = Readonly<{
  sourceDerivedRecordCount: number;
  unclassifiedRecordCount: number;
  fingerprint: string;
  proposalsFingerprint: string;
}>;

type SettingsStatus = Readonly<{
  purgeCompleted: boolean;
  sourceDerivedRecordCount: number;
  remainingSourceResourceCount: number;
  proposalsFingerprint: string;
  expectedProposalsFingerprint: string | null;
}>;

const objectValue = (value: unknown, owner: string): Record<string, unknown> => {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new Error(`${owner} returned malformed JSON.`);
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${owner} returned a malformed object.`);
  }
  return value as Record<string, unknown>;
};

const count = (value: unknown, owner: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${owner} returned an invalid count.`);
  }
  return value;
};

const digest = (value: unknown, _owner: string): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);

const readImpact = async (pool: Pool, projectId: string): Promise<SettingsImpact> => {
  const result = await pool.query<{ impact: unknown }>(
    'SELECT settings.t3_project_settings_impact($1) AS impact',
    [projectId],
  );
  const impact = objectValue(result.rows[0]?.impact, 'Settings impact');
  if (
    !digest(impact.fingerprint, 'Settings impact') ||
    !digest(impact.proposalsFingerprint, 'Settings impact')
  ) {
    throw new Error('Settings impact returned an invalid fingerprint.');
  }
  return {
    sourceDerivedRecordCount: count(impact.sourceDerivedRecordCount, 'Settings impact'),
    unclassifiedRecordCount: count(impact.unclassifiedRecordCount, 'Settings impact'),
    fingerprint: impact.fingerprint,
    proposalsFingerprint: impact.proposalsFingerprint,
  };
};

const readStatus = async (
  pool: Pool,
  context: KnowledgeResetOwnerContext,
): Promise<SettingsStatus> => {
  const result = await pool.query<{ status: unknown }>(
    'SELECT settings.t3_project_settings_status($1, $2::uuid) AS status',
    [context.projectId, context.requestId],
  );
  const status = objectValue(result.rows[0]?.status, 'Settings reset status');
  if (
    typeof status.purgeCompleted !== 'boolean' ||
    !digest(status.proposalsFingerprint, 'Settings reset status') ||
    (status.expectedProposalsFingerprint !== null &&
      !digest(status.expectedProposalsFingerprint, 'Settings reset status'))
  ) {
    throw new Error('Settings reset status returned invalid state.');
  }
  return {
    purgeCompleted: status.purgeCompleted,
    sourceDerivedRecordCount: count(status.sourceDerivedRecordCount, 'Settings reset status'),
    remainingSourceResourceCount: count(
      status.remainingSourceResourceCount,
      'Settings reset status',
    ),
    proposalsFingerprint: status.proposalsFingerprint,
    expectedProposalsFingerprint: status.expectedProposalsFingerprint as string | null,
  };
};

const mapError = (error: unknown): KnowledgeResetExecutionError | undefined => {
  if (typeof error !== 'object' || error === null || !('constraint' in error)) return undefined;
  switch (error.constraint) {
    case 't3_erasure_executor_required':
      return new KnowledgeResetExecutionError(
        'ERASURE_EXECUTOR_UNAVAILABLE',
        'Settings reset requires the dedicated erasure executor.',
      );
    case 't3_settings_unclassified':
      return new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Resource Settings or Settings Review lineage is ambiguous.',
      );
    case 't3_settings_snapshot_stale':
      return new KnowledgeResetExecutionError(
        'STALE_PREVIEW',
        'Settings rows changed after the approved reset preview.',
      );
    case 't3_settings_snapshot_missing':
      return new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Settings fence snapshot is missing during forward recovery.',
        'ERASURE_UNVERIFIED',
      );
    default:
      return undefined;
  }
};

const execute = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    throw mapError(error) ?? error;
  }
};

/** Preserves Project/Auth/AI settings and removes only Source-owned resource settings. */
export class PostgresSettingsKnowledgeResetOwner implements KnowledgeResetOwnerPort {
  readonly ownerId = 'settings' as const;

  constructor(private readonly pool: Pool) {}

  async fence(context: KnowledgeResetOwnerContext): Promise<void> {
    const impact = await execute(() => readImpact(this.pool, context.projectId));
    if (impact.unclassifiedRecordCount > 0) {
      throw new KnowledgeResetExecutionError(
        'UNCLASSIFIED_CONTENT',
        'Settings contain an unscoped resource or Source-linked policy proposal.',
      );
    }
    await execute(() =>
      this.pool.query('SELECT settings.t3_snapshot_project_settings($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async purge(context: KnowledgeResetOwnerContext): Promise<void> {
    await execute(() =>
      this.pool.query('SELECT settings.t3_erase_project_settings($1, $2::uuid)', [
        context.projectId,
        context.requestId,
      ]),
    );
  }

  async rebuild(): Promise<void> {
    // Project, Principal, Membership, AI and independent settings are retained in place.
  }

  async verify(context: KnowledgeResetOwnerContext) {
    const status = await execute(() => readStatus(this.pool, context));
    const verified =
      status.purgeCompleted &&
      status.remainingSourceResourceCount === 0 &&
      status.proposalsFingerprint === status.expectedProposalsFingerprint;
    return {
      verified,
      blockerCodes: verified ? [] : (['UNCLASSIFIED_CONTENT'] as const),
    };
  }
}
