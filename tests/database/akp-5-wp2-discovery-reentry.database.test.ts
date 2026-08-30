import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import {
  PostgresDiscoveryApprovedResourceRevisionResolver,
  PostgresDiscoveryReentryRepository,
} from '../../adapters/discovery-reentry-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresCompiledTruthRepository } from '../../adapters/postgres-stage10/src/index.js';
import { PostgresKnowledgeModelRepository } from '../../adapters/postgres-stage9/src/index.js';
import {
  DiscoveryReentryConsumer,
  type DiscoveryApprovedResourceRevisionResolverPort,
} from '../../modules/discovery-reentry/src/index.js';
import {
  createDiscoveryFindingEnvelopeV1,
  approvedKnowledgeDigest,
  approvedKnowledgeSourceIdentity,
  semanticCorpusSourceSnapshotDigest,
  type CompiledTruthProjection,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingReadyV1,
  type DiscoveryResourceKind,
  type KnowledgeCandidate,
  type KnowledgeReviewGroup,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const poolA: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const poolB: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const projectId = `akp-5-wp2-db-${randomUUID()}`;
const claimId = 'claim-wp2-approved-1';
const canonicalRevisionId = 'canonical-revision-wp2-1';
const canonicalVersion = 1;
const canonicalDigest = `sha256:${'c'.repeat(64)}`;
const authoritySourceId = randomUUID();
const authoritySourceVersionId = randomUUID();
const authorityAssetId = randomUUID();
const authorityGroupId = 'knowledge-group-wp2-authority';
const authorityContentDigest = `sha256:${'d'.repeat(64)}`;
const discoveryBase = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'projection-wp2-1',
  projectionDigest: 'sha256:wp2-discovery-base',
};
const now = '2026-08-30T03:00:00.000Z';

const authorityCandidates: readonly KnowledgeCandidate[] = [
  {
    candidateId: 'entity-wp2-approved-1',
    candidateType: 'ENTITY',
    revisionNumber: 7,
    sourceVersionId: authoritySourceVersionId,
    evidenceIds: ['evidence-wp2-authority-1'],
    modelOutputs: [],
    name: 'Approved entity',
    entityKind: 'CONCEPT',
    aliases: [],
    resolution: { status: 'NEW' },
  },
  {
    candidateId: 'relation-wp2-approved-1',
    candidateType: 'RELATION',
    revisionNumber: 8,
    sourceVersionId: authoritySourceVersionId,
    evidenceIds: ['evidence-wp2-authority-2'],
    modelOutputs: [],
    fromCandidateId: 'entity-wp2-approved-1',
    toCandidateId: 'entity-wp2-approved-2',
    relationType: 'RELATED_TO',
    direction: 'DIRECTED',
  },
  {
    candidateId: 'event-wp2-approved-1',
    candidateType: 'EVENT',
    revisionNumber: 9,
    sourceVersionId: authoritySourceVersionId,
    evidenceIds: ['evidence-wp2-authority-3'],
    modelOutputs: [],
    title: 'Approved event',
    participantCandidateIds: ['entity-wp2-approved-1'],
  },
  {
    candidateId: 'decision-wp2-approved-1',
    candidateType: 'DECISION',
    revisionNumber: 10,
    sourceVersionId: authoritySourceVersionId,
    evidenceIds: ['evidence-wp2-authority-4'],
    modelOutputs: [],
    decisionText: 'Approved decision',
  },
  {
    candidateId: 'conflict-wp2-approved-1',
    candidateType: 'CONFLICT',
    revisionNumber: 11,
    sourceVersionId: authoritySourceVersionId,
    evidenceIds: ['evidence-wp2-authority-5'],
    modelOutputs: [],
    subjectCandidateIds: ['entity-wp2-approved-1'],
    summary: 'Approved conflict',
    conflictKind: 'FACTUAL',
  },
  {
    candidateId: 'action-wp2-approved-1',
    candidateType: 'ACTION',
    revisionNumber: 12,
    sourceVersionId: authoritySourceVersionId,
    evidenceIds: ['evidence-wp2-authority-6'],
    modelOutputs: [],
    actionText: 'Approved action candidate',
    executionStatus: 'CANDIDATE_ONLY',
  },
];

const authorityGroup: KnowledgeReviewGroup = {
  groupId: authorityGroupId,
  projectId,
  sourceVersionId: authoritySourceVersionId,
  revisionNumber: 3,
  status: 'APPROVED',
  contentDigest: authorityContentDigest,
  items: authorityCandidates,
  decisions: [],
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: now,
  updatedAt: now,
};

