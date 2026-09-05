import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresComparisonV2Repository } from '../../adapters/postgres-stage5/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  analysisInputDigestV2,
  createExactDuplicateComparisonResultV2,
  semanticRelationshipMaterialDigestV2,
  sha256Text,
  stableJson,
  type AnalysisRevisionV2,
  type ComparisonCandidateV2,
  type ComparisonResultV2,
  type ExactDuplicateTargetV2,
  type SemanticRelationshipV2,
  type ShortlistAuditV2,
} from '../../packages/contracts/src/index.js';
import {
  comparisonV2StorageIdentity,
  type ComparisonV2Aggregate,
  type ComparisonV2StorageIdentity,
} from '../../modules/comparison/src/index.js';
import { authoritativeIntegrityTablesForMigrations } from '../../scripts/backup-restore.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim();
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

const digest = (value: unknown): string => sha256Text(stableJson(value));

const makeCandidate = (
  projectId: string,
): {
  readonly candidate: ComparisonCandidateV2;
  readonly sourceVersionId: string;
  readonly sourceId: string;
  readonly revisionId: string;
  readonly evidenceId: string;
  readonly batchId: string;
} => {
  const candidateId = randomUUID();
  const sourceVersionId = randomUUID();
  const sourceId = randomUUID();
  const revisionId = randomUUID();
  const evidenceId = randomUUID();
  const batchId = randomUUID();
  return {
    candidate: {
      id: candidateId,
      revision: 1,
      digest: digest({ candidateId, projectId, sourceVersionId }),
      sourceVersionId,
      evidenceIds: [evidenceId],
    },
    sourceVersionId,
    sourceId,
    revisionId,
    evidenceId,
    batchId,
  };
};

const insertCandidate = async (
  database: Pool,
  projectId: string,
  fixture: ReturnType<typeof makeCandidate>,
): Promise<void> => {
  await database.query(
    `INSERT INTO transformation.revisions (
       revision_id, project_id, source_id, source_version_id, source_content_hash,
       transformer_id, transformer_version, document_ir, source_map, document_hash,
       source_map_hash, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, $3, $4, $5, 'test', '1', '{}', '{}', $5, $5, '{owner}', 'public', now())`,
    [fixture.revisionId, projectId, fixture.sourceId, fixture.sourceVersionId, digest(fixture)],
  );
  await database.query(
    `INSERT INTO evidence.spans (
       evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
       node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, $3, $4, $5, '/claim', 'sentence', 'source',
       '{"start":0,"end":1}', '{"text":"claim"}', $6, '{owner}', 'public', now())`,
    [
      fixture.evidenceId,
      fixture.revisionId,
      projectId,
      fixture.sourceId,
      fixture.sourceVersionId,
      digest(fixture.candidate),
    ],
  );
  await database.query(
    `INSERT INTO candidate.batches (
       batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at
     ) VALUES ($1, $2, $3, $4, '{}', now())`,
    [fixture.batchId, projectId, fixture.sourceVersionId, `batch:${fixture.batchId}`],
  );
  await database.query(
    `INSERT INTO candidate.claim_candidates (
       candidate_id, batch_id, project_id, source_version_id, revision_number, claim_text,
       evidence_id, evidence_mode, extraction_profile, status, provider_call,
       access_scope, sensitivity, created_at
     ) VALUES ($1, $2, $3, $4, 1, 'WP2 fixture claim', $5, 'DIRECT_EVIDENCE',
       'direct-only', 'READY', '{}', '{owner}', 'public', now())`,
    [fixture.candidate.id, fixture.batchId, projectId, fixture.sourceVersionId, fixture.evidenceId],
  );
};

const makeSnapshot = (projectId: string) => ({
  id: `snapshot-${projectId}`,
  version: 1,
  digest: digest({ projectId, snapshot: 1 }),
});

