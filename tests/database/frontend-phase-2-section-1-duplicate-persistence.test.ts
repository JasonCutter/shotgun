import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresSourcesIntakeUnitOfWork } from '../../adapters/frontend-sources-write-postgres/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

afterAll(async () => {
  await pool?.end();
});

const command = async (input: {
  commandId: string;
  principalId: string;
  projectId: string;
  now: string;
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
       'sources.duplicate.resolve.v1', '1.0.0', $7, '{}'::jsonb,
       $8::jsonb, $9::jsonb, $10::jsonb, '[]'::jsonb, '{}'::jsonb,
       'ACCEPTED', NULL, '[]'::jsonb, NULL, $11, $12, $13, $13, NULL, $13
     )`,
    [
      input.commandId,
      `client-${input.commandId}`,
      `idem-${input.commandId}`,
      input.principalId,
      input.projectId,
      JSON.stringify({ scope: 'PROJECT', projectId: input.projectId }),
      digest(input.commandId),
      JSON.stringify({ principalId: input.principalId }),
      JSON.stringify({ activeProjectId: input.projectId, targetProjectId: input.projectId }),
      JSON.stringify({ policyContextId: 'policy/1', policyContextRevision: '1' }),
      `correlation-${input.commandId}`,
      `trace-${input.commandId}`,
      input.now,
    ],
  );
};

const seed = async () => {
  const principalId = randomUUID();
  const sessionId = randomUUID();
  const projectId = `duplicate-project-${randomUUID()}`;
  const submitCommandId = randomUUID();
  const submissionId = randomUUID();
  const itemId = randomUUID();
  const attemptId = randomUUID();
  const assetId = randomUUID();
  const sourceId = randomUUID();
  const sourceVersionId = randomUUID();
  const contentHash = digest('same immutable bytes');
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
     ) VALUES ($1, 'Duplicate project', 'ACTIVE', true, $2, $2, 1)`,
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
      digest(`session-${sessionId}`),
      digest(`csrf-${sessionId}`),
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
       'sources.intake.submit.v1', '1.0.0', $7, '{}'::jsonb,
       $8::jsonb, $9::jsonb, $10::jsonb, '[]'::jsonb, '{}'::jsonb,
       'ACCEPTED', NULL, '[]'::jsonb, NULL, $11, $12, $13, $13, NULL, $13
     )`,
    [
      submitCommandId,
      `client-${submitCommandId}`,
      `idem-${submitCommandId}`,
      principalId,
      projectId,
      JSON.stringify({ scope: 'PROJECT', projectId }),
      digest(submitCommandId),
      JSON.stringify({ principalId }),
      JSON.stringify({ activeProjectId: projectId, targetProjectId: projectId }),
      JSON.stringify({ policyContextId: 'policy/1', policyContextRevision: '1' }),
      `correlation-${submitCommandId}`,
      `trace-${submitCommandId}`,
      now,
    ],
  );

  await pool!.query(
    `INSERT INTO asset.original_assets (
       asset_id, content_hash, size_bytes, storage_key, created_at
     ) VALUES ($1, $2, 20, $3, $4)`,
    [assetId, contentHash, `sha256/${contentHash.slice(7)}`, now],
  );
  await pool!.query(
    `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    [sourceId, projectId, principalId, now],
  );
  await pool!.query(
    `INSERT INTO asset.source_versions (
       source_version_id, source_id, version_number, original_asset_id,
       media_type, access_scope, sensitivity, created_at
     ) VALUES ($1, $2, 1, $3, 'text/plain', '{owner}', 'private', $4)`,
    [sourceVersionId, sourceId, assetId, now],
  );
  await pool!.query(
    `INSERT INTO source_product.intake_submissions (
       submission_id, project_id, principal_id, session_id, create_command_id,
       state, accepted_policy_context_id, accepted_policy_binding,
       access_revision, policy_context_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'RUNNING', 'policy/1', '{}'::jsonb,
               'access/1', 'policy/1', $6, $6)`,
    [submissionId, projectId, principalId, sessionId, submitCommandId, now],
  );
  await pool!.query(
    `INSERT INTO source_product.intake_submission_items (
       submission_item_id, project_id, submission_id, client_item_id, ordinal,
       input_kind, label, input_manifest, state, content_hash, media_type,
       size_bytes, created_at, updated_at
     ) VALUES ($1, $2, $3, 'duplicate-item', 0, 'DIRECT_TEXT', 'Duplicate Item',
               '{}'::jsonb, 'RUNNING', $4, 'text/plain', 20, $5, $5)`,
    [itemId, projectId, submissionId, contentHash, now],
  );
  await pool!.query(
    `INSERT INTO source_product.intake_attempts (
       intake_attempt_id, project_id, submission_id, submission_item_id,
       command_id, attempt_number, attempt_kind, state, correlation_id,
       accepted_policy_context_id, accepted_policy_binding, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 1, 'SUBMIT', 'RUNNING', $6,
               'policy/1', '{}'::jsonb, $7, $7)`,
    [attemptId, projectId, submissionId, itemId, submitCommandId, `corr-${attemptId}`, now],
  );

  return {
    principalId,
    projectId,
    submissionId,
    itemId,
    sourceId,
    sourceVersionId,
    contentHash,
    now,
  };
};

