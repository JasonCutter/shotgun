import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { DiscoveryActivityAdapter } from '../../adapters/frontend-activity-discovery/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { PostgresDiscoveryRuntimeRepository } from '../../adapters/discovery-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  createDiscoveryLogicalJobIdentityV1,
  createDiscoveryFindingEnvelopeV1,
  type DiscoveryAttemptV1,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryJobV1,
  type DiscoveryRunV1,
  type DiscoveryStageV1,
  type DiscoveryTriggerV1,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import type { ActivityAdapterScopeV1 } from '../../modules/frontend-activity/src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectId = 'akp-4-wp5-discovery-activity-project';

const findingColumns = `
  schema_version, finding_id, finding_revision, project_id, finding_type,
  status, generation_method, lifecycle_state, payload, related_resource_refs,
  evidence_ids, source_projection_digest, canonical_base_version,
  canonical_snapshot_digest, discovery_projection_revision,
  discovery_projection_digest, run_id, signal_summary, rationale,
  derivation_summary, provenance, access_scope, sensitivity, fingerprint,
  fingerprint_version, retention_class, created_at, supersedes_finding_id`;

const budget = {
  schemaVersion: '1.0.0' as const,
  budgetVersion: 'discovery-work-budget:v1' as const,
  budgetId: 'wp5-budget',
  budgetRevision: 'wp5-budget-1',
  maxResources: 10,
  maxSemanticNeighbors: 10,
  maxCandidatePairs: 10,
  maxCandidateGroups: 10,
  maxFindings: 10,
  maxProviderCalls: 1,
  maxInputTokens: 100,
  maxOutputTokens: 100,
  maxOutputTokensPerCall: 100,
  maxEstimatedCostMicros: 100,
  maxConcurrentProviderCalls: 1,
  deadlineAt: '2099-01-01T00:00:00.000Z',
};

const trigger: DiscoveryTriggerV1 = {
  schemaVersion: '1.0.0',
  triggerId: 'wp5-trigger',
  triggerClass: 'MANUAL',
  triggerIdentity: { kind: 'MANUAL', commandId: 'wp5-command', requestId: 'wp5-request' },
  projectId,
  requestedScanMode: 'INCREMENTAL',
  effectiveScanMode: 'INCREMENTAL',
  canonicalBase: { schemaVersion: '1.0.0', canonicalVersion: 1, snapshotDigest: 'canonical' },
  requiredDiscoveryBase: {
    schemaVersion: '1.0.0',
    projectionRevision: 'projection-1',
    projectionDigest: 'projection',
  },
  policyRevision: 'policy-1',
  strategyRevision: 'strategy-1',
  createdAt: '2026-08-30T01:00:00.000Z',
  observedAt: '2026-08-30T01:00:00.000Z',
  actor: { actorId: 'wp5-actor', principalId: 'wp5-principal' },
};

const job: DiscoveryJobV1 = {
  schemaVersion: '1.0.0',
  jobId: 'wp5-job-1',
  logicalIdentity: createDiscoveryLogicalJobIdentityV1(trigger),
  projectId,
  trigger,
  requestedScanMode: 'INCREMENTAL',
  effectiveScanMode: 'INCREMENTAL',
  canonicalBase: trigger.canonicalBase,
  requiredDiscoveryBase: trigger.requiredDiscoveryBase,
  policyRevision: trigger.policyRevision,
  strategyRevision: trigger.strategyRevision,
  budget,
  lifecycleState: 'SUCCEEDED',
  lifecycleRevision: 1,
  createdAt: trigger.createdAt,
  updatedAt: '2026-08-30T01:00:09.000Z',
};

const run: DiscoveryRunV1 = {
  schemaVersion: '1.0.0',
  runId: 'wp5-run-1',
  jobId: job.jobId,
  projectId,
  requestedScanMode: job.requestedScanMode,
  effectiveScanMode: job.effectiveScanMode,
  runRevision: 1,
  canonicalBase: job.canonicalBase,
  requiredDiscoveryBase: job.requiredDiscoveryBase,
  policyRevision: job.policyRevision,
  strategyRevision: job.strategyRevision,
  budget: job.budget,
  lifecycleState: 'SUCCEEDED',
  lifecycleRevision: 1,
  createdAt: '2026-08-30T01:00:01.000Z',
  updatedAt: '2026-08-30T01:00:09.000Z',
  completedAt: '2026-08-30T01:00:09.000Z',
};