const makeShortlist = (
  snapshot: ReturnType<typeof makeSnapshot>,
  resourceIds: readonly string[] = ['claim-a'],
): ShortlistAuditV2 => ({
  contractVersion: '2.0',
  canonicalSnapshot: snapshot,
  lexicalProjectionWatermark: 'watermark-1',
  lexicalProjectionBase: 'base-1',
  semanticGenerationId: 'generation-1',
  semanticSourceProjectionDigest: digest('projection-1'),
  semanticCanonicalBaseVersion: snapshot.version,
  querySemanticReadiness: 'READY',
  policyRevision: 'policy-1',
  k: Math.max(1, resourceIds.length),
  selectedTargetIdentities: resourceIds.map((resourceId) => ({
    resourceType: 'CLAIM' as const,
    resourceId,
    resourceRevision: 1,
  })),
  exclusionCounts: {},
  truncated: false,
  coverageStatus: 'COMPLETE',
});

const makeAnalysis = (input: {
  readonly comparisonId: string;
  readonly candidate: ComparisonCandidateV2;
  readonly snapshot: ReturnType<typeof makeSnapshot>;
  readonly resourceIds: readonly string[];
  readonly state?: AnalysisRevisionV2['state'];
  readonly analysisRevisionId?: string;
  readonly attempt?: number;
}): AnalysisRevisionV2 => {
  const base: Omit<AnalysisRevisionV2, 'inputDigest'> = {
    analysisRevisionId: input.analysisRevisionId ?? randomUUID(),
    contractVersion: '2.0',
    comparisonId: input.comparisonId,
    candidate: input.candidate,
    canonicalSnapshot: input.snapshot,
    shortlistDigest: digest(makeShortlist(input.snapshot, input.resourceIds)),
    comparedResourceIdentities: input.resourceIds.map((resourceId) => ({
      resourceType: 'CLAIM' as const,
      resourceId,
      resourceRevision: 1,
    })),
    providerIdentity: {
      providerId: 'provider-test',
      modelId: 'model-test',
      capabilityId: 'capability-test',
    },
    credentialRevisionRef: 'credential-revision-1',
    promptTemplateRevision: 'prompt-1',
    outputSchemaRevision: 'schema-1',
    semanticPolicyRevision: 'semantic-policy-1',
    attempt: input.attempt ?? 1,
    state: input.state ?? 'COMPLETED',
    outcome:
      input.state && !['PENDING', 'ANALYZING'].includes(input.state)
        ? (input.state as Exclude<AnalysisRevisionV2['state'], 'PENDING' | 'ANALYZING'>)
        : input.state === undefined
          ? 'COMPLETED'
          : undefined,
    startedAt: '2026-09-05T00:00:00.000Z',
    completedAt:
      input.state === undefined || input.state === 'COMPLETED'
        ? '2026-09-05T00:00:01.000Z'
        : undefined,
    durationMs: input.state === undefined || input.state === 'COMPLETED' ? 1000 : undefined,
    outputDigest:
      input.state === undefined || input.state === 'COMPLETED' ? digest('output') : undefined,
    materialDigest:
      input.state === undefined || input.state === 'COMPLETED' ? digest('material') : undefined,
    safeFailureCode:
      input.state !== undefined &&
      input.state !== 'COMPLETED' &&
      !['PENDING', 'ANALYZING'].includes(input.state)
        ? 'SEMANTIC_UNAVAILABLE'
        : undefined,
    createdAt: '2026-09-05T00:00:00.000Z',
  };
  const revision = { ...base, inputDigest: analysisInputDigestV2(base) };
  return revision;
};

