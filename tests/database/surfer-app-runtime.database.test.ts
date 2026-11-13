import { PostgresSurferMeaningQueue } from '../../adapters/surfer-ask-memory-postgres/src/meaning-queue.js';
import {
  SurferDeepSeekContextBound,
  readSurferDeepSeekMetadata,
} from '../../adapters/ai-provider-deepseek/src/surfer-budget.js';
import { providerFixture } from '../helpers/surfer-provider-contracts.js';
import { PostgresSurferExecutionStore } from '../../adapters/surfer-execution-postgres/src/index.js';
import { SurferExecutionLedger } from '../../modules/surfer-execution/src/index.js';
import { unicodeLength } from '../../packages/contracts/src/document-evidence.js';
import type { SurferMeaningApplicationOptions } from '../../assemblies/shotgun-app/src/surfer-meaning-runtime.js';
import {
  meaningOrigin,
  meaningWitness,
  meaningReviewWire,
  meaningReviewWireV2,
} from '../helpers/surfer-meaning-verifier-fixture.js';
import {
  SURFER_MEANING_VERIFIER_REVISION,
  SURFER_MEANING_VERIFIER_REVISION_V2,
  SURFER_MEANING_VERIFIER_REVISION_V3,
  SURFER_MEANING_VERIFIER_REVISION_V4,
  SURFER_MEANING_VERIFIER_REVISION_V5,
  SURFER_MEANING_VERIFIER_REVISION_V6,
  SURFER_MEANING_VERIFIER_REVISION_V7,
  SURFER_MEANING_VERIFIER_REVISION_V8,
  SURFER_MEANING_VERIFIER_REVISION_V9,
  SURFER_MEANING_VERIFIER_REVISION_V10,
  SURFER_MEANING_VERIFIER_REVISION_V11,
  SURFER_MEANING_VERIFIER_REVISION_V12,
  decodeSurferMeaningVerificationWork,
} from '../../packages/contracts/src/surfer-meaning-verification.js';
import { createSurferApplicationRuntime } from '../../assemblies/shotgun-app/src/surfer-runtime.js';
import { randomUUID, createHash } from 'node:crypto';
import { ruleReviewFixture } from '../helpers/surfer-rule-review-fixture.js';
import { buildBoundedWorker } from '../helpers/surfer-bounded-induction-fixture.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createDefaultLaunchDeps } from '../../scripts/launch-default-deps.js';
import { Pool } from 'pg';
import { PostgresSurferSourceSession } from '../../adapters/surfer-shotgun-source-postgres/src/index.js';
import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  startShotgunApplication,
  type ShotgunApplicationHandle,
} from '../../assemblies/shotgun-app/src/application.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { CredentialVaultService } from '../../modules/credential-vault/src/index.js';
import { PostgresCredentialVaultRepository } from '../../adapters/credential-vault-postgres/src/index.js';
import { PostgresProjectAIConfigurationRepository } from '../../adapters/ai-configuration-postgres/src/index.js';
import {
  initialProviderRegistry,
  ProjectAIConfigurationService,
} from '../../modules/ai-configuration/src/index.js';
import { StandingAIProcessingPolicyService } from '../../packages/policy/src/index.js';
import { PostgresStandingAIProcessingPolicyRepository } from '../../adapters/project-standing-ai-policy-postgres/src/index.js';
import { PostgresAskProviderPolicyAuthorityReader } from '../../adapters/frontend-ask-provider-policy-postgres/src/index.js';
import { AskProviderPolicyResolver } from '../../modules/frontend-ask-provider-policy/src/index.js';
import { EffectiveAIConfigurationResolver } from '../../adapters/ai-runtime-resolution/src/index.js';
import { decodeSurferAccountAuthorityConfigV2 } from '../../packages/contracts/src/surfer-account-authority-v2.js';
import { surferDigest } from '../../packages/contracts/src/surfer-learning.js';
import type { SurferGuidedCatalog } from '../../packages/contracts/src/surfer-guided-memory.js';
import { executionPolicy } from '../helpers/surfer-execution-contracts.js';
import { memoryFixture } from '../helpers/surfer-memory-fixture.js';
import { createSurferReadinessClient } from '../../packages/shotgun-api-client/src/surfer-readiness-client.js';
import {
  PostgresSurferRegistrationAdmin,
  PostgresSurferAccountBootstrap,
} from '../../adapters/surfer-account-authority-postgres/src/index.js';
import {
  registerSurferAccountAfterDrain,
  bootstrapSurferAccountAfterDrain,
} from '../../modules/surfer-execution/src/runtime-controls.js';
import type { SurferAccountBootstrapCommand } from '../../packages/contracts/src/surfer-account-bootstrap.js';
import type { SurferRegistrationCommand } from '../../packages/contracts/src/surfer-account-registration.js';
import { PostgresSurferIntakeInbox } from '../../adapters/surfer-intake-postgres/src/index.js';
import {
  createSurferSourceFixture,
  migrateSurferSourceDatabase,
} from '../helpers/surfer-source-database.js';

const target = process.env.SURFER_ISOLATED_DATABASE_URL,
  network = globalThis.fetch;
const upgradedClone = process.env.SURFER_APP_UPGRADED_CLONE;
const root = upgradedClone
  ? '.data/surfer-workload-173/' + upgradedClone
  : '.data/surfer-app-runtime-postgres';
