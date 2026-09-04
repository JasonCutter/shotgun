import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';

import {
  assertDiscoveryRuntimeLifecycleTransitionV1,
  assertDiscoveryAttemptLifecycleTransitionV1,
  assertDiscoveryRuntimeStageTransitionV1,
  decodeDiscoveryAttemptV1,
  decodeDiscoveryJobV1,
  decodeDiscoveryLogicalJobIdentityV1,
  decodeDiscoveryFindingReadyV1,
  decodeDiscoveryRunV1,
  decodeDiscoveryStageV1,
  semanticStableJson,
  type DiscoveryAttemptV1,
  type DiscoveryCanonicalTriggerLookupV1,
  type DiscoveryManualTriggerLookupV1,
  type DiscoveryScheduledTriggerLookupV1,
  type DiscoveryJobV1,
  type DiscoveryProjectionWaitBindingV1,
  type DiscoveryRunV1,
  type DiscoveryStageV1,
  type DiscoveryRuntimeStageStateV1,
  type DiscoveryRuntimeLifecycleStateV1,
  type DiscoveryFindingReadyV1,
} from '../../../packages/contracts/src/index.js';
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';
import type {
  DiscoveryRuntimeJobLookupV1,
  DiscoveryRuntimeJobTransitionInputV1,
  DiscoveryRuntimeLogicalJobLookupV1,
  DiscoveryRuntimeAttemptTransitionInputV1,
  DiscoveryRuntimeRunTransitionInputV1,
  DiscoveryRuntimeRunLookupV1,
  DiscoveryRuntimeExecutionRepositoryPort,
  DiscoveryRuntimeBudgetCheckpointV1,
  DiscoveryRuntimeBudgetSnapshotV1,
  DiscoveryRuntimeClaimInputV1,
  DiscoveryRuntimeClaimV1,
  DiscoveryRuntimeFencedAttemptTransitionInputV1,
  DiscoveryRuntimeFencedJobTransitionInputV1,
  DiscoveryRuntimeFencedRunTransitionInputV1,
  DiscoveryRuntimeFencedStageTransitionInputV1,
  DiscoveryRuntimeFailureContextV1,
  DiscoveryRuntimeFailureFinalizationInputV1,
  DiscoveryRuntimeFinalizeInputV1,
  DiscoveryRuntimeLeaseMutationInputV1,
  DiscoveryRuntimeLeaseV1,
  DiscoveryRuntimeStageLookupV1,
  DiscoveryRuntimeStageTransitionInputV1,
  DiscoveryRuntimeStageOutputV1,
  DiscoveryRuntimeProviderReservationV1,
  DiscoverySemanticEssenceDiagnosticInputV1,
} from '../../../modules/discovery-runtime/src/index.js';
import type { DiscoveryActivityDiagnosticAggregateV1 } from '../../../modules/frontend-activity/src/activity-domain-read-ports.js';
import type {
  DiscoveryActivityAttemptRow,
  DiscoveryActivityHistoryV1,
  DiscoveryActivityJobRow,
  DiscoveryActivityLifecycleEventV1,
  DiscoveryActivityReadPort,
} from '../../../modules/frontend-activity/src/index.js';
import {
  decodeDiscoveryActivityCursor,
  encodeDiscoveryActivityCursor,
} from '../../../modules/frontend-activity/src/index.js';

type RuntimeJobRow = QueryResultRow & {
  project_id: string;
  job_id: string;
  logical_job_identity: string;
  logical_job_identity_version: string;
  schema_version: string;
  trigger_id: string;
  trigger_class: string;
  trigger: unknown;
  requested_scan_mode: string;
  effective_scan_mode: string;
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
  requested_scan_mode: string;
  effective_scan_mode: string;
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
  completed_at: Date | null;
};

