import type { Pool, QueryResultRow } from 'pg';

import {
  assertDiscoveryRuntimeLifecycleTransitionV1,
  assertDiscoveryRuntimeStageTransitionV1,
  decodeDiscoveryAttemptV1,
  decodeDiscoveryJobV1,
  decodeDiscoveryLogicalJobIdentityV1,
  decodeDiscoveryRunV1,
  decodeDiscoveryStageV1,
  type DiscoveryAttemptV1,
  type DiscoveryJobV1,
  type DiscoveryProjectionWaitBindingV1,
  type DiscoveryRunV1,
  type DiscoveryStageV1,
} from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import type {
  DiscoveryRuntimeJobLookupV1,
  DiscoveryRuntimeJobTransitionInputV1,
  DiscoveryRuntimeLogicalJobLookupV1,
  DiscoveryRuntimeRepositoryPort,
  DiscoveryRuntimeStageLookupV1,
  DiscoveryRuntimeStageTransitionInputV1,
} from '../../../modules/discovery-runtime/src/index.js';

type RuntimeJobRow = QueryResultRow & {
  project_id: string;
  job_id: string;
  logical_job_identity: string;
  logical_job_identity_version: string;
  schema_version: string;
  trigger_id: string;
  trigger_class: string;
  trigger: unknown;
  requested_mode: string;
  effective_mode: string;
  canonical_base_version: number;
  canonical_snapshot_digest: string;
  required_projection_revision: string | null;
  required_projection_digest: string | null;
  policy_revision: string;
  strategy_revision: string;
  profile_id: string | null;
  profile_revision: number | null;
  budget_version: string;
  budget_id: string;
  budget_revision: string;
  budget: unknown;
  lifecycle_state: string;
  lifecycle_revision: number;
  wait_projection_revision: string | null;
  wait_projection_digest: string | null;
  wait_deadline_at: Date | null;
  wait_fallback_policy_revision: string | null;
  created_at: Date;
  updated_at: Date;
};

type RuntimeRunRow = QueryResultRow & {
  project_id: string;
  run_id: string;
  job_id: string;
  run_revision: number;
  schema_version: string;
  requested_mode: string;
  effective_mode: string;
  canonical_base_version: number;
  canonical_snapshot_digest: string;
  required_projection_revision: string | null;
  required_projection_digest: string | null;
  policy_revision: string;
  strategy_revision: string;
  profile_id: string | null;
  profile_revision: number | null;
  budget_version: string;
  budget_id: string;
  budget_revision: string;
  budget: unknown;
  lifecycle_state: string;
  lifecycle_revision: number;
  wait_projection_revision: string | null;
  wait_projection_digest: string | null;
  wait_deadline_at: Date | null;
  wait_fallback_policy_revision: string | null;
  created_at: Date;
  updated_at: Date;
};

