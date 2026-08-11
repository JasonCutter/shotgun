import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresSourcesIntakeLifecycle } from '../../adapters/frontend-sources-write-postgres/src/lifecycle.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const hash = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

afterAll(async () => {
  await pool?.end();
});

const insertCommand = async (input: {
  commandId: string;
  principalId: string;
  projectId: string;
  commandType: string;
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
       $7, '1.0.0', $8, '{}'::jsonb, $9::jsonb, $10::jsonb,
       $11::jsonb, '[]'::jsonb, '{}'::jsonb, 'ACCEPTED', NULL,
       '[]'::jsonb, NULL, $12, $13, $14, $14, NULL, $14
     )`,
    [
      input.commandId,
      `client-${input.commandId}`,
      `idem-${input.commandId}`,
      input.principalId,
      input.projectId,
      JSON.stringify({ scope: 'PROJECT', projectId: input.projectId }),
      input.commandType,
      hash(`${input.commandType}:${input.commandId}`),
      JSON.stringify({ principalId: input.principalId }),
      JSON.stringify({ activeProjectId: input.projectId, targetProjectId: input.projectId }),
      JSON.stringify({ policyContextId: 'policy/1', policyContextRevision: '1' }),
      `correlation-${input.commandId}`,
      `trace-${input.commandId}`,
      input.now,
    ],
  );
};

const seedRunningSubmission = async () => {
  const principalId = randomUUID();
  const sessionId = randomUUID();
  const projectId = `lifecycle-project-${randomUUID()}`;
  const submissionId = randomUUID();
  const itemId = randomUUID();
  const attemptId = randomUUID();
  const submitCommandId = randomUUID();
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
     ) VALUES ($1, 'Lifecycle project', 'ACTIVE', true, $2, $2, 1)`,
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
  await insertCommand({
    commandId: submitCommandId,
    principalId,
    projectId,
    commandType: 'sources.intake.submit.v1',
    now,
  });
  await pool!.query(
    `INSERT INTO source_product.intake_submissions (
       submission_id, project_id, principal_id, session_id, create_command_id,
       state, accepted_policy_context_id, accepted_policy_binding,
       access_revision, policy_context_revision, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, 'RUNNING', 'policy/1', '{}'::jsonb,
               '1', '1', $6, $6)`,
    [submissionId, projectId, principalId, sessionId, submitCommandId, now],
  );
  await pool!.query(
    `INSERT INTO source_product.intake_submission_items (
       submission_item_id, project_id, submission_id, client_item_id, ordinal,
       input_kind, label, input_manifest, state, content_hash, media_type,
       size_bytes, created_at, updated_at
     ) VALUES ($1, $2, $3, 'item-1', 0, 'DIRECT_TEXT', 'Lifecycle Item',
               '{}'::jsonb, 'RUNNING', $4, 'text/plain', 1, $5, $5)`,
    [itemId, projectId, submissionId, hash('lifecycle'), now],
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
  return { principalId, projectId, submissionId, itemId, attemptId, now };
};

describe.runIf(pool)('Sources cancel retry and outcome recovery persistence', () => {
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

  it('preserves Attempt history through outcome-indeterminate, retry and cancellation', async () => {
    const context = await seedRunningSubmission();
    const lifecycle = new PostgresSourcesIntakeLifecycle(pool!);

    const indeterminate = await lifecycle.markOutcomeIndeterminate({
      projectId: context.projectId,
      submissionId: context.submissionId,
      submissionItemIds: [context.itemId],
      updatedAt: context.now,
    });
    expect(indeterminate.submissionState).toBe('OUTCOME_INDETERMINATE');
    expect(indeterminate.itemStates[0]).toMatchObject({
      state: 'OUTCOME_INDETERMINATE',
      attemptCount: 1,
    });

    const retryCommandId = randomUUID();
    await insertCommand({
      commandId: retryCommandId,
      principalId: context.principalId,
      projectId: context.projectId,
      commandType: 'sources.intake.retry.v1',
      now: context.now,
    });
    const retried = await lifecycle.retryItems({
      projectId: context.projectId,
      submissionId: context.submissionId,
      submissionItemIds: [context.itemId],
      commandId: retryCommandId,
      mode: 'CURRENT_POLICY',
      acceptedPolicyContextId: 'policy/2',
      acceptedPolicyBinding: { mode: 'CURRENT' },
      correlationId: `correlation-${retryCommandId}`,
      createdAt: context.now,
    });
    expect(retried.submissionState).toBe('QUEUED');
    expect(retried.itemStates[0]).toMatchObject({ state: 'QUEUED', attemptCount: 2 });

    const cancelCommandId = randomUUID();
    await insertCommand({
      commandId: cancelCommandId,
      principalId: context.principalId,
      projectId: context.projectId,
      commandType: 'sources.intake.cancel.v1',
      now: context.now,
    });
    const cancelled = await lifecycle.cancelSubmission({
      projectId: context.projectId,
      submissionId: context.submissionId,
      commandId: cancelCommandId,
      acceptedPolicyContextId: 'policy/2',
      acceptedPolicyBinding: { mode: 'CURRENT' },
      correlationId: `correlation-${cancelCommandId}`,
      createdAt: context.now,
    });
    expect(cancelled.submissionState).toBe('CANCELLED');
    expect(cancelled.itemStates[0]).toMatchObject({ state: 'CANCELLED', attemptCount: 3 });

    expect(
      await pool!.query(
        `SELECT attempt_number, attempt_kind, state, causation_attempt_id IS NOT NULL AS caused
         FROM source_product.intake_attempts
         WHERE submission_item_id = $1
         ORDER BY attempt_number`,
        [context.itemId],
      ),
    ).toMatchObject({
      rows: [
        {
          attempt_number: 1,
          attempt_kind: 'SUBMIT',
          state: 'OUTCOME_INDETERMINATE',
          caused: false,
        },
        {
          attempt_number: 2,
          attempt_kind: 'RETRY_CURRENT_POLICY',
          state: 'ACCEPTED',
          caused: true,
        },
        { attempt_number: 3, attempt_kind: 'CANCEL', state: 'SUCCEEDED', caused: true },
      ],
    });
  });

  it('rejects retry while an Item is still running and creates no new Attempt', async () => {
    const context = await seedRunningSubmission();
    const retryCommandId = randomUUID();
    await insertCommand({
      commandId: retryCommandId,
      principalId: context.principalId,
      projectId: context.projectId,
      commandType: 'sources.intake.retry.v1',
      now: context.now,
    });
    await expect(
      new PostgresSourcesIntakeLifecycle(pool!).retryItems({
        projectId: context.projectId,
        submissionId: context.submissionId,
        submissionItemIds: [context.itemId],
        commandId: retryCommandId,
        mode: 'SAME_CONTEXT',
        acceptedPolicyContextId: 'policy/1',
        acceptedPolicyBinding: {},
        correlationId: `correlation-${retryCommandId}`,
        createdAt: context.now,
      }),
    ).rejects.toThrow(/Only failed, cancelled or outcome-indeterminate Items/);
    expect(
      await pool!.query(
        `SELECT count(*)::text AS count
         FROM source_product.intake_attempts
         WHERE submission_item_id = $1`,
        [context.itemId],
      ),
    ).toMatchObject({ rows: [{ count: '1' }] });
  });
});
