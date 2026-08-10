import path from 'node:path';

import 'dotenv/config';

import { FakeDraftActionConnector } from '../../../adapters/action-connector-fake/src/index.js';
import { LocalAssetStorage } from '../../../adapters/asset-storage-local/src/index.js';
import { GeminiAIProviderAdapter } from '../../../adapters/ai-provider-gemini/src/index.js';
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
import {
  InMemoryActionCenterProjection,
  InMemoryBackgroundSummaryProjection,
  InMemoryGlobalSearch,
  InMemoryGlobalShellProjection,
  InMemoryNotificationSummaryProjection,
  InMemoryRouteGuardProjection,
} from '../../../adapters/frontend-product-read-in-memory/src/index.js';
import {
  PostgresKnowledgeWorkspaceProjection,
  type KnowledgeWorkspaceQueryExecutor,
} from '../../../adapters/frontend-product-read-postgres/src/index.js';
import { SealedSourcesStagingService } from '../../../adapters/frontend-sources-staging-sealed/src/index.js';
import { PostgresSourcesProductService } from '../../../adapters/frontend-sources-write-postgres/src/product-service.js';
import { PostgresSourcesActivityRead } from '../../../adapters/frontend-sources-write-postgres/src/activity-read.js';
import { PostgresAskActivityRead } from '../../../adapters/frontend-ask-execution-postgres/src/activity-read.js';
import { createPostgresActivityReadModelStore } from '../../../adapters/frontend-activity-postgres/src/index.js';
import {
  createPostgresHistoryReadModelStore,
  PostgresPayloadStateStore,
} from '../../../adapters/frontend-history-postgres/src/index.js';
import { PostgresFrontendReviewRepository } from '../../../adapters/frontend-review-postgres/src/index.js';
import { createPostgresReviewDraftSourceReader } from '../../../adapters/frontend-review-postgres/src/index.js';
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
import { SourcesStage3Pipeline } from '../../../adapters/sources-stage3-pipeline/src/index.js';
import { JsDiffAdapter } from '../../../adapters/text-diff-jsdiff/src/index.js';
import {
  NodeUrlHopTransport,
  NodeUrlResolver,
} from '../../../adapters/url-acquisition-node/src/index.js';
import { AskCommandCoordinator } from '../../../modules/frontend-ask-write/src/index.js';
import { AskAnswerExecutionService } from '../../../modules/frontend-ask-execution/src/index.js';
import { FrontendProductReadCoordinator } from '../../../modules/frontend-product-read/src/index.js';
import { SecureUrlAcquisitionCoordinator } from '../../../modules/url-acquisition/src/index.js';
import { configureSourcesWriteRuntime } from './product-api/sources-write-runtime.js';
import { assertRuntimeSecurityConfiguration } from './runtime-security.js';
import { createApplication } from './server.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for persistent Stage 2 runtime.');
}

const stagingSecret = process.env.SOURCES_STAGING_SECRET;
if (!stagingSecret || stagingSecret.trim().length < 32) {
  throw new Error('SOURCES_STAGING_SECRET with at least 32 characters is required.');
}

