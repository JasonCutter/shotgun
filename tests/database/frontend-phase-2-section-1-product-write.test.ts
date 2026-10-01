import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';
import { PostgresSourcesProductService } from '../../adapters/frontend-sources-write-postgres/src/product-service.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import type { SourcesStage3PipelinePort } from '../../modules/frontend-sources-write/src/index.js';
import type { SourcesProductWriteScope } from '../../modules/frontend-sources-write/src/product-service.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';
import { recreateTestDatabaseSchemas } from '../helpers/recreate-test-database.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const hash = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

class RecordingStage3Pipeline implements SourcesStage3PipelinePort {
  readonly calls: Array<Parameters<SourcesStage3PipelinePort['runForSourceVersion']>[0]> = [];

  async runForSourceVersion(
    input: Parameters<SourcesStage3PipelinePort['runForSourceVersion']>[0],
  ): Promise<Awaited<ReturnType<SourcesStage3PipelinePort['runForSourceVersion']>>> {
    this.calls.push(input);
    return {
      stage3: { revisionId: `revision-${input.sourceVersionId}`, evidenceCount: 0, reusedCount: 0 },
      stage4: { status: 'NOT_CONFIGURED' },
    };
  }
}

const insertAcceptedCommand = async (input: {
  readonly commandId: string;
  readonly commandType: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly payload: unknown;
  readonly now: string;
}) => {
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
       $7, '1.0.0', $8, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
       '[]'::jsonb, $13::jsonb, 'ACCEPTED', NULL, '[]'::jsonb, NULL,
       $14, $15, $16, $16, NULL, $16
     )`,
    [
      input.commandId,
      `client-${input.commandId}`,
      `idempotency-${input.commandId}`,
      input.principalId,
      input.projectId,
      JSON.stringify({ envelopeVersion: '2.0.0', scope: 'PROJECT', projectId: input.projectId }),
      input.commandType,
      hash(`command-${input.commandId}`),
      JSON.stringify({ mode: 'CURRENT' }),
      JSON.stringify({ principalId: input.principalId }),
      JSON.stringify({ activeProjectId: input.projectId, targetProjectId: input.projectId }),
      JSON.stringify({
        policyContextId: `project-policy-context/${input.projectId}`,
        policyContextRevision: '1',
      }),
      JSON.stringify(input.payload),
      `correlation-${input.commandId}`,
      `trace-${input.commandId}`,
      input.now,
    ],
  );
};

const createContext = async () => {
  const principalId = randomUUID();
  const sessionId = randomUUID();
  const projectId = `product-write-${randomUUID()}`;
  const now = new Date().toISOString();
  await pool!.query(
    `INSERT INTO auth.principals (
       principal_id, actor_type, status, account_id, created_at
     ) VALUES ($1, 'user', 'active', $2, $3)`,
    [principalId, `owner-${principalId}`, now],
  );
  await pool!.query(
    `INSERT INTO project_admin.projects (
       id, name, status, active, created_at, updated_at, revision
     ) VALUES ($1, 'Product Write Project', 'ACTIVE', true, $2, $2, 1)`,
    [projectId, now],
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
  const scope: SourcesProductWriteScope = {
    principalId,
    sessionId,
    projectId,
    principalAccessScopes: ['owner'],
    sensitivityClearance: 'private',
    resourceSecurityPolicy: {
      allowedClassifications: ['public', 'internal', 'private'],
      resourceAccessScope: ['owner'],
    },
    accessRevision: `${projectId}:owner`,
    policyContextRevision: '1',
    acceptedPolicyContextId: `project-policy-context/${projectId}`,
    acceptedPolicyBinding: { mode: 'CURRENT', policyContextRevision: '1' },
  };
  return { principalId, sessionId, projectId, now, scope };
};

afterAll(async () => {
  await pool?.end();
});

describe.runIf(pool)('Frontend Phase 2 Section 1 Product write', () => {
  beforeEach(async () => {
    await recreateTestDatabaseSchemas(databaseUrl);
  });

  it.each([
    ['golden.pdf', 'application/pdf'],
    ['golden.html', 'text/html'],
    ['golden.csv', 'text/csv'],
    ['golden.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['golden.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['golden.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ] as const)(
    'stores an automatic %s submission as a document SourceVersion for Stage 3',
    async (fileName, mediaType) => {
      const context = await createContext();
      const storage = new InMemoryAssetStorage();
      const staging = new SealedSourcesStagingService(
        storage,
        'database-product-write-staging-secret-32-characters',
      );
      const stage3 = new RecordingStage3Pipeline();
      const service = new PostgresSourcesProductService(pool!, staging, stage3);
      const commandId = randomUUID();
      await insertAcceptedCommand({
        commandId,
        commandType: 'sources.intake.submit.v1',
        principalId: context.principalId,
        projectId: context.projectId,
        payload: { draftId: 'pdf-draft', inputs: [{ kind: 'FILE', stagingReference: 'sealed' }] },
        now: context.now,
      });
      const receipt = await staging.stageBytes({
        draftId: 'pdf-draft',
        itemId: 'pdf-item',
        projectId: context.projectId,
        principalId: context.principalId,
        kind: 'FILE',
        label: 'Golden document',
        mediaType,
        fileName,
        bytes: await readFile(path.resolve('tests/fixtures/stage-8', fileName)),
      });
      const artifact = await staging.resolve({
        stagingReference: receipt.stagingReference,
        draftId: 'pdf-draft',
        itemId: 'pdf-item',
        projectId: context.projectId,
        principalId: context.principalId,
        kind: 'FILE',
      });
      const result = await service.submit({
        submissionId: commandId,
        commandId,
        correlationId: `correlation-${commandId}`,
        draftId: 'pdf-draft',
        scope: context.scope,
        items: [{ ...artifact, requestedClassification: 'public' }],
        duplicateHandling: 'AUTOMATIC',
        createdAt: context.now,
      });
      expect(result.state).toBe('SUCCEEDED');
      expect(stage3.calls).toHaveLength(1);
      expect(stage3.calls[0]?.mediaType).toBe(mediaType);
      const submission = await pool!.query<{ material_kind: string; media_type: string }>(
        'SELECT material_kind, media_type FROM intake.submissions WHERE project_id = $1 AND content_hash = $2',
        [context.projectId, receipt.contentHash],
      );
      expect(submission.rows[0]).toEqual({
        material_kind: 'document',
        media_type: mediaType,
      });
      const receiptRows = await pool!.query<{ material_kind: string }>(
        `SELECT receipt.material_kind FROM asset.storage_receipts AS receipt
       JOIN intake.submissions AS submission ON submission.submission_id = receipt.submission_id
       WHERE submission.project_id = $1 AND submission.content_hash = $2`,
        [context.projectId, receipt.contentHash],
      );
      expect(receiptRows.rows[0]?.material_kind).toBe('document');
    },
  );

  it('persists a file larger than one MiB through product intake', async () => {
    const context = await createContext();
    const storage = new InMemoryAssetStorage();
    const staging = new SealedSourcesStagingService(
      storage,
      'database-product-write-staging-secret-32-characters',
    );
    const stage3 = new RecordingStage3Pipeline();
    const service = new PostgresSourcesProductService(pool!, staging, stage3);
    const commandId = randomUUID();
    const bytes = new Uint8Array(1_048_577).fill(0x61);
    await insertAcceptedCommand({
      commandId,
      commandType: 'sources.intake.submit.v1',
      principalId: context.principalId,
      projectId: context.projectId,
      payload: {
        draftId: 'large-file-draft',
        inputs: [{ kind: 'FILE', stagingReference: 'sealed' }],
      },
      now: context.now,
    });
    const receipt = await staging.stageBytes({
      draftId: 'large-file-draft',
      itemId: 'large-file-item',
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'FILE',
      label: 'Large text file',
      mediaType: 'text/plain',
      fileName: 'large.txt',
      bytes,
    });
    const artifact = await staging.resolve({
      stagingReference: receipt.stagingReference,
      draftId: 'large-file-draft',
      itemId: 'large-file-item',
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'FILE',
    });
    const result = await service.submit({
      submissionId: commandId,
      commandId,
      correlationId: `correlation-${commandId}`,
      draftId: 'large-file-draft',
      scope: context.scope,
      items: [{ ...artifact, requestedClassification: 'public' }],
      duplicateHandling: 'AUTOMATIC',
      createdAt: context.now,
    });
    expect(result.state).toBe('SUCCEEDED');
    const storedItem = await pool!.query<{ size_bytes: string }>(
      `SELECT size_bytes FROM source_product.intake_submission_items
       WHERE project_id = $1 AND submission_id = $2`,
      [context.projectId, commandId],
    );
    expect(Number(storedItem.rows[0]?.size_bytes)).toBe(bytes.byteLength);
    expect(stage3.calls).toHaveLength(1);
  });

  it('creates one Source, requires an exact-duplicate decision, and reuses the pinned Version', async () => {
    const context = await createContext();
    const storage = new InMemoryAssetStorage();
    const staging = new SealedSourcesStagingService(
      storage,
      'database-product-write-staging-secret-32-characters',
      undefined,
      () => new Date(context.now),
    );
    const stage3 = new RecordingStage3Pipeline();
    const service = new PostgresSourcesProductService(pool!, staging, stage3);
    const bytes = new TextEncoder().encode('same immutable source bytes');

    const submitOneCommandId = randomUUID();
    await insertAcceptedCommand({
      commandId: submitOneCommandId,
      commandType: 'sources.intake.submit.v1',
      principalId: context.principalId,
      projectId: context.projectId,
      payload: {
        draftId: 'draft-1',
        inputs: [{ kind: 'DIRECT_TEXT', stagingReference: 'sealed' }],
      },
      now: context.now,
    });
    const firstReceipt = await staging.stageBytes({
      draftId: 'draft-1',
      itemId: 'client-item-1',
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'DIRECT_TEXT',
      label: 'First Source',
      mediaType: 'text/plain',
      bytes,
    });
    const firstArtifact = await staging.resolve({
      stagingReference: firstReceipt.stagingReference,
      draftId: 'draft-1',
      itemId: 'client-item-1',
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'DIRECT_TEXT',
    });
    const first = await service.submit({
      submissionId: submitOneCommandId,
      commandId: submitOneCommandId,
      correlationId: `correlation-${submitOneCommandId}`,
      draftId: 'draft-1',
      scope: context.scope,
      items: [{ ...firstArtifact, requestedClassification: 'public' }],
      createdAt: context.now,
    });
    expect(first.state).toBe('SUCCEEDED');
    const produced = first.items[0]?.producedResource;
    expect(produced).toBeDefined();

    const submitTwoCommandId = randomUUID();
    await insertAcceptedCommand({
      commandId: submitTwoCommandId,
      commandType: 'sources.intake.submit.v1',
      principalId: context.principalId,
      projectId: context.projectId,
      payload: {
        draftId: 'draft-2',
        inputs: [{ kind: 'DIRECT_TEXT', stagingReference: 'sealed' }],
      },
      now: context.now,
    });
    const secondReceipt = await staging.stageBytes({
      draftId: 'draft-2',
      itemId: 'client-item-2',
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'DIRECT_TEXT',
      label: 'Duplicate Source',
      mediaType: 'text/plain',
      bytes,
    });
    const secondArtifact = await staging.resolve({
      stagingReference: secondReceipt.stagingReference,
      draftId: 'draft-2',
      itemId: 'client-item-2',
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'DIRECT_TEXT',
    });
    const second = await service.submit({
      submissionId: submitTwoCommandId,
      commandId: submitTwoCommandId,
      correlationId: `correlation-${submitTwoCommandId}`,
      draftId: 'draft-2',
      scope: context.scope,
      items: [{ ...secondArtifact, requestedClassification: 'public' }],
      createdAt: context.now,
    });
    expect(second.state).toBe('ACTION_REQUIRED');
    const decisionId = second.items[0]?.duplicateDecisionId;
    expect(decisionId).toBeDefined();
    const decision = await service.getDuplicateDecision(context.scope, decisionId!);
    expect(decision?.existingSource.sourceVersionId).toBe(produced?.sourceVersionId);

    const resolveCommandId = randomUUID();
    await insertAcceptedCommand({
      commandId: resolveCommandId,
      commandType: 'sources.duplicate.resolve.v1',
      principalId: context.principalId,
      projectId: context.projectId,
      payload: { decisionId, disposition: 'REUSE_EXISTING_VERSION' },
      now: context.now,
    });
    const resolved = await service.resolveDuplicate({
      commandId: resolveCommandId,
      correlationId: `correlation-${resolveCommandId}`,
      decisionId: decisionId!,
      observedDecisionRevision: decision!.decisionRevision,
      disposition: 'REUSE_EXISTING_VERSION',
      scope: context.scope,
      createdAt: context.now,
    });
    expect(resolved.state).toBe('SUCCEEDED');
    expect(resolved.items[0]?.producedResource).toMatchObject({
      sourceId: produced?.sourceId,
      sourceVersionId: produced?.sourceVersionId,
    });
    expect(stage3.calls).toHaveLength(2);
    expect(stage3.calls[1]).toMatchObject({
      sourceId: produced?.sourceId,
      sourceVersionId: produced?.sourceVersionId,
    });

    expect(
      await pool!.query(
        `SELECT
           (SELECT count(*)::text FROM asset.sources) AS sources,
           (SELECT count(*)::text FROM asset.source_versions) AS versions,
           (SELECT count(*)::text FROM asset.storage_receipts) AS receipts,
           (SELECT count(*)::text FROM source_product.exact_duplicate_decisions) AS decisions,
           (SELECT count(*)::text FROM source_product.exact_duplicate_dispositions) AS dispositions,
           (SELECT sensitivity FROM asset.source_versions LIMIT 1) AS version_sensitivity,
           (SELECT sensitivity FROM intake.submissions LIMIT 1) AS intake_sensitivity,
           (SELECT command_payload::text LIKE '%same immutable source bytes%'
              FROM frontend_command.command_ledger
              WHERE command_id = $1) AS raw_in_ledger`,
        [submitOneCommandId],
      ),
    ).toMatchObject({
      rows: [
        {
          sources: '1',
          versions: '1',
          receipts: '2',
          decisions: '1',
          dispositions: '1',
          version_sensitivity: 'public',
          intake_sensitivity: 'public',
          raw_in_ledger: false,
        },
      ],
    });
  });

  it('automatically reuses a matching SourceVersion and separates incompatible security without a decision', async () => {
    const context = await createContext();
    const storage = new InMemoryAssetStorage();
    const staging = new SealedSourcesStagingService(
      storage,
      'database-product-write-staging-secret-32-characters',
      undefined,
      () => new Date(context.now),
    );
    const service = new PostgresSourcesProductService(
      pool!,
      staging,
      new RecordingStage3Pipeline(),
    );
    const bytes = new TextEncoder().encode('VP immutable duplicate bytes');
    const submit = async (
      draftId: string,
      classification: 'public' | 'private',
      automatic: boolean,
    ) => {
      const commandId = randomUUID();
      await insertAcceptedCommand({
        commandId,
        commandType: 'sources.intake.submit.v1',
        principalId: context.principalId,
        projectId: context.projectId,
        payload: { draftId, inputs: [] },
        now: context.now,
      });
      const receipt = await staging.stageBytes({
        draftId,
        itemId: `${draftId}-item`,
        projectId: context.projectId,
        principalId: context.principalId,
        kind: 'DIRECT_TEXT',
        label: draftId,
        mediaType: 'text/plain',
        bytes,
      });
      const artifact = await staging.resolve({
        stagingReference: receipt.stagingReference,
        draftId,
        itemId: `${draftId}-item`,
        projectId: context.projectId,
        principalId: context.principalId,
        kind: 'DIRECT_TEXT',
      });
      return service.submit({
        submissionId: commandId,
        commandId,
        correlationId: `correlation-${commandId}`,
        draftId,
        scope: context.scope,
        items: [{ ...artifact, requestedClassification: classification }],
        ...(automatic ? { duplicateHandling: 'AUTOMATIC' as const } : {}),
        createdAt: context.now,
      });
    };

    const first = await submit('vp-original', 'public', false);
    const sameSecurity = await submit('vp-same-security', 'public', true);
    const differentSecurity = await submit('vp-private-security', 'private', true);
    expect(sameSecurity.state).toBe('SUCCEEDED');
    expect(sameSecurity.items[0]?.duplicateDecisionId).toBeUndefined();
    expect(sameSecurity.items[0]?.producedResource).toMatchObject(
      first.items[0]!.producedResource!,
    );
    expect(differentSecurity.state).toBe('SUCCEEDED');
    expect(differentSecurity.items[0]?.duplicateDecisionId).toBeUndefined();
    expect(differentSecurity.items[0]?.producedResource?.sourceId).not.toBe(
      first.items[0]?.producedResource?.sourceId,
    );
    const rows = await pool!.query<{
      sources: string;
      versions: string;
      decisions: string;
      automatic_submissions: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM asset.sources) AS sources,
         (SELECT count(*)::text FROM asset.source_versions) AS versions,
         (SELECT count(*)::text FROM source_product.exact_duplicate_decisions) AS decisions,
         (SELECT count(*)::text FROM source_product.intake_submissions
          WHERE duplicate_handling = 'AUTOMATIC') AS automatic_submissions`,
    );
    expect(rows.rows[0]).toEqual({
      sources: '2',
      versions: '2',
      decisions: '0',
      automatic_submissions: '2',
    });
  });

  it('does not offer incompatible exact-content Version reuse and materializes a separate Source with pinned security metadata', async () => {
    const context = await createContext();
    const storage = new InMemoryAssetStorage();
    const staging = new SealedSourcesStagingService(
      storage,
      'database-product-write-staging-secret-32-characters',
      undefined,
      () => new Date(context.now),
    );
    const stage3 = new RecordingStage3Pipeline();
    const service = new PostgresSourcesProductService(pool!, staging, stage3);
    const bytes = new TextEncoder().encode('same bytes with distinct resource security identity');

    const firstCommandId = randomUUID();
    await insertAcceptedCommand({
      commandId: firstCommandId,
      commandType: 'sources.intake.submit.v1',
      principalId: context.principalId,
      projectId: context.projectId,
      payload: { draftId: 'public-source', inputs: [] },
      now: context.now,
    });
    const firstReceipt = await staging.stageBytes({
      draftId: 'public-source',
      itemId: 'public-item',
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'DIRECT_TEXT',
      label: 'Public source',
      mediaType: 'text/plain',
      bytes,
    });
    const firstArtifact = await staging.resolve({
      stagingReference: firstReceipt.stagingReference,
      draftId: 'public-source',
      itemId: 'public-item',
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'DIRECT_TEXT',
    });
    await service.submit({
      submissionId: firstCommandId,
      commandId: firstCommandId,
      correlationId: `correlation-${firstCommandId}`,
      draftId: 'public-source',
      scope: context.scope,
      items: [{ ...firstArtifact, requestedClassification: 'public' }],
      createdAt: context.now,
    });

    const secondCommandId = randomUUID();
    await insertAcceptedCommand({
      commandId: secondCommandId,
      commandType: 'sources.intake.submit.v1',
      principalId: context.principalId,
      projectId: context.projectId,
      payload: { draftId: 'private-source', inputs: [] },
      now: context.now,
    });
    const secondReceipt = await staging.stageBytes({
      draftId: 'private-source',
      itemId: 'private-item',
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'DIRECT_TEXT',
      label: 'Private source',
      mediaType: 'text/plain',
      bytes,
    });
    const secondArtifact = await staging.resolve({
      stagingReference: secondReceipt.stagingReference,
      draftId: 'private-source',
      itemId: 'private-item',
      projectId: context.projectId,
      principalId: context.principalId,
      kind: 'DIRECT_TEXT',
    });
    const second = await service.submit({
      submissionId: secondCommandId,
      commandId: secondCommandId,
      correlationId: `correlation-${secondCommandId}`,
      draftId: 'private-source',
      scope: context.scope,
      items: [secondArtifact],
      createdAt: context.now,
    });
    const decisionId = second.items[0]?.duplicateDecisionId;
    expect(decisionId).toBeDefined();
    if (!decisionId) throw new Error('Expected an exact duplicate decision.');
    const decision = await service.getDuplicateDecision(context.scope, decisionId);
    expect(decision?.allowedDispositions).toEqual(['CREATE_SEPARATE_SOURCE', 'CANCEL_SUBMISSION']);
    if (!decision) throw new Error('Expected a persisted exact duplicate decision.');

    const resolveCommandId = randomUUID();
    await insertAcceptedCommand({
      commandId: resolveCommandId,
      commandType: 'sources.duplicate.resolve.v1',
      principalId: context.principalId,
      projectId: context.projectId,
      payload: { decisionId: decision.decisionId, disposition: 'CREATE_SEPARATE_SOURCE' },
      now: context.now,
    });
    const resolved = await service.resolveDuplicate({
      commandId: resolveCommandId,
      correlationId: `correlation-${resolveCommandId}`,
      decisionId: decision.decisionId,
      observedDecisionRevision: decision.decisionRevision,
      disposition: 'CREATE_SEPARATE_SOURCE',
      scope: context.scope,
      createdAt: context.now,
    });
    expect(resolved.state).toBe('SUCCEEDED');
    expect(stage3.calls).toHaveLength(2);
    expect(stage3.calls[1]?.sourceId).not.toBe(stage3.calls[0]?.sourceId);
    expect(stage3.calls[1]?.sourceVersionId).not.toBe(stage3.calls[0]?.sourceVersionId);
    expect(
      await pool!.query(
        `SELECT
           (SELECT count(*)::text FROM asset.original_assets) AS assets,
           (SELECT count(*)::text FROM asset.sources) AS sources,
           (SELECT count(*)::text FROM asset.source_versions) AS versions,
           (SELECT count(*)::text FROM asset.source_versions WHERE sensitivity = 'public') AS public_versions,
           (SELECT count(*)::text FROM asset.source_versions WHERE sensitivity = 'private') AS private_versions`,
      ),
    ).toMatchObject({
      rows: [
        {
          assets: '1',
          sources: '2',
          versions: '2',
          public_versions: '1',
          private_versions: '1',
        },
      ],
    });
  });
});