type RuntimeAttemptRow = QueryResultRow & {
  project_id: string;
  attempt_id: string;
  run_id: string;
  job_id: string;
  attempt_number: number;
  lifecycle_revision: number;
  attempt_kind: string;
  lifecycle_state: string;
  previous_attempt_id: string | null;
  schema_version: string;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

type RuntimeActivityAttemptRow = RuntimeAttemptRow & {
  failure_code: string | null;
  failure_classification: 'RETRYABLE' | 'TERMINAL' | null;
  failure_retryable: boolean | null;
  failure_safe_message: string | null;
  failure_stage: string | null;
  failure_occurred_at: Date | null;
  retry_not_before: Date | null;
};

type RuntimeClaimAttemptRow = RuntimeAttemptRow & {
  lease_owner: string | null;
  lease_acquired_at: Date | null;
  lease_expires_at: Date | null;
  retry_not_before: Date | null;
  fencing_token: number | string;
};

type RuntimeBudgetCheckpointRow = QueryResultRow & {
  project_id: string;
  job_id: string;
  run_id: string;
  revision: number;
  snapshot: unknown;
  fencing_token: number | string;
  updated_at: Date;
};

type RuntimeFindingReadyRow = QueryResultRow & {
  publication_id: string;
  project_id: string;
  finding_id: string;
  finding_revision: number;
  fingerprint: string;
  fingerprint_version: string;
  job_id: string;
  run_id: string;
  attempt_id: string;
  canonical_base_version: number;
  canonical_snapshot_digest: string;
  required_projection_revision: string | null;
  required_projection_digest: string | null;
  occurred_at: Date;
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

type RuntimeStageOutputRow = QueryResultRow & {
  project_id: string;
  job_id: string;
  run_id: string;
  attempt_id: string;
  stage_id: string;
  stage_type: string;
  stage_revision: number;
  output: unknown;
  fencing_token: number | string;
  updated_at: Date;
};

type RuntimeProviderReservationRow = QueryResultRow & {
  project_id: string;
  job_id: string;
  run_id: string;
  attempt_id: string;
  reservation_id: string;
  provider_id: string;
  model_id: string;
  input_token_upper_bound: number;
  max_output_tokens: number;
  estimated_cost_micros: number | string;
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
  actual_cost_micros: number | string | null;
  state: 'RESERVED' | 'FINALIZED' | 'CANCELLED';
  fencing_token: number | string;
  updated_at: Date;
};

type RuntimeLifecycleHistoryRow = QueryResultRow & {
  project_id: string;
  job_id: string;
  run_id?: string;
  attempt_id?: string;
  stage_id?: string;
  lifecycle_revision?: number;
  stage_revision?: number;
  from_state?: string | null;
  to_state?: string;
  state?: string;
  occurred_at: Date;
};

const jobColumns = `
  project_id, job_id, logical_job_identity, logical_job_identity_version,
  schema_version, trigger_id, trigger_class, trigger, requested_scan_mode,
  effective_scan_mode, canonical_base_version, canonical_snapshot_digest,
  required_projection_revision, required_projection_digest, policy_revision,
  strategy_revision, profile_id, profile_revision, budget_version, budget_id,
  budget_revision, budget, lifecycle_state, lifecycle_revision,
  wait_projection_revision, wait_projection_digest, wait_deadline_at,
  wait_fallback_policy_revision, created_at, updated_at`;

const qualifiedJobColumns = `
  j.project_id, j.job_id, j.logical_job_identity, j.logical_job_identity_version,
  j.schema_version, j.trigger_id, j.trigger_class, j.trigger, j.requested_scan_mode,
  j.effective_scan_mode, j.canonical_base_version, j.canonical_snapshot_digest,
  j.required_projection_revision, j.required_projection_digest, j.policy_revision,
  j.strategy_revision, j.profile_id, j.profile_revision, j.budget_version, j.budget_id,
  j.budget_revision, j.budget, j.lifecycle_state, j.lifecycle_revision,
  j.wait_projection_revision, j.wait_projection_digest, j.wait_deadline_at,
  j.wait_fallback_policy_revision, j.created_at, j.updated_at`;

const runColumns = `
  project_id, run_id, job_id, run_revision, schema_version, requested_scan_mode,
  effective_scan_mode, canonical_base_version, canonical_snapshot_digest,
  required_projection_revision, required_projection_digest, policy_revision,
  strategy_revision, profile_id, profile_revision, budget_version, budget_id,
  budget_revision, budget, lifecycle_state, lifecycle_revision,
  wait_projection_revision, wait_projection_digest, wait_deadline_at,
  wait_fallback_policy_revision, created_at, updated_at, completed_at`;

const attemptColumns = `
  project_id, attempt_id, run_id, job_id, attempt_number, lifecycle_revision,
  attempt_kind, lifecycle_state, previous_attempt_id, schema_version,
  created_at, updated_at, completed_at`;

const claimAttemptColumns = `${attemptColumns}, lease_owner, lease_acquired_at,
  lease_expires_at, retry_not_before, fencing_token`;

const findingReadyColumns = `
  publication_id, project_id, finding_id, finding_revision, fingerprint,
  fingerprint_version, job_id, run_id, attempt_id, canonical_base_version,
  canonical_snapshot_digest, required_projection_revision,
  required_projection_digest, occurred_at`;

const DISCOVERY_EXECUTION_STAGE_TYPES = [
  'WAIT_FOR_PROJECTION',
  'LOAD_SIGNALS',
  'GENERATE_FINDINGS',
  'QUALITY_GATE',
  'PERSIST_FINDINGS',
  'PUBLISH_REENTRY',
  'RECONCILE_FINDINGS',
] as const;

const numberValue = (value: number | string, field: string): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer`);
  }
  return numeric;
};

const boundedLeaseDuration = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) {
    throw new TypeError('leaseDurationMs must be between 1000 and 300000');
  }
  return value;
};

const nonEmpty = (value: string, field: string): string => {
  if (value.trim().length === 0) throw new TypeError(`${field} must be non-empty`);
  return value.trim();
};

const isoDate = (value: string, field: string): Date => {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`${field} must be an ISO timestamp`);
  return parsed;
};

const snapshotFromRow = (row: RuntimeBudgetCheckpointRow): DiscoveryRuntimeBudgetCheckpointV1 => {
  const snapshot = row.snapshot as Record<string, unknown>;
  const dimensions = [
    'resources',
    'semanticNeighbors',
    'candidatePairs',
    'candidateGroups',
    'findings',
    'providerCalls',
    'inputTokens',
    'outputTokens',
    'estimatedCostMicros',
    'activeProviderCalls',
  ] as const;
  const decoded = {} as Record<(typeof dimensions)[number], number>;
  for (const dimension of dimensions) {
    const value = snapshot[dimension];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`budget checkpoint snapshot.${dimension} is invalid`);
    }
    decoded[dimension] = value;
  }
  return {
    schemaVersion: '1.0.0',
    projectId: row.project_id,
    jobId: row.job_id,
    runId: row.run_id,
    revision: row.revision,
    snapshot: decoded as DiscoveryRuntimeBudgetSnapshotV1,
    updatedAt: dateValue(row.updated_at),
  };
};

const cumulativeBudgetSnapshotRegressed = (
  previous: DiscoveryRuntimeBudgetSnapshotV1,
  next: DiscoveryRuntimeBudgetSnapshotV1,
): boolean =>
  (
    [
      'resources',
      'semanticNeighbors',
      'candidatePairs',
      'candidateGroups',
      'findings',
      'providerCalls',
      'inputTokens',
      'outputTokens',
      'estimatedCostMicros',
    ] as const
  ).some((dimension) => next[dimension] < previous[dimension]);

const mapFindingReady = (row: RuntimeFindingReadyRow): DiscoveryFindingReadyV1 =>
  decodeDiscoveryFindingReadyV1({
    schemaVersion: '1.0.0',
    publicationId: row.publication_id,
    projectId: row.project_id,
    findingId: row.finding_id,
    findingRevision: row.finding_revision,
    fingerprint: row.fingerprint,
    fingerprintVersion: row.fingerprint_version,
    jobId: row.job_id,
    runId: row.run_id,
    attemptId: row.attempt_id,
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: row.canonical_base_version,
      snapshotDigest: row.canonical_snapshot_digest,
    },
    ...(row.required_projection_revision === null
      ? {}
      : {
          requiredDiscoveryBase: {
            schemaVersion: '1.0.0',
            projectionRevision: row.required_projection_revision,
            projectionDigest: row.required_projection_digest!,
          },
        }),
    occurredAt: dateValue(row.occurred_at),
  });

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
    requestedScanMode: row.requested_scan_mode,
    effectiveScanMode: row.effective_scan_mode,
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
    requestedScanMode: row.requested_scan_mode,
    effectiveScanMode: row.effective_scan_mode,
    runRevision: row.run_revision,
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
    ...(row.completed_at === null ? {} : { completedAt: dateValue(row.completed_at) }),
  });

const mapAttempt = (row: RuntimeAttemptRow): DiscoveryAttemptV1 =>
  decodeDiscoveryAttemptV1({
    schemaVersion: row.schema_version,
    attemptId: row.attempt_id,
    jobId: row.job_id,
    runId: row.run_id,
    projectId: row.project_id,
    attemptNumber: row.attempt_number,
    lifecycleRevision: row.lifecycle_revision,
    attemptKind: row.attempt_kind,
    lifecycleState: row.lifecycle_state,
    ...(row.previous_attempt_id === null ? {} : { previousAttemptId: row.previous_attempt_id }),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
    ...(row.completed_at === null ? {} : { completedAt: dateValue(row.completed_at) }),
  });

const failureFromAttemptRow = (
  row: RuntimeActivityAttemptRow,
): DiscoveryActivityAttemptRow['failure'] => {
  const values = [
    row.failure_code,
    row.failure_classification,
    row.failure_retryable,
    row.failure_safe_message,
    row.failure_stage,
    row.failure_occurred_at,
  ];
  if (values.every((value) => value === null)) return undefined;
  if (values.some((value) => value === null)) {
    throw new TypeError('Discovery Activity failure context is incomplete');
  }
  return {
    schemaVersion: '1.0.0',
    code: row.failure_code!,
    classification: row.failure_classification!,
    retryable: row.failure_retryable!,
    safeMessage: row.failure_safe_message!,
    failedStage: row.failure_stage!,
    occurredAt: dateValue(row.failure_occurred_at!),
    ...(row.retry_not_before === null ? {} : { retryNotBefore: dateValue(row.retry_not_before) }),
  };
};

const maxRuntimeTimestamp = (...values: readonly (string | undefined)[]): string => {
  const present = values.filter((value): value is string => value !== undefined);
  return present.reduce(
    (max, value) => (value > max ? value : max),
    present[0] ?? '1970-01-01T00:00:00.000Z',
  );
};

const lifecycleHistoryEvent = (
  row: RuntimeLifecycleHistoryRow,
  resourceKind: DiscoveryActivityLifecycleEventV1['resourceKind'],
): DiscoveryActivityLifecycleEventV1 => {
  const resourceId =
    resourceKind === 'DiscoveryJob'
      ? row.job_id
      : resourceKind === 'DiscoveryRun'
        ? row.run_id!
        : resourceKind === 'DiscoveryAttempt'
          ? row.attempt_id!
          : row.stage_id!;
  const revision =
    resourceKind === 'DiscoveryStage' ? row.stage_revision! : row.lifecycle_revision!;
  const toState = (resourceKind === 'DiscoveryStage' ? row.state : row.to_state)!;
  return {
    resourceKind,
    resourceId,
    projectId: row.project_id,
    jobId: row.job_id,
    ...(row.run_id === undefined ? {} : { runId: row.run_id }),
    ...(row.attempt_id === undefined ? {} : { attemptId: row.attempt_id }),
    revision: Number(revision),
    ...(row.from_state === undefined || row.from_state === null
      ? {}
      : {
          fromState: row.from_state as
            DiscoveryRuntimeLifecycleStateV1 | DiscoveryRuntimeStageStateV1,
        }),
    toState: toState as DiscoveryRuntimeLifecycleStateV1 | DiscoveryRuntimeStageStateV1,
    occurredAt: dateValue(row.occurred_at),
  };
};

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

const mapStageOutput = (row: RuntimeStageOutputRow): DiscoveryRuntimeStageOutputV1 => ({
  schemaVersion: '1.0.0',
  projectId: row.project_id,
  jobId: row.job_id,
  runId: row.run_id,
  attemptId: row.attempt_id,
  stageId: row.stage_id,
  stageType: row.stage_type as DiscoveryRuntimeStageOutputV1['stageType'],
  stageRevision: numberValue(row.stage_revision, 'stage output stage_revision'),
  output: row.output,
  updatedAt: dateValue(row.updated_at),
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
    job.requestedScanMode,
    job.effectiveScanMode,
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
    run.requestedScanMode,
    run.effectiveScanMode,
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
    run.completedAt ?? null,
  ];
};

const isConflict = (error: unknown): boolean => (error as { code?: string }).code === '23505';

const assertRunJobBinding = (run: DiscoveryRunV1, job: DiscoveryJobV1): void => {
  const fields = [
    ['projectId', run.projectId, job.projectId],
    ['requestedScanMode', run.requestedScanMode, job.requestedScanMode],
    ['effectiveScanMode', run.effectiveScanMode, job.effectiveScanMode],
    ['canonicalBase', run.canonicalBase, job.canonicalBase],
    ['requiredDiscoveryBase', run.requiredDiscoveryBase, job.requiredDiscoveryBase],
    ['policyRevision', run.policyRevision, job.policyRevision],
    ['strategyRevision', run.strategyRevision, job.strategyRevision],
    ['profileBinding', run.profileBinding, job.profileBinding],
    ['budget', run.budget, job.budget],
  ] as const;
  for (const [field, actual, expected] of fields) {
    if (semanticStableJson(actual) !== semanticStableJson(expected)) {
      throw new TypeError(`run.${field}: must match its parent Job binding`);
    }
  }
};

const completedAtForState = (
  targetState: string,
  updatedAt: string,
  completedAt: string | undefined,
): string | null =>
  ['SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED'].includes(targetState)
    ? (completedAt ?? updatedAt)
    : null;

const leaseStatus = async (
  client: PoolClient,
  lease: Pick<DiscoveryRuntimeLeaseV1, 'projectId' | 'workerId' | 'fencingToken'> & {
    readonly runId?: string;
    readonly jobId?: string;
    readonly attemptId?: string;
  },
  now: string,
): Promise<'ACTIVE' | 'STALE' | 'NOT_FOUND'> => {
  const result = await client.query(
    `SELECT 1 FROM discovery.attempts
     WHERE project_id = $1
       AND ($2::text IS NULL OR job_id = $2)
       AND ($3::text IS NULL OR run_id = $3)
       AND ($4::text IS NULL OR attempt_id = $4)
       AND lease_owner = $5 AND fencing_token = $6 AND lease_expires_at > $7
     FOR UPDATE`,
    [
      lease.projectId,
      lease.jobId ?? null,
      lease.runId ?? null,
      lease.attemptId ?? null,
      lease.workerId,
      lease.fencingToken,
      now,
    ],
  );
  if (result.rowCount === 1) return 'ACTIVE';
  const exists = await client.query(
    `SELECT 1 FROM discovery.attempts
     WHERE project_id = $1
       AND ($2::text IS NULL OR job_id = $2)
       AND ($3::text IS NULL OR run_id = $3)
       AND ($4::text IS NULL OR attempt_id = $4)`,
    [lease.projectId, lease.jobId ?? null, lease.runId ?? null, lease.attemptId ?? null],
  );
  return exists.rowCount === 1 ? 'STALE' : 'NOT_FOUND';
};

export class PostgresDiscoveryRuntimeRepository
  implements DiscoveryRuntimeExecutionRepositoryPort, DiscoveryActivityReadPort
{
  constructor(private readonly pool: Pool) {}

  async recordSemanticEssenceDiagnostic(
    input: DiscoverySemanticEssenceDiagnosticInputV1,
  ): Promise<'CREATED' | 'ALREADY_EXISTS'> {
    const result = await this.pool.query(
      `INSERT INTO discovery.semantic_essence_diagnostics
         (diagnostic_id, project_id, job_id, run_id, attempt_id, finding_identity,
          stage, reason_code, attempt_number, occurred_at, completion, excluded_count,
          candidate_count, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'SEMANTIC_ESSENCE',
               'DISCOVERY_SEMANTIC_ESSENCE_INVALID', $7, $8, 'PARTIAL', $9, $10, $8, $8)
       ON CONFLICT (project_id, run_id, attempt_id, finding_identity, reason_code) DO NOTHING`,
      [
        randomUUID(),
        input.projectId,
        input.jobId,
        input.runId,
        input.attemptId,
        input.findingIdentity,
        input.attemptNumber,
        input.occurredAt,
        input.excludedCount,
        input.candidateCount ?? null,
      ],
    );
    return result.rowCount === 1 ? 'CREATED' : 'ALREADY_EXISTS';
  }

  /**
   * Activity read boundary over the same durable runtime tables. These
   * methods are intentionally read-only and expose no Finding/stage-output
   * payloads or execution commands.
   */
  async listJobs(input: {
    readonly projectId: string;
    readonly cursor?: string;
    readonly limit: number;
  }): Promise<{ readonly jobs: readonly DiscoveryActivityJobRow[]; readonly nextCursor?: string }> {
    const params: unknown[] = [input.projectId];
    const conditions = ['j.project_id = $1'];
    if (input.cursor !== undefined) {
      const cursor = decodeDiscoveryActivityCursor(input.cursor);
      params.push(cursor.updatedAt, cursor.jobId);
      conditions.push(
        `(GREATEST(j.updated_at, COALESCE((SELECT max(r.updated_at) FROM discovery.runs r WHERE r.project_id = j.project_id AND r.job_id = j.job_id), j.updated_at)) < $2
          OR (GREATEST(j.updated_at, COALESCE((SELECT max(r.updated_at) FROM discovery.runs r WHERE r.project_id = j.project_id AND r.job_id = j.job_id), j.updated_at)) = $2 AND j.job_id > $3))`,
      );
    }
    params.push(input.limit);
    const result = await this.pool.query<RuntimeJobRow>(
      `SELECT ${qualifiedJobColumns}
       FROM discovery.jobs j
       WHERE ${conditions.join(' AND ')}
       ORDER BY GREATEST(j.updated_at, COALESCE((SELECT max(r.updated_at) FROM discovery.runs r WHERE r.project_id = j.project_id AND r.job_id = j.job_id), j.updated_at)) DESC,
                j.job_id ASC
       LIMIT $${params.length}`,
      params,
    );
    const jobs = await Promise.all(
      result.rows.map(async (row): Promise<DiscoveryActivityJobRow> => ({
        job: mapJob(row),
        run: await this.getLatestRun({ projectId: row.project_id, jobId: row.job_id }),
      })),
    );
    const last = jobs[jobs.length - 1];
    return {
      jobs,
      ...(result.rows.length >= input.limit && last !== undefined
        ? {
            nextCursor: encodeDiscoveryActivityCursor({
              updatedAt: maxRuntimeTimestamp(last.job.updatedAt, last.run?.updatedAt),
              jobId: last.job.jobId,
            }),
          }
        : {}),
    };
  }

  async getJob(input: {
    readonly projectId: string;
    readonly jobId: string;
  }): Promise<DiscoveryJobV1 | undefined> {
    return this.findJob(input);
  }

  async getRun(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
  }): Promise<DiscoveryRunV1 | undefined> {
    const run = await this.findRun(input);
    return run?.jobId === input.jobId ? run : undefined;
  }

  async getLatestRun(input: {
    readonly projectId: string;
    readonly jobId: string;
  }): Promise<DiscoveryRunV1 | undefined> {
    const result = await this.pool.query<RuntimeRunRow>(
      `SELECT ${runColumns}
       FROM discovery.runs
       WHERE project_id = $1 AND job_id = $2
       ORDER BY run_revision DESC, run_id ASC
       LIMIT 1`,
      [input.projectId, input.jobId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : undefined;
  }

  async listActivityAttempts(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
  }): Promise<readonly DiscoveryActivityAttemptRow[]> {
    const result = await this.pool.query<RuntimeActivityAttemptRow>(
      `SELECT ${attemptColumns}, failure_code, failure_classification,
              failure_retryable, failure_safe_message, failure_stage,
              failure_occurred_at, retry_not_before
       FROM discovery.attempts
       WHERE project_id = $1 AND job_id = $2 AND run_id = $3
       ORDER BY attempt_number ASC, attempt_id ASC`,
      [input.projectId, input.jobId, input.runId],
    );
    return result.rows.map((row) => {
      const failure = failureFromAttemptRow(row);
      return {
        ...mapAttempt(row),
        ...(failure === undefined ? {} : { failure }),
      };
    });
  }

  async listActivityStages(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
    readonly attemptId: string;
  }): Promise<readonly DiscoveryStageV1[]> {
    const stages = await this.listStages({
      projectId: input.projectId,
      runId: input.runId,
      attemptId: input.attemptId,
    });
    return stages.filter((stage) => stage.jobId === input.jobId);
  }

  async listHistory(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
    readonly attemptIds: readonly string[];
    readonly stageIds: readonly string[];
  }): Promise<DiscoveryActivityHistoryV1> {
    const [jobResult, runResult, attemptResult, stageResult] = await Promise.all([
      this.pool.query<RuntimeLifecycleHistoryRow>(
        `SELECT project_id, job_id, lifecycle_revision, from_state, to_state, occurred_at
         FROM discovery.job_lifecycle_history
         WHERE project_id = $1 AND job_id = $2
         ORDER BY lifecycle_revision ASC`,
        [input.projectId, input.jobId],
      ),
      this.pool.query<RuntimeLifecycleHistoryRow>(
        `SELECT project_id, job_id, run_id, lifecycle_revision, from_state, to_state, occurred_at
         FROM discovery.run_lifecycle_history
         WHERE project_id = $1 AND job_id = $2 AND run_id = $3
         ORDER BY lifecycle_revision ASC`,
        [input.projectId, input.jobId, input.runId],
      ),
      this.pool.query<RuntimeLifecycleHistoryRow>(
        `SELECT project_id, job_id, run_id, attempt_id, lifecycle_revision, from_state, to_state, occurred_at
         FROM discovery.attempt_lifecycle_history
         WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = ANY($4::text[])
         ORDER BY attempt_id ASC, lifecycle_revision ASC`,
        [input.projectId, input.jobId, input.runId, input.attemptIds],
      ),
      this.pool.query<RuntimeLifecycleHistoryRow>(
        `SELECT s.project_id, s.job_id, s.run_id, s.attempt_id, s.stage_id,
                h.stage_revision, h.state, h.occurred_at
         FROM discovery.stage_history h
         JOIN discovery.stages s ON s.project_id = h.project_id AND s.stage_id = h.stage_id
         WHERE h.project_id = $1 AND h.run_id = $2 AND h.stage_id = ANY($3::text[])
           AND s.job_id = $4
         ORDER BY h.stage_id ASC, h.stage_revision ASC`,
        [input.projectId, input.runId, input.stageIds, input.jobId],
      ),
    ]);
    const job = jobResult.rows.map((row) => lifecycleHistoryEvent(row, 'DiscoveryJob'));
    const run = runResult.rows.map((row) => lifecycleHistoryEvent(row, 'DiscoveryRun'));
    const attempt = attemptResult.rows.map((row) => lifecycleHistoryEvent(row, 'DiscoveryAttempt'));
    const stage = stageResult.rows.map((row) => lifecycleHistoryEvent(row, 'DiscoveryStage'));
    return { job, run, attempt, stage };
  }

  async getSemanticEssenceDiagnosticAggregate(input: {
    readonly projectId: string;
    readonly jobId: string;
    readonly runId: string;
  }): Promise<DiscoveryActivityDiagnosticAggregateV1 | undefined> {
    const result = await this.pool.query<{
      diagnostic_count: string;
      excluded_count: string;
      candidate_count: string | null;
      updated_at: Date;
    }>(
      `WITH per_attempt AS (
         SELECT attempt_id,
                sum(excluded_count)::int AS excluded_count,
                max(candidate_count)::int AS candidate_count,
                max(updated_at) AS updated_at
         FROM discovery.semantic_essence_diagnostics
         WHERE project_id = $1 AND job_id = $2 AND run_id = $3
         GROUP BY attempt_id
       )
       SELECT (SELECT count(*)::text
               FROM discovery.semantic_essence_diagnostics
               WHERE project_id = $1 AND job_id = $2 AND run_id = $3) AS diagnostic_count,
              COALESCE(sum(excluded_count), 0)::text AS excluded_count,
              sum(candidate_count)::text AS candidate_count,
              max(updated_at) AS updated_at
       FROM per_attempt
       HAVING count(*) > 0`,
      [input.projectId, input.jobId, input.runId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      diagnosticCount: Number(row.diagnostic_count),
      excludedCount: Number(row.excluded_count),
      ...(row.candidate_count === null ? {} : { candidateCount: Number(row.candidate_count) }),
      completion: 'PARTIAL',
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async saveJob(job: DiscoveryJobV1): Promise<'CREATED' | 'CONFLICT'> {
    const decoded = decodeDiscoveryJobV1(job);
    try {
      await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          await client.query(
            `INSERT INTO discovery.jobs (
              project_id, job_id, logical_job_identity, logical_job_identity_version,
              schema_version, trigger_id, trigger_class, trigger, requested_scan_mode,
              effective_scan_mode, canonical_base_version, canonical_snapshot_digest,
              required_projection_revision, required_projection_digest, policy_revision,
              strategy_revision, profile_id, profile_revision, budget_version, budget_id,
              budget_revision, budget, lifecycle_state, lifecycle_revision,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12,
              $13, $14, $15, $16, $17, $18, $19, $20, $21,
              $22::jsonb, $23, $24, $25, $26, $27, $28, $29, $30
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

  async findJobByTriggerIdentity(
    lookup:
      | DiscoveryCanonicalTriggerLookupV1
      | DiscoveryScheduledTriggerLookupV1
      | DiscoveryManualTriggerLookupV1,
  ): Promise<DiscoveryJobV1 | undefined> {
    const identityColumns =
      lookup.triggerClass === 'CANONICAL_COMMITTED'
        ? ["trigger->'triggerIdentity'->>'eventId'", "trigger->'triggerIdentity'->>'eventRevision'"]
        : lookup.triggerClass === 'SCHEDULED_FULL_SCAN'
          ? [
              "trigger->'triggerIdentity'->>'scheduleId'",
              "trigger->'triggerIdentity'->>'scheduleRevision'",
              "trigger->'triggerIdentity'->>'occurrenceKey'",
            ]
          : [
              "trigger->'triggerIdentity'->>'commandId'",
              "trigger->'triggerIdentity'->>'requestId'",
            ];
    const identityValues =
      lookup.triggerClass === 'CANONICAL_COMMITTED'
        ? [lookup.eventId, lookup.eventRevision]
        : lookup.triggerClass === 'SCHEDULED_FULL_SCAN'
          ? [lookup.scheduleId, lookup.scheduleRevision, lookup.occurrenceKey]
          : [lookup.commandId, lookup.requestId];
    const result = await this.pool.query<RuntimeJobRow>(
      `SELECT ${jobColumns}
       FROM discovery.jobs
       WHERE project_id = $1 AND trigger_class = $2
         AND ${identityColumns.map((column, index) => `${column} = $${index + 3}`).join(' AND ')}`,
      [lookup.projectId, lookup.triggerClass, ...identityValues],
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
          const parentResult = await client.query<RuntimeJobRow>(
            `SELECT ${jobColumns}
             FROM discovery.jobs WHERE project_id = $1 AND job_id = $2 FOR KEY SHARE`,
            [decoded.projectId, decoded.jobId],
          );
          const parent = parentResult.rows[0];
          if (!parent) throw new TypeError('run: parent Job was not found');
          assertRunJobBinding(decoded, mapJob(parent));
          await client.query(
            `INSERT INTO discovery.runs (
              project_id, run_id, job_id, run_revision, schema_version,
              requested_scan_mode, effective_scan_mode, canonical_base_version,
              canonical_snapshot_digest, required_projection_revision,
              required_projection_digest, policy_revision, strategy_revision,
              profile_id, profile_revision, budget_version, budget_id,
              budget_revision, budget, lifecycle_state, lifecycle_revision,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, created_at, updated_at, completed_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
              $14, $15, $16, $17, $18, $19::jsonb, $20, $21, $22, $23,
              $24, $25, $26, $27, $28
            )`,
            runInsertValues(decoded),
          );
          await client.query(
            `INSERT INTO discovery.run_lifecycle_history (
              project_id, run_id, job_id, lifecycle_revision, from_state, to_state,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, occurred_at
            ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10)`,
            [
              decoded.projectId,
              decoded.runId,
              decoded.jobId,
              decoded.lifecycleRevision,
              decoded.lifecycleState,
              ...waitValues(decoded.projectionWait),
              decoded.createdAt,
            ],
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

  async findRun(lookup: DiscoveryRuntimeRunLookupV1): Promise<DiscoveryRunV1 | undefined> {
    const result = await this.pool.query<RuntimeRunRow>(
      `SELECT ${runColumns}
       FROM discovery.runs WHERE project_id = $1 AND job_id = $2 AND run_id = $3`,
      [lookup.projectId, lookup.jobId, lookup.runId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : undefined;
  }

  async transitionRun(
    input: DiscoveryRuntimeRunTransitionInputV1,
  ): Promise<DiscoveryRunV1 | 'NOT_FOUND' | 'CONFLICT'> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<RuntimeRunRow>(
          `SELECT ${runColumns}
           FROM discovery.runs
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3
           FOR UPDATE`,
          [input.projectId, input.jobId, input.runId],
        );
        const currentRow = result.rows[0];
        if (!currentRow) return 'NOT_FOUND';
        const current = mapRun(currentRow);
        if (current.lifecycleRevision !== input.expectedLifecycleRevision) return 'CONFLICT';
        assertDiscoveryRuntimeLifecycleTransitionV1(current.lifecycleState, input.targetState);
        const nextWait =
          input.targetState === 'WAITING_FOR_PROJECTION'
            ? (input.projectionWait ?? current.projectionWait)
            : undefined;
        if (input.targetState === 'WAITING_FOR_PROJECTION' && nextWait === undefined) {
          throw new TypeError('projectionWait is required while waiting for projection');
        }
        if (
          nextWait !== undefined &&
          semanticStableJson(nextWait.requiredDiscoveryBase) !==
            semanticStableJson(current.requiredDiscoveryBase)
        ) {
          throw new TypeError('projectionWait.requiredDiscoveryBase: must match Run binding');
        }
        const [
          waitProjectionRevision,
          waitProjectionDigest,
          waitDeadlineAt,
          waitFallbackPolicyRevision,
        ] = waitValues(nextWait);
        const completedAt = completedAtForState(
          input.targetState,
          input.updatedAt,
          input.completedAt,
        );
        const updated = await client.query<RuntimeRunRow>(
          `UPDATE discovery.runs
           SET lifecycle_state = $4, lifecycle_revision = $5,
               wait_projection_revision = $6, wait_projection_digest = $7,
               wait_deadline_at = $8, wait_fallback_policy_revision = $9,
               updated_at = $10, completed_at = $11
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3
             AND lifecycle_revision = $12
           RETURNING ${runColumns}`,
          [
            input.projectId,
            input.jobId,
            input.runId,
            input.targetState,
            input.expectedLifecycleRevision + 1,
            waitProjectionRevision,
            waitProjectionDigest,
            waitDeadlineAt,
            waitFallbackPolicyRevision,
            input.updatedAt,
            completedAt,
            input.expectedLifecycleRevision,
          ],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) return 'CONFLICT';
        await client.query(
          `INSERT INTO discovery.run_lifecycle_history (
            project_id, run_id, job_id, lifecycle_revision, from_state, to_state,
            wait_projection_revision, wait_projection_digest, wait_deadline_at,
            wait_fallback_policy_revision, occurred_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            input.projectId,
            input.runId,
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
        return mapRun(updatedRow);
      },
      { module: 'discovery-runtime', operation: 'run-transition' },
    );
  }

  async saveAttempt(attempt: DiscoveryAttemptV1): Promise<'CREATED' | 'CONFLICT'> {
    const decoded = decodeDiscoveryAttemptV1(attempt);
    try {
      await withSafePostgresTransaction(
        this.pool,
        async (client) => {
          const parentRun = await client.query(
            `SELECT 1 FROM discovery.runs
             WHERE project_id = $1 AND job_id = $2 AND run_id = $3 FOR UPDATE`,
            [decoded.projectId, decoded.jobId, decoded.runId],
          );
          if (parentRun.rowCount !== 1) throw new TypeError('attempt: parent Run was not found');
          if (decoded.attemptKind === 'DOMAIN_RETRY') {
            const previousResult = await client.query<RuntimeAttemptRow>(
              `SELECT ${attemptColumns}
               FROM discovery.attempts
               WHERE project_id = $1 AND run_id = $2 AND job_id = $3 AND attempt_id = $4
               FOR UPDATE`,
              [decoded.projectId, decoded.runId, decoded.jobId, decoded.previousAttemptId],
            );
            const previous = previousResult.rows[0]
              ? mapAttempt(previousResult.rows[0])
              : undefined;
            if (!previous) {
              throw new TypeError('attempt.previousAttemptId: must belong to the same Run');
            }
            if (previous.lifecycleState !== 'FAILED_RETRYABLE') {
              throw new TypeError(
                'attempt.previousAttemptId: predecessor must be FAILED_RETRYABLE',
              );
            }
            if (decoded.attemptNumber !== previous.attemptNumber + 1) {
              throw new TypeError(
                'attempt.attemptNumber: must be the immediate predecessor number plus one',
              );
            }
          }
          await client.query(
            `INSERT INTO discovery.attempts (
              project_id, attempt_id, run_id, job_id, attempt_number,
              lifecycle_revision, attempt_kind, lifecycle_state, previous_attempt_id,
              schema_version, created_at, updated_at, completed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              decoded.projectId,
              decoded.attemptId,
              decoded.runId,
              decoded.jobId,
              decoded.attemptNumber,
              decoded.lifecycleRevision,
              decoded.attemptKind,
              decoded.lifecycleState,
              decoded.previousAttemptId ?? null,
              decoded.schemaVersion,
              decoded.createdAt,
              decoded.updatedAt,
              decoded.completedAt ?? null,
            ],
          );
          await client.query(
            `INSERT INTO discovery.attempt_lifecycle_history (
              project_id, attempt_id, run_id, job_id, lifecycle_revision,
              from_state, to_state, occurred_at
            ) VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)`,
            [
              decoded.projectId,
              decoded.attemptId,
              decoded.runId,
              decoded.jobId,
              decoded.lifecycleRevision,
              decoded.lifecycleState,
              decoded.createdAt,
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

  async listAttempts(lookup: DiscoveryRuntimeRunLookupV1): Promise<readonly DiscoveryAttemptV1[]> {
    const result = await this.pool.query<RuntimeAttemptRow>(
      `SELECT ${attemptColumns}
       FROM discovery.attempts
       WHERE project_id = $1 AND job_id = $2 AND run_id = $3
       ORDER BY attempt_number ASC`,
      [lookup.projectId, lookup.jobId, lookup.runId],
    );
    return result.rows.map(mapAttempt);
  }

  async transitionAttempt(
    input: DiscoveryRuntimeAttemptTransitionInputV1,
  ): Promise<DiscoveryAttemptV1 | 'NOT_FOUND' | 'CONFLICT'> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<RuntimeAttemptRow>(
          `SELECT ${attemptColumns}
           FROM discovery.attempts
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
           FOR UPDATE`,
          [input.projectId, input.jobId, input.runId, input.attemptId],
        );
        const currentRow = result.rows[0];
        if (!currentRow) return 'NOT_FOUND';
        const current = mapAttempt(currentRow);
        if (current.lifecycleRevision !== input.expectedLifecycleRevision) return 'CONFLICT';
        assertDiscoveryAttemptLifecycleTransitionV1(current.lifecycleState, input.targetState);
        const completedAt = completedAtForState(
          input.targetState,
          input.updatedAt,
          input.completedAt,
        );
        const updated = await client.query<RuntimeAttemptRow>(
          `UPDATE discovery.attempts
           SET lifecycle_state = $5, lifecycle_revision = $6,
               updated_at = $7, completed_at = $8
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
             AND lifecycle_revision = $9
           RETURNING ${attemptColumns}`,
          [
            input.projectId,
            input.jobId,
            input.runId,
            input.attemptId,
            input.targetState,
            input.expectedLifecycleRevision + 1,
            input.updatedAt,
            completedAt,
            input.expectedLifecycleRevision,
          ],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) return 'CONFLICT';
        await client.query(
          `INSERT INTO discovery.attempt_lifecycle_history (
            project_id, attempt_id, run_id, job_id, lifecycle_revision,
            from_state, to_state, occurred_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            input.projectId,
            input.attemptId,
            input.runId,
            input.jobId,
            input.expectedLifecycleRevision + 1,
            current.lifecycleState,
            input.targetState,
            input.updatedAt,
          ],
        );
        return mapAttempt(updatedRow);
      },
      { module: 'discovery-runtime', operation: 'attempt-transition' },
    );
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

  async claimNext(
    input: DiscoveryRuntimeClaimInputV1,
  ): Promise<DiscoveryRuntimeClaimV1 | undefined> {
    const workerId = nonEmpty(input.workerId, 'workerId');
    const projectId = input.projectId === undefined ? null : nonEmpty(input.projectId, 'projectId');
    const now = isoDate(input.now, 'now');
    const leaseDurationMs = boundedLeaseDuration(input.leaseDurationMs);
    const expiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();

    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const candidate = await client.query<
          RuntimeJobRow & {
            latest_attempt_id: string | null;
            latest_attempt_state: string | null;
            latest_attempt_number: number | null;
            latest_attempt_expires_at: Date | null;
            latest_attempt_retry_not_before: Date | null;
          }
        >(
          `SELECT ${qualifiedJobColumns}, latest.attempt_id AS latest_attempt_id,
             latest.lifecycle_state AS latest_attempt_state,
             latest.attempt_number AS latest_attempt_number,
             latest.lease_expires_at AS latest_attempt_expires_at,
             latest.retry_not_before AS latest_attempt_retry_not_before
           FROM discovery.jobs j
           LEFT JOIN LATERAL (
             SELECT a.attempt_id, a.lifecycle_state, a.attempt_number,
               a.lease_expires_at, a.retry_not_before
             FROM discovery.attempts a
             WHERE a.project_id = j.project_id AND a.job_id = j.job_id
             ORDER BY a.attempt_number DESC
             LIMIT 1
           ) latest ON TRUE
           WHERE ($2::text IS NULL OR j.project_id = $2)
             AND j.lifecycle_state IN ('QUEUED', 'PARTIAL', 'RUNNING', 'FAILED_RETRYABLE')
             AND (
               (j.lifecycle_state = 'QUEUED'
                 AND (latest.attempt_id IS NULL OR latest.lease_expires_at IS NULL
                   OR latest.lease_expires_at <= $1))
               OR (j.lifecycle_state = 'PARTIAL'
                 AND latest.lifecycle_state IS NOT NULL
                 AND (latest.lease_expires_at IS NULL OR latest.lease_expires_at <= $1))
               OR (j.lifecycle_state = 'RUNNING'
                 AND latest.lifecycle_state IN ('RUNNING', 'PARTIAL', 'QUEUED')
                 AND (latest.lease_expires_at IS NULL OR latest.lease_expires_at <= $1))
               OR (j.lifecycle_state = 'FAILED_RETRYABLE'
                 AND latest.lifecycle_state = 'FAILED_RETRYABLE'
                 AND (latest.retry_not_before IS NULL OR latest.retry_not_before <= $1))
             )
           ORDER BY j.updated_at ASC, j.job_id ASC
           LIMIT 1
           FOR UPDATE OF j SKIP LOCKED`,
          [now.toISOString(), projectId],
        );
        const candidateRow = candidate.rows[0];
        if (!candidateRow) return undefined;

        const currentJobResult = await client.query<RuntimeJobRow>(
          `SELECT ${jobColumns} FROM discovery.jobs
           WHERE project_id = $1 AND job_id = $2
           FOR UPDATE`,
          [candidateRow.project_id, candidateRow.job_id],
        );
        const currentJobRow = currentJobResult.rows[0];
        if (!currentJobRow) return undefined;
        const currentAttemptResult = await client.query<RuntimeClaimAttemptRow>(
          `SELECT ${claimAttemptColumns}
           FROM discovery.attempts
           WHERE project_id = $1 AND job_id = $2
           ORDER BY attempt_number DESC
           LIMIT 1`,
          [currentJobRow.project_id, currentJobRow.job_id],
        );
        const currentAttempt = currentAttemptResult.rows[0];
        const currentAttemptExpired =
          currentAttempt?.lease_expires_at === null ||
          currentAttempt?.lease_expires_at === undefined ||
          currentAttempt.lease_expires_at <= now;
        const currentJobClaimable =
          (currentJobRow.lifecycle_state === 'QUEUED' && currentAttemptExpired) ||
          (currentJobRow.lifecycle_state === 'PARTIAL' &&
            currentAttempt !== undefined &&
            currentAttemptExpired) ||
          (currentJobRow.lifecycle_state === 'RUNNING' &&
            currentAttempt !== undefined &&
            ['RUNNING', 'PARTIAL', 'QUEUED'].includes(currentAttempt.lifecycle_state) &&
            currentAttemptExpired) ||
          (currentJobRow.lifecycle_state === 'FAILED_RETRYABLE' &&
            currentAttempt?.lifecycle_state === 'FAILED_RETRYABLE' &&
            (currentAttempt.retry_not_before === null ||
              currentAttempt.retry_not_before === undefined ||
              currentAttempt.retry_not_before <= now));
        if (!currentJobClaimable) return undefined;

        let job = mapJob(currentJobRow);
        const runResult = await client.query<RuntimeRunRow>(
          `SELECT ${runColumns} FROM discovery.runs
           WHERE project_id = $1 AND job_id = $2
           FOR UPDATE`,
          [job.projectId, job.jobId],
        );
        if (runResult.rows.length > 1) {
          throw new TypeError(
            'DISCOVERY_RUN_LINEAGE_AMBIGUOUS: more than one Run exists for the Job',
          );
        }
        let run: DiscoveryRunV1;
        if (!runResult.rows[0]) {
          run = {
            schemaVersion: job.schemaVersion,
            runId: randomUUID(),
            jobId: job.jobId,
            projectId: job.projectId,
            requestedScanMode: job.requestedScanMode,
            effectiveScanMode: job.effectiveScanMode,
            runRevision: 1,
            canonicalBase: job.canonicalBase,
            ...(job.requiredDiscoveryBase === undefined
              ? {}
              : { requiredDiscoveryBase: job.requiredDiscoveryBase }),
            policyRevision: job.policyRevision,
            strategyRevision: job.strategyRevision,
            ...(job.profileBinding === undefined ? {} : { profileBinding: job.profileBinding }),
            budget: job.budget,
            lifecycleState: 'QUEUED',
            lifecycleRevision: 1,
            createdAt: input.now,
            updatedAt: input.now,
          };
          await client.query(
            `INSERT INTO discovery.runs (
              project_id, run_id, job_id, run_revision, schema_version,
              requested_scan_mode, effective_scan_mode, canonical_base_version,
              canonical_snapshot_digest, required_projection_revision,
              required_projection_digest, policy_revision, strategy_revision,
              profile_id, profile_revision, budget_version, budget_id,
              budget_revision, budget, lifecycle_state, lifecycle_revision,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, created_at, updated_at, completed_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
              $14, $15, $16, $17, $18, $19::jsonb, $20, $21, $22, $23,
              $24, $25, $26, $27, $28
            )`,
            runInsertValues(run),
          );
          await client.query(
            `INSERT INTO discovery.run_lifecycle_history (
              project_id, run_id, job_id, lifecycle_revision, from_state, to_state,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, occurred_at
            ) VALUES ($1, $2, $3, 1, NULL, 'QUEUED', NULL, NULL, NULL, NULL, $4)`,
            [run.projectId, run.runId, run.jobId, input.now],
          );
        } else {
          run = mapRun(runResult.rows[0]);
        }

        if (job.lifecycleState !== 'RUNNING') {
          assertDiscoveryRuntimeLifecycleTransitionV1(job.lifecycleState, 'RUNNING');
          const nextRevision = job.lifecycleRevision + 1;
          const updated = await client.query<RuntimeJobRow>(
            `UPDATE discovery.jobs
             SET lifecycle_state = 'RUNNING', lifecycle_revision = $3,
                 wait_projection_revision = NULL, wait_projection_digest = NULL,
                 wait_deadline_at = NULL, wait_fallback_policy_revision = NULL,
                 updated_at = $4
             WHERE project_id = $1 AND job_id = $2 AND lifecycle_revision = $5
             RETURNING ${jobColumns}`,
            [job.projectId, job.jobId, nextRevision, input.now, job.lifecycleRevision],
          );
          if (!updated.rows[0]) return undefined;
          await client.query(
            `INSERT INTO discovery.job_lifecycle_history (
              project_id, job_id, lifecycle_revision, from_state, to_state,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, occurred_at
            ) VALUES ($1, $2, $3, $4, 'RUNNING', NULL, NULL, NULL, NULL, $5)`,
            [job.projectId, job.jobId, nextRevision, job.lifecycleState, input.now],
          );
          job = mapJob(updated.rows[0]);
        }

        if (run.lifecycleState !== 'RUNNING') {
          assertDiscoveryRuntimeLifecycleTransitionV1(run.lifecycleState, 'RUNNING');
          const nextRevision = run.lifecycleRevision + 1;
          const updated = await client.query<RuntimeRunRow>(
            `UPDATE discovery.runs
             SET lifecycle_state = 'RUNNING', lifecycle_revision = $4,
                 wait_projection_revision = NULL, wait_projection_digest = NULL,
                 wait_deadline_at = NULL, wait_fallback_policy_revision = NULL,
                 updated_at = $5, completed_at = NULL
             WHERE project_id = $1 AND job_id = $2 AND run_id = $3
               AND lifecycle_revision = $6
             RETURNING ${runColumns}`,
            [run.projectId, run.jobId, run.runId, nextRevision, input.now, run.lifecycleRevision],
          );
          if (!updated.rows[0]) return undefined;
          await client.query(
            `INSERT INTO discovery.run_lifecycle_history (
              project_id, run_id, job_id, lifecycle_revision, from_state, to_state,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, occurred_at
            ) VALUES ($1, $2, $3, $4, $5, 'RUNNING', NULL, NULL, NULL, NULL, $6)`,
            [run.projectId, run.runId, run.jobId, nextRevision, run.lifecycleState, input.now],
          );
          run = mapRun(updated.rows[0]);
        }

        const latestResult = await client.query<RuntimeClaimAttemptRow>(
          `SELECT ${claimAttemptColumns}
           FROM discovery.attempts
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3
           ORDER BY attempt_number DESC
           LIMIT 1 FOR UPDATE`,
          [job.projectId, job.jobId, run.runId],
        );
        let attemptRow: RuntimeClaimAttemptRow;
        const latest = latestResult.rows[0];
        if (!latest) {
          const attemptId = randomUUID();
          const inserted = await client.query<RuntimeClaimAttemptRow>(
            `INSERT INTO discovery.attempts (
              project_id, attempt_id, run_id, job_id, attempt_number,
              lifecycle_revision, attempt_kind, lifecycle_state, previous_attempt_id,
              schema_version, created_at, updated_at, completed_at,
              lease_owner, lease_acquired_at, lease_expires_at, fencing_token
            ) VALUES ($1, $2, $3, $4, 1, 1, 'INITIAL', 'RUNNING', NULL,
              '1.0.0', $5, $5, NULL, $6, $5, $7, 1)
             RETURNING ${claimAttemptColumns}`,
            [job.projectId, attemptId, run.runId, job.jobId, input.now, workerId, expiresAt],
          );
          attemptRow = inserted.rows[0]!;
          await client.query(
            `INSERT INTO discovery.attempt_lifecycle_history (
              project_id, attempt_id, run_id, job_id, lifecycle_revision,
              from_state, to_state, occurred_at
            ) VALUES ($1, $2, $3, $4, 1, NULL, 'RUNNING', $5)`,
            [job.projectId, attemptId, run.runId, job.jobId, input.now],
          );
        } else if (latest.lifecycle_state === 'FAILED_RETRYABLE') {
          const attemptId = randomUUID();
          const attemptNumber = latest.attempt_number + 1;
          const inserted = await client.query<RuntimeClaimAttemptRow>(
            `INSERT INTO discovery.attempts (
              project_id, attempt_id, run_id, job_id, attempt_number,
              lifecycle_revision, attempt_kind, lifecycle_state, previous_attempt_id,
              schema_version, created_at, updated_at, completed_at,
              lease_owner, lease_acquired_at, lease_expires_at, fencing_token
            ) VALUES ($1, $2, $3, $4, $5, 1, 'DOMAIN_RETRY', 'RUNNING', $6,
              '1.0.0', $7, $7, NULL, $8, $7, $9, 1)
             RETURNING ${claimAttemptColumns}`,
            [
              job.projectId,
              attemptId,
              run.runId,
              job.jobId,
              attemptNumber,
              latest.attempt_id,
              input.now,
              workerId,
              expiresAt,
            ],
          );
          attemptRow = inserted.rows[0]!;
          await client.query(
            `INSERT INTO discovery.attempt_lifecycle_history (
              project_id, attempt_id, run_id, job_id, lifecycle_revision,
              from_state, to_state, occurred_at
            ) VALUES ($1, $2, $3, $4, 1, NULL, 'RUNNING', $5)`,
            [job.projectId, attemptId, run.runId, job.jobId, input.now],
          );
        } else {
          if (!['RUNNING', 'PARTIAL', 'QUEUED'].includes(latest.lifecycle_state)) {
            return undefined;
          }
          const targetState = latest.lifecycle_state === 'RUNNING' ? 'RUNNING' : 'RUNNING';
          const nextRevision =
            latest.lifecycle_state === 'RUNNING'
              ? latest.lifecycle_revision
              : latest.lifecycle_revision + 1;
          const fencingToken = numberValue(latest.fencing_token, 'fencingToken') + 1;
          const updated = await client.query<RuntimeClaimAttemptRow>(
            `UPDATE discovery.attempts
             SET lifecycle_state = $5, lifecycle_revision = $6,
                 updated_at = $7, completed_at = NULL,
                 lease_owner = $8, lease_acquired_at = $7,
                 lease_expires_at = $9, fencing_token = $10
             WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
             RETURNING ${claimAttemptColumns}`,
            [
              latest.project_id,
              latest.job_id,
              latest.run_id,
              latest.attempt_id,
              targetState,
              nextRevision,
              input.now,
              workerId,
              expiresAt,
              fencingToken,
            ],
          );
          if (!updated.rows[0]) return undefined;
          if (latest.lifecycle_state !== 'RUNNING') {
            await client.query(
              `INSERT INTO discovery.attempt_lifecycle_history (
                project_id, attempt_id, run_id, job_id, lifecycle_revision,
                from_state, to_state, occurred_at
              ) VALUES ($1, $2, $3, $4, $5, $6, 'RUNNING', $7)`,
              [
                latest.project_id,
                latest.attempt_id,
                latest.run_id,
                latest.job_id,
                nextRevision,
                latest.lifecycle_state,
                input.now,
              ],
            );
          }
          attemptRow = updated.rows[0]!;
        }

        for (const [index, stageType] of DISCOVERY_EXECUTION_STAGE_TYPES.entries()) {
          await client.query(
            `INSERT INTO discovery.stages (
              project_id, stage_id, run_id, attempt_id, job_id, stage_ordinal,
              stage_type, stage_revision, state, schema_version, created_at,
              updated_at, completed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'QUEUED', '1.0.0', $8, $8, NULL)
            ON CONFLICT (project_id, run_id, attempt_id, stage_ordinal) DO NOTHING`,
            [
              job.projectId,
              randomUUID(),
              run.runId,
              attemptRow.attempt_id,
              job.jobId,
              index + 1,
              stageType,
              input.now,
            ],
          );
        }

        return {
          projectId: job.projectId,
          jobId: job.jobId,
          runId: run.runId,
          attemptId: attemptRow.attempt_id,
          workerId,
          fencingToken: numberValue(attemptRow.fencing_token, 'fencingToken'),
          acquiredAt: dateValue(attemptRow.lease_acquired_at!),
          expiresAt: dateValue(attemptRow.lease_expires_at!),
          job,
          run,
          attempt: mapAttempt(attemptRow),
        };
      },
      { module: 'discovery-runtime', operation: 'claim-next' },
    );
  }

  async renewLease(
    input: DiscoveryRuntimeLeaseMutationInputV1,
  ): Promise<DiscoveryRuntimeLeaseV1 | 'STALE' | 'NOT_FOUND'> {
    const now = isoDate(input.now, 'now');
    const duration = boundedLeaseDuration(input.leaseDurationMs ?? 30_000);
    const expiresAt = new Date(now.getTime() + duration).toISOString();
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, now.toISOString());
        if (status !== 'ACTIVE') return status;
        const updated = await client.query<RuntimeClaimAttemptRow>(
          `UPDATE discovery.attempts
           SET lease_expires_at = $6
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
             AND lease_owner = $5 AND fencing_token = $7
           RETURNING ${claimAttemptColumns}`,
          [
            input.projectId,
            input.jobId,
            input.runId,
            input.attemptId,
            input.workerId,
            expiresAt,
            input.fencingToken,
          ],
        );
        const row = updated.rows[0];
        if (!row) return 'STALE';
        return {
          projectId: input.projectId,
          jobId: input.jobId,
          runId: input.runId,
          attemptId: input.attemptId,
          workerId: input.workerId,
          fencingToken: numberValue(row.fencing_token, 'fencingToken'),
          acquiredAt: dateValue(row.lease_acquired_at!),
          expiresAt: dateValue(row.lease_expires_at!),
        };
      },
      { module: 'discovery-runtime', operation: 'lease-renew' },
    );
  }

  async releaseLease(
    input: DiscoveryRuntimeLeaseV1 & { readonly now: string },
  ): Promise<'RELEASED' | 'STALE' | 'NOT_FOUND'> {
    const now = isoDate(input.now, 'now');
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, now.toISOString());
        if (status !== 'ACTIVE') return status;
        const released = await client.query(
          `UPDATE discovery.attempts
           SET lease_owner = NULL, lease_acquired_at = NULL, lease_expires_at = NULL,
               updated_at = $5
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
             AND lease_owner = $6 AND fencing_token = $7`,
          [
            input.projectId,
            input.jobId,
            input.runId,
            input.attemptId,
            input.now,
            input.workerId,
            input.fencingToken,
          ],
        );
        return released.rowCount === 1 ? 'RELEASED' : 'STALE';
      },
      { module: 'discovery-runtime', operation: 'lease-release' },
    );
  }

  async transitionStageWithLease(
    input: DiscoveryRuntimeFencedStageTransitionInputV1,
  ): Promise<DiscoveryStageV1 | 'NOT_FOUND' | 'CONFLICT' | 'STALE'> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, input.updatedAt);
        if (status !== 'ACTIVE') return status;
        const result = await client.query<RuntimeStageRow>(
          `SELECT ${stageColumns} FROM discovery.stages
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
      { module: 'discovery-runtime', operation: 'stage-transition-fenced' },
    );
  }

  async transitionAttemptWithLease(
    input: DiscoveryRuntimeFencedAttemptTransitionInputV1,
  ): Promise<DiscoveryAttemptV1 | 'NOT_FOUND' | 'CONFLICT' | 'STALE'> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, input.updatedAt);
        if (status !== 'ACTIVE') return status;
        const result = await client.query<RuntimeAttemptRow>(
          `SELECT ${attemptColumns} FROM discovery.attempts
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
           FOR UPDATE`,
          [input.projectId, input.jobId, input.runId, input.attemptId],
        );
        const row = result.rows[0];
        if (!row) return 'NOT_FOUND';
        const current = mapAttempt(row);
        if (current.lifecycleRevision !== input.expectedLifecycleRevision) return 'CONFLICT';
        assertDiscoveryAttemptLifecycleTransitionV1(current.lifecycleState, input.targetState);
        const completedAt = completedAtForState(
          input.targetState,
          input.updatedAt,
          input.completedAt,
        );
        const updated = await client.query<RuntimeAttemptRow>(
          `UPDATE discovery.attempts
           SET lifecycle_state = $5, lifecycle_revision = $6,
               updated_at = $7, completed_at = $8
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
             AND lifecycle_revision = $9
           RETURNING ${attemptColumns}`,
          [
            input.projectId,
            input.jobId,
            input.runId,
            input.attemptId,
            input.targetState,
            input.expectedLifecycleRevision + 1,
            input.updatedAt,
            completedAt,
            input.expectedLifecycleRevision,
          ],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) return 'CONFLICT';
        await client.query(
          `INSERT INTO discovery.attempt_lifecycle_history (
            project_id, attempt_id, run_id, job_id, lifecycle_revision,
            from_state, to_state, occurred_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            input.projectId,
            input.attemptId,
            input.runId,
            input.jobId,
            input.expectedLifecycleRevision + 1,
            current.lifecycleState,
            input.targetState,
            input.updatedAt,
          ],
        );
        return mapAttempt(updatedRow);
      },
      { module: 'discovery-runtime', operation: 'attempt-transition-fenced' },
    );
  }

  async transitionRunWithLease(
    input: DiscoveryRuntimeFencedRunTransitionInputV1,
  ): Promise<DiscoveryRunV1 | 'NOT_FOUND' | 'CONFLICT' | 'STALE'> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, input.updatedAt);
        if (status !== 'ACTIVE') return status;
        const result = await client.query<RuntimeRunRow>(
          `SELECT ${runColumns} FROM discovery.runs
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3
           FOR UPDATE`,
          [input.projectId, input.jobId, input.runId],
        );
        const currentRow = result.rows[0];
        if (!currentRow) return 'NOT_FOUND';
        const current = mapRun(currentRow);
        if (current.lifecycleRevision !== input.expectedLifecycleRevision) return 'CONFLICT';
        assertDiscoveryRuntimeLifecycleTransitionV1(current.lifecycleState, input.targetState);
        const nextWait =
          input.targetState === 'WAITING_FOR_PROJECTION'
            ? (input.projectionWait ?? current.projectionWait)
            : undefined;
        if (input.targetState === 'WAITING_FOR_PROJECTION' && nextWait === undefined) {
          throw new TypeError('projectionWait is required while waiting for projection');
        }
        if (
          nextWait !== undefined &&
          semanticStableJson(nextWait.requiredDiscoveryBase) !==
            semanticStableJson(current.requiredDiscoveryBase)
        ) {
          throw new TypeError('projectionWait.requiredDiscoveryBase: must match Run binding');
        }
        const [
          waitProjectionRevision,
          waitProjectionDigest,
          waitDeadlineAt,
          waitFallbackPolicyRevision,
        ] = waitValues(nextWait);
        const completedAt = completedAtForState(
          input.targetState,
          input.updatedAt,
          input.completedAt,
        );
        const updated = await client.query<RuntimeRunRow>(
          `UPDATE discovery.runs
           SET lifecycle_state = $4, lifecycle_revision = $5,
               wait_projection_revision = $6, wait_projection_digest = $7,
               wait_deadline_at = $8, wait_fallback_policy_revision = $9,
               updated_at = $10, completed_at = $11
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3
             AND lifecycle_revision = $12
           RETURNING ${runColumns}`,
          [
            input.projectId,
            input.jobId,
            input.runId,
            input.targetState,
            input.expectedLifecycleRevision + 1,
            waitProjectionRevision,
            waitProjectionDigest,
            waitDeadlineAt,
            waitFallbackPolicyRevision,
            input.updatedAt,
            completedAt,
            input.expectedLifecycleRevision,
          ],
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) return 'CONFLICT';
        await client.query(
          `INSERT INTO discovery.run_lifecycle_history (
            project_id, run_id, job_id, lifecycle_revision, from_state, to_state,
            wait_projection_revision, wait_projection_digest, wait_deadline_at,
            wait_fallback_policy_revision, occurred_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            input.projectId,
            input.runId,
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
        return mapRun(updatedRow);
      },
      { module: 'discovery-runtime', operation: 'run-transition-fenced' },
    );
  }

  async transitionJobWithLease(
    input: DiscoveryRuntimeFencedJobTransitionInputV1,
  ): Promise<DiscoveryJobV1 | 'NOT_FOUND' | 'CONFLICT' | 'STALE'> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, input.updatedAt);
        if (status !== 'ACTIVE') return status;
        const result = await client.query<RuntimeJobRow>(
          `SELECT ${jobColumns} FROM discovery.jobs
           WHERE project_id = $1 AND job_id = $2 FOR UPDATE`,
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
        const updatedRow = updated.rows[0];
        if (!updatedRow) return 'CONFLICT';
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
        return mapJob(updatedRow);
      },
      { module: 'discovery-runtime', operation: 'job-transition-fenced' },
    );
  }

  async finalizeClaimWithLease(
    input: DiscoveryRuntimeFinalizeInputV1,
  ): Promise<'COMPLETED' | 'PARTIAL' | 'NOT_FOUND' | 'CONFLICT' | 'STALE'> {
    if (input.targetState !== 'SUCCEEDED' && input.targetState !== 'PARTIAL') {
      throw new TypeError('Discovery claim finalization only supports SUCCEEDED or PARTIAL');
    }
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, input.updatedAt);
        if (status !== 'ACTIVE') return status;
        const attemptResult = await client.query<RuntimeAttemptRow>(
          `SELECT ${attemptColumns} FROM discovery.attempts
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
           FOR UPDATE`,
          [input.projectId, input.jobId, input.runId, input.attemptId],
        );
        const runResult = await client.query<RuntimeRunRow>(
          `SELECT ${runColumns} FROM discovery.runs
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3
           FOR UPDATE`,
          [input.projectId, input.jobId, input.runId],
        );
        const jobResult = await client.query<RuntimeJobRow>(
          `SELECT ${jobColumns} FROM discovery.jobs
           WHERE project_id = $1 AND job_id = $2
           FOR UPDATE`,
          [input.projectId, input.jobId],
        );
        const attemptRow = attemptResult.rows[0];
        const runRow = runResult.rows[0];
        const jobRow = jobResult.rows[0];
        if (!attemptRow || !runRow || !jobRow) return 'NOT_FOUND';
        const attempt = mapAttempt(attemptRow);
        const run = mapRun(runRow);
        const job = mapJob(jobRow);
        if (
          attempt.lifecycleRevision !== input.expectedAttemptLifecycleRevision ||
          run.lifecycleRevision !== input.expectedRunLifecycleRevision ||
          job.lifecycleRevision !== input.expectedJobLifecycleRevision
        ) {
          return 'CONFLICT';
        }
        if (attempt.lifecycleState !== input.targetState) {
          assertDiscoveryAttemptLifecycleTransitionV1(attempt.lifecycleState, input.targetState);
        }
        if (run.lifecycleState !== input.targetState) {
          assertDiscoveryRuntimeLifecycleTransitionV1(run.lifecycleState, input.targetState);
        }
        if (job.lifecycleState !== input.targetState) {
          assertDiscoveryRuntimeLifecycleTransitionV1(job.lifecycleState, input.targetState);
        }

        const attemptRevision = input.expectedAttemptLifecycleRevision + 1;
        const runRevision = input.expectedRunLifecycleRevision + 1;
        const jobRevision = input.expectedJobLifecycleRevision + 1;
        const completedAt = completedAtForState(input.targetState, input.updatedAt, undefined);
        if (attempt.lifecycleState !== input.targetState) {
          const updated = await client.query(
            `UPDATE discovery.attempts
             SET lifecycle_state = $5, lifecycle_revision = $6,
                 updated_at = $7, completed_at = $8
             WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
               AND lifecycle_revision = $9`,
            [
              input.projectId,
              input.jobId,
              input.runId,
              input.attemptId,
              input.targetState,
              attemptRevision,
              input.updatedAt,
              completedAt,
              input.expectedAttemptLifecycleRevision,
            ],
          );
          if (updated.rowCount !== 1) return 'CONFLICT';
          await client.query(
            `INSERT INTO discovery.attempt_lifecycle_history (
              project_id, attempt_id, run_id, job_id, lifecycle_revision,
              from_state, to_state, occurred_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              input.projectId,
              input.attemptId,
              input.runId,
              input.jobId,
              attemptRevision,
              attempt.lifecycleState,
              input.targetState,
              input.updatedAt,
            ],
          );
        }
        if (run.lifecycleState !== input.targetState) {
          const updated = await client.query(
            `UPDATE discovery.runs
             SET lifecycle_state = $4, lifecycle_revision = $5,
                 wait_projection_revision = NULL, wait_projection_digest = NULL,
                 wait_deadline_at = NULL, wait_fallback_policy_revision = NULL,
                 updated_at = $6, completed_at = $7
             WHERE project_id = $1 AND job_id = $2 AND run_id = $3
               AND lifecycle_revision = $8`,
            [
              input.projectId,
              input.jobId,
              input.runId,
              input.targetState,
              runRevision,
              input.updatedAt,
              completedAt,
              input.expectedRunLifecycleRevision,
            ],
          );
          if (updated.rowCount !== 1) return 'CONFLICT';
          await client.query(
            `INSERT INTO discovery.run_lifecycle_history (
              project_id, run_id, job_id, lifecycle_revision, from_state, to_state,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, occurred_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, NULL, NULL, $7)`,
            [
              input.projectId,
              input.runId,
              input.jobId,
              runRevision,
              run.lifecycleState,
              input.targetState,
              input.updatedAt,
            ],
          );
        }
        if (job.lifecycleState !== input.targetState) {
          const updated = await client.query(
            `UPDATE discovery.jobs
             SET lifecycle_state = $3, lifecycle_revision = $4,
                 wait_projection_revision = NULL, wait_projection_digest = NULL,
                 wait_deadline_at = NULL, wait_fallback_policy_revision = NULL,
                 updated_at = $5
             WHERE project_id = $1 AND job_id = $2 AND lifecycle_revision = $6`,
            [
              input.projectId,
              input.jobId,
              input.targetState,
              jobRevision,
              input.updatedAt,
              input.expectedJobLifecycleRevision,
            ],
          );
          if (updated.rowCount !== 1) return 'CONFLICT';
          await client.query(
            `INSERT INTO discovery.job_lifecycle_history (
              project_id, job_id, lifecycle_revision, from_state, to_state,
              wait_projection_revision, wait_projection_digest, wait_deadline_at,
              wait_fallback_policy_revision, occurred_at
            ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, NULL, NULL, $6)`,
            [
              input.projectId,
              input.jobId,
              jobRevision,
              job.lifecycleState,
              input.targetState,
              input.updatedAt,
            ],
          );
        }
        return input.targetState === 'SUCCEEDED' ? 'COMPLETED' : 'PARTIAL';
      },
      { module: 'discovery-runtime', operation: 'claim-finalize-fenced' },
    );
  }

  async finalizeFailureWithLease(
    input: DiscoveryRuntimeFailureFinalizationInputV1,
  ): Promise<'FAILED_RETRYABLE' | 'FAILED_TERMINAL' | 'NOT_FOUND' | 'CONFLICT' | 'STALE'> {
    const failure = input.failure;
    if ((failure.classification === 'RETRYABLE') !== failure.retryable) {
      throw new TypeError('failure classification and retryable flag must agree');
    }
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, failure.occurredAt);
        if (status !== 'ACTIVE') return status;
        const attemptResult = await client.query<RuntimeAttemptRow>(
          `SELECT ${attemptColumns} FROM discovery.attempts
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
           FOR UPDATE`,
          [input.projectId, input.jobId, input.runId, input.attemptId],
        );
        const runResult = await client.query<RuntimeRunRow>(
          `SELECT ${runColumns} FROM discovery.runs
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 FOR UPDATE`,
          [input.projectId, input.jobId, input.runId],
        );
        const jobResult = await client.query<RuntimeJobRow>(
          `SELECT ${jobColumns} FROM discovery.jobs
           WHERE project_id = $1 AND job_id = $2 FOR UPDATE`,
          [input.projectId, input.jobId],
        );
        const attemptRow = attemptResult.rows[0];
        const runRow = runResult.rows[0];
        const jobRow = jobResult.rows[0];
        if (!attemptRow || !runRow || !jobRow) return 'NOT_FOUND';
        if (
          attemptRow.lifecycle_revision !== input.expectedAttemptLifecycleRevision ||
          runRow.lifecycle_revision !== input.expectedRunLifecycleRevision ||
          jobRow.lifecycle_revision !== input.expectedJobLifecycleRevision
        ) {
          return 'CONFLICT';
        }
        const attempt = mapAttempt(attemptRow);
        const run = mapRun(runRow);
        const job = mapJob(jobRow);
        const target = input.targetState;
        if (attempt.lifecycleState !== target) {
          assertDiscoveryAttemptLifecycleTransitionV1(attempt.lifecycleState, target);
        }
        if (run.lifecycleState !== target) {
          assertDiscoveryRuntimeLifecycleTransitionV1(run.lifecycleState, target);
        }
        if (job.lifecycleState !== target) {
          assertDiscoveryRuntimeLifecycleTransitionV1(job.lifecycleState, target);
        }
        if (input.stageId !== undefined) {
          const stageResult = await client.query<RuntimeStageRow>(
            `SELECT ${stageColumns} FROM discovery.stages
             WHERE project_id = $1 AND stage_id = $2 AND run_id = $3
               AND attempt_id = $4 AND job_id = $5 FOR UPDATE`,
            [input.projectId, input.stageId, input.runId, input.attemptId, input.jobId],
          );
          const stage = stageResult.rows[0];
          if (!stage) return 'NOT_FOUND';
          if (
            input.expectedStageRevision === undefined ||
            stage.stage_revision !== input.expectedStageRevision
          ) {
            return 'CONFLICT';
          }
          if (stage.state !== target) {
            assertDiscoveryRuntimeStageTransitionV1(
              stage.state as DiscoveryRuntimeStageStateV1,
              target as DiscoveryRuntimeStageStateV1,
            );
            const stageUpdated = await client.query(
              `UPDATE discovery.stages
               SET state = $5, stage_revision = $6, updated_at = $7, completed_at = $8
               WHERE project_id = $1 AND stage_id = $2 AND run_id = $3
                 AND attempt_id = $4 AND stage_revision = $9`,
              [
                input.projectId,
                input.stageId,
                input.runId,
                input.attemptId,
                target,
                stage.stage_revision + 1,
                failure.occurredAt,
                failure.occurredAt,
                stage.stage_revision,
              ],
            );
            if (stageUpdated.rowCount !== 1) return 'CONFLICT';
            await client.query(
              `INSERT INTO discovery.stage_history (
                 project_id, stage_id, run_id, attempt_id, stage_revision, state, occurred_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                input.projectId,
                input.stageId,
                input.runId,
                input.attemptId,
                stage.stage_revision + 1,
                target,
                failure.occurredAt,
              ],
            );
          }
        }
        const completedAt = completedAtForState(target, failure.occurredAt, undefined);
        if (attempt.lifecycleState !== target) {
          const nextRevision = attempt.lifecycleRevision + 1;
          const updated = await client.query(
            `UPDATE discovery.attempts
             SET lifecycle_state = $5, lifecycle_revision = $6,
                 failure_code = $7, failure_classification = $8,
                 failure_retryable = $9, failure_safe_message = $10,
                 failure_stage = $11, failure_occurred_at = $12,
                 retry_not_before = $13, updated_at = $12, completed_at = $14
             WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
               AND lifecycle_revision = $15 AND lease_owner = $16 AND fencing_token = $17`,
            [
              input.projectId,
              input.jobId,
              input.runId,
              input.attemptId,
              target,
              nextRevision,
              nonEmpty(failure.code, 'failure.code'),
              failure.classification,
              failure.retryable,
              nonEmpty(failure.safeMessage, 'failure.safeMessage'),
              nonEmpty(failure.failedStage, 'failure.failedStage'),
              failure.occurredAt,
              failure.retryNotBefore ?? null,
              completedAt,
              input.expectedAttemptLifecycleRevision,
              input.workerId,
              input.fencingToken,
            ],
          );
          if (updated.rowCount !== 1) return 'STALE';
          await client.query(
            `INSERT INTO discovery.attempt_lifecycle_history (
               project_id, attempt_id, run_id, job_id, lifecycle_revision,
               from_state, to_state, occurred_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              input.projectId,
              input.attemptId,
              input.runId,
              input.jobId,
              nextRevision,
              attempt.lifecycleState,
              target,
              failure.occurredAt,
            ],
          );
        }
        if (run.lifecycleState !== target) {
          const nextRevision = run.lifecycleRevision + 1;
          const updated = await client.query(
            `UPDATE discovery.runs
             SET lifecycle_state = $4, lifecycle_revision = $5,
                 wait_projection_revision = NULL, wait_projection_digest = NULL,
                 wait_deadline_at = NULL, wait_fallback_policy_revision = NULL,
                 updated_at = $6, completed_at = $7
             WHERE project_id = $1 AND job_id = $2 AND run_id = $3
               AND lifecycle_revision = $8`,
            [
              input.projectId,
              input.jobId,
              input.runId,
              target,
              nextRevision,
              failure.occurredAt,
              completedAt,
              input.expectedRunLifecycleRevision,
            ],
          );
          if (updated.rowCount !== 1) return 'CONFLICT';
          await client.query(
            `INSERT INTO discovery.run_lifecycle_history (
               project_id, run_id, job_id, lifecycle_revision, from_state, to_state,
               wait_projection_revision, wait_projection_digest, wait_deadline_at,
               wait_fallback_policy_revision, occurred_at
             ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, NULL, NULL, $7)`,
            [
              input.projectId,
              input.runId,
              input.jobId,
              nextRevision,
              run.lifecycleState,
              target,
              failure.occurredAt,
            ],
          );
        }
        if (job.lifecycleState !== target) {
          const nextRevision = job.lifecycleRevision + 1;
          const updated = await client.query(
            `UPDATE discovery.jobs
             SET lifecycle_state = $3, lifecycle_revision = $4,
                 wait_projection_revision = NULL, wait_projection_digest = NULL,
                 wait_deadline_at = NULL, wait_fallback_policy_revision = NULL,
                 updated_at = $5
             WHERE project_id = $1 AND job_id = $2 AND lifecycle_revision = $6`,
            [
              input.projectId,
              input.jobId,
              target,
              nextRevision,
              failure.occurredAt,
              input.expectedJobLifecycleRevision,
            ],
          );
          if (updated.rowCount !== 1) return 'CONFLICT';
          await client.query(
            `INSERT INTO discovery.job_lifecycle_history (
               project_id, job_id, lifecycle_revision, from_state, to_state,
               wait_projection_revision, wait_projection_digest, wait_deadline_at,
               wait_fallback_policy_revision, occurred_at
             ) VALUES ($1, $2, $3, $4, $5, NULL, NULL, NULL, NULL, $6)`,
            [
              input.projectId,
              input.jobId,
              nextRevision,
              job.lifecycleState,
              target,
              failure.occurredAt,
            ],
          );
        }
        return target;
      },
      { module: 'discovery-runtime', operation: 'claim-failure-finalize-fenced' },
    );
  }

  async saveFailureContext(
    input: DiscoveryRuntimeLeaseV1 & { readonly failure: DiscoveryRuntimeFailureContextV1 },
  ): Promise<'SAVED' | 'STALE' | 'NOT_FOUND'> {
    const failure = input.failure;
    if ((failure.classification === 'RETRYABLE') !== failure.retryable) {
      throw new TypeError('failure classification and retryable flag must agree');
    }
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, failure.occurredAt);
        if (status !== 'ACTIVE') return status;
        const updated = await client.query(
          `UPDATE discovery.attempts
           SET failure_code = $5, failure_classification = $6,
               failure_retryable = $7, failure_safe_message = $8,
               failure_stage = $9, failure_occurred_at = $10,
               retry_not_before = $11, updated_at = $10
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND attempt_id = $4
             AND lease_owner = $12 AND fencing_token = $13`,
          [
            input.projectId,
            input.jobId,
            input.runId,
            input.attemptId,
            nonEmpty(failure.code, 'failure.code'),
            failure.classification,
            failure.retryable,
            nonEmpty(failure.safeMessage, 'failure.safeMessage'),
            nonEmpty(failure.failedStage, 'failure.failedStage'),
            failure.occurredAt,
            failure.retryNotBefore ?? null,
            input.workerId,
            input.fencingToken,
          ],
        );
        return updated.rowCount === 1 ? 'SAVED' : 'STALE';
      },
      { module: 'discovery-runtime', operation: 'failure-context-save' },
    );
  }

  async readBudgetCheckpoint(
    lookup: DiscoveryRuntimeRunLookupV1,
  ): Promise<DiscoveryRuntimeBudgetCheckpointV1 | undefined> {
    const result = await this.pool.query<RuntimeBudgetCheckpointRow>(
      `SELECT project_id, job_id, run_id, revision, snapshot, fencing_token, updated_at
       FROM discovery.work_budget_checkpoints
       WHERE project_id = $1 AND job_id = $2 AND run_id = $3`,
      [lookup.projectId, lookup.jobId, lookup.runId],
    );
    return result.rows[0] ? snapshotFromRow(result.rows[0]) : undefined;
  }

  async readProviderReservationUsage(lookup: DiscoveryRuntimeRunLookupV1): Promise<{
    readonly providerCalls: number;
    readonly activeProviderCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostMicros: number;
  }> {
    const result = await this.pool.query<{
      provider_calls: string;
      active_provider_calls: string;
      input_tokens: string;
      output_tokens: string;
      estimated_cost_micros: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE state <> 'CANCELLED')::text AS provider_calls,
         COUNT(*) FILTER (WHERE state = 'RESERVED' AND EXISTS (
           SELECT 1
           FROM discovery.attempts active_attempt
           WHERE active_attempt.project_id = discovery.provider_budget_reservations.project_id
             AND active_attempt.job_id = discovery.provider_budget_reservations.job_id
             AND active_attempt.run_id = discovery.provider_budget_reservations.run_id
             AND active_attempt.attempt_id = discovery.provider_budget_reservations.attempt_id
             AND active_attempt.fencing_token = discovery.provider_budget_reservations.fencing_token
             AND active_attempt.lifecycle_state IN ('RUNNING', 'PARTIAL', 'QUEUED')
         ))::text AS active_provider_calls,
         COALESCE(SUM(CASE WHEN state <> 'CANCELLED'
           THEN COALESCE(actual_input_tokens, input_token_upper_bound) ELSE 0 END), 0)::text
           AS input_tokens,
         COALESCE(SUM(CASE WHEN state <> 'CANCELLED'
           THEN COALESCE(actual_output_tokens, max_output_tokens) ELSE 0 END), 0)::text
           AS output_tokens,
         COALESCE(SUM(CASE WHEN state <> 'CANCELLED'
           THEN COALESCE(actual_cost_micros, estimated_cost_micros) ELSE 0 END), 0)::text
           AS estimated_cost_micros
       FROM discovery.provider_budget_reservations
       WHERE project_id = $1 AND job_id = $2 AND run_id = $3`,
      [lookup.projectId, lookup.jobId, lookup.runId],
    );
    const row = result.rows[0];
    return {
      providerCalls: numberValue(row?.provider_calls ?? 0, 'provider reservation providerCalls'),
      activeProviderCalls: numberValue(
        row?.active_provider_calls ?? 0,
        'provider reservation activeProviderCalls',
      ),
      inputTokens: numberValue(row?.input_tokens ?? 0, 'provider reservation inputTokens'),
      outputTokens: numberValue(row?.output_tokens ?? 0, 'provider reservation outputTokens'),
      estimatedCostMicros: numberValue(
        row?.estimated_cost_micros ?? 0,
        'provider reservation estimatedCostMicros',
      ),
    };
  }

  async writeBudgetCheckpoint(
    input: DiscoveryRuntimeLeaseV1 & {
      readonly checkpoint: DiscoveryRuntimeBudgetCheckpointV1;
    },
  ): Promise<'SAVED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'> {
    const checkpoint = input.checkpoint;
    if (
      checkpoint.projectId !== input.projectId ||
      checkpoint.jobId !== input.jobId ||
      checkpoint.runId !== input.runId
    ) {
      throw new TypeError('budget checkpoint identity must match its leased attempt');
    }
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, checkpoint.updatedAt);
        if (status !== 'ACTIVE') return status;
        const currentResult = await client.query<RuntimeBudgetCheckpointRow>(
          `SELECT project_id, job_id, run_id, revision, snapshot, fencing_token, updated_at
           FROM discovery.work_budget_checkpoints
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 FOR UPDATE`,
          [input.projectId, input.jobId, input.runId],
        );
        const current = currentResult.rows[0];
        if (!current) {
          if (checkpoint.revision !== 1) return 'CONFLICT';
          await client.query(
            `INSERT INTO discovery.work_budget_checkpoints (
              project_id, job_id, run_id, revision, snapshot, fencing_token, updated_at
            ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
            [
              checkpoint.projectId,
              checkpoint.jobId,
              checkpoint.runId,
              checkpoint.revision,
              JSON.stringify(checkpoint.snapshot),
              input.fencingToken,
              checkpoint.updatedAt,
            ],
          );
          return 'SAVED';
        }
        const currentSnapshot = snapshotFromRow(current);
        if (cumulativeBudgetSnapshotRegressed(currentSnapshot.snapshot, checkpoint.snapshot)) {
          return 'CONFLICT';
        }
        if (
          current.revision === checkpoint.revision &&
          semanticStableJson(currentSnapshot.snapshot) === semanticStableJson(checkpoint.snapshot)
        ) {
          return 'SAVED';
        }
        if (checkpoint.revision !== current.revision + 1) return 'CONFLICT';
        const updated = await client.query(
          `UPDATE discovery.work_budget_checkpoints
           SET revision = $4, snapshot = $5::jsonb, fencing_token = $6, updated_at = $7
           WHERE project_id = $1 AND job_id = $2 AND run_id = $3 AND revision = $8`,
          [
            checkpoint.projectId,
            checkpoint.jobId,
            checkpoint.runId,
            checkpoint.revision,
            JSON.stringify(checkpoint.snapshot),
            input.fencingToken,
            checkpoint.updatedAt,
            current.revision,
          ],
        );
        return updated.rowCount === 1 ? 'SAVED' : 'CONFLICT';
      },
      { module: 'discovery-runtime', operation: 'budget-checkpoint-write' },
    );
  }

  async readStageOutput(
    lookup: DiscoveryRuntimeStageLookupV1 & { readonly stageId: string },
  ): Promise<DiscoveryRuntimeStageOutputV1 | undefined> {
    const result = await this.pool.query<RuntimeStageOutputRow>(
      `SELECT project_id, job_id, run_id, attempt_id, stage_id, stage_type,
              stage_revision, output, fencing_token, updated_at
       FROM discovery.stage_outputs
       WHERE project_id = $1 AND run_id = $2 AND attempt_id = $3 AND stage_id = $4`,
      [lookup.projectId, lookup.runId, lookup.attemptId, lookup.stageId],
    );
    return result.rows[0] ? mapStageOutput(result.rows[0]) : undefined;
  }

  async writeStageOutput(
    input: DiscoveryRuntimeLeaseV1 & { readonly output: DiscoveryRuntimeStageOutputV1 },
  ): Promise<'SAVED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'> {
    const output = input.output;
    if (
      output.projectId !== input.projectId ||
      output.jobId !== input.jobId ||
      output.runId !== input.runId ||
      output.attemptId !== input.attemptId ||
      output.stageId.trim().length === 0 ||
      !Number.isSafeInteger(output.stageRevision) ||
      output.stageRevision < 1 ||
      typeof output.output !== 'object' ||
      output.output === null
    ) {
      throw new TypeError('stage output identity or JSON object is invalid');
    }
    const encoded = JSON.stringify(output.output);
    if (encoded === undefined) throw new TypeError('stage output is not JSON serializable');
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, output.updatedAt);
        if (status !== 'ACTIVE') return status;
        const stageResult = await client.query<RuntimeStageRow>(
          `SELECT ${stageColumns} FROM discovery.stages
           WHERE project_id = $1 AND stage_id = $2 AND run_id = $3
             AND attempt_id = $4 AND job_id = $5 FOR UPDATE`,
          [input.projectId, output.stageId, input.runId, input.attemptId, input.jobId],
        );
        const stage = stageResult.rows[0];
        if (!stage) return 'NOT_FOUND';
        if (stage.stage_type !== output.stageType || stage.state !== 'RUNNING') {
          return 'CONFLICT';
        }
        const existingResult = await client.query<RuntimeStageOutputRow>(
          `SELECT project_id, job_id, run_id, attempt_id, stage_id, stage_type,
                  stage_revision, output, fencing_token, updated_at
           FROM discovery.stage_outputs
           WHERE project_id = $1 AND attempt_id = $2 AND stage_id = $3
           FOR UPDATE`,
          [input.projectId, input.attemptId, output.stageId],
        );
        const existing = existingResult.rows[0];
        if (existing) {
          if (
            existing.stage_revision === output.stageRevision &&
            semanticStableJson(existing.output) === semanticStableJson(output.output)
          ) {
            return 'SAVED';
          }
          if (output.stageRevision <= existing.stage_revision) return 'CONFLICT';
          const updated = await client.query(
            `UPDATE discovery.stage_outputs
             SET stage_revision = $4, output = $5::jsonb,
                 fencing_token = $6, updated_at = $7
             WHERE project_id = $1 AND attempt_id = $2 AND stage_id = $3
               AND stage_revision = $8`,
            [
              input.projectId,
              input.attemptId,
              output.stageId,
              output.stageRevision,
              encoded,
              input.fencingToken,
              output.updatedAt,
              existing.stage_revision,
            ],
          );
          return updated.rowCount === 1 ? 'SAVED' : 'CONFLICT';
        }
        await client.query(
          `INSERT INTO discovery.stage_outputs (
             project_id, job_id, run_id, attempt_id, stage_id, stage_type,
             stage_revision, output, fencing_token, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
          [
            input.projectId,
            input.jobId,
            input.runId,
            input.attemptId,
            output.stageId,
            output.stageType,
            output.stageRevision,
            encoded,
            input.fencingToken,
            output.updatedAt,
          ],
        );
        return 'SAVED';
      },
      { module: 'discovery-runtime', operation: 'stage-output-write' },
    );
  }

  async reserveProviderCall(
    input: DiscoveryRuntimeLeaseV1 & {
      readonly reservation: DiscoveryRuntimeProviderReservationV1;
    },
  ): Promise<'RESERVED' | 'CONFLICT' | 'STALE' | 'NOT_FOUND'> {
    const reservation = input.reservation;
    if (
      reservation.projectId !== input.projectId ||
      reservation.jobId !== input.jobId ||
      reservation.runId !== input.runId ||
      reservation.attemptId !== input.attemptId ||
      reservation.state !== 'RESERVED'
    ) {
      throw new TypeError('provider reservation identity or state is invalid');
    }
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, reservation.updatedAt);
        if (status !== 'ACTIVE') return status;
        const existingResult = await client.query<RuntimeProviderReservationRow>(
          `SELECT project_id, job_id, run_id, attempt_id, reservation_id,
                  provider_id, model_id, input_token_upper_bound,
                  max_output_tokens, estimated_cost_micros,
                  actual_input_tokens, actual_output_tokens, actual_cost_micros, state,
                  fencing_token, updated_at
           FROM discovery.provider_budget_reservations
           WHERE project_id = $1 AND reservation_id = $2 FOR UPDATE`,
          [input.projectId, reservation.reservationId],
        );
        const existing = existingResult.rows[0];
        if (existing) {
          return existing.job_id === reservation.jobId &&
            existing.run_id === reservation.runId &&
            existing.attempt_id === reservation.attemptId &&
            existing.provider_id === reservation.providerId &&
            existing.model_id === reservation.modelId &&
            existing.input_token_upper_bound === reservation.inputTokenUpperBound &&
            existing.max_output_tokens === reservation.maxOutputTokens &&
            Number(existing.estimated_cost_micros) === reservation.estimatedCostMicros
            ? 'RESERVED'
            : 'CONFLICT';
        }
        await client.query(
          `INSERT INTO discovery.provider_budget_reservations (
             project_id, job_id, run_id, attempt_id, reservation_id,
             provider_id, model_id, input_token_upper_bound, max_output_tokens,
             estimated_cost_micros, state, fencing_token, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'RESERVED', $11, $12, $12)`,
          [
            reservation.projectId,
            reservation.jobId,
            reservation.runId,
            reservation.attemptId,
            nonEmpty(reservation.reservationId, 'reservation.reservationId'),
            nonEmpty(reservation.providerId, 'reservation.providerId'),
            nonEmpty(reservation.modelId, 'reservation.modelId'),
            reservation.inputTokenUpperBound,
            reservation.maxOutputTokens,
            reservation.estimatedCostMicros,
            input.fencingToken,
            reservation.updatedAt,
          ],
        );
        return 'RESERVED';
      },
      { module: 'discovery-runtime', operation: 'provider-reservation-reserve' },
    );
  }

  async finalizeProviderCall(
    input: DiscoveryRuntimeLeaseV1 & {
      readonly reservationId: string;
      readonly state: 'FINALIZED' | 'CANCELLED';
      readonly actualInputTokens?: number;
      readonly actualOutputTokens?: number;
      readonly actualCostMicros?: number;
      readonly updatedAt: string;
    },
  ): Promise<'FINALIZED' | 'CANCELLED' | 'STALE' | 'NOT_FOUND'> {
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, input.updatedAt);
        if (status !== 'ACTIVE') return status;
        const currentResult = await client.query<RuntimeProviderReservationRow>(
          `SELECT project_id, job_id, run_id, attempt_id, reservation_id,
                  provider_id, model_id, input_token_upper_bound,
                  max_output_tokens, estimated_cost_micros,
                  actual_input_tokens, actual_output_tokens, actual_cost_micros, state,
                  fencing_token, updated_at
           FROM discovery.provider_budget_reservations
           WHERE project_id = $1 AND reservation_id = $2 FOR UPDATE`,
          [input.projectId, input.reservationId],
        );
        const current = currentResult.rows[0];
        if (!current) return 'NOT_FOUND';
        if (
          current.job_id !== input.jobId ||
          current.run_id !== input.runId ||
          current.attempt_id !== input.attemptId
        ) {
          return 'NOT_FOUND';
        }
        if (current.state !== 'RESERVED') return current.state;
        if (input.state === 'CANCELLED') {
          if (
            input.actualInputTokens !== undefined ||
            input.actualOutputTokens !== undefined ||
            input.actualCostMicros !== undefined
          ) {
            throw new TypeError('cancelled provider reservations cannot contain actual usage');
          }
        } else {
          if (
            input.actualInputTokens !== undefined &&
            (!Number.isSafeInteger(input.actualInputTokens) ||
              input.actualInputTokens < 0 ||
              input.actualInputTokens > current.input_token_upper_bound)
          ) {
            throw new TypeError('actual provider input usage exceeds its admitted upper bound');
          }
          if (
            input.actualOutputTokens !== undefined &&
            (!Number.isSafeInteger(input.actualOutputTokens) ||
              input.actualOutputTokens < 0 ||
              input.actualOutputTokens > current.max_output_tokens)
          ) {
            throw new TypeError('actual provider output usage exceeds its admitted cap');
          }
          if (
            input.actualCostMicros !== undefined &&
            (!Number.isSafeInteger(input.actualCostMicros) ||
              input.actualCostMicros < 0 ||
              input.actualCostMicros > Number(current.estimated_cost_micros))
          ) {
            throw new TypeError('actual provider cost usage exceeds its admitted estimate');
          }
        }
        const updated = await client.query(
          `UPDATE discovery.provider_budget_reservations
           SET state = $3, actual_input_tokens = $4, actual_output_tokens = $5,
               actual_cost_micros = $6, fencing_token = $7, updated_at = $8
           WHERE project_id = $1 AND reservation_id = $2 AND state = 'RESERVED'`,
          [
            input.projectId,
            input.reservationId,
            input.state,
            input.actualInputTokens ?? null,
            input.actualOutputTokens ?? null,
            input.actualCostMicros ?? null,
            input.fencingToken,
            input.updatedAt,
          ],
        );
        return updated.rowCount === 1 ? input.state : 'STALE';
      },
      { module: 'discovery-runtime', operation: 'provider-reservation-finalize' },
    );
  }

  async publishFindingReady(
    input: DiscoveryRuntimeLeaseV1 & { readonly publication: DiscoveryFindingReadyV1 },
  ): Promise<'CREATED' | 'ALREADY_EXISTS' | 'STALE' | 'NOT_FOUND'> {
    const publication = decodeDiscoveryFindingReadyV1(input.publication);
    if (
      publication.projectId !== input.projectId ||
      publication.jobId !== input.jobId ||
      publication.runId !== input.runId ||
      publication.attemptId !== input.attemptId
    ) {
      throw new TypeError('FindingReady identity must match its leased attempt');
    }
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const status = await leaseStatus(client, input, publication.occurredAt);
        if (status !== 'ACTIVE') return status;
        const findingResult = await client.query<
          QueryResultRow & {
            fingerprint: string;
            fingerprint_version: string;
            canonical_base_version: number;
            canonical_snapshot_digest: string;
            discovery_projection_revision: string;
            discovery_projection_digest: string;
            run_id: string;
          }
        >(
          `SELECT fingerprint, fingerprint_version, canonical_base_version,
                  canonical_snapshot_digest, discovery_projection_revision,
                  discovery_projection_digest, run_id
           FROM discovery.findings
           WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3
           FOR SHARE`,
          [publication.projectId, publication.findingId, publication.findingRevision],
        );
        const finding = findingResult.rows[0];
        if (!finding) return 'NOT_FOUND';
        if (
          finding.fingerprint !== publication.fingerprint ||
          finding.fingerprint_version !== publication.fingerprintVersion ||
          finding.run_id !== publication.runId ||
          finding.canonical_base_version !== publication.canonicalBase.canonicalVersion ||
          finding.canonical_snapshot_digest !== publication.canonicalBase.snapshotDigest ||
          finding.discovery_projection_revision !==
            publication.requiredDiscoveryBase?.projectionRevision ||
          finding.discovery_projection_digest !==
            publication.requiredDiscoveryBase?.projectionDigest
        ) {
          throw new TypeError('FindingReady payload does not match its durable Finding');
        }
        const existingResult = await client.query<RuntimeFindingReadyRow>(
          `SELECT ${findingReadyColumns} FROM discovery.finding_ready
           WHERE publication_id = $1
              OR (project_id = $2 AND finding_id = $3 AND finding_revision = $4)
           FOR UPDATE`,
          [
            publication.publicationId,
            publication.projectId,
            publication.findingId,
            publication.findingRevision,
          ],
        );
        const existing = existingResult.rows[0];
        if (existing) {
          // FindingReady is keyed by durable Finding identity.  An attempt
          // reclaim is allowed to replay publication with a new attemptId,
          // publicationId, and occurredAt; those historical fields are not
          // part of the idempotency comparison.
          if (
            existing.project_id === publication.projectId &&
            existing.finding_id === publication.findingId &&
            existing.finding_revision === publication.findingRevision &&
            existing.fingerprint === publication.fingerprint &&
            existing.fingerprint_version === publication.fingerprintVersion &&
            existing.job_id === publication.jobId &&
            existing.run_id === publication.runId &&
            existing.canonical_base_version === publication.canonicalBase.canonicalVersion &&
            existing.canonical_snapshot_digest === publication.canonicalBase.snapshotDigest &&
            existing.required_projection_revision ===
              (publication.requiredDiscoveryBase?.projectionRevision ?? null) &&
            existing.required_projection_digest ===
              (publication.requiredDiscoveryBase?.projectionDigest ?? null)
          ) {
            return 'ALREADY_EXISTS';
          }
          throw new TypeError(
            'FindingReady publication identity conflicts with existing ledger row',
          );
        }
        const requiredProjection = publication.requiredDiscoveryBase;
        await client.query(
          `INSERT INTO discovery.finding_ready (
            publication_id, project_id, finding_id, finding_revision, fingerprint,
            fingerprint_version, job_id, run_id, attempt_id, canonical_base_version,
            canonical_snapshot_digest, required_projection_revision,
            required_projection_digest, occurred_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            publication.publicationId,
            publication.projectId,
            publication.findingId,
            publication.findingRevision,
            publication.fingerprint,
            publication.fingerprintVersion,
            publication.jobId,
            publication.runId,
            publication.attemptId,
            publication.canonicalBase.canonicalVersion,
            publication.canonicalBase.snapshotDigest,
            requiredProjection?.projectionRevision ?? null,
            requiredProjection?.projectionDigest ?? null,
            publication.occurredAt,
          ],
        );
        return 'CREATED';
      },
      { module: 'discovery-runtime', operation: 'finding-ready-publish' },
    );
  }

  async findFindingReady(
    lookup: Pick<DiscoveryFindingReadyV1, 'projectId' | 'findingId' | 'findingRevision'>,
  ): Promise<DiscoveryFindingReadyV1 | undefined> {
    const result = await this.pool.query<RuntimeFindingReadyRow>(
      `SELECT ${findingReadyColumns} FROM discovery.finding_ready
       WHERE project_id = $1 AND finding_id = $2 AND finding_revision = $3`,
      [lookup.projectId, lookup.findingId, lookup.findingRevision],
    );
    return result.rows[0] ? mapFindingReady(result.rows[0]) : undefined;
  }

  /** Read-only Activity root bridge for the Discovery Product capability. */
  async findActivityBinding(input: {
    readonly projectId: string;
    readonly findingId: string;
    readonly findingRevision: number;
    readonly runId: string;
  }): Promise<{ readonly jobId: string; readonly runId: string } | undefined> {
    const ready = await this.findFindingReady({
      projectId: input.projectId,
      findingId: input.findingId,
      findingRevision: input.findingRevision,
    });
    if (!ready || ready.runId !== input.runId || ready.projectId !== input.projectId) {
      return undefined;
    }
    const [job, run] = await Promise.all([
      this.getJob({ projectId: input.projectId, jobId: ready.jobId }),
      this.getRun({ projectId: input.projectId, jobId: ready.jobId, runId: ready.runId }),
    ]);
    if (
      !job ||
      !run ||
      job.projectId !== input.projectId ||
      run.projectId !== input.projectId ||
      run.jobId !== job.jobId ||
      run.runId !== input.runId
    ) {
      return undefined;
    }
    return { jobId: job.jobId, runId: run.runId };
  }
}
