import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';
import { PostgresSourcesProductService } from '../../adapters/frontend-sources-write-postgres/src/product-service.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import { PythonDocumentFormatAdapter } from '../../adapters/document-format-python/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import { SourcesStage3Pipeline } from '../../adapters/sources-stage3-pipeline/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import type { SourcesStage3PipelinePort } from '../../modules/frontend-sources-write/src/index.js';
import type {
  SubmitSourcesProductInput,
  SourcesProductWriteScope,
} from '../../modules/frontend-sources-write/src/product-service.js';
import type { ResolvedSourcesStagingArtifact } from '../../modules/frontend-sources-write/src/index.js';

/**
 * FE-P5-XP Correction Round 2 regression — Stage 3 failure recovery.
 *
 * GPT CHANGES_REQUIRED invariant:
 *   SourceVersion durable + Stage3 실패 → 최종 성공으로 거짓 보고하지 않음 →
 *   재시도 가능 → 같은 SourceVersion으로 Transformation/Evidence 완료 →
 *   Source/SourceVersion 중복 생성 없음
 */
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const hash = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

/** Delegates to the real pipeline but throws once (a transient Stage 3 fault). */
class FailOnceStage3Pipeline implements SourcesStage3PipelinePort {
  private calls = 0;
  constructor(private readonly inner: SourcesStage3PipelinePort) {}
  async runForSourceVersion(
    input: Parameters<SourcesStage3PipelinePort['runForSourceVersion']>[0],
  ): Promise<void> {
    this.calls += 1;
    if (this.calls === 1) throw new Error('Stage 3 transient failure');
    await this.inner.runForSourceVersion(input);
  }
}

const stage3 = () =>
  new SourcesStage3Pipeline({
    storage: assetStorage,
    transformer: new PythonDocumentFormatAdapter(),
    locator: new LucasAugmentedPlainTextAdapter(),
    transformationRepository: new PostgresTransformationRepository(pool!),
    evidenceRepository: new PostgresEvidenceRepository(pool!),
  });

let assetStorage = new InMemoryAssetStorage();

const seedCommand = async (
  principalId: string,
  projectId: string,
  commandId: string,
  commandType = 'sources.intake.submit.v1',
  now = new Date().toISOString(),
): Promise<void> => {
  await pool!.query(
    `INSERT INTO frontend_command.command_ledger (
       command_id, command_revision, client_request_id, idempotency_key,
       principal_id, envelope_version, scope_kind, active_project_id,
       target_project_id, resource_project_id, scope_binding_key,
       command_type, command_schema_version, command_semantic_digest,
       policy_binding, accepted_principal_context, accepted_project_context,
       accepted_policy_context, preconditions, command_payload, outcome_state,
       completion_disposition, produced_resources, rejection, correlation_id,
       trace_id, received_at, accepted_at, completed_at, last_updated_at
     ) VALUES (
       $1, 1, $2, $3, $4, '2.0.0', 'PROJECT', $5, $5, NULL, $6,
       $7, '1.0.0', $8, $9::jsonb, $10::jsonb,
       $11::jsonb, $12::jsonb, '[]'::jsonb, $13::jsonb, 'ACCEPTED',
       NULL, '[]'::jsonb, NULL, $14, $15, $16, $16, NULL, $16
     )`,
    [
      commandId,
      `client-${commandId}`,
      `idempotency-${commandId}`,
      principalId,
      projectId,
      JSON.stringify({ envelopeVersion: '2.0.0', scope: 'PROJECT', projectId }),
      commandType,
      hash(`command-${commandId}`),
      JSON.stringify({ mode: 'CURRENT' }),
      JSON.stringify({ principalId }),
      JSON.stringify({ activeProjectId: projectId, targetProjectId: projectId }),
      JSON.stringify({ policyContextId: `policy/${projectId}`, policyContextRevision: '1' }),
      JSON.stringify({ draftId: 'draft-1' }),
      `correlation-${commandId}`,
      `trace-${commandId}`,
      now,
    ],
  );
};

