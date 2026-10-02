import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FakeDraftActionConnector } from '../../../adapters/action-connector-fake/src/index.js';
import { FakeAIProviderAdapter } from '../../../adapters/ai-provider-fake/src/index.js';
import { StructuredAskAnswerProviderAdapter } from '../../../adapters/ai-provider-ask/src/index.js';
import { PostgresVPRelationJobs } from '../../../adapters/vp-knowledge-postgres/src/relation-jobs.js';
import { PostgresFrontendCommandGateway } from '../../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresFrontendKnowledgeDraftRepository } from '../../../adapters/frontend-knowledge-draft-postgres/src/index.js';
import { PostgresFrontendKnowledgeDraftTargetResolver } from '../../../adapters/frontend-knowledge-draft-api-postgres/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../../adapters/frontend-ask-write-postgres/src/index.js';
import { PostgresAskAnswerExecutionRepository } from '../../../adapters/frontend-ask-execution-postgres/src/index.js';
import { PostgresVPAskEvidenceSearch } from '../../../adapters/vp-knowledge-postgres/src/ask-evidence-search.js';
import { OriginalAssetAskSourceVersionContextReader } from '../../../adapters/frontend-ask-source-context-original-asset/src/index.js';
import { createPostgresActivityReadModelStore } from '../../../adapters/frontend-activity-postgres/src/index.js';
import {
  createPostgresHistoryReadModelStore,
  PostgresPayloadStateStore,
} from '../../../adapters/frontend-history-postgres/src/index.js';
import { PostgresFrontendReviewRepository } from '../../../adapters/frontend-review-postgres/src/index.js';
import { createPostgresReviewDraftSourceReader } from '../../../adapters/frontend-review-postgres/src/index.js';
import { PostgresExternalActionStore } from '../../../adapters/frontend-external-action-postgres/src/index.js';
import { CanonicalHistoryAdapter } from '../../../adapters/frontend-history-canonical/src/index.js';
import { ReviewHistoryAdapter } from '../../../adapters/frontend-history-review/src/index.js';
import { ExternalActionHistoryAdapter } from '../../../adapters/frontend-history-external-action/src/index.js';
import { PolicyHistoryAdapter } from '../../../adapters/frontend-history-policy/src/index.js';
import {
  PostgresKnowledgeWorkspaceProjection,
  type KnowledgeWorkspaceQueryExecutor,
} from '../../../adapters/frontend-product-read-postgres/src/index.js';
import { PostgresSourcesActivityRead } from '../../../adapters/frontend-sources-write-postgres/src/activity-read.js';
import { PostgresAskActivityRead } from '../../../adapters/frontend-ask-execution-postgres/src/activity-read.js';
import {
  InMemoryActionCenterProjection,
  InMemoryBackgroundSummaryProjection,
  InMemoryGlobalSearch,
  InMemoryGlobalShellProjection,
  InMemoryNotificationSummaryProjection,
  InMemoryRouteGuardProjection,
} from '../../../adapters/frontend-product-read-in-memory/src/index.js';
import { SealedSourcesStagingService } from '../../../adapters/frontend-sources-staging-sealed/src/index.js';
import { PostgresSourcesProductService } from '../../../adapters/frontend-sources-write-postgres/src/product-service.js';
import { InMemoryAssetStorage } from '../../../adapters/stage2-in-memory/src/index.js';
import { JsDiffAdapter } from '../../../adapters/text-diff-jsdiff/src/index.js';
import { LucasAugmentedPlainTextAdapter } from '../../../adapters/plain-text-lucas-augmented/src/index.js';
import { PythonDocumentFormatAdapter } from '../../../adapters/document-format-python/src/index.js';
import { createProductionStage3Pipeline } from '../../../adapters/sources-stage3-pipeline/src/index.js';
import {
  createPostgresPool,
  PostgresIntakeRepository,
  PostgresOriginalAssetRepository,
  PostgresPolicyHistoryReadAdapter,
  PostgresProjectAdministrationRepository,
  PostgresProjectBootstrapUnitOfWork,
  PostgresProjectTombstoneStore,
  PostgresSettingsRepository,
} from '../../../adapters/postgres/src/index.js';
import {
  PostgresActionCandidateRepository,
  PostgresActionExecutionRepository,
} from '../../../adapters/postgres-stage11/src/index.js';
import { PostgresCompiledTruthRepository } from '../../../adapters/postgres-stage10/src/index.js';
import {
  PostgresEvidenceRepository,
  PostgresTransformationRepository,
} from '../../../adapters/postgres-stage3/src/index.js';
import {
  PostgresSourcesStage3AtomicPersistence,
  PostgresSourcesStage3ProgressRepository,
  PostgresSourcesStage4ContinuationStore,
} from '../../../adapters/postgres-stage3/src/runtime-data-integrity.js';
import {
  PostgresAIProviderCallRepository,
  PostgresCandidateRepository,
  PostgresValidationRepository,
} from '../../../adapters/postgres-stage4/src/index.js';
import {
  PostgresChangeSetReviewRepository,
  PostgresComparisonRepository,
} from '../../../adapters/postgres-stage5/src/index.js';
import { PostgresCanonicalKnowledgeRepository } from '../../../adapters/postgres-stage6/src/index.js';
import { PostgresSearchProjectionRepository } from '../../../adapters/postgres-stage7/src/index.js';
import { PostgresKnowledgeModelRepository } from '../../../adapters/postgres-stage9/src/index.js';
import { PostgresAuthRepository } from '../../../adapters/postgres-auth/src/index.js';
import { PostgresVPKnowledgeLedger } from '../../../adapters/vp-knowledge-postgres/src/index.js';
import { GeneralAIVPDecisionAdapter } from '../../../adapters/vp-decision-general-ai/src/index.js';
import { AskCommandCoordinator } from '../../../modules/frontend-ask-write/src/index.js';
import { AskAnswerExecutionService } from '../../../modules/frontend-ask-execution/src/index.js';
import { VPAssertionLedgerWorker } from '../../../modules/vp-knowledge-ledger/src/index.js';
import { VPRelationDecisionRouter } from '../../../modules/vp-decision/src/index.js';
import { VPRelationJobWorker } from '../../../modules/vp-knowledge-ledger/src/index.js';
import { startVPCandidatePolicyRefreshWorker } from '../../../assemblies/shotgun-app/src/vp-candidate-policy-refresh.js';
import type {
  AIProviderAdapterPort,
  AIProviderExecutionResolverPort,
  AIProviderPolicy,
} from '../../../modules/ai-provider/src/index.js';
import { SourcesStage4ContinuationDispatcher } from '../../../adapters/sources-stage3-pipeline/src/index.js';
import type {
  SourcesStage3EvidenceIndexedInput,
  SourcesStage4ContinuationPort,
} from '../../../modules/frontend-sources-write/src/index.js';
import { FrontendProductReadCoordinator } from '../../../modules/frontend-product-read/src/index.js';
import {
  createHistoryAdapterRegistry,
  HistoryProjectionBuilder,
} from '../../../modules/frontend-history/src/index.js';
import { frontendKnowledgeDraftRevisionDigest } from '../../../packages/contracts/src/index.js';
import { configureSourcesWriteRuntime } from '../../../assemblies/shotgun-app/src/product-api/sources-write-runtime.js';
import { createApplication } from '../../../assemblies/shotgun-app/src/server.js';
import {
  DEFAULT_PROJECT_ID,
  LOCAL_OWNER_ACCOUNT_ID,
} from '../../../packages/authentication/src/index.js';
import { requireTestDatabaseTarget } from '../../../scripts/database-target-guard.js';