const pool = createPostgresPool(databaseUrl);
const geminiApiKey = process.env.GEMINI_API_KEY;
if (!geminiApiKey) {
  throw new Error('GEMINI_API_KEY is required for the persistent Stage 4 runtime.');
}
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '127.0.0.1';
const production = process.env.NODE_ENV === 'production';
assertRuntimeSecurityConfiguration({
  host,
  production,
  allowExternalBind: process.env.ALLOW_EXTERNAL_BIND === 'true',
  developmentAuthEnabled: process.env.SHOTGUN_DEVELOPMENT_AUTH === 'true',
});
const storageRoot = path.resolve(process.env.ASSET_STORAGE_ROOT ?? '.data/assets');
const assetStorage = new LocalAssetStorage(storageRoot);
const commandGateway = new PostgresFrontendCommandGateway(pool);
const urlAcquisition = new SecureUrlAcquisitionCoordinator(
  new NodeUrlResolver(),
  new NodeUrlHopTransport(),
);
const staging = new SealedSourcesStagingService(assetStorage, stagingSecret, urlAcquisition);
const plainTextAdapter = new LucasAugmentedPlainTextAdapter();
// FE-P5-XP Correction C: Source Intake → Stage 3 Transformation/Evidence
// production wiring (real path — the product service runs this pipeline after
// a successful intake materializes a SourceVersion).
const transformationRepository = new PostgresTransformationRepository(pool);
const evidenceRepository = new PostgresEvidenceRepository(pool);
const transformer = new PythonDocumentFormatAdapter();
const sourcesStage3Pipeline = new SourcesStage3Pipeline({
  storage: assetStorage,
  transformer,
  locator: plainTextAdapter,
  transformationRepository,
  evidenceRepository,
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
const canonicalKnowledgeRepository = new PostgresCanonicalKnowledgeRepository(pool);
const askConversationRepository = new PostgresAskConversationRepository(pool);
const askWorkspaceProjection = new PostgresAskWorkspaceProjection(pool);
const askSourceSelectionValidator = new PostgresAskSourceSelectionValidator(pool);
const geminiAIProvider = new GeminiAIProviderAdapter({
  apiKey: geminiApiKey,
  model: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash',
});
const askAnswerProvider = new StructuredAskAnswerProviderAdapter(geminiAIProvider, {
  allowPrivate: process.env.GEMINI_ALLOW_PRIVATE === 'true',
  allowRestricted: false,
  dataPolicyVersion: 'gemini-ask-policy-v1',
});
const askAnswerExecution = new AskAnswerExecutionService(
  new PostgresAskAnswerExecutionRepository(pool, askWorkspaceProjection),
  askAnswerProvider,
  {
    maxConcurrency: Number.parseInt(process.env.ASK_WORKER_MAX_CONCURRENCY ?? '4', 10),
  },
);
const askCommandCoordinator = new AskCommandCoordinator(
  commandGateway,
  askConversationRepository,
  askWorkspaceProjection,
  askSourceSelectionValidator,
  askAnswerExecution,
);
let stopAskAnswerWorker = async (): Promise<void> => {};

const { server } = await createApplication({
  projectAdminRepository: new PostgresProjectAdministrationRepository(pool),
  projectBootstrapUnitOfWork: new PostgresProjectBootstrapUnitOfWork(pool),
  projectTombstoneStore: new PostgresProjectTombstoneStore(pool),
  settingsRepository: new PostgresSettingsRepository(pool),
  frontendCommandGateway: commandGateway,
  frontendKnowledgeDraftRepository: new PostgresFrontendKnowledgeDraftRepository(pool),
  frontendKnowledgeDraftTargetResolver: new PostgresFrontendKnowledgeDraftTargetResolver(pool),
  frontendReviewDraftSourceReader: createPostgresReviewDraftSourceReader(pool),
  askCommandCoordinator,
  frontendProductReadCoordinatorFactory: (connector) =>
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
    ),
  intakeRepository: new PostgresIntakeRepository(pool),
  originalAssetRepository: new PostgresOriginalAssetRepository(pool),
  assetStorage,
  transformationRepository,
  evidenceRepository,
  aiProviderRepository: new PostgresAIProviderCallRepository(pool),
  candidateRepository: new PostgresCandidateRepository(pool),
  validationRepository: new PostgresValidationRepository(pool),
  comparisonRepository: new PostgresComparisonRepository(pool),
  changeSetReviewRepository: new PostgresChangeSetReviewRepository(pool),
  canonicalSnapshot: canonicalKnowledgeRepository,
  canonicalKnowledgeRepository,
  searchProjectionRepository: new PostgresSearchProjectionRepository(pool),
  knowledgeModelRepository: new PostgresKnowledgeModelRepository(pool),
  compiledTruthRepository: new PostgresCompiledTruthRepository(pool),
  actionCandidateRepository: new PostgresActionCandidateRepository(pool),
  actionExecutionRepository: new PostgresActionExecutionRepository(pool),
  authRepository: new PostgresAuthRepository(pool),
  production,
  frontendReviewStore: new PostgresFrontendReviewRepository(pool),
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
  transformer,
  evidenceLocator: plainTextAdapter,
  aiProvider: geminiAIProvider,
  askAnswerExecution,
  aiProviderPolicy: {
    allowPrivate: process.env.GEMINI_ALLOW_PRIVATE === 'true',
    allowRestricted: false,
    maxAttempts: 2,
  },
  closeResources: async () => {
    removeSourcesWriteRuntime();
    await stopAskAnswerWorker();
    await pool.end();
  },
});

stopAskAnswerWorker = await askAnswerExecution.startWorker(
  Number.parseInt(process.env.ASK_WORKER_INTERVAL_MS ?? '1000', 10),
);

await server.listen({ host, port });