const attempt1: DiscoveryAttemptV1 = {
  schemaVersion: '1.0.0',
  attemptId: 'wp5-attempt-1',
  jobId: job.jobId,
  runId: run.runId,
  projectId,
  attemptNumber: 1,
  lifecycleRevision: 1,
  attemptKind: 'INITIAL',
  lifecycleState: 'FAILED_RETRYABLE',
  createdAt: '2026-08-30T01:00:02.000Z',
  updatedAt: '2026-08-30T01:00:04.000Z',
  completedAt: '2026-08-30T01:00:04.000Z',
};

const attempt2: DiscoveryAttemptV1 = {
  ...attempt1,
  attemptId: 'wp5-attempt-2',
  attemptNumber: 2,
  attemptKind: 'DOMAIN_RETRY',
  lifecycleState: 'SUCCEEDED',
  previousAttemptId: attempt1.attemptId,
  createdAt: '2026-08-30T01:00:05.000Z',
  updatedAt: '2026-08-30T01:00:09.000Z',
  completedAt: '2026-08-30T01:00:09.000Z',
};

const stage: DiscoveryStageV1 = {
  schemaVersion: '1.0.0',
  stageId: 'wp5-stage-1',
  jobId: job.jobId,
  runId: run.runId,
  attemptId: attempt2.attemptId,
  projectId,
  stageOrdinal: 7,
  stageType: 'RECONCILE_FINDINGS',
  stageRevision: 1,
  state: 'SUCCEEDED',
  createdAt: '2026-08-30T01:00:06.000Z',
  updatedAt: '2026-08-30T01:00:09.000Z',
  completedAt: '2026-08-30T01:00:09.000Z',
};

const scope: ActivityAdapterScopeV1 = {
  principalId: 'wp5-principal',
  activeProjectId: projectId,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  accessScope: ['activity:read'],
  sensitivityClearance: 'internal',
};

const findingForWindow = (
  index: number,
  accessScope: readonly string[],
): DiscoveryFindingEnvelopeV1 => {
  const findingId = `wp5-finding-${String(index).padStart(3, '0')}`;
  const claimRef = {
    schemaVersion: '1.0.0' as const,
    resourceKind: 'CANONICAL_CLAIM' as const,
    resourceId: `wp5-claim-${index}`,
    projectId,
    resourceState: 'CURRENT' as const,
    resourceRevision: '4',
  };
  return createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId,
    findingRevision: 1,
    projectId,
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: `Subject ${index}`,
      missingFact: `Fact ${index} is missing.`,
      question: `Which fact ${index} is authoritative?`,
    },
    relatedResourceRefs: [claimRef],
    evidenceIds: [`wp5-evidence-${index}`],
    sourceProjectionDigest: `sha256:${'1'.repeat(64)}`,
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 12,
      snapshotDigest: `sha256:${'2'.repeat(64)}`,
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-wp5-12',
      projectionDigest: `sha256:${'3'.repeat(64)}`,
    },
    runId: run.runId,
    signalSummary: { evidenceCoverage: 0.4 },
    rationale: `Rationale ${index}.`,
    derivationSummary: `Derived Finding ${index}.`,
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'discovery.wp5.activity.test',
      ruleVersion: '1',
      inputDigest: `sha256:${'4'.repeat(64)}`,
    },
    accessScope,
    sensitivity: 'internal',
    fingerprint: `sha256:${String(index).padStart(2, '0').repeat(32)}`,
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: '2026-08-30T01:00:00.000Z',
  });
};

