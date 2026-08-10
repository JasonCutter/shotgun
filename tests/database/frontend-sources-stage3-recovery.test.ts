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

/**
 * FE-P5-XP Correction Round 2 regression — Stage 3 failure recovery.
 *
 * GPT CHANGES_REQUIRED invariant:
 *   SourceVersion durable + Stage3 실패 → 최종 성공으로 거짓 보고하지 않음 →
 *   재시도 가능 → 같은 SourceVersion으로 Transformation/Evidence 완료 →
 *   Source/SourceVersion 중복 생성 없음
 */
const databaseUrl = process.env.DATABASE_URL;
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
       'sources.intake.submit.v1', '1.0.0', $7, $8::jsonb, $9::jsonb,
       $10::jsonb, $11::jsonb, '[]'::jsonb, $12::jsonb, 'ACCEPTED',
       NULL, '[]'::jsonb, NULL, $13, $14, $15, $15, NULL, $15
     )`,
    [
      commandId,
      `client-${commandId}`,
      `idempotency-${commandId}`,
      principalId,
      projectId,
      JSON.stringify({ envelopeVersion: '2.0.0', scope: 'PROJECT', projectId }),
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
  return { principalId, sessionId, projectId, commandId, now };
};

const submitInput = async (
  context: Awaited<ReturnType<typeof seedContext>>,
  submissionId: string,
  text: string,
): Promise<SubmitSourcesProductInput> => {
  const staging = new SealedSourcesStagingService(
    assetStorage,
    'sources-recovery-staging-secret-32-characters',
  );
  const itemId = `item-${randomUUID()}`;
  const bytes = Buffer.from(text, 'utf8');
  const receipt = await staging.stageBytes({
    draftId: 'draft-1',
    itemId,
    projectId: context.projectId,
    principalId: context.principalId,
    kind: 'DIRECT_TEXT',
    label: 'Recovery source',
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
  const scope: SourcesProductWriteScope = {
    principalId: context.principalId,
    sessionId: context.sessionId,
    projectId: context.projectId,
    accessScopes: ['owner'],
    sensitivity: 'private',
    accessRevision: `${context.projectId}:owner`,
    policyContextRevision: '1',
    acceptedPolicyContextId: `policy/${context.projectId}`,
    acceptedPolicyBinding: { mode: 'CURRENT' },
  };
  return {
    submissionId,
    commandId: context.commandId,
    correlationId: `correlation-${context.commandId}`,
    draftId: 'draft-1',
    scope,
    items: [artifact],
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
    await expect(service.submit(await submitInput(context, submissionId, text))).rejects.toThrow(
      'Stage 3 transient failure',
    );
    const afterFailure = (await service.getSubmission(
      {
        principalId: context.principalId,
        sessionId: context.sessionId,
        projectId: context.projectId,
        accessScopes: ['owner'],
        sensitivity: 'private',
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
    const retried = await service.submit(await submitInput(context, submissionId, text));
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
