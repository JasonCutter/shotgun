import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresDiscoveryFindingRepository } from '../../adapters/discovery-finding-postgres/src/index.js';
import { PostgresDiscoveryRuntimeRepository } from '../../adapters/discovery-runtime-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresSemanticCorpusSourceSnapshotReader } from '../../adapters/semantic-corpus-postgres/src/index.js';
import { PostgresSemanticIndexRepository } from '../../adapters/semantic-index-postgres/src/index.js';
import { PostgresSemanticActiveGenerationReader } from '../../adapters/semantic-index-postgres/src/index.js';
import { SemanticRetriever } from '../../modules/hybrid-retrieval/src/index.js';
import { PersistentDiscoveryWorker } from '../../modules/discovery-runtime/src/index.js';
import { SemanticGenerationBuilder } from '../../modules/semantic-generation/src/index.js';
import {
  canonicalSnapshotDigest,
  createDiscoveryFindingEnvelopeV1,
  createDiscoveryLogicalJobIdentityV1,
  SEMANTIC_REPRESENTATION_VERSION_V2,
  semanticMembershipDigest,
  sha256Text,
  type DiscoveryFindingEnvelopeV1,
  type DiscoveryFindingReadyV1,
  type DiscoveryJobV1,
  type DiscoveryResourceRefV1,
  type DiscoveryRuntimeBudgetBindingV1,
  type CanonicalClaim,
  type KnowledgeCandidate,
  type ResolvedSemanticEmbeddingExecution,
  type SemanticEmbeddingCompatibilityPort,
  type SemanticEmbeddingResolverPort,
  type SemanticEmbeddingRouterPort,
  knowledgeCandidateDigest,
} from '../../packages/contracts/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

let databaseUrl: string | undefined;
if (process.env.TEST_DATABASE_URL?.trim()) {
  try {
    databaseUrl = await requireTestDatabaseTarget();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ECONNREFUSED|ENOTFOUND|timeout|connect/i.test(message)) {
      console.warn(`AKP-8 WP3 PostgreSQL acceptance tests skipped: ${message}`);
    } else {
      throw error;
    }
  }
}

const poolA: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const poolB: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const executionProjectId = 'akp-8-wp3-execution-acceptance';
const semanticProjectId = 'akp-8-wp3-semantic-acceptance';
const now = '2026-09-01T04:00:00.000Z';
const later = '2026-09-01T04:00:02.000Z';
const digest = (value: string): `sha256:${string}` => sha256Text(value) as `sha256:${string}`;

const budget: DiscoveryRuntimeBudgetBindingV1 = {
  schemaVersion: '1.0.0',
  budgetVersion: 'discovery-work-budget:v1',
  budgetId: 'akp-8-wp3-budget',
  budgetRevision: '1',
  maxResources: 20,
  maxSemanticNeighbors: 20,
  maxCandidatePairs: 10,
  maxCandidateGroups: 10,
  maxFindings: 10,
  maxProviderCalls: 2,
  maxInputTokens: 100,
  maxOutputTokens: 100,
  maxOutputTokensPerCall: 50,
  maxEstimatedCostMicros: 100,
  maxConcurrentProviderCalls: 1,
  deadlineAt: '2099-01-01T00:00:00.000Z',
};

