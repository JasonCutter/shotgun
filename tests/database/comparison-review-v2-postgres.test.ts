import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresChangeSetReviewV2Repository } from '../../adapters/postgres-stage5/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { migrateUpTo } from '../../scripts/database.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import {
  approvedChangeSetApprovalTokenDigestV2,
  approvedChangeSetManifestDigestV2,
  canonicalSnapshotDigest,
  comparisonFreshnessDigestV2,
  comparisonResultDigestV2,
  createExactDuplicateComparisonResultV2,
  draftChangeSetContentDigestV2,
  sha256Text,
  stableJson,
  validateDraftChangeSetV2,
  type ApprovedChangeSetApprovalTokenV2,
  type ApprovedChangeSetManifestV2,
  type ComparisonResultV2,
  type DraftChangeSetV2,
} from '../../packages/contracts/src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

type Fixture = {
  readonly projectId: string;
  readonly comparisonId: string;
  readonly draft: DraftChangeSetV2;
};

const makeFixture = async (database: Pool): Promise<Fixture> => {
  const projectId = `review-v2-db-${randomUUID()}`;
  const candidateId = randomUUID();
  const batchId = randomUUID();
  const evidenceId = randomUUID();
  const sourceVersionId = randomUUID();
  const sourceId = randomUUID();
  const revisionId = randomUUID();
  const comparisonId = `comparison-v2-db-${randomUUID()}`;
  const createdAt = '2026-09-05T12:00:00.000Z';
  const sourceDigest = sha256Text(`${projectId}:source`);
  const candidateDigest = sha256Text(`${projectId}:candidate`);
  const snapshotClaims = [
    { claimId: 'claim-db-1', text: 'Existing claim', revisionNumber: 1, evidenceIds: ['e-db-1'] },
  ];
  const snapshot = {
    id: `snapshot-${projectId}`,
    version: 1,
    digest: canonicalSnapshotDigest(projectId, 1, snapshotClaims),
  };
  const candidate = {
    id: candidateId,
    revision: 1 as const,
    digest: candidateDigest,
    sourceVersionId,
    evidenceIds: [evidenceId],
  };

  await database.query(
    `INSERT INTO transformation.revisions (
       revision_id, project_id, source_id, source_version_id, source_content_hash,
       transformer_id, transformer_version, document_ir, source_map, document_hash,
       source_map_hash, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, $3, $4, $5, 'test', '1', '{}', '{}', $5, $5, '{owner}', 'public', $6)`,
    [revisionId, projectId, sourceId, sourceVersionId, sourceDigest, createdAt],
  );
  await database.query(
    `INSERT INTO evidence.spans (
       evidence_id, revision_id, project_id, source_id, source_version_id, pointer,
       node_kind, origin, position, quote, exact_hash, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, $3, $4, $5, '/claim', 'sentence', 'source',
       '{"start":0,"end":1}', '{"text":"claim"}', $6, '{owner}', 'public', $7)`,
    [evidenceId, revisionId, projectId, sourceId, sourceVersionId, sourceDigest, createdAt],
  );
  await database.query(
    `INSERT INTO candidate.batches (
       batch_id, project_id, source_version_id, idempotency_key, provider_call, created_at
     ) VALUES ($1, $2, $3, $4, '{}', $5)`,
    [batchId, projectId, sourceVersionId, `batch:${batchId}`, createdAt],
  );
  await database.query(
    `INSERT INTO candidate.claim_candidates (
       candidate_id, batch_id, project_id, source_version_id, revision_number, claim_text,
       evidence_id, evidence_mode, extraction_profile, status, provider_call,
       access_scope, sensitivity, created_at
     ) VALUES ($1, $2, $3, $4, 1, 'Database fixture claim', $5, 'DIRECT_EVIDENCE',
       'direct-only', 'READY', '{}', '{owner}', 'public', $6)`,
    [candidateId, batchId, projectId, sourceVersionId, evidenceId, createdAt],
  );

  const comparison: ComparisonResultV2 = createExactDuplicateComparisonResultV2({
    comparisonId,
    projectId,
    candidate,
    canonicalSnapshot: snapshot,
    exactDuplicateTarget: {
      resourceType: 'CLAIM',
      resourceId: 'claim-db-1',
      resourceRevision: 1,
      canonicalSnapshot: snapshot,
    },
    accessScope: ['owner'],
    sensitivity: 'public',
    createdAt,
  });
  await database.query(
    `INSERT INTO comparison.results_v2 (
       comparison_id, project_id, candidate_id, candidate_revision, candidate_digest,
       source_version_id, snapshot_id, snapshot_version, snapshot_digest, disposition,
       review_recommendation, comparison_mode, exact_duplicate_claim_id,
       exact_duplicate_claim_revision, access_scope, sensitivity, logical_identity_digest,
       content_digest, result_json, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'DETERMINISTIC_EXACT',
       $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      comparisonId,
      projectId,
      candidateId,
      candidate.revision,
      candidate.digest,
      sourceVersionId,
      snapshot.id,
      snapshot.version,
      snapshot.digest,
      comparison.disposition,
      comparison.reviewRecommendation,
      comparison.exactDuplicateTarget!.resourceId,
      comparison.exactDuplicateTarget!.resourceRevision,
      ['owner'],
      'public',
      comparisonResultDigestV2(comparison),
      comparisonResultDigestV2(comparison),
      JSON.stringify(comparison),
      createdAt,
    ],
  );

  const freshnessIdentity = {
    mode: 'DETERMINISTIC_EXACT' as const,
    candidateId: candidate.id,
    candidateRevision: candidate.revision,
    candidateSourceVersionId: candidate.sourceVersionId,
    candidateDigest: candidate.digest,
    candidateEvidenceDigest: sha256Text(stableJson({ evidenceIds: [evidenceId] })),
    canonicalSnapshotId: snapshot.id,
    canonicalSnapshotDigest: snapshot.digest,
    canonicalSnapshotVersion: snapshot.version,
    exactDuplicateTarget: comparison.exactDuplicateTarget!,
    rolloutAuthorityRevision: 'rollout-db-1',
  };
  const draftWithoutDigest: Omit<DraftChangeSetV2, 'contentDigest'> = {
    changeSetId: `comparison-v2:${comparisonId}`,
    contractVersion: '2.0',
    revisionNumber: 1,
    projectId,
    candidate,
    comparisonId,
    comparisonDigest: comparisonResultDigestV2(comparison),
    canonicalSnapshot: comparison.canonicalSnapshot,
    analysisRevisionIds: [],
    disposition: comparison.disposition,
    relationshipIds: [],
    evidenceIds: [evidenceId],
    operation: 'NO_OP',
    reviewRecommendation: 'NO_OP',
    status: 'PENDING_REVIEW',
    expectedCanonicalVersion: snapshot.version,
    snapshotDigest: snapshot.digest,
    freshnessIdentity,
    freshnessDigest: comparisonFreshnessDigestV2(freshnessIdentity),
    accessScope: ['owner'],
    sensitivity: 'public',
    createdAt,
    updatedAt: createdAt,
  };
  const draft: DraftChangeSetV2 = {
    ...draftWithoutDigest,
    contentDigest: draftChangeSetContentDigestV2(draftWithoutDigest),
  };
  validateDraftChangeSetV2(draft);
  return { projectId, comparisonId, draft };
};

const makeApproval = (draft: DraftChangeSetV2) => {
  const decidedAt = '2026-09-05T12:01:00.000Z';
  const actor = { type: 'user' as const, id: 'db-owner' };
  const decision = {
    decisionId: `decision-v2:${draft.changeSetId}`,
    decision: 'APPROVE' as const,
    actor,
    reason: 'database approval fixture',
    decidedAt,
  };
  const updated = { ...draft, status: 'APPROVED' as const, updatedAt: decidedAt };
  const unsignedToken: Omit<ApprovedChangeSetApprovalTokenV2, 'tokenDigest'> = {
    tokenId: `token-v2:${draft.changeSetId}`,
    changeSetId: draft.changeSetId,
    changeSetRevisionNumber: draft.revisionNumber,
    actorId: actor.id,
    contentDigest: draft.contentDigest,
    expectedCanonicalVersion: draft.expectedCanonicalVersion,
    snapshotDigest: draft.snapshotDigest,
    issuedAt: decidedAt,
    expiresAt: '2026-09-05T12:16:00.000Z',
  };
  const approvalToken: ApprovedChangeSetApprovalTokenV2 = {
    ...unsignedToken,
    tokenDigest: approvedChangeSetApprovalTokenDigestV2(unsignedToken),
  };
  const withoutManifestDigest: Omit<ApprovedChangeSetManifestV2, 'manifestDigest'> = {
    manifestId: `manifest-v2:${draft.changeSetId}`,
    contractVersion: '2.0',
    changeSetId: draft.changeSetId,
    changeSetRevisionNumber: draft.revisionNumber,
    projectId: draft.projectId,
    candidate: draft.candidate,
    comparisonId: draft.comparisonId,
    comparisonDigest: draft.comparisonDigest,
    canonicalSnapshot: draft.canonicalSnapshot,
    analysisRevisionIds: [],
    disposition: draft.disposition,
    relationshipIds: [],
    evidenceIds: draft.evidenceIds,
    operation: draft.operation,
    expectedCanonicalVersion: draft.expectedCanonicalVersion,
    snapshotDigest: draft.snapshotDigest,
    freshnessIdentity: draft.freshnessIdentity,
    freshnessDigest: draft.freshnessDigest,
    accessScope: draft.accessScope,
    sensitivity: draft.sensitivity,
    contentDigest: draft.contentDigest,
    userApproval: {
      actor,
      reason: decision.reason,
      approvalTokenId: approvalToken.tokenId,
      approvalToken,
      approvedAt: decidedAt,
    },
    createdAt: decidedAt,
  };
  return {
    decision,
    updated,
    manifest: {
      ...withoutManifestDigest,
      manifestDigest: approvedChangeSetManifestDigestV2(withoutManifestDigest),
    },
  };
};

describe.runIf(databaseUrl)('WP5 v2 Review PostgreSQL persistence', () => {
  beforeAll(async () => {
    await migrateUpTo(undefined, databaseUrl!);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('creates additive Draft, decision, and immutable manifest tables', async () => {
    const result = await pool!.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'review' AND table_name IN
         ('change_sets_v2', 'decisions_v2', 'approved_manifests_v2')
       ORDER BY table_name`,
    );
    expect(result.rows.map((row) => row.table_name)).toEqual([
      'approved_manifests_v2',
      'change_sets_v2',
      'decisions_v2',
    ]);
  });

  it('DB-1/DB-2: round-trips and rejects conflicting Draft replay', async () => {
    const fixture = await makeFixture(pool!);
    const repository = new PostgresChangeSetReviewV2Repository(pool!);
    const stored = await repository.saveDraft(fixture.draft);
    expect(
      await repository.findDraftByComparisonId(fixture.projectId, fixture.comparisonId),
    ).toEqual(stored);
    expect(await repository.saveDraft(fixture.draft)).toEqual(stored);
    const conflicting = {
      ...fixture.draft,
      updatedAt: '2026-09-05T12:02:00.000Z',
      contentDigest: sha256Text('different-draft-content'),
    };
    await expect(repository.saveDraft(conflicting)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      await repository.findDraftByComparisonId(fixture.projectId, fixture.comparisonId),
    ).toEqual(stored);
  });

  it('DB-3: reads the same Draft through a fresh application DB connection', async () => {
    const fixture = await makeFixture(pool!);
    const repository = new PostgresChangeSetReviewV2Repository(pool!);
    await repository.saveDraft(fixture.draft);
    const freshPool = createPostgresPool(databaseUrl!);
    try {
      const freshRepository = new PostgresChangeSetReviewV2Repository(freshPool);
      expect(
        await freshRepository.findDraftByComparisonId(fixture.projectId, fixture.comparisonId),
      ).toEqual(fixture.draft);
    } finally {
      await freshPool.end();
    }
  });

  it('DB-4: atomically records user approval, manifest, and replay convergence', async () => {
    const fixture = await makeFixture(pool!);
    const repository = new PostgresChangeSetReviewV2Repository(pool!);
    await repository.saveDraft(fixture.draft);
    const approval = makeApproval(fixture.draft);
    const write = {
      projectId: fixture.projectId,
      changeSetId: fixture.draft.changeSetId,
      expectedRevisionNumber: fixture.draft.revisionNumber,
      expectedContentDigest: fixture.draft.contentDigest,
      ...approval,
    };
    const first = await repository.recordDecision(write);
    expect(first.draft.status).toBe('APPROVED');
    expect(first.manifest?.manifestDigest).toBe(approval.manifest.manifestDigest);
    const second = await repository.recordDecision(write);
    expect(second).toEqual(first);
    const counts = await pool!.query<{ decisions: string; manifests: string }>(
      `SELECT
         (SELECT count(*)::text FROM review.decisions_v2 WHERE project_id = $1) AS decisions,
         (SELECT count(*)::text FROM review.approved_manifests_v2 WHERE project_id = $1) AS manifests`,
      [fixture.projectId],
    );
    expect(counts.rows[0]).toEqual({ decisions: '1', manifests: '1' });
    await expect(
      repository.recordDecision({
        ...write,
        expectedContentDigest: sha256Text('stale-approval'),
        decision: { ...approval.decision, decisionId: 'decision-stale-after-approval' },
      }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    const unchanged = await repository.findDraftByComparisonId(
      fixture.projectId,
      fixture.comparisonId,
    );
    expect(unchanged?.status).toBe('APPROVED');
  });
});