const insertFinding = async (finding: DiscoveryFindingEnvelopeV1): Promise<void> => {
  await pool!.query(
    `INSERT INTO discovery.findings (${findingColumns})
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
     )`,
    [
      finding.schemaVersion,
      finding.findingId,
      finding.findingRevision,
      finding.projectId,
      finding.findingType,
      finding.status,
      finding.generationMethod,
      finding.lifecycleState,
      JSON.stringify(finding.payload),
      JSON.stringify(finding.relatedResourceRefs),
      finding.evidenceIds,
      finding.sourceProjectionDigest,
      finding.canonicalBase.canonicalVersion,
      finding.canonicalBase.snapshotDigest,
      finding.discoveryBase.projectionRevision,
      finding.discoveryBase.projectionDigest,
      finding.runId,
      JSON.stringify(finding.signalSummary),
      finding.rationale,
      finding.derivationSummary,
      JSON.stringify(finding.provenance),
      finding.accessScope,
      finding.sensitivity,
      finding.fingerprint,
      finding.fingerprintVersion,
      finding.retentionClass,
      finding.createdAt,
      finding.supersedesFindingId ?? null,
    ],
  );
  await pool!.query(
    `INSERT INTO discovery.finding_lifecycle_current (
       project_id, finding_id, finding_revision, lifecycle_state,
       lifecycle_revision, updated_at
     ) VALUES ($1, $2, $3, 'NEW', 1, $4)`,
    [finding.projectId, finding.findingId, finding.findingRevision, finding.createdAt],
  );
};

const insertFindingReady = async (
  finding: DiscoveryFindingEnvelopeV1,
  readyRunId = run.runId,
  readyAttemptId = attempt2.attemptId,
): Promise<void> => {
  await pool!.query(
    `INSERT INTO discovery.finding_ready (
       publication_id, project_id, finding_id, finding_revision, fingerprint,
       fingerprint_version, job_id, run_id, attempt_id, canonical_base_version,
       canonical_snapshot_digest, required_projection_revision,
       required_projection_digest, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, NULL, $12)`,
    [
      `wp5-publication-${finding.findingId}`,
      finding.projectId,
      finding.findingId,
      finding.findingRevision,
      finding.fingerprint,
      finding.fingerprintVersion,
      job.jobId,
      readyRunId,
      readyAttemptId,
      finding.canonicalBase.canonicalVersion,
      finding.canonicalBase.snapshotDigest,
      finding.createdAt,
    ],
  );
};

