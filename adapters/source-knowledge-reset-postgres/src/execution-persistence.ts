import type { Pool } from 'pg';

import type { KnowledgeResetExecutionRepositoryPort } from '../../../modules/source-knowledge-reset/src/execution.js';
import type {
  KnowledgeResetBlockerCodeV1,
  KnowledgeResetRequestV1,
  KnowledgeResetStateV1,
} from '../../../modules/source-knowledge-reset/src/index.js';

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject => {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new Error('T3 execution persistence returned malformed JSON.');
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('T3 execution persistence returned a malformed object.');
  }
  return value as JsonObject;
};

const asCheckpointRecord = (value: unknown): JsonObject => {
  try {
    return asObject(value);
  } catch {
    return {};
  }
};

const toRequest = (value: unknown): KnowledgeResetRequestV1 => {
  const row = asObject(value);
  const checkpoints = asCheckpointRecord(row.step_checkpoints);
  const ownerDigest = row.owner_manifest_digest;
  const preservedDigest = row.preserved_configuration_digest;
  const completedAt = row.completed_at;
  const state = row.state;
  const createdAt = row.created_at;
  const updatedAt = row.updated_at;
  if (
    typeof row.request_id !== 'string' ||
    typeof row.project_id !== 'string' ||
    typeof row.project_revision !== 'number' ||
    typeof row.manifest_digest !== 'string' ||
    typeof state !== 'string' ||
    typeof createdAt !== 'string' ||
    typeof updatedAt !== 'string'
  ) {
    throw new Error('T3 execution persistence request identity is malformed.');
  }
  return {
    schemaVersion: '1.0.0',
    requestId: row.request_id,
    projectId: row.project_id,
    projectRevision: row.project_revision,
    manifestDigest: row.manifest_digest as `sha256:${string}`,
    ...(typeof ownerDigest === 'string'
      ? { ownerManifestDigest: ownerDigest as `sha256:${string}` }
      : {}),
    ...(typeof preservedDigest === 'string'
      ? { preservedConfigurationDigest: preservedDigest as `sha256:${string}` }
      : {}),
    state: state as KnowledgeResetStateV1,
    expectedKnowledgeEpoch: Number(row.expected_knowledge_epoch),
    knowledgeEpoch: Number(row.resulting_knowledge_epoch),
    blockerCodes: (row.blocker_codes ?? []) as KnowledgeResetBlockerCodeV1[],
    counts: asObject(row.impact_counts) as KnowledgeResetRequestV1['counts'],
    completedSteps: Object.entries(checkpoints)
      .filter(([, done]) => done === true)
      .map(([step]) => step)
      .sort(),
    casStatus:
      checkpoints.casStatus === 'COMPLETE'
        ? 'COMPLETE'
        : checkpoints.casStatus === 'QUARANTINED_PENDING_SWEEP'
          ? 'QUARANTINED_PENDING_SWEEP'
          : checkpoints.casStatus === 'BLOCKED'
            ? 'BLOCKED'
            : 'NOT_STARTED',
    backupStatus:
      checkpoints.backupStatus === 'COMPLETE'
        ? 'COMPLETE'
        : checkpoints.backupStatus === 'BLOCKED'
          ? 'BLOCKED'
          : 'PENDING',
    createdAt,
    updatedAt,
    ...(typeof completedAt === 'string' ? { completedAt } : {}),
  };
};

const isRequestCheckpoint = (step: string): boolean =>
  step === 'manifest:approved-impact' ||
  /^(?:fence|purge|rebuild|verify):[a-z-]{1,80}$/u.test(step);

/** Control-plane writes are available only through migration-owned routines. */
export class PostgresKnowledgeResetExecutorPersistence implements KnowledgeResetExecutionRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async readForExecution(input: { projectId: string; requestId: string }) {
    const result = await this.pool.query<{ snapshot: unknown }>(
      'SELECT project_admin.t3_read_reset_execution_snapshot($1, $2::uuid) AS snapshot',
      [input.projectId, input.requestId],
    );
    const snapshotValue = result.rows[0]?.snapshot;
    if (snapshotValue === undefined || snapshotValue === null) return null;
    const snapshot = asObject(snapshotValue);
    const request = toRequest(snapshot.request);
    return { request, completedSteps: request.completedSteps };
  }

  async setExecutionState(input: {
    projectId: string;
    requestId: string;
    state: KnowledgeResetStateV1;
    blockerCodes: readonly KnowledgeResetBlockerCodeV1[];
  }): Promise<void> {
    await this.pool.query(
      'SELECT project_admin.t3_set_reset_execution_state($1, $2::uuid, $3, $4::text[])',
      [input.projectId, input.requestId, input.state, [...new Set(input.blockerCodes)]],
    );
  }

  async markExecutionStepComplete(input: {
    projectId: string;
    requestId: string;
    step: string;
  }): Promise<void> {
    if (!isRequestCheckpoint(input.step)) {
      throw new Error('Source knowledge reset checkpoint identity is invalid.');
    }
    await this.pool.query(
      'SELECT project_admin.t3_checkpoint_reset_execution_step($1, $2::uuid, $3)',
      [input.projectId, input.requestId, input.step],
    );
  }

  async markExecutionComplete(input: {
    projectId: string;
    requestId: string;
  }): Promise<KnowledgeResetRequestV1> {
    const result = await this.pool.query<{ request: unknown }>(
      'SELECT project_admin.t3_complete_reset_execution($1, $2::uuid) AS request',
      [input.projectId, input.requestId],
    );
    const request = result.rows[0]?.request;
    if (request === undefined || request === null) {
      throw new Error('Completed T3 reset request was not returned.');
    }
    return toRequest(request);
  }
}
