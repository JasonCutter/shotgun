import { createHash, randomUUID } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresFrontendCommandGateway } from '../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresAskAnswerExecutionRepository } from '../../adapters/frontend-ask-execution-postgres/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../adapters/frontend-ask-write-postgres/src/index.js';
import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import {
  PostgresAIProviderCallRepository,
  PostgresCandidateRepository,
  PostgresValidationRepository,
} from '../../adapters/postgres-stage4/src/index.js';
import {
  PostgresChangeSetReviewRepository,
  PostgresComparisonRepository,
} from '../../adapters/postgres-stage5/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../adapters/postgres-stage6/src/index.js';
import { PostgresSearchProjectionRepository } from '../../adapters/postgres-stage7/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../adapters/postgres-stage3/src/index.js';
import {
  PostgresSourcesStage3AtomicPersistence,
  PostgresSourcesStage3ProgressRepository,
  PostgresSourcesStage4ContinuationStore,
} from '../../adapters/postgres-stage3/src/runtime-data-integrity.js';
import {
  PostgresOriginalAssetRepository,
  PostgresProjectAdministrationRepository,
  PostgresSettingsRepository,
} from '../../adapters/postgres/src/index.js';
import { PostgresConnectorRuntimeState } from '../../adapters/connector-runtime-postgres/src/index.js';
import { PostgresSourcesProductService } from '../../adapters/frontend-sources-write-postgres/src/product-service.js';
import { SealedSourcesStagingService } from '../../adapters/frontend-sources-staging-sealed/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../adapters/plain-text-lucas-augmented/src/index.js';
import { LocalAssetStorage } from '../../adapters/asset-storage-local/src/index.js';
import {
  InMemoryBackgroundSummaryProjection,
  InMemoryGlobalShellProjection,
  InMemoryNotificationSummaryProjection,
  InMemoryRouteGuardProjection,
} from '../../adapters/frontend-product-read-in-memory/src/index.js';
import { PostgresSourceLibraryGlobalSearch } from '../../adapters/frontend-product-read-postgres/src/index.js';
import { createApplication } from '../../assemblies/shotgun-app/src/server.js';
import { configureSourcesWriteRuntime } from '../../assemblies/shotgun-app/src/product-api/sources-write-runtime.js';
import {
  createProductionStage3Pipeline,
  SourcesStage4ContinuationDispatcher,
} from '../../adapters/sources-stage3-pipeline/src/index.js';
import {
  ASK_SCHEMA_VERSION,
  type AIExecutionIdentity,
} from '../../packages/contracts/src/index.js';
import { AskCommandCoordinator } from '../../modules/frontend-ask-write/src/index.js';
import {
  AskAnswerExecutionService,
  type AskAnswerProviderPort,
} from '../../modules/frontend-ask-execution/src/index.js';
import type { AIProviderAdapterPort } from '../../modules/ai-provider/src/index.js';
import { createKnowledgeResetCoordinator } from '../../modules/source-knowledge-reset/src/index.js';
import { FrontendProductReadCoordinator } from '../../modules/frontend-product-read/src/index.js';
import { PostgresKnowledgeResetExecutorPersistence } from '../../adapters/source-knowledge-reset-postgres/src/execution-persistence.js';
import { PostgresKnowledgeResetImpactInspector } from '../../adapters/source-knowledge-reset-postgres/src/impact-inspector.js';
import { PostgresKnowledgeResetMaintenanceBoundary } from '../../adapters/source-knowledge-reset-postgres/src/maintenance-boundary.js';
import { createPostgresKnowledgeResetMaintenanceExecutor } from '../../adapters/source-knowledge-reset-postgres/src/maintenance-composition.js';
import { PostgresKnowledgeResetPersistence } from '../../adapters/source-knowledge-reset-postgres/src/index.js';
import { createPostgresKnowledgeResetProductionRebuilders } from '../../adapters/source-knowledge-reset-postgres/src/production-rebuilders.js';
import {
  appendSourceErasureJournalRecord,
  initializeSourceErasureJournal,
  type SourceErasureJournalConfig,
} from '../../scripts/source-erasure-journal.js';
import { createIsolatedPostgresTestDatabase } from '../helpers/isolated-postgres-test-database.js';
import { runAssetCasGc } from '../../scripts/asset-cas-gc.js';
import { createBackup, restoreBackup } from '../../scripts/backup-restore.js';