type RuntimeAttemptRow = QueryResultRow & {
  project_id: string;
  attempt_id: string;
  run_id: string;
  job_id: string;
  attempt_number: number;
  attempt_revision: number;
  attempt_kind: string;
  lifecycle_state: string;
  previous_attempt_id: string | null;
  schema_version: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

type RuntimeStageRow = QueryResultRow & {
  project_id: string;
  stage_id: string;
  run_id: string;
  attempt_id: string;
  job_id: string;
  stage_ordinal: number;
  stage_type: string;
  stage_revision: number;
  state: string;
  schema_version: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

const jobColumns = `
  project_id, job_id, logical_job_identity, logical_job_identity_version,
  schema_version, trigger_id, trigger_class, trigger, requested_mode,
  effective_mode, canonical_base_version, canonical_snapshot_digest,
  required_projection_revision, required_projection_digest, policy_revision,
  strategy_revision, profile_id, profile_revision, budget_version, budget_id,
  budget_revision, budget, lifecycle_state, lifecycle_revision,
  wait_projection_revision, wait_projection_digest, wait_deadline_at,
  wait_fallback_policy_revision, created_at, updated_at`;

const runColumns = `
  project_id, run_id, job_id, run_revision, schema_version, requested_mode,
  effective_mode, canonical_base_version, canonical_snapshot_digest,
  required_projection_revision, required_projection_digest, policy_revision,
  strategy_revision, profile_id, profile_revision, budget_version, budget_id,
  budget_revision, budget, lifecycle_state, lifecycle_revision,
  wait_projection_revision, wait_projection_digest, wait_deadline_at,
  wait_fallback_policy_revision, created_at, updated_at`;

const attemptColumns = `
  project_id, attempt_id, run_id, job_id, attempt_number, attempt_revision,
  attempt_kind, lifecycle_state, previous_attempt_id, schema_version,
  created_at, updated_at, completed_at`;

const stageColumns = `
  project_id, stage_id, run_id, attempt_id, job_id, stage_ordinal, stage_type,
  stage_revision, state, schema_version, created_at, updated_at, completed_at`;

const dateValue = (value: Date): string => value.toISOString();

const waitValues = (
  wait: DiscoveryProjectionWaitBindingV1 | undefined,
): [string | null, string | null, string | null, string | null] => [
  wait?.requiredDiscoveryBase.projectionRevision ?? null,
  wait?.requiredDiscoveryBase.projectionDigest ?? null,
  wait?.waitDeadlineAt ?? null,
  wait?.fallbackPolicyRevision ?? null,
];

const waitFromRow = (row: {
  wait_projection_revision: string | null;
  wait_projection_digest: string | null;
  wait_deadline_at: Date | null;
  wait_fallback_policy_revision: string | null;
}): DiscoveryProjectionWaitBindingV1 | undefined => {
  const values = [
    row.wait_projection_revision,
    row.wait_projection_digest,
    row.wait_deadline_at,
    row.wait_fallback_policy_revision,
  ];
  if (values.every((value) => value === null)) return undefined;
  if (values.some((value) => value === null)) {
    throw new TypeError('Discovery projection wait binding is incomplete');
  }
  return {
    requiredDiscoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: row.wait_projection_revision!,
      projectionDigest: row.wait_projection_digest!,
    },
    waitDeadlineAt: dateValue(row.wait_deadline_at!),
    fallbackPolicyRevision: row.wait_fallback_policy_revision!,
  };
};

const profileValues = (
  profile: DiscoveryJobV1['profileBinding'],
): [number | null, string | null] => [profile?.profileRevision ?? null, profile?.profileId ?? null];

const mapJob = (row: RuntimeJobRow): DiscoveryJobV1 =>
  decodeDiscoveryJobV1({
    schemaVersion: row.schema_version,
    jobId: row.job_id,
    logicalIdentity: {
      schemaVersion: row.schema_version,
      identityVersion: row.logical_job_identity_version,
      value: row.logical_job_identity,
    },
    projectId: row.project_id,
    trigger: row.trigger,
    requestedMode: row.requested_mode,
    effectiveMode: row.effective_mode,
    canonicalBase: {
      schemaVersion: row.schema_version,
      canonicalVersion: row.canonical_base_version,
      snapshotDigest: row.canonical_snapshot_digest,
    },
    ...(row.required_projection_revision === null
      ? {}
      : {
          requiredDiscoveryBase: {
            schemaVersion: row.schema_version,
            projectionRevision: row.required_projection_revision,
            projectionDigest: row.required_projection_digest!,
          },
        }),
    policyRevision: row.policy_revision,
    strategyRevision: row.strategy_revision,
    ...(row.profile_id === null
      ? {}
      : { profileBinding: { profileId: row.profile_id, profileRevision: row.profile_revision! } }),
    budget: {
      schemaVersion: row.schema_version,
      budgetVersion: row.budget_version,
      budgetId: row.budget_id,
      budgetRevision: row.budget_revision,
      ...(row.budget as Record<string, unknown>),
    },
    lifecycleState: row.lifecycle_state,
    lifecycleRevision: row.lifecycle_revision,
    ...(waitFromRow(row) === undefined ? {} : { projectionWait: waitFromRow(row) }),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
  });

const mapRun = (row: RuntimeRunRow): DiscoveryRunV1 =>
  decodeDiscoveryRunV1({
    schemaVersion: row.schema_version,
    runId: row.run_id,
    jobId: row.job_id,
    projectId: row.project_id,
    runRevision: row.run_revision,
    requestedMode: row.requested_mode,
    effectiveMode: row.effective_mode,
    canonicalBase: {
      schemaVersion: row.schema_version,
      canonicalVersion: row.canonical_base_version,
      snapshotDigest: row.canonical_snapshot_digest,
    },
    ...(row.required_projection_revision === null
      ? {}
      : {
          requiredDiscoveryBase: {
            schemaVersion: row.schema_version,
            projectionRevision: row.required_projection_revision,
            projectionDigest: row.required_projection_digest!,
          },
        }),
    policyRevision: row.policy_revision,
    strategyRevision: row.strategy_revision,
    ...(row.profile_id === null
      ? {}
      : { profileBinding: { profileId: row.profile_id, profileRevision: row.profile_revision! } }),
    budget: {
      schemaVersion: row.schema_version,
      budgetVersion: row.budget_version,
      budgetId: row.budget_id,
      budgetRevision: row.budget_revision,
      ...(row.budget as Record<string, unknown>),
    },
    lifecycleState: row.lifecycle_state,
    lifecycleRevision: row.lifecycle_revision,
    ...(waitFromRow(row) === undefined ? {} : { projectionWait: waitFromRow(row) }),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
  });

const mapAttempt = (row: RuntimeAttemptRow): DiscoveryAttemptV1 =>
  decodeDiscoveryAttemptV1({
    schemaVersion: row.schema_version,
    attemptId: row.attempt_id,
    jobId: row.job_id,
    runId: row.run_id,
    projectId: row.project_id,
    attemptNumber: row.attempt_number,
    attemptRevision: row.attempt_revision,
    attemptKind: row.attempt_kind,
    lifecycleState: row.lifecycle_state,
    ...(row.previous_attempt_id === null ? {} : { previousAttemptId: row.previous_attempt_id }),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
    ...(row.completed_at === null ? {} : { completedAt: dateValue(row.completed_at) }),
  });

const mapStage = (row: RuntimeStageRow): DiscoveryStageV1 =>
  decodeDiscoveryStageV1({
    schemaVersion: row.schema_version,
    stageId: row.stage_id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    jobId: row.job_id,
    projectId: row.project_id,
    stageOrdinal: row.stage_ordinal,
    stageType: row.stage_type,
    stageRevision: row.stage_revision,
    state: row.state,
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
    ...(row.completed_at === null ? {} : { completedAt: dateValue(row.completed_at) }),
  });

const jobInsertValues = (job: DiscoveryJobV1): unknown[] => {
  const [profileRevision, profileId] = profileValues(job.profileBinding);
  const [waitProjectionRevision, waitProjectionDigest, waitDeadlineAt, waitFallbackPolicyRevision] =
    waitValues(job.projectionWait);
  return [
    job.projectId,
    job.jobId,
    job.logicalIdentity.value,
    job.logicalIdentity.identityVersion,
    job.schemaVersion,
    job.trigger.triggerId,
    job.trigger.triggerClass,
    JSON.stringify(job.trigger),
    job.requestedMode,
    job.effectiveMode,
    job.canonicalBase.canonicalVersion,
    job.canonicalBase.snapshotDigest,
    job.requiredDiscoveryBase?.projectionRevision ?? null,
    job.requiredDiscoveryBase?.projectionDigest ?? null,
    job.policyRevision,
    job.strategyRevision,
    profileId,
    profileRevision,
    job.budget.budgetVersion,
    job.budget.budgetId,
    job.budget.budgetRevision,
    JSON.stringify(job.budget),
    job.lifecycleState,
    job.lifecycleRevision,
    waitProjectionRevision,
    waitProjectionDigest,
    waitDeadlineAt,
    waitFallbackPolicyRevision,
    job.createdAt,
    job.updatedAt,
  ];
};

const runInsertValues = (run: DiscoveryRunV1): unknown[] => {
  const [profileRevision, profileId] = profileValues(run.profileBinding);
  const [waitProjectionRevision, waitProjectionDigest, waitDeadlineAt, waitFallbackPolicyRevision] =
    waitValues(run.projectionWait);
  return [
    run.projectId,
    run.runId,
    run.jobId,
    run.runRevision,
    run.schemaVersion,
    run.requestedMode,
    run.effectiveMode,
    run.canonicalBase.canonicalVersion,
    run.canonicalBase.snapshotDigest,
    run.requiredDiscoveryBase?.projectionRevision ?? null,
    run.requiredDiscoveryBase?.projectionDigest ?? null,
    run.policyRevision,
    run.strategyRevision,
    profileId,
    profileRevision,
    run.budget.budgetVersion,
    run.budget.budgetId,
    run.budget.budgetRevision,
    JSON.stringify(run.budget),
    run.lifecycleState,
    run.lifecycleRevision,
    waitProjectionRevision,
    waitProjectionDigest,
    waitDeadlineAt,
    waitFallbackPolicyRevision,
    run.createdAt,
    run.updatedAt,
  ];
};

const isConflict = (error: unknown): boolean => (error as { code?: string }).code === '23505';

export class PostgresDiscoveryRuntimeRepository implements DiscoveryRuntimeRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async saveJob(job: DiscoveryJobV1): Promise<'CREATED' | 'CONFLICT'> {
    const decoded = decodeDiscoveryJobV1(job);
    try {
      await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          await client.query(
            `INSERT INTO discovery.jobs (
              project_id, job_id, logical_job_identity, logical_job_identity_version,
              schema_version, trigger_id, trigger_class, trigger, requested_mode,
              effective_mode, canonical_base_version, canonical_snapshot_digest,
              required_projection_revision, required_projection_digest, policy_revision,
              strategy_revision, profile_id, profile_revision, budget_version, budget_id,
              budget_revision, budget, lifecycle_state, lifecycle_revision,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12,
              $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb,
              $23, $24, $25, $26, $27, $28, $29, $30
            )`,
            jobInsertValues(decoded),
          );
          await client.query(
            `INSERT INTO discovery.job_lifecycle_history (
              project_id, job_id, lifecycle_revision, from_state, to_state,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, occurred_at
            ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9)`,
            [
              decoded.projectId,
              decoded.jobId,
              decoded.lifecycleRevision,
              decoded.lifecycleState,
              ...waitValues(decoded.projectionWait),
              decoded.createdAt,
            ],
          );
        },
        { module: 'discovery-runtime', operation: 'job-save' },
      );
      return 'CREATED';
    } catch (error) {
      if (isConflict(error)) return 'CONFLICT';
      throw error;
    }
  }

  async findJob(lookup: DiscoveryRuntimeJobLookupV1): Promise<DiscoveryJobV1 | undefined> {
    const result = await this.pool.query<RuntimeJobRow>(
      `SELECT ${jobColumns} FROM discovery.jobs WHERE project_id = $1 AND job_id = $2`,
      [lookup.projectId, lookup.jobId],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : undefined;
  }

  async findJobByLogicalIdentity(
    lookup: DiscoveryRuntimeLogicalJobLookupV1,
  ): Promise<DiscoveryJobV1 | undefined> {
    const identity = decodeDiscoveryLogicalJobIdentityV1(lookup.logicalIdentity);
    const result = await this.pool.query<RuntimeJobRow>(
      `SELECT ${jobColumns}
       FROM discovery.jobs
       WHERE project_id = $1 AND logical_job_identity = $2
         AND logical_job_identity_version = $3`,
      [lookup.projectId, identity.value, identity.identityVersion],
    );
    return result.rows[0] ? mapJob(result.rows[0]) : undefined;
  }

  async transitionJob(
    input: DiscoveryRuntimeJobTransitionInputV1,
  ): Promise<DiscoveryJobV1 | 'NOT_FOUND' | 'CONFLICT'> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<RuntimeJobRow>(
          `SELECT ${jobColumns}
           FROM discovery.jobs WHERE project_id = $1 AND job_id = $2 FOR UPDATE`,
          [input.projectId, input.jobId],
        );
        const currentRow = result.rows[0];
        if (!currentRow) return 'NOT_FOUND';
        const current = mapJob(currentRow);
        if (current.lifecycleRevision !== input.expectedLifecycleRevision) return 'CONFLICT';
        assertDiscoveryRuntimeLifecycleTransitionV1(current.lifecycleState, input.targetState);
        const nextWait =
          input.targetState === 'WAITING_FOR_PROJECTION'
            ? (input.projectionWait ?? current.projectionWait)
            : undefined;
        if (input.targetState === 'WAITING_FOR_PROJECTION' && nextWait === undefined) {
          throw new TypeError('projectionWait is required while waiting for projection');
        }
        const [
          waitProjectionRevision,
          waitProjectionDigest,
          waitDeadlineAt,
          waitFallbackPolicyRevision,
        ] = waitValues(nextWait);
        const updated = await client.query<RuntimeJobRow>(
          `UPDATE discovery.jobs
           SET lifecycle_state = $4, lifecycle_revision = $5,
               wait_projection_revision = $6, wait_projection_digest = $7,
               wait_deadline_at = $8, wait_fallback_policy_revision = $9,
               updated_at = $10
           WHERE project_id = $1 AND job_id = $2 AND lifecycle_revision = $3
           RETURNING ${jobColumns}`,
          [
            input.projectId,
            input.jobId,
            input.expectedLifecycleRevision,
            input.targetState,
            input.expectedLifecycleRevision + 1,
            waitProjectionRevision,
            waitProjectionDigest,
            waitDeadlineAt,
            waitFallbackPolicyRevision,
            input.updatedAt,
          ],
        );
        const row = updated.rows[0];
        if (!row) return 'CONFLICT';
        await client.query(
          `INSERT INTO discovery.job_lifecycle_history (
            project_id, job_id, lifecycle_revision, from_state, to_state,
            wait_projection_revision, wait_projection_digest, wait_deadline_at,
            wait_fallback_policy_revision, occurred_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            input.projectId,
            input.jobId,
            input.expectedLifecycleRevision + 1,
            current.lifecycleState,
            input.targetState,
            waitProjectionRevision,
            waitProjectionDigest,
            waitDeadlineAt,
            waitFallbackPolicyRevision,
            input.updatedAt,
          ],
        );
        return mapJob(row);
      },
      { module: 'discovery-runtime', operation: 'job-transition' },
    );
  }

  async saveRun(run: DiscoveryRunV1): Promise<'CREATED' | 'CONFLICT'> {
    const decoded = decodeDiscoveryRunV1(run);
    try {
      await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          await client.query(
            `INSERT INTO discovery.runs (
              project_id, run_id, job_id, run_revision, schema_version,
              requested_mode, effective_mode, canonical_base_version,
              canonical_snapshot_digest, required_projection_revision,
              required_projection_digest, policy_revision, strategy_revision,
              profile_id, profile_revision, budget_version, budget_id,
              budget_revision, budget, lifecycle_state, lifecycle_revision,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
              $14, $15, $16, $17, $18, $19::jsonb, $20, $21, $22, $23,
              $24, $25, $26, $27
            )`,
            runInsertValues(decoded),
          );
        },
        { module: 'discovery-runtime', operation: 'run-save' },
      );
      return 'CREATED';
    } catch (error) {
      if (isConflict(error)) return 'CONFLICT';
      throw error;
    }
  }

  async findRun(
    lookup: DiscoveryRuntimeJobLookupV1 & { readonly runId: string },
  ): Promise<DiscoveryRunV1 | undefined> {
    const result = await this.pool.query<RuntimeRunRow>(
      `SELECT ${runColumns}
       FROM discovery.runs WHERE project_id = $1 AND job_id = $2 AND run_id = $3`,
      [lookup.projectId, lookup.jobId, lookup.runId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : undefined;
  }

  async saveAttempt(attempt: DiscoveryAttemptV1): Promise<'CREATED' | 'CONFLICT'> {
    const decoded = decodeDiscoveryAttemptV1(attempt);
    try {
      await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          await client.query(
            `INSERT INTO discovery.attempts (
              project_id, attempt_id, run_id, job_id, attempt_number,
              attempt_revision, attempt_kind, lifecycle_state, previous_attempt_id,
              schema_version, created_at, updated_at, completed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              decoded.projectId,
              decoded.attemptId,
              decoded.runId,
              decoded.jobId,
              decoded.attemptNumber,
              decoded.attemptRevision,
              decoded.attemptKind,
              decoded.lifecycleState,
              decoded.previousAttemptId ?? null,
              decoded.schemaVersion,
              decoded.createdAt,
              decoded.updatedAt,
              decoded.completedAt ?? null,
            ],
          );
        },
        { module: 'discovery-runtime', operation: 'attempt-save' },
      );
      return 'CREATED';
    } catch (error) {
      if (isConflict(error)) return 'CONFLICT';
      throw error;
    }
  }

  async listAttempts(
    lookup: DiscoveryRuntimeJobLookupV1 & { readonly runId: string },
  ): Promise<readonly DiscoveryAttemptV1[]> {
    const result = await this.pool.query<RuntimeAttemptRow>(
      `SELECT ${attemptColumns}
       FROM discovery.attempts
       WHERE project_id = $1 AND job_id = $2 AND run_id = $3
       ORDER BY attempt_number ASC`,
      [lookup.projectId, lookup.jobId, lookup.runId],
    );
    return result.rows.map(mapAttempt);
  }

  async saveStage(stage: DiscoveryStageV1): Promise<'CREATED' | 'CONFLICT'> {
    const decoded = decodeDiscoveryStageV1(stage);
    try {
      await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          await client.query(
            `INSERT INTO discovery.stages (
              project_id, stage_id, run_id, attempt_id, job_id, stage_ordinal,
              stage_type, stage_revision, state, schema_version, created_at,
              updated_at, completed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              decoded.projectId,
              decoded.stageId,
              decoded.runId,
              decoded.attemptId,
              decoded.jobId,
              decoded.stageOrdinal,
              decoded.stageType,
              decoded.stageRevision,
              decoded.state,
              decoded.schemaVersion,
              decoded.createdAt,
              decoded.updatedAt,
              decoded.completedAt ?? null,
            ],
          );
          await client.query(
            `INSERT INTO discovery.stage_history (
              project_id, stage_id, run_id, attempt_id, stage_revision, state, occurred_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              decoded.projectId,
              decoded.stageId,
              decoded.runId,
              decoded.attemptId,
              decoded.stageRevision,
              decoded.state,
              decoded.createdAt,
            ],
          );
        },
        { module: 'discovery-runtime', operation: 'stage-save' },
      );
      return 'CREATED';
    } catch (error) {
      if (isConflict(error)) return 'CONFLICT';
      throw error;
    }
  }

  async listStages(lookup: DiscoveryRuntimeStageLookupV1): Promise<readonly DiscoveryStageV1[]> {
    const result = await this.pool.query<RuntimeStageRow>(
      `SELECT ${stageColumns}
       FROM discovery.stages
       WHERE project_id = $1 AND run_id = $2 AND attempt_id = $3
       ORDER BY stage_ordinal ASC`,
      [lookup.projectId, lookup.runId, lookup.attemptId],
    );
    return result.rows.map(mapStage);
  }

  async transitionStage(
    input: DiscoveryRuntimeStageTransitionInputV1,
  ): Promise<DiscoveryStageV1 | 'NOT_FOUND' | 'CONFLICT'> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<RuntimeStageRow>(
          `SELECT ${stageColumns}
           FROM discovery.stages
           WHERE project_id = $1 AND run_id = $2 AND attempt_id = $3 AND stage_id = $4
           FOR UPDATE`,
          [input.projectId, input.runId, input.attemptId, input.stageId],
        );
        const row = result.rows[0];
        if (!row) return 'NOT_FOUND';
        const current = mapStage(row);
        if (current.stageRevision !== input.expectedStageRevision) return 'CONFLICT';
        assertDiscoveryRuntimeStageTransitionV1(current.state, input.targetState);
        const completedAt = [
          'SUCCEEDED',
          'FAILED_RETRYABLE',
          'FAILED_TERMINAL',
          'CANCELLED',
        ].includes(input.targetState)
          ? (input.completedAt ?? input.updatedAt)
          : null;
        const updated = await client.query<RuntimeStageRow>(
          `UPDATE discovery.stages
           SET state = $5, stage_revision = $6, updated_at = $7, completed_at = $8
           WHERE project_id = $1 AND run_id = $2 AND attempt_id = $3 AND stage_id = $4
             AND stage_revision = $9
           RETURNING ${stageColumns}`,
          [
            input.projectId,
            input.runId,
            input.attemptId,
            input.stageId,
            input.targetState,
            input.expectedStageRevision + 1,
            input.updatedAt,
            completedAt,
            input.expectedStageRevision,
          ],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) return 'CONFLICT';
        await client.query(
          `INSERT INTO discovery.stage_history (
            project_id, stage_id, run_id, attempt_id, stage_revision, state, occurred_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            input.projectId,
            input.stageId,
            input.runId,
            input.attemptId,
            input.expectedStageRevision + 1,
            input.targetState,
            input.updatedAt,
          ],
        );
        return mapStage(updatedRow);
      },
      { module: 'discovery-runtime', operation: 'stage-transition' },
    );
  }
}