const authoritySourceProjectionDigest = semanticCorpusSourceSnapshotDigest({
  projectId,
  canonicalVersion,
  canonicalSnapshotDigest: canonicalDigest,
  approvedKnowledgeDigest: approvedKnowledgeDigest([
    approvedKnowledgeSourceIdentity(authorityGroup),
  ]),
});
const authorityDiscoveryBase = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'compiled-truth:1.0.0:1',
  projectionDigest: authoritySourceProjectionDigest,
};
const authorityProjection: CompiledTruthProjection = {
  projectId,
  projectorVersion: '1.0.0',
  sourceSnapshotDigest: authoritySourceProjectionDigest,
  logicalDigest: `sha256:${'e'.repeat(64)}`,
  canonicalVersion,
  items: [
    {
      id: 'entity-wp2-approved-1',
      type: 'ENTITY',
      label: 'entity',
      state: 'CURRENT',
      source: 'APPROVED_KNOWLEDGE',
      evidenceIds: [],
      accessScope: ['owner'],
      sensitivity: 'private',
    },
    {
      id: 'relation-wp2-approved-1',
      type: 'RELATION',
      label: 'relation',
      state: 'CURRENT',
      source: 'APPROVED_KNOWLEDGE',
      evidenceIds: [],
      accessScope: ['owner'],
      sensitivity: 'private',
    },
    {
      id: 'event-wp2-approved-1',
      type: 'EVENT',
      label: 'event',
      state: 'CURRENT',
      source: 'APPROVED_KNOWLEDGE',
      evidenceIds: [],
      accessScope: ['owner'],
      sensitivity: 'private',
    },
    {
      id: 'decision-wp2-approved-1',
      type: 'DECISION',
      label: 'decision',
      state: 'CURRENT',
      source: 'APPROVED_KNOWLEDGE',
      evidenceIds: [],
      accessScope: ['owner'],
      sensitivity: 'private',
    },
    {
      id: 'conflict-wp2-approved-1',
      type: 'CONFLICT',
      label: 'conflict',
      state: 'CONFLICT',
      source: 'APPROVED_KNOWLEDGE',
      evidenceIds: [],
      accessScope: ['owner'],
      sensitivity: 'private',
    },
    {
      id: 'action-wp2-approved-1',
      type: 'ACTION',
      label: 'action',
      state: 'CURRENT',
      source: 'APPROVED_KNOWLEDGE',
      evidenceIds: [],
      accessScope: ['owner'],
      sensitivity: 'private',
    },
  ],
  graph: { nodes: [], edges: [], fallback: { available: true, modes: ['LIST', 'TABLE'] } },
  projectedAt: now,
  buildMode: 'FULL_REBUILD',
};

const finding = (
  findingId: string,
  related = true,
  resourceId = claimId,
  resourceKind: DiscoveryResourceKind = 'CANONICAL_CLAIM',
  authority = false,
): DiscoveryFindingEnvelopeV1 =>
  createDiscoveryFindingEnvelopeV1({
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
      subject: findingId,
      missingFact: 'an approved value',
      question: `What is the approved value for ${findingId}?`,
    },
    relatedResourceRefs: related
      ? [
          {
            schemaVersion: '1.0.0',
            resourceKind,
            resourceId,
            projectId,
            resourceState: 'CURRENT',
          },
        ]
      : [],
    evidenceIds: ['evidence-wp2-1'],
    sourceProjectionDigest: authority
      ? authoritySourceProjectionDigest
      : 'sha256:wp2-source-projection',
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion,
      snapshotDigest: canonicalDigest,
    },
    discoveryBase: authority ? authorityDiscoveryBase : discoveryBase,
    runId: `run-${findingId}`,
    signalSummary: {},
    rationale: 'A durable WP2 database finding.',
    derivationSummary: 'Created by the bounded database contract fixture.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'wp2-database-fixture',
      ruleVersion: '1',
      inputDigest: 'sha256:wp2-fixture-input',
    },
    accessScope: ['owner'],
    sensitivity: 'private',
    fingerprint: `sha256:${'a'.repeat(63)}${findingId.length % 10}`,
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: now,
  });

const publicationFor = (value: DiscoveryFindingEnvelopeV1): DiscoveryFindingReadyV1 => ({
  schemaVersion: '1.0.0',
  publicationId: `publication-${value.findingId}`,
  projectId,
  findingId: value.findingId,
  findingRevision: value.findingRevision,
  fingerprint: value.fingerprint,
  fingerprintVersion: value.fingerprintVersion,
  jobId: `job-${value.findingId}`,
  runId: `run-${value.findingId}`,
  attemptId: `attempt-${value.findingId}`,
  canonicalBase: value.canonicalBase,
  requiredDiscoveryBase: value.discoveryBase,
  occurredAt: now,
});