const makeRelationship = (input: {
  readonly comparisonId: string;
  readonly candidate: ComparisonCandidateV2;
  readonly snapshot: ReturnType<typeof makeSnapshot>;
  readonly analysisRevisionId: string;
  readonly resourceId: string;
  readonly type?: SemanticRelationshipV2['type'];
}): SemanticRelationshipV2 => {
  const relationshipWithoutDigest: Omit<SemanticRelationshipV2, 'materialDigest'> = {
    relationshipId: randomUUID(),
    contractVersion: '2.0',
    comparisonId: input.comparisonId,
    candidateId: input.candidate.id,
    candidateRevision: input.candidate.revision,
    candidateDigest: input.candidate.digest,
    candidateEvidenceIds: input.candidate.evidenceIds,
    comparedResource: { resourceType: 'CLAIM', resourceId: input.resourceId, resourceRevision: 1 },
    canonicalSnapshot: {
      snapshotId: input.snapshot.id,
      version: input.snapshot.version,
      digest: input.snapshot.digest,
    },
    type: input.type ?? 'SUPPORTS',
    analysisRevisionId: input.analysisRevisionId,
    ruleIdentity: 'rule-1',
    rationale: 'WP2 durable relationship fixture.',
    accessScope: ['owner'],
    sensitivity: 'public',
    revision: 1,
    createdAt: '2026-09-05T00:00:01.000Z',
  };
  return {
    ...relationshipWithoutDigest,
    materialDigest: semanticRelationshipMaterialDigestV2(relationshipWithoutDigest),
  };
};

const semanticAggregate = (input: {
  readonly projectId: string;
  readonly candidate: ComparisonCandidateV2;
  readonly disposition?: 'NEW' | 'REVIEW_REQUIRED';
  readonly relationshipCount?: number;
  readonly comparisonId?: string;
  readonly analysisCount?: number;
}): ComparisonV2Aggregate => {
  const comparisonId = input.comparisonId ?? randomUUID();
  const snapshot = makeSnapshot(input.projectId);
  const relationshipCount = input.relationshipCount ?? (input.disposition === 'NEW' ? 0 : 1);
  const analysisCount = input.analysisCount ?? Math.max(1, relationshipCount);
  const resourceIds = Array.from(
    { length: Math.max(analysisCount, relationshipCount) },
    (_, index) => `claim-${index + 1}`,
  );
  const analyses = Array.from({ length: analysisCount }, (_, index) =>
    makeAnalysis({
      comparisonId,
      candidate: input.candidate,
      snapshot,
      resourceIds: [resourceIds[index] ?? resourceIds[0]!],
      analysisRevisionId: `analysis-${comparisonId}-${index + 1}`,
    }),
  );
  const relationships = Array.from({ length: relationshipCount }, (_, index) =>
    makeRelationship({
      comparisonId,
      candidate: input.candidate,
      snapshot,
      analysisRevisionId: analyses[index % analyses.length]!.analysisRevisionId,
      resourceId: resourceIds[index]!,
    }),
  );
  const comparison: ComparisonResultV2 = {
    comparisonId,
    contractVersion: '2.0',
    projectId: input.projectId,
    candidate: input.candidate,
    canonicalSnapshot: snapshot,
    disposition: input.disposition ?? 'REVIEW_REQUIRED',
    reviewRecommendation: input.disposition === 'NEW' ? 'ADD_CLAIM' : 'MODIFY_REVIEW',
    shortlist: makeShortlist(snapshot, resourceIds),
    analysisRevisionIds: analyses.map((analysis) => analysis.analysisRevisionId),
    relationshipIds: relationships.map((relationship) => relationship.relationshipId),
    accessScope: ['owner'],
    sensitivity: 'public',
    createdAt: '2026-09-05T00:00:01.000Z',
  };
  return { comparison, relationships, analyses };
};