const job = (jobId: string): DiscoveryJobV1 => {
  const trigger = {
    schemaVersion: '1.0.0' as const,
    triggerId: `${jobId}:trigger`,
    triggerClass: 'CANONICAL_COMMITTED' as const,
    triggerIdentity: {
      kind: 'CANONICAL_COMMITTED' as const,
      eventId: `${jobId}:event`,
      eventRevision: '1',
    },
    projectId: executionProjectId,
    requestedScanMode: 'INCREMENTAL' as const,
    effectiveScanMode: 'INCREMENTAL' as const,
    canonicalBase: {
      schemaVersion: '1.0.0' as const,
      canonicalVersion: 1,
      snapshotDigest: digest('execution-canonical'),
    },
    requiredDiscoveryBase: {
      schemaVersion: '1.0.0' as const,
      projectionRevision: 'projection:1',
      projectionDigest: digest('execution-projection'),
    },
    policyRevision: 'policy:1',
    strategyRevision: 'strategy:1',
    profileBinding: { profileId: 'profile:1', profileRevision: 1 },
    createdAt: now,
    observedAt: now,
  };
  return {
    schemaVersion: '1.0.0',
    jobId,
    logicalIdentity: createDiscoveryLogicalJobIdentityV1(trigger),
    projectId: executionProjectId,
    trigger,
    requestedScanMode: 'INCREMENTAL',
    effectiveScanMode: 'INCREMENTAL',
    canonicalBase: trigger.canonicalBase,
    requiredDiscoveryBase: trigger.requiredDiscoveryBase,
    policyRevision: trigger.policyRevision,
    strategyRevision: trigger.strategyRevision,
    profileBinding: trigger.profileBinding,
    budget,
    lifecycleState: 'QUEUED',
    lifecycleRevision: 1,
    createdAt: now,
    updatedAt: now,
  };
};

const finding = (runId: string): DiscoveryFindingEnvelopeV1 => {
  const resource: DiscoveryResourceRefV1 = {
    schemaVersion: '1.0.0',
    resourceKind: 'CANONICAL_CLAIM',
    resourceId: 'execution-claim',
    projectId: executionProjectId,
    resourceState: 'CURRENT',
  };
  return createDiscoveryFindingEnvelopeV1({
    schemaVersion: '1.0.0',
    findingId: 'akp-8-wp3-recovered-finding',
    findingRevision: 1,
    projectId: executionProjectId,
    findingType: 'KNOWLEDGE_GAP',
    generationMethod: 'DETERMINISTIC',
    lifecycleState: 'NEW',
    payload: {
      schemaVersion: '1.0.0',
      payloadType: 'KNOWLEDGE_GAP',
      gapKind: 'MISSING_FACT',
      subject: 'recovery',
      missingFact: 'the durable result',
      question: 'What is the durable result?',
    },
    relatedResourceRefs: [resource],
    evidenceIds: [],
    sourceProjectionDigest: digest('execution-source'),
    canonicalBase: {
      schemaVersion: '1.0.0',
      canonicalVersion: 1,
      snapshotDigest: digest('execution-canonical'),
    },
    discoveryBase: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection:1',
      projectionDigest: digest('execution-projection'),
    },
    runId,
    signalSummary: {},
    rationale: 'The finding proves durable restart recovery.',
    derivationSummary: 'WP3 production-worker acceptance fixture.',
    provenance: {
      schemaVersion: '1.0.0',
      kind: 'DETERMINISTIC',
      ruleId: 'akp-8-wp3-recovery',
      ruleVersion: '1',
      inputDigest: digest('execution-input'),
    },
    accessScope: ['owner'],
    sensitivity: 'private',
    fingerprint: digest('recovered-finding'),
    fingerprintVersion: 'discovery-fingerprint:v1',
    retentionClass: 'DURABLE_DERIVED_RECORD',
    createdAt: now,
  });
};

const semanticProfile = {
  profileId: 'profile:wp3-semantic',
  projectId: semanticProjectId,
  profileRevision: 1,
  providerId: 'provider:wp3',
  embeddingModelId: 'model:wp3',
  credentialId: 'credential:wp3',
  credentialRevision: 1,
  representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
  dimension: 2,
  distanceMetric: 'cosine' as const,
  normalizationPolicy: 'unit_length' as const,
  status: 'ACTIVE' as const,
  createdAt: now,
  updatedBy: 'wp3-test',
  updatedAt: now,
};

