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
import { createPostgresActivityReadModelStore } from '../../../adapters/frontend-activity-postgres/src/index.js';
import {
  createPostgresHistoryReadModelStore,
  PostgresPayloadStateStore,
} from '../../../adapters/frontend-history-postgres/src/index.js';
import { PostgresFrontendReviewRepository } from '../../../adapters/frontend-review-postgres/src/index.js';
import { createPostgresReviewDraftSourceReader } from '../../../adapters/frontend-review-postgres/src/index.js';
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
import { configureSourcesWriteRuntime } from '../../../assemblies/shotgun-app/src/product-api/sources-write-runtime.js';
import { createApplication } from '../../../assemblies/shotgun-app/src/server.js';
import {
  DEFAULT_PROJECT_ID,
  LOCAL_OWNER_ACCOUNT_ID,
} from '../../../packages/authentication/src/index.js';

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
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the Cross-Phase fixture.');
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
  // two backends sharing DATABASE_URL).
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
  const sourcesProductService = new PostgresSourcesProductService(pool, staging);
  const removeSourcesWriteRuntime = configureSourcesWriteRuntime({
    commandGateway,
    staging,
    productService: sourcesProductService,
  });

  const askWorkspaceProjection = new PostgresAskWorkspaceProjection(pool);
  const askAnswerProvider = new StructuredAskAnswerProviderAdapter(new FakeAIProviderAdapter(), {
    allowPrivate: true,
    allowRestricted: false,
    dataPolicyVersion: 'cross-phase-ask-policy-v1',
  });
  const askAnswerExecution = new AskAnswerExecutionService(
    new PostgresAskAnswerExecutionRepository(pool, askWorkspaceProjection),
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
  const frontendProductReadCoordinator = new FrontendProductReadCoordinator(
    new InMemoryGlobalShellProjection(),
    new InMemoryActionCenterProjection(),
    new InMemoryBackgroundSummaryProjection(),
    new InMemoryNotificationSummaryProjection(),
    new InMemoryGlobalSearch(),
    new InMemoryRouteGuardProjection(),
    askWorkspaceProjection,
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
    askCommandCoordinator,
    frontendProductReadCoordinator,
    intakeRepository: new PostgresIntakeRepository(pool),
    originalAssetRepository: new PostgresOriginalAssetRepository(pool),
    assetStorage,
    transformationRepository: new PostgresTransformationRepository(pool),
    evidenceRepository: new PostgresEvidenceRepository(pool),
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
    historyReadModelStore: createPostgresHistoryReadModelStore(pool),
    historyPayloadStates: {
      CANONICAL: new PostgresPayloadStateStore(pool, 'CANONICAL'),
      REVIEW: new PostgresPayloadStateStore(pool, 'REVIEW'),
      EXTERNAL_ACTION: new PostgresPayloadStateStore(pool, 'EXTERNAL_ACTION'),
      SETTINGS: new PostgresPayloadStateStore(pool, 'SETTINGS'),
    },
    historyReviewBoundary: new PostgresFrontendReviewRepository(pool),
    policyHistoryRead: new PostgresPolicyHistoryReadAdapter(pool),
    actionConnector: new FakeDraftActionConnector(),
    textDiff: new JsDiffAdapter(),
    transformer: new PythonDocumentFormatAdapter(),
    evidenceLocator: new LucasAugmentedPlainTextAdapter(),
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