const seedCanonicalAuthority = async (): Promise<void> => {
  const client = await poolA!.connect();
  try {
    const commitId = randomUUID();
    const manifestId = randomUUID();
    const sourceVersionId = randomUUID();
    await client.query(
      `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
       VALUES ($1, $2, $3, $4)`,
      [projectId, canonicalVersion, canonicalDigest, now],
    );
    await client.query(
      `INSERT INTO canonical.commits (
         commit_id, project_id, manifest_id, manifest_digest, change_set_id,
         result_json, committed_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        commitId,
        projectId,
        manifestId,
        `sha256:${'b'.repeat(64)}`,
        randomUUID(),
        JSON.stringify({ afterVersion: canonicalVersion, snapshotDigest: canonicalDigest }),
        now,
      ],
    );
    await client.query(
      `INSERT INTO canonical.claims (
         claim_id, project_id, source_version_id, manifest_id, claim_json, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [claimId, projectId, sourceVersionId, manifestId, JSON.stringify({ claimId }), now],
    );
    await client.query(
      `INSERT INTO canonical.revisions (
         revision_id, project_id, commit_id, revision_json, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        canonicalRevisionId,
        projectId,
        commitId,
        JSON.stringify({
          revisionId: canonicalRevisionId,
          projectId,
          commitId,
          manifestId,
          operation: 'ADD_CLAIM',
          beforeVersion: 0,
          afterVersion: canonicalVersion,
          claimId,
          reason: 'WP2 fixture',
          actor: { type: 'service', id: 'wp2-fixture' },
          createdAt: now,
        }),
        now,
      ],
    );
  } finally {
    client.release();
  }
};

const seedApprovedAuthority = async (): Promise<void> => {
  const client = await poolA!.connect();
  try {
    await client.query(
      `INSERT INTO asset.original_assets (
         asset_id, content_hash, size_bytes, storage_key, created_at
       ) VALUES ($1, $2, 1, $3, $4)`,
      [authorityAssetId, `sha256:${'f'.repeat(64)}`, `wp2-authority-${authorityAssetId}`, now],
    );
    await client.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 'wp2-fixture', $3)`,
      [authoritySourceId, projectId, now],
    );
    await client.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id,
         media_type, access_scope, sensitivity, created_at
       ) VALUES ($1, $2, 1, $3, 'text/plain', $4, 'private', $5)`,
      [authoritySourceVersionId, authoritySourceId, authorityAssetId, ['owner'], now],
    );
    await client.query(
      `INSERT INTO knowledge.review_groups (
         project_id, group_id, source_version_id, revision_number, status,
         content_digest, items, decisions, access_scope, sensitivity,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $11)`,
      [
        projectId,
        authorityGroup.groupId,
        authorityGroup.sourceVersionId,
        authorityGroup.revisionNumber,
        authorityGroup.status,
        authorityGroup.contentDigest,
        JSON.stringify(authorityGroup.items),
        JSON.stringify(authorityGroup.decisions),
        authorityGroup.accessScope,
        authorityGroup.sensitivity,
        now,
      ],
    );
    await client.query(
      `INSERT INTO projection.compiled_truth (
         project_id, projector_version, source_snapshot_digest, logical_digest,
         canonical_version, build_mode, projection, status, last_error, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'READY', NULL, $8)`,
      [
        projectId,
        authorityProjection.projectorVersion,
        authorityProjection.sourceSnapshotDigest,
        authorityProjection.logicalDigest,
        authorityProjection.canonicalVersion,
        authorityProjection.buildMode,
        JSON.stringify(authorityProjection),
        now,
      ],
    );
  } finally {
    client.release();
  }
};

const seedFindingReady = async (value: DiscoveryFindingEnvelopeV1): Promise<void> => {
  const client = await poolA!.connect();
  const jobId = `job-${value.findingId}`;
  const runId = `run-${value.findingId}`;
  const attemptId = `attempt-${value.findingId}`;
  try {
    const trigger = {
      schemaVersion: '1.0.0',
      triggerId: `trigger-${value.findingId}`,
      triggerClass: 'MANUAL',
      projectId,
      requestedScanMode: 'INCREMENTAL',
      effectiveScanMode: 'INCREMENTAL',
      canonicalBase: value.canonicalBase,
      requiredDiscoveryBase: value.discoveryBase,
      policyRevision: 'policy-wp2',
      strategyRevision: 'strategy-wp2',
      createdAt: now,
      observedAt: now,
    };
    const budget = { maxResources: 1, maxFindings: 1 };
    await client.query(
      `INSERT INTO discovery.jobs (
         project_id, job_id, logical_job_identity, logical_job_identity_version,
         schema_version, trigger_id, trigger_class, trigger, requested_scan_mode,
         effective_scan_mode, canonical_base_version, canonical_snapshot_digest,
         required_projection_revision, required_projection_digest, policy_revision,
         strategy_revision, budget_version, budget_id, budget_revision, budget,
         lifecycle_state, lifecycle_revision, created_at, updated_at
       ) VALUES ($1, $2, $3, 'discovery-job-logical:v1', '1.0.0', $4, 'MANUAL', $5::jsonb,
                 'INCREMENTAL', 'INCREMENTAL', $6, $7, $8, $9, 'policy-wp2',
                 'strategy-wp2', 'discovery-work-budget:v1', 'budget-wp2',
                 'budget-revision-wp2', $10::jsonb, 'SUCCEEDED', 1, $11, $11)`,
      [
        projectId,
        jobId,
        `job-logical-${value.findingId}`,
        trigger.triggerId,
        JSON.stringify(trigger),
        value.canonicalBase.canonicalVersion,
        value.canonicalBase.snapshotDigest,
        value.discoveryBase.projectionRevision,
        value.discoveryBase.projectionDigest,
        JSON.stringify(budget),
        now,
      ],
    );
    await client.query(
      `INSERT INTO discovery.runs (
         project_id, run_id, job_id, run_revision, schema_version,
         requested_scan_mode, effective_scan_mode, canonical_base_version,
         canonical_snapshot_digest, required_projection_revision,
         required_projection_digest, policy_revision, strategy_revision,
         budget_version, budget_id, budget_revision, budget, lifecycle_state,
         lifecycle_revision, created_at, updated_at
       ) VALUES ($1, $2, $3, 1, '1.0.0', 'INCREMENTAL', 'INCREMENTAL', $4, $5, $6,
                 $7, 'policy-wp2', 'strategy-wp2', 'discovery-work-budget:v1',
                 'budget-wp2', 'budget-revision-wp2', $8::jsonb, 'SUCCEEDED', 1, $9, $9)`,
      [
        projectId,
        runId,
        jobId,
        value.canonicalBase.canonicalVersion,
        value.canonicalBase.snapshotDigest,
        value.discoveryBase.projectionRevision,
        value.discoveryBase.projectionDigest,
        JSON.stringify(budget),
        now,
      ],
    );
    await client.query(
      `INSERT INTO discovery.attempts (
         project_id, attempt_id, run_id, job_id, attempt_number,
         lifecycle_revision, attempt_kind, lifecycle_state, schema_version,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 1, 1, 'INITIAL', 'SUCCEEDED', '1.0.0', $5, $5)`,
      [projectId, attemptId, runId, jobId, now],
    );
    await client.query(
      `INSERT INTO discovery.finding_ready (
         publication_id, project_id, finding_id, finding_revision,
         fingerprint, fingerprint_version, job_id, run_id, attempt_id,
         canonical_base_version, canonical_snapshot_digest,
         required_projection_revision, required_projection_digest, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        `publication-${value.findingId}`,
        projectId,
        value.findingId,
        value.findingRevision,
        value.fingerprint,
        value.fingerprintVersion,
        jobId,
        runId,
        attemptId,
        value.canonicalBase.canonicalVersion,
        value.canonicalBase.snapshotDigest,
        value.discoveryBase.projectionRevision,
        value.discoveryBase.projectionDigest,
        now,
      ],
    );
  } finally {
    client.release();
  }
};