const resolvedExecution: ResolvedSemanticEmbeddingExecution = {
  profile: semanticProfile,
  model: {
    providerId: semanticProfile.providerId,
    modelId: semanticProfile.embeddingModelId,
    displayName: 'WP3 deterministic semantic model',
    providerDefaultDimension: 2,
    shotgunDefaultDimension: 2,
    shotgunAllowedDimensions: [2],
    shotgunBatchLimit: 32,
    capabilityRevision: 'catalog:wp3',
    supportedDistanceMetrics: ['cosine'],
    defaultDistanceMetric: 'cosine',
    defaultNormalizationPolicy: 'unit_length',
  },
  pin: {
    projectId: semanticProjectId,
    providerId: semanticProfile.providerId,
    embeddingModelId: semanticProfile.embeddingModelId,
    embeddingProfileId: semanticProfile.profileId,
    embeddingProfileRevision: semanticProfile.profileRevision,
    credentialId: semanticProfile.credentialId,
    credentialRevision: semanticProfile.credentialRevision,
    providerRegistryRevision: 'providers:wp3',
    capabilityCatalogRevision: 'catalog:wp3',
    providerPolicyFingerprint: digest('semantic-policy'),
    representationVersion: semanticProfile.representationVersion,
    dimension: semanticProfile.dimension,
    createdAt: now,
  },
};

const semanticEntity = (input: {
  readonly candidateId: string;
  readonly sourceVersionId: string;
  readonly name: string;
}): KnowledgeCandidate => ({
  candidateId: input.candidateId,
  candidateType: 'ENTITY',
  revisionNumber: 1,
  sourceVersionId: input.sourceVersionId,
  evidenceIds: [`evidence:${input.candidateId}`],
  modelOutputs: [],
  name: input.name,
  entityKind: 'CONCEPT',
  aliases: [],
  resolution: { status: 'NEW' },
});

const semanticCanonicalClaim = (sourceVersionId: string): CanonicalClaim => ({
  claimId: 'canonical-sentinel-claim',
  projectId: semanticProjectId,
  revisionNumber: 1,
  claimText: 'Canonical state remains immutable during semantic retention.',
  sourceVersionId,
  evidenceIds: ['evidence:canonical-sentinel'],
  createdFromManifestId: null,
  authorityId: null,
  authorityDigest: null,
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: now,
});

const insertSemanticSource = async (
  claim: CanonicalClaim,
  groups: readonly {
    readonly groupId: string;
    readonly sourceVersionId: string;
    readonly candidate: KnowledgeCandidate;
  }[],
): Promise<void> => {
  const sourceRows = [
    { sourceVersionId: claim.sourceVersionId, suffix: 'canonical', content: 'canonical' },
    ...groups.map((group) => ({
      sourceVersionId: group.sourceVersionId,
      suffix: group.groupId,
      content: group.candidate.candidateId,
    })),
  ];
  for (const row of sourceRows) {
    const sourceId = randomUUID();
    const assetId = randomUUID();
    await poolA!.query(
      `INSERT INTO asset.original_assets
         (asset_id, content_hash, size_bytes, storage_key, created_at)
       VALUES ($1, $2, 1, $3, $4)`,
      [
        assetId,
        digest(`semantic-asset:${row.content}`),
        `wp3/${semanticProjectId}/${row.suffix}/${assetId}`,
        now,
      ],
    );
    await poolA!.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, 'wp3-semantic-test', $3)`,
      [sourceId, semanticProjectId, now],
    );
    await poolA!.query(
      `INSERT INTO asset.source_versions
         (source_version_id, source_id, version_number, original_asset_id,
          media_type, access_scope, sensitivity, created_at)
       VALUES ($1, $2, 1, $3, 'text/plain', $4, 'private', $5)`,
      [row.sourceVersionId, sourceId, assetId, ['owner'], now],
    );
  }

  const canonicalDigest = canonicalSnapshotDigest(semanticProjectId, 1, [
    {
      claimId: claim.claimId,
      text: claim.claimText,
      revisionNumber: claim.revisionNumber,
      evidenceIds: claim.evidenceIds,
    },
  ]);
  await poolA!.query(
    `INSERT INTO canonical.project_state (project_id, version, snapshot_digest, updated_at)
     VALUES ($1, 1, $2, $3)`,
    [semanticProjectId, canonicalDigest, now],
  );
  await poolA!.query(
    `INSERT INTO canonical.claims
       (claim_id, project_id, source_version_id, manifest_id, claim_json, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      claim.claimId,
      semanticProjectId,
      claim.sourceVersionId,
      randomUUID(),
      JSON.stringify(claim),
      now,
    ],
  );

  for (const group of groups) {
    await poolA!.query(
      `INSERT INTO knowledge.review_groups
         (project_id, group_id, source_version_id, revision_number, status,
          content_digest, items, decisions, access_scope, sensitivity, created_at, updated_at)
       VALUES ($1, $2, $3, 1, 'APPROVED', $4, $5::jsonb, '[]'::jsonb, $6, 'private', $7, $7)`,
      [
        semanticProjectId,
        group.groupId,
        group.sourceVersionId,
        knowledgeCandidateDigest([group.candidate]),
        JSON.stringify([group.candidate]),
        ['owner'],
        now,
      ],
    );
  }
};

