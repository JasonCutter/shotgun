import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';
import { PostgresSourcesProductService } from '../../adapters/frontend-sources-write-postgres/src/product-service.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { InMemoryAssetStorage } from '../../adapters/stage2-in-memory/src/index.js';
import type { SourcesProductWriteScope } from '../../modules/frontend-sources-write/src/product-service.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const hash = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

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
        -- settings history sources are append-only (migration 032): never
        -- truncated; tests isolate via unique project/identity prefix.
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

  it('creates one Source, requires an exact-duplicate decision, and reuses the pinned Version', async () => {
    const context = await createContext();
    const storage = new InMemoryAssetStorage();
    const staging = new SealedSourcesStagingService(
      storage,
      'database-product-write-staging-secret-32-characters',
      undefined,
      () => new Date(context.now),
    );
    const service = new PostgresSourcesProductService(pool!, staging);
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

  it('does not offer incompatible exact-content Version reuse and materializes a separate Source with pinned security metadata', async () => {
    const context = await createContext();
    const storage = new InMemoryAssetStorage();
    const staging = new SealedSourcesStagingService(
      storage,
      'database-product-write-staging-secret-32-characters',
      undefined,
      () => new Date(context.now),
    );
    const service = new PostgresSourcesProductService(pool!, staging);
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