const insertEligibleReviewResource = async (
  finding: DiscoveryFindingEnvelopeV1,
  options: {
    readonly candidateFinding?: DiscoveryFindingEnvelopeV1;
    readonly suffix?: string;
  } = {},
): Promise<void> => {
  const candidateFinding = options.candidateFinding ?? finding;
  const suffix = options.suffix ?? 'default';
  const manifestId = `wp5-activity-manifest-${suffix}`;
  const candidateId = `wp5-activity-candidate-${suffix}`;
  const reviewResourceId = `wp5-activity-review-resource-${suffix}`;
  const contentDigest = `sha256:${'6'.repeat(64)}`;
  await pool!.query(
    `INSERT INTO discovery.reentry_manifests (
       logical_identity_version, logical_identity_key, manifest_id, project_id,
       finding_id, finding_revision, finding_type, source_projection_digest,
       canonical_base_version, canonical_snapshot_digest,
       requested_reentry_purpose, manifest, created_at
     ) VALUES ('discovery-reentry-identity:v1', $1, $2, $3, $4, 1, 'KNOWLEDGE_GAP',
       $5, 12, $6, 'DERIVED_PROVENANCE_VALIDATION', '{}'::jsonb, $7)`,
    [
      `wp5-activity-logical-identity-${suffix}`,
      manifestId,
      projectId,
      candidateFinding.findingId,
      candidateFinding.sourceProjectionDigest,
      candidateFinding.canonicalBase.snapshotDigest,
      candidateFinding.createdAt,
    ],
  );
  await pool!.query(
    `INSERT INTO discovery.reentry_candidates (
       candidate_id, candidate_revision, logical_identity_key, project_id,
       manifest_id, finding_id, finding_revision, finding_type, origin,
       source_projection_digest, canonical_base_version, canonical_snapshot_digest,
       discovery_projection_revision, discovery_projection_digest,
       related_resource_refs, evidence_ids, derivation_provenance, access_scope,
       sensitivity, validation_profile, reentry_eligibility, review_eligibility,
       candidate, created_at
     ) VALUES ($1, 1, $2, $3, $4, $5, 1, 'KNOWLEDGE_GAP', 'DERIVED_DISCOVERY',
       $6, 12, $7, 'projection-wp5-12', 'sha256:projection', '[]'::jsonb,
       $8, '{}'::jsonb, $9, 'internal', '{}'::jsonb,
       'ELIGIBLE_FOR_VALIDATION', 'NOT_ELIGIBLE', '{}'::jsonb, $10)`,
    [
      candidateId,
      `wp5-activity-candidate-identity-${suffix}`,
      projectId,
      manifestId,
      candidateFinding.findingId,
      candidateFinding.sourceProjectionDigest,
      candidateFinding.canonicalBase.snapshotDigest,
      candidateFinding.evidenceIds,
      candidateFinding.accessScope,
      candidateFinding.createdAt,
    ],
  );
  await pool!.query(
    `INSERT INTO discovery.reentry_review_roots (
       project_id, candidate_id, candidate_revision, review_resource_id,
       identity_version, created_at
     ) VALUES ($1, $2, 1, $3, 'discovery-review-root-identity:v1', $4)`,
    [projectId, candidateId, reviewResourceId, finding.createdAt],
  );
  await pool!.query(
    `INSERT INTO discovery.reentry_review_resources (
       review_resource_id, resource_revision, project_id, effective_project_id,
       candidate_id, candidate_revision, finding_id, finding_revision, finding_type,
       manifest_id, origin, governance_target, source_projection_digest,
       canonical_base_version, canonical_snapshot_digest,
       discovery_projection_revision, discovery_projection_digest,
       related_resource_refs, evidence_ids, evidence_lineage, derivation_provenance,
       access_scope, sensitivity, validation_profile, validation_result,
       lifecycle_state, review_eligibility, content, content_digest, resource,
       created_at, updated_at
     ) VALUES ($1, 1, $2, $2, $3, 1, $4, 1, 'KNOWLEDGE_GAP', $5,
       'DERIVED_DISCOVERY', 'VALIDATION_OR_KNOWLEDGE_GAP_GOVERNANCE', $6, 12, $7,
       'projection-wp5-12', 'sha256:projection', '[]'::jsonb, $8, '[]'::jsonb,
       '{}'::jsonb, $9, 'internal', '{}'::jsonb, '{}'::jsonb, 'REVIEW_READY',
       'ELIGIBLE_AFTER_VALIDATION', '{}'::jsonb, $10, $11::jsonb, $12, $12)`,
    [
      reviewResourceId,
      projectId,
      candidateId,
      finding.findingId,
      manifestId,
      finding.sourceProjectionDigest,
      finding.canonicalBase.snapshotDigest,
      finding.evidenceIds,
      finding.accessScope,
      contentDigest,
      JSON.stringify({
        reviewResourceId,
        resourceRevision: '1',
        projectId,
        candidateId,
        contentDigest,
        lifecycleState: 'REVIEW_READY',
        reviewEligibility: 'ELIGIBLE_AFTER_VALIDATION',
      }),
      finding.createdAt,
    ],
  );
  await pool!.query(
    `UPDATE discovery.finding_lifecycle_current
     SET lifecycle_state = 'REVIEW_READY', lifecycle_revision = 2
     WHERE project_id = $1 AND finding_id = $2 AND finding_revision = 1`,
    [projectId, finding.findingId],
  );
};