const backupToolMode = process.env.SHOTGUN_PG_TOOL_MODE === 'local' ? 'local' : 'docker-compose';
const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;
describe('T3 actual Product acceptance on isolated PostgreSQL', () => {
  let database: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>>;
  let adminPool: Pool;
  let runtimePool: Pool;
  let executorPool: Pool;
  let runtimePassword: string;
  let executorPassword: string;
  let temporaryRoot: string;
  let backupRoot: string;
  let journal: SourceErasureJournalConfig;
  let restoreTarget: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>> | undefined;
  let restoreTargetPool: Pool | undefined;
  let reapplyTarget: Awaited<ReturnType<typeof createIsolatedPostgresTestDatabase>> | undefined;
  let reapplyTargetPool: Pool | undefined;
  let reapplyExecutorPool: Pool | undefined;
  let previousJournalRoot: string | undefined;
  let previousJournalKey: string | undefined;
  let removeSourcesRuntime: (() => void) | undefined;
  const openApplications: Array<Awaited<ReturnType<typeof createApplication>>> = [];
  const stopWorkers: Array<() => void> = [];

  beforeAll(async () => {
    database = await createIsolatedPostgresTestDatabase();
    adminPool = database.createPool();
    runtimePassword = randomUUID();
    executorPassword = randomUUID();
    await adminPool.query(`ALTER ROLE shotgun_runtime LOGIN PASSWORD ${literal(runtimePassword)}`);
    await adminPool.query(
      `ALTER ROLE shotgun_erasure_executor LOGIN PASSWORD ${literal(executorPassword)}`,
    );
    const runtimeUrl = new URL(database.databaseUrl);
    runtimeUrl.username = 'shotgun_runtime';
    runtimeUrl.password = runtimePassword;
    runtimePool = new Pool({ connectionString: runtimeUrl.toString(), max: 4 });
    const executorUrl = new URL(database.databaseUrl);
    executorUrl.username = 'shotgun_erasure_executor';
    executorUrl.password = executorPassword;
    executorPool = new Pool({ connectionString: executorUrl.toString(), max: 4 });
    await Promise.all([runtimePool.query('SELECT 1'), executorPool.query('SELECT 1')]);

    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'shotgun-t3-product-acceptance-'));
    backupRoot = path.join(temporaryRoot, 'backups');
    await mkdir(backupRoot, { recursive: true });
    journal = { root: path.join(temporaryRoot, 'journal'), hmacKey: randomUUID() + randomUUID() };
    await initializeSourceErasureJournal(journal, backupRoot);
    previousJournalRoot = process.env.SHOTGUN_ERASURE_JOURNAL_ROOT;
    previousJournalKey = process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY;
    process.env.SHOTGUN_ERASURE_JOURNAL_ROOT = journal.root;
    process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY = journal.hmacKey;
  }, 60_000);

  afterAll(async () => {
    for (const stop of stopWorkers.splice(0)) stop();
    await Promise.all(openApplications.splice(0).map((application) => application.server.close()));
    removeSourcesRuntime?.();
    await reapplyExecutorPool?.end();
    await executorPool?.end();
    await runtimePool?.end();
    await adminPool?.query('ALTER ROLE shotgun_erasure_executor NOLOGIN PASSWORD NULL');
    await adminPool?.query('ALTER ROLE shotgun_runtime NOLOGIN PASSWORD NULL');
    await database?.dispose();
    await restoreTarget?.dispose();
    await reapplyTarget?.dispose();
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
    if (previousJournalRoot === undefined) delete process.env.SHOTGUN_ERASURE_JOURNAL_ROOT;
    else process.env.SHOTGUN_ERASURE_JOURNAL_ROOT = previousJournalRoot;
    if (previousJournalKey === undefined) delete process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY;
    else process.env.SHOTGUN_ERASURE_JOURNAL_HMAC_KEY = previousJournalKey;
  });

  it('creates, cites, resets, restarts, preserves configuration, and accepts a fresh Source', async () => {
    const projectId = `t3-product-${randomUUID()}`;
    const accountId = `t3-owner-${randomUUID()}@example.test`;
    const now = new Date().toISOString();
    const credentialId = randomUUID();
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active, created_at, updated_at, revision)
       VALUES ($1, 'T3 Product Acceptance', 'ACTIVE', true, $2, $2, 1)`,
      [projectId, now],
    );
    const adminAuth = new PostgresAuthRepository(adminPool);
    await adminAuth.bootstrapOwner({
      accountId,
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const runtimeAuth = new PostgresAuthRepository(runtimePool);
    const principal = await runtimeAuth.findPrincipalByAccountId(accountId);
    if (!principal) throw new Error('T3 acceptance Owner was not created.');
    const session = await runtimeAuth.createSession(
      principal.principalId,
      projectId,
      new Date(Date.now() + 60 * 60_000).toISOString(),
    );
    const cookie = `shotgun_session=${session.sessionToken}`;
    const settings = new PostgresSettingsRepository(runtimePool);
    const settingsAdmin = new PostgresSettingsRepository(adminPool);

    await adminPool.query(
      `INSERT INTO settings.project_settings (project_id, key, value, category)
       VALUES ($1, 'general.locale', '"ko-KR"'::jsonb, 'general')`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO settings.settings_revisions (project_id, revision, settings_snapshot)
       VALUES ($1, 1, '{"general.locale":"ko-KR"}'::jsonb)`,
      [projectId],
    );
    await adminPool.query(
      `INSERT INTO ai.provider_credentials (
         credential_id, project_id, provider_id, encrypted_secret, encryption_version,
         key_version, credential_revision, lifecycle_state, created_at, updated_at
       ) VALUES ($1, $2, 'deepseek',
         '{"version":1,"algorithm":"aes-256-gcm","nonce":"fixture","ciphertext":"fixture","authTag":"fixture"}',
         'aes-256-gcm:v1', 't3-test-key', 1, 'active', $3, $3)`,
      [credentialId, projectId, now],
    );
    await adminPool.query(
      `INSERT INTO ai.project_ai_configuration_revisions (
         project_id, active_provider_id, active_model_id, credential_id, credential_revision,
         ai_configuration_revision, updated_by, updated_at
       ) VALUES ($1, 'deepseek', 'deepseek-flash', $2, 1, 1, $3, $4)`,
      [projectId, credentialId, principal.principalId, now],
    );
    await adminPool.query(
      `INSERT INTO ai.project_ai_configurations (
         project_id, active_provider_id, active_model_id, credential_id, credential_revision,
         ai_configuration_revision, updated_by, updated_at
       ) VALUES ($1, 'deepseek', 'deepseek-flash', $2, 1, 1, $3, $4)`,
      [projectId, credentialId, principal.principalId, now],
    );

    const assetRoot = path.join(temporaryRoot, 'assets');
    const storage = new LocalAssetStorage(assetRoot);
    const transformer = new LucasAugmentedPlainTextAdapter();
    const originalAssets = new PostgresOriginalAssetRepository(runtimePool);
    const commandGateway = new PostgresFrontendCommandGateway(runtimePool);
    const staging = new SealedSourcesStagingService(
      storage,
      't3-product-acceptance-staging-secret-32-characters',
    );
    const pipeline = createProductionStage3Pipeline({
      storage,
      transformer,
      locator: transformer,
      transformationRepository: new PostgresTransformationRepository(runtimePool),
      evidenceRepository: new PostgresEvidenceRepository(runtimePool),
      progress: new PostgresSourcesStage3ProgressRepository(runtimePool),
      atomicPersistence: new PostgresSourcesStage3AtomicPersistence(runtimePool),
    });
    removeSourcesRuntime = configureSourcesWriteRuntime({
      commandGateway,
      staging,
      productService: new PostgresSourcesProductService(runtimePool, staging, pipeline),
    });

    let providerCalls = 0;
    const aiProvider: AIProviderAdapterPort = {
      identity: {
        provider: 'deepseek',
        model: 'deepseek-flash',
        adapterVersion: 't3-deterministic-provider-v1',
        dataPolicyVersion: 't3-deterministic-policy-v1',
      },
      async generateStructured(request) {
        providerCalls += 1;
        const input = JSON.parse(request.prompt) as {
          readonly evidence?: readonly { readonly evidenceId: string; readonly text: string }[];
        };
        const first = input.evidence?.[0];
        return {
          rawText: JSON.stringify({
            candidates: first ? [{ claimText: first.text, evidenceId: first.evidenceId }] : [],
          }),
          providerResponseId: `t3-candidate-provider-${providerCalls}`,
        };
      },
    };
    const executionIdentity: AIExecutionIdentity = {
      providerId: 'deepseek',
      modelId: 'deepseek-flash',
      aiConfigurationRevision: 1,
      credentialId,
      credentialRevision: 1,
      policyContextRevision: 't3-acceptance-policy-v1',
      providerPolicyFingerprint: 't3-acceptance-provider-policy-v1',
    };
    const askProvider: AskAnswerProviderPort = {
      identity: {
        provider: 't3-deterministic-ask',
        model: 't3-citation-model',
        adapterVersion: '1.0.0',
        dataPolicyVersion: 't3-deterministic-ask-policy-v1',
      },
      async execute(request) {
        const citations = request.context.flatMap((item) =>
          item.kind === 'EVIDENCE' ? [{ evidenceId: item.evidenceId }] : [],
        );
        return {
          answer: 'Deterministic answer grounded in the selected Source Evidence.',
          citations,
          provider: {
            provider: 't3-deterministic-ask',
            model: 't3-citation-model',
            adapterVersion: '1.0.0',
          },
        };
      },
    };
    const canonical = new PostgresCanonicalKnowledgeRepository(runtimePool);
    const search = new PostgresSearchProjectionRepository(runtimePool);
    const candidateRepository = new PostgresCandidateRepository(runtimePool);
    const reviewRepository = new PostgresChangeSetReviewRepository(runtimePool);
    const resetPersistence = new PostgresKnowledgeResetPersistence(runtimePool);
    const resetCoordinator = createKnowledgeResetCoordinator({
      projectState: resetPersistence,
      impact: new PostgresKnowledgeResetImpactInspector(runtimePool, true),
      requests: resetPersistence,
      configurationFingerprint: resetPersistence,
    });
    const startApp = async () => {
      const askWorkspace = new PostgresAskWorkspaceProjection(runtimePool);
      const askExecution = new AskAnswerExecutionService(
        new PostgresAskAnswerExecutionRepository(runtimePool, askWorkspace, {
          async resolve() {
            return undefined;
          },
        }),
        askProvider,
      );
      stopWorkers.push(await askExecution.startWorker(5));
      const askCoordinator = new AskCommandCoordinator(
        commandGateway,
        new PostgresAskConversationRepository(runtimePool),
        askWorkspace,
        new PostgresAskSourceSelectionValidator(runtimePool),
        askExecution,
      );
      const application = await createApplication({
        authRepository: runtimeAuth,
        projectAdminRepository: new PostgresProjectAdministrationRepository(runtimePool),
        settingsRepository: settings,
        sourceKnowledgeResetCoordinator: resetCoordinator,
        originalAssetRepository: originalAssets,
        sourcesProjectionRepository: originalAssets,
        assetStorage: storage,
        frontendCommandGateway: commandGateway,
        connectorRuntimeState: new PostgresConnectorRuntimeState(runtimePool),
        transformationRepository: new PostgresTransformationRepository(runtimePool),
        evidenceRepository: new PostgresEvidenceRepository(runtimePool),
        aiProvider,
        aiProviderPolicy: { allowPrivate: true, allowRestricted: false, maxAttempts: 2 },
        aiProviderExecutionResolver: {
          async resolve() {
            return { adapter: aiProvider, executionIdentity };
          },
        },
        aiProviderRepository: new PostgresAIProviderCallRepository(runtimePool),
        candidateRepository,
        validationRepository: new PostgresValidationRepository(runtimePool),
        comparisonRepository: new PostgresComparisonRepository(runtimePool),
        changeSetReviewRepository: reviewRepository,
        canonicalSnapshot: canonical,
        canonicalKnowledgeRepository: canonical,
        searchProjectionRepository: search,
        askCommandCoordinator: askCoordinator,
        askAnswerExecution: askExecution,
        frontendProductReadCoordinatorFactory: (
          _connector,
          actionCenterProjection,
          frontendSourcesReadCoordinator,
        ) =>
          new FrontendProductReadCoordinator(
            new InMemoryGlobalShellProjection(
              async (input) => {
                if (!input.activeProject) return false;
                try {
                  const home = await actionCenterProjection.getHome({
                    ...input,
                    activeProject: input.activeProject,
                  });
                  return home.attention.some((item) => item.kind === 'REVIEW_DECISION');
                } catch {
                  return false;
                }
              },
              async (input) => {
                if (!input.activeProject) return undefined;
                return frontendSourcesReadCoordinator.countUniqueSources({
                  principalId: input.principalId,
                  sessionId: input.sessionId,
                  authorizedProjectId: input.activeProject.id,
                  accessScopes: input.accessScope ?? [],
                  sensitivityClearance: input.activeProject.sensitivityClearance,
                  accessRevision: input.accessRevision,
                  policyContextRevision: input.policyContextRevision,
                });
              },
            ),
            actionCenterProjection,
            new InMemoryBackgroundSummaryProjection(),
            new InMemoryNotificationSummaryProjection(),
            new PostgresSourceLibraryGlobalSearch(frontendSourcesReadCoordinator),
            new InMemoryRouteGuardProjection(),
            askWorkspace,
          ),
        canonicalProjectionRecoveryIntervalMs: false,
        aiDurableMaterializationRecoveryEnabled: false,
      });
      openApplications.push(application);
      return application;
    };

    const csrfFor = async (application: Awaited<ReturnType<typeof createApplication>>) =>
      (
        await application.server.inject({
          method: 'GET',
          url: '/api/v1/security/csrf',
          headers: { cookie },
        })
      ).json<{ csrfToken: string }>().csrfToken;
    const issueSource = async (
      application: Awaited<ReturnType<typeof createApplication>>,
      label: string,
      text: string,
      csrf: string,
    ) => {
      const draftId = randomUUID();
      const itemId = randomUUID();
      const staged = await application.server.inject({
        method: 'POST',
        url: `/product-api/frontend/sources/staging/bytes?${new URLSearchParams({ draftId, itemId, kind: 'DIRECT_TEXT', label, mediaType: 'text/plain' })}`,
        headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/octet-stream' },
        payload: Buffer.from(text),
      });
      expect(staged.statusCode, staged.body).toBe(200);
      const stagingReference = staged.json<{ receipt: { stagingReference: string } }>().receipt
        .stagingReference;
      const clientRequestId = randomUUID();
      const idempotencyKey = randomUUID();
      const submitted = await application.server.inject({
        method: 'POST',
        url: '/product-api/frontend/sources/submissions',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: {
          envelopeVersion: '1.0.0',
          commandType: 'sources.intake.submit.v1',
          commandSchemaVersion: '1.0.0',
          clientRequestId,
          idempotencyKey,
          projectContext: {
            activeProjectId: projectId,
            targetProjectId: projectId,
            resourceProjectId: projectId,
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
                label,
                stagingReference,
                requestedClassification: 'private',
              },
            ],
          },
        },
      });
      expect(submitted.statusCode, submitted.body).toBe(200);
      const outcome = submitted.json<{
        submission: {
          state: string;
          items: readonly { producedResource?: { sourceId: string; sourceVersionId: string } }[];
        };
      }>().submission;
      expect(outcome.state).toBe('SUCCEEDED');
      const produced = outcome.items[0]?.producedResource;
      if (!produced) throw new Error('Product Sources submission returned no SourceVersion.');
      return produced;
    };
    const prepareCandidate = async (
      application: Awaited<ReturnType<typeof createApplication>>,
      source: { sourceId: string; sourceVersionId: string },
    ) => {
      const stage4 = new SourcesStage4ContinuationDispatcher(
        new PostgresSourcesStage4ContinuationStore(runtimePool),
        {
          async onEvidenceIndexed(input) {
            const delivery = await application.kernel.connector.publishEvent({
              messageId: randomUUID(),
              messageType: 'EvidenceIndexed',
              messageKind: 'event',
              schemaVersion: '1.0.0',
              producerModule: 'sources-stage3-pipeline',
              producerVersion: '1.0.0',
              correlationId: `sources-stage3:${input.projectId}:${input.sourceVersionId}`,
              projectId: input.projectId,
              actor: { type: 'service', id: 'sources-stage3-pipeline' },
              security: {
                accessScope: [...input.accessScope],
                sensitivity: input.sensitivity,
                dataClassification: input.dataClassification,
              },
              idempotencyKey: `evidence-indexed:${input.projectId}:${input.revisionId}`,
              payload: {
                revisionId: input.revisionId,
                sourceVersionId: input.sourceVersionId,
                evidenceCount: input.evidenceCount,
                reusedCount: input.reusedCount,
              },
              createdAt: new Date().toISOString(),
              traceId: randomUUID(),
            });
            const failed = delivery.consumers.find((consumer) => consumer.status === 'dead-letter');
            if (failed) throw new Error(`EvidenceIndexed failed for ${failed.consumerId}.`);
          },
        },
      );
      expect(await stage4.dispatchOnce()).toBe('SUCCEEDED');
      const listed = await application.server.inject({
        method: 'GET',
        url: `/product-api/frontend/sources/${source.sourceId}/versions/${source.sourceVersionId}/candidates`,
        headers: { cookie },
      });
      expect(listed.statusCode, listed.body).toBe(200);
      const candidates = listed.json<{
        candidates: { items: readonly { candidateId: string }[] };
      }>().candidates.items;
      const candidate = candidates[0];
      if (!candidate) throw new Error('Candidate Product route returned no Candidate.');
      const persistedCandidate = await candidateRepository.findById(
        projectId,
        candidate.candidateId,
      );
      const evidenceId = persistedCandidate?.evidenceIds[0];
      if (!evidenceId) throw new Error('Product Candidate has no linked Evidence.');
      return { candidateId: candidate.candidateId, evidenceId };
    };
    const approveCandidate = async (
      application: Awaited<ReturnType<typeof createApplication>>,
      candidateId: string,
      csrf: string,
    ) => {
      const compared = await application.server.inject({
        method: 'POST',
        url: '/api/v1/comparisons/recompare',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: { candidateId, idempotencyKey: randomUUID() },
      });
      expect(compared.statusCode, compared.body).toBe(200);
      const result = compared.json<{ result: { comparisonId: string } }>().result;
      const changeSet = await reviewRepository.findByComparisonId(projectId, result.comparisonId);
      if (!changeSet)
        throw new Error('Comparison Product route did not create a Review ChangeSet.');
      const decision = await application.server.inject({
        method: 'POST',
        url: '/reviews/decision',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: {
          changeSetId: changeSet.changeSetId,
          expectedRevisionNumber: 1,
          expectedContentDigest: changeSet.contentDigest,
          decision: 'APPROVE',
          reason: 'T3 actual Product acceptance approves the Source-backed ChangeSet.',
        },
      });
      expect(decision.statusCode, decision.body).toBe(200);
      const projected = await application.server.inject({
        method: 'POST',
        url: '/projection/rebuild',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: {},
      });
      expect(projected.statusCode, projected.body).toBe(200);
      return { changeSetId: changeSet.changeSetId, comparisonId: result.comparisonId };
    };
    const askForSource = async (
      application: Awaited<ReturnType<typeof createApplication>>,
      source: { sourceId: string; sourceVersionId: string },
      evidenceId: string,
      csrf: string,
      requestIds?: { clientRequestId: string; idempotencyKey: string },
    ) => {
      const request = {
        schemaVersion: ASK_SCHEMA_VERSION,
        clientRequestId: requestIds?.clientRequestId ?? randomUUID(),
        idempotencyKey: requestIds?.idempotencyKey ?? randomUUID(),
        question: 'What is the T3 acceptance statement?',
        mode: 'SOURCE_EXPLORATION',
        sourceSelections: [
          {
            sourceId: source.sourceId,
            sourceVersionId: source.sourceVersionId,
            evidenceIds: [evidenceId],
          },
        ],
      };
      const submission = await application.server.inject({
        method: 'POST',
        url: '/product-api/frontend/ask/questions',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: request,
      });
      expect(submission.statusCode, submission.body).toBe(200);
      const answerRunId = submission.json<{ submission: { answerRun: { answerRunId: string } } }>()
        .submission.answerRun.answerRunId;
      let answerRun:
        | {
            state: string;
            statements?: readonly {
              citations?: readonly {
                evidenceId: string;
                sourceId: string;
                sourceVersionId: string;
              }[];
            }[];
          }
        | undefined;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const read = await application.server.inject({
          method: 'GET',
          url: `/product-api/frontend/ask/answer-runs/${answerRunId}`,
          headers: { cookie },
        });
        expect(read.statusCode, read.body).toBe(200);
        answerRun = read.json<{ answerRun: typeof answerRun }>().answerRun;
        if (answerRun?.state === 'SUCCEEDED' || answerRun?.state === 'FAILED') break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(answerRun?.state).toBe('SUCCEEDED');
      expect(answerRun?.statements?.flatMap((statement) => statement.citations ?? [])).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            evidenceId,
            sourceId: source.sourceId,
            sourceVersionId: source.sourceVersionId,
          }),
        ]),
      );
      return { answerRunId, request };
    };
    const closeApp = async (application: Awaited<ReturnType<typeof createApplication>>) => {
      const index = openApplications.indexOf(application);
      if (index >= 0) openApplications.splice(index, 1);
      stopWorkers.shift()?.();
      await application.server.close();
    };

    let app = await startApp();
    let csrf = await csrfFor(app);
    const firstText = 'T3 acceptance statement: the approved source remains citable before reset.';
    const firstSource = await issueSource(app, 'T3 first source', firstText, csrf);
    const sharedAsset = await adminPool.query<{
      original_asset_id: string;
      media_type: string;
      access_scope: string[];
      sensitivity: string;
    }>(
      `SELECT original_asset_id::text, media_type, access_scope, sensitivity
       FROM asset.source_versions WHERE source_version_id = $1`,
      [firstSource.sourceVersionId],
    );
    const sharedProjectId = `t3-shared-cas-${randomUUID()}`;
    const sharedSourceId = randomUUID();
    const sharedSourceVersionId = randomUUID();
    await adminPool.query(
      `INSERT INTO project_admin.projects (id, name, status, active, created_at, updated_at, revision)
       VALUES ($1, 'T3 Shared CAS Project', 'ACTIVE', true, $2, $2, 1)`,
      [sharedProjectId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [sharedSourceId, sharedProjectId, principal.principalId, now],
    );
    await adminPool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id,
         media_type, access_scope, sensitivity, created_at
       ) SELECT $1, $2, 1, original_asset_id, media_type, access_scope, sensitivity, $3
           FROM asset.source_versions WHERE source_version_id = $4`,
      [sharedSourceVersionId, sharedSourceId, now, firstSource.sourceVersionId],
    );
    expect(sharedAsset.rowCount).toBe(1);
    const sharedStorageKeyResult = await runtimePool.query<{ storage_key: string }>(
      `SELECT original.storage_key
         FROM asset.source_versions AS version
         JOIN asset.original_assets AS original
           ON original.asset_id = version.original_asset_id
        WHERE version.source_version_id = $1`,
      [firstSource.sourceVersionId],
    );
    const retainedSharedStorageKey = sharedStorageKeyResult.rows[0]?.storage_key;
    if (!retainedSharedStorageKey) throw new Error('T3 shared CAS fixture was not created.');
    const firstCandidate = await prepareCandidate(app, firstSource);
    const firstReview = await approveCandidate(app, firstCandidate.candidateId, csrf);
    const firstAsk = await askForSource(app, firstSource, firstCandidate.evidenceId, csrf);
    const firstCanonical = await canonical.getSnapshot(projectId);
    expect(firstCanonical.claims).toHaveLength(1);

    await closeApp(app);
    app = await startApp();
    csrf = await csrfFor(app);
    const replayedAsk = await askForSource(app, firstSource, firstCandidate.evidenceId, csrf, {
      clientRequestId: firstAsk.request.clientRequestId,
      idempotencyKey: firstAsk.request.idempotencyKey,
    });
    expect(replayedAsk.answerRunId).toBe(firstAsk.answerRunId);
    expect((await canonical.getSnapshot(projectId)).claims[0]?.text).toBe(firstText);
    const beforeResetSources = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/sources/query',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { schemaVersion: '1.0.0', filters: {}, sort: 'UPDATED_DESC', limit: 20 },
    });
    expect(beforeResetSources.statusCode).toBe(200);
    expect(
      beforeResetSources.json<{ page: { items: readonly unknown[] } }>().page.items,
    ).toHaveLength(1);
    const preservedDigestBeforeReset =
      await resetPersistence.fingerprintPreservedProjectConfiguration(projectId);
    const preResetBackupDirectory = path.join(backupRoot, 'pre-reset-reapply');
    const preResetManifest = await createBackup({
      databaseUrl: database.databaseUrl,
      assetRoot,
      outputDirectory: preResetBackupDirectory,
      toolMode: backupToolMode,
    });
    expect(preResetManifest.database.restoreSecurityProfile).toBe('postgres-owners-and-acls-v1');
    expect(preResetManifest.projectKnowledgeEpochs?.[projectId]).toBe(0);
    reapplyTarget = await createIsolatedPostgresTestDatabase({ migrate: async () => {} });
    const reapplyAssetRoot = path.join(temporaryRoot, 'reapply-restored-assets');
    await restoreBackup({
      sourceDatabaseUrl: database.databaseUrl,
      targetDatabaseUrl: reapplyTarget.databaseUrl,
      targetAssetRoot: reapplyAssetRoot,
      backupDirectory: preResetBackupDirectory,
      backupRoot,
      toolMode: backupToolMode,
    });
    reapplyTargetPool = reapplyTarget.createPool();
    const reapplyExecutorUrl = new URL(reapplyTarget.databaseUrl);
    reapplyExecutorUrl.username = 'shotgun_erasure_executor';
    reapplyExecutorUrl.password = executorPassword;
    reapplyExecutorPool = new Pool({ connectionString: reapplyExecutorUrl.toString(), max: 4 });
    await reapplyExecutorPool.query('SELECT 1');
    const restoredPreResetContent = await reapplyTargetPool.query<{
      readonly sources: string;
      readonly claims: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM asset.sources WHERE project_id = $1) AS sources,
         (SELECT count(*)::text FROM canonical.claims WHERE project_id = $1) AS claims`,
      [projectId],
    );
    expect(restoredPreResetContent.rows[0]).toEqual({ sources: '1', claims: '1' });
    const restoredSecurity = await reapplyTargetPool.query<{
      readonly execution_function_owner: string;
      readonly executor_can_read_execution_snapshot: boolean;
      readonly runtime_cannot_read_canonical_snapshot: boolean;
    }>(
      `SELECT pg_get_userbyid(procedure.proowner) AS execution_function_owner,
              has_function_privilege(
                'shotgun_erasure_executor',
                'project_admin.t3_read_reset_execution_snapshot(text,uuid)',
                'EXECUTE'
              ) AS executor_can_read_execution_snapshot,
              NOT has_table_privilege(
                'shotgun_runtime', 'canonical.t3_reset_owner_snapshots', 'SELECT'
              ) AS runtime_cannot_read_canonical_snapshot
         FROM pg_proc AS procedure
         JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'project_admin'
          AND procedure.proname = 't3_read_reset_execution_snapshot'`,
    );
    expect(restoredSecurity.rows).toEqual([
      {
        execution_function_owner: 'shotgun_schema_owner',
        executor_can_read_execution_snapshot: true,
        runtime_cannot_read_canonical_snapshot: true,
      },
    ]);
    // Keep a real pre-reset worker lease and its already-computed payload in
    // memory. After the reset completes, the same atomic persistence boundary
    // must reject that late worker before it can recreate Transformation,
    // Evidence, indexing, or continuation rows.
    const staleWorkerSource = await runtimePool.query<{
      readonly content_hash: string;
      readonly media_type: 'text/plain' | 'text/markdown';
      readonly access_scope: string[];
      readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
    }>(
      `SELECT original.content_hash, version.media_type, version.access_scope, version.sensitivity
         FROM asset.source_versions AS version
         JOIN asset.sources AS source ON source.source_id = version.source_id
         JOIN asset.original_assets AS original
           ON original.asset_id = version.original_asset_id
        WHERE version.source_version_id = $1 AND source.project_id = $2`,
      [firstSource.sourceVersionId, projectId],
    );
    const staleWorkerSourceMetadata = staleWorkerSource.rows[0];
    if (!staleWorkerSourceMetadata) throw new Error('T3 stale-worker Source fixture is missing.');
    const staleWorkerSourceId = randomUUID();
    const staleWorkerSourceVersionId = randomUUID();
    await runtimePool.query(
      `INSERT INTO asset.sources (source_id, project_id, created_by_actor_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [staleWorkerSourceId, projectId, principal.principalId, new Date().toISOString()],
    );
    await runtimePool.query(
      `INSERT INTO asset.source_versions (
         source_version_id, source_id, version_number, original_asset_id,
         media_type, access_scope, sensitivity, created_at
       ) SELECT $1, $2, 1, original_asset_id, media_type, access_scope, sensitivity, $3
           FROM asset.source_versions WHERE source_version_id = $4`,
      [
        staleWorkerSourceVersionId,
        staleWorkerSourceId,
        new Date().toISOString(),
        firstSource.sourceVersionId,
      ],
    );
    const staleWorkerProgress = new PostgresSourcesStage3ProgressRepository(runtimePool);
    await staleWorkerProgress.ensureMaterialized({
      projectId,
      sourceId: staleWorkerSourceId,
      sourceVersionId: staleWorkerSourceVersionId,
    });
    const staleWorkerClaim = await staleWorkerProgress.claim({
      projectId,
      sourceId: staleWorkerSourceId,
      sourceVersionId: staleWorkerSourceVersionId,
      workerId: `t3-pre-reset-worker-${randomUUID()}`,
      leaseDurationMs: 30_000,
    });
    expect(staleWorkerClaim.status).toBe('CLAIMED');
    if (staleWorkerClaim.status !== 'CLAIMED') {
      throw new Error('T3 stale-worker fixture could not acquire its pre-reset lease.');
    }
    const staleWorkerOutput = await transformer.transform({
      sourceId: staleWorkerSourceId,
      sourceVersionId: staleWorkerSourceVersionId,
      sourceContentHash: staleWorkerSourceMetadata.content_hash,
      mediaType: staleWorkerSourceMetadata.media_type,
      text: firstText,
    });
    const staleWorkerPersistenceInput = {
      transformation: {
        projectId,
        sourceId: staleWorkerSourceId,
        sourceVersionId: staleWorkerSourceVersionId,
        sourceContentHash: staleWorkerSourceMetadata.content_hash,
        transformer: transformer.identity,
        output: staleWorkerOutput,
        accessScope: staleWorkerSourceMetadata.access_scope,
        sensitivity: staleWorkerSourceMetadata.sensitivity,
        createdAt: new Date().toISOString(),
      },
      locator: transformer,
      lease: staleWorkerClaim.lease,
      continuation: {
        projectId,
        sourceId: staleWorkerSourceId,
        sourceVersionId: staleWorkerSourceVersionId,
        revisionId: `stale-worker-${staleWorkerSourceVersionId}`,
        evidenceCount: 0,
        reusedCount: 0,
        accessScope: staleWorkerSourceMetadata.access_scope,
        sensitivity: staleWorkerSourceMetadata.sensitivity,
        dataClassification: 'source-content',
      },
    } as const;

    const previewResponse = await app.server.inject({
      method: 'POST',
      url: `/product-api/frontend/projects/${projectId}/source-knowledge-reset/preview`,
      headers: { cookie, 'x-csrf-token': csrf },
      payload: {},
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = previewResponse.json<{
      preview: {
        previewId: string;
        manifestDigest: string;
        projectRevision: number;
        knowledgeEpoch: number;
        canConfirm: boolean;
        blockers: readonly string[];
      };
    }>().preview;
    expect(preview.canConfirm, JSON.stringify(preview.blockers)).toBe(true);
    const idempotencyKey = randomUUID();
    const confirmation = {
      previewId: preview.previewId,
      manifestDigest: preview.manifestDigest,
      expectedProjectRevision: preview.projectRevision,
      expectedKnowledgeEpoch: preview.knowledgeEpoch,
      idempotencyKey,
      confirmIrreversibleReset: true,
    };
    const confirmed = await app.server.inject({
      method: 'POST',
      url: `/product-api/frontend/projects/${projectId}/source-knowledge-reset/confirm`,
      headers: { cookie, 'x-csrf-token': csrf, 'x-idempotency-key': idempotencyKey },
      payload: confirmation,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const request = confirmed.json<{ request: { requestId: string; state: string } }>().request;
    expect(request.state).toBe('APPROVED');
    await closeApp(app);

    const rebuilders = createPostgresKnowledgeResetProductionRebuilders({
      runtimePool,
      executorPool,
    });
    const maintenanceExecutor = createPostgresKnowledgeResetMaintenanceExecutor({
      pool: executorPool,
      rebuilders,
      dependencies: {
        repository: new PostgresKnowledgeResetExecutorPersistence(executorPool),
        maintenance: new PostgresKnowledgeResetMaintenanceBoundary(executorPool),
        inspectApprovedImpact: (targetProjectId) =>
          new PostgresKnowledgeResetImpactInspector(
            runtimePool,
            true,
          ).inspectProjectSourceKnowledge(targetProjectId),
        fingerprintPreservedConfiguration: (targetProjectId) =>
          resetPersistence.fingerprintPreservedProjectConfiguration(targetProjectId),
        async appendJournal(record) {
          await appendSourceErasureJournalRecord({ config: journal, backupRoot, ...record });
        },
      },
    });
    const completedReset = await maintenanceExecutor.execute({
      projectId,
      requestId: request.requestId,
    });
    expect(completedReset.state).toBe('COMPLETE');
    await expect(
      new PostgresSourcesStage3AtomicPersistence(runtimePool).persist(staleWorkerPersistenceInput),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const staleWorkerReadback = await runtimePool.query<{
      readonly sources: string;
      readonly progress: string;
      readonly transformations: string;
      readonly evidence: string;
      readonly indexing_results: string;
      readonly continuations: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM asset.sources WHERE project_id = $1 AND source_id = $2) AS sources,
         (SELECT count(*)::text FROM source_product.source_stage3_progress WHERE project_id = $1 AND source_version_id = $3) AS progress,
         (SELECT count(*)::text FROM transformation.revisions WHERE project_id = $1 AND source_version_id = $3) AS transformations,
         (SELECT count(*)::text FROM evidence.spans WHERE project_id = $1 AND source_version_id = $3) AS evidence,
         (SELECT count(*)::text FROM evidence.indexing_results WHERE project_id = $1 AND source_version_id = $3) AS indexing_results,
         (SELECT count(*)::text FROM evidence.stage4_continuations WHERE project_id = $1 AND source_version_id = $3) AS continuations`,
      [projectId, staleWorkerSourceId, staleWorkerSourceVersionId],
    );
    expect(staleWorkerReadback.rows).toEqual([
      {
        sources: '0',
        progress: '0',
        transformations: '0',
        evidence: '0',
        indexing_results: '0',
        continuations: '0',
      },
    ]);
    const reapplyPersistence = new PostgresKnowledgeResetPersistence(reapplyTargetPool);
    const reapplyCoordinator = createKnowledgeResetCoordinator({
      projectState: reapplyPersistence,
      requests: reapplyPersistence,
      configurationFingerprint: reapplyPersistence,
      impact: new PostgresKnowledgeResetImpactInspector(reapplyTargetPool, true),
    });
    const reapplyPreview = await reapplyCoordinator.preview({
      projectId,
      actorPrincipalId: principal.principalId,
    });
    expect(reapplyPreview.blockers, JSON.stringify(reapplyPreview)).toEqual([]);
    const reapplyApproval = await reapplyCoordinator.confirm({
      projectId,
      actorPrincipalId: principal.principalId,
      confirmation: {
        previewId: reapplyPreview.previewId,
        manifestDigest: reapplyPreview.manifestDigest,
        expectedProjectRevision: reapplyPreview.projectRevision,
        expectedKnowledgeEpoch: reapplyPreview.knowledgeEpoch,
        idempotencyKey: randomUUID(),
        confirmIrreversibleReset: true,
      },
    });
    const reapplyJournalRoot = path.join(temporaryRoot, 'reapply-journal');
    const reapplyJournal = { root: reapplyJournalRoot, hmacKey: randomUUID() + randomUUID() };
    await initializeSourceErasureJournal(reapplyJournal, backupRoot);
    const reapplyRebuilders = createPostgresKnowledgeResetProductionRebuilders({
      runtimePool: reapplyTargetPool,
      executorPool: reapplyExecutorPool,
    });
    const reapplyExecutor = createPostgresKnowledgeResetMaintenanceExecutor({
      pool: reapplyExecutorPool,
      rebuilders: reapplyRebuilders,
      dependencies: {
        repository: new PostgresKnowledgeResetExecutorPersistence(reapplyExecutorPool),
        maintenance: new PostgresKnowledgeResetMaintenanceBoundary(reapplyExecutorPool),
        inspectApprovedImpact: (targetProjectId) =>
          new PostgresKnowledgeResetImpactInspector(
            reapplyTargetPool!,
            true,
          ).inspectProjectSourceKnowledge(targetProjectId),
        fingerprintPreservedConfiguration: (targetProjectId) =>
          reapplyPersistence.fingerprintPreservedProjectConfiguration(targetProjectId),
        async appendJournal(record) {
          await appendSourceErasureJournalRecord({
            config: reapplyJournal,
            backupRoot,
            ...record,
          });
        },
      },
    });
    const reappliedReset = await reapplyExecutor.execute({
      projectId,
      requestId: reapplyApproval.request.requestId,
    });
    expect(reappliedReset.state).toBe('COMPLETE');
    const reappliedContent = await reapplyTargetPool.query<{
      readonly epoch: string;
      readonly epoch_state: string;
      readonly sources: string;
      readonly claims: string;
      readonly locale: string | null;
      readonly old_search_rebuilds: string;
    }>(
      `SELECT epoch.epoch::text, epoch.state AS epoch_state,
              (SELECT count(*)::text FROM asset.sources WHERE project_id = $1) AS sources,
              (SELECT count(*)::text FROM canonical.claims WHERE project_id = $1) AS claims,
              (SELECT count(*)::text FROM connector.dedup_records
                WHERE project_id = $1 AND message_type = 'RebuildSearchProjection') AS old_search_rebuilds,
              (SELECT value #>> '{}' FROM settings.project_settings
                WHERE project_id = $1 AND key = 'general.locale') AS locale
         FROM project_admin.project_knowledge_epoch AS epoch
        WHERE epoch.project_id = $1`,
      [projectId],
    );
    expect(reappliedContent.rows).toEqual([
      {
        epoch: '1',
        epoch_state: 'READY',
        sources: '0',
        claims: '0',
        locale: 'ko-KR',
        old_search_rebuilds: '0',
      },
    ]);
    await expect(
      readFile(path.join(reapplyAssetRoot, ...retainedSharedStorageKey.split('/'))),
    ).resolves.toEqual(Buffer.from(firstText, 'utf8'));
    expect(await resetPersistence.fingerprintPreservedProjectConfiguration(projectId)).toBe(
      preservedDigestBeforeReset,
    );
    expect((await runtimeAuth.findPrincipalByAccountId(accountId))?.principalId).toBe(
      principal.principalId,
    );
    const preservedAiConfiguration = await runtimePool.query<{
      active_model_id: string;
      credential_id: string;
    }>(
      `SELECT active_model_id, credential_id::text FROM ai.project_ai_configurations WHERE project_id = $1`,
      [projectId],
    );
    expect(preservedAiConfiguration.rows).toEqual([
      { active_model_id: 'deepseek-flash', credential_id: credentialId },
    ]);
    expect(await settingsAdmin.getProjectSettingValue(projectId, 'general.locale')).toBe('ko-KR');

    app = await startApp();
    csrf = await csrfFor(app);
    const afterResetSources = await app.server.inject({
      method: 'POST',
      url: '/product-api/frontend/sources/query',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { schemaVersion: '1.0.0', filters: {}, sort: 'UPDATED_DESC', limit: 20 },
    });
    expect(afterResetSources.statusCode, afterResetSources.body).toBe(200);
    expect(
      afterResetSources.json<{ page: { items: readonly unknown[] } }>().page.items,
    ).toHaveLength(0);
    expect((await canonical.getSnapshot(projectId)).claims).toHaveLength(0);
    const afterResetCanonicalHistory = await app.server.inject({
      method: 'POST',
      url: '/canonical/history',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: {},
    });
    expect(afterResetCanonicalHistory.statusCode, afterResetCanonicalHistory.body).toBe(200);
    const retainedHistory = afterResetCanonicalHistory.json<{
      history: {
        items: readonly {
          reason: string;
          manifestId: string | null;
          changeSetId: string | null;
          claimId?: string;
        }[];
      };
    }>().history.items;
    expect(retainedHistory).toHaveLength(1);
    expect(retainedHistory[0]).toMatchObject({
      reason: 'Source knowledge reset',
      manifestId: null,
      changeSetId: null,
    });
    expect(retainedHistory[0]?.claimId).toBeUndefined();
    const removedRows = await runtimePool.query<{
      sources: string;
      evidence: string;
      candidates: string;
      citations: string;
      conversations: string;
      review: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM asset.sources WHERE project_id = $1) AS sources,
         (SELECT count(*)::text FROM evidence.spans WHERE project_id = $1) AS evidence,
         (SELECT count(*)::text FROM candidate.claim_candidates WHERE project_id = $1) AS candidates,
         (SELECT count(*)::text
            FROM frontend_ask.citations AS citation
            JOIN frontend_ask.statements AS statement USING (statement_id)
            JOIN frontend_ask.answer_runs AS answer_run USING (answer_run_id)
           WHERE answer_run.project_id = $1) AS citations,
         (SELECT count(*)::text FROM frontend_ask.conversations WHERE project_id = $1) AS conversations,
         (SELECT count(*)::text FROM review.change_sets WHERE project_id = $1) AS review`,
      [projectId],
    );
    expect(removedRows.rows[0]).toEqual({
      sources: '0',
      evidence: '0',
      candidates: '0',
      citations: '0',
      conversations: '0',
      review: '0',
    });

    restoreTarget = await createIsolatedPostgresTestDatabase({ migrate: async () => {} });
    const postResetBackupDirectory = path.join(backupRoot, 'post-reset');
    const restoredAssetRoot = path.join(temporaryRoot, 'restored-assets');
    const preservedDigestAtBackup =
      await resetPersistence.fingerprintPreservedProjectConfiguration(projectId);
    const postResetManifest = await createBackup({
      databaseUrl: database.databaseUrl,
      assetRoot,
      outputDirectory: postResetBackupDirectory,
      toolMode: backupToolMode,
    });
    expect(postResetManifest.projectKnowledgeEpochs?.[projectId]).toBe(1);
    expect(postResetManifest.database.restoreSecurityProfile).toBe('postgres-owners-and-acls-v1');
    await restoreBackup({
      sourceDatabaseUrl: database.databaseUrl,
      targetDatabaseUrl: restoreTarget.databaseUrl,
      targetAssetRoot: restoredAssetRoot,
      backupDirectory: postResetBackupDirectory,
      backupRoot,
      toolMode: backupToolMode,
    });
    restoreTargetPool = restoreTarget.createPool();
    const restoredProjectState = await restoreTargetPool.query<{
      epoch: string;
      state: string;
      source_count: string;
      claim_count: string;
    }>(
      `SELECT epoch.epoch::text, epoch.state,
              (SELECT count(*)::text FROM asset.sources WHERE project_id = epoch.project_id) AS source_count,
              (SELECT count(*)::text FROM canonical.claims WHERE project_id = epoch.project_id) AS claim_count
         FROM project_admin.project_knowledge_epoch AS epoch
        WHERE epoch.project_id = $1`,
      [projectId],
    );
    expect(restoredProjectState.rows).toEqual([
      { epoch: '1', state: 'READY', source_count: '0', claim_count: '0' },
    ]);
    await expect(
      new PostgresKnowledgeResetPersistence(
        restoreTargetPool,
      ).fingerprintPreservedProjectConfiguration(projectId),
    ).resolves.toBe(preservedDigestAtBackup);
    await expect(
      readFile(path.join(restoredAssetRoot, ...retainedSharedStorageKey.split('/'))),
    ).resolves.toEqual(Buffer.from(firstText, 'utf8'));

    const secondText = 'T3 acceptance statement: a new source is citable after reset.';
    const secondSource = await issueSource(app, 'T3 fresh source', secondText, csrf);
    const secondCandidate = await prepareCandidate(app, secondSource);
    const secondReview = await approveCandidate(app, secondCandidate.candidateId, csrf);
    const secondAsk = await askForSource(app, secondSource, secondCandidate.evidenceId, csrf);
    expect(secondSource.sourceId).not.toBe(firstSource.sourceId);
    expect(secondSource.sourceVersionId).not.toBe(firstSource.sourceVersionId);
    expect(secondReview.changeSetId).not.toBe(firstReview.changeSetId);
    expect(secondAsk.answerRunId).not.toBe(firstAsk.answerRunId);
    expect((await canonical.getSnapshot(projectId)).claims[0]?.text).toBe(secondText);
    expect(providerCalls).toBe(2);

    const orphanBytes = Buffer.from('unreferenced T3 CAS bytes', 'utf8');
    const orphanHash = `sha256:${createHash('sha256').update(orphanBytes).digest('hex')}`;
    const orphanStorageKey = await storage.put(orphanHash, orphanBytes);
    const orphanFile = path.join(assetRoot, ...orphanStorageKey.split('/'));
    const oldTimestamp = new Date(Date.now() - 60_000);
    await utimes(orphanFile, oldTimestamp, oldTimestamp);
    await expect(
      readFile(path.join(assetRoot, ...retainedSharedStorageKey.split('/'))),
    ).resolves.toEqual(Buffer.from(firstText, 'utf8'));

    const migrationTime = await adminPool.query<{ applied_at: Date }>(
      `SELECT applied_at FROM runtime.schema_migrations
        WHERE name = '077_ts5_asset_cas_lifecycle.sql'`,
    );
    const originalMigrationTime = migrationTime.rows[0]?.applied_at;
    if (!originalMigrationTime) throw new Error('CAS lifecycle migration is not registered.');
    await adminPool.query(
      `UPDATE runtime.schema_migrations
          SET applied_at = clock_timestamp() - interval '31 days'
        WHERE name = '077_ts5_asset_cas_lifecycle.sql'`,
    );
    let quarantinePath: string | undefined;
    try {
      const quarantineReport = await runAssetCasGc({
        databaseUrl: database.databaseUrl,
        assetRoot,
        apply: true,
        minAgeMs: 1_000,
        quarantineAgeMs: 200,
        maxCandidates: 10,
      });
      expect(quarantineReport.legacyCutover).toBe('OPEN');
      expect(quarantineReport.candidateCount).toBe(1);
      expect(quarantineReport.quarantinedCount).toBe(1);
      expect(quarantineReport.sweptCount).toBe(0);
      const quarantineManifest = JSON.parse(
        await readFile(quarantineReport.auditPath!, 'utf8'),
      ) as { moved: readonly { storageKey: string; quarantinePath: string }[] };
      expect(quarantineManifest.moved).toEqual([
        expect.objectContaining({ storageKey: orphanStorageKey }),
      ]);
      quarantinePath = path.join(
        assetRoot,
        ...quarantineManifest.moved[0]!.quarantinePath.split('/'),
      );
      await expect(access(orphanFile)).rejects.toThrow();
      await expect(readFile(quarantinePath)).resolves.toEqual(orphanBytes);
      await expect(
        readFile(path.join(assetRoot, ...retainedSharedStorageKey.split('/'))),
      ).resolves.toEqual(Buffer.from(firstText, 'utf8'));

      await new Promise((resolve) => setTimeout(resolve, 250));
      const sweepReport = await runAssetCasGc({
        databaseUrl: database.databaseUrl,
        assetRoot,
        apply: true,
        minAgeMs: 1_000,
        quarantineAgeMs: 200,
        maxCandidates: 10,
      });
      expect(sweepReport.quarantinedCount).toBe(0);
      expect(sweepReport.sweptCount).toBe(1);
      await expect(access(quarantinePath)).rejects.toThrow();
      await expect(
        readFile(path.join(assetRoot, ...retainedSharedStorageKey.split('/'))),
      ).resolves.toEqual(Buffer.from(firstText, 'utf8'));
    } finally {
      await adminPool.query(
        `UPDATE runtime.schema_migrations SET applied_at = $1
          WHERE name = '077_ts5_asset_cas_lifecycle.sql'`,
        [originalMigrationTime],
      );
    }
  }, 120_000);
});