/**
 * WP-XP1 — Cross-Phase production-composition parity fixture.
 *
 * Mirrors `assemblies/shotgun-app/src/main.ts` adapter composition exactly:
 *  - PostgreSQL adapters for every authority Domain (Ask, Knowledge Draft,
 *    Review boundary, Canonical, Change-Set-Review, External Action
 *    candidate/execution, Activity read model, History read model / payload
 *    state / tombstone / policy history, Settings, Project/Auth, Sources).
 *  - The SAME InMemory read projections `main.ts` itself uses (global shell,
 *    action center, background, notifications, global search, route guard).
 *  - Deterministic fakes ONLY at external side-effect boundaries:
 *    `FakeAIProviderAdapter` (instead of Gemini) wrapped in the same
 *    `StructuredAskAnswerProviderAdapter`; `FakeDraftActionConnector` (same as
 *    main.ts).
 *
 * It listens on 127.0.0.1:3002 and is used ONLY by the Cross-Phase journey
 * spec; the existing per-Section browser fixture on 3001 is untouched.
 */
export type FrontendCrossPhaseBackendOptions = {
  readonly databaseUrl?: string;
  readonly aiProvider?: AIProviderAdapterPort;
  readonly aiProviderPolicy?: AIProviderPolicy;
  readonly aiCandidatePromptVersion?: string;
  readonly enableVPRelationWorker?: boolean;
};

