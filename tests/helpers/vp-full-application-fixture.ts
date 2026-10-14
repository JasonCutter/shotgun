import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, vi } from 'vitest';
import { DeepSeekConnectivityAdapter } from '../../adapters/ai-provider-deepseek/src/index.js';
import { FakeAIProviderAdapter } from '../../adapters/ai-provider-fake/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { PostgresProjectAdministrationRepository } from '../../adapters/postgres/src/index.js';
import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import { PostgresProjectAIConfigurationRepository } from '../../adapters/ai-configuration-postgres/src/index.js';
import { PostgresStandingAIProcessingPolicyRepository } from '../../adapters/project-standing-ai-policy-postgres/src/index.js';
import {
  CredentialVaultService,
  EnvironmentCredentialMasterKeyAuthority,
} from '../../modules/credential-vault/src/index.js';
import {
  ProjectAIConfigurationService,
  initialProviderRegistry,
} from '../../modules/ai-configuration/src/index.js';
import { StandingAIProcessingPolicyService } from '../../packages/policy/src/index.js';
import type { AskAnswerRunSnapshot } from '../../packages/contracts/src/index.js';
import { startShotgunApplication } from '../../assemblies/shotgun-app/src/application.js';
import { createIsolatedPostgresTestDatabase } from './isolated-postgres-test-database.js';