const transition = async (
  repository: PostgresDiscoveryFindingRepository,
  value: DiscoveryFindingEnvelopeV1,
  targetState: Parameters<
    PostgresDiscoveryFindingRepository['transitionLifecycle']
  >[0]['targetState'],
  expectedLifecycleRevision: number,
): Promise<void> => {
  const result = await repository.transitionLifecycle({
    projectId,
    findingId: value.findingId,
    findingRevision: value.findingRevision,
    expectedLifecycleRevision,
    targetState,
    cause:
      targetState === 'STALE' || targetState === 'SUPERSEDED' || targetState === 'RESOLVED'
        ? 'SYSTEM_RECONCILIATION'
        : 'GOVERNED_WORKFLOW',
    reasonCode:
      targetState === 'STALE' || targetState === 'SUPERSEDED' || targetState === 'RESOLVED'
        ? 'RELEVANT_INPUT_CHANGED'
        : targetState === 'VALIDATING'
          ? 'VALIDATION_STARTED'
          : targetState === 'REVIEW_READY'
            ? 'REVIEW_READY'
            : targetState === 'REENTERED'
              ? 'REENTERED'
              : targetState === 'DISMISSED'
                ? 'DISMISSED'
                : 'SUPPRESSED',
    occurredAt: now,
    context: { canonicalBase: value.canonicalBase, discoveryBase: value.discoveryBase },
  });
  expect(result.status).toBe('APPLIED');
};