export async function startFrontendCrossPhaseBackend(
  options: FrontendCrossPhaseBackendOptions = {},
) {
  const databaseUrl = options.databaseUrl ?? (await requireTestDatabaseTarget());
  const pool = createPostgresPool(databaseUrl);
  const aiProvider = options.aiProvider ?? new FakeAIProviderAdapter();
  const authRepository = new PostgresAuthRepository(pool);
  const projectAdminRepository = new PostgresProjectAdministrationRepository(pool);

  const localOwner = await authRepository.bootstrapLocalOwnerPrincipal({
    accountId: LOCAL_OWNER_ACCOUNT_ID,
  });
  const principalId = localOwner.principalId;
  // The existing per-Section fixture already creates the default `shotgun`
  // project and the owner membership on the shared database. The Cross-Phase
  // journey creates its own projects through the real Settings/Product API,
  // so the default project creation here is guarded (idempotent across the
  // two backends sharing the validated TEST_DATABASE_URL).
  try {
    await projectAdminRepository.createProject({
      commandId: 'cross-phase-default-project',
      clientRequestId: 'cross-phase-default-project',
      idempotencyKey: 'cross-phase-default-project',
      projectId: DEFAULT_PROJECT_ID,
      name: 'shotgun',
      description: 'Cross-Phase test default Project',
      actorPrincipalId: principalId,
      expectedProjectRevision: 0,
    });
    await authRepository.createProjectOwnerMembership({
      principalId,
      projectId: DEFAULT_PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('projects_pkey') && !message.includes('duplicate key')) {
      throw error;
    }
  }

  const assetStorage = new InMemoryAssetStorage();
  const commandGateway = new PostgresFrontendCommandGateway(pool);
  const staging = new SealedSourcesStagingService(
    assetStorage,
    'cross-phase-sources-staging-secret-32-characters',
  );
  // FE-P5-XP Correction C: Source Intake → Stage 3 Transformation/Evidence
  // production wiring (real path — the product service runs this pipeline
  // after a successful intake materializes a SourceVersion). Hoisted before
  // the sources product service so the real Stage 3 adapters are injected.
  const transformationRepository = new PostgresTransformationRepository(pool);
  const evidenceRepository = new PostgresEvidenceRepository(pool);
  const stage3Progress = new PostgresSourcesStage3ProgressRepository(pool);
  const stage3AtomicPersistence = new PostgresSourcesStage3AtomicPersistence(pool);
  const stage4ContinuationStore = new PostgresSourcesStage4ContinuationStore(pool);
  const stage4Publisher: {
    current?: (input: SourcesStage3EvidenceIndexedInput) => Promise<void>;
  } = {};
  const sourcesStage4Continuation: SourcesStage4ContinuationPort = {
    onEvidenceIndexed: async (input) => {
      if (!stage4Publisher.current) throw new Error('Stage 4 continuation is not ready.');
      await stage4Publisher.current(input);
    },
  };
  const transformer = new PythonDocumentFormatAdapter();
  const evidenceLocator = new LucasAugmentedPlainTextAdapter();
  const sourcesStage3Pipeline = createProductionStage3Pipeline({
    storage: assetStorage,
    transformer,
    locator: evidenceLocator,
    transformationRepository,
    evidenceRepository,
    progress: stage3Progress,
    atomicPersistence: stage3AtomicPersistence,
    stage4: sourcesStage4Continuation,
  });
  const sourcesProductService = new PostgresSourcesProductService(
    pool,
    staging,
    sourcesStage3Pipeline,
  );
  const removeSourcesWriteRuntime = configureSourcesWriteRuntime({
    commandGateway,
    staging,
    productService: sourcesProductService,
  });

  const askWorkspaceProjection = new PostgresAskWorkspaceProjection(pool);
  const originalAssetRepository = new PostgresOriginalAssetRepository(pool);
  const askAnswerProvider = new StructuredAskAnswerProviderAdapter(aiProvider, {
    allowPrivate: true,
    allowRestricted: false,
    dataPolicyVersion: 'cross-phase-ask-policy-v1',
  });
  const vpEvidenceSearch = new PostgresVPAskEvidenceSearch(pool);
  const askExecutionRepository = new PostgresAskAnswerExecutionRepository(
    pool,
    askWorkspaceProjection,
    new OriginalAssetAskSourceVersionContextReader(originalAssetRepository, assetStorage),
    undefined,
    vpEvidenceSearch,
  );
  const askWorkerDiagnostics = {
    recoverInterruptedCalls: 0,
    recoveredRuns: 0,
    recoverErrorCount: 0,
    claimCalls: 0,
    claimsReturned: 0,
    emptyClaimCalls: 0,
    claimErrorCount: 0,
  };
  const measuredAskExecutionRepository = new Proxy(askExecutionRepository, {
    get(target, property) {
      const member = Reflect.get(target, property, target) as unknown;
      if (property === 'recoverInterrupted' && typeof member === 'function') {
        return async (...args: unknown[]) => {
          askWorkerDiagnostics.recoverInterruptedCalls += 1;
          try {
            const recoveredRuns = (await member.apply(target, args)) as number;
            askWorkerDiagnostics.recoveredRuns += recoveredRuns;
            return recoveredRuns;
          } catch (error) {
            askWorkerDiagnostics.recoverErrorCount += 1;
            throw error;
          }
        };
      }
      if (property === 'claimQueuedForWorker' && typeof member === 'function') {
        return async (...args: unknown[]) => {
          askWorkerDiagnostics.claimCalls += 1;
          try {
            const claims = (await member.apply(target, args)) as readonly unknown[];
            askWorkerDiagnostics.claimsReturned += claims.length;
            if (claims.length === 0) askWorkerDiagnostics.emptyClaimCalls += 1;
            return claims;
          } catch (error) {
            askWorkerDiagnostics.claimErrorCount += 1;
            throw error;
          }
        };
      }
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
  const askAnswerExecution = new AskAnswerExecutionService(
    measuredAskExecutionRepository,
    askAnswerProvider,
    { maxConcurrency: 2 },
  );
  const askCommandCoordinator = new AskCommandCoordinator(
    commandGateway,
    new PostgresAskConversationRepository(pool),
    askWorkspaceProjection,
    new PostgresAskSourceSelectionValidator(pool),
    askAnswerExecution,
  );
  const canonicalKnowledgeRepository = new PostgresCanonicalKnowledgeRepository(pool);
  const changeSetReviewRepository = new PostgresChangeSetReviewRepository(pool);
  // Server-owned External Action boundary. Credential + per-project budget are
  // seeded here exactly as an administrator configures them in production
  // (they are NEVER declared by the browser). Without the seeded credential
  // and budget the fake-connector preflight revalidations fail closed and the
  // journey cannot reach READY (Cross-Phase WP-XP2 discovery).
  const externalActionStore = new PostgresExternalActionStore(pool);
  for (const projectId of [
    'journey-alpha',
    'journey-beta',
    // WP-XP3 negative journey projects (CP-NEG-01~06) need the same
    // operator-seeded credential + budget to reach READY preflights.
    'neg-alpha',
    'neg-beta',
  ]) {
    await externalActionStore.transaction(async (repositories) => {
      await repositories.credentials.insert({
        schemaVersion: '1.0.0',
        connectorId: 'fake-connector',
        name: 'Fake Connector',
        status: 'CONFIGURED',
        maskedCredential: 'ab••••••••cd',
        capabilities: ['TEST', 'ROTATE', 'REVOKE'],
      });
      await repositories.budgets.insert({
        schemaVersion: '1.0.0',
        projectId,
        status: 'OK',
        usedExecutions: 0,
        remainingExecutions: 100,
        softLimit: 80,
        hardLimit: 100,
        exhausted: false,
      });
    });
  }
  // Shared server-owned boundary instances (hoisted so the History projection
  // builder observes the SAME stores the Product API reads).
  const frontendReviewStore = new PostgresFrontendReviewRepository(pool);
  const policyHistoryRead = new PostgresPolicyHistoryReadAdapter(pool);
  const historyReadModelStore = createPostgresHistoryReadModelStore(pool);
  const historyPayloadStates = {
    CANONICAL: new PostgresPayloadStateStore(pool, 'CANONICAL'),
    REVIEW: new PostgresPayloadStateStore(pool, 'REVIEW'),
    EXTERNAL_ACTION: new PostgresPayloadStateStore(pool, 'EXTERNAL_ACTION'),
    SETTINGS: new PostgresPayloadStateStore(pool, 'SETTINGS'),
  };
  // Federated History projection is NON-AUTHORITATIVE and rebuildable (ADR-131
  // §2, IR r1 §4). There is deliberately NO browser refresh route (WP4 Round 1
  // fix E); an OPERATOR rebuilds the projection with the same adapters the
  // Product API reads. The journey performs this operator step with the REAL
  // HistoryProjectionBuilder + adapters (no stubs), then reads the REAL
  // History Product API.
  const historyProjectionBuilder = new HistoryProjectionBuilder(
    createHistoryAdapterRegistry([
      new CanonicalHistoryAdapter(canonicalKnowledgeRepository, historyPayloadStates.CANONICAL),
      new ReviewHistoryAdapter(frontendReviewStore, historyPayloadStates.REVIEW),
      new ExternalActionHistoryAdapter(externalActionStore, historyPayloadStates.EXTERNAL_ACTION),
      new PolicyHistoryAdapter(policyHistoryRead, historyPayloadStates.SETTINGS),
    ]),
    historyReadModelStore,
  );
  // Production-parity read coordinator: the Knowledge Workspace projection is
  // backed by the kernel connector (same as main.ts) so CP-AC-05 Knowledge
  // reads resolve real Canonical state after the journey commit.
  const frontendProductReadCoordinatorFactory = (connector: {
    query<TResult>(envelope: unknown): Promise<{ result: { payload: TResult } }>;
  }) =>
    new FrontendProductReadCoordinator(
      new InMemoryGlobalShellProjection(),
      new InMemoryActionCenterProjection(),
      new InMemoryBackgroundSummaryProjection(),
      new InMemoryNotificationSummaryProjection(),
      new InMemoryGlobalSearch(),
      new InMemoryRouteGuardProjection(),
      askWorkspaceProjection,
      new PostgresKnowledgeWorkspaceProjection({
        query: async <TResult>({
          envelope,
        }: Parameters<KnowledgeWorkspaceQueryExecutor['query']>[0]) =>
          (await connector.query<TResult>(envelope)).result.payload,
      }),
    );
  const application = await createApplication({
    projectAdminRepository,
    projectBootstrapUnitOfWork: new PostgresProjectBootstrapUnitOfWork(pool),
    projectTombstoneStore: new PostgresProjectTombstoneStore(pool),
    settingsRepository: new PostgresSettingsRepository(pool),
    frontendCommandGateway: commandGateway,
    frontendKnowledgeDraftRepository: new PostgresFrontendKnowledgeDraftRepository(pool),
    frontendKnowledgeDraftTargetResolver: new PostgresFrontendKnowledgeDraftTargetResolver(pool),
    frontendReviewDraftSourceReader: createPostgresReviewDraftSourceReader(pool),
    frontendReviewStore,
    askCommandCoordinator,
    frontendProductReadCoordinatorFactory,
    activityExternalActionBoundary: externalActionStore,
    intakeRepository: new PostgresIntakeRepository(pool),
    originalAssetRepository,
    assetStorage,
    transformationRepository: transformationRepository,
    evidenceRepository: evidenceRepository,
    aiProviderRepository: new PostgresAIProviderCallRepository(pool),
    candidateRepository: new PostgresCandidateRepository(pool),
    validationRepository: new PostgresValidationRepository(pool),
    comparisonRepository: new PostgresComparisonRepository(pool),
    changeSetReviewRepository,
    canonicalSnapshot: canonicalKnowledgeRepository,
    canonicalKnowledgeRepository,
    searchProjectionRepository: new PostgresSearchProjectionRepository(pool),
    knowledgeModelRepository: new PostgresKnowledgeModelRepository(pool),
    compiledTruthRepository: new PostgresCompiledTruthRepository(pool),
    actionCandidateRepository: new PostgresActionCandidateRepository(pool),
    actionExecutionRepository: new PostgresActionExecutionRepository(pool),
    authRepository,
    aiProvider,
    ...(options.aiProviderPolicy ? { aiProviderPolicy: options.aiProviderPolicy } : {}),
    ...(options.aiCandidatePromptVersion
      ? { aiCandidatePromptVersion: options.aiCandidatePromptVersion }
      : {}),
    production: false,
    activitySourcesRead: new PostgresSourcesActivityRead(pool, sourcesProductService),
    activityAskRead: new PostgresAskActivityRead(pool),
    activityReadModelStore: createPostgresActivityReadModelStore(pool),
    historyReadModelStore,
    historyPayloadStates,
    historyReviewBoundary: frontendReviewStore,
    policyHistoryRead,
    actionConnector: new FakeDraftActionConnector(),
    textDiff: new JsDiffAdapter(),
    transformer,
    evidenceLocator,
    askAnswerExecution,
    closeResources: async () => {
      removeSourcesWriteRuntime();
      await pool.end();
    },
  });
  stage4Publisher.current = async (input) => {
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
    if (failed) throw new Error(`Stage 4 continuation failed for ${failed.consumerId}.`);
  };
  await application.server.listen({ host: '127.0.0.1', port: 3002 });
  const stopStage4Worker = await new SourcesStage4ContinuationDispatcher(
    stage4ContinuationStore,
    sourcesStage4Continuation,
    { intervalMs: 250 },
  ).startWorker();
  const stopVPAssertionWorker = await new VPAssertionLedgerWorker(
    new PostgresVPKnowledgeLedger(pool),
    250,
  ).startWorker();
  let stopVPCandidatePolicyRefreshWorker: () => Promise<void> = async () => {};
  if (options.aiCandidatePromptVersion) {
    stopVPCandidatePolicyRefreshWorker = await startVPCandidatePolicyRefreshWorker(
      pool,
      application.kernel.connector,
      options.aiCandidatePromptVersion,
      50,
    );
  }
  let stopVPRelationWorker: () => Promise<void> = async () => {};
  if (options.enableVPRelationWorker) {
    const decisionResolver: AIProviderExecutionResolverPort = {
      resolve: async () => ({ adapter: aiProvider, executionIdentity: {} as never }),
    };
    const relationJobs = new PostgresVPRelationJobs(pool);
    stopVPRelationWorker = await new VPRelationJobWorker(
      relationJobs,
      new VPRelationDecisionRouter(
        undefined,
        new GeneralAIVPDecisionAdapter(decisionResolver, relationJobs),
        {
          revision: 'vp-deepseek-relation-v6-evidence-context',
          minimumChoiceProbability: 0.9,
          maximumDeepAnalysisScore: 0,
          maximumInputTokens: 4_000,
          maximumOutputTokens: 256,
        },
      ),
      async (job) =>
        job.left.sensitivity !== 'restricted' &&
        job.right.sensitivity !== 'restricted' &&
        job.left.accessScope.length > 0 &&
        job.left.accessScope.every((entry) => job.right.accessScope.includes(entry)),
      'vp-deepseek-relation-v6-evidence-context',
      250,
      1,
    ).startWorker();
  }
  let stopAskWorker: () => Promise<void> = async () => {};
  let askWorkerStartFailure: string | undefined;
  try {
    stopAskWorker = await askAnswerExecution.startWorker(250);
  } catch (error) {
    askWorkerStartFailure = error instanceof Error ? error.message : String(error);
    console.error('[ask-answer-worker] failed to start', askWorkerStartFailure);
  }

  let closing = false;
  return {
    askWorkerStarted: askWorkerStartFailure === undefined,
    ...(askWorkerStartFailure ? { askWorkerStartFailure } : {}),
    getAskWorkerDiagnostics: () => ({ ...askWorkerDiagnostics }),
    /**
     * Operator step (WP4 Round 1 fix E — there is intentionally NO browser
     * History refresh route): rebuild the federated History projection for a
     * project with the REAL HistoryProjectionBuilder + owning-Domain adapters.
     */
    rebuildHistoryProjection: async (resourceProjectId: string) =>
      historyProjectionBuilder.buildProjectProjection(resourceProjectId),
    /**
     * Provisioning step (server-owned auth state): grant the CURRENT
     * `project:action:rollback` capability to the journey principal on a
     * project — the same way an administrator provisions a project owner in
     * production (there is no browser API for membership grants).
     */
    grantRollbackCapability: async (projectId: string) => {
      await authRepository.createProjectOwnerMembership({
        principalId,
        projectId,
        scopes: ['owner', 'project:action:rollback'],
        sensitivityClearance: 'private',
      });
    },
    /**
     * Draft content-digest helper. Exposed from the fixture (loaded through
     * the tsx ESM loader) so the journey spec never imports the contracts
     * package directly (Playwright's spec loader does not handle the
     * contracts JSON-schema import attributes).
     */
    hasEvidenceSelector: async (
      projectId: string,
      mediaType: string,
      selectorType: string,
    ): Promise<boolean> => {
      const result = await pool.query<{ ready: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM evidence.spans e
           JOIN asset.source_versions v ON v.source_version_id = e.source_version_id
           JOIN asset.sources s ON s.source_id = v.source_id
           WHERE s.project_id = $1 AND v.media_type = $2
             AND e.selectors @> $3::jsonb
         ) AS ready`,
        [projectId, mediaType, JSON.stringify([{ type: selectorType }])],
      );
      return result.rows[0]?.ready ?? false;
    },
    sourceHasMediaType: async (
      projectId: string,
      sourceId: string,
      mediaType: string,
    ): Promise<boolean> => {
      const result = await pool.query<{ ready: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM asset.sources s
           JOIN asset.source_versions v ON v.source_id = s.source_id
           WHERE s.project_id = $1 AND s.source_id = $2::uuid AND v.media_type = $3
         ) AS ready`,
        [projectId, sourceId, mediaType],
      );
      return result.rows[0]?.ready ?? false;
    },
    computeDraftRevisionDigest: (input: {
      draftId: string;
      revision: number;
      base: unknown;
      operations: readonly unknown[];
    }) =>
      frontendKnowledgeDraftRevisionDigest({
        draftId: input.draftId,
        revision: input.revision,
        base: input.base as never,
        operations: input.operations as never[],
      }),
    close: async () => {
      if (closing) return;
      closing = true;
      await stopVPCandidatePolicyRefreshWorker();
      await stopVPRelationWorker();
      await stopAskWorker();
      await stopVPAssertionWorker();
      await stopStage4Worker();
      await application.server.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void (async () => {
    const backend = await startFrontendCrossPhaseBackend();
    const shutdown = () => {
      void backend.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  })();
}
