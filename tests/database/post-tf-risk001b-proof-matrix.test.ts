import { createHash, randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { PostgresProjectAIConfigurationRepository } from '../../adapters/ai-configuration-postgres/src/index.js';
import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import { PostgresDiscoveryModelProfileRepository } from '../../adapters/discovery-model-profile-postgres/src/index.js';
import { PostgresActivityIndexStore } from '../../adapters/frontend-activity-postgres/src/index.js';
import { PostgresPayloadStateStore } from '../../adapters/frontend-history-postgres/src/index.js';
import { PostgresSourcesIntakeUnitOfWork } from '../../adapters/frontend-sources-write-postgres/src/index.js';
import { PostgresSourcesProductService } from '../../adapters/frontend-sources-write-postgres/src/product-service.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import {
  CredentialVaultService,
  StaticCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import type { ProjectAIConfiguration } from '../../modules/ai-configuration/src/index.js';
import type { ActivityIndexRecordV1 } from '../../modules/frontend-activity/src/index.js';
import type { CreateSourcesIntakeSubmissionInput } from '../../modules/frontend-sources-write/src/index.js';
import type { SourcesProductWriteScope } from '../../modules/frontend-sources-write/src/product-service.js';
import {
  DISCOVERY_MODEL_PROFILE_SCHEMA_VERSION,
  type DiscoveryModelProfileV1,
} from '../../packages/contracts/src/index.js';
import { hashPassword } from '../../packages/authentication/src/index.js';
import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

/**
 * POST-TF RISK-001B / Issue #339 — proof-only matrix.
 *
 * Scope is deliberately limited to Product/runtime write paths that still own
 * manual BEGIN/COMMIT/ROLLBACK boundaries. This file does not change runtime
 * code, migrations, ADRs, launchers, releases, or production data.
 *
 * Every exercised path uses TEST_DATABASE_URL only. The guard requires a
 * shotgun_test* database and rejects a target equal to DATABASE_URL.
 */

const databaseUrl = await requireTestDatabaseTarget();
const pool: Pool = createPostgresPool(databaseUrl);

type Classification =
  | 'SAFE_ALREADY'
  | 'GREEN_RECOVERED'
  | 'RED_FALSE_FAILURE'
  | 'RED_FALSE_SUCCESS'
  | 'RED_STALE_CONFLICT'
  | 'RED_DUPLICATE_EFFECT'
  | 'RED_OTHER'
  | 'NOT_APPLICABLE_READ_ONLY';

type ProofRow = {
  readonly surface: string;
  readonly operation: string;
  readonly classification: Classification;
  readonly observed: string;
};

const proofRows: ProofRow[] = [];

const recordProof = (row: ProofRow): void => {
  proofRows.push(row);
};

type AckLossTrace = {
  commitAttempts: number;
  commitSucceeded: boolean;
  acknowledgementLost: boolean;
  postCommitRollbackAttempts: number;
};

const createCommitAckLossPool = (
  realPool: Pool,
): { readonly pool: Pool; readonly trace: AckLossTrace } => {
  const trace: AckLossTrace = {
    commitAttempts: 0,
    commitSucceeded: false,
    acknowledgementLost: false,
    postCommitRollbackAttempts: 0,
  };
  const faultPool = {
    query: async (sql: string, values?: readonly unknown[]) =>
      values === undefined ? realPool.query(sql) : realPool.query(sql, [...values]),
    connect: async (): Promise<PoolClient> => {
      const realClient = await realPool.connect();
      const client = {
        query: async (sql: string, values?: readonly unknown[]) => {
          const command = sql.trim().toUpperCase();
          if (command === 'COMMIT') {
            trace.commitAttempts += 1;
            await realClient.query('COMMIT');
            trace.commitSucceeded = true;
            trace.acknowledgementLost = true;
            throw new Error('synthetic commit acknowledgement loss');
          }
          if (command === 'ROLLBACK' && trace.commitSucceeded) {
            trace.postCommitRollbackAttempts += 1;
          }
          return values === undefined ? realClient.query(sql) : realClient.query(sql, [...values]);
        },
        release: () => realClient.release(),
      };
      return client as unknown as PoolClient;
    },
  } as unknown as Pool;
  return { pool: faultPool, trace };
};

const expectAckLoss = (trace: AckLossTrace): void => {
  expect(trace).toMatchObject({
    commitAttempts: 1,
    commitSucceeded: true,
    acknowledgementLost: true,
    postCommitRollbackAttempts: 0,
  });
};

const expectLegacyAckLoss = (trace: AckLossTrace): void => {
  expect(trace).toMatchObject({
    commitAttempts: 1,
    commitSucceeded: true,
    acknowledgementLost: true,
  });
  expect(trace.postCommitRollbackAttempts).toBeGreaterThan(0);
};

const sha256 = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const authority = (): StaticCredentialMasterKeyAuthority =>
  new StaticCredentialMasterKeyAuthority({ key: Buffer.alloc(32, 7), keyVersion: 'v1' });

const ensureProject = async (projectId: string): Promise<void> => {
  await pool.query(
    `INSERT INTO project_admin.projects (id, name, status, active, created_at, updated_at, revision)
     VALUES ($1, $1, 'ACTIVE', true, now(), now(), 1)
     ON CONFLICT (id) DO NOTHING`,
    [projectId],
  );
};

const makeAIConfiguration = (
  projectId: string,
  credentialId: string,
  updatedBy: string,
): ProjectAIConfiguration => ({
  projectId,
  activeProviderId: 'openai',
  activeModelId: 'gpt-5.6-luna',
  credentialId,
  credentialRevision: 1,
  aiConfigurationRevision: 1,
  updatedBy,
  updatedAt: '2026-09-17T08:00:00.000Z',
});

const makeDiscoveryProfile = (projectId: string, profileId: string): DiscoveryModelProfileV1 => ({
  schemaVersion: DISCOVERY_MODEL_PROFILE_SCHEMA_VERSION,
  profileId,
  projectId,
  profileRevision: 1,
  aiConfigurationRevision: 1,
  providerId: 'openai',
  modelId: 'gpt-discovery',
  providerRegistryRevision: 'provider-registry:v1',
  modelCapabilityRevision: 'model-capability:v1',
  promptVersion: 'discovery-ai-prompt:v1',
  outputSchemaVersion: 'discovery-ai-output:v1',
  status: 'PREPARED',
  createdBy: 'post-tf-risk001b',
  createdAt: '2026-09-17T08:00:00.000Z',
});

const sourceFixture = async (): Promise<{
  readonly principalId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly commandId: string;
  readonly now: string;
}> => {
  const principalId = randomUUID();
  const sessionId = randomUUID();
  const projectId = `post-tf-risk001b-sources-${randomUUID()}`;
  const commandId = randomUUID();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at)
     VALUES ($1, 'user', 'active', $2, $3)`,
    [principalId, `post-tf-risk001b-owner-${principalId}`, now],
  );
  await pool.query(
    `INSERT INTO project_admin.projects
       (id, name, status, active, created_at, updated_at, revision)
     VALUES ($1, $2, 'ACTIVE', true, $3, $3, 1)`,
    [projectId, 'POST-TF RISK-001B Sources Proof', now],
  );
  await pool.query(
    `INSERT INTO auth.project_memberships
       (principal_id, project_id, scopes, sensitivity_clearance, is_owner)
     VALUES ($1, $2, '{owner}', 'private', true)`,
    [principalId, projectId],
  );
  await pool.query(
    `INSERT INTO auth.sessions
       (session_id, token_hash, csrf_hash, principal_id, active_project_id,
        expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId,
      sha256(`session-${sessionId}`),
      sha256(`csrf-${sessionId}`),
      principalId,
      projectId,
      new Date(Date.now() + 60_000).toISOString(),
      now,
    ],
  );
  await pool.query(
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
      sha256(`command-${commandId}`),
      JSON.stringify({ mode: 'CURRENT' }),
      JSON.stringify({ principalId }),
      JSON.stringify({ activeProjectId: projectId, targetProjectId: projectId }),
      JSON.stringify({ policyContextId: `policy/${projectId}`, policyContextRevision: '1' }),
      JSON.stringify({ inputs: [{ kind: 'DIRECT_TEXT', contentHash: sha256('proof') }] }),
      `correlation-${commandId}`,
      `trace-${commandId}`,
      now,
    ],
  );
  return { principalId, projectId, sessionId, commandId, now };
};