export const waitForProduct = async <T>(
  read: () => Promise<T | undefined>,
  label: string,
  deadlineMilliseconds = 45_000,
): Promise<T> => {
  const deadline = Date.now() + deadlineMilliseconds;
  do {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Isolated product timeout: ${label}`);
};

export const answerCitations = (run: AskAnswerRunSnapshot) =>
  run.statements.flatMap((s) => s.citations);

export const createVPFullApplicationFixture = async (
  options: {
    sourceRefresh?: boolean;
    imageObservationFakeHttp?: NonNullable<
      Parameters<typeof startShotgunApplication>[0]
    >['imageObservationFakeHttp'];
    answerFake?: (
      request: Parameters<FakeAIProviderAdapter['generateStructured']>[0],
    ) => Promise<Awaited<ReturnType<FakeAIProviderAdapter['generateStructured']>>>;
  } = {},
) => {
  for (const name of ['.env', '.env.test']) {
    if (existsSync(path.join(process.cwd(), name))) {
      throw new Error(
        'Actual application regression requires an isolated worktree without env files.',
      );
    }
  }
  const db = await createIsolatedPostgresTestDatabase();
  const authorityDb = await createIsolatedPostgresTestDatabase().catch(async (error: unknown) => {
    await db.dispose();
    throw error;
  });
  const pool = db.createPool();
  const authority = authorityDb.createPool();
  const assetRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-vp-full-app-'));
  const master = randomBytes(32);
  const key = 'FAKE-VP-FULL-PROVIDER-KEY-NOT-A-LIVE-CREDENTIAL';
  const projectId = 'shotgun';
  const storeId = randomUUID(),
    authorityId = randomUUID();
  let app: Awaited<ReturnType<typeof startShotgunApplication>> | undefined;
  let cookie = '',
    csrf = '',
    networkAttempts = 0;
  const fake = new FakeAIProviderAdapter();
  const calls: { kind: 'relation' | 'answer' | 'extraction'; digest: string }[] = [];
  let answerGate: { entered: () => void; release: Promise<void> } | undefined;
  const fingerprint = createHash('sha256').update(key).digest('hex');
  const adapterSpy = vi.spyOn(DeepSeekConnectivityAdapter.prototype, 'generateStructured');
  const cleanup = async () => {
    // Close all owned workers while the fake transport and synthetic authority
    // remain installed; then restore mocks/environment, finally drop test DBs.
    try {
      await app?.close();
    } finally {
      adapterSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      master.fill(0);
      await Promise.allSettled([db.dispose(), authorityDb.dispose()]).then((results) => {
        const errors = results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map((r) => r.reason);
        if (errors.length) throw new AggregateError(errors, 'Isolated application cleanup failed.');
      });
      await rm(assetRoot, { recursive: true, force: true });
    }
  };
  try {
    for (const name of ['DATABASE_URL', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'])
      vi.stubEnv(name, undefined);
    vi.stubEnv('SHOTGUN_CREDENTIAL_MASTER_KEY', master.toString('base64url'));
    vi.stubEnv('SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION', 'vp-full-test-only');
    vi.stubEnv('SHOTGUN_RUNTIME_OWNER_ACCOUNT_ID', 'local-owner');
    vi.stubEnv('VP_GLOBAL_RELATION_BUDGET_DATABASE_URL', authorityDb.databaseUrl);
    vi.stubEnv('VP_GLOBAL_RELATION_BUDGET_STORE_ID', storeId);
    vi.stubEnv('VP_GLOBAL_RELATION_BUDGET_AUTHORITY_ID', authorityId);
    vi.stubEnv('VP_GLOBAL_RELATION_BUDGET_ACCOUNT_FINGERPRINT', fingerprint);
    vi.stubEnv('AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS', 'deepseek');
    vi.stubGlobal('fetch', async () => {
      networkAttempts++;
      throw new Error('All live HTTP is denied in VP product regression.');
    });
    adapterSpy.mockImplementation(async ({ apiKey, request }) => {
      expect(createHash('sha256').update(Buffer.from(apiKey)).digest('hex')).toBe(fingerprint);
      const prompt = JSON.parse(request.prompt) as {
        left?: { claim: string };
        right?: { claim: string };
        task?: string;
      };
      const kind = prompt.left
        ? 'relation'
        : prompt.task?.startsWith('shotgun-ask')
          ? 'answer'
          : 'extraction';
      calls.push({ kind, digest: createHash('sha256').update(request.prompt).digest('hex') });
      if (kind === 'answer' && answerGate) {
        const held = answerGate;
        answerGate = undefined;
        held.entered();
        await held.release;
      }
      if (kind === 'relation') {
        const choice = prompt.left!.claim === prompt.right!.claim ? 'EQUIVALENT' : 'RELATED';
        const choices = [
          'EQUIVALENT',
          'SUPPORTS',
          'QUALIFIES',
          'CONTRADICTS',
          'RELATED',
          'UNRESOLVED',
        ];
        return {
          rawText: JSON.stringify({
            choice,
            direction: 'NONE',
            confidence: 0.99,
            probabilities: Object.fromEntries(choices.map((c) => [c, c === choice ? 0.99 : 0.002])),
          }),
          providerResponseId: `fake-vp-relation-${calls.length}`,
          modelVersion: 'fake-no-semantic-certification',
          inputTokens: 10,
          outputTokens: 10,
        };
      }
      if (kind === 'answer' && options.answerFake) return options.answerFake(request);
      return {
        ...(await fake.generateStructured(request)),
        providerResponseId: `fake-vp-${kind}-${calls.length}`,
      };
    });
    await authority.query('INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)', [
      storeId,
    ]);
    await authority.query(
      "INSERT INTO vp_global_budget.policies(authority_id,provider,account_fingerprint,workload_class,budget_timezone,daily_limit) VALUES($1,'deepseek',$2,'VP_RELATION','UTC',100)",
      [authorityId, fingerprint],
    );
    const owner = await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
      accountId: 'local-owner',
    });
    await new PostgresProjectAdministrationRepository(pool).createProject({
      commandId: randomUUID(),
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectId,
      name: 'Isolated full product regression',
      actorPrincipalId: owner.principalId,
      expectedProjectRevision: 0,
    });
    const vault = new CredentialVaultService(
      new PostgresCredentialVaultRepository(pool),
      new EnvironmentCredentialMasterKeyAuthority(),
    );
    const credential = await vault.create({
      projectId,
      providerId: 'deepseek',
      secret: key,
      clientRequestId: randomUUID(),
    });
    await new ProjectAIConfigurationService(
      initialProviderRegistry(),
      new PostgresProjectAIConfigurationRepository(pool),
      vault,
      undefined,
      { enforceDeepSeekOnly: true },
    ).save({
      projectId,
      expectedRevision: 0,
      activeProviderId: 'deepseek',
      activeModelId: 'deepseek-flash',
      credentialId: credential.credentialId,
      credentialRevision: 1,
      updatedBy: owner.principalId,
    });
    const standing = new StandingAIProcessingPolicyService(
      new PostgresStandingAIProcessingPolicyRepository(pool),
      { enforceDeepSeekOnly: true },
    );
    const policy = await standing.getCurrent(projectId);
    await standing.save({
      projectId,
      expectedRevision: policy?.policyRevision ?? 0,
      enabled: true,
      providerId: 'deepseek',
      aiConfigurationRevision: 1,
      changedBy: owner.principalId,
    });
    for (const table of [
      'settings.provider_external_transfer_approval_revisions',
      'settings.provider_external_transfer_approvals',
    ])
      await pool.query(
        `INSERT INTO ${table}(project_id,provider_id,approved,approval_revision,reviewed_by,reviewed_at) VALUES($1,'deepseek',true,1,$2,clock_timestamp())`,
        [projectId, owner.principalId],
      );
    app = await startShotgunApplication({
      databaseUrl: db.databaseUrl,
      environmentProfile: 'runtime-test',
      assetRoot,
      stagingSecret: 'SYNTHETIC-VP-FULL-STAGING-SECRET-32',
      host: '127.0.0.1',
      port: 0,
      noSignals: true,
      disableAskWorker: false,
      sourceRefreshIntervalMs: options.sourceRefresh ? 1000 : false,
      recoveryIntervalMs: false,
      actionFeedbackOutboxIntervalMs: false,
      aiDurableMaterializationRecoveryEnabled: false,
      ...(options.imageObservationFakeHttp
        ? { imageObservationFakeHttp: options.imageObservationFakeHttp }
        : {}),
    });
    await app.listen();
    expect(app.askWorkerStarted).toBe(true);
    const bootstrap = await app.server.inject({
      method: 'POST',
      url: '/api/v1/session/local-bootstrap',
      headers: { host: '127.0.0.1' },
      payload: {},
    });
    expect(bootstrap.statusCode).toBeLessThan(300);
    const setCookie = bootstrap.headers['set-cookie'];
    cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]!;
    const request = async <T>(
      method: 'GET' | 'POST',
      url: string,
      payload?: Record<string, unknown> | Buffer,
    ): Promise<T> => {
      const result = await app!.server.inject({
        method,
        url,
        headers: {
          host: '127.0.0.1',
          cookie,
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          'content-type': Buffer.isBuffer(payload)
            ? 'application/octet-stream'
            : 'application/json',
        },
        ...(payload === undefined ? {} : { payload }),
      });
      expect(result.statusCode, `${method} ${url}: ${result.body}`).toBeLessThan(300);
      return result.json<T>();
    };
    csrf = (await request<{ csrfToken: string }>('GET', '/api/v1/security/csrf')).csrfToken;
    await request('POST', '/api/v1/session/active-project', { projectId });
    csrf = (await request<{ csrfToken: string }>('GET', '/api/v1/security/csrf')).csrfToken;
    const command = (payload: Record<string, unknown>) => ({
      envelopeVersion: '1.0.0',
      commandType: 'sources.intake.submit.v1',
      commandSchemaVersion: '1.0.0',
      clientRequestId: randomUUID(),
      idempotencyKey: randomUUID(),
      projectContext: {
        activeProjectId: projectId,
        targetProjectId: projectId,
        resourceProjectId: projectId,
      },
      policyBinding: { mode: 'CURRENT' },
      preconditions: [],
      clientIssuedAt: new Date().toISOString(),
      payload,
    });
    const submitStaged = async (draftId: string, inputs: readonly Record<string, unknown>[]) => {
      const accepted = await request<{ submission: { submissionId: string } }>(
        'POST',
        '/product-api/frontend/sources/submissions',
        command({ draftId, duplicateHandling: 'AUTOMATIC', inputs }),
      );
      const submissionId = accepted.submission.submissionId;
      await waitForProduct(async () => {
        const result = await request<{ submission: { state: string } }>(
          'GET',
          `/product-api/frontend/sources/submissions/${submissionId}`,
        );
        if (
          ['FAILED', 'PARTIAL', 'ACTION_REQUIRED', 'OUTCOME_INDETERMINATE'].includes(
            result.submission.state,
          )
        )
          throw new Error(`Source processing did not succeed: ${result.submission.state}`);
        return result.submission.state === 'SUCCEEDED' ? true : undefined;
      }, 'source intake');
      const result = await pool.query<{ sourceId: string; sourceVersionId: string }>(
        'SELECT produced_source_id::text AS "sourceId", produced_source_version_id::text AS "sourceVersionId" FROM source_product.intake_submission_items WHERE project_id=$1 AND submission_id=$2 ORDER BY ordinal',
        [projectId, submissionId],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.sourceVersionId).toBeTruthy();
      return { ...result.rows[0]!, submissionId };
    };
    const submit = async (text: string, label: string, sourceId?: string) => {
      const draftId = randomUUID(),
        itemId = randomUUID();
      const query = new URLSearchParams({
        draftId,
        itemId,
        kind: 'FILE',
        label,
        fileName: label,
        mediaType: 'text/plain',
      });
      const staged = await request<{ receipt: { stagingReference: string } }>(
        'POST',
        `/product-api/frontend/sources/staging/bytes?${query}`,
        Buffer.from(text),
      );
      return submitStaged(draftId, [
        {
          itemId,
          kind: 'FILE',
          label,
          fileName: label,
          mediaType: 'text/plain',
          stagingReference: staged.receipt.stagingReference,
          ...(sourceId ? { requestedSourceId: sourceId } : {}),
        },
      ]);
    };
    const getAnswer = async (id: string) =>
      (
        await request<{ answerRun: AskAnswerRunSnapshot }>(
          'GET',
          `/product-api/frontend/ask/answer-runs/${id}`,
        )
      ).answerRun;
    const startAsk = async (question: string) =>
      (
        await request<{ submission: { answerRun: AskAnswerRunSnapshot } }>(
          'POST',
          '/product-api/frontend/ask/questions',
          {
            schemaVersion: '1.0.0',
            clientRequestId: randomUUID(),
            idempotencyKey: randomUUID(),
            question,
            mode: 'AUTO_PROJECT_KNOWLEDGE',
            sourceSelections: [],
          },
        )
      ).submission.answerRun.answerRunId;
    const waitAnswer = (id: string) =>
      waitForProduct(async () => {
        const run = await getAnswer(id);
        if (['FAILED', 'OUTCOME_UNKNOWN', 'ACTION_REQUIRED', 'CANCELLED'].includes(run.state))
          throw new Error(`Answer did not succeed: ${run.state}/${run.failure?.code}`);
        return run.state === 'SUCCEEDED' ? run : undefined;
      }, 'same AnswerRun');
    return {
      pool,
      authority,
      app,
      projectId,
      storeId,
      authorityId,
      calls,
      request,
      requestRaw: async (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
        app!.server.inject({
          method,
          url,
          headers: {
            host: '127.0.0.1',
            cookie,
            ...(csrf ? { 'x-csrf-token': csrf } : {}),
            'content-type': 'application/json',
          },
          ...(payload === undefined ? {} : { payload }),
        }),
      requestOriginalImage: async (sourceId: string, sourceVersionId: string) =>
        app!.server.inject({
          method: 'GET',
          url: `/product-api/frontend/sources/${sourceId}/versions/${sourceVersionId}/image-original`,
          headers: { host: '127.0.0.1', cookie },
        }),
      command,
      submitStaged,
      submit,
      getAnswer,
      startAsk,
      waitAnswer,
      ask: async (question: string) => waitAnswer(await startAsk(question)),
      holdNextAnswer: () => {
        let observed = false;
        let entered!: () => void, release!: () => void;
        const seen = new Promise<void>((resolve) => {
          entered = () => {
            observed = true;
            resolve();
          };
        });
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        answerGate = { entered, release: held };
        return { entered: seen, isEntered: () => observed, release };
      },
      assertNoLiveEgress: () => {
        expect(networkAttempts).toBe(0);
        expect(process.env.DEEPSEEK_API_KEY).toBeUndefined();
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
};
