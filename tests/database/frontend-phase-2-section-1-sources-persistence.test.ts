import { createHash, randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PostgresSourcesIntakeUnitOfWork } from '../../adapters/frontend-sources-write-postgres/src/index.js';
import {
  PostgresOriginalAssetRepository,
  createPostgresPool,
} from '../../adapters/postgres/src/index.js';
import type { CreateSourcesIntakeSubmissionInput } from '../../modules/frontend-sources-write/src/index.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;
const hash = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

afterAll(async () => {
  await pool?.end();
});

const fixture = async (
  payload: unknown = { inputs: [{ kind: 'DIRECT_TEXT', contentHash: hash('ok') }] },
) => {
  const principalId = randomUUID();
  const sessionId = randomUUID();
  const projectId = `sources-project-${randomUUID()}`;
  const commandId = randomUUID();
  const now = new Date().toISOString();

  await pool!.query(
    `INSERT INTO auth.principals (
       principal_id, actor_type, status, account_id, created_at
     ) VALUES ($1, 'user', 'active', $2, $3)`,
    [principalId, `sources-owner-${principalId}`, now],
  );
  await pool!.query(
    `INSERT INTO project_admin.projects (
       id, name, status, active, created_at, updated_at, revision
     ) VALUES ($1, $2, 'ACTIVE', true, $3, $3, 1)`,
    [projectId, 'Sources Test Project', now],
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
      JSON.stringify(payload),
      `correlation-${commandId}`,
      `trace-${commandId}`,
      now,
    ],
  );
  return { principalId, sessionId, projectId, commandId, now };
};

const directSubmission = (
  context: Awaited<ReturnType<typeof fixture>>,
): CreateSourcesIntakeSubmissionInput => ({
  submissionId: randomUUID(),
  projectId: context.projectId,
  principalId: context.principalId,
  sessionId: context.sessionId,
  createCommandId: context.commandId,
  correlationId: `correlation-${context.commandId}`,
  acceptedPolicyContextId: `policy/${context.projectId}`,
  acceptedPolicyBinding: { mode: 'CURRENT' },
  accessRevision: '1',
  policyContextRevision: '1',
  accessScope: ['owner'],
  sensitivity: 'private',
  createdAt: context.now,
  items: [
    {
      clientItemId: 'direct-1',
      inputKind: 'DIRECT_TEXT',
      label: 'JasonNote 첫 메모',
      inputManifest: {
        kind: 'DIRECT_TEXT',
        contentHash: hash('hello sources'),
        stagingReference: 'staging://direct-1',
      },
      channel: 'direct_text',
      mediaType: 'text/plain',
      contentHash: hash('hello sources'),
      sizeBytes: Buffer.byteLength('hello sources'),
      storageKey: `sha256/${hash('hello sources').slice(7)}`,
    },
  ],
});