const cleanupProject = async (projectId: string): Promise<void> => {
  const client = await poolA!.connect();
  try {
    await client.query('SET session_replication_role = replica');
    if (projectId === executionProjectId) {
      await client.query('DELETE FROM discovery.finding_ready WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.stage_outputs WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.work_budget_checkpoints WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.stage_history WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.stages WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.attempt_lifecycle_history WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.attempts WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.run_lifecycle_history WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.runs WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.job_lifecycle_history WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.jobs WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM discovery.finding_lifecycle_history WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.finding_lifecycle_current WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM discovery.findings WHERE project_id = $1', [projectId]);
    } else {
      await client.query('DELETE FROM knowledge.review_groups WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM canonical.claims WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM projection.semantic_items WHERE project_id = $1', [
        projectId,
      ]);
      await client.query(
        'DELETE FROM projection.semantic_generation_pointers WHERE project_id = $1',
        [projectId],
      );
      await client.query('DELETE FROM projection.semantic_generations WHERE project_id = $1', [
        projectId,
      ]);
      await client.query('DELETE FROM canonical.project_state WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM project_audit.project_tombstones WHERE project_id = $1', [
        projectId,
      ]);
      await client.query(
        'DELETE FROM asset.source_versions WHERE source_id IN (SELECT source_id FROM asset.sources WHERE project_id = $1)',
        [projectId],
      );
      await client.query('DELETE FROM asset.sources WHERE project_id = $1', [projectId]);
      await client.query('DELETE FROM asset.original_assets WHERE storage_key LIKE $1', [
        `wp3/${projectId}/%`,
      ]);
    }
  } finally {
    await client.query('SET session_replication_role = origin');
    client.release();
  }
};