const seedContext = async () => {
  const principalId = randomUUID();
  const sessionId = randomUUID();
  const projectId = `sources-recovery-${randomUUID()}`;
  const commandId = randomUUID();
  const now = new Date().toISOString();

  await pool!.query(
    `INSERT INTO auth.principals (
       principal_id, actor_type, status, account_id, created_at
     ) VALUES ($1, 'user', 'active', $2, $3)`,
    [principalId, `sources-recovery-owner-${principalId}`, now],
  );
  await pool!.query(
    `INSERT INTO project_admin.projects (
       id, name, status, active, created_at, updated_at, revision
     ) VALUES ($1, $2, 'ACTIVE', true, $3, $3, 1)`,
    [projectId, 'Sources Recovery Test Project', now],
  );
  await pool!.query(
    `INSERT INTO auth.project_memberships (
       principal_id, project_id, scopes, sensitivity_clearance, is_owner
     ) VALUES ($1, $2, '{owner}', 'private', true)`,
    [principalId, projectId],
  );
  await pool!.query(
    `INSERT INTO auth.sessions (
       session_id, token_hash, csrf_hash, principal_id, active_project_id,
       expires_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId,
      hash(`session-${sessionId}`),
      hash(`csrf-${sessionId}`),
      principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
      now,
    ],
  );
  await seedCommand(principalId, projectId, commandId, 'sources.intake.submit.v1', now);
  return { principalId, sessionId, projectId, commandId, now };
};

const submitInput = async (
  context: Awaited<ReturnType<typeof seedContext>>,
  submissionId: string,
  texts: readonly string[],
  commandId: string,
): Promise<SubmitSourcesProductInput> => {
  const staging = new SealedSourcesStagingService(
    assetStorage,
    'sources-recovery-staging-secret-32-characters',
  );
  const items: ResolvedSourcesStagingArtifact[] = [];
  for (const [index, text] of texts.entries()) {
    const itemId = `item-${randomUUID()}`;
    const bytes = Buffer.from(text, 'utf8');
    const receipt = await staging.stageBytes({
      draftId: 'draft-1',
      itemId,
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'DIRECT_TEXT',
      label: `Recovery source ${index}`,
      mediaType: 'text/plain',
      bytes,
    });
    const artifact = await staging.resolve({
      stagingReference: receipt.stagingReference,
      draftId: 'draft-1',
      itemId,
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'DIRECT_TEXT',
    });
    items.push({ ...artifact, requestedClassification: 'public' });
  }
  const scope: SourcesProductWriteScope = {
    principalId: context.principalId,
    sessionId: context.sessionId,
    projectId: context.projectId,
    principalAccessScopes: ['owner'],
    sensitivityClearance: 'private',
    resourceSecurityPolicy: {
      allowedClassifications: ['public', 'internal', 'private'],
      resourceAccessScope: ['owner'],
    },
    accessRevision: `${context.projectId}:owner`,
    policyContextRevision: '1',
    acceptedPolicyContextId: `policy/${context.projectId}`,
    acceptedPolicyBinding: { mode: 'CURRENT' },
  };
  return {
    submissionId,
    commandId,
    correlationId: `correlation-${commandId}`,
    draftId: 'draft-1',
    scope,
    items,
    createdAt: context.now,
  };
};

afterAll(async () => {
  await pool?.end();
});

describe.runIf(pool)('FE-P5-XP Sources Stage 3 failure recovery', () => {
  beforeEach(async () => {
    assetStorage = new InMemoryAssetStorage();
    await pool!.query(`
      TRUNCATE
        source_product.url_provenance_receipts,
        source_product.url_acquisition_attempts,
        source_product.exact_duplicate_dispositions,
        source_product.exact_duplicate_decisions,
        source_product.intake_attempts,
        source_product.intake_submission_items,
        source_product.intake_submissions,
        asset.storage_receipts,
        asset.source_versions,
        asset.sources,
        asset.original_assets,
        intake.submissions,
        frontend_command.command_ledger,
        project_admin.project_revisions,
        project_admin.projects,
        auth.audit_events,
        auth.sessions,
        auth.project_memberships,
        auth.credentials,
        auth.principals
      CASCADE
    `);
  });

  it('Stage3 first attempt throws → retry → same SourceId/SourceVersionId → Stage3 completes → Evidence exists → no duplicate SourceVersion', async () => {
    const context = await seedContext();
    const submissionId = randomUUID();
    const text = 'Shotgun Sources recovery: the founding evidence lineage claim.';
    const service = new PostgresSourcesProductService(
      pool!,
      new SealedSourcesStagingService(
        assetStorage,
        'sources-recovery-staging-secret-32-characters',
      ),
      new FailOnceStage3Pipeline(stage3()),
    );

    // First attempt: Stage 3 throws. The SourceVersion IS durable but the
    // submission must NOT be reported SUCCEEDED.
    await expect(
      service.submit(await submitInput(context, submissionId, [text], context.commandId)),
    ).rejects.toThrow('Stage 3 transient failure');
    const afterFailure = (await service.getSubmission(
      {
        principalId: context.principalId,
        sessionId: context.sessionId,
        projectId: context.projectId,
        principalAccessScopes: ['owner'],
        sensitivityClearance: 'private',
        resourceSecurityPolicy: {
          allowedClassifications: ['public', 'internal', 'private'],
          resourceAccessScope: ['owner'],
        },
        accessRevision: `${context.projectId}:owner`,
        policyContextRevision: '1',
        acceptedPolicyContextId: `policy/${context.projectId}`,
        acceptedPolicyBinding: { mode: 'CURRENT' },
      },
      submissionId,
    ))!;
    expect(afterFailure.state, 'no false final SUCCESS without Evidence').toBe(
      'OUTCOME_INDETERMINATE',
    );
    const materialized = afterFailure.items.find((item) => item.producedResource?.sourceVersionId);
    expect(materialized?.producedResource?.sourceId).toBeTruthy();
    const firstSourceId = materialized!.producedResource!.sourceId;
    const firstSourceVersionId = materialized!.producedResource!.sourceVersionId;

    // Retry (same command replay): Stage 3 completes with the SAME
    // SourceId/SourceVersionId (no duplicate), then the submission SUCCEEDS.
    const retried = await service.submit(
      await submitInput(context, submissionId, [text], context.commandId),
    );
    expect(retried.state).toBe('SUCCEEDED');
    const retriedItem = retried.items.find((item) => item.producedResource?.sourceVersionId);
    expect(retriedItem?.producedResource?.sourceId).toBe(firstSourceId);
    expect(retriedItem?.producedResource?.sourceVersionId).toBe(firstSourceVersionId);

    // No duplicate SourceVersion was created.
    const versions = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM asset.source_versions
       WHERE source_id = $1 AND source_version_id = $2`,
      [firstSourceId, firstSourceVersionId],
    );
    expect(versions.rows[0]?.count).toBe('1');

    // The public SourceVersion pin reaches real Stage 3 Transformation and Evidence rows.
    const evidence = await pool!.query<{
      count: string;
      source_sensitivity: string;
      transformation_sensitivity: string;
      source_access_scope: string[];
      transformation_access_scope: string[];
    }>(
      `SELECT count(evidence.evidence_id)::text AS count,
              source.sensitivity AS source_sensitivity,
              transformation.sensitivity AS transformation_sensitivity,
              source.access_scope AS source_access_scope,
              transformation.access_scope AS transformation_access_scope
       FROM asset.source_versions AS source
       JOIN transformation.revisions AS transformation
         ON transformation.source_version_id = source.source_version_id
       LEFT JOIN evidence.spans AS evidence
         ON evidence.revision_id = transformation.revision_id
       WHERE source.project_id = $1 AND source.source_version_id = $2
       GROUP BY source.sensitivity, transformation.sensitivity, source.access_scope, transformation.access_scope`,
      [context.projectId, firstSourceVersionId],
    );
    expect(Number(evidence.rows[0]?.count ?? 0)).toBeGreaterThan(0);
    expect(evidence.rows[0]).toMatchObject({
      source_sensitivity: 'public',
      transformation_sensitivity: 'public',
      source_access_scope: ['owner'],
      transformation_access_scope: ['owner'],
    });
    expect(
      await pool!.query(
        `SELECT sensitivity, access_scope FROM evidence.spans
         WHERE project_id = $1 AND source_version_id = $2`,
        [context.projectId, firstSourceVersionId],
      ),
    ).toMatchObject({ rows: [{ sensitivity: 'public', access_scope: ['owner'] }] });
  });

  it('mixed submission (1 duplicate/action-required + 1 new item) Stage3 fail once → retryable → retry → same SourceVersion → Evidence exists → no duplicate → final PARTIAL', async () => {
    const context = await seedContext();
    const firstCommandId = randomUUID();
    await seedCommand(
      context.principalId,
      context.projectId,
      firstCommandId,
      'sources.intake.submit.v1',
      context.now,
    );
    const duplicateText = 'Shotgun Sources mixed recovery: duplicate-content anchor claim.';
    const newText = 'Shotgun Sources mixed recovery: freshly materialized claim body.';

    // 1) A working (real) pipeline first creates the anchor Source that the
    //    duplicate item of the mixed submission will collide with.
    const workingService = new PostgresSourcesProductService(
      pool!,
      new SealedSourcesStagingService(
        assetStorage,
        'sources-recovery-staging-secret-32-characters',
      ),
      stage3(),
    );
    const anchorSubmissionId = randomUUID();
    const anchor = await workingService.submit(
      await submitInput(context, anchorSubmissionId, [duplicateText], firstCommandId),
    );
    expect(anchor.state).toBe('SUCCEEDED');

    // 2) Mixed submission: same content (duplicate → action-required) + a new
    //    item (materialized). A fresh fail-once pipeline fails Stage 3 once.
    const mixedCommandId = randomUUID();
    await seedCommand(
      context.principalId,
      context.projectId,
      mixedCommandId,
      'sources.intake.submit.v1',
      context.now,
    );
    const submissionId = randomUUID();
    const mixedService = new PostgresSourcesProductService(
      pool!,
      new SealedSourcesStagingService(
        assetStorage,
        'sources-recovery-staging-secret-32-characters',
      ),
      new FailOnceStage3Pipeline(stage3()),
    );
    await expect(
      mixedService.submit(
        await submitInput(context, submissionId, [duplicateText, newText], mixedCommandId),
      ),
    ).rejects.toThrow('Stage 3 transient failure');

    // 3) The mixed submission was PARTIAL before the failure; after the Stage 3
    //    failure it must be retryable (OUTCOME_INDETERMINATE), never a false
    //    SUCCESS and never a stuck PARTIAL without Evidence.
    const afterFailure = (await mixedService.getSubmission(
      {
        principalId: context.principalId,
        sessionId: context.sessionId,
        projectId: context.projectId,
        principalAccessScopes: ['owner'],
        sensitivityClearance: 'private',
        resourceSecurityPolicy: {
          allowedClassifications: ['public', 'internal', 'private'],
          resourceAccessScope: ['owner'],
        },
        accessRevision: `${context.projectId}:owner`,
        policyContextRevision: '1',
        acceptedPolicyContextId: `policy/${context.projectId}`,
        acceptedPolicyBinding: { mode: 'CURRENT' },
      },
      submissionId,
    ))!;
    expect(afterFailure.state, 'mixed PARTIAL must be retryable, not stuck').toBe(
      'OUTCOME_INDETERMINATE',
    );
    const materialized = afterFailure.items.find((item) => item.producedResource?.sourceVersionId);
    expect(materialized?.producedResource?.sourceId).toBeTruthy();
    const firstSourceId = materialized!.producedResource!.sourceId;
    const firstSourceVersionId = materialized!.producedResource!.sourceVersionId;
    const actionRequired = afterFailure.items.find((item) => item.duplicateDecisionId);
    expect(actionRequired?.duplicateDecisionId, 'duplicate item is action-required').toBeTruthy();

    // 4) Retry: the SAME SourceVersion resumes Stage 3, Evidence is created,
    //    and the final state is PARTIAL (the duplicate item is still
    //    action-required) — not a false SUCCEEDED.
    const retried = await mixedService.submit(
      await submitInput(context, submissionId, [duplicateText, newText], mixedCommandId),
    );
    expect(retried.state, 'mixed outcome finalizes PARTIAL').toBe('PARTIAL');
    const retriedItem = retried.items.find((item) => item.producedResource?.sourceVersionId);
    expect(retriedItem?.producedResource?.sourceId).toBe(firstSourceId);
    expect(retriedItem?.producedResource?.sourceVersionId).toBe(firstSourceVersionId);

    // No duplicate SourceVersion was created.
    const versions = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM asset.source_versions
       WHERE source_id = $1 AND source_version_id = $2`,
      [firstSourceId, firstSourceVersionId],
    );
    expect(versions.rows[0]?.count).toBe('1');

    // Evidence exists for the same SourceVersion (real Stage 3 pipeline).
    const evidence = await pool!.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM evidence.spans
       WHERE project_id = $1 AND source_version_id = $2`,
      [context.projectId, firstSourceVersionId],
    );
    expect(Number(evidence.rows[0]?.count ?? 0)).toBeGreaterThan(0);
  });
});
