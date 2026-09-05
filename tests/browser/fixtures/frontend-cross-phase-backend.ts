import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FakeDraftActionConnector } from '../../../adapters/action-connector-fake/src/index.js';
import { FakeAIProviderAdapter } from '../../../adapters/ai-provider-fake/src/index.js';
import { StructuredAskAnswerProviderAdapter } from '../../../adapters/ai-provider-ask/src/index.js';
import { PostgresFrontendCommandGateway } from '../../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresFrontendKnowledgeDraftRepository } from '../../../adapters/frontend-knowledge-draft-postgres/src/index.js';
import { PostgresFrontendKnowledgeDraftTargetResolver } from '../../../adapters/frontend-knowledge-draft-api-postgres/src/index.js';
import {
  PostgresAskConversationRepository,
  PostgresAskSourceSelectionValidator,
  PostgresAskWorkspaceProjection,
} from '../../../adapters/frontend-ask-write-postgres/src/index.js';
import { PostgresAskAnswerExecutionRepository } from '../../../adapters/frontend-ask-execution-postgres/src/index.js';
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
import { AskCommandCoordinator } from '../../../modules/frontend-ask-write/src/index.js';
import { AskAnswerExecutionService } from '../../../modules/frontend-ask-execution/src/index.js';
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
export async function startFrontendCrossPhaseBackend() {
  const databaseUrl = await requireTestDatabaseTarget();
  const pool = createPostgresPool(databaseUrl);
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
  const askAnswerProvider = new StructuredAskAnswerProviderAdapter(new FakeAIProviderAdapter(), {
    allowPrivate: true,
    allowRestricted: false,
    dataPolicyVersion: 'cross-phase-ask-policy-v1',
  });
  const askAnswerExecution = new AskAnswerExecutionService(
    new PostgresAskAnswerExecutionRepository(
      pool,
      askWorkspaceProjection,
      new OriginalAssetAskSourceVersionContextReader(originalAssetRepository, assetStorage),
    ),
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
    aiProvider: new FakeAIProviderAdapter(),
    askAnswerExecution,
    aiProviderPolicy: { allowPrivate: true, allowRestricted: false, maxAttempts: 2 },
    closeResources: async () => {
      removeSourcesWriteRuntime();
      await pool.end();
    },
  });
  await application.server.listen({ host: '127.0.0.1', port: 3002 });
  let stopWorker: () => Promise<void> = async () => {};
  try {
    stopWorker = await askAnswerExecution.startWorker(250);
  } catch {
    // Worker start is best-effort for the journey; submissions can be polled.
  }

  let closing = false;
  return {
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
      await stopWorker();
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