describe.runIf(pool)('Frontend Phase 2 Section 1 Sources persistence', () => {
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

  afterEach(async () => {
    await pool!.query(
      'ALTER TABLE asset.storage_receipts DROP CONSTRAINT IF EXISTS test_sources_late_failure',
    );
  });

  it('creates the seven relations, expands the Stage 2 channel, and backfills no history', async () => {
    expect(
      await pool!.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM information_schema.tables
         WHERE table_schema = 'source_product'`,
      ),
    ).toMatchObject({ rows: [{ count: '7' }] });
    await pool!.query(
      `INSERT INTO intake.submissions (
         submission_key, submission_id, project_id, actor_id, channel,
         material_kind, media_type, content_hash, size_bytes, access_scope,
         sensitivity, created_at
       ) VALUES ($1, 'url-channel-test', 'p', 'a', 'url_acquisition',
                 'plain_text', 'text/plain', $2, 1, '{owner}', 'private', now())`,
      [randomUUID(), hash('x')],
    );
    expect(
      await pool!.query('SELECT count(*)::text AS count FROM source_product.intake_submissions'),
    ).toMatchObject({ rows: [{ count: '0' }] });
  });

  it('commits Product and Stage 2 owners atomically and replays the accepted command', async () => {
    const context = await fixture();
    const input = directSubmission(context);
    const unitOfWork = new PostgresSourcesIntakeUnitOfWork(pool!);
    const created = await unitOfWork.createSubmission(input);
    const replayed = await unitOfWork.createSubmission(input);
    const projectedSources = await new PostgresOriginalAssetRepository(
      pool!,
    ).listProjectSourceVersions(context.projectId);

    expect(replayed).toEqual({ ...created, replayed: true });
    expect(projectedSources).toHaveLength(1);
    expect(projectedSources[0]?.displayLabel).toBe('JasonNote 첫 메모');
    expect(
      await pool!.query(
        `SELECT
           (SELECT count(*)::text FROM source_product.intake_submissions) AS submissions,
           (SELECT count(*)::text FROM source_product.intake_submission_items) AS items,
           (SELECT count(*)::text FROM source_product.intake_attempts) AS attempts,
           (SELECT count(*)::text FROM intake.submissions) AS stage2,
           (SELECT count(*)::text FROM asset.original_assets) AS assets,
           (SELECT count(*)::text FROM asset.sources) AS sources,
           (SELECT count(*)::text FROM asset.source_versions) AS versions,
           (SELECT count(*)::text FROM asset.storage_receipts) AS receipts,
           (SELECT outcome_state FROM frontend_command.command_ledger WHERE command_id = $1) AS command_state`,
        [context.commandId],
      ),
    ).toMatchObject({
      rows: [
        {
          submissions: '1',
          items: '1',
          attempts: '1',
          stage2: '1',
          assets: '1',
          sources: '1',
          versions: '1',
          receipts: '1',
          command_state: 'ACCEPTED',
        },
      ],
    });
  });

  it('rejects raw Command Ledger input and leaves all Domain owners empty', async () => {
    const context = await fixture({ inputs: [{ kind: 'DIRECT_TEXT', text: 'secret' }] });
    await expect(
      new PostgresSourcesIntakeUnitOfWork(pool!).createSubmission(directSubmission(context)),
    ).rejects.toThrow(/forbidden raw-input field/);
    expect(
      await pool!.query(
        `SELECT
           (SELECT count(*)::text FROM source_product.intake_submissions) AS product,
           (SELECT count(*)::text FROM intake.submissions) AS stage2,
           (SELECT count(*)::text FROM asset.original_assets) AS assets`,
      ),
    ).toMatchObject({ rows: [{ product: '0', stage2: '0', assets: '0' }] });
  });

  it('rolls back Product, Stage 2 and Asset rows on a late StorageReceipt failure', async () => {
    const context = await fixture();
    await pool!.query(`
      ALTER TABLE asset.storage_receipts
      ADD CONSTRAINT test_sources_late_failure CHECK (false)
    `);
    await expect(
      new PostgresSourcesIntakeUnitOfWork(pool!).createSubmission(directSubmission(context)),
    ).rejects.toThrow();
    expect(
      await pool!.query(
        `SELECT
           (SELECT count(*)::text FROM source_product.intake_submissions) AS product,
           (SELECT count(*)::text FROM intake.submissions) AS stage2,
           (SELECT count(*)::text FROM asset.original_assets) AS assets,
           (SELECT count(*)::text FROM asset.sources) AS sources`,
      ),
    ).toMatchObject({ rows: [{ product: '0', stage2: '0', assets: '0', sources: '0' }] });
  });

  it('persists redacted URL provenance under the url_acquisition channel', async () => {
    const context = await fixture({
      inputs: [{ kind: 'URL', redactedRequestedUrl: 'https://example.com/doc?token=[REDACTED]' }],
    });
    const contentHash = hash('url body');
    const input: CreateSourcesIntakeSubmissionInput = {
      ...directSubmission(context),
      items: [
        {
          clientItemId: 'url-1',
          inputKind: 'URL',
          label: 'URL source',
          inputManifest: {
            kind: 'URL',
            contentHash,
            stagingReference: 'staging://url-1',
            redactedRequestedUrl: 'https://example.com/doc?token=[REDACTED]',
          },
          channel: 'url_acquisition',
          mediaType: 'text/plain',
          contentHash,
          sizeBytes: Buffer.byteLength('url body'),
          storageKey: `sha256/${contentHash.slice(7)}`,
          urlProvenance: {
            normalizedRequestedUrl: 'https://example.com/doc?token=[REDACTED]',
            redactedRequestedUrl: 'https://example.com/doc?token=[REDACTED]',
            redactedFinalUrl: 'https://example.com/doc?token=[REDACTED]',
            redirectChainDigest: hash('redirect-chain'),
            redirectObservations: [],
            dnsObservations: [
              { family: 'ipv4', addressClass: 'public', addressSetDigest: hash('dns') },
            ],
            responseStatus: 200,
            responseContentType: 'text/plain',
            responseContentLength: Buffer.byteLength('url body'),
            compressedBytes: Buffer.byteLength('url body'),
            decompressedBytes: Buffer.byteLength('url body'),
            responseMetadata: { cacheControl: 'no-store' },
            retentionClass: 'sources-default',
            retrievedAt: context.now,
            limits: {
              maxRedirects: 5,
              connectTimeoutMs: 1000,
              headerTimeoutMs: 1000,
              bodyTimeoutMs: 1000,
              totalTimeoutMs: 4000,
              maxCompressedBytes: 1_048_576,
              maxDecompressedBytes: 1_048_576,
            },
          },
        },
      ],
    };
    await new PostgresSourcesIntakeUnitOfWork(pool!).createSubmission(input);
    expect(
      await pool!.query(
        `SELECT receipt.channel, provenance.outcome,
                provenance.redacted_final_url,
                provenance.original_asset_id IS NOT NULL AS has_asset
         FROM asset.storage_receipts AS receipt
         JOIN source_product.url_provenance_receipts AS provenance
           ON provenance.source_version_id = receipt.source_version_id`,
      ),
    ).toMatchObject({
      rows: [
        {
          channel: 'url_acquisition',
          outcome: 'SUCCEEDED',
          redacted_final_url: 'https://example.com/doc?token=[REDACTED]',
          has_asset: true,
        },
      ],
    });
  });
});