const exactAggregate = (input: {
  readonly projectId: string;
  readonly candidate: ComparisonCandidateV2;
  readonly comparisonId?: string;
}): ComparisonV2Aggregate => {
  const snapshot = makeSnapshot(input.projectId);
  const target: ExactDuplicateTargetV2 = {
    resourceType: 'CLAIM',
    resourceId: 'claim-exact',
    resourceRevision: 1,
    canonicalSnapshot: snapshot,
  };
  return {
    comparison: createExactDuplicateComparisonResultV2({
      comparisonId: input.comparisonId ?? randomUUID(),
      projectId: input.projectId,
      candidate: input.candidate,
      canonicalSnapshot: snapshot,
      exactDuplicateTarget: target,
      accessScope: ['owner'],
      sensitivity: 'public',
      createdAt: '2026-09-05T00:00:01.000Z',
    }),
    relationships: [],
    analyses: [],
  };
};

const identityFor = (aggregate: ComparisonV2Aggregate): ComparisonV2StorageIdentity =>
  comparisonV2StorageIdentity(aggregate);

describe.runIf(pool)('Stage 5 WP2 PostgreSQL Comparison v2 persistence', () => {
  beforeEach(async () => {
    await pool!.query(`
      TRUNCATE
        comparison.relationships_v2,
        comparison.results_v2,
        comparison.analysis_revisions_v2,
        candidate.claim_candidates,
        candidate.batches,
        evidence.spans,
        transformation.revisions
      CASCADE
    `);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('P2-01 persists a semantic aggregate with two analyses and two relationships and reloads it', async () => {
    const projectId = `wp2-01-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const aggregate = semanticAggregate({
      projectId,
      candidate: fixture.candidate,
      relationshipCount: 2,
      analysisCount: 2,
    });
    const repository = new PostgresComparisonV2Repository(pool!);
    await repository.saveCompletedAggregate(aggregate);
    const reloaded = await new PostgresComparisonV2Repository(pool!).findComparisonById(
      projectId,
      aggregate.comparison.comparisonId,
    );
    expect(stableJson(reloaded)).toBe(stableJson(aggregate));
    expect(reloaded?.relationships).toHaveLength(2);
    expect(reloaded?.analyses).toHaveLength(2);
  });

  it('P2-02 persists a zero-relationship NEW aggregate with completed lineage', async () => {
    const projectId = `wp2-02-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const aggregate = semanticAggregate({
      projectId,
      candidate: fixture.candidate,
      disposition: 'NEW',
      relationshipCount: 0,
      analysisCount: 1,
    });
    const repository = new PostgresComparisonV2Repository(pool!);
    await repository.saveCompletedAggregate(aggregate);
    expect(await repository.findComparisonByIdentity(identityFor(aggregate))).toEqual(aggregate);
  });

  it('P2-03 persists the deterministic exact path without semantic children', async () => {
    const projectId = `wp2-03-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const aggregate = exactAggregate({ projectId, candidate: fixture.candidate });
    const repository = new PostgresComparisonV2Repository(pool!);
    await repository.saveCompletedAggregate(aggregate);
    const stored = await repository.findComparisonByIdentity(identityFor(aggregate));
    expect(stored?.comparison.disposition).toBe('EXACT_DUPLICATE');
    expect(stored?.analyses).toEqual([]);
    expect(stored?.relationships).toEqual([]);
  });

  it('P2-04 converges equivalent replay with a different generated comparison id', async () => {
    const projectId = `wp2-04-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const first = semanticAggregate({ projectId, candidate: fixture.candidate });
    const replayComparisonId = randomUUID();
    const replay = {
      ...first,
      comparison: { ...first.comparison, comparisonId: replayComparisonId },
      relationships: first.relationships.map((relationship) => ({
        ...relationship,
        comparisonId: replayComparisonId,
      })),
      analyses: first.analyses.map((analysis) => ({
        ...analysis,
        comparisonId: replayComparisonId,
        inputDigest: analysisInputDigestV2(analysis),
      })),
    } satisfies ComparisonV2Aggregate;
    const repository = new PostgresComparisonV2Repository(pool!);
    const stored = await repository.saveCompletedAggregate(first);
    const converged = await repository.saveCompletedAggregate(replay);
    expect(converged).toEqual(stored);
    expect(
      (await pool!.query('SELECT count(*)::int AS count FROM comparison.results_v2')).rows[0].count,
    ).toBe(1);
  });

  it('P2-05 rejects replay with conflicting authoritative content and keeps the original', async () => {
    const projectId = `wp2-05-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const first = semanticAggregate({ projectId, candidate: fixture.candidate });
    const conflicting = {
      ...first,
      comparison: { ...first.comparison, reviewRecommendation: 'HOLD' as const },
    } satisfies ComparisonV2Aggregate;
    const repository = new PostgresComparisonV2Repository(pool!);
    await repository.saveCompletedAggregate(first);
    await expect(repository.saveCompletedAggregate(conflicting)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await repository.findComparisonById(projectId, first.comparison.comparisonId)).toEqual(
      first,
    );
  });

  it('P2-06 converges concurrent aggregate inserts without duplicate children', async () => {
    const projectId = `wp2-06-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const aggregate = semanticAggregate({
      projectId,
      candidate: fixture.candidate,
      relationshipCount: 2,
      analysisCount: 2,
    });
    const [left, right] = await Promise.all([
      new PostgresComparisonV2Repository(pool!).saveCompletedAggregate(aggregate),
      new PostgresComparisonV2Repository(pool!).saveCompletedAggregate(aggregate),
    ]);
    expect(left).toEqual(right);
    const counts = await pool!.query<{ results: string; analyses: string; relationships: string }>(
      `SELECT
         (SELECT count(*)::text FROM comparison.results_v2 WHERE project_id = $1) AS results,
         (SELECT count(*)::text FROM comparison.analysis_revisions_v2 WHERE project_id = $1) AS analyses,
         (SELECT count(*)::text FROM comparison.relationships_v2 WHERE project_id = $1) AS relationships`,
      [projectId],
    );
    expect(counts.rows[0]).toEqual({ results: '1', analyses: '2', relationships: '2' });
  });

  it('P2-07 converges duplicate AnalysisRevision attempts', async () => {
    const projectId = `wp2-07-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const analysis = makeAnalysis({
      comparisonId: randomUUID(),
      candidate: fixture.candidate,
      snapshot: makeSnapshot(projectId),
      resourceIds: ['claim-a'],
    });
    const repository = new PostgresComparisonV2Repository(pool!);
    const first = await repository.saveAnalysisRevision({ projectId, revision: analysis });
    const second = await repository.saveAnalysisRevision({
      projectId,
      revision: { ...analysis, analysisRevisionId: randomUUID() },
    });
    expect(second).toEqual(first);
    expect(
      (await pool!.query('SELECT count(*)::int AS count FROM comparison.analysis_revisions_v2'))
        .rows[0].count,
    ).toBe(1);
  });

  it('P2-08 preserves a legitimate retry as a separate AnalysisRevision attempt', async () => {
    const projectId = `wp2-08-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const snapshot = makeSnapshot(projectId);
    const repository = new PostgresComparisonV2Repository(pool!);
    const first = makeAnalysis({
      comparisonId: randomUUID(),
      candidate: fixture.candidate,
      snapshot,
      resourceIds: ['claim-a'],
      attempt: 1,
    });
    const retry = makeAnalysis({
      comparisonId: randomUUID(),
      candidate: fixture.candidate,
      snapshot,
      resourceIds: ['claim-a'],
      attempt: 2,
    });
    await repository.saveAnalysisRevision({ projectId, revision: first });
    await repository.saveAnalysisRevision({ projectId, revision: retry });
    expect(
      (await pool!.query('SELECT count(*)::int AS count FROM comparison.analysis_revisions_v2'))
        .rows[0].count,
    ).toBe(2);
  });

  it('P2-09 applies legal lifecycle CAS and rejects stale or illegal transitions without mutation', async () => {
    const projectId = `wp2-09-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const analysis = makeAnalysis({
      comparisonId: randomUUID(),
      candidate: fixture.candidate,
      snapshot: makeSnapshot(projectId),
      resourceIds: ['claim-a'],
      state: 'PENDING',
    });
    const repository = new PostgresComparisonV2Repository(pool!);
    await repository.saveAnalysisRevision({ projectId, revision: analysis });
    const analyzing = await repository.transitionAnalysisRevision({
      projectId,
      analysisRevisionId: analysis.analysisRevisionId,
      expectedState: 'PENDING',
      nextState: 'ANALYZING',
      updates: { startedAt: '2026-09-05T00:01:00.000Z' },
    });
    expect(analyzing.state).toBe('ANALYZING');
    await expect(
      repository.transitionAnalysisRevision({
        projectId,
        analysisRevisionId: analysis.analysisRevisionId,
        expectedState: 'PENDING',
        nextState: 'COMPLETED',
        updates: { outputDigest: digest('output'), materialDigest: digest('material') },
      }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    await expect(
      repository.transitionAnalysisRevision({
        projectId,
        analysisRevisionId: analysis.analysisRevisionId,
        expectedState: 'ANALYZING',
        nextState: 'PENDING',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(
      (await repository.findAnalysisRevision(projectId, analysis.analysisRevisionId))?.state,
    ).toBe('ANALYZING');
  });

  it('P2-10 preserves an unresolved ANALYZING attempt across repository restart', async () => {
    const projectId = `wp2-10-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const analysis = makeAnalysis({
      comparisonId: randomUUID(),
      candidate: fixture.candidate,
      snapshot: makeSnapshot(projectId),
      resourceIds: ['claim-a'],
      state: 'ANALYZING',
    });
    await new PostgresComparisonV2Repository(pool!).saveAnalysisRevision({
      projectId,
      revision: analysis,
    });
    const restarted = new PostgresComparisonV2Repository(pool!);
    expect(await restarted.findAnalysisRevision(projectId, analysis.analysisRevisionId)).toEqual(
      analysis,
    );
    expect(
      (
        await restarted.findAnalysisRevisionByInput({
          projectId,
          candidateId: fixture.candidate.id,
          candidateRevision: 1,
          canonicalSnapshotDigest: analysis.canonicalSnapshot.digest,
          inputDigest: analysis.inputDigest,
          attempt: 1,
        })
      )?.state,
    ).toBe('ANALYZING');
  });

  it('P2-11 rolls back a completed aggregate when one child conflicts', async () => {
    const projectId = `wp2-11-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const valid = semanticAggregate({ projectId, candidate: fixture.candidate });
    const invalid = {
      ...valid,
      relationships: valid.relationships.map((relationship) => ({
        ...relationship,
        analysisRevisionId: 'unknown-analysis',
      })),
    } satisfies ComparisonV2Aggregate;
    const repository = new PostgresComparisonV2Repository(pool!);
    await expect(repository.saveCompletedAggregate(invalid)).rejects.toThrow();
    expect(
      await repository.findComparisonById(projectId, valid.comparison.comparisonId),
    ).toBeUndefined();
    expect(
      (
        await pool!.query(
          'SELECT count(*)::int AS count FROM comparison.relationships_v2 WHERE project_id = $1',
          [projectId],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it('P2-12 rejects cross-project aggregate references at the DB/adapter boundary', async () => {
    const projectA = `wp2-12-a-${randomUUID()}`;
    const projectB = `wp2-12-b-${randomUUID()}`;
    const fixtureA = makeCandidate(projectA);
    const fixtureB = makeCandidate(projectB);
    await insertCandidate(pool!, projectA, fixtureA);
    await insertCandidate(pool!, projectB, fixtureB);
    const aggregate = semanticAggregate({ projectId: projectA, candidate: fixtureB.candidate });
    await expect(
      new PostgresComparisonV2Repository(pool!).saveCompletedAggregate(aggregate),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('P2-13 rejects non-CLAIM active persistence before durable rows exist', async () => {
    const projectId = `wp2-13-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const aggregate = semanticAggregate({ projectId, candidate: fixture.candidate });
    const invalid = {
      ...aggregate,
      analyses: aggregate.analyses.map((analysis) => ({
        ...analysis,
        comparedResourceIdentities: [
          { resourceType: 'ENTITY' as const, resourceId: 'entity-1', resourceRevision: 1 },
        ],
        inputDigest: analysisInputDigestV2({
          ...analysis,
          comparedResourceIdentities: [
            { resourceType: 'ENTITY' as const, resourceId: 'entity-1', resourceRevision: 1 },
          ],
        }),
      })),
    } as unknown as ComparisonV2Aggregate;
    await expect(
      new PostgresComparisonV2Repository(pool!).saveCompletedAggregate(invalid),
    ).rejects.toThrow();
    expect(
      (
        await pool!.query(
          'SELECT count(*)::int AS count FROM comparison.results_v2 WHERE project_id = $1',
          [projectId],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it('P2-14 disables v2 writes while keeping existing v2 reads and v1 repository behavior available', async () => {
    const projectId = `wp2-14-${randomUUID()}`;
    const fixture = makeCandidate(projectId);
    await insertCandidate(pool!, projectId, fixture);
    const aggregate = exactAggregate({ projectId, candidate: fixture.candidate });
    const repository = new PostgresComparisonV2Repository(pool!);
    await repository.saveCompletedAggregate(aggregate);
    repository.setWriterEnabled(false);
    await expect(
      repository.saveCompletedAggregate(
        exactAggregate({ projectId, candidate: fixture.candidate }),
      ),
    ).rejects.toMatchObject({ code: 'POLICY_DENIED' });
    expect(
      await repository.findComparisonById(projectId, aggregate.comparison.comparisonId),
    ).toEqual(aggregate);
  });

  it('P2-15 leaves the v1 Stage 5 tables untouched', async () => {
    const tables = await pool!.query<{ relname: string }>(
      `SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'comparison' AND c.relname IN ('results', 'results_v2') ORDER BY relname`,
    );
    expect(tables.rows.map((row) => row.relname)).toEqual(['results', 'results_v2']);
  });

  it('P2-16 migration 066 is additive and keeps v1 definitions unchanged', async () => {
    const migration = await import('node:fs/promises').then(({ readFile }) =>
      readFile('db/migrations/066_stage5_semantic_comparison_v2_persistence.sql', 'utf8'),
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS comparison.results_v2');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS comparison.analysis_revisions_v2');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS comparison.relationships_v2');
    expect(migration).not.toMatch(/ALTER TABLE comparison\.results\b/iu);
    expect(migration).not.toMatch(/DROP TABLE/iu);
    const migrationRows = await pool!.query<{ name: string }>(
      `SELECT name FROM runtime.schema_migrations WHERE name = '066_stage5_semantic_comparison_v2_persistence.sql'`,
    );
    expect(migrationRows.rows).toHaveLength(1);
  });

  it('P2-17 backup integrity allowlist includes v2 stores only after migration 066', async () => {
    const tables = authoritativeIntegrityTablesForMigrations([
      '005_stage5_comparison_review.sql',
      '066_stage5_semantic_comparison_v2_persistence.sql',
    ]);
    expect(tables).toEqual(
      expect.arrayContaining([
        'comparison.results',
        'comparison.results_v2',
        'comparison.analysis_revisions_v2',
        'comparison.relationships_v2',
      ]),
    );
  });
});

if (!pool) {
  describe('Stage 5 WP2 PostgreSQL Comparison v2 persistence', () => {
    it.skip('TEST_DATABASE_URL is unavailable; real PostgreSQL proof is deferred to automatic CI.', () => {});
  });
}