describe.runIf(databaseUrl)('AKP-4 WP5 Discovery Activity PostgreSQL read boundary', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    await pool!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'AKP-4 WP5 Discovery Activity', 'ACTIVE', true)
       ON CONFLICT (id) DO NOTHING`,
      [projectId],
    );
  });

  beforeEach(async () => {
    await pool!.query('DELETE FROM discovery.reentry_review_resources WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.reentry_review_roots WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.reentry_candidates WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.reentry_manifests WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.finding_ready WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.finding_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.finding_lifecycle_current WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.findings WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.provider_budget_reservations WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.stage_outputs WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.stage_history WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.stages WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.attempt_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.attempts WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.run_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.runs WHERE project_id = $1', [projectId]);
    await pool!.query('DELETE FROM discovery.job_lifecycle_history WHERE project_id = $1', [
      projectId,
    ]);
    await pool!.query('DELETE FROM discovery.jobs WHERE project_id = $1', [projectId]);
    await pool!.query(
      'DELETE FROM frontend_activity.activity_index WHERE resource_project_id = $1',
      [projectId],
    );
    await pool!.query(
      'DELETE FROM frontend_activity.projection_watermarks WHERE resource_project_id = $1',
      [projectId],
    );

    const runtime = new PostgresDiscoveryRuntimeRepository(pool!);
    expect(await runtime.saveJob(job)).toBe('CREATED');
    expect(await runtime.saveRun(run)).toBe('CREATED');
    expect(await runtime.saveAttempt(attempt1)).toBe('CREATED');
    expect(await runtime.saveAttempt(attempt2)).toBe('CREATED');
    expect(await runtime.saveStage(stage)).toBe('CREATED');
    await pool!.query(
      `UPDATE discovery.attempts
       SET failure_code = 'PROVIDER_TIMEOUT', failure_classification = 'RETRYABLE',
           failure_retryable = true, failure_safe_message = 'The provider timed out.',
           failure_stage = 'GENERATE_FINDINGS', failure_occurred_at = $2,
           retry_not_before = $3
       WHERE project_id = $1 AND attempt_id = $4`,
      [projectId, '2026-08-30T01:00:04.000Z', '2026-08-30T01:00:05.000Z', attempt1.attemptId],
    );
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('keeps one deterministic Job-root identity across repeated reads and preserves retry history', async () => {
    const runtime = new PostgresDiscoveryRuntimeRepository(pool!);
    const adapter = new DiscoveryActivityAdapter(runtime);
    const first = await adapter.readQueue(scope, { limit: 10 });
    const second = await adapter.readQueue(scope, { limit: 10 });
    expect(first.items).toHaveLength(1);
    expect(second.items[0]!.root).toEqual(first.items[0]!.root);
    expect(first.items[0]!.root.activityId).toBe(job.jobId);

    const before = await pool!.query(
      `SELECT lifecycle_state, failure_code, fencing_token, lease_owner
       FROM discovery.attempts WHERE project_id = $1 ORDER BY attempt_number`,
      [projectId],
    );
    const detail = await adapter.readDetail(scope, first.items[0]!.root);
    const after = await pool!.query(
      `SELECT lifecycle_state, failure_code, fencing_token, lease_owner
       FROM discovery.attempts WHERE project_id = $1 ORDER BY attempt_number`,
      [projectId],
    );
    expect(after.rows).toEqual(before.rows);
    expect(detail.attempts.map((attempt) => attempt.attemptId)).toEqual([
      attempt1.attemptId,
      attempt2.attemptId,
    ]);
    expect(detail.attempts[0]!.failure).toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      kind: 'TRANSIENT',
    });
    expect(detail.events.some((event) => event.category === 'RETRY_SCHEDULED')).toBe(true);
    expect(detail.stages.some((stage) => stage.stageKey.includes('reconcile_findings'))).toBe(true);
  });

  it('rejects duplicate logical Job identity without creating a second Activity root', async () => {
    const runtime = new PostgresDiscoveryRuntimeRepository(pool!);
    expect(await runtime.saveJob({ ...job, jobId: 'wp5-job-duplicate' })).toBe('CONFLICT');
    const roots = await new DiscoveryActivityAdapter(runtime).readQueue(scope, { limit: 10 });
    expect(roots.items.map((item) => item.root.activityId)).toEqual([job.jobId]);
  });

  it('enforces project binding and keeps adapter reads side-effect free', async () => {
    const runtime = new PostgresDiscoveryRuntimeRepository(pool!);
    const adapter = new DiscoveryActivityAdapter(runtime);
    const root = (await adapter.readQueue(scope, { limit: 10 })).items[0]!.root;
    expect(await adapter.canAccess(scope, root)).toBe(true);
    expect(await adapter.canAccess({ ...scope, activeProjectId: 'other-project' }, root)).toBe(
      false,
    );
  });

  it('applies visibility before the backlink cap and keeps Attention authoritative beyond it', async () => {
    const activityScope = ['activity:read'];
    for (let index = 1; index <= 23; index += 1) {
      const finding = findingForWindow(index, index <= 2 ? ['hidden:scope'] : activityScope);
      await insertFinding(finding);
      await insertFindingReady(finding);
    }
    const reviewFinding = findingForWindow(24, ['review:read']);
    await insertFinding(reviewFinding);
    await insertFindingReady(reviewFinding);
    await insertEligibleReviewResource(reviewFinding);

    const repository = new PostgresDiscoveryFindingRepository(pool!);
    const activityInput = {
      projectId,
      jobId: job.jobId,
      runId: run.runId,
      accessScope: activityScope,
      sensitivityClearance: 'internal',
    } as const;
    const visible = await repository.listByJobAndRun({ ...activityInput, limit: 21 });
    expect(visible).toHaveLength(21);
    expect(visible[0]!.findingId).toBe('wp5-finding-003');
    expect(visible[20]!.findingId).toBe('wp5-finding-023');
    expect(await repository.hasReviewEligibleByJobAndRun(activityInput)).toBe(false);

    const grantedInput = {
      ...activityInput,
      accessScope: ['activity:read', 'review:read'],
    } as const;
    const grantedVisible = await repository.listByJobAndRun({ ...grantedInput, limit: 21 });
    expect(grantedVisible).toHaveLength(21);
    expect(await repository.hasReviewEligibleByJobAndRun(grantedInput)).toBe(true);
    expect(
      await repository.hasReviewEligibleByJobAndRun({
        ...activityInput,
        projectId: 'different-project',
      }),
    ).toBe(false);
  });

  it('fails closed for cross-linked Candidate/Finding rows in the authoritative chain', async () => {
    const candidateFinding = findingForWindow(25, ['review:read']);
    const reviewFinding = findingForWindow(26, ['review:read']);
    await insertFinding(candidateFinding);
    await insertFindingReady(candidateFinding);
    await insertFinding(reviewFinding);
    await insertFindingReady(reviewFinding);
    await insertEligibleReviewResource(reviewFinding, {
      candidateFinding,
      suffix: 'cross-linked',
    });

    const repository = new PostgresDiscoveryFindingRepository(pool!);
    expect(
      await repository.hasReviewEligibleByJobAndRun({
        projectId,
        jobId: job.jobId,
        runId: run.runId,
        accessScope: ['review:read'],
        sensitivityClearance: 'internal',
      }),
    ).toBe(false);
  });

  it('fails closed when FindingReady belongs to a different run', async () => {
    const finding = findingForWindow(27, ['review:read']);
    const otherRun = {
      ...run,
      runId: 'wp5-run-other',
      createdAt: '2026-08-30T01:01:01.000Z',
      updatedAt: '2026-08-30T01:01:09.000Z',
      completedAt: '2026-08-30T01:01:09.000Z',
    };
    const otherAttempt = {
      ...attempt2,
      attemptId: 'wp5-attempt-other',
      runId: otherRun.runId,
      createdAt: '2026-08-30T01:01:05.000Z',
      updatedAt: '2026-08-30T01:01:09.000Z',
      completedAt: '2026-08-30T01:01:09.000Z',
    };
    const runtime = new PostgresDiscoveryRuntimeRepository(pool!);
    expect(await runtime.saveRun(otherRun)).toBe('CREATED');
    expect(await runtime.saveAttempt(otherAttempt)).toBe('CREATED');
    await insertFinding(finding);
    await insertFindingReady(finding, otherRun.runId, otherAttempt.attemptId);
    await insertEligibleReviewResource(finding, { suffix: 'wrong-run' });

    const repository = new PostgresDiscoveryFindingRepository(pool!);
    expect(
      await repository.hasReviewEligibleByJobAndRun({
        projectId,
        jobId: job.jobId,
        runId: run.runId,
        accessScope: ['review:read'],
        sensitivityClearance: 'internal',
      }),
    ).toBe(false);
  });
});