describe('AKP-8 WP3 remaining E/N PostgreSQL end-to-end acceptance', () => {
  if (!poolA || !poolB) {
    it.skip('PostgreSQL test database not available; WP3 database proof is deferred to CI.', () => {});
    return;
  }

  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
    await poolA!.query(
      `INSERT INTO project_admin.projects (id, name, status, active, created_at, updated_at, revision)
       VALUES ($1, $2, 'ACTIVE', true, now(), now(), 1)
       ON CONFLICT (id) DO NOTHING`,
      [executionProjectId, 'AKP-8 WP3 execution acceptance'],
    );
    await poolA!.query(
      `INSERT INTO project_admin.projects (id, name, status, active, created_at, updated_at, revision)
       VALUES ($1, $2, 'ACTIVE', true, now(), now(), 1)
       ON CONFLICT (id) DO NOTHING`,
      [semanticProjectId, 'AKP-8 WP3 semantic acceptance'],
    );
  });

  beforeEach(async () => {
    await cleanupProject(executionProjectId);
    await cleanupProject(semanticProjectId);
    const canonicalClaim = semanticCanonicalClaim(randomUUID());
    const oldCandidate = semanticEntity({
      candidateId: 'old-resource',
      sourceVersionId: randomUUID(),
      name: 'Obsolete semantic resource',
    });
    const retainedCandidate = semanticEntity({
      candidateId: 'retained-resource',
      sourceVersionId: randomUUID(),
      name: 'Retained semantic resource',
    });
    await insertSemanticSource(canonicalClaim, [
      {
        groupId: 'wp3-old-resource-group',
        sourceVersionId: oldCandidate.sourceVersionId,
        candidate: oldCandidate,
      },
      {
        groupId: 'wp3-retained-resource-group',
        sourceVersionId: retainedCandidate.sourceVersionId,
        candidate: retainedCandidate,
      },
    ]);
    await poolA!.query(
      `INSERT INTO project_audit.project_tombstones
       (project_id, deleted_at, deleted_by, reason, retention_class, lineage_digest)
       VALUES ($1, $2, 'wp3-test', 'sentinel', 'AUDIT', $3)`,
      [semanticProjectId, now, digest('audit-sentinel')],
    );
  });

  afterAll(async () => {
    await cleanupProject(executionProjectId);
    await cleanupProject(semanticProjectId);
    await poolA!.query('DELETE FROM project_admin.projects WHERE id IN ($1, $2)', [
      executionProjectId,
      semanticProjectId,
    ]);
    await poolA!.end();
    await poolB!.end();
  });

  it('reclaims an expired lease through the real worker and publishes one durable Finding', async () => {
    const runtimeA = new PostgresDiscoveryRuntimeRepository(poolA!);
    const runtimeB = new PostgresDiscoveryRuntimeRepository(poolB!);
    const findings = new PostgresDiscoveryFindingRepository(poolB!);
    await runtimeA.saveJob(job('wp3-restart-job'));
    const crashed = await runtimeA.claimNext({
      projectId: executionProjectId,
      workerId: 'crashed-worker',
      now,
      leaseDurationMs: 1_000,
    });
    expect(crashed).toBeDefined();

    let generated = 0;
    let persisted = 0;
    const execution = {
      loadSignals: async () => ({ value: { recovered: true } }),
      generateFindings: async (context: { readonly claim: { readonly runId: string } }) => {
        generated += 1;
        return { value: [finding(context.claim.runId)] };
      },
      qualityGate: async (_context: unknown, candidates: readonly unknown[]) => ({
        value: candidates as readonly DiscoveryFindingEnvelopeV1[],
      }),
      persistFindings: async (
        context: {
          readonly claim: {
            readonly projectId: string;
            readonly jobId: string;
            readonly runId: string;
            readonly attemptId: string;
            readonly workerId: string;
            readonly fencingToken: number;
            readonly acquiredAt: string;
            readonly expiresAt: string;
          };
          readonly now?: string;
        },
        durableFindings: readonly DiscoveryFindingEnvelopeV1[],
      ) => {
        persisted += 1;
        for (const durableFinding of durableFindings) {
          const result = await findings.saveFenced(durableFinding, {
            ...context.claim,
            now: context.now!,
          });
          expect(result).toBe('CREATED');
        }
        return { value: durableFindings };
      },
      publishFindingReady: async (
        context: {
          readonly claim: {
            readonly projectId: string;
            readonly jobId: string;
            readonly runId: string;
            readonly attemptId: string;
            readonly workerId: string;
            readonly fencingToken: number;
            readonly acquiredAt: string;
            readonly expiresAt: string;
          };
          readonly now?: string;
        },
        durableFinding: DiscoveryFindingEnvelopeV1,
      ) => {
        const publication: DiscoveryFindingReadyV1 = {
          schemaVersion: '1.0.0',
          publicationId: `publication:${durableFinding.findingId}`,
          projectId: durableFinding.projectId,
          findingId: durableFinding.findingId,
          findingRevision: durableFinding.findingRevision,
          fingerprint: durableFinding.fingerprint,
          fingerprintVersion: durableFinding.fingerprintVersion,
          jobId: context.claim.jobId,
          runId: context.claim.runId,
          attemptId: context.claim.attemptId,
          canonicalBase: durableFinding.canonicalBase,
          requiredDiscoveryBase: durableFinding.discoveryBase,
          occurredAt: context.now!,
        };
        const result = await runtimeB.publishFindingReady({
          ...context.claim,
          publication,
        });
        expect(['CREATED', 'ALREADY_EXISTS']).toContain(result);
      },
      reconcileFindings: async () => ({ value: undefined }),
    };
    const worker = new PersistentDiscoveryWorker(runtimeB, execution, {
      workerId: 'recovery-worker',
      leaseDurationMs: 30_000,
      clock: () => new Date(later),
    });

    expect(await worker.runOnce()).toBe('COMPLETED');
    expect(await worker.runOnce()).toBe('IDLE');
    expect(generated).toBe(1);
    expect(persisted).toBe(1);

    const current = await poolA!.query<{
      lifecycle_state: string;
      fencing_token: string;
      lease_owner: string | null;
    }>(
      `SELECT a.lifecycle_state, a.fencing_token::text, a.lease_owner
         FROM discovery.attempts a
        WHERE a.project_id = $1
        ORDER BY a.attempt_number DESC`,
      [executionProjectId],
    );
    expect(current.rows).toHaveLength(1);
    expect(current.rows[0]).toMatchObject({ lifecycle_state: 'SUCCEEDED', lease_owner: null });
    expect(Number(current.rows[0]!.fencing_token)).toBeGreaterThan(crashed!.fencingToken);

    const stageStates = await poolA!.query<{ state: string }>(
      `SELECT state FROM discovery.stages WHERE project_id = $1 ORDER BY stage_ordinal`,
      [executionProjectId],
    );
    expect(stageStates.rows).toHaveLength(7);
    expect(stageStates.rows.every((row) => row.state === 'SUCCEEDED')).toBe(true);

    const lifecycleHistory = await poolA!.query<{ jobs: string; runs: string; attempts: string }>(
      `SELECT
         (SELECT count(*)::text FROM discovery.job_lifecycle_history WHERE project_id = $1) AS jobs,
         (SELECT count(*)::text FROM discovery.run_lifecycle_history WHERE project_id = $1) AS runs,
         (SELECT count(*)::text FROM discovery.attempt_lifecycle_history WHERE project_id = $1) AS attempts`,
      [executionProjectId],
    );
    expect(Number(lifecycleHistory.rows[0]!.jobs)).toBeGreaterThan(0);
    expect(Number(lifecycleHistory.rows[0]!.runs)).toBeGreaterThan(0);
    expect(Number(lifecycleHistory.rows[0]!.attempts)).toBeGreaterThan(0);

    const durable = await poolA!.query<{ finding_id: string; run_id: string; count: string }>(
      `SELECT finding_id, run_id, count(*) OVER (PARTITION BY finding_id, finding_revision)::text AS count
         FROM discovery.findings WHERE project_id = $1`,
      [executionProjectId],
    );
    expect(durable.rows).toEqual([
      expect.objectContaining({
        finding_id: 'akp-8-wp3-recovered-finding',
        run_id: (await runtimeA.findRun({
          projectId: executionProjectId,
          jobId: 'wp3-restart-job',
          runId: crashed!.runId,
        }))!.runId,
        count: '1',
      }),
    ]);
    const publication = await runtimeA.findFindingReady({
      projectId: executionProjectId,
      findingId: 'akp-8-wp3-recovered-finding',
      findingRevision: 1,
    });
    expect(publication?.attemptId).toBe(current.rows[0] ? crashed!.attemptId : undefined);
    expect(publication).toBeDefined();
  });

  it('removes an obsolete resource from active semantic membership and proves incremental/full equivalence', async () => {
    const sourceReader = new PostgresSemanticCorpusSourceSnapshotReader(poolA!);

    let embedBatchCalls = 0;
    const resolver = {
      resolveExecution: async () => resolvedExecution,
      resolveCompatibility: async (
        input: Parameters<SemanticEmbeddingCompatibilityPort['resolveCompatibility']>[0],
      ) => input,
    } as SemanticEmbeddingResolverPort & SemanticEmbeddingCompatibilityPort;
    const router: SemanticEmbeddingRouterPort = {
      embed: async () => ({
        vector: [1, 0],
        dimension: 2,
        providerId: semanticProfile.providerId,
        modelId: semanticProfile.embeddingModelId,
      }),
      embedBatch: async (_pin, payloads) => {
        embedBatchCalls += 1;
        return payloads.map(() => ({
          vector: [1, 0],
          dimension: 2,
          providerId: semanticProfile.providerId,
          modelId: semanticProfile.embeddingModelId,
        }));
      },
    };
    const repository = new PostgresSemanticIndexRepository(poolA!);
    const builder = new SemanticGenerationBuilder(
      repository,
      sourceReader,
      resolver,
      router,
      undefined,
      { now: () => now, maxBatchSize: 8 },
    );

    const sourceBefore = await sourceReader.readSnapshot(semanticProjectId);
    expect(sourceBefore.resources.map((resource) => resource.resourceId)).toEqual(
      expect.arrayContaining(['canonical-sentinel-claim', 'old-resource', 'retained-resource']),
    );

    const canonicalBefore = await poolA!.query(
      `SELECT version, snapshot_digest, updated_at::text FROM canonical.project_state WHERE project_id = $1`,
      [semanticProjectId],
    );
    const auditBefore = await poolA!.query(
      `SELECT deleted_by, retention_class, lineage_digest FROM project_audit.project_tombstones WHERE project_id = $1`,
      [semanticProjectId],
    );

    const first = await builder.build({
      projectId: semanticProjectId,
      targetProfileRevision: 1,
      generationId: 'wp3-semantic-generation-v1',
    });
    expect(first.status).toBe('ACTIVATED');
    expect(embedBatchCalls).toBe(1);

    await poolA!.query(
      `UPDATE knowledge.review_groups
          SET status = 'REJECTED', updated_at = $2
        WHERE project_id = $1 AND group_id = 'wp3-old-resource-group'`,
      [semanticProjectId, later],
    );
    const sourceAfterEligibilityChange = await sourceReader.readSnapshot(semanticProjectId);
    expect(
      sourceAfterEligibilityChange.resources.map((resource) => resource.resourceId),
    ).not.toContain('old-resource');
    expect(sourceAfterEligibilityChange.resources.map((resource) => resource.resourceId)).toEqual(
      expect.arrayContaining(['canonical-sentinel-claim', 'retained-resource']),
    );
    expect(sourceAfterEligibilityChange.canonicalSnapshotDigest).toBe(
      sourceBefore.canonicalSnapshotDigest,
    );
    expect(sourceAfterEligibilityChange.sourceSnapshotDigest).not.toBe(
      sourceBefore.sourceSnapshotDigest,
    );
    const incremental = await builder.build({
      projectId: semanticProjectId,
      targetProfileRevision: 1,
      generationId: 'wp3-semantic-generation-v2-incremental',
    });
    expect(incremental.status).toBe('ACTIVATED');
    expect(
      await repository.getItem(
        semanticProjectId,
        incremental.generationId,
        'ENTITY',
        'old-resource',
      ),
    ).toBeUndefined();
    const retainedIncremental = await repository.getItem(
      semanticProjectId,
      incremental.generationId,
      'ENTITY',
      'retained-resource',
    );
    const canonicalIncremental = await repository.getItem(
      semanticProjectId,
      incremental.generationId,
      'CLAIM',
      'canonical-sentinel-claim',
    );
    expect(retainedIncremental).toBeDefined();
    expect(canonicalIncremental).toBeDefined();
    expect(
      await repository.readGenerationMembershipSummary(semanticProjectId, incremental.generationId),
    ).toEqual({
      projectId: semanticProjectId,
      generationId: incremental.generationId,
      itemCount: 2,
      membershipDigest: semanticMembershipDigest([canonicalIncremental!, retainedIncremental!]),
    });

    const full = await builder.build({
      projectId: semanticProjectId,
      targetProfileRevision: 1,
      generationId: 'wp3-semantic-generation-v3-full',
    });
    expect(full.status).toBe('ACTIVATED');
    expect(full.membershipDigest).toBe(incremental.membershipDigest);
    expect(full.itemCount).toBe(incremental.itemCount);
    expect(embedBatchCalls).toBe(1);

    const activeGeneration = await repository.getGeneration(semanticProjectId, full.generationId);
    expect(activeGeneration).toBeDefined();
    const inWindowGeneration = {
      ...activeGeneration!,
      generationId: 'wp3-semantic-generation-in-window',
      sourceProjectionDigest: digest('semantic-window-source'),
      createdAt: later,
    };
    const buildingGeneration = {
      ...activeGeneration!,
      generationId: 'wp3-semantic-generation-building',
      buildStatus: 'BUILDING' as const,
    };
    expect(await repository.saveGeneration(inWindowGeneration)).toBe('CREATED');
    expect(await repository.saveGeneration(buildingGeneration)).toBe('CREATED');

    expect(
      await repository.getItem(semanticProjectId, first.generationId, 'ENTITY', 'old-resource'),
    ).toBeDefined();
    const pointer = await repository.getActiveGenerationPointer(semanticProjectId);
    expect(pointer?.activeGenerationId).toBe(full.generationId);
    const canonicalBeforePrune = await poolA!.query(
      `SELECT version, snapshot_digest, updated_at::text FROM canonical.project_state WHERE project_id = $1`,
      [semanticProjectId],
    );
    const auditBeforePrune = await poolA!.query(
      `SELECT deleted_by, retention_class, lineage_digest FROM project_audit.project_tombstones WHERE project_id = $1`,
      [semanticProjectId],
    );
    const prune = await builder.prune({ projectId: semanticProjectId, pruneBefore: later });
    expect(prune.deletedGenerationIds).toEqual([first.generationId]);
    expect(prune.activeGenerationId).toBe(full.generationId);
    expect(prune.rollbackProtectedGenerationId).toBe(incremental.generationId);
    expect(prune.skipped).toEqual(
      expect.arrayContaining([
        { generationId: full.generationId, reason: 'ACTIVE' },
        { generationId: incremental.generationId, reason: 'ROLLBACK_PROTECTED' },
        { generationId: inWindowGeneration.generationId, reason: 'WITHIN_ROLLBACK_WINDOW' },
        { generationId: buildingGeneration.generationId, reason: 'BUILDING' },
      ]),
    );
    expect(await repository.getGeneration(semanticProjectId, first.generationId)).toBeUndefined();
    expect(
      await repository.getItem(semanticProjectId, first.generationId, 'ENTITY', 'old-resource'),
    ).toBeUndefined();
    expect(
      await repository.getGeneration(semanticProjectId, incremental.generationId),
    ).toBeDefined();
    expect(await repository.getGeneration(semanticProjectId, full.generationId)).toBeDefined();
    expect(
      await repository.getGeneration(semanticProjectId, inWindowGeneration.generationId),
    ).toBeDefined();
    expect(
      await repository.getGeneration(semanticProjectId, buildingGeneration.generationId),
    ).toBeDefined();

    const activeReader = new PostgresSemanticActiveGenerationReader(repository);
    const semanticRetriever = new SemanticRetriever(repository, resolver, router, activeReader, {
      sourceWatermarkReader: sourceReader,
    });
    const activeResults = await semanticRetriever.retrieve({
      projectId: semanticProjectId,
      query: 'retained semantic resource',
      accessScopes: ['owner'],
      allowedSensitivities: ['private'],
    });
    expect(activeResults).toEqual(
      expect.arrayContaining([expect.objectContaining({ resourceId: 'retained-resource' })]),
    );
    expect((await activeReader.getActiveGeneration(semanticProjectId))?.generationId).toBe(
      full.generationId,
    );
    expect(
      await poolA!.query(
        `SELECT version, snapshot_digest, updated_at::text FROM canonical.project_state WHERE project_id = $1`,
        [semanticProjectId],
      ),
    ).toEqual(canonicalBeforePrune);
    expect(
      await poolA!.query(
        `SELECT deleted_by, retention_class, lineage_digest FROM project_audit.project_tombstones WHERE project_id = $1`,
        [semanticProjectId],
      ),
    ).toEqual(auditBeforePrune);
    expect(canonicalBefore).toEqual(canonicalBeforePrune);
    expect(auditBefore).toEqual(auditBeforePrune);
  });
});