describe.runIf(databaseUrl)('AKP-5 WP2 durable FindingReady re-entry PostgreSQL authority', () => {
  const findingRepository = new PostgresDiscoveryFindingRepository(poolA!);

  const cleanup = async (): Promise<void> => {
    const client = await poolA!.connect();
    try {
      await client.query('SET session_replication_role = replica');
      await client.query('DELETE FROM discovery.reentry_consumption WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.reentry_candidates WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.reentry_manifests WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.finding_ready WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.finding_lifecycle_history WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.finding_lifecycle_current WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.findings WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.attempts WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.runs WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.jobs WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM canonical.revisions WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM canonical.history_events WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM canonical.outbox WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM canonical.claims WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM canonical.commits WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM canonical.project_state WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM projection.compiled_truth WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM knowledge.review_groups WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM asset.source_versions WHERE source_id = $1', [
        authoritySourceId,
      ]);
      await client.query('DELETE FROM asset.sources WHERE source_id = $1', [authoritySourceId]);
      await client.query('DELETE FROM asset.original_assets WHERE asset_id = $1', [
        authorityAssetId,
      ]);
      await client.query('SET session_replication_role = origin');
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    await poolA!.query(
      `INSERT INTO project_admin.projects (id, name, status, active)
       VALUES ($1, 'AKP-5 WP2 database project', 'ACTIVE', true)`,
      [projectId],
    );
  });

  beforeEach(async () => {
    await cleanup();
    await seedCanonicalAuthority();
    await seedApprovedAuthority();
  });

  afterAll(async () => {
    await cleanup();
    await poolA!.query('DELETE FROM project_admin.projects WHERE id = $1', [projectId]);
    await poolA!.end();
    await poolB!.end();
  });

  const runConsumer = (
    pool: Pool,
    resolver = new PostgresDiscoveryApprovedResourceRevisionResolver(pool),
    options?: { readonly failpoint?: 'AFTER_MANIFEST' },
  ): DiscoveryReentryConsumer =>
    new DiscoveryReentryConsumer(
      new PostgresDiscoveryReentryRepository(pool, options),
      resolver,
      () => new Date(now),
    );

  it('creates one manifest/candidate atomically and resolves a production-shaped unversioned ref', async () => {
    const value = finding('finding-happy');
    await findingRepository.save(value);
    await seedFindingReady(value);
    const result = await runConsumer(poolA!).runOnce();

    expect(result.fetched).toBe(1);
    expect(result.results[0]?.status).toBe('CREATED');
    if (result.results[0]?.status !== 'CREATED') return;
    expect(result.results[0].candidate.relatedResourceRefs).toEqual([
      {
        schemaVersion: '1.0.0',
        resourceKind: 'CANONICAL_CLAIM',
        resourceId: claimId,
        projectId,
        resourceState: 'APPROVED',
        resourceRevision: canonicalRevisionId,
      },
    ]);
    expect(result.results[0].candidate.reviewEligibility).toBe('NOT_ELIGIBLE');
    expect(result.results[0].candidate.origin).toBe('DERIVED_DISCOVERY');
    expect('sourceVersionId' in result.results[0].candidate).toBe(false);
    const counts = await poolA!.query<{
      manifests: number;
      candidates: number;
      state: string;
      starts: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM discovery.reentry_manifests WHERE project_id = $1) AS manifests,
         (SELECT count(*)::int FROM discovery.reentry_candidates WHERE project_id = $1) AS candidates,
         (SELECT lifecycle_state FROM discovery.finding_lifecycle_current
          WHERE project_id = $1 AND finding_id = $2 AND finding_revision = 1) AS state,
         (SELECT count(*)::int FROM discovery.finding_lifecycle_history
          WHERE project_id = $1 AND finding_id = $2 AND reason_code = 'VALIDATION_STARTED') AS starts`,
      [projectId, value.findingId],
    );
    expect(counts.rows[0]).toEqual({ manifests: 1, candidates: 1, state: 'VALIDATING', starts: 1 });
  });

  it.each([
    ['CANONICAL_ENTITY', 'entity-wp2-approved-1', '7'],
    ['CANONICAL_RELATION', 'relation-wp2-approved-1', '8'],
    ['CANONICAL_EVENT', 'event-wp2-approved-1', '9'],
    ['CANONICAL_DECISION', 'decision-wp2-approved-1', '10'],
    ['CANONICAL_CONFLICT', 'conflict-wp2-approved-1', '11'],
    ['COMPILED_TRUTH_ITEM', 'action-wp2-approved-1', '12'],
  ] as const)(
    'resolves %s from the frozen approved authority revision',
    async (resourceKind, resourceId, revision) => {
      const value = finding(
        `finding-authority-${resourceKind}`,
        true,
        resourceId,
        resourceKind,
        true,
      );
      await findingRepository.save(value);
      await seedFindingReady(value);
      const resolver = new PostgresDiscoveryApprovedResourceRevisionResolver(poolA!, {
        knowledgeModelRepository: new PostgresKnowledgeModelRepository(poolA!),
        compiledTruthRepository: new PostgresCompiledTruthRepository(poolA!),
      });
      const result = await runConsumer(poolA!, resolver).runOnce();

      expect(result.results[0]?.status).toBe('CREATED');
      if (result.results[0]?.status !== 'CREATED') return;
      expect(result.results[0].candidate.relatedResourceRefs).toEqual([
        {
          schemaVersion: '1.0.0',
          resourceKind,
          resourceId,
          projectId,
          resourceState: 'APPROVED',
          resourceRevision: revision,
        },
      ]);
      expect('sourceVersionId' in result.results[0].candidate).toBe(false);
      expect(result.results[0].manifest.relatedResourceRefs[0]).toMatchObject({
        resourceKind,
        resourceId,
        resourceState: 'CURRENT',
      });
      const persistedFinding = await new PostgresDiscoveryReentryRepository(poolA!).findFinding({
        projectId,
        findingId: value.findingId,
        findingRevision: value.findingRevision,
      });
      expect(persistedFinding?.relatedResourceRefs).toEqual(value.relatedResourceRefs);
    },
  );

  it('deduplicates duplicate delivery and a restarted consumer', async () => {
    const value = finding('finding-replay');
    await findingRepository.save(value);
    await seedFindingReady(value);
    const first = await runConsumer(poolA!).consume(publicationFor(value));
    const duplicate = await runConsumer(poolA!).consume(publicationFor(value));
    const restarted = await runConsumer(poolB!).consume(publicationFor(value));

    expect(first.status).toBe('CREATED');
    expect(duplicate.status).toBe('IDEMPOTENT');
    expect(restarted.status).toBe('IDEMPOTENT');
    const counts = await poolA!.query<{ manifests: number; candidates: number; starts: number }>(
      `SELECT
         (SELECT count(*)::int FROM discovery.reentry_manifests WHERE project_id = $1) AS manifests,
         (SELECT count(*)::int FROM discovery.reentry_candidates WHERE project_id = $1) AS candidates,
         (SELECT count(*)::int FROM discovery.finding_lifecycle_history
          WHERE project_id = $1 AND finding_id = $2 AND reason_code = 'VALIDATION_STARTED') AS starts`,
      [projectId, value.findingId],
    );
    expect(counts.rows[0]).toEqual({ manifests: 1, candidates: 1, starts: 1 });
  });

  it('converges concurrent consumers to one logical result', async () => {
    const value = finding('finding-concurrent');
    await findingRepository.save(value);
    await seedFindingReady(value);
    const [left, right] = await Promise.all([
      runConsumer(poolA!).consume(publicationFor(value)),
      runConsumer(poolB!).consume(publicationFor(value)),
    ]);

    expect([left.status, right.status].sort()).toEqual(['CREATED', 'IDEMPOTENT']);
    const counts = await poolA!.query<{ manifests: number; candidates: number }>(
      `SELECT
         (SELECT count(*)::int FROM discovery.reentry_manifests WHERE project_id = $1) AS manifests,
         (SELECT count(*)::int FROM discovery.reentry_candidates WHERE project_id = $1) AS candidates`,
      [projectId],
    );
    expect(counts.rows[0]).toEqual({ manifests: 1, candidates: 1 });
  });

  it('does not reopen terminal or review lifecycle states', async () => {
    const cases: readonly {
      readonly findingId: string;
      readonly transitions: readonly [
        Parameters<PostgresDiscoveryFindingRepository['transitionLifecycle']>[0]['targetState'],
        number,
      ][];
    }[] = [
      { findingId: 'finding-stale', transitions: [['STALE', 1]] },
      {
        findingId: 'finding-review-ready',
        transitions: [
          ['VALIDATING', 1],
          ['REVIEW_READY', 2],
        ],
      },
      {
        findingId: 'finding-reentered',
        transitions: [
          ['VALIDATING', 1],
          ['REVIEW_READY', 2],
          ['REENTERED', 3],
        ],
      },
      {
        findingId: 'finding-dismissed',
        transitions: [
          ['VALIDATING', 1],
          ['DISMISSED', 2],
        ],
      },
    ];
    for (const testCase of cases) {
      const value = finding(testCase.findingId, false);
      await findingRepository.save(value);
      for (const [targetState, expectedRevision] of testCase.transitions) {
        await transition(findingRepository, value, targetState, expectedRevision);
      }
      await seedFindingReady(value);
      const result = await runConsumer(poolA!).consume(publicationFor(value));
      expect(result).toMatchObject({
        status: 'INELIGIBLE',
        lifecycleState: testCase.transitions.at(-1)?.[0],
        disposition: 'INELIGIBLE',
      });
      expect(
        await new PostgresDiscoveryReentryRepository(poolA!).listPendingFindingReady(25),
      ).toEqual([]);
    }
    const count = await poolA!.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM discovery.reentry_manifests WHERE project_id = $1',
      [projectId],
    );
    expect(count.rows[0]?.count).toBe(0);
  });

  it('durably blocks an impossible authority resolution and excludes it after restart', async () => {
    const value = finding('finding-unresolved', true, 'missing-claim');
    await findingRepository.save(value);
    await seedFindingReady(value);
    const result = await runConsumer(poolA!).runOnce();

    expect(result.results[0]).toMatchObject({
      status: 'UNRESOLVED_REVISION',
      reasonCode: 'NO_APPROVED_REVISION_AT_FROZEN_BASE',
      disposition: 'BLOCKED_NON_RETRYABLE',
    });
    const state = await findingRepository.findLifecycle({
      projectId,
      findingId: value.findingId,
      findingRevision: 1,
    });
    expect(state?.lifecycleState).toBe('NEW');
    const count = await poolA!.query<{ manifests: number; candidates: number }>(
      `SELECT
         (SELECT count(*)::int FROM discovery.reentry_manifests WHERE project_id = $1) AS manifests,
         (SELECT count(*)::int FROM discovery.reentry_candidates WHERE project_id = $1) AS candidates`,
      [projectId],
    );
    expect(count.rows[0]).toEqual({ manifests: 0, candidates: 0 });
    const disposition = await poolA!.query<{
      disposition: string;
      reason_code: string;
    }>(
      `SELECT disposition, reason_code FROM discovery.reentry_consumption
       WHERE project_id = $1 AND finding_id = $2`,
      [projectId, value.findingId],
    );
    expect(disposition.rows[0]).toEqual({
      disposition: 'BLOCKED_NON_RETRYABLE',
      reason_code: 'NO_APPROVED_REVISION_AT_FROZEN_BASE',
    });
    await expect(
      new PostgresDiscoveryReentryRepository(poolA!).listPendingFindingReady(25),
    ).resolves.toEqual([]);
    await expect(
      new PostgresDiscoveryReentryRepository(poolB!).listPendingFindingReady(25),
    ).resolves.toEqual([]);
  });

  it('durably defers retryable failures, advances the retry boundary, and transitions to processed', async () => {
    const value = finding('finding-retryable');
    await findingRepository.save(value);
    await seedFindingReady(value);
    const databaseClock = await poolA!.query<{ now: Date }>('SELECT now() AS now');
    let retryNow = new Date(databaseClock.rows[0]!.now.getTime() + 250).toISOString();
    let attempts = 0;
    const resolver: DiscoveryApprovedResourceRevisionResolverPort = {
      resolve: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error('temporary authority outage'), { retryable: true });
        }
        return {
          status: 'RESOLVED',
          refs: [
            {
              schemaVersion: '1.0.0',
              resourceKind: 'CANONICAL_CLAIM',
              resourceId: claimId,
              projectId,
              resourceState: 'APPROVED',
              resourceRevision: canonicalRevisionId,
            },
          ],
        };
      },
    };
    const createRetryConsumer = (): DiscoveryReentryConsumer =>
      new DiscoveryReentryConsumer(
        new PostgresDiscoveryReentryRepository(poolA!),
        resolver,
        () => new Date(retryNow),
        { retryBackoffMs: 1_000 },
      );

    const first = await createRetryConsumer().runOnce();
    expect(first).toMatchObject({
      fetched: 1,
      results: [
        {
          status: 'RETRYABLE',
          reasonCode: 'RETRYABLE_INFRASTRUCTURE_FAILURE',
          disposition: 'RETRYABLE',
          nextEligibleAt: new Date(Date.parse(retryNow) + 1_000).toISOString(),
        },
      ],
    });
    const firstRow = await poolA!.query<{ next_eligible_at: Date; updated_at: Date }>(
      `SELECT next_eligible_at, updated_at FROM discovery.reentry_consumption
       WHERE project_id = $1 AND finding_id = $2`,
      [projectId, value.findingId],
    );
    expect(firstRow.rows[0]!.next_eligible_at.getTime()).toBeGreaterThan(
      firstRow.rows[0]!.updated_at.getTime(),
    );
    await expect(
      new PostgresDiscoveryReentryRepository(poolA!).listPendingFindingReady(25),
    ).resolves.toEqual([]);

    retryNow = new Date(Date.parse(retryNow) + 2_000).toISOString();
    await poolA!.query(
      `UPDATE discovery.reentry_consumption
       SET next_eligible_at = now() - interval '1 second'
       WHERE project_id = $1 AND finding_id = $2`,
      [projectId, value.findingId],
    );
    const second = await createRetryConsumer().runOnce();
    expect(second.results[0]).toMatchObject({
      status: 'RETRYABLE',
      reasonCode: 'RETRYABLE_INFRASTRUCTURE_FAILURE',
      disposition: 'RETRYABLE',
    });
    const secondRow = await poolA!.query<{ next_eligible_at: Date }>(
      `SELECT next_eligible_at FROM discovery.reentry_consumption
       WHERE project_id = $1 AND finding_id = $2`,
      [projectId, value.findingId],
    );
    expect(secondRow.rows[0]!.next_eligible_at.getTime()).toBeGreaterThan(
      firstRow.rows[0]!.next_eligible_at.getTime(),
    );
    await expect(
      new PostgresDiscoveryReentryRepository(poolA!).listPendingFindingReady(25),
    ).resolves.toEqual([]);

    retryNow = new Date(Date.parse(retryNow) + 2_000).toISOString();
    await poolA!.query(
      `UPDATE discovery.reentry_consumption
       SET next_eligible_at = now() - interval '1 second'
       WHERE project_id = $1 AND finding_id = $2`,
      [projectId, value.findingId],
    );
    const success = await createRetryConsumer().runOnce();
    expect(success.results[0]?.status).toBe('CREATED');
    const final = await poolA!.query<{
      count: number;
      disposition: string;
      manifests: number;
      candidates: number;
      lifecycle_state: string;
    }>(
      `SELECT
         (SELECT count(*)::int FROM discovery.reentry_consumption
          WHERE project_id = $1 AND finding_id = $2) AS count,
         (SELECT disposition FROM discovery.reentry_consumption
          WHERE project_id = $1 AND finding_id = $2) AS disposition,
         (SELECT count(*)::int FROM discovery.reentry_manifests
          WHERE project_id = $1 AND finding_id = $2) AS manifests,
         (SELECT count(*)::int FROM discovery.reentry_candidates
          WHERE project_id = $1 AND finding_id = $2) AS candidates,
         (SELECT lifecycle_state FROM discovery.finding_lifecycle_current
          WHERE project_id = $1 AND finding_id = $2 AND finding_revision = 1) AS lifecycle_state`,
      [projectId, value.findingId],
    );
    expect(final.rows[0]).toEqual({
      count: 1,
      disposition: 'PROCESSED',
      manifests: 1,
      candidates: 1,
      lifecycle_state: 'VALIDATING',
    });
    await expect(
      new PostgresDiscoveryReentryRepository(poolB!).listPendingFindingReady(25),
    ).resolves.toEqual([]);
  });

  it('fails closed on project isolation and on an interrupted persistence transaction', async () => {
    const value = finding('finding-isolation', false);
    await findingRepository.save(value);
    await seedFindingReady(value);
    const tampered = { ...publicationFor(value), projectId: 'other-project' };
    await expect(runConsumer(poolA!).consume(tampered)).resolves.toMatchObject({
      status: 'FINDING_NOT_FOUND',
    });

    const crashValue = finding('finding-crash', false);
    await findingRepository.save(crashValue);
    await seedFindingReady(crashValue);
    const crash = await runConsumer(poolA!, undefined, { failpoint: 'AFTER_MANIFEST' }).consume(
      publicationFor(crashValue),
    );
    expect(crash.status).toBe('PERSISTENCE_FAILURE');
    const state = await findingRepository.findLifecycle({
      projectId,
      findingId: crashValue.findingId,
      findingRevision: 1,
    });
    expect(state?.lifecycleState).toBe('NEW');
    const rows = await poolA!.query<{ manifests: number; candidates: number }>(
      `SELECT
         (SELECT count(*)::int FROM discovery.reentry_manifests
          WHERE project_id = $1 AND finding_id = $2) AS manifests,
         (SELECT count(*)::int FROM discovery.reentry_candidates
          WHERE project_id = $1 AND finding_id = $2) AS candidates`,
      [projectId, crashValue.findingId],
    );
    expect(rows.rows[0]).toEqual({ manifests: 0, candidates: 0 });
  });
});
