import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';

import { PostgresChangeSetReviewV2Repository } from '../../adapters/postgres-stage5/src/index.js';
import { PostgresConnectorRuntimeState } from '../../adapters/connector-runtime-postgres/src/index.js';
import { ConnectorRuntime } from '../../packages/connector-runtime/src/index.js';
import type { ConnectorSemanticIdentity } from '../../packages/connector-runtime/src/ports.js';
import { ModuleRegistry } from '../../packages/module-sdk/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
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
  shortlistAuditDigestV2,
  stableJson,
  validateDraftChangeSetV2,
  type ApprovedChangeSetApprovalTokenV2,
  type ApprovedChangeSetManifestV2,
  type ComparisonResultV2,
  type DraftChangeSetV2,
} from '../../packages/contracts/src/index.js';
import {
  reviewOperationResolutionDigestV2,
  reviewOperationResolvedDraftMaterialDigestV2,
  type OperationResolutionV2,
} from '../../modules/change-set-review/src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL?.trim()
  ? await requireTestDatabaseTarget()
  : undefined;
const pool: Pool | undefined = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

type Fixture = {
  readonly projectId: string;
  readonly comparisonId: string;
  readonly draft: DraftChangeSetV2;
};

const makeResolutionDrafts = (
  fixture: Fixture,
): {
  readonly source: DraftChangeSetV2;
  readonly resolved: DraftChangeSetV2;
} => {
  const shortlist = {
    contractVersion: '2.0' as const,
    canonicalSnapshot: {
      id: fixture.draft.canonicalSnapshot.id,
      version: fixture.draft.canonicalSnapshot.version,
      digest: fixture.draft.canonicalSnapshot.digest,
    },
    lexicalProjectionWatermark: sha256Text(`${fixture.projectId}:watermark`),
    lexicalProjectionBase: sha256Text(`${fixture.projectId}:lexical-base`),
    semanticGenerationId: `${fixture.projectId}:generation`,
    semanticSourceProjectionDigest: sha256Text(`${fixture.projectId}:source-projection`),
    semanticCanonicalBaseVersion: fixture.draft.canonicalSnapshot.version,
    querySemanticReadiness: 'READY' as const,
    policyRevision: sha256Text(`${fixture.projectId}:shortlist-policy`),
    k: 1,
    selectedTargetIdentities: [],
    exclusionCounts: {},
    truncated: false,
    coverageStatus: 'COMPLETE' as const,
  };
  const shortlistDigest = shortlistAuditDigestV2(shortlist);
  const freshnessIdentity = {
    mode: 'SEMANTIC' as const,
    candidateId: fixture.draft.candidate.id,
    candidateRevision: fixture.draft.candidate.revision,
    candidateSourceVersionId: fixture.draft.candidate.sourceVersionId,
    candidateDigest: fixture.draft.candidate.digest,
    candidateEvidenceDigest: sha256Text(stableJson({ evidenceIds: fixture.draft.evidenceIds })),
    canonicalSnapshotId: fixture.draft.canonicalSnapshot.id,
    canonicalSnapshotDigest: fixture.draft.canonicalSnapshot.digest,
    canonicalSnapshotVersion: fixture.draft.canonicalSnapshot.version,
    shortlistDigest,
    shortlistPolicyRevision: shortlist.policyRevision,
    semanticGenerationId: shortlist.semanticGenerationId,
    semanticSourceProjectionDigest: shortlist.semanticSourceProjectionDigest,
    semanticCanonicalBaseVersion: shortlist.semanticCanonicalBaseVersion,
    providerModelCapabilityIdentity: 'provider:model:capability',
    promptTemplateRevision: 'prompt:database-test',
    outputSchemaRevision: 'schema:database-test',
    semanticPolicyRevision: 'policy:database-test',
    rolloutAuthorityRevision: 'rollout:database-test',
  };
  const makeDraft = (
    revisionNumber: number,
    operation: DraftChangeSetV2['operation'],
    reviewRecommendation: DraftChangeSetV2['reviewRecommendation'],
    updatedAt: string,
  ): DraftChangeSetV2 => {
    const withoutDigest: Omit<DraftChangeSetV2, 'contentDigest'> = {
      ...fixture.draft,
      changeSetId: `${fixture.draft.changeSetId}:resolution`,
      revisionNumber,
      comparisonId: fixture.comparisonId,
      analysisRevisionIds: ['analysis-db-resolution'],
      disposition: operation === 'MODIFY_REVIEW' ? 'REVIEW_REQUIRED' : 'NEW',
      relationshipIds: ['relationship-db-resolution'],
      operation,
      reviewRecommendation,
      shortlistDigest,
      freshnessIdentity,
      freshnessDigest: comparisonFreshnessDigestV2(freshnessIdentity),
      status: 'PENDING_REVIEW',
      createdAt: fixture.draft.createdAt,
      updatedAt,
    };
    const draft = {
      ...withoutDigest,
      contentDigest: draftChangeSetContentDigestV2(withoutDigest),
    };
    validateDraftChangeSetV2(draft);
    return draft;
  };
  return {
    source: makeDraft(1, 'MODIFY_REVIEW', 'MODIFY_REVIEW', '2026-09-05T12:00:00.000Z'),
    resolved: makeDraft(2, 'ADD_CLAIM', 'MODIFY_REVIEW', '2026-09-05T12:00:01.000Z'),
  };
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

  it('ADR-163/R19: reconciles an unknown connector outcome from one immutable resolution', async () => {
    const fixture = await makeFixture(pool!);
    const repository = new PostgresChangeSetReviewV2Repository(pool!);
    const { source, resolved } = makeResolutionDrafts(fixture);
    const clientRequestId = `r19-client:${fixture.projectId}`;
    const idempotencyKey = `r19-idempotency:${fixture.projectId}`;
    const semanticCommandIdentity = `connector:${idempotencyKey}`;
    const unsignedResolution: Omit<OperationResolutionV2, 'resolutionDigest'> = {
      resolutionId: `resolution:${fixture.projectId}`,
      contractVersion: 'review-operation-resolution.v1',
      projectId: fixture.projectId,
      changeSetId: source.changeSetId,
      sourceDraftRevision: source.revisionNumber,
      sourceDraftDigest: source.contentDigest,
      resolvedDraftRevision: resolved.revisionNumber,
      resolvedDraftDigest: resolved.contentDigest,
      resolvedDraftMaterialDigest: reviewOperationResolvedDraftMaterialDigestV2(resolved),
      comparisonId: source.comparisonId,
      comparisonDigest: source.comparisonDigest,
      candidateId: source.candidate.id,
      candidateRevision: source.candidate.revision,
      candidateDigest: source.candidate.digest,
      candidateSourceVersionId: source.candidate.sourceVersionId,
      candidateEvidenceIds: [...source.candidate.evidenceIds],
      canonicalSnapshotId: source.canonicalSnapshot.id,
      canonicalVersion: source.canonicalSnapshot.version,
      canonicalDigest: source.canonicalSnapshot.digest,
      shortlistDigest: source.shortlistDigest,
      analysisRevisionIds: [...source.analysisRevisionIds],
      relationshipIds: [...source.relationshipIds],
      accessRevision: 'access:database-test',
      policyContextRevision: 'policy:database-test',
      resolverActorId: 'database-test',
      clientRequestId,
      semanticCommandIdentity,
      idempotencyKey,
      commandDigest: sha256Text(`command:${fixture.projectId}`),
      chosenOperation: 'ADD_CLAIM',
      state: 'RESOLVED',
      createdAt: '2026-09-05T12:00:01.000Z',
    };
    const resolution: OperationResolutionV2 = {
      ...unsignedResolution,
      resolutionDigest: reviewOperationResolutionDigestV2(unsignedResolution),
    };

    const identity: ConnectorSemanticIdentity = {
      projectId: fixture.projectId,
      securityScope: JSON.stringify({
        accessScope: ['owner'],
        sensitivity: 'public',
        dataClassification: 'adr163-r19-db-test',
      }),
      consumerId: 'review.operation-resolution:command:ResolveReviewOperationV2',
      messageKind: 'command',
      messageType: 'ResolveReviewOperationV2',
      semanticKey: idempotencyKey,
      fingerprint: sha256Text(`fingerprint:${fixture.projectId}`),
    };
    const jobId = randomUUID();
    const state = new PostgresConnectorRuntimeState(pool!);
    const connector = new ConnectorRuntime(new ModuleRegistry(), new InProcessTransport(), {
      state,
    });

    try {
      await repository.saveDraft(source);
      const stored = await repository.resolveOperation({
        currentDraft: source,
        resolvedDraft: resolved,
        resolution,
      });
      expect(stored.status).toBe('RESOLVED');

      await state.lifecycle.start();
      const began = await state.dedup.begin({ ...identity, jobId });
      expect(began.kind).toBe('ACQUIRED');
      if (began.kind !== 'ACQUIRED' || !began.record.jobId) return;
      await state.dedup.markOutcomeUnknown({
        identity,
        fenceToken: began.record.fenceToken,
        jobId: began.record.jobId,
        safeErrorMessage: 'acknowledgement was lost after the Review resolution committed',
      });

      const observed = await repository.findOperationResolutionByClientRequest(
        fixture.projectId,
        clientRequestId,
        semanticCommandIdentity,
      );
      expect(observed?.resolutionId).toBe(resolution.resolutionId);
      await connector.reconcileOutcome({
        identity,
        result: {
          resolutionId: observed!.resolutionId,
          chosenOperation: observed!.chosenOperation,
        },
      });

      const duplicate = await state.dedup.begin({ ...identity, jobId: randomUUID() });
      expect(duplicate).toMatchObject({ kind: 'DUPLICATE', record: { state: 'COMPLETED' } });
      const counts = await pool!.query<{ resolutions: string; revisions: string }>(
        `SELECT
           (SELECT count(*)::text FROM review.operation_resolutions_v2 WHERE project_id = $1) AS resolutions,
           (SELECT count(*)::text FROM review.change_set_revisions_v2 WHERE project_id = $1) AS revisions`,
        [fixture.projectId],
      );
      expect(counts.rows[0]).toEqual({ resolutions: '1', revisions: '2' });
    } finally {
      await state.lifecycle.stop();
      await pool!.query(
        `DELETE FROM connector.jobs
          WHERE dedup_record_id IN (
            SELECT dedup_record_id FROM connector.dedup_records WHERE project_id = $1
          )`,
        [fixture.projectId],
      );
      await pool!.query('DELETE FROM connector.dedup_records WHERE project_id = $1', [
        fixture.projectId,
      ]);
      await pool!.query('DELETE FROM review.operation_resolutions_v2 WHERE project_id = $1', [
        fixture.projectId,
      ]);
      await pool!.query('DELETE FROM review.change_set_revisions_v2 WHERE project_id = $1', [
        fixture.projectId,
      ]);
      await pool!.query('DELETE FROM review.change_sets_v2 WHERE project_id = $1', [
        fixture.projectId,
      ]);
      await pool!.query('DELETE FROM comparison.results_v2 WHERE project_id = $1', [
        fixture.projectId,
      ]);
      await pool!.query('DELETE FROM candidate.claim_candidates WHERE project_id = $1', [
        fixture.projectId,
      ]);
      await pool!.query('DELETE FROM candidate.batches WHERE project_id = $1', [fixture.projectId]);
      await pool!.query('DELETE FROM evidence.spans WHERE project_id = $1', [fixture.projectId]);
      await pool!.query('DELETE FROM transformation.revisions WHERE project_id = $1', [
        fixture.projectId,
      ]);
    }
  });
});
