import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Socket } from 'node:net';
import { expect, it, vi } from 'vitest';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresVPRelationJobs } from '../../adapters/vp-knowledge-postgres/src/relation-jobs.js';
import { PostgresVPAskEvidenceSearch } from '../../adapters/vp-knowledge-postgres/src/ask-evidence-search.js';
import { DeepSeekConnectivityAdapter } from '../../adapters/ai-provider-deepseek/src/index.js';
import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import {
  CredentialVaultService,
  EnvironmentCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import { startShotgunApplication } from '../../assemblies/shotgun-app/src/application.js';
import * as policyRefresh from '../../assemblies/shotgun-app/src/vp-candidate-policy-refresh.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import { seedAssertion } from '../helpers/vp05-p0-fixtures.js';

// A regression run must never overwrite the accepted historical worker trace.
const outputRoot = path.join(
  process.env.VP05_P0_TRACE_OUTPUT ?? path.join(os.tmpdir(), 'shotgun-vp05-runtime'),
  randomUUID(),
);
const revision = 'vp-deepseek-relation-v6-evidence-context';
const validDecision = {
  choice: 'CONTRADICTS',
  direction: 'NONE',
  confidence: 0.99,
  deepAnalysisScore: 0,
  probabilities: {
    EQUIVALENT: 0.002,
    SUPPORTS: 0.002,
    QUALIFIES: 0.002,
    CONTRADICTS: 0.99,
    RELATED: 0.002,
    UNRESOLVED: 0.002,
  },
};

it.each([
  'AUTHORIZED',
  'MISSING_AUTHORITY',
  'CREDENTIAL_MISMATCH',
  'UNAVAILABLE_AUTHORITY',
] as const)(
  'observes the actual v6 app worker: %s',
  async (scenario) => {
    const db = await createIsolatedPostgresTestDatabase();
    const pool = db.createPool();
    const authorityDb = await createIsolatedPostgresTestDatabase();
    const authorityPool = authorityDb.createPool();
    const storeId = randomUUID();
    const authorityId = randomUUID();
    const assetRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-vp05-audit-'));
    let app: Awaited<ReturnType<typeof startShotgunApplication>> | undefined;
    const calls: { model: string; promptSha256: string; systemInstructionSha256: string }[] = [];
    let blockedNetworkRequests = 0;
    const heldSockets: Socket[] = [];
    const blackhole = createServer((socket) => heldSockets.push(socket));
    try {
      const projectId = `vp05-audit-${randomUUID()}`;
      const principal = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
        accountId: `vp05-audit-${randomUUID()}`,
      });
      await new PostgresProjectAdministrationRepository(pool).createProject({
        commandId: randomUUID(),
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        projectId,
        name: 'Synthetic isolated VP05 audit',
        description: 'Fake provider only',
        actorPrincipalId: principal.principalId,
        expectedProjectRevision: 0,
      });
      await seedAssertion(pool, {
        projectId,
        principalId: principal.principalId,
        assertionId: randomUUID(),
        text: 'The quasar archive has exactly 42 records.',
        assetRoot,
      });
      await seedAssertion(pool, {
        projectId,
        principalId: principal.principalId,
        assertionId: randomUUID(),
        text: 'The archive has exactly 43 records.',
        assetRoot,
      });
      const search = new PostgresVPAskEvidenceSearch(pool);
      await new PostgresVPRelationJobs(pool).enqueueCurrentPairs(revision);
      const pendingBefore = (
        await pool.query(
          "SELECT count(*)::int AS count FROM vp.relation_jobs WHERE project_id=$1 AND status='PENDING'",
          [projectId],
        )
      ).rows[0]?.count;
      expect(pendingBefore).toBe(1);
      if (scenario === 'AUTHORIZED') {
        await new PostgresVPRelationJobs(pool).enqueueCurrentPairs(
          'vp-deepseek-relation-v11-contractual-protocol-and-physical-generalization',
          1,
        );
      }
      const query = {
        projectId,
        question: 'quasar',
        accessScope: ['owner'],
        authorizedSensitivities: ['public'] as const,
        limit: 12,
      };
      const before = await search.search(query);
      expect(before.evidenceIds).toHaveLength(1);

      vi.stubEnv('SHOTGUN_CREDENTIAL_MASTER_KEY', randomBytes(32).toString('base64url'));
      vi.stubEnv('SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION', 'vp05-audit');
      for (const key of [
        'VP_GLOBAL_RELATION_BUDGET_DATABASE_URL',
        'VP_GLOBAL_RELATION_BUDGET_STORE_ID',
        'VP_GLOBAL_RELATION_BUDGET_AUTHORITY_ID',
        'VP_GLOBAL_RELATION_BUDGET_ACCOUNT_FINGERPRINT',
      ])
        vi.stubEnv(key, undefined);
      const fingerprint = createHash('sha256')
        .update('synthetic-not-a-live-provider-key')
        .digest('hex');
      await authorityPool.query(
        'INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)',
        [storeId],
      );
      await authorityPool.query(
        `INSERT INTO vp_global_budget.policies(authority_id,provider,account_fingerprint,workload_class,budget_timezone,daily_limit) VALUES($1,'deepseek',$2,'VP_RELATION','UTC',100)`,
        [authorityId, fingerprint],
      );
      if (scenario !== 'MISSING_AUTHORITY') {
        vi.stubEnv('VP_GLOBAL_RELATION_BUDGET_DATABASE_URL', authorityDb.databaseUrl);
        vi.stubEnv('VP_GLOBAL_RELATION_BUDGET_STORE_ID', storeId);
        vi.stubEnv('VP_GLOBAL_RELATION_BUDGET_AUTHORITY_ID', authorityId);
        vi.stubEnv('VP_GLOBAL_RELATION_BUDGET_ACCOUNT_FINGERPRINT', fingerprint);
      }
      if (scenario === 'UNAVAILABLE_AUTHORITY') {
        await new Promise<void>((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
        const address = blackhole.address();
        if (!address || typeof address === 'string') throw new Error('Missing isolated TCP port');
        vi.stubEnv(
          'VP_GLOBAL_RELATION_BUDGET_DATABASE_URL',
          `postgres://shotgun:shotgun@127.0.0.1:${address.port}/${authorityDb.databaseName}`,
        );
      }
      const credential = await new CredentialVaultService(
        new PostgresCredentialVaultRepository(pool),
        new EnvironmentCredentialMasterKeyAuthority(),
      ).create({
        projectId,
        providerId: 'deepseek',
        secret:
          scenario === 'CREDENTIAL_MISMATCH'
            ? 'different-synthetic-key'
            : 'synthetic-not-a-live-provider-key',
      });
      const now = new Date().toISOString();
      for (const table of ['ai.project_ai_configuration_revisions', 'ai.project_ai_configurations'])
        await pool.query(
          `INSERT INTO ${table} (project_id,active_provider_id,active_model_id,credential_id,credential_revision,ai_configuration_revision,updated_by,updated_at)
       VALUES ($1,'deepseek','deepseek-flash',$2,1,1,$3,$4)`,
          [projectId, credential.credentialId, principal.principalId, now],
        );
      for (const [table, key] of [
        ['ai.project_standing_ai_processing_policy_revisions', 'project_id,policy_revision'],
        ['ai.project_standing_ai_processing_policies', 'project_id'],
      ])
        await pool.query(
          `INSERT INTO ${table} (project_id,enabled,provider_id,policy_revision,ai_configuration_revision,changed_by,changed_at)
       VALUES ($1,true,'deepseek',2,1,$2,$3) ON CONFLICT (${key}) DO UPDATE SET enabled=true,provider_id='deepseek',policy_revision=2,ai_configuration_revision=1,changed_by=EXCLUDED.changed_by,changed_at=EXCLUDED.changed_at`,
          [projectId, principal.principalId, now],
        );
      for (const [table, key] of [
        [
          'settings.provider_external_transfer_approval_revisions',
          'project_id,provider_id,approval_revision',
        ],
        ['settings.provider_external_transfer_approvals', 'project_id,provider_id'],
      ])
        await pool.query(
          `INSERT INTO ${table} (project_id,provider_id,approved,approval_revision,reviewed_by,reviewed_at)
       VALUES ($1,'deepseek',true,1,$2,$3) ON CONFLICT (${key}) DO UPDATE SET approved=true`,
          [projectId, principal.principalId, now],
        );
      // Directly seeded fixtures have no production extraction provenance. Suspend
      // that independent refresh worker; relation selection/execution is unmodified.
      vi.spyOn(policyRefresh, 'startVPCandidatePolicyRefreshWorker').mockResolvedValue(
        async () => {},
      );
      vi.stubGlobal('fetch', async () => {
        blockedNetworkRequests++;
        throw new Error('Audit denies all live HTTP egress');
      });
      vi.spyOn(DeepSeekConnectivityAdapter.prototype, 'generateStructured').mockImplementation(
        async ({ modelId, apiKey, request }) => {
          expect(Buffer.from(apiKey).toString()).toBe('synthetic-not-a-live-provider-key');
          calls.push({
            model: modelId,
            promptSha256: createHash('sha256').update(request.prompt).digest('hex'),
            systemInstructionSha256: createHash('sha256')
              .update(request.systemInstruction)
              .digest('hex'),
          });
          return {
            rawText: JSON.stringify(validDecision),
            providerResponseId: 'vp05-audit-fake-response',
            modelVersion: 'audit-fake-not-deepseek-inference',
            inputTokens: 20,
            outputTokens: 10,
          };
        },
      );
      app = await startShotgunApplication({
        databaseUrl: db.databaseUrl,
        environmentProfile: 'runtime-test',
        assetRoot,
        stagingSecret: 'synthetic-audit-staging-secret-not-production',
        host: '127.0.0.1',
        port: 0,
        noSignals: true,
        disableAskWorker: true,
        recoveryIntervalMs: false,
        actionFeedbackOutboxIntervalMs: false,
        aiDurableMaterializationRecoveryEnabled: false,
      });
      if (scenario !== 'AUTHORIZED') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(calls).toHaveLength(0);
        const jobs = (
          await pool.query(
            'SELECT status,attempt_count FROM vp.relation_jobs WHERE project_id=$1',
            [projectId],
          )
        ).rows;
        expect(jobs).toEqual([
          {
            status: scenario === 'CREDENTIAL_MISMATCH' ? 'RETRYABLE' : 'PENDING',
            attempt_count: 0,
          },
        ]);
        expect(
          (await authorityPool.query('SELECT count(*)::int AS n FROM vp_global_budget.claims'))
            .rows[0].n,
        ).toBe(0);
        expect(
          (await pool.query('SELECT count(*)::int AS n FROM vp.relation_provider_calls')).rows[0].n,
        ).toBe(0);
        expect((await app.server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
        expect((await search.search(query)).evidenceIds).toHaveLength(1);
        return;
      }
      let rows: Record<string, unknown>[] = [];
      for (let i = 0; i < 100; i++) {
        rows = (
          await pool.query(
            `SELECT job.policy_revision,job.job_id::text,job.attempt_count,call.call_id::text,call.request_digest,call.provider_identity,call.global_claim_id::text,call.semantic_attempt_id::text,decision.decision_id::text
        FROM vp.relation_jobs job JOIN vp.relation_provider_calls call USING(project_id,job_id)
        JOIN vp.decision_receipts decision ON decision.project_id=job.project_id AND decision.left_assertion_id=job.left_assertion_id AND decision.right_assertion_id=job.right_assertion_id AND decision.policy_revision=job.policy_revision
        WHERE job.project_id=$1 AND job.status='COMPLETED'`,
            [projectId],
          )
        ).rows;
        if (rows.length) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(rows).toHaveLength(1);
      expect(rows[0]?.policy_revision).toBe(revision);
      expect(calls[0]?.systemInstructionSha256).toBe(
        'e84485451ff0aefe441cb30ee778df21fb2a4d666e4ef06c412230a262a013dd',
      );
      expect(
        (
          await pool.query(
            'SELECT status,attempt_count FROM vp.relation_jobs WHERE project_id=$1 AND policy_revision=$2',
            [
              projectId,
              'vp-deepseek-relation-v11-contractual-protocol-and-physical-generalization',
            ],
          )
        ).rows,
      ).toEqual([{ status: 'PENDING', attempt_count: 0 }]);
      expect(calls).toHaveLength(1);
      expect(blockedNetworkRequests).toBe(0);
      const after = await search.search(query);
      expect(after.evidenceIds).toHaveLength(2);
      expect(
        await search.isSnapshotCurrent({
          ...query,
          snapshot: before,
          evidenceIds: before.evidenceIds,
        }),
      ).toBe(false);
      const columns = (
        await pool.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema='vp' AND table_name='relation_provider_calls'`,
        )
      ).rows.map((r: { column_name: string }) => r.column_name);
      expect(columns).toContain('global_claim_id');
      expect(columns).toContain('semantic_attempt_id');
      const global = (
        await authorityPool.query(
          `SELECT claim_id::text,authority_id::text,relation_job_id::text,semantic_attempt_id::text,execution_key,provider_identity,provider_request_id,state FROM vp_global_budget.claims`,
        )
      ).rows;
      expect(global).toHaveLength(1);
      expect(global[0]).toMatchObject({
        claim_id: rows[0]?.global_claim_id,
        authority_id: authorityId,
        relation_job_id: rows[0]?.job_id,
        semantic_attempt_id: rows[0]?.semantic_attempt_id,
        provider_identity: 'deepseek/deepseek-flash',
        provider_request_id: 'vp05-audit-fake-response',
        state: 'PROVIDER_SUCCEEDED',
      });
      expect(rows[0]?.attempt_count).toBe(1);
      await mkdir(outputRoot, { recursive: true });
      await writeFile(
        path.join(outputRoot, 'main-worker-trace.json'),
        JSON.stringify(
          {
            authority: 'ISOLATED_FAKE_DIAGNOSTIC_NOT_MODEL_QUALITY_OR_PRODUCT_ACCEPTANCE',
            canonicalMain: '083e779ec64e3216df78eb327a5ba73b3996a21c',
            databaseName: db.databaseName,
            projectId,
            trace: rows[0],
            fakeCalls: calls,
            blockedNetworkRequests,
            liveProviderCalls: 0,
            globalAuthorityConfiguration: 'ISOLATED_TEST_STORE',
            authorityDatabaseName: authorityDb.databaseName,
            storeId,
            authorityId,
            credentialFingerprint: fingerprint,
            global,
            globalClaimColumn: true,
            semanticAttemptIdentityColumn: true,
            evidenceBefore: before.evidenceIds,
            pendingRelationJobsBeforeSearch: pendingBefore,
            evidenceAfter: after.evidenceIds,
            relevantOldSnapshotRejected: true,
            fixtureScope:
              'Source assertions seeded; extraction refresh suspended; Ask worker disabled; normal app relation worker unchanged',
            cleanup:
              'Isolated database disposed in finally; synthetic asset files retained only in temporary audit root',
          },
          null,
          2,
        ) + '\n',
      );
    } finally {
      await app?.close();
      for (const socket of heldSockets) socket.destroy();
      if (blackhole.listening)
        await new Promise<void>((resolve) => blackhole.close(() => resolve()));
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await Promise.all([db.dispose(), authorityDb.dispose()]);
    }
  },
  120000,
);