describe.runIf(pool)('Sources exact duplicate persistence', () => {
  beforeEach(async () => {
    await pool!.query(`
      TRUNCATE
        source_product.exact_duplicate_dispositions,
        source_product.exact_duplicate_decisions,
        source_product.intake_attempts,
        source_product.intake_submission_items,
        source_product.intake_submissions,
        asset.storage_receipts,
        asset.source_versions,
        asset.sources,
        asset.original_assets,
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

  it('rejects a stale Decision and accepts only one concurrent Disposition', async () => {
    const context = await seed();
    const unitOfWork = new PostgresSourcesIntakeUnitOfWork(pool!);
    const first = await unitOfWork.createExactDuplicateDecision({
      projectId: context.projectId,
      submissionId: context.submissionId,
      submissionItemId: context.itemId,
      contentHash: context.contentHash,
      existingSourceId: context.sourceId,
      existingSourceVersionId: context.sourceVersionId,
      allowedDispositions: ['REUSE_EXISTING_VERSION', 'CREATE_SEPARATE_SOURCE'],
      observedSourceRevision: 'source/1',
      accessRevision: 'access/1',
      policyContextRevision: 'policy/1',
      createdAt: context.now,
    });
    const second = await unitOfWork.createExactDuplicateDecision({
      projectId: context.projectId,
      submissionId: context.submissionId,
      submissionItemId: context.itemId,
      contentHash: context.contentHash,
      existingSourceId: context.sourceId,
      existingSourceVersionId: context.sourceVersionId,
      allowedDispositions: ['REUSE_EXISTING_VERSION', 'CREATE_SEPARATE_SOURCE'],
      observedSourceRevision: 'source/1',
      accessRevision: 'access/1',
      policyContextRevision: 'policy/1',
      createdAt: context.now,
    });
    expect(first.decisionRevision).toBe('1');
    expect(second.decisionRevision).toBe('2');

    const staleCommand = randomUUID();
    await command({ ...context, commandId: staleCommand });
    await expect(
      unitOfWork.resolveExactDuplicateDecision({
        projectId: context.projectId,
        submissionId: context.submissionId,
        submissionItemId: context.itemId,
        decisionId: first.decisionId,
        observedDecisionRevision: first.decisionRevision,
        commandId: staleCommand,
        disposition: 'REUSE_EXISTING_VERSION',
        createdAt: context.now,
      }),
    ).rejects.toThrow(/stale or not active/);

    const commandA = randomUUID();
    const commandB = randomUUID();
    await command({ ...context, commandId: commandA });
    await command({ ...context, commandId: commandB });
    const results = await Promise.allSettled([
      unitOfWork.resolveExactDuplicateDecision({
        projectId: context.projectId,
        submissionId: context.submissionId,
        submissionItemId: context.itemId,
        decisionId: second.decisionId,
        observedDecisionRevision: second.decisionRevision,
        commandId: commandA,
        disposition: 'REUSE_EXISTING_VERSION',
        createdAt: context.now,
      }),
      unitOfWork.resolveExactDuplicateDecision({
        projectId: context.projectId,
        submissionId: context.submissionId,
        submissionItemId: context.itemId,
        decisionId: second.decisionId,
        observedDecisionRevision: second.decisionRevision,
        commandId: commandB,
        disposition: 'CREATE_SEPARATE_SOURCE',
        createdAt: context.now,
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      await pool!.query(
        `SELECT
           (SELECT count(*)::text FROM source_product.exact_duplicate_dispositions
             WHERE decision_id = $1) AS disposition_count,
           (SELECT active_duplicate_decision_id IS NULL
             FROM source_product.intake_submission_items
             WHERE submission_item_id = $2) AS pointer_cleared`,
        [second.decisionId, context.itemId],
      ),
    ).toMatchObject({ rows: [{ disposition_count: '1', pointer_cleared: true }] });
  });

  it('keeps Decision rows immutable', async () => {
    const context = await seed();
    const decision = await new PostgresSourcesIntakeUnitOfWork(pool!).createExactDuplicateDecision({
      projectId: context.projectId,
      submissionId: context.submissionId,
      submissionItemId: context.itemId,
      contentHash: context.contentHash,
      existingSourceId: context.sourceId,
      existingSourceVersionId: context.sourceVersionId,
      allowedDispositions: ['REUSE_EXISTING_VERSION'],
      observedSourceRevision: 'source/1',
      accessRevision: 'access/1',
      policyContextRevision: 'policy/1',
      createdAt: context.now,
    });
    await expect(
      pool!.query(
        `UPDATE source_product.exact_duplicate_decisions
         SET access_revision = 'access/2' WHERE decision_id = $1`,
        [decision.decisionId],
      ),
    ).rejects.toThrow(/immutable/);
  });
});