const insertAcceptedCommand = async (input: {
  readonly commandId: string;
  readonly commandType: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly payload: unknown;
  readonly now: string;
}) => {
  await pool.query(
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
      sha256(`command-${input.commandId}`),
      JSON.stringify({ mode: 'CURRENT' }),
      JSON.stringify({ principalId: input.principalId }),
      JSON.stringify({ activeProjectId: input.projectId, targetProjectId: input.projectId }),
      JSON.stringify({ policyContextId: `policy/${input.projectId}`, policyContextRevision: '1' }),
      JSON.stringify(input.payload),
      `correlation-${input.commandId}`,
      `trace-${input.commandId}`,
      input.now,
    ],
  );
};

const directSubmission = (
  context: Awaited<ReturnType<typeof sourceFixture>>,
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
      label: 'POST-TF RISK-001B source',
      inputManifest: {
        kind: 'DIRECT_TEXT',
        contentHash: sha256('proof'),
        stagingReference: 'staging://post-tf-risk001b',
      },
      channel: 'direct_text',
      mediaType: 'text/plain',
      contentHash: sha256('proof'),
      sizeBytes: 5,
      storageKey: `sha256/${sha256('proof').slice(7)}`,
    },
  ],
});

const activityRecord = (projectId: string): ActivityIndexRecordV1 => ({
  resourceProjectId: projectId,
  activityId: `post-tf-risk001b-activity-${randomUUID()}`,
  domainKind: 'SOURCES',
  rootKind: 'JOB',
  domainResourceKind: 'SourceSubmission',
  domainResourceId: `resource-${projectId}`,
  resourceHref: `/sources/${projectId}`,
  jobId: `job-${projectId}`,
  runId: `run-${projectId}`,
  summary: 'POST-TF RISK-001B activity proof',
  state: 'RUNNING',
  attention: 'NONE',
  retryability: 'UNKNOWN',
  freshness: 'CURRENT',
  adapterStatus: 'AVAILABLE',
  snapshotRevision: 1,
  snapshot: { proof: true },
  projectedAt: '2026-09-17T08:00:00.000Z',
  updatedAt: '2026-09-17T08:00:00.000Z',
});