describe.skipIf(!target)('Real Shotgun startup with native Surfer and fake HTTP only', () => {
  let pool: Pool, admin: Pool, principalId: string, authorityUrl: string;
  const storeId = randomUUID(),
    applications: ShotgunApplicationHandle[] = [];
  beforeAll(async () => {
    const url = new URL(target!);
    const targetAllowed = upgradedClone
      ? ['127.0.0.1', 'localhost'].includes(url.hostname) &&
        /^shotgun_surfer_upgrade_[a-f0-9]{32}$/.test(upgradedClone) &&
        url.pathname === '/' + upgradedClone
      : url.hostname === '127.0.0.1' &&
        url.username === 'surfer_test' &&
        url.pathname === '/surfer_test';
    if (!targetAllowed) throw Error('Disposable DB only');
    pool = new Pool({ connectionString: target, max: 4, statement_timeout: 15000 });
    if (upgradedClone) {
      const {
        rows: [schema],
      } = await pool.query(`SELECT current_database() AS db,
        (SELECT name FROM runtime.schema_migrations ORDER BY name DESC LIMIT 1) AS migration`);
      expect(schema).toEqual({
        db: upgradedClone,
        migration: '173_surfer_meaning_review_prompt_v12.sql',
      });
    } else await migrateSurferSourceDatabase(pool);
  }, 60000);
  beforeAll(async () => {
    const url = new URL(target!);
    const authorityDb = upgradedClone
      ? 'shotgun_surfer_upgrade_account_' + upgradedClone.slice(-32)
      : 'surfer_app_authority_test';
    await pool.query(`CREATE DATABASE "${authorityDb}"`);
    url.pathname = '/' + authorityDb;
    admin = new Pool({ connectionString: url.href, max: 3, statement_timeout: 15000 });
    await migrateSurferSourceDatabase(admin);
    await admin.query('INSERT INTO vp_global_budget.authority_store(store_id) VALUES($1)', [
      storeId,
    ]);
    url.searchParams.set('options', '-c role=shotgun_runtime');
    authorityUrl = url.href;
    principalId = (
      await new PostgresAuthRepository(pool).bootstrapLocalOwnerPrincipal({
        accountId: 'app-' + randomUUID(),
      })
    ).principalId;
    await mkdir(root, { recursive: true });
  }, 60000);
  beforeAll(() => {
    buildBoundedWorker();
  }, 60000);
  beforeEach(() => {
    for (const k of [
      'GEMINI_API_KEY',
      'OPENAI_API_KEY',
      'OPENAI_BASE_URL',
      'DEEPSEEK_BASE_URL',
      'VP_GLOBAL_RELATION_BUDGET_DATABASE_URL',
      'AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS',
    ])
      vi.stubEnv(k, undefined);
    vi.stubEnv('SHOTGUN_CREDENTIAL_MASTER_KEY', Buffer.alloc(32, 9).toString('base64url'));
    vi.stubEnv('SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION', 'fixture-v1');
    vi.stubEnv('SHOTGUN_DEPLOYMENT_MODE', 'local');
  });
  afterEach(async () => {
    for (const a of applications.splice(0)) await a.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await admin?.end();
    await pool?.end();
  });
  async function setup(
    seedAccount = true,
    meaningOnly = false,
    meaningV2:
      boolean | 'v3' | 'v4' | 'v5' | 'v6' | 'v7' | 'v8' | 'v9' | 'v10' | 'v11' | 'v12' = false,
    standardMeaningLaunch = false,
  ) {
    const actual = await createSurferSourceFixture(pool, principalId),
      f = memoryFixture();
    const registry = initialProviderRegistry(),
      repository = new PostgresProjectAIConfigurationRepository(pool);
    const vault = new CredentialVaultService(new PostgresCredentialVaultRepository(pool), {
      read: () => ({ key: Buffer.alloc(32, 9), keyVersion: 'fixture-v1' }),
    });
    const secret = Buffer.from('ISOLATED_NOT_A_REAL_KEY_' + randomUUID());
    const metadata = await vault.create({
      projectId: actual.projectId,
      providerId: 'deepseek',
      secret,
    });
    const current = {
      projectId: actual.projectId,
      activeProviderId: 'deepseek',
      activeModelId: 'deepseek-flash',
      credentialId: metadata.credentialId,
      credentialRevision: 1,
      aiConfigurationRevision: 1,
      updatedBy: principalId,
      updatedAt: new Date().toISOString(),
    };
    expect(await repository.saveRevision({ expectedRevision: 0, next: current })).toBe('CREATED');
    const configuration = new ProjectAIConfigurationService(
      registry,
      repository,
      vault,
      undefined,
      { enforceDeepSeekOnly: true },
    );
    const standing = new StandingAIProcessingPolicyService(
      new PostgresStandingAIProcessingPolicyRepository(pool),
      { enforceDeepSeekOnly: true },
    );
    await standing.save({
      projectId: actual.projectId,
      expectedRevision: 0,
      enabled: true,
      providerId: 'deepseek',
      aiConfigurationRevision: 1,
      changedBy: principalId,
    });
    const policy = new AskProviderPolicyResolver(
      new PostgresAskProviderPolicyAuthorityReader(pool, standing),
      {
        providerId: 'deepseek',
        deploymentPrivateTransferAllowed: true,
        deploymentPrivateTransferAllowedForProvider: () => true,
        providerIdResolver: async () => 'deepseek',
        providerModelResolver: async () => 'deepseek-flash',
        providerPolicyIdentity: 'a8-fallback-provider-policy-v1',
        providerDisplayName: 'DeepSeek',
        providerModel: 'deepseek-flash',
        providerDescriptor: (id, modelId) => {
          const p = registry.getProvider(id),
            m = registry.getModel(id, modelId!);
          return p && m
            ? {
                policyIdentity: `${p.providerPolicyId}:${p.providerPolicyRevision}`,
                displayName: p.displayName,
                model: m.modelId,
              }
            : undefined;
        },
      },
    );
    const identityResolver = new EffectiveAIConfigurationResolver(registry, configuration, vault, {
      enforceDeepSeekOnly: true,
      policy,
      standingPolicyAuthority: standing,
    });
    const resolveIdentity = () =>
      identityResolver.resolveSourceAIExecutionIdentity({
        principalId,
        projectId: actual.projectId,
        requestId: randomUUID(),
        sourceVersionId: randomUUID(),
        sensitivity: 'private',
        accessScope: ['owner'],
        dataClassification: 'private',
      });
    const resolved = await resolveIdentity();
    const modelMetadata = standardMeaningLaunch
      ? readSurferDeepSeekMetadata(
          {
            object: 'list',
            data: [
              {
                id: 'deepseek-flash',
                name: 'DeepSeek-V4.1-Flash',
                context_window: 1048576,
                max_output_tokens: 4096,
                input_modalities: ['text'],
                output_modalities: ['text'],
              },
            ],
          },
          Date.now(),
        )
      : undefined;
    const bound = modelMetadata ? new SurferDeepSeekContextBound(modelMetadata) : undefined;
    const profile = {
      ...f.p.profile,
      ...(upgradedClone ? { mode: 'LIVE' as const } : {}),
      identity: resolved.executionIdentity,
      authorityRef: randomUUID(),
      accountFingerprint: createHash('sha256').update(secret).digest('hex'),
      allowedResponseModels: ['deepseek-flash'],
      promptRevision: meaningOnly
        ? meaningV2 === 'v12'
          ? SURFER_MEANING_VERIFIER_REVISION_V12
          : meaningV2 === 'v11'
            ? SURFER_MEANING_VERIFIER_REVISION_V11
            : meaningV2 === 'v10'
              ? SURFER_MEANING_VERIFIER_REVISION_V10
              : meaningV2 === 'v9'
                ? SURFER_MEANING_VERIFIER_REVISION_V9
                : meaningV2 === 'v8'
                  ? SURFER_MEANING_VERIFIER_REVISION_V8
                  : meaningV2 === 'v7'
                    ? SURFER_MEANING_VERIFIER_REVISION_V7
                    : meaningV2 === 'v6'
                      ? SURFER_MEANING_VERIFIER_REVISION_V6
                      : meaningV2 === 'v5'
                        ? SURFER_MEANING_VERIFIER_REVISION_V5
                        : meaningV2 === 'v4'
                          ? SURFER_MEANING_VERIFIER_REVISION_V4
                          : meaningV2 === 'v3'
                            ? SURFER_MEANING_VERIFIER_REVISION_V3
                            : meaningV2
                              ? SURFER_MEANING_VERIFIER_REVISION_V2
                              : SURFER_MEANING_VERIFIER_REVISION
        : 'surfer-directive-role-catalog-v3',
      ...(bound ? { inputBoundRevision: bound.revision } : {}),
      maximum: {
        ...f.p.profile.maximum,
        ...(bound ? { inputTokens: 1048576, outputTokens: 4096, moneyMicros: 1052672 } : {}),
        elapsedMs: 10000,
      },
    };
    secret.fill(0);
    const config = decodeSurferAccountAuthorityConfigV2({
      rootPolicy: {
        schemaVersion: '1.1.0',
        rootId: profile.authorityRef,
        storeId,
        provider: 'deepseek',
        accountScopeId: 'app-' + randomUUID(),
        mode: profile.mode,
        currency: 'USD',
        revision: 'fixture-app-v1',
        expiresAtMs: Date.now() + 7200000,
        dailyCallLimit: null,
        surferDailyLimits: null,
      },
      registrationId: randomUUID(),
      profile,
    });
    if (seedAccount) {
      await admin.query(
        'INSERT INTO provider_account.roots(root_id,store_id,policy,policy_digest,enabled) VALUES($1,$2,$3::jsonb,$4,true)',
        [
          config.rootPolicy.rootId,
          storeId,
          JSON.stringify(config.rootPolicy),
          surferDigest(config.rootPolicy),
        ],
      );
      await admin.query(
        "INSERT INTO provider_account.registrations(registration_id,root_id,profile,profile_digest,identity_digest,project_ids,access_scopes,runtime_role,expires_at,enabled) VALUES($1,$2,$3::jsonb,$4,$5,$6,ARRAY['owner'],'shotgun_runtime',clock_timestamp()+interval '1 hour',true)",
        [
          config.registrationId,
          config.rootPolicy.rootId,
          JSON.stringify(config.profile),
          surferDigest(config.profile),
          surferDigest(config.profile.identity),
          [actual.projectId],
        ],
      );
    }
    const control = {
      surfer: 0,
      other: 0,
      raw: f.response.rawText,
      uncertain: false,
      onSend: async () => {},
      ask: 0,
      meaningWire: undefined as unknown,
      askCitationCount: undefined as number | undefined,
      askPrompts: [] as {
        meaningDiscovery?: unknown;
        interpretationMemory?: {
          contextDigest: string;
          items: unknown[];
          learnedRules?: {
            state: string;
            outcome: string;
            scenario: {
              grounding: {
                proposalReviews: { scopeAssessment: string; crossReviewState?: string }[];
              };
            };
          }[];
        };
        context: { kind: string; citationRef?: string }[];
      }[],
      onAsk: async () => {},
      badAsk: false,
    };
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url !== 'https://api.deepseek.com/chat/completions')
        throw Error('Unexpected outbound HTTP blocked');
      const body = JSON.parse(String(init?.body)),
        surfer = body.max_tokens === profile.maximum.outputTokens;
      const askPrompt = body.messages
        .map((m: { content: string }) => {
          try {
            return JSON.parse(m.content);
          } catch {
            return null;
          }
        })
        .find((m: { task?: string } | null) => m?.task?.startsWith('shotgun-ask-answer'));
      let askRaw: string | undefined;
      if (askPrompt) {
        control.ask++;
        control.askPrompts.push(askPrompt);
        await control.onAsk();
        askRaw = control.badAsk
          ? '{bad'
          : JSON.stringify({
              ...(askPrompt.meaningDiscovery
                ? {
                    meaningDiscovery: {
                      ...((control.meaningWire as object) ?? {
                        state: 'MISSING',
                        reason: 'No proposed mapping in this fixture',
                        candidates: [],
                      }),
                      ...(askPrompt.meaningDiscovery.semanticScopeProfile
                        ? {
                            semanticScopes:
                              (control.meaningWire as { semanticScopes?: unknown } | undefined)
                                ?.semanticScopes ?? [],
                          }
                        : {}),
                    },
                  }
                : {}),
              answer: askPrompt.interpretationMemory
                ? '기억된 해석과 연결 원문을 확인했습니다.'
                : '원문을 확인했습니다.',
              citations: askPrompt.context
                .filter((c: { kind: string }) => c.kind === 'EVIDENCE')
                .slice(
                  0,
                  control.askCitationCount ??
                    (control.meaningWire ||
                    askPrompt.interpretationMemory?.learnedRules?.some(
                      (r: { scenario?: { origin?: string } }) =>
                        r.scenario?.origin === 'CALLER_SCENARIO_WITH_SOURCE_DECLARED_TERMS',
                    )
                      ? 2
                      : 1),
                )
                .map((c: { citationRef: string }) => ({ citationRef: c.citationRef })),
            });
      }
      if (surfer) {
        control.surfer++;
        await control.onSend();
        if (control.uncertain) throw Error('Fake response lost after send');
      } else control.other++;
      return new Response(
        JSON.stringify({
          id: 'fake-app-response',
          model: 'deepseek-flash',
          choices: [
            { message: { content: askRaw ?? (surfer ? control.raw : '{"candidates":[]}') } },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const execution = {
      projectId: actual.projectId,
      runId: randomUUID(),
      accountConfig: config,
      authorityDatabaseUrl: authorityUrl,
      policy: executionPolicy({
        allowedSpaceIds: [actual.projectId],
        executionIdentity: surferDigest(profile.identity),
        modelRevision: 'deepseek/deepseek-flash',
        egressPolicyRevision: profile.egressPolicyRevision,
        pricingRevision: profile.pricingRevision,
        currency: 'USD',
        ...(modelMetadata ? { deadlineAtMs: modelMetadata.observedAtMs + 3600000 } : {}),
        unitMaxMs: 15000,
        limits: {
          calls: 10,
          inputTokens: bound ? 3000000 : 100000,
          outputTokens: bound ? 15000 : 10000,
          moneyMicros: bound ? 3500000 : 200000,
          elapsedMs: 100000,
        },
        backgroundLimits: {
          calls: 5,
          inputTokens: bound ? 2100000 : 50000,
          outputTokens: bound ? 10000 : 5000,
          moneyMicros: bound ? 2300000 : 100000,
          elapsedMs: 50000,
        },
      }),
      inputBound: { revision: profile.inputBoundRevision, upperBound: () => 100 },
      resolveActor: async () => actual.request,
      intervalMs: 1000,
    };
    let launchFile: string | undefined;
    const configureMeaningLaunch = async (
      notBeforeMs: number,
      deadlineAtMs = execution.policy.deadlineAtMs,
    ) => {
      launchFile = path.resolve(root, 'meaning-launch-' + actual.projectId + '.json');
      await writeFile(
        launchFile,
        JSON.stringify({
          schemaVersion: '1.0.0',
          projectId: actual.projectId,
          principalId,
          runId: execution.runId,
          notBeforeMs,
          accountConfig: config,
          policy: { ...execution.policy, deadlineAtMs },
          metadata: modelMetadata,
        }),
      );
    };
    let app: ShotgunApplicationHandle, base: string;
    const start = async (
      mode: 'native' | 'default' | 'recovery' | 'standard-meaning' = 'native',
      answers = false,
      meaning?: SurferMeaningApplicationOptions,
    ) => {
      if (upgradedClone) {
        app = (await createDefaultLaunchDeps().startApplication({
          host: '127.0.0.1',
          port: 0,
          spaDirectory: path.resolve('apps/shotgun-web/dist'),
          environment: {
            ...process.env,
            DATABASE_URL: target!,
            ASSET_STORAGE_ROOT: path.resolve(root, 'assets-' + actual.projectId),
            SHOTGUN_ERASURE_JOURNAL_ROOT: path.resolve(root, 'erasure'),
            SHOTGUN_ERASURE_JOURNAL_HMAC_KEY: '',
            SHOTGUN_SURFER_MEANING_PROFILE_FILE:
              mode === 'standard-meaning' ? launchFile : undefined,
            VP_GLOBAL_RELATION_BUDGET_DATABASE_URL:
              mode === 'standard-meaning' ? authorityUrl : undefined,
            VP_GLOBAL_RELATION_BUDGET_ACCOUNT_FINGERPRINT: '',
          },
          stagingSecret: 'isolated-app-runtime-staging-secret-0001',
          environmentProfile: 'runtime-development',
          noSignals: true,
        })) as ShotgunApplicationHandle;
      } else
        app = await startShotgunApplication({
          databaseUrl: target,
          environmentProfile: mode === 'recovery' ? 'recovery' : 'runtime-test',
          environment: {
            NODE_ENV: 'test',
            DATABASE_URL: target,
            SOURCES_STAGING_SECRET: 'isolated-app-runtime-staging-secret-0001',
            ...(mode === 'standard-meaning'
              ? {
                  SHOTGUN_SURFER_MEANING_PROFILE_FILE: launchFile,
                  VP_GLOBAL_RELATION_BUDGET_DATABASE_URL: authorityUrl,
                }
              : {}),
          },
          assetRoot: path.resolve(root, 'assets-' + actual.projectId),
          host: '127.0.0.1',
          port: 0,
          noSignals: true,
          disableAskWorker: !answers,
          recoveryIntervalMs: false,
          actionFeedbackOutboxIntervalMs: false,
          sourceRefreshIntervalMs: false,
          aiDurableMaterializationRecoveryEnabled: false,
          ...(mode === 'default' || mode === 'standard-meaning'
            ? {}
            : meaningOnly
              ? { surferMeaningAccount: execution }
              : { surferAccount: execution }),
          ...(meaning ? { surferMeaning: meaning } : {}),
        });
      applications.push(app);
      await app.listen();
      base = `http://127.0.0.1:${(app.server.server.address() as AddressInfo).port}`;
      return app;
    };
    const stop = async () => {
      await app.close();
      applications.splice(applications.indexOf(app), 1);
    };
    const post = async (url: string, payload: unknown, auth = true, csrf = true) => {
      const response = await network(base + url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(auth
            ? {
                cookie: `shotgun_session=${actual.session.sessionToken}`,
                ...(csrf ? { 'x-csrf-token': actual.session.csrfToken } : {}),
              }
            : {}),
        },
        body: JSON.stringify(payload),
      });
      return { code: response.status, body: await response.json() };
    };
    const submit = async () => {
      const draftId = 'draft-' + randomUUID(),
        itemId = 'item-' + randomUUID(),
        query = new URLSearchParams({
          draftId,
          itemId,
          kind: 'DIRECT_TEXT',
          label: 'Surfer app fixture',
          mediaType: 'text/plain',
        });
      const staged = await network(base + '/product-api/frontend/sources/staging/bytes?' + query, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          cookie: `shotgun_session=${actual.session.sessionToken}`,
          'x-csrf-token': actual.session.csrfToken,
        },
        body: f.item.text,
      });
      const staging = await staged.json();
      expect(staged.status, JSON.stringify(staging)).toBe(200);
      const result = await post('/product-api/frontend/sources/submissions', {
        envelopeVersion: '1.0.0',
        commandType: 'sources.intake.submit.v1',
        commandSchemaVersion: '1.0.0',
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        projectContext: {
          activeProjectId: actual.projectId,
          targetProjectId: actual.projectId,
          resourceProjectId: actual.projectId,
        },
        policyBinding: { mode: 'CURRENT' },
        preconditions: [],
        clientIssuedAt: new Date().toISOString(),
        payload: {
          draftId,
          inputs: [
            {
              itemId,
              kind: 'DIRECT_TEXT',
              label: 'Surfer app fixture',
              stagingReference: staging.receipt.stagingReference,
            },
          ],
        },
      });
      expect(result.code, JSON.stringify(result.body)).toBe(200);
      return result.body;
    };
    const job = async () =>
      (
        await pool.query(
          'SELECT * FROM surfer_intake.job WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1',
          [actual.projectId],
        )
      ).rows[0];
    const wait = async (state: string) => {
      const end = Date.now() + 25000;
      while (Date.now() < end) {
        const j = await job();
        if (j?.state === state) return j;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw Error('Expected ' + state + ';observed ' + JSON.stringify(await job()));
    };
    const grants = async () =>
      (
        await admin.query('SELECT state FROM provider_account.grants WHERE root_id=$1', [
          config.rootPolicy.rootId,
        ])
      ).rows.map((r) => r.state);
    return {
      configureMeaningLaunch,
      actual,
      f,
      profile,
      config,
      control,
      start,
      stop,
      post,
      submit,
      job,
      wait,
      grants,
      vault,
      metadata,
      standing,
      execution,
      httpBase: () => base,
      resolveIdentity,
      repository,
      current,
    };
  }
  it.each(['success', 'source-changed', 'malformed'] as const)(
    'answers a regular natural question with pinned memory through actual HTTP: %s',
    async (scenario) => {
      const f = await setup();
      await f.start('native', true);
      await f.submit();
      await f.wait('COMPLETED');
      const memory = await pool.query(
          'SELECT source_id::text,source_version_id::text FROM surfer_intake.job WHERE project_id=$1',
          [f.actual.projectId],
        ),
        selected = memory.rows[0],
        evidence = (
          await pool.query(
            "SELECT evidence_id::text FROM evidence.spans WHERE project_id=$1 AND source_version_id=$2 AND pointer=''",
            [f.actual.projectId, selected.source_version_id],
          )
        ).rows[0];
      f.control.badAsk = scenario === 'malformed';
      if (scenario === 'source-changed')
        f.control.onAsk = async () => {
          await f.actual.source('The source changed during the Ask provider call.', {
            sourceId: selected.source_id,
          });
        };
      const submitted = await f.post('/product-api/frontend/ask/questions', {
        schemaVersion: '1.0.0',
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        question: '현재 온도 조건에서 어떤 조치를 해야 하는지 원문과 기억된 해석을 알려줘.',
        mode: 'SOURCE_EXPLORATION',
        sourceSelections: [
          {
            sourceId: selected.source_id,
            sourceVersionId: selected.source_version_id,
            evidenceIds: [evidence.evidence_id],
          },
        ],
      });
      expect(submitted.code, JSON.stringify(submitted.body)).toBe(200);
      const runId = submitted.body.submission.answerRun.answerRunId,
        end = Date.now() + 25000;
      let state: string | undefined;
      while (Date.now() < end) {
        state = (
          await pool.query('SELECT state FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
            runId,
          ])
        ).rows[0]?.state;
        if (['SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(state!)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(state).toBe(scenario === 'success' ? 'SUCCEEDED' : 'FAILED');
      expect(f.control.ask).toBe(1);
      expect(f.control.askPrompts[0]?.interpretationMemory?.items).toHaveLength(1);
      const pinned = (
        await pool.query(
          'SELECT context,digest FROM frontend_ask.surfer_memory_context WHERE answer_run_id=$1',
          [runId],
        )
      ).rows;
      expect(pinned).toHaveLength(1);
      expect(pinned[0].context.packet.items).toHaveLength(1);
      expect(pinned[0].context.digest).toBe(
        f.control.askPrompts[0]!.interpretationMemory!.contextDigest,
      );
      expect(
        (
          await pool.query(
            'SELECT count(*)::int AS n FROM frontend_ask.citations c JOIN frontend_ask.statements s ON s.statement_id=c.statement_id WHERE s.answer_run_id=$1',
            [runId],
          )
        ).rows[0].n,
      ).toBe(scenario === 'success' ? 1 : 0);
      if (scenario !== 'success') return;
      await f.stop();
      await f.start('native', true);
      expect(
        (
          await pool.query(
            'SELECT context,digest FROM frontend_ask.surfer_memory_context WHERE answer_run_id=$1',
            [runId],
          )
        ).rows,
      ).toEqual(pinned);
      expect(f.control.ask).toBe(1);
      await writeFile(
        root + '/ask-context.json',
        JSON.stringify({
          realHttpQuestion: true,
          realAppResolverAndProvider: true,
          sameAnswerRun: true,
          immutablePin: true,
          originalEvidenceCitation: true,
          fakeAskHttp: 1,
          memoryItems: 1,
          modelCalls: 0,
          generalSemanticAcceptance: false,
          learnedRuleApplication: false,
        }),
      );
    },
  );
  async function automaticMeaningCase(
    v2 = false,
    adoption = false,
    launch = false,
    version?: 'v4' | 'v5' | 'v6' | 'v7' | 'v8' | 'v9' | 'v10' | 'v11' | 'v12',
  ) {
    const f = await setup(true, true, version ?? (adoption ? 'v3' : v2), launch),
      learned = await ruleReviewFixture(
        pool,
        principalId,
        root + '/meaning-auto-' + randomUUID(),
        undefined,
        undefined,
        f.actual,
      );
    const domain = learned.development.cases[0]!.domain;
    const station = (id: string, value: string) =>
      '"units": "Cel"\n"name": "온도",\n"description": "temperature",\n"value": ' +
      value +
      '\n"self": "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/' +
      id +
      '/datums.json"';
    const setpoint = (facility: string, value: string) =>
      'Facility,Parameter,Setpoint,Unit\n' + facility + ',temperature,' + value + ',Cel';
    const firstCondition = '우회 밸브가 열린 경우';
    const secondCondition = '우회 밸브가 닫힌 경우';
    const firstClause = '세정 단계에서 ' + firstCondition;
    const secondClause = '정상 운전 단계에서 ' + secondCondition;
    const conflictSubject = '배관 B-4의 temperature 유량';
    const conflictCondition = '저부하 순환 단계에서 입구 차단 밸브가 열린 상태일 때';
    const conflictScope = conflictSubject + '은 ' + conflictCondition;
    const commonTime = '야간 교대 기록';
    const commonException = '온도계 검정 중에는 적용하지 않는다';
    const commonSuffix = version === 'v10' ? '\n' + commonTime + '.\n' + commonException + '.' : '';
    const sameScopeConflict = version === 'v8' || version === 'v10';
    const firstRequest = '수동 전환 요청이 들어오지 않은 경우에만 적용한다';
    const secondRequest = '수동 전환 요청이 들어온 경우에만 적용한다';
    const firstOperation = '자동 운전 중이고 ' + firstRequest;
    const secondOperation = '자동 운전 중이고 ' + secondRequest;
    const mixedTime = '저속 단계에서';
    const mixedConditions = [
      '배출 밸브가 닫혀 있으면',
      '배출 밸브가 닫혀 있고 센서 확인 중일 때에만',
    ];
    const mixedValues = ['temperature는 41 Cel이다', 'temperature를 12 Cel로 유지한다'];
    const mixedException = '단, 센서 확인 중에는 41 Cel을 적용하지 않는다.';
    const mixedScopes = mixedConditions.map(
      (condition, i) =>
        mixedTime +
        ' ' +
        condition +
        ' ' +
        mixedValues[i] +
        '.' +
        (i === 0 ? ' ' + mixedException : ''),
    );
    const mixedValueScope = version === 'v11' || version === 'v12';
    const first = mixedValueScope
      ? 'K-4 작업표. ' + mixedScopes[0]
      : version === 'v9'
        ? '혼합조 M-5의 temperature는 18 Cel로 맞춘다. 야간 교대에 ' + firstOperation + '.'
        : sameScopeConflict
          ? conflictScope + ' 정확히 18 Cel이어야 한다.' + commonSuffix
          : version === 'v7'
            ? firstClause + ' 펌프 M-9의 temperature는 18 Cel로 설정한다.'
            : version === 'v6'
              ? setpoint('East depot', '4.0')
              : version === 'v5'
                ? station('9414290', '5.98')
                : adoption
                  ? `${domain} 분야에서 온도는 temperature와 같은 NUMBER 값이며 단위는 Cel이다.`
                  : v2
                    ? meaningOrigin.replace(
                        '온도는 temperature를 뜻하며',
                        '온도와 temperature의 관측값은 모두 20이며',
                      )
                    : meaningOrigin;
    const second = mixedValueScope
      ? 'K-4 점검 메모. ' + mixedScopes[1]
      : version === 'v9'
        ? '혼합조 M-5의 temperature는 32 Cel로 맞춘다. 야간 교대에 ' + secondOperation + '.'
        : sameScopeConflict
          ? conflictScope + ' 정확히 32 Cel이어야 한다.' + commonSuffix
          : version === 'v7'
            ? secondClause + ' 펌프 M-9의 temperature는 32 Cel로 설정한다.'
            : version === 'v6'
              ? setpoint('West depot', '8.5')
              : version === 'v5'
                ? station('8518750', '3.29')
                : adoption
                  ? `${domain} 분야에서 온도는 temperature와 같은 NUMBER 값을 가리키며 단위는 Cel이다.`
                  : v2
                    ? meaningWitness.replace(
                        'temperature 항목을 온도라고 부른다.',
                        'temperature와 온도의 관측값은 각각 20이다.',
                      )
                    : meaningWitness;
    const origin = await f.actual.source(first),
      witness = await f.actual.source(second),
      raw = new PostgresSurferSourceSession(pool);
    const om = await raw.withSnapshotV2(
        f.actual.request,
        async (s) => (await s.readMaterialV2(origin.sourceId)).material,
      ),
      wm = await raw.withSnapshotV2(
        f.actual.request,
        async (s) => (await s.readMaterialV2(witness.sourceId)).material,
      );
    const wire = adoption
      ? {
          ...meaningReviewWireV2(first, second),
          typeAssessment: 'MATCH',
          unitAssessment: 'MATCH',
          typeCitations: [{ passageRef: 'P1', quote: 'NUMBER' }],
          unitCitations: [{ passageRef: 'P1', quote: 'Cel' }],
          facets: Object.fromEntries(
            ['subject', 'time', 'condition', 'exception'].map((facet) => [
              facet,
              { state: 'UNSTATED', reason: 'No additional scope stated.', quotes: [] },
            ]),
          ),
        }
      : v2
        ? {
            ...meaningReviewWireV2(first, second),
            relationBasis: 'OBSERVATION_ONLY',
            documentRole: 'OBSERVATION',
          }
        : meaningReviewWire(first, second);
    const valveQuotes = [
      { passageRef: 'P1', quote: firstCondition },
      { passageRef: 'P2', quote: secondCondition },
    ];
    const quoteBoth = (quote: string) => ['P1', 'P2'].map((passageRef) => ({ passageRef, quote }));
    const requestQuotes = [
      { passageRef: 'P1', quote: firstRequest },
      { passageRef: 'P2', quote: secondRequest },
    ];
    const pairedQuotes = (quotes: string[]) =>
      quotes.map((quote, i) => ({ passageRef: 'P' + (i + 1), quote }));
    const mixedWire = {
      ...wire,
      relation: 'DISTINCT',
      documentRole: 'NORMATIVE',
      roleCitations: pairedQuotes(mixedValues),
      support: pairedQuotes(mixedValues),
      facets: {
        ...wire.facets,
        time: { state: 'STATED', reason: 'Operating phase', quotes: quoteBoth(mixedTime) },
        condition: {
          state: 'STATED',
          reason: 'Valve and check',
          quotes: pairedQuotes(mixedConditions),
        },
        exception: {
          state: 'STATED',
          reason: 'Sensor checking',
          quotes: pairedQuotes([mixedException, '센서 확인 중일 때에만']),
        },
      },
      scopeComparison: {
        state: 'DIFFERENT_SCOPE',
        quotes: pairedQuotes(
          version === 'v12'
            ? mixedConditions.map((condition) => mixedTime + ' ' + condition)
            : mixedScopes,
        ),
      },
      typeCitations: pairedQuotes(mixedValues),
      unitCitations: pairedQuotes(['41 Cel', '12 Cel']),
      counter: [{ passageRef: 'P1', quote: mixedException, kind: 'SCOPE_LIMITATION' }],
    };
    f.control.raw = JSON.stringify(
      mixedValueScope
        ? mixedWire
        : version === 'v9'
          ? {
              ...wire,
              relation: 'DISTINCT',
              documentRole: 'NORMATIVE',
              facets: {
                ...wire.facets,
                time: { state: 'STATED', reason: 'Night shift', quotes: quoteBoth('야간 교대에') },
                condition: {
                  state: 'STATED',
                  reason: 'Different requests',
                  quotes: [
                    { passageRef: 'P1', quote: firstOperation },
                    { passageRef: 'P2', quote: secondOperation },
                  ],
                },
              },
              scopeComparison: { state: 'DIFFERENT_SCOPE', quotes: requestQuotes },
              typeCitations: [{ passageRef: 'P1', quote: '18 Cel' }],
              unitCitations: [{ passageRef: 'P1', quote: '18 Cel' }],
              counter: requestQuotes.map((quote) => ({ ...quote, kind: 'SEMANTIC_CONTRADICTION' })),
            }
          : sameScopeConflict
            ? {
                ...wire,
                relation: 'DISTINCT',
                documentRole: 'NORMATIVE',
                facets: {
                  ...wire.facets,
                  ...(version === 'v10'
                    ? {
                        time: {
                          state: 'STATED',
                          reason: 'Common shift',
                          quotes: quoteBoth(commonTime),
                        },
                        exception: {
                          state: 'STATED',
                          reason: 'Common exclusion',
                          quotes: quoteBoth(commonException),
                        },
                      }
                    : {}),
                  subject: {
                    state: 'STATED',
                    reason: 'Same pipe',
                    quotes: quoteBoth(conflictSubject),
                  },
                  condition: {
                    state: 'STATED',
                    reason: 'Same condition',
                    quotes: quoteBoth(conflictCondition),
                  },
                },
                scopeComparison: { state: 'SAME_SCOPE', quotes: quoteBoth(conflictScope) },
                typeCitations: [{ passageRef: 'P1', quote: '18 Cel' }],
                unitCitations: [{ passageRef: 'P1', quote: '18 Cel' }],
                counter: [
                  {
                    passageRef: 'P2',
                    quote: '정확히 32 Cel이어야 한다',
                    kind: 'SEMANTIC_CONTRADICTION',
                  },
                ],
              }
            : version === 'v7'
              ? {
                  ...wire,
                  relation: 'UNRESOLVED',
                  relationBasis: 'UNRESOLVED',
                  documentRole: 'NORMATIVE',
                  facets: {
                    ...wire.facets,
                    condition: { state: 'STATED', reason: 'Valve condition', quotes: valveQuotes },
                  },
                  scopeComparison: { state: 'DIFFERENT_SCOPE', quotes: valveQuotes },
                  typeAssessment: 'UNRESOLVED',
                  typeCitations: [],
                  unitAssessment: 'UNRESOLVED',
                  unitCitations: [],
                }
              : version === 'v6'
                ? {
                    ...wire,
                    relation: 'UNRESOLVED',
                    relationBasis: 'OBSERVATION_ONLY',
                    documentRole: 'OBSERVATION',
                    scopeComparison: { state: 'NOT_ESTABLISHED', quotes: [] },
                    typeAssessment: 'UNRESOLVED',
                    typeCitations: [],
                    unitAssessment: 'UNRESOLVED',
                    unitCitations: [],
                  }
                : version === 'v5'
                  ? {
                      ...wire,
                      scopeComparison: { state: 'NOT_ESTABLISHED', quotes: [] },
                      typeAssessment: 'UNRESOLVED',
                      typeCitations: [],
                      support: ['P1', 'P2'].map((passageRef) => ({
                        passageRef,
                        quote: '"description": "temperature",',
                      })),
                    }
                  : version === 'v4'
                    ? {
                        ...wire,
                        scopeComparison: { state: 'NOT_ESTABLISHED', quotes: [] },
                        unitCitations: [
                          { passageRef: 'P1', quote: 'Unit is not written like this' },
                        ],
                      }
                    : wire,
    );
    const usesFieldName =
      version === 'v6' ||
      version === 'v7' ||
      sameScopeConflict ||
      version === 'v9' ||
      mixedValueScope;
    const proposedWire = {
      state: 'PROPOSED',
      reason: 'isolated auto fixture',
      candidates: [
        {
          ruleRef: 'R1',
          field: 'temperature',
          label: usesFieldName ? 'temperature' : '온도',
          evidenceRef: 'E2',
          sourceQuote: first,
          questionQuote: usesFieldName ? 'temperature' : '온도',
          scope: 'UNVERIFIED',
        },
      ],
    };
    f.control.meaningWire = proposedWire;
    const question =
      Object.entries(learned.development.cases[0]!.features)
        .map(([n, v]) =>
          n === 'temperature' && usesFieldName
            ? 'temperature 항목을 검토하고'
            : `${n === 'temperature' ? '온도' : n}는 ${v.value}${v.unit ? ' ' + v.unit : ''}`,
        )
        .join('이고 ') + '입니다. 판단해줘.';
    await f.start(launch ? 'default' : 'native', true);
    const payload = {
      schemaVersion: '1.0.0',
      question,
      mode: 'SOURCE_EXPLORATION',
      sourceSelections: [
        {
          sourceId: learned.stored.sourceId,
          sourceVersionId: learned.stored.sourceVersionId,
          evidenceIds: [learned.task.selections[0]!.evidenceId],
        },
        {
          sourceId: origin.sourceId,
          sourceVersionId: origin.sourceVersionId,
          evidenceIds: [om.rootEvidenceId],
        },
        {
          sourceId: witness.sourceId,
          sourceVersionId: witness.sourceVersionId,
          evidenceIds: [wm.rootEvidenceId],
        },
      ],
    };
    const submit = async () => {
      const submitted = await f.post('/product-api/frontend/ask/questions', {
        ...payload,
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
      });
      expect(submitted.code).toBe(200);
      return submitted.body.submission.answerRun.answerRunId as string;
    };
    const jobSql =
      'SELECT j.state,j.code,j.result,j.work,j.job_id FROM surfer_meaning.job j JOIN frontend_ask.surfer_meaning_proposals p ON p.attempt_id=j.proposal_attempt_id WHERE p.answer_run_id=$1';
    const newOrigin = async (suffix: string) => {
      const text = first + ' ' + suffix;
      const source = await f.actual.source(text);
      const material = await raw.withSnapshotV2(
        f.actual.request,
        async (s) => (await s.readMaterialV2(source.sourceId)).material,
      );
      return {
        sourceId: source.sourceId,
        sourceVersionId: source.sourceVersionId,
        evidenceIds: [material.rootEvidenceId],
        text,
      };
    };
    let olderRun: string | undefined;
    if (launch) {
      const initial = payload.sourceSelections[1]!;
      const { text, ...selection } = await newOrigin('이전 질문용 원문입니다.');
      payload.sourceSelections[1] = selection;
      proposedWire.candidates[0]!.sourceQuote = text;
      olderRun = await submit();
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                `SELECT r.state, p.receipt->>'status' AS proposal, p.receipt->>'reason' AS reason, i.attempt_id IS NOT NULL AS intent
                   FROM frontend_ask.answer_runs r
                   LEFT JOIN frontend_ask.surfer_meaning_proposals p ON p.answer_run_id=r.answer_run_id
                   LEFT JOIN surfer_meaning.intent i ON i.attempt_id=p.attempt_id WHERE r.answer_run_id=$1`,
                [olderRun],
              )
            ).rows[0],
          { timeout: 15000 },
        )
        .toMatchObject({ intent: true });
      payload.sourceSelections[1] = initial;
      proposedWire.candidates[0]!.sourceQuote = first;
      await f.stop();
      const expiredAt = Date.now() - 1;
      await f.configureMeaningLaunch(expiredAt, expiredAt);
      await expect(f.start('standard-meaning', true)).rejects.toThrow(
        'Invalid fixed Surfer meaning review launch profile.',
      );
      await f.configureMeaningLaunch(expiredAt - 1000, expiredAt);
      await f.start('standard-meaning', true);
      const expired = await f.post('/api/v1/surfer/execution/readiness', {});
      expect(expired.code).toBe(200);
      expect(expired.body.state).toBe('RUN_EXPIRED');
      expect(f.control.surfer).toBe(0);
      await f.stop();
      await f.configureMeaningLaunch(Date.now());
      await f.start('standard-meaning', true);
      const readiness = await f.post('/api/v1/surfer/execution/readiness', {});
      expect(readiness.code).toBe(200);
      expect(readiness.body.state).toBe('PROFILE_CONNECTED');
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(f.control.surfer).toBe(0);
      f.control.ask = 0;
    }
    const run = await submit();
    let jobs: {
      state: string;
      code: string | null;
      result: {
        effect: string;
        revision: string;
        assessment: string;
        interpretationLimits?: string[];
        producer: { promptRevision: string };
        scopedDatumComparison?: { observations: { stationId: string; valueLiteral: string }[] };
        scopeEvidence?: { state: string; basis: string; quotes: { quote: string }[] };
        findings?: { counterKinds?: string[]; unitCitations?: { quote: string }[] };
        reportedCounterKinds?: string[];
        scopedTableObservations?: { scopeLiteral: string; valueLiteral: string; unit: string }[];
      };
      work: { selections: unknown[] };
    }[] = [];
    for (let i = 0; i < 600; i++) {
      jobs = (await pool.query(jobSql, [run])).rows;
      if (jobs[0]?.state === 'COMPLETED' || jobs[0]?.state === 'BLOCKED') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const launchState =
      launch && !jobs.length
        ? (
            await pool.query(
              `SELECT r.state, p.receipt->>'status' AS proposal, i.attempt_id IS NOT NULL AS intent, d.code AS delivery
           FROM frontend_ask.answer_runs r
           LEFT JOIN frontend_ask.surfer_meaning_proposals p ON p.answer_run_id=r.answer_run_id
           LEFT JOIN surfer_meaning.intent i ON i.attempt_id=p.attempt_id
           LEFT JOIN surfer_meaning.intent_delivery d ON d.attempt_id=i.attempt_id WHERE r.answer_run_id=$1`,
              [run],
            )
          ).rows
        : undefined;
    expect(jobs, JSON.stringify(launchState)).toHaveLength(1);
    expect(jobs[0]!.state, JSON.stringify({ code: jobs[0]!.code, sends: f.control.surfer })).toBe(
      'COMPLETED',
    );
    expect(jobs[0]!.work.selections).toHaveLength(2);
    expect(jobs[0]!.result.effect).toBe('NO_RULE_OR_KNOWLEDGE_CHANGE');
    expect(jobs[0]!.result.revision).toBe(
      v2 ? 'surfer.meaning-cross-review.v2' : 'surfer.meaning-cross-review.v1',
    );
    if (v2)
      expect(jobs[0]!.result.assessment).toBe(
        sameScopeConflict
          ? 'MODEL_CONTRADICTED_UNVERIFIED'
          : adoption && !version
            ? 'MODEL_SUPPORTED_UNVERIFIED'
            : 'MODEL_UNRESOLVED',
      );
    if (version === 'v4') {
      expect(jobs[0]!.result.producer.promptRevision).toBe(SURFER_MEANING_VERIFIER_REVISION_V4);
      expect(jobs[0]!.result.interpretationLimits).toContain('UNIT_CITATION_UNGROUNDED');
    }
    if (version === 'v5') {
      expect(jobs[0]!.result.producer.promptRevision).toBe(SURFER_MEANING_VERIFIER_REVISION_V5);
      expect(jobs[0]!.result.interpretationLimits).toContain('DISTINCT_STATION_DATUM_SCOPES');
      expect(jobs[0]!.result.scopedDatumComparison?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stationId: '9414290', valueLiteral: '5.98' }),
          expect.objectContaining({ stationId: '8518750', valueLiteral: '3.29' }),
        ]),
      );
    }
    if (version === 'v6') {
      expect(jobs[0]!.result.producer.promptRevision).toBe(SURFER_MEANING_VERIFIER_REVISION_V6);
      expect(jobs[0]!.result.scopeEvidence).toMatchObject({
        state: 'DIFFERENT_SCOPE',
        basis: 'EXACT_TABLE_ROWS',
      });
      expect(jobs[0]!.result.scopedTableObservations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ scopeLiteral: 'East depot', valueLiteral: '4.0', unit: 'Cel' }),
          expect.objectContaining({ scopeLiteral: 'West depot', valueLiteral: '8.5', unit: 'Cel' }),
        ]),
      );
    }
    if (version === 'v7') {
      expect(jobs[0]!.result.producer.promptRevision).toBe(SURFER_MEANING_VERIFIER_REVISION_V7);
      expect(jobs[0]!.result.scopeEvidence).toMatchObject({
        state: 'DIFFERENT_SCOPE',
        basis: 'EXACT_OPERATING_CLAUSES',
        quotes: [{ quote: firstClause }, { quote: secondClause }],
      });
      expect(jobs[0]!.result.interpretationLimits).toContain('OPERATING_PHASE_FROM_SOURCE');
    }
    if (version === 'v8') {
      expect(jobs[0]!.result.producer.promptRevision).toBe(SURFER_MEANING_VERIFIER_REVISION_V8);
      expect(jobs[0]!.result.scopeEvidence).toMatchObject({
        state: 'SAME_SCOPE',
        basis: 'MODEL_CITATIONS',
        quotes: [{ quote: conflictScope }, { quote: conflictScope }],
      });
    }
    if (version === 'v9') {
      expect(jobs[0]!.result.producer.promptRevision).toBe(SURFER_MEANING_VERIFIER_REVISION_V9);
      expect(jobs[0]!.result.scopeEvidence).toMatchObject({
        state: 'DIFFERENT_SCOPE',
        basis: 'MODEL_CITATIONS',
      });
      expect(jobs[0]!.result.scopeEvidence?.quotes.map((quote) => quote.quote)).toEqual([
        '야간 교대에',
        '야간 교대에',
        firstOperation,
        secondOperation,
      ]);
      expect(jobs[0]!.result.findings?.counterKinds).toEqual([
        'SCOPE_LIMITATION',
        'SCOPE_LIMITATION',
      ]);
      expect(jobs[0]!.result.reportedCounterKinds).toEqual([
        'SEMANTIC_CONTRADICTION',
        'SEMANTIC_CONTRADICTION',
      ]);
    }
    if (version === 'v10') {
      expect(jobs[0]!.result.producer.promptRevision).toBe(SURFER_MEANING_VERIFIER_REVISION_V10);
      expect(jobs[0]!.result.scopeEvidence).toMatchObject({
        state: 'SAME_SCOPE',
        basis: 'MODEL_CITATIONS',
      });
      expect(jobs[0]!.result.scopeEvidence?.quotes.map((quote) => quote.quote)).toEqual([
        conflictScope,
        conflictScope,
        commonTime,
        commonTime,
        commonException,
        commonException,
      ]);
      expect(jobs[0]!.result.findings?.counterKinds).toEqual(['SEMANTIC_CONTRADICTION']);
      expect(jobs[0]!.result.reportedCounterKinds).toBeUndefined();
    }
    if (mixedValueScope) {
      expect(jobs[0]!.result.producer.promptRevision).toBe(
        version === 'v12'
          ? SURFER_MEANING_VERIFIER_REVISION_V12
          : SURFER_MEANING_VERIFIER_REVISION_V11,
      );
      expect(jobs[0]!.result.scopeEvidence).toMatchObject({
        state: 'DIFFERENT_SCOPE',
        basis: 'MODEL_CITATIONS',
      });
      expect(jobs[0]!.result.scopeEvidence?.quotes.map((quote) => quote.quote)).toEqual(
        version === 'v12'
          ? [...mixedConditions.map((condition) => mixedTime + ' ' + condition), mixedException]
          : [mixedTime, mixedConditions[0], mixedException, mixedTime, mixedConditions[1]],
      );
      if (version === 'v12')
        expect(jobs[0]!.result.interpretationLimits).not.toContain('UNIT_CITATION_UNGROUNDED');
      expect(jobs[0]!.result.findings?.unitCitations).toMatchObject([
        { quote: mixedValues[0] },
        { quote: '12 Cel' },
      ]);
    }
    expect(f.control.surfer).toBe(1);
    expect(f.control.ask).toBe(1);
    if (launch) {
      expect((await pool.query(jobSql, [olderRun])).rowCount).toBe(0);
      await f.stop();
      await f.start('standard-meaning', true);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(f.control.surfer).toBe(1);
      if (upgradedClone && version === 'v12') {
        const {
          rows: [answer],
        } = await pool.query('SELECT state FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
          run,
        ]);
        expect(answer?.state).toBe('SUCCEEDED');
        expect((await pool.query(jobSql, [run])).rows).toEqual(jobs);
        expect(await f.grants()).toEqual(['SETTLED']);
        await writeFile(
          path.join(root, 'app-result.json'),
          JSON.stringify(
            {
              questionHttpStatus: 200,
              answerState: answer.state,
              jobState: jobs[0]!.state,
              promptRevision: jobs[0]!.result.producer.promptRevision,
              scopeState: jobs[0]!.result.scopeEvidence?.state,
              scopeQuotes: jobs[0]!.result.scopeEvidence?.quotes.map(({ quote }) => quote),
              unitQuotes: jobs[0]!.result.findings?.unitCitations?.map(({ quote }) => quote),
              effect: jobs[0]!.result.effect,
              settled: 1,
              fakeAskRequests: f.control.ask,
              fakeReviewRequests: f.control.surfer,
              restartResultUnchanged: true,
              restartAdditionalRequests: 0,
              actualModelRequests: 0,
            },
            null,
            2,
          ) + '\n',
          { flag: 'wx' },
        );
      }

      const { text, ...selection } = await newOrigin('권한 회수 검사에 쓰는 원문입니다.');
      payload.sourceSelections[1] = selection;
      proposedWire.candidates[0]!.sourceQuote = text;
      // Force session loss after the real ledger grants dispatch, before gateway generation.
      const dispatch = SurferExecutionLedger.prototype.dispatch;
      const revoke = vi
        .spyOn(SurferExecutionLedger.prototype, 'dispatch')
        .mockImplementation(async function (
          this: SurferExecutionLedger,
          ...args: Parameters<typeof dispatch>
        ) {
          const claimed = await dispatch.apply(this, args);
          if (claimed.granted)
            await pool.query(
              'UPDATE auth.sessions SET revoked_at=clock_timestamp() WHERE session_id=$1',
              [f.actual.session.sessionId],
            );
          return claimed;
        });
      try {
        const revokedRun = await submit();
        await expect
          .poll(async () => (await pool.query(jobSql, [revokedRun])).rows[0]?.state, {
            timeout: 15000,
          })
          .toBe('BLOCKED');
        const {
          rows: [{ job_id }],
        } = await pool.query(jobSql, [revokedRun]);
        expect(
          (
            await admin.query('SELECT 1 FROM provider_account.grants WHERE operation_id=$1', [
              job_id,
            ])
          ).rowCount,
        ).toBe(0);
        expect(f.control.surfer).toBe(1);
      } finally {
        revoke.mockRestore();
      }
      await f.stop();
      return;
    }
    if (adoption) {
      f.control.meaningWire = undefined;
      f.control.askCitationCount = 3;
      const wait = async (answerRunId: string, state: string) => {
        await expect
          .poll(
            async () =>
              (
                await pool.query(
                  'SELECT state FROM frontend_ask.answer_runs WHERE answer_run_id=$1',
                  [answerRunId],
                )
              ).rows[0].state,
            { timeout: 15000 },
          )
          .toBe(state);
      };
      const applied = await submit();
      await wait(applied, 'SUCCEEDED');
      const appliedRule = f.control.askPrompts[1]!.interpretationMemory!.learnedRules![0]!;
      expect(appliedRule.outcome).toBe('TRUE');
      expect(appliedRule.scenario.grounding.proposalReviews[0]!.crossReviewState).toBe('SUPPORTED');
      const work = decodeSurferMeaningVerificationWork(jobs[0]!.work);
      f.control.onAsk = async () => {
        await new PostgresSurferMeaningQueue(pool).enqueue(
          {
            projectId: work.basis.authority.projectId,
            principalId: work.basis.authority.principalId,
            runId: 'pending-review-during-answer',
            profileDigest: work.profileDigest,
            leaseMs: 30000,
          },
          work,
        );
      };
      const raced = await submit();
      await wait(raced, 'FAILED');
      f.control.onAsk = async () => {};
      const withheld = await submit();
      await wait(withheld, 'SUCCEEDED');
      expect(f.control.askPrompts[3]!.interpretationMemory!.learnedRules![0]!.outcome).toBe(
        'UNKNOWN',
      );
      const changed = await f.actual.source(second.replace('같은', '다른'), {
        sourceId: witness.sourceId,
      });
      const changedMaterial = await raw.withSnapshotV2(
        f.actual.request,
        async (s) => (await s.readMaterialV2(changed.sourceId)).material,
      );
      payload.sourceSelections[2] = {
        sourceId: changed.sourceId,
        sourceVersionId: changed.sourceVersionId,
        evidenceIds: [changedMaterial.rootEvidenceId],
      };
      const counter = await submit();
      await wait(counter, 'SUCCEEDED');
      const counterRule = f.control.askPrompts[4]!.interpretationMemory!.learnedRules![0]!;
      expect(counterRule.outcome).toBe('UNKNOWN');
      expect(counterRule.scenario.grounding.proposalReviews[0]!.crossReviewState).toBe('WITHHELD');
    }
    await f.stop();
    await f.start('native');
    await new Promise((r) => setTimeout(r, 1100));
    expect(f.control.surfer).toBe(1);
    await f.stop();
  }
  it(
    'automatically reviews a completed HTTP Ask through native Vault/account assembly with no manual enqueue',
    () => automaticMeaningCase(),
    60000,
  );
  it(
    'runs native automatic v2 review after HTTP Ask, preserves unresolved observations and restarts without resend',
    () => automaticMeaningCase(true),
    60000,
  );
  it(
    'applies native reviewed declarations and withholds after a concurrent review or Source counter',
    () => automaticMeaningCase(true, true),
    90000,
  );
  it(
    'launches v3 from a profile file, skips earlier questions, and blocks a revoked owner before provider send',
    () => automaticMeaningCase(true, true, true),
    90000,
  );
  it(
    'launches v4 and saves the exact review with the unsupported unit withheld',
    () => automaticMeaningCase(true, true, true, 'v4'),
    90000,
  );
  it(
    'launches v5 and stores distinct station observations from the selected exact records',
    () => automaticMeaningCase(true, true, true, 'v5'),
    90000,
  );
  it(
    'launches v6 and persists separately grounded CSV values without resend',
    () => automaticMeaningCase(true, true, true, 'v6'),
    90000,
  );
  it(
    'launches v7 and stores both operating phases with their valve conditions',
    () => automaticMeaningCase(true, true, true, 'v7'),
    90000,
  );
  it(
    'launches v8 and persists a Korean same-scope conflict with the exact topic particle',
    () => automaticMeaningCase(true, true, true, 'v8'),
    90000,
  );
  it(
    'launches v9 and stores common conditions with grounded scope limitations',
    () => automaticMeaningCase(true, true, true, 'v9'),
    90000,
  );
  it(
    'launches v10 and persists a same-scope conflict with the paired time and exception',
    () => automaticMeaningCase(true, true, true, 'v10'),
    90000,
  );
  it(
    'launches v11 and persists separated scope qualifiers and a uniquely located repeated unit',
    () => automaticMeaningCase(true, true, true, 'v11'),
    90000,
  );
  it(
    'launches v12 and persists separate setting units and scope exceptions',
    () => automaticMeaningCase(true, true, true, 'v12'),
    90000,
  );
  it.each(['normal', 'unknown', 'drain'] as const)(
    'runs a durable explicit meaning review in the real app and preserves it across restart: %s',
    async (scenario) => {
      const f = await setup(),
        learned = await ruleReviewFixture(
          pool,
          principalId,
          root + '/meaning-queue-' + randomUUID(),
          undefined,
          undefined,
          f.actual,
        ),
        origin = await f.actual.source(meaningOrigin),
        witness = await f.actual.source(meaningWitness),
        raw = new PostgresSurferSourceSession(pool);
      const om = await raw.withSnapshotV2(
          f.actual.request,
          async (s) => (await s.readMaterialV2(origin.sourceId)).material,
        ),
        wm = await raw.withSnapshotV2(
          f.actual.request,
          async (s) => (await s.readMaterialV2(witness.sourceId)).material,
        );
      const g = providerFixture(new PostgresSurferExecutionStore(pool)),
        profile = { ...g.profile, promptRevision: SURFER_MEANING_VERIFIER_REVISION },
        policy = { ...g.policy, allowedSpaceIds: [f.actual.projectId] },
        ledger = new SurferExecutionLedger(new PostgresSurferExecutionStore(pool), policy),
        execution = { runId: 'meaning-app-run', profile, ledger, gateway: g.gateway },
        options: SurferMeaningApplicationOptions = {
          execution,
          resolveActor: async () => f.actual.request,
          intervalMs: 1000,
        };
      g.response.rawText = JSON.stringify(meaningReviewWire());
      if (scenario === 'unknown') g.control.generateError = true;
      let entered!: () => void, release!: () => void;
      const sending = new Promise<void>((r) => (entered = r)),
        gate = new Promise<void>((r) => (release = r));
      if (scenario === 'drain') {
        const base = g.gateway.prepare;
        g.gateway.prepare = async (...args) => {
          const p = await base(...args),
            generate = p.generate;
          p.generate = async (signal) => {
            entered();
            await gate;
            return generate(signal);
          };
          return p;
        };
      }
      const question =
        '😀\n' +
        Object.entries(learned.development.cases[0]!.features)
          .map(
            ([n, v]) =>
              `${n === 'temperature' ? '온도' : n}는 ${v.value}${v.unit ? ' ' + v.unit : ''}`,
          )
          .join('이고 ') +
        '입니다. 이 조건을 판단해줘.';
      f.control.meaningWire = {
        state: 'PROPOSED',
        reason: 'meaning queue app fixture',
        candidates: [
          {
            ruleRef: 'R1',
            field: 'temperature',
            label: '온도',
            evidenceRef: 'E2',
            sourceQuote: meaningOrigin,
            questionQuote: '온도',
            scope: 'UNVERIFIED',
          },
        ],
      };
      const manager = createSurferApplicationRuntime(pool, undefined, execution);
      let _app = await f.start('native', true, scenario === 'normal' ? undefined : options);
      const submitted = await f.post('/product-api/frontend/ask/questions', {
        schemaVersion: '1.0.0',
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        question,
        mode: 'SOURCE_EXPLORATION',
        sourceSelections: [
          {
            sourceId: learned.stored.sourceId,
            sourceVersionId: learned.stored.sourceVersionId,
            evidenceIds: [learned.task.selections[0]!.evidenceId],
          },
          {
            sourceId: origin.sourceId,
            sourceVersionId: origin.sourceVersionId,
            evidenceIds: [om.rootEvidenceId],
          },
        ],
      });
      expect(submitted.code).toBe(200);
      const run = submitted.body.submission.answerRun.answerRunId;
      let attempts: { attempt_id: string }[] = [];
      for (let i = 0; i < 500; i++) {
        attempts = (
          await pool.query(
            "SELECT p.attempt_id FROM frontend_ask.surfer_meaning_proposals p JOIN frontend_ask.answer_runs r ON r.answer_run_id=p.answer_run_id WHERE p.answer_run_id=$1 AND r.state='SUCCEEDED'",
            [run],
          )
        ).rows;
        if (attempts.length) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(attempts).toHaveLength(1);
      const input = {
        reference: { attemptId: attempts[0]!.attempt_id, candidateIndex: 0 },
        selections: [
          {
            sourceId: origin.sourceId,
            evidenceId: om.rootEvidenceId,
            start: 0,
            end: unicodeLength(meaningOrigin),
            targetUnit: null,
          },
          {
            sourceId: witness.sourceId,
            evidenceId: wm.rootEvidenceId,
            start: 0,
            end: unicodeLength(meaningWitness),
            targetUnit: null,
          },
        ],
      };
      let queued;
      if (scenario === 'normal') {
        const runtime = createSurferApplicationRuntime(pool, undefined, execution);
        queued = await runtime.meaningReviews.enqueue(f.actual.request, input);
        expect(queued.status).toBe('ENQUEUED');
        if (queued.status !== 'ENQUEUED') throw Error('not configured');
        await new Promise((r) => setTimeout(r, 1100));
        expect(g.control.sends).toBe(0);
        await f.stop();
        _app = await f.start('recovery', false, options);
        await new Promise((r) => setTimeout(r, 1100));
        expect(g.control.sends).toBe(0);
        expect(
          (await pool.query('SELECT state FROM surfer_meaning.job WHERE job_id=$1', [queued.jobId]))
            .rows[0].state,
        ).toBe('READY');
        await f.stop();
        _app = await f.start('native', false, options);
      } else queued = await manager.meaningReviews.enqueue(f.actual.request, input);
      expect(queued.status).toBe('ENQUEUED');
      if (queued.status !== 'ENQUEUED') throw Error('not configured');
      if (scenario === 'drain') {
        await sending;
        let closed = false;
        const closing = f.stop().then(() => {
          closed = true;
        });
        await new Promise((r) => setTimeout(r, 20));
        expect(closed).toBe(false);
        release();
        await closing;
      } else {
        for (let i = 0; i < 500; i++) {
          const row = (
            await pool.query('SELECT state FROM surfer_meaning.job WHERE job_id=$1', [queued.jobId])
          ).rows[0];
          if (['COMPLETED', 'BLOCKED'].includes(row.state)) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        await f.stop();
      }
      const saved = (
        await pool.query('SELECT state,code,work,result FROM surfer_meaning.job WHERE job_id=$1', [
          queued.jobId,
        ])
      ).rows[0];
      expect(saved.state).toBe(scenario === 'unknown' ? 'BLOCKED' : 'COMPLETED');
      expect(saved.code).toBe(scenario === 'unknown' ? 'OUTCOME_UNKNOWN' : null);
      if (scenario !== 'unknown') expect(saved.result.effect).toBe('NO_RULE_OR_KNOWLEDGE_CHANGE');
      expect(g.control.sends).toBe(1);
      _app = await f.start('native', false, options);
      await new Promise((r) => setTimeout(r, 1100));
      expect(g.control.sends).toBe(1);
      const replay = await manager.meaningReviews.enqueue(f.actual.request, input);
      if (replay.status !== 'ENQUEUED') throw Error('not configured');
      expect(replay.replayed).toBe(true);
      expect(
        (
          await pool.query(
            'SELECT state,code,work,result FROM surfer_meaning.job WHERE job_id=$1',
            [queued.jobId],
          )
        ).rows[0],
      ).toEqual(saved);
      expect(f.control.ask).toBe(1);
      await f.stop();
    },
  );
  it.each(['scoped', 'invalid-facet', 'changed-source'] as const)(
    'stores unverified ordinary-prose semantic scopes in the real app: %s',
    async (scenario) => {
      const f = await setup(),
        learned = await ruleReviewFixture(
          pool,
          principalId,
          root + '/ask-scope-' + randomUUID(),
          undefined,
          undefined,
          f.actual,
        ),
        prose =
          '😀 장치A에서는 2026년 가동 중이면 온도는 temperature를 뜻하며, 정비 중에는 제외한다.',
        stored = await f.actual.source(prose),
        material = await new PostgresSurferSourceSession(pool).withSnapshotV2(
          f.actual.request,
          async (s) => (await s.readMaterialV2(stored.sourceId)).material,
        );
      const question =
        '😀\n' +
        Object.entries(learned.development.cases[0]!.features)
          .map(
            ([name, v]) =>
              `${name === 'temperature' ? '온도' : name}는 ${v.value}${v.unit ? ' ' + v.unit : ''}`,
          )
          .join('이고 ') +
        '입니다. 이 조건을 판단해줘.';
      f.control.meaningWire = {
        state: 'PROPOSED',
        reason: 'unverified scoped interpretation',
        candidates: [
          {
            ruleRef: 'R1',
            field: 'temperature',
            label: '온도',
            evidenceRef: 'E2',
            sourceQuote: prose,
            questionQuote: '온도',
            scope: 'UNVERIFIED',
          },
        ],
        semanticScopes: [
          {
            candidateIndex: 0,
            relation: 'EQUIVALENT',
            documentRole: 'DEFINITION',
            facets: {
              subject: scenario === 'invalid-facet' ? '다른 장치' : '장치A',
              time: '2026년',
              condition: '가동 중이면',
              exception: '정비 중에는 제외한다',
            },
          },
        ],
      };
      if (scenario === 'changed-source')
        f.control.onAsk = async () => {
          await f.actual.source('Source가 변경되었다.', { sourceId: stored.sourceId });
        };
      await f.start('native', true);
      const submitted = await f.post('/product-api/frontend/ask/questions', {
        schemaVersion: '1.0.0',
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        question,
        mode: 'SOURCE_EXPLORATION',
        sourceSelections: [
          {
            sourceId: learned.stored.sourceId,
            sourceVersionId: learned.stored.sourceVersionId,
            evidenceIds: [learned.task.selections[0]!.evidenceId],
          },
          {
            sourceId: stored.sourceId,
            sourceVersionId: stored.sourceVersionId,
            evidenceIds: [material.rootEvidenceId],
          },
        ],
      });
      expect(submitted.code, JSON.stringify(submitted.body)).toBe(200);
      const runId = submitted.body.submission.answerRun.answerRunId;
      let state = '';
      const end = Date.now() + 25000;
      while (Date.now() < end) {
        state = (
          await pool.query('SELECT state FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
            runId,
          ])
        ).rows[0].state;
        if (['SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(state)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(state).toBe(scenario === 'changed-source' ? 'FAILED' : 'SUCCEEDED');
      expect(f.control.ask).toBe(1);
      expect(f.control.askPrompts[0]!.interpretationMemory!.learnedRules![0]!.outcome).toBe(
        'UNKNOWN',
      );
      const pin = (
        await pool.query(
          'SELECT context FROM frontend_ask.surfer_memory_context WHERE answer_run_id=$1',
          [runId],
        )
      ).rows[0].context;
      expect(pin.revision).toBe('surfer.ask-memory.v7');
      const receipts = (
        await pool.query(
          'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE answer_run_id=$1',
          [runId],
        )
      ).rows;
      expect(receipts.length).toBe(scenario === 'changed-source' ? 0 : 1);
      if (scenario !== 'changed-source') {
        const r = receipts[0].receipt;
        expect(r.revision).toBe('surfer.ask-meaning-proposal.v2');
        expect(r.semanticScopes.assessment).toBe(
          scenario === 'scoped' ? 'ANCHORED_SCOPES_UNVERIFIED' : 'EVIDENCE_REJECTED',
        );
        expect(r.semanticAssessment).toBe('NOT_EVALUATED');
        expect(r.effect).toBe('NO_RULE_OR_KNOWLEDGE_CHANGE');
        if (scenario === 'scoped') {
          expect(r.semanticScopes.frames[0].facets.condition.quote).toBe('가동 중이면');
          await f.stop();
          await f.start('native', true);
          expect(f.control.ask).toBe(1);
          expect(
            (
              await pool.query(
                'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE answer_run_id=$1',
                [runId],
              )
            ).rows,
          ).toEqual(receipts);
          const view = await network(
            f.httpBase() + '/product-api/frontend/ask/answer-runs/' + runId,
            { headers: { cookie: `shotgun_session=${f.actual.session.sessionToken}` } },
          );
          expect(view.status).toBe(200);
          expect((await view.json()).answerRun.state).toBe('SUCCEEDED');
        }
      }
    },
  );
  it.each([
    'corroborated',
    'counter',
    'changed-during-send',
    'scope-dispute',
    'scope-equivalent',
  ] as const)(
    'uses a previous proposal in a later ordinary HTTP question with bounded review: %s',
    async (scenario) => {
      const f = await setup(),
        learned = await ruleReviewFixture(
          pool,
          principalId,
          root + '/ask-adoption-' + randomUUID(),
          undefined,
          undefined,
          f.actual,
        ),
        domain = learned.development.cases[0]!.domain,
        prose = `${domain} 분야에서 온도는 temperature와 같은 NUMBER 값이며 단위는 Cel이다.`,
        origin = await f.actual.source(prose),
        material = await new PostgresSurferSourceSession(pool).withSnapshotV2(
          f.actual.request,
          async (s) => (await s.readMaterialV2(origin.sourceId)).material,
        );
      const question =
        '😀\n' +
        Object.entries(learned.development.cases[0]!.features)
          .map(
            ([name, v]) =>
              `${name === 'temperature' ? '온도' : name}는 ${v.value}${v.unit ? ' ' + v.unit : ''}`,
          )
          .join('이고 ') +
        '입니다. 이 조건을 판단해줘.';
      f.control.meaningWire = {
        state: 'PROPOSED',
        reason: 'candidate declaration',
        candidates: [
          {
            ruleRef: 'R1',
            field: 'temperature',
            label: '온도',
            evidenceRef: 'E2',
            sourceQuote: prose,
            questionQuote: '온도',
            scope: 'UNVERIFIED',
          },
        ],
      };
      if (scenario === 'scope-dispute' || scenario === 'scope-equivalent')
        Object.assign(f.control.meaningWire!, {
          semanticScopes: [
            {
              candidateIndex: 0,
              relation: scenario === 'scope-dispute' ? 'DISTINCT' : 'EQUIVALENT',
              documentRole: 'DEFINITION',
              facets: { subject: null, time: null, condition: null, exception: null },
            },
          ],
        });
      const selections = [
        {
          sourceId: learned.stored.sourceId,
          sourceVersionId: learned.stored.sourceVersionId,
          evidenceIds: [learned.task.selections[0]!.evidenceId],
        },
        {
          sourceId: origin.sourceId,
          sourceVersionId: origin.sourceVersionId,
          evidenceIds: [material.rootEvidenceId],
        },
      ];
      await f.start('native', true);
      const submit = async () => {
        const r = await f.post('/product-api/frontend/ask/questions', {
          schemaVersion: '1.0.0',
          clientRequestId: randomUUID(),
          idempotencyKey: randomUUID(),
          question,
          mode: 'SOURCE_EXPLORATION',
          sourceSelections: selections,
        });
        expect(r.code, JSON.stringify(r.body)).toBe(200);
        return r.body.submission.answerRun.answerRunId as string;
      };
      const wait = async (id: string) => {
        let state = '';
        const end = Date.now() + 25000;
        while (Date.now() < end) {
          state = (
            await pool.query('SELECT state FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
              id,
            ])
          ).rows[0].state;
          if (['SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(state)) return state;
          await new Promise((r) => setTimeout(r, 50));
        }
        return state;
      };
      const first = await submit();
      expect(await wait(first)).toBe('SUCCEEDED');
      expect(f.control.askPrompts[0]!.interpretationMemory!.learnedRules![0]!.outcome).toBe(
        'UNKNOWN',
      );
      const receipt = (
        await pool.query(
          'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE answer_run_id=$1',
          [first],
        )
      ).rows[0].receipt;
      const witnessText = `${domain} 분야에서 온도는 temperature와 ${scenario === 'counter' ? '다른' : '같은'} NUMBER 값을 가리키며 단위는 Cel이다.`,
        witness = await f.actual.source(witnessText),
        wm = await new PostgresSurferSourceSession(pool).withSnapshotV2(
          f.actual.request,
          async (s) => (await s.readMaterialV2(witness.sourceId)).material,
        );
      selections.push({
        sourceId: witness.sourceId,
        sourceVersionId: witness.sourceVersionId,
        evidenceIds: [wm.rootEvidenceId],
      });
      f.control.meaningWire = undefined;
      f.control.askCitationCount = 3;
      if (scenario === 'changed-during-send')
        f.control.onAsk = async () => {
          if (f.control.ask === 2)
            await f.actual.source(witnessText.replace('같은', '다른'), {
              sourceId: witness.sourceId,
            });
        };
      const second = await submit();
      expect(await wait(second)).toBe(scenario === 'changed-during-send' ? 'FAILED' : 'SUCCEEDED');
      expect(f.control.ask).toBe(2);
      expect(f.control.askPrompts[1]!.interpretationMemory!.learnedRules![0]!.outcome).toBe(
        scenario === 'counter' || scenario === 'scope-dispute' ? 'UNKNOWN' : 'TRUE',
      );
      const context = (
        await pool.query(
          'SELECT context FROM frontend_ask.surfer_memory_context WHERE answer_run_id=$1',
          [second],
        )
      ).rows[0].context;
      expect(context.revision).toBe('surfer.ask-memory.v9');
      expect(context.packet.rules[0].grounding.reviews[0].revision).toBe(
        'surfer.ask-meaning-review.v3',
      );
      expect(
        f.control.askPrompts[1]!.interpretationMemory!.learnedRules![0]!.scenario.grounding
          .proposalReviews[0]!.scopeAssessment,
      ).toBe(
        scenario === 'counter' || scenario === 'scope-dispute'
          ? 'UNVERIFIED_SCOPE'
          : 'TYPED_DECLARATIONS_ONLY',
      );
      expect(context.packet.rules[0].grounding.reviews[0].assessment).toBe(
        scenario === 'counter'
          ? 'CONTRADICTED'
          : scenario === 'scope-dispute'
            ? 'UNSUPPORTED'
            : 'SOURCE_CORROBORATED_DECLARATION_ONLY',
      );
      expect(
        (
          await pool.query(
            'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE answer_run_id=$1',
            [first],
          )
        ).rows[0].receipt,
      ).toEqual(receipt);
      const citations = (
        await pool.query(
          'SELECT count(*)::int AS n FROM frontend_ask.citations c JOIN frontend_ask.statements s ON s.statement_id=c.statement_id WHERE s.answer_run_id=$1',
          [second],
        )
      ).rows[0].n;
      expect(citations).toBe(scenario === 'changed-during-send' ? 0 : 3);
      if (
        scenario === 'corroborated' ||
        scenario === 'scope-dispute' ||
        scenario === 'scope-equivalent'
      ) {
        await f.stop();
        await f.start('native', true);
        expect(f.control.ask).toBe(2);
        const view = await network(
          f.httpBase() + '/product-api/frontend/ask/answer-runs/' + second,
          { headers: { cookie: `shotgun_session=${f.actual.session.sessionToken}` } },
        );
        expect(view.status).toBe(200);
        expect((await view.json()).answerRun.state).toBe('SUCCEEDED');
        expect(
          (
            await pool.query(
              'SELECT context FROM frontend_ask.surfer_memory_context WHERE answer_run_id=$1',
              [second],
            )
          ).rows[0].context,
        ).toEqual(context);
      }
    },
  );
  it.each(['proposed', 'bad-anchor', 'changed-source', 'malformed-answer'] as const)(
    'journals ordinary prose meaning proposals through the actual app HTTP: %s',
    async (scenario) => {
      const f = await setup(),
        learned = await ruleReviewFixture(
          pool,
          principalId,
          root + '/ask-discovery-' + randomUUID(),
          undefined,
          undefined,
          f.actual,
        ),
        prose = '이 문서에서 온도는 temperature를 가리킨다.',
        stored = await f.actual.source(prose);
      const material = await new PostgresSurferSourceSession(pool).withSnapshotV2(
          f.actual.request,
          async (s) => (await s.readMaterialV2(stored.sourceId)).material,
        ),
        question =
          '😀 ' +
          Object.entries(learned.development.cases[0]!.features)
            .map(
              ([name, v]) =>
                `${name === 'temperature' ? '온도' : name}는 ${v.value}${v.unit ? ' ' + v.unit : ''}`,
            )
            .join('이고 ') +
          '입니다. 이 조건을 판단해줘.';
      f.control.meaningWire = {
        state: 'PROPOSED',
        reason: 'possible definition in prose',
        candidates: [
          {
            ruleRef: 'R1',
            field: 'temperature',
            label: '온도',
            evidenceRef: 'E2',
            sourceQuote: scenario === 'bad-anchor' ? 'invented quote' : prose,
            questionQuote: '온도',
            scope: 'UNVERIFIED',
          },
        ],
      };
      if (scenario === 'changed-source')
        f.control.onAsk = async () => {
          await f.actual.source('원문 변경', { sourceId: stored.sourceId });
        };
      f.control.badAsk = scenario === 'malformed-answer';
      await f.start('native', true);
      const submitted = await f.post('/product-api/frontend/ask/questions', {
        schemaVersion: '1.0.0',
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        question,
        mode: 'SOURCE_EXPLORATION',
        sourceSelections: [
          {
            sourceId: learned.stored.sourceId,
            sourceVersionId: learned.stored.sourceVersionId,
            evidenceIds: [learned.task.selections[0]!.evidenceId],
          },
          {
            sourceId: stored.sourceId,
            sourceVersionId: stored.sourceVersionId,
            evidenceIds: [material.rootEvidenceId],
          },
        ],
      });
      expect(submitted.code, JSON.stringify(submitted.body)).toBe(200);
      const runId = submitted.body.submission.answerRun.answerRunId;
      let state = '';
      const end = Date.now() + 25000;
      while (Date.now() < end) {
        state = (
          await pool.query('SELECT state FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
            runId,
          ])
        ).rows[0].state;
        if (['SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(state)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const failed = ['changed-source', 'malformed-answer'].includes(scenario);
      expect(state).toBe(failed ? 'FAILED' : 'SUCCEEDED');
      expect(f.control.ask).toBe(1);
      expect(f.control.askPrompts[0]!.meaningDiscovery).toBeDefined();
      expect(f.control.askPrompts[0]!.interpretationMemory!.learnedRules![0]!.outcome).toBe(
        'UNKNOWN',
      );
      const journal = (
        await pool.query(
          'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE answer_run_id=$1',
          [runId],
        )
      ).rows;
      expect(journal.length).toBe(failed ? 0 : 1);
      if (!failed) {
        expect(journal[0].receipt.assessment).toBe(
          scenario === 'proposed' ? 'ANCHORED_CANDIDATES_UNVERIFIED' : 'EVIDENCE_REJECTED',
        );
        expect(journal[0].receipt.effect).toBe('NO_RULE_OR_KNOWLEDGE_CHANGE');
        const view = await network(
          f.httpBase() + '/product-api/frontend/ask/answer-runs/' + runId,
          { headers: { cookie: `shotgun_session=${f.actual.session.sessionToken}` } },
        );
        expect(view.status).toBe(200);
        expect((await view.json()).answerRun.state).toBe('SUCCEEDED');
        await f.stop();
        await f.start('native', true);
        expect(
          (
            await pool.query(
              'SELECT receipt FROM frontend_ask.surfer_meaning_proposals WHERE answer_run_id=$1',
              [runId],
            )
          ).rows,
        ).toEqual(journal);
        expect(f.control.ask).toBe(1);
      }
    },
  );
  it.each([
    'applied',
    'missing',
    'review-during-send',
    'sentence',
    'sentence-ambiguous',
    'sentence-alias',
    'sentence-negated',
    'meaning',
    'meaning-conflict',
    'meaning-scope',
    'meaning-changed',
  ] as const)(
    'answers an ordinary HTTP question with server checked learned RULE: %s',
    async (scenario) => {
      const f = await setup(),
        learned = await ruleReviewFixture(
          pool,
          principalId,
          root + '/ask-rule-' + randomUUID(),
          undefined,
          undefined,
          f.actual,
        );
      await f.start('native', true);
      if (scenario === 'review-during-send')
        f.control.onAsk = async () => {
          const g = await learned.ground(learned.observation());
          await learned.review.review(f.actual.request, learned.command(g));
        };
      let question =
        '이 자료에서 학습한 규칙으로 조건을 판단해줘.' +
        (scenario === 'missing'
          ? ''
          : '\n' +
            Object.entries(learned.development.cases[0]!.features)
              .map(([k, v]) => `${k}=${JSON.stringify(v.value)}${v.unit ? ' ' + v.unit : ''}`)
              .join('\n'));
      if (scenario.startsWith('sentence')) {
        question =
          '😀\n' +
          Object.entries(learned.development.cases[0]!.features)
            .map(([name, v]) => `${name}는 ${v.value}${v.unit ? ' ' + v.unit : ''}`)
            .join('이고 ') +
          '입니다. 이 조건을 판단해줘.';
        if (scenario === 'sentence-alias') question = question.replace('temperature', '온도');
        if (scenario === 'sentence-ambiguous') question += ' temperature는 999 Cel.';
        if (scenario === 'sentence-negated') question += ' 이 값은 사실이 아니다.';
      }
      const selections = [
        {
          sourceId: learned.stored.sourceId,
          sourceVersionId: learned.stored.sourceVersionId,
          evidenceIds: [learned.task.selections[0]!.evidenceId],
        },
      ];
      let definitionEvidenceId: string | undefined;
      if (scenario.startsWith('meaning')) {
        const labels: Record<string, string> = {
            temperature: '온도',
            humidity: '습도',
            materialGrade: '재료등급',
          },
          definition = {
            contract: 'surfer.rule-field-lexicon.v1',
            domain: learned.development.cases[0]!.domain,
            subject: scenario === 'meaning-scope' ? 'Device A' : null,
            time: null,
            fields: Object.entries(learned.development.cases[0]!.features).map(([name, v]) => ({
              name,
              type:
                typeof v.value === 'number'
                  ? 'NUMBER'
                  : typeof v.value === 'boolean'
                    ? 'BOOLEAN'
                    : 'TEXT',
              unit: v.unit ?? null,
              aliases: [labels[name]!],
            })),
          };
        if (scenario === 'meaning-conflict')
          definition.fields.find((f) => f.name === 'humidity')!.aliases.push('온도');
        const stored = await learned.actual.source(JSON.stringify(definition)),
          material = await new PostgresSurferSourceSession(pool).withSnapshotV2(
            learned.actual.request,
            async (s) => (await s.readMaterialV2(stored.sourceId)).material,
          );
        definitionEvidenceId = material.rootEvidenceId;
        selections.push({
          sourceId: stored.sourceId,
          sourceVersionId: stored.sourceVersionId,
          evidenceIds: [material.rootEvidenceId],
        });
        question =
          Object.entries(learned.development.cases[0]!.features)
            .map(([name, v]) => `${labels[name]}는 ${v.value}${v.unit ? ' ' + v.unit : ''}`)
            .join('이고 ') + '입니다. 이 조건을 판단해줘.';
        if (scenario === 'meaning-changed')
          f.control.onAsk = async () => {
            await learned.actual.source(
              JSON.stringify({ ...definition, subject: 'changed scope' }),
              { sourceId: stored.sourceId },
            );
          };
      }
      const submitted = await f.post('/product-api/frontend/ask/questions', {
        schemaVersion: '1.0.0',
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        question,
        mode: 'SOURCE_EXPLORATION',
        sourceSelections: selections,
      });
      expect(submitted.code, JSON.stringify(submitted.body)).toBe(200);
      const runId = submitted.body.submission.answerRun.answerRunId;
      let state = '';
      const end = Date.now() + 25000;
      while (Date.now() < end) {
        state = (
          await pool.query('SELECT state FROM frontend_ask.answer_runs WHERE answer_run_id=$1', [
            runId,
          ])
        ).rows[0].state;
        if (['SUCCEEDED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(state)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const failed = ['review-during-send', 'meaning-changed'].includes(scenario);
      expect(state).toBe(failed ? 'FAILED' : 'SUCCEEDED');
      expect(f.control.ask).toBe(1);
      expect(f.control.askPrompts[0]!.interpretationMemory!.learnedRules![0]).toMatchObject({
        state: 'ACTIVE',
        outcome: [
          'missing',
          'sentence-ambiguous',
          'sentence-alias',
          'sentence-negated',
          'meaning-conflict',
          'meaning-scope',
        ].includes(scenario)
          ? 'UNKNOWN'
          : 'TRUE',
      });
      const pin = (
        await pool.query(
          'SELECT context FROM frontend_ask.surfer_memory_context WHERE answer_run_id=$1',
          [runId],
        )
      ).rows[0].context;
      expect(pin.revision).toBe(
        [
          'missing',
          'sentence-ambiguous',
          'sentence-alias',
          'sentence-negated',
          'meaning-conflict',
          'meaning-scope',
        ].includes(scenario)
          ? 'surfer.ask-memory.v7'
          : scenario.startsWith('meaning')
            ? 'surfer.ask-memory.v4'
            : 'surfer.ask-memory.v3',
      );
      expect(pin.packet.rules).toHaveLength(1);
      expect(pin.packet.rules[0].grounding.questionDigest).toBe(surferDigest(question));
      if (scenario === 'sentence') expect(pin.packet.rules[0].grounding.bindings).toHaveLength(3);
      const citations = (
        await pool.query(
          'SELECT count(*)::int AS n FROM frontend_ask.citations c JOIN frontend_ask.statements s ON s.statement_id=c.statement_id WHERE s.answer_run_id=$1',
          [runId],
        )
      ).rows[0].n;
      expect(citations).toBe(failed ? 0 : scenario.startsWith('meaning') ? 2 : 1);
      const visible = await network(
        f.httpBase() + '/product-api/frontend/ask/answer-runs/' + runId,
        { headers: { cookie: `shotgun_session=${f.actual.session.sessionToken}` } },
      );
      expect(visible.status).toBe(200);
      const view = await visible.json();
      expect(view.answerRun.state).toBe(state);
      if (!failed) {
        const observed = view.answerRun.statements[0].citations.find(
          (c: { evidenceId: string }) => c.evidenceId === learned.task.selections[0]!.evidenceId,
        );
        expect(observed).toBeDefined();
        expect(observed.exactQuote).toBeUndefined();
        if (definitionEvidenceId)
          expect(
            view.answerRun.statements[0].citations.some(
              (c: { evidenceId: string }) => c.evidenceId === definitionEvidenceId,
            ),
          ).toBe(true);
        expect(
          (
            await pool.query(
              'SELECT max(length(c.exact_quote)) AS n FROM frontend_ask.citations c JOIN frontend_ask.statements s ON s.statement_id=c.statement_id WHERE s.answer_run_id=$1',
              [runId],
            )
          ).rows[0].n,
        ).toBeGreaterThan(10000);
      }
      if (scenario === 'applied' || scenario === 'sentence' || scenario === 'meaning') {
        await f.stop();
        await f.start('native', true);
        expect(
          (
            await pool.query(
              'SELECT context FROM frontend_ask.surfer_memory_context WHERE answer_run_id=$1',
              [runId],
            )
          ).rows[0].context,
        ).toEqual(pin);
        expect(f.control.ask).toBe(1);
      }
    },
  );
  it('starts the existing Ask worker and memory intake under the common host while retaining cited memory output', async () => {
    const f = await setup(),
      app = await f.start('native', true);
    expect(app.askWorkerStarted).toBe(true);
    await f.submit();
    await f.wait('COMPLETED');
    const catalog = await f.post('/api/v1/surfer/memory/catalog', {});
    expect(catalog.code).toBe(200);
    expect(catalog.body.items).toHaveLength(1);
    expect(f.control.surfer).toBe(1);
    expect(await f.grants()).toEqual(['SETTLED']);
    await f.stop();
    await f.start('native', true);
    expect((await f.post('/api/v1/surfer/memory/catalog', {})).body.snapshot).toEqual(
      catalog.body.snapshot,
    );
    expect(f.control.surfer).toBe(1);
    await writeFile(
      root + '/unified-host.json',
      JSON.stringify({
        commonHost: true,
        existingAskWorkerStarted: true,
        realIntakeMemory: true,
        restartPreserved: true,
        extraSurferSend: 0,
        modelCalls: 0,
        unifiedNaturalQuestion: false,
        wholeEngine: false,
      }),
    );
  });
  it('preserves an enabled existing Ask worker without native learning and disabled recovery workers', async () => {
    const f = await setup(),
      app = await f.start('default', true);
    expect(app.askWorkerStarted).toBe(true);
    expect((await f.post('/api/v1/surfer/execution/readiness', {})).body.state).toBe(
      'NOT_CONFIGURED',
    );
    await f.stop();
    expect((await f.start('recovery')).askWorkerStarted).toBe(false);
    expect(f.control.surfer).toBe(0);
    expect(await f.grants()).toEqual([]);
  });
  it('serves real HTTP intake through actual resolver/Vault/scheduler to memory and a cited guided answer', async () => {
    const f = await setup();
    await f.start();
    await f.submit();
    await f.wait('COMPLETED');
    const catalog = await f.post('/api/v1/surfer/memory/catalog', {});
    expect(catalog.code).toBe(200);
    const c = catalog.body as SurferGuidedCatalog;
    expect(c.items).toHaveLength(1);
    const answer = await f.post('/api/v1/surfer/memory/guided-ask', {
      schemaVersion: '1.0.0',
      snapshot: c.snapshot,
      memory: c.items[0]!.memory,
      kind: 'RECALL',
      observations: [],
      atDate: null,
    });
    expect(answer.code).toBe(200);
    expect(answer.body.status).toBe('ANSWER');
    expect(answer.body.answers[0].citations.length).toBeGreaterThan(0);
    expect(f.control.surfer).toBe(1);
    expect(await f.grants()).toEqual(['SETTLED']);
    await writeFile(
      root + '/path.json',
      JSON.stringify({
        actualApplicationStartup: true,
        realHttp: true,
        realSourceIntake: true,
        realEffectiveResolver: true,
        realVaultWithFakeSecret: true,
        realScheduler: true,
        memoryAndCitations: true,
        fakeSurferHttp: f.control.surfer,
        fakeOtherHttp: f.control.other,
        actualModel: 0,
        browser: false,
      }),
    );
  });
  it('retains malformed JSON response in a FAILED_KNOWN checkpoint and settles instead of UNKNOWN', async () => {
    const f = await setup();
    f.control.raw = '{"interpretation":}}';
    await f.start();
    await f.submit();
    await f.wait('BLOCKED');
    const q = await pool.query(
      'SELECT payload FROM surfer_execution.budget_state WHERE budget_id=$1',
      [f.execution.policy.budgetId],
    );
    expect(JSON.stringify(q.rows[0].payload)).toContain('FAILED_KNOWN');
    expect(q.rows[0].payload.records[0].checkpoint.response.rawText).toBe(f.control.raw);
    expect(q.rows[0].payload.records[0].usage).toMatchObject({
      calls: 1,
      inputTokens: 4,
      outputTokens: 3,
    });
    expect(await f.grants()).toEqual(['SETTLED']);
    expect(f.control.surfer).toBe(1);
  });
  it('keeps default and recovery startup inactive and consumes the preserved inbox on explicit native restart', async () => {
    const f = await setup();
    await f.start('default');
    await f.submit();
    await f.wait('READY');
    expect((await f.post('/api/v1/surfer/intake/status', {})).body.executionConfigured).toBe(false);
    await f.stop();
    const original = f.execution.authorityDatabaseUrl;
    f.execution.authorityDatabaseUrl = 'invalid-must-not-be-opened';
    await f.start('recovery');
    expect((await f.post('/api/v1/surfer/intake/status', {})).body.executionConfigured).toBe(false);
    expect(f.control.surfer).toBe(0);
    expect(await f.grants()).toEqual([]);
    await f.stop();
    f.execution.authorityDatabaseUrl = original;
    await f.start();
    await f.wait('COMPLETED');
    expect(f.control.surfer).toBe(1);
    expect(await f.grants()).toEqual(['SETTLED']);
  });
  it('retains memory and the exact cited answer across normal application shutdown and restart without another send', async () => {
    const f = await setup();
    await f.start();
    await f.submit();
    await f.wait('COMPLETED');
    const before = await f.post('/api/v1/surfer/memory/catalog', {});
    const originalCatalog = before.body as SurferGuidedCatalog;
    const beforeAnswer = await f.post('/api/v1/surfer/memory/guided-ask', {
      schemaVersion: '1.0.0',
      snapshot: originalCatalog.snapshot,
      memory: originalCatalog.items[0]!.memory,
      kind: 'RECALL',
      observations: [],
      atDate: null,
    });
    await f.stop();
    await f.start();
    const after = await f.post('/api/v1/surfer/memory/catalog', {});
    expect(after.body).toEqual(before.body);
    const c = after.body as SurferGuidedCatalog;
    const answer = await f.post('/api/v1/surfer/memory/guided-ask', {
      schemaVersion: '1.0.0',
      snapshot: c.snapshot,
      memory: c.items[0]!.memory,
      kind: 'RECALL',
      observations: [],
      atDate: null,
    });
    expect(answer.body.status).toBe('ANSWER');
    expect(answer.body.semanticAssessment).toBe('NOT_EVALUATED');
    expect(answer.body).toEqual(beforeAnswer.body);
    expect(f.control.surfer).toBe(1);
    expect(await f.grants()).toEqual(['SETTLED']);
  });
  it('drains an in-flight native provider response and memory commit before closing the application', async () => {
    const f = await setup();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => {
        enter = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    f.control.onSend = async () => {
      enter();
      await gate;
    };
    await f.start();
    await f.submit();
    await Promise.race([
      entered,
      new Promise((_, reject) => setTimeout(() => reject(Error('Provider not entered')), 15000)),
    ]);
    let closed = false;
    const closing = f.stop().then(() => {
      closed = true;
    });
    try {
      await new Promise((r) => setTimeout(r, 100));
      expect(closed).toBe(false);
    } finally {
      release();
      await closing;
    }
    expect((await f.job()).state).toBe('COMPLETED');
    expect(await f.grants()).toEqual(['SETTLED']);
    await f.start();
    const c = await f.post('/api/v1/surfer/memory/catalog', {});
    expect(c.body.items).toHaveLength(1);
    expect(f.control.surfer).toBe(1);
  });
  it('recovers a failed completion acknowledgement after real app restart using the stored checkpoint with zero extra sends', async () => {
    const f = await setup();
    await f.start('default');
    await f.submit();
    await f.wait('READY');
    await f.stop();
    await pool.query(
      "CREATE FUNCTION surfer_intake.app_fail_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated app completion ack failure'; END $$; CREATE TRIGGER app_fail_ack BEFORE UPDATE ON surfer_intake.job FOR EACH ROW WHEN(NEW.state='COMPLETED') EXECUTE FUNCTION surfer_intake.app_fail_ack()",
    );
    try {
      await f.start();
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline && (await f.grants())[0] !== 'SETTLED')
        await new Promise((r) => setTimeout(r, 50));
      expect(await f.grants()).toEqual(['SETTLED']);
      await f.stop();
      expect((await f.job()).state).toBe('RUNNING');
    } finally {
      await pool.query(
        'DROP TRIGGER app_fail_ack ON surfer_intake.job; DROP FUNCTION surfer_intake.app_fail_ack()',
      );
    }
    await pool.query(
      "UPDATE surfer_intake.job SET lease_until=clock_timestamp()-interval '1 second',revision=revision+1 WHERE project_id=$1 AND state='RUNNING'",
      [f.actual.projectId],
    );
    await f.start();
    await f.wait('COMPLETED');
    expect(f.control.surfer).toBe(1);
    expect(await f.grants()).toEqual(['SETTLED']);
  });
  it('preserves an uncertain provider grant and UNKNOWN across actual application restart without redispatch', async () => {
    const f = await setup();
    f.control.uncertain = true;
    await f.start();
    await f.submit();
    await f.wait('BLOCKED');
    await f.stop();
    await f.start();
    const status = await f.post('/api/v1/surfer/intake/status', {});
    expect(status.body.items[0]).toMatchObject({
      state: 'BLOCKED',
      code: 'OUTCOME_UNKNOWN',
      recovery: 'UNAVAILABLE',
    });
    expect(await f.grants()).toEqual(['AUTHORIZED']);
    expect(f.control.surfer).toBe(1);
    const q = await pool.query(
      'SELECT payload FROM surfer_execution.budget_state WHERE budget_id=$1',
      [f.execution.policy.budgetId],
    );
    expect(q.rows[0].payload.records[0].state).toBe('OUTCOME_UNKNOWN');
  });
  it('pauses waiting work after owner withdrawal and resumes only when current owner authority returns', async () => {
    const f = await setup();
    await f.start('default');
    await f.submit();
    await f.wait('READY');
    await f.stop();
    await pool.query('UPDATE auth.project_memberships SET is_owner=false WHERE project_id=$1', [
      f.actual.projectId,
    ]);
    await f.start();
    await new Promise((r) => setTimeout(r, 1300));
    expect((await f.job()).state).toBe('READY');
    expect(f.control.surfer).toBe(0);
    expect(await f.grants()).toEqual([]);
    await pool.query('UPDATE auth.project_memberships SET is_owner=true WHERE project_id=$1', [
      f.actual.projectId,
    ]);
    await f.wait('COMPLETED');
    expect(f.control.surfer).toBe(1);
  });
  it('refuses the old fixed binding after key replacement or registration expiry without granting or sending', async () => {
    for (const change of ['key', 'expiry']) {
      const f = await setup();
      await f.start('default');
      await f.submit();
      await f.wait('READY');
      await f.stop();
      if (change === 'key')
        await f.vault.replace({
          projectId: f.actual.projectId,
          providerId: 'deepseek',
          credentialId: f.metadata.credentialId,
          expectedRevision: 1,
          secret: 'ISOLATED_REPLACED_NOT_A_REAL_KEY',
        });
      else
        await admin.query(
          "UPDATE provider_account.registrations SET expires_at=clock_timestamp()-interval '1 second' WHERE registration_id=$1",
          [f.config.registrationId],
        );
      await f.start();
      await new Promise((r) => setTimeout(r, 1300));
      expect((await f.job()).state).toBe('READY');
      expect(f.control.surfer).toBe(0);
      expect(await f.grants()).toEqual([]);
      await f.stop();
    }
  });
  it('protects the real application memory and intake endpoints with session and CSRF while keeping metadata private', async () => {
    const f = await setup();
    await f.start();
    await f.submit();
    await f.wait('COMPLETED');
    expect((await f.post('/api/v1/surfer/intake/status', {}, false)).code).not.toBe(200);
    expect((await f.post('/api/v1/surfer/memory/catalog', {}, false)).code).not.toBe(200);
    expect((await f.post('/api/v1/surfer/intake/status', {}, true, false)).code).not.toBe(200);
    expect((await f.post('/api/v1/surfer/memory/catalog', {}, true, false)).code).not.toBe(200);
    const status = await f.post('/api/v1/surfer/intake/status', {});
    expect(status.code).toBe(200);
    expect(JSON.stringify(status.body)).not.toMatch(
      /credential|postgres|receipt|profile|lease_token|sessionToken/i,
    );
    expect(
      (await f.post('/api/v1/surfer/intake/status', { actor: f.actual.request })).code,
    ).not.toBe(200);
    expect(f.control.surfer).toBe(1);
  });
  it('explicitly replaces the account registration after a key/config change and app drain, then processes the original READY source once', async () => {
    const f = await setup();
    await f.start('default');
    await f.submit();
    await f.wait('READY');
    await f.stop();
    const adminPort = new PostgresSurferRegistrationAdmin(admin),
      before = await adminPort.inspect(f.config, f.actual.projectId);
    const secret = Buffer.from('ISOLATED_REBIND_NOT_A_REAL_KEY_' + randomUUID());
    const metadata = await f.vault.replace({
      projectId: f.actual.projectId,
      providerId: 'deepseek',
      credentialId: f.metadata.credentialId,
      expectedRevision: 1,
      secret,
    });
    expect(
      await f.repository.saveRevision({
        expectedRevision: 1,
        next: {
          ...f.current,
          credentialRevision: metadata.credentialRevision,
          aiConfigurationRevision: 2,
          updatedAt: new Date().toISOString(),
        },
      }),
    ).toBe('UPDATED');
    await f.standing.save({
      projectId: f.actual.projectId,
      expectedRevision: 1,
      enabled: true,
      providerId: 'deepseek',
      aiConfigurationRevision: 2,
      changedBy: principalId,
    });
    const resolved = await f.resolveIdentity();
    const config = decodeSurferAccountAuthorityConfigV2({
      ...f.config,
      registrationId: randomUUID(),
      profile: {
        ...f.profile,
        revision: 'explicit-rebind-' + randomUUID(),
        identity: resolved.executionIdentity,
        accountFingerprint: createHash('sha256').update(secret).digest('hex'),
      },
    });
    secret.fill(0);
    await f.start();
    await new Promise((r) => setTimeout(r, 1100));
    expect((await f.job()).state).toBe('READY');
    expect(f.control.surfer).toBe(0);
    const command: SurferRegistrationCommand = {
      schemaVersion: '1.0.0',
      commandId: randomUUID(),
      action: 'PUBLISH',
      config,
      projectId: f.actual.projectId,
      expiresAtMs: Date.now() + 3600000,
      expected: before.pin,
    };
    const applied = await registerSurferAccountAfterDrain(
      [{ name: 'owned application', close: f.stop }],
      adminPort,
      command,
    );
    expect(applied.current).toBe(true);
    expect(
      (
        await admin.query(
          'SELECT enabled FROM provider_account.registrations WHERE registration_id=$1',
          [f.config.registrationId],
        )
      ).rows[0].enabled,
    ).toBe(false);
    f.execution.accountConfig = config;
    f.execution.runId = randomUUID();
    f.execution.policy = {
      ...f.execution.policy,
      budgetId: randomUUID(),
      executionIdentity: surferDigest(config.profile.identity),
    };
    await f.start();
    await f.wait('COMPLETED');
    expect(f.control.surfer).toBe(1);
    expect(await f.grants()).toEqual(['SETTLED']);
    expect((await f.post('/api/v1/surfer/memory/catalog', {})).body.items).toHaveLength(1);
    expect(await adminPort.apply(command)).toMatchObject({ replayed: true, current: true });
    await writeFile(
      root + '/rebind.json',
      JSON.stringify({
        actualApplication: true,
        keyAndConfigurationReplaced: true,
        oldRegistrationDisabled: true,
        newRegistrationPublished: true,
        sourceReused: true,
        drainBeforePublish: true,
        fakeSurferHttp: 1,
        actualModel: 0,
        automaticRenewal: false,
      }),
    );
  });
  it('renews a DB-expired registration only by an explicit new registration and fixed run, preserving its original row', async () => {
    const f = await setup();
    await f.start('default');
    await f.submit();
    await f.wait('READY');
    await f.stop();
    await admin.query(
      "UPDATE provider_account.registrations SET expires_at=clock_timestamp()-interval '1 second' WHERE registration_id=$1",
      [f.config.registrationId],
    );
    const operator = new PostgresSurferRegistrationAdmin(admin),
      old = await operator.inspect(f.config, f.actual.projectId);
    expect(old.ready).toBe(false);
    const config = decodeSurferAccountAuthorityConfigV2({
      ...f.config,
      registrationId: randomUUID(),
      profile: { ...f.profile, revision: 'explicit-renewal-' + randomUUID() },
    });
    await registerSurferAccountAfterDrain([], operator, {
      schemaVersion: '1.0.0',
      commandId: randomUUID(),
      action: 'PUBLISH',
      config,
      projectId: f.actual.projectId,
      expiresAtMs: Date.now() + 3600000,
      expected: old.pin,
    });
    const row = (
      await admin.query(
        'SELECT enabled,expires_at::text FROM provider_account.registrations WHERE registration_id=$1',
        [f.config.registrationId],
      )
    ).rows[0];
    expect(row.enabled).toBe(false);
    expect(row.expires_at).toBe(old.expiresAt);
    f.execution.accountConfig = config;
    f.execution.runId = randomUUID();
    f.execution.policy = { ...f.execution.policy, budgetId: randomUUID() };
    await f.start();
    await f.wait('COMPLETED');
    expect(f.control.surfer).toBe(1);
    expect(await f.grants()).toEqual(['SETTLED']);
  });
  it('does not reset or rebind an expired RUNNING job pinned to the previous run/profile when publishing a new registration', async () => {
    const f = await setup();
    await f.start('default');
    await f.submit();
    await f.wait('READY');
    await f.stop();
    await new PostgresSurferIntakeInbox(pool).claim({
      projectId: f.actual.projectId,
      principalId,
      runId: f.execution.runId,
      profileDigest: surferDigest(f.profile),
      leaseMs: 30000,
    });
    await pool.query(
      "UPDATE surfer_intake.job SET lease_until=clock_timestamp()-interval '1 second',revision=revision+1 WHERE project_id=$1 AND state='RUNNING'",
      [f.actual.projectId],
    );
    const before = await f.job(),
      operator = new PostgresSurferRegistrationAdmin(admin),
      state = await operator.inspect(f.config, f.actual.projectId);
    const config = decodeSurferAccountAuthorityConfigV2({
      ...f.config,
      registrationId: randomUUID(),
      profile: { ...f.profile, revision: 'new-fixed-profile-' + randomUUID() },
    });
    await registerSurferAccountAfterDrain([], operator, {
      schemaVersion: '1.0.0',
      commandId: randomUUID(),
      action: 'PUBLISH',
      config,
      projectId: f.actual.projectId,
      expiresAtMs: Date.now() + 3600000,
      expected: state.pin,
    });
    f.execution.accountConfig = config;
    f.execution.runId = randomUUID();
    f.execution.policy = { ...f.execution.policy, budgetId: randomUUID() };
    await f.start();
    const status = await f.post('/api/v1/surfer/intake/status', {});
    expect(status.body.items[0]).toMatchObject({
      state: 'RUNNING',
      recovery: 'CONFIGURATION_MISMATCH',
    });
    expect(await f.job()).toEqual(before);
    expect(f.control.surfer).toBe(0);
    expect(await f.grants()).toEqual([]);
  });
  it('prepares an inactive first root, separately activates and registers it, then processes the original source through the real app', async () => {
    const f = await setup(false);
    await f.start('default');
    await f.submit();
    await f.wait('READY');
    await f.stop();
    const operator = new PostgresSurferAccountBootstrap(admin, {
      workloadDatabaseUrl: target!,
      authorityDatabaseUrl: authorityUrl,
    });
    expect((await operator.inspect(f.config)).state).toBe('ABSENT');
    const command: SurferAccountBootstrapCommand = {
      schemaVersion: '1.0.0',
      commandId: randomUUID(),
      action: 'INITIALIZE',
      config: f.config,
      createStore: false,
      expected: 'ABSENT',
      legacyAuthorityIds: [],
    };
    expect((await bootstrapSurferAccountAfterDrain([], operator, command)).receipt.enabled).toBe(
      false,
    );
    const prepared = await operator.inspect(f.config);
    expect(prepared.state).toBe('INACTIVE');
    await f.start();
    await new Promise((r) => setTimeout(r, 1100));
    expect((await f.job()).state).toBe('READY');
    expect(f.control.surfer).toBe(0);
    await bootstrapSurferAccountAfterDrain(
      [{ name: 'owned application', close: f.stop }],
      operator,
      { ...command, commandId: randomUUID(), action: 'ACTIVATE', expected: prepared.pin! },
    );
    await registerSurferAccountAfterDrain([], new PostgresSurferRegistrationAdmin(admin), {
      schemaVersion: '1.0.0',
      commandId: randomUUID(),
      action: 'PUBLISH',
      config: f.config,
      projectId: f.actual.projectId,
      expiresAtMs: Date.now() + 3600000,
      expected: null,
    });
    await f.start();
    await f.wait('COMPLETED');
    expect(f.control.surfer).toBe(1);
    expect(await f.grants()).toEqual(['SETTLED']);
    expect((await f.post('/api/v1/surfer/memory/catalog', {})).body.items).toHaveLength(1);
    expect(await operator.apply(command)).toMatchObject({ replayed: true, current: false });
    await writeFile(
      root + '/bootstrap.json',
      JSON.stringify({
        realApplication: true,
        unseededRoot: true,
        inactivePreparation: true,
        separateActivation: true,
        registrationViaAdminPort: true,
        sourceReused: true,
        fakeSurferHttp: 1,
        actualModel: 0,
        operatingActivation: false,
      }),
    );
  });
  it('uses the actual browser client and CSRF HTTP to inspect native configuration without Source ingestion,work admission or model calls', async () => {
    const f = await setup();
    await f.start();
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      requests.push(String(input));
      return network(f.httpBase() + String(input), {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          cookie: `shotgun_session=${f.actual.session.sessionToken}`,
        },
      });
    };
    const result = await createSurferReadinessClient(fetcher).inspect();
    expect(result).toEqual({ schemaVersion: '1.0.0', state: 'PROFILE_CONNECTED' });
    expect(requests).toEqual(['/api/v1/security/csrf', '/api/v1/surfer/execution/readiness']);
    expect(f.control.surfer).toBe(0);
    expect(f.control.other).toBe(0);
    expect(await f.grants()).toEqual([]);
    expect(await f.job()).toBeUndefined();
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM surfer_execution.budget_state WHERE budget_id=$1',
          [f.execution.policy.budgetId],
        )
      ).rows[0].n,
    ).toBe(0);
    await writeFile(
      root + '/readiness.json',
      JSON.stringify({
        realApplication: true,
        realClientCsrfHttp: true,
        metadataOnly: true,
        noIngestion: true,
        noBudgetAdmission: true,
        fakeHttp: 0,
        actualModel: 0,
        secretRead: false,
      }),
    );
  });
  it('reports changed configuration,unusable credential,account expiry and run expiry as distinct safe states', async () => {
    for (const [change, expected] of [
      ['configuration', 'CONFIGURATION_CHANGED'],
      ['credential', 'CREDENTIAL_UNAVAILABLE'],
      ['account', 'ACCOUNT_REVIEW_REQUIRED'],
      ['run', 'RUN_EXPIRED'],
    ] as const) {
      const f = await setup();
      if (change === 'configuration')
        await f.repository.saveRevision({
          expectedRevision: 1,
          next: { ...f.current, aiConfigurationRevision: 2, updatedAt: new Date().toISOString() },
        });
      if (change === 'credential')
        await f.vault.revoke({
          projectId: f.actual.projectId,
          providerId: 'deepseek',
          credentialId: f.metadata.credentialId,
          credentialRevision: 1,
        });
      if (change === 'account')
        await admin.query(
          "UPDATE provider_account.registrations SET expires_at=clock_timestamp()-interval '1 second' WHERE registration_id=$1",
          [f.config.registrationId],
        );
      if (change === 'run') f.execution.policy = { ...f.execution.policy, deadlineAtMs: 1 };
      await f.start();
      const r = await f.post('/api/v1/surfer/execution/readiness', {});
      expect(r.code).toBe(200);
      expect(r.body).toEqual({ schemaVersion: '1.0.0', state: expected });
      expect(f.control.surfer).toBe(0);
      expect(await f.grants()).toEqual([]);
      await f.stop();
    }
  });
  it('keeps default and recovery execution visibly unconfigured without activating any account', async () => {
    const f = await setup();
    for (const mode of ['default', 'recovery'] as const) {
      await f.start(mode);
      expect((await f.post('/api/v1/surfer/execution/readiness', {})).body).toEqual({
        schemaVersion: '1.0.0',
        state: 'NOT_CONFIGURED',
      });
      await f.stop();
    }
    expect(f.control.surfer).toBe(0);
    expect(await f.grants()).toEqual([]);
  });
  it('protects readiness with current owner/session/CSRF and does not reveal a binding to another owned project', async () => {
    const f = await setup();
    await f.start();
    expect((await f.post('/api/v1/surfer/execution/readiness', {}, false)).code).not.toBe(200);
    expect((await f.post('/api/v1/surfer/execution/readiness', {}, true, false)).code).not.toBe(
      200,
    );
    for (const payload of [
      { projectId: 'foreign' },
      { actor: f.actual.request },
      { profile: f.profile },
    ])
      expect((await f.post('/api/v1/surfer/execution/readiness', payload)).code).not.toBe(200);
    const foreign = await createSurferSourceFixture(pool, principalId),
      fetcher: typeof fetch = (url, init) =>
        network(f.httpBase() + String(url), {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers).entries()),
            cookie: `shotgun_session=${foreign.session.sessionToken}`,
          },
        });
    expect((await createSurferReadinessClient(fetcher).inspect()).state).toBe('NOT_CONFIGURED');
    await pool.query('UPDATE auth.project_memberships SET is_owner=false WHERE project_id=$1', [
      f.actual.projectId,
    ]);
    expect((await f.post('/api/v1/surfer/execution/readiness', {})).code).not.toBe(200);
    expect(f.control.surfer).toBe(0);
  });
});