const inventory = [
  {
    surface: 'Stage 3/4/5 corrected paths from RISK-001A',
    operation: 'existing proof-covered repositories',
    disposition: 'EXCLUDED_ALREADY_SAFE_OR_CORRECTED',
  },
  {
    surface: 'read-only repository methods',
    operation: 'find/list/query/get',
    disposition: 'NOT_APPLICABLE_READ_ONLY',
  },
  {
    surface: 'migration runners, reset scripts, restore drills',
    operation: 'BEGIN/COMMIT/ROLLBACK maintenance code',
    disposition: 'EXCLUDED_NON_PRODUCT_RUNTIME',
  },
  {
    surface: 'OSS candidates',
    operation: 'transaction ACK-loss semantics',
    disposition: 'NO_RELEVANT_OSS',
  },
] as const;

describe('POST-TF RISK-001B manual transaction ACK-loss proof matrix', () => {
  afterAll(async () => {
    process.stdout.write(
      `\nRISK-001B_PROOF_MATRIX ${JSON.stringify({ inventory, proofRows }, null, 2)}\n`,
    );
    await pool.end();
  });

  it('AI configuration saveRevision: committed write becomes a stale conflict on retry', async () => {
    const projectId = `post-tf-risk001b-ai-${randomUUID()}`;
    await ensureProject(projectId);
    const credential = await new CredentialVaultService(
      new PostgresCredentialVaultRepository(pool),
      authority(),
    ).create({ projectId, providerId: 'openai', secret: 'proof-secret' });
    const next = makeAIConfiguration(projectId, credential.credentialId, 'risk001b');
    const injected = createCommitAckLossPool(pool);
    await expect(
      new PostgresProjectAIConfigurationRepository(injected.pool).saveRevision({
        expectedRevision: 0,
        next,
      }),
    ).resolves.toBe('CREATED');
    expectAckLoss(injected.trace);
    expect(await new PostgresProjectAIConfigurationRepository(pool).findCurrent(projectId)).toEqual(
      next,
    );
    await expect(
      new PostgresProjectAIConfigurationRepository(pool).saveRevision({
        expectedRevision: 0,
        next,
      }),
    ).resolves.toBe('CONFLICT');
    recordProof({
      surface: 'AI configuration',
      operation: 'saveRevision',
      classification: 'GREEN_RECOVERED',
      observed:
        'COMMIT durable; ACK-loss is converted to OUTCOME_UNKNOWN; witness readback returns CREATED and stale retry remains CONFLICT',
    });
  });

  it('credential vault replace: client request identity recovers the committed revision', async () => {
    const projectId = `post-tf-risk001b-credential-${randomUUID()}`;
    const cleanVault = new CredentialVaultService(
      new PostgresCredentialVaultRepository(pool),
      authority(),
    );
    const first = await cleanVault.create({
      projectId,
      providerId: 'openai',
      secret: 'credential-before',
      now: '2026-09-17T08:00:00.000Z',
    });
    const input = {
      projectId,
      providerId: 'openai',
      credentialId: first.credentialId,
      expectedRevision: first.credentialRevision,
      secret: 'credential-after',
      clientRequestId: `post-tf-risk001b-replace-${randomUUID()}`,
      now: '2026-09-17T08:00:01.000Z',
    };
    const injected = createCommitAckLossPool(pool);
    await expect(
      new CredentialVaultService(
        new PostgresCredentialVaultRepository(injected.pool),
        authority(),
      ).replace(input),
    ).rejects.toThrow('synthetic commit acknowledgement loss');
    expectLegacyAckLoss(injected.trace);
    const recovered = await cleanVault.replace(input);
    expect(recovered).toMatchObject({
      credentialId: first.credentialId,
      credentialRevision: 2,
    });
    expect(
      await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ai.provider_credentials
         WHERE credential_id = $1 AND credential_revision = 2`,
        [first.credentialId],
      ),
    ).toMatchObject({ rows: [{ count: '1' }] });
    recordProof({
      surface: 'Credential vault',
      operation: 'replace / advanceRevision',
      classification: 'SAFE_ALREADY',
      observed: 'COMMIT durable; exact client request retry recovers the same revision',
    });
  });

  it('discovery model profile saveRevision: committed write recovers after ACK-loss', async () => {
    const projectId = `post-tf-risk001b-profile-${randomUUID()}`;
    const next = makeDiscoveryProfile(projectId, randomUUID());
    const injected = createCommitAckLossPool(pool);
    await expect(
      new PostgresDiscoveryModelProfileRepository(injected.pool).saveRevision({
        expectedRevision: 0,
        next,
      }),
    ).resolves.toBe('CREATED');
    expectAckLoss(injected.trace);
    expect(await new PostgresDiscoveryModelProfileRepository(pool).findCurrent(projectId)).toEqual(
      next,
    );
    await expect(
      new PostgresDiscoveryModelProfileRepository(pool).saveRevision({
        expectedRevision: 0,
        next,
      }),
    ).resolves.toBe('CONFLICT');
    recordProof({
      surface: 'Discovery model profile',
      operation: 'saveRevision',
      classification: 'GREEN_RECOVERED',
      observed:
        'COMMIT durable; ACK-loss is converted to OUTCOME_UNKNOWN; witness readback returns CREATED and stale retry remains CONFLICT',
    });
  });

  it('discovery model profile updateStatus: durable activation recovers with a full witness', async () => {
    const projectId = `post-tf-risk001b-profile-status-${randomUUID()}`;
    const existingActive = makeDiscoveryProfile(projectId, randomUUID());
    const target = { ...makeDiscoveryProfile(projectId, randomUUID()), profileRevision: 2 };
    const clean = new PostgresDiscoveryModelProfileRepository(pool);
    await expect(clean.saveRevision({ expectedRevision: 0, next: existingActive })).resolves.toBe(
      'CREATED',
    );
    await expect(
      clean.updateStatus({
        projectId,
        profileId: existingActive.profileId,
        profileRevision: existingActive.profileRevision,
        expectedStatus: 'PREPARED',
        status: 'ACTIVE',
        updatedAt: '2026-09-17T08:00:01.000Z',
      }),
    ).resolves.toMatchObject({ profileId: existingActive.profileId, status: 'ACTIVE' });
    await expect(clean.saveRevision({ expectedRevision: 1, next: target })).resolves.toBe(
      'UPDATED',
    );
    const input = {
      projectId,
      profileId: target.profileId,
      profileRevision: target.profileRevision,
      expectedStatus: 'PREPARED' as const,
      status: 'ACTIVE' as const,
      updatedAt: '2026-09-17T08:00:02.000Z',
    };
    const injected = createCommitAckLossPool(pool);
    const recovered = await new PostgresDiscoveryModelProfileRepository(injected.pool).updateStatus(
      input,
    );
    expect(recovered).toMatchObject({
      profileId: target.profileId,
      status: 'ACTIVE',
      activatedAt: input.updatedAt,
    });
    expect(await clean.findRevision(projectId, existingActive.profileRevision)).toMatchObject({
      profileId: existingActive.profileId,
      status: 'RETIRED',
      retiredAt: input.updatedAt,
    });
    expect(
      await pool.query<{ profile_id: string }>(
        `SELECT profile_id FROM discovery.model_profiles
         WHERE project_id = $1 AND status = 'ACTIVE'`,
        [projectId],
      ),
    ).toMatchObject({ rows: [{ profile_id: target.profileId }] });
    expectAckLoss(injected.trace);
    await expect(clean.updateStatus(input)).resolves.toBe('CONFLICT');
    recordProof({
      surface: 'Discovery model profile',
      operation: 'updateStatus ACTIVE',
      classification: 'GREEN_RECOVERED',
      observed:
        'COMMIT durable; target ACTIVE, prior ACTIVE retired, exactly one ACTIVE remains, and stale PREPARED retry is CONFLICT',
    });
  });

  it('discovery model profile updateStatus RETIRED: ambiguous commit recovers the target witness', async () => {
    const projectId = `post-tf-risk001b-profile-retired-${randomUUID()}`;
    const profile = makeDiscoveryProfile(projectId, randomUUID());
    const clean = new PostgresDiscoveryModelProfileRepository(pool);
    await expect(clean.saveRevision({ expectedRevision: 0, next: profile })).resolves.toBe(
      'CREATED',
    );
    const input = {
      projectId,
      profileId: profile.profileId,
      profileRevision: profile.profileRevision,
      expectedStatus: 'PREPARED' as const,
      status: 'RETIRED' as const,
      updatedAt: '2026-09-17T08:00:03.000Z',
    };
    const injected = createCommitAckLossPool(pool);
    const recovered = await new PostgresDiscoveryModelProfileRepository(injected.pool).updateStatus(
      input,
    );
    expect(recovered).toMatchObject({
      profileId: profile.profileId,
      status: 'RETIRED',
      retiredAt: input.updatedAt,
    });
    expect(await clean.findRevision(projectId, profile.profileRevision)).toMatchObject({
      profileId: profile.profileId,
      status: 'RETIRED',
      retiredAt: input.updatedAt,
    });
    expectAckLoss(injected.trace);
    await expect(clean.updateStatus(input)).resolves.toBe('CONFLICT');
    recordProof({
      surface: 'Discovery model profile',
      operation: 'updateStatus RETIRED',
      classification: 'GREEN_RECOVERED',
      observed:
        'COMMIT durable; exact RETIRED target readback recovers success; stale retry is CONFLICT',
    });
  });

  it('Sources submission: accepted command replay recovers the committed Product write', async () => {
    const context = await sourceFixture();
    const input = directSubmission(context);
    const clean = new PostgresSourcesIntakeUnitOfWork(pool);
    const injected = createCommitAckLossPool(pool);
    await expect(
      new PostgresSourcesIntakeUnitOfWork(injected.pool).createSubmission(input),
    ).rejects.toThrow('synthetic commit acknowledgement loss');
    expectLegacyAckLoss(injected.trace);
    const replayed = await clean.createSubmission(input);
    expect(replayed).toMatchObject({
      submissionId: input.submissionId,
      projectId: input.projectId,
      replayed: true,
    });
    expect(
      await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM source_product.intake_submissions WHERE project_id = $1',
        [context.projectId],
      ),
    ).toMatchObject({ rows: [{ count: '1' }] });
    recordProof({
      surface: 'Frontend Sources write',
      operation: 'createSubmission',
      classification: 'SAFE_ALREADY',
      observed:
        'COMMIT durable; accepted command identity returns replayed result without a second submission',
    });
  });

  it('Sources Product duplicate decision: exact retry does not repeat the decision effect', async () => {
    const context = await sourceFixture();
    const existingInput = directSubmission(context);
    const existing = await new PostgresSourcesIntakeUnitOfWork(pool).createSubmission(
      existingInput,
    );
    const commandId = randomUUID();
    await insertAcceptedCommand({
      commandId,
      commandType: 'sources.intake.submit.v1',
      principalId: context.principalId,
      projectId: context.projectId,
      payload: { contentHash: existingInput.items[0]!.contentHash },
      now: context.now,
    });
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
      accessRevision: '1',
      policyContextRevision: '1',
      acceptedPolicyContextId: `policy/${context.projectId}`,
      acceptedPolicyBinding: { mode: 'CURRENT', policyContextRevision: '1' },
    };
    const input = {
      submissionId: randomUUID(),
      commandId,
      correlationId: `correlation-${commandId}`,
      draftId: 'risk001b-duplicate-draft',
      scope,
      items: [
        {
          draftId: 'risk001b-duplicate-draft',
          itemId: 'risk001b-duplicate-item',
          projectId: context.projectId,
          principalId: context.principalId,
          kind: 'DIRECT_TEXT' as const,
          label: 'POST-TF duplicate source',
          channel: 'direct_text' as const,
          mediaType: 'text/plain' as const,
          contentHash: existingInput.items[0]!.contentHash,
          sizeBytes: existingInput.items[0]!.sizeBytes,
          storageKey: existingInput.items[0]!.storageKey,
          stagingReference: 'sealed://risk001b-duplicate',
          issuedAt: context.now,
          expiresAt: '2026-09-18T08:00:00.000Z',
        },
      ],
      createdAt: context.now,
    };
    const injected = createCommitAckLossPool(pool);
    await expect(
      new PostgresSourcesProductService(injected.pool, {} as never).submit(input),
    ).rejects.toThrow('synthetic commit acknowledgement loss');
    expectLegacyAckLoss(injected.trace);
    const retried = await new PostgresSourcesProductService(pool, {} as never).submit(input);
    expect(retried).toMatchObject({ state: 'ACTION_REQUIRED' });
    expect(
      await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM source_product.exact_duplicate_decisions
         WHERE project_id = $1`,
        [context.projectId],
      ),
    ).toMatchObject({ rows: [{ count: '1' }] });
    expect(existing.submissionId).not.toBe(input.submissionId);
    recordProof({
      surface: 'Frontend Sources write',
      operation: 'Product submit / duplicate decision',
      classification: 'SAFE_ALREADY',
      observed:
        'COMMIT durable; exact Product submission replay returns ACTION_REQUIRED with one duplicate decision',
    });
  });

  it('Frontend history payload state: same state can be safely replayed', async () => {
    const input = {
      resourceProjectId: `post-tf-risk001b-history-${randomUUID()}`,
      sourceEventKind: 'SETTINGS',
      sourceEventId: `event-${randomUUID()}`,
      actorId: `post-tf-risk001b-actor-${randomUUID()}`,
      payloadAvailability: 'REDACTED' as const,
      tombstoneMetadata: { proof: 'risk001b' },
      changedAt: '2026-09-17T08:00:00.000Z',
      reason: 'POST-TF RISK-001B proof',
      policyRevision: '1',
    };
    const injected = createCommitAckLossPool(pool);
    await expect(
      new PostgresPayloadStateStore(injected.pool, 'SETTINGS').setPayloadState(input),
    ).rejects.toThrow('synthetic commit acknowledgement loss');
    expectLegacyAckLoss(injected.trace);
    expect(
      await new PostgresPayloadStateStore(pool, 'SETTINGS').getPayloadState(
        input.resourceProjectId,
        input.sourceEventKind,
        input.sourceEventId,
      ),
    ).toMatchObject({ payloadAvailability: 'REDACTED' });
    await expect(
      new PostgresPayloadStateStore(pool, 'SETTINGS').setPayloadState(input),
    ).resolves.toMatchObject({
      payloadAvailability: 'REDACTED',
    });
    recordProof({
      surface: 'Frontend History',
      operation: 'setPayloadState',
      classification: 'SAFE_ALREADY',
      observed: 'COMMIT durable; exact state replay converges to the same sidecar row',
    });
  });

  it('Frontend Activity index: same snapshot can be safely replayed', async () => {
    const projectId = `post-tf-risk001b-activity-${randomUUID()}`;
    const record = activityRecord(projectId);
    const injected = createCommitAckLossPool(pool);
    await expect(new PostgresActivityIndexStore(injected.pool).upsert(record)).rejects.toThrow(
      'synthetic commit acknowledgement loss',
    );
    expectLegacyAckLoss(injected.trace);
    const clean = new PostgresActivityIndexStore(pool);
    await expect(
      clean.findByIdentity({
        resourceProjectId: projectId,
        domainKind: record.domainKind,
        activityId: record.activityId,
      }),
    ).resolves.toEqual(record);
    await expect(clean.upsert(record)).resolves.toBeUndefined();
    recordProof({
      surface: 'Frontend Activity',
      operation: 'activity_index.upsert',
      classification: 'SAFE_ALREADY',
      observed: 'COMMIT durable; same identity and snapshot revision replay without duplicate row',
    });
  });

  it('Auth bootstrapOwner: durable owner creation is a stale conflict on exact retry', async () => {
    const projectId = `post-tf-risk001b-auth-project-${randomUUID()}`;
    const accountId = `post-tf-risk001b-account-${randomUUID()}`;
    await ensureProject(projectId);
    const input = {
      accountId,
      projectId,
      scopes: ['owner'] as const,
      sensitivityClearance: 'private' as const,
      passwordHash: await hashPassword('post-tf-risk001b-password'),
    };
    const injected = createCommitAckLossPool(pool);
    await expect(
      new PostgresAuthRepository(injected.pool).bootstrapOwner(input),
    ).resolves.toBeUndefined();
    expectAckLoss(injected.trace);
    expect(
      await new PostgresAuthRepository(pool).findOwnerMembership(accountId, projectId),
    ).toBeDefined();
    const credentialWitness = await pool.query<{
      credential_id: string;
      principal_id: string;
      account_id: string;
      credential_type: string;
      password_hash: string;
      project_id: string;
      is_owner: boolean;
    }>(
      `SELECT c.credential_id::text, c.principal_id::text, c.account_id,
              c.credential_type, c.password_hash, m.project_id, m.is_owner
       FROM auth.credentials c
       JOIN auth.project_memberships m ON m.principal_id = c.principal_id
       WHERE c.account_id = $1 AND m.project_id = $2`,
      [accountId.toLowerCase(), projectId],
    );
    const credentialRow = credentialWitness.rows[0];
    expect(credentialRow).toMatchObject({
      principal_id: expect.any(String),
      account_id: accountId.toLowerCase(),
      credential_type: 'local_password',
      password_hash: input.passwordHash,
      project_id: projectId,
      is_owner: true,
    });
    expect(credentialRow?.credential_id).toEqual(expect.any(String));
    expect(
      await pool.query(
        `SELECT credential_id::text, principal_id::text, account_id,
                credential_type, password_hash
         FROM auth.credentials
         WHERE credential_id = $1`,
        [credentialRow?.credential_id],
      ),
    ).toMatchObject({
      rows: [
        {
          credential_id: credentialRow?.credential_id,
          principal_id: credentialRow?.principal_id,
          account_id: accountId.toLowerCase(),
          credential_type: 'local_password',
          password_hash: input.passwordHash,
        },
      ],
    });
    await expect(new PostgresAuthRepository(pool).bootstrapOwner(input)).rejects.toThrow(
      /active Owner already exists|already in use/,
    );
    recordProof({
      surface: 'Authentication',
      operation: 'bootstrapOwner',
      classification: 'GREEN_RECOVERED',
      observed:
        'COMMIT durable; principal, credential, and owner-membership witnesses recover the ambiguous call; ordinary retry remains rejected',
    });
  });

  it('Auth local-owner bootstrap: existing principal is safely returned on exact retry', async () => {
    const accountId = `post-tf-risk001b-local-${randomUUID()}`;
    const input = { accountId };
    const injected = createCommitAckLossPool(pool);
    await expect(
      new PostgresAuthRepository(injected.pool).bootstrapLocalOwnerPrincipal(input),
    ).rejects.toThrow('synthetic commit acknowledgement loss');
    expectLegacyAckLoss(injected.trace);
    const clean = new PostgresAuthRepository(pool);
    const durable = await clean.findPrincipalByAccountId(accountId);
    expect(durable).toBeDefined();
    const replayed = await clean.bootstrapLocalOwnerPrincipal(input);
    expect(replayed).toMatchObject({ principalId: durable!.principalId, status: 'active' });
    recordProof({
      surface: 'Authentication',
      operation: 'bootstrapLocalOwnerPrincipal',
      classification: 'SAFE_ALREADY',
      observed: 'COMMIT durable; exact retry resolves the existing principal without duplication',
    });
  });

  it('records proof-only exclusions for read-only and already-covered paths', () => {
    expect(inventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ disposition: 'NOT_APPLICABLE_READ_ONLY' }),
        expect.objectContaining({ disposition: 'EXCLUDED_ALREADY_SAFE_OR_CORRECTED' }),
      ]),
    );
  });
});
