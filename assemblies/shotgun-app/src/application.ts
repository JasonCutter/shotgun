import { randomUUID } from 'node:crypto';
import path from 'node:path';

import 'dotenv/config';

import type { FastifyInstance } from 'fastify';

import { FakeDraftActionConnector } from '../../../adapters/action-connector-fake/src/index.js';
import { LocalAssetStorage } from '../../../adapters/asset-storage-local/src/index.js';
import { FakeAIProviderAdapter } from '../../../adapters/ai-provider-fake/src/index.js';
import { GeminiAIProviderAdapter } from '../../../adapters/ai-provider-gemini/src/index.js';
import { GeminiConnectivityAdapter } from '../../../adapters/ai-provider-gemini/src/connectivity.js';
import { OpenAIConnectivityAdapter } from '../../../adapters/ai-provider-openai/src/index.js';
import { OpenAIEmbeddingConnectivityAdapter } from '../../../adapters/ai-provider-openai/src/embedding.js';
import { DeepSeekConnectivityAdapter } from '../../../adapters/ai-provider-deepseek/src/index.js';
import { PostgresCredentialVaultRepository } from '../../../adapters/credential-vault-postgres/src/index.js';
import { PostgresProjectAIConfigurationRepository } from '../../../adapters/ai-configuration-postgres/src/index.js';
import { PostgresProviderExternalTransferApprovalRepository } from '../../../adapters/provider-privacy-deployment-postgres/src/index.js';
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
import { PostgresAskProviderPolicyAuthorityReader } from '../../../adapters/frontend-ask-provider-policy-postgres/src/index.js';
import {
  InMemoryBackgroundSummaryProjection,
  InMemoryGlobalShellProjection,
  InMemoryNotificationSummaryProjection,
  InMemoryRouteGuardProjection,
} from '../../../adapters/frontend-product-read-in-memory/src/index.js';
import {
  PostgresKnowledgeWorkspaceProjection,
  PostgresSourceLibraryGlobalSearch,
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
import { PostgresSemanticCorpusSourceSnapshotReader } from '../../../adapters/semantic-corpus-postgres/src/index.js';
import {
  PostgresSemanticActiveGenerationReader,
  PostgresSemanticIndexRepository,
} from '../../../adapters/semantic-index-postgres/src/index.js';
import { PostgresSemanticEmbeddingProfileRepository } from '../../../adapters/semantic-embedding-postgres/src/index.js';
import { PostgresDiscoveryRuntimeRepository } from '../../../adapters/discovery-runtime-postgres/src/index.js';
import {
  PostgresDiscoveryApprovedResourceRevisionResolver,
  PostgresDiscoveryReentryRepository,
} from '../../../adapters/discovery-reentry-postgres/src/index.js';
import { PostgresDiscoveryFindingRepository } from '../../../adapters/discovery-finding-postgres/src/index.js';
import { PostgresDiscoveryModelProfileRepository } from '../../../adapters/discovery-model-profile-postgres/src/index.js';
import { PostgresDiscoveryScheduleRepository } from '../../../adapters/discovery-trigger-coordinator/src/index.js';
import { PostgresAuthRepository } from '../../../adapters/postgres-auth/src/index.js';
import { PersistentDiscoveryWorker } from '../../../modules/discovery-runtime/src/index.js';
import {
  DiscoveryReentryConsumer,
  PersistentDiscoveryReentryWorker,
} from '../../../modules/discovery-reentry/src/index.js';
import {
  DiscoveryModelProfileService,
  createDiscoveryAIGenerationService,
} from '../../../modules/discovery-ai-generation/src/index.js';
import { DiscoveryBudgetControllerV1 } from '../../../modules/discovery-quality-gate/src/index.js';
import { createProductDiscoveryExecution } from '../../../adapters/discovery-runtime-product/src/index.js';
import { SourcesStage3Pipeline } from '../../../adapters/sources-stage3-pipeline/src/index.js';
import { JsDiffAdapter } from '../../../adapters/text-diff-jsdiff/src/index.js';
import {
  NodeUrlHopTransport,
  NodeUrlResolver,
} from '../../../adapters/url-acquisition-node/src/index.js';
import { AskCommandCoordinator } from '../../../modules/frontend-ask-write/src/index.js';
import { AskAnswerExecutionService } from '../../../modules/frontend-ask-execution/src/index.js';
import { AskProviderPolicyResolver } from '../../../modules/frontend-ask-provider-policy/src/index.js';
import { parseProviderDeploymentCeiling } from '../../../modules/provider-privacy-policy/src/index.js';
import { ProviderExternalTransferApprovalService } from '../../../modules/provider-privacy-policy/src/index.js';
import {
  AISettingsBackendService,
  StaticAIProviderConnectivityRegistry,
} from '../../../modules/ai-settings-backend/src/index.js';
import {
  EnvironmentCredentialMasterKeyAuthority,
  CredentialVaultService,
} from '../../../modules/credential-vault/src/index.js';
import {
  ProjectAIConfigurationService,
  initialProviderRegistry,
} from '../../../modules/ai-configuration/src/index.js';
import {
  DiscoveryAIExecutionResolver,
  EffectiveAIConfigurationResolver,
  UnavailableAIProviderAdapter,
} from '../../../adapters/ai-runtime-resolution/src/index.js';
import { AIProviderRouter } from '../../../adapters/ai-provider-router/src/index.js';
import { SemanticEmbeddingAuthorityResolver } from '../../../adapters/semantic-embedding-resolution/src/index.js';
import {
  SemanticEmbeddingProfileService,
  initialSemanticEmbeddingRegistry,
} from '../../../modules/semantic-embedding/src/index.js';
import { SemanticEmbeddingRouter } from '../../../adapters/semantic-embedding-resolution/src/router.js';
import {
  SemanticGenerationBuilder,
  SemanticProjectionRefreshService,
} from '../../../modules/semantic-generation/src/index.js';
import {
  DeterministicSemanticQueryClassificationPolicy,
  SemanticRetriever,
} from '../../../modules/hybrid-retrieval/src/index.js';
import { FrontendProductReadCoordinator } from '../../../modules/frontend-product-read/src/index.js';
import { SecureUrlAcquisitionCoordinator } from '../../../modules/url-acquisition/src/index.js';
import { configureSourcesWriteRuntime } from './product-api/sources-write-runtime.js';
import { assertRuntimeSecurityConfiguration } from './runtime-security.js';
import { createApplication } from './server.js';
import { installSignalShutdown } from './shutdown.js';

export type StartShotgunApplicationOptions = {
  /** Override HOST (defaults to the `HOST` env or `127.0.0.1`). */
  readonly host?: string;
  /** Override PORT (defaults to the `PORT` env or `3000`). */
  readonly port?: number;
  /** LPA-WP4 (D03/D04): absolute path to the built SPA to serve same-origin. */
  readonly spaDirectory?: string;
  /** LPA-WP5 (D12 recovery harness): target a different database (defaults to `DATABASE_URL`). */
  readonly databaseUrl?: string;
  /** LPA-WP5 (D12 recovery harness): target asset root (defaults to `ASSET_STORAGE_ROOT`). */
  readonly assetRoot?: string;
  /** LPA-WP5 (D12 recovery harness): disable the periodic recovery worker. */
  readonly recoveryIntervalMs?: number | false;
  /** LPA-WP5 (D12 recovery harness): do not install SIGINT/SIGTERM handlers. */
  readonly noSignals?: boolean;
  /** LPA-WP5 (D12 recovery harness): do NOT start the Ask answer background
   *  worker. Recovery verification must never claim/recover/execute Product
   *  work or call an AI provider — it only runs the existing STARTUP Canonical
   *  Projection Recovery. Defaults to `true` whenever a `databaseUrl` override
   *  is used (recovery harness); the normal launch keeps the Ask worker. */
  readonly disableAskWorker?: boolean;
  /** LPA-WP5 (D12 recovery harness / R3-1): when `false`, the startup AI
   *  Durable Materialization Recovery is NOT run — the recovery harness runs
   *  ONLY the Canonical Projection Recovery. Defaults to `true` (normal
   *  Product startup behavior unchanged). */
  readonly aiDurableMaterializationRecoveryEnabled?: boolean;
  /** R5 verification-only observation; it cannot affect semantic results. */
  readonly semanticNearestNeighborObserver?: () => void;
};

export type RecoveryApplicationOptions = {
  /** The restored target database to verify recovery against. */
  readonly databaseUrl: string;
  /** The restored target asset root (may be empty for the harness). */
  readonly assetRoot: string;
};

export type ShotgunApplicationHandle = {
  readonly server: FastifyInstance;
  readonly host: string;
  readonly port: number;
  readonly url: string;
  /** LPA-WP5 (D12): the canonical projection recovery state observed at startup. */
  readonly recoveryState: Awaited<
    ReturnType<typeof createApplication>
  >['state']['canonicalProjectionRecovery'];
  /** LPA-WP5 (D12 recovery harness): whether the Ask answer background worker
   *  was started. Recovery verification must observe `false`. */
  readonly askWorkerStarted: boolean;
  /** LPA-WP5 (D12 recovery harness): bounded owner-safe read of the restored
   *  Canonical project ids — a distinct fact (not an alias of the recovery
   *  report) used for `canonicalReadable`/`productReadable`. */
  readonly readCanonicalProjectIds: () => Promise<readonly string[]>;
  /** Start listening (idempotent). */
  listen(): Promise<void>;
  /** Idempotent graceful shutdown: stop accepting work, server.close(),
   *  Fastify onClose, closeResources (sources runtime, ask worker, pool). */
  close(): Promise<void>;
};

/**
 * LPA-WP4 (D08): the canonical production composition as a bounded runtime
 * boundary. Both the Backend entrypoint (`main.ts`) and the owner launcher
 * (`scripts/launch-local.ts`) reuse the SAME composition — Product Domain
 * logic is never duplicated into a launcher.
 *
 * LPA-WP4 (D09): SIGINT/SIGTERM are handled here (idempotent shutdown) so any
 * entrypoint that builds the application gets safe, duplicate-free cleanup.
 */
export const startShotgunApplication = async (
  options: StartShotgunApplicationOptions = {},
): Promise<ShotgunApplicationHandle> => {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for persistent Stage 2 runtime.');
  }

  const recoveryHarness = options.databaseUrl !== undefined;
  const stagingSecret = recoveryHarness
    ? (process.env.SOURCES_STAGING_SECRET ?? 'x'.repeat(40))
    : process.env.SOURCES_STAGING_SECRET;
  if (!stagingSecret || stagingSecret.trim().length < 32) {
    throw new Error('SOURCES_STAGING_SECRET with at least 32 characters is required.');
  }

  const pool = createPostgresPool(databaseUrl);
  // Declared outside the try so the construction-failure catch can release
  // resources that were already created before an error (R3-4 invariant).
  let stopAskAnswerWorker = async (): Promise<void> => {};
  let stopDiscoveryExecutionWorker = async (): Promise<void> => {};
  let removeSourcesWriteRuntime = (): void => {};
  try {
    const port = options.port ?? Number.parseInt(process.env.PORT ?? '3000', 10);
    const host = options.host ?? process.env.HOST ?? '127.0.0.1';
    const production = process.env.NODE_ENV === 'production';
    assertRuntimeSecurityConfiguration({
      host,
      production,
      allowExternalBind: process.env.ALLOW_EXTERNAL_BIND === 'true',
      developmentAuthEnabled: process.env.SHOTGUN_DEVELOPMENT_AUTH === 'true',
    });
    const storageRoot = options.assetRoot
      ? path.resolve(options.assetRoot)
      : path.resolve(process.env.ASSET_STORAGE_ROOT ?? '.data/assets');
    const assetStorage = new LocalAssetStorage(storageRoot);
    const originalAssetRepository = new PostgresOriginalAssetRepository(pool);
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
    // R3-3: the recovery harness does NOT configure the process-global
    // Sources write runtime — recovery verification never serves Sources
    // write requests, so no global registration is created (nothing to leak
    // on construction failure). The normal Product assembly keeps it.
    removeSourcesWriteRuntime = recoveryHarness
      ? () => {}
      : configureSourcesWriteRuntime({
          commandGateway,
          staging,
          productService: sourcesProductService,
        });
    const canonicalKnowledgeRepository = new PostgresCanonicalKnowledgeRepository(pool);
    const semanticCorpusSourceSnapshotReader = new PostgresSemanticCorpusSourceSnapshotReader(pool);
    const semanticIndexRepository = new PostgresSemanticIndexRepository(pool, {
      onNearestNeighbors: options.semanticNearestNeighborObserver,
    });
    const semanticActiveGenerationReader = new PostgresSemanticActiveGenerationReader(
      semanticIndexRepository,
    );
    const askConversationRepository = new PostgresAskConversationRepository(pool);
    const askWorkspaceProjection = new PostgresAskWorkspaceProjection(pool);
    const askSourceSelectionValidator = new PostgresAskSourceSelectionValidator(pool);
    const deploymentCeiling = parseProviderDeploymentCeiling({
      providerAllowlist: process.env.AI_PRIVATE_EGRESS_ALLOWED_PROVIDERS,
      legacyGeminiAllowed: process.env.GEMINI_ALLOW_PRIVATE === 'true',
    });
    const deploymentAllowsPrivateExternalTransfer = deploymentCeiling.allows('google-gemini');
    const settingsRepository = new PostgresSettingsRepository(
      pool,
      deploymentAllowsPrivateExternalTransfer,
    );
    const aiProviderRegistry = initialProviderRegistry();
    const credentialVault = new CredentialVaultService(
      new PostgresCredentialVaultRepository(pool),
      new EnvironmentCredentialMasterKeyAuthority(),
    );
    const projectAIConfiguration = new ProjectAIConfigurationService(
      aiProviderRegistry,
      new PostgresProjectAIConfigurationRepository(pool),
      credentialVault,
    );
    const connectivityRegistry = new StaticAIProviderConnectivityRegistry([
      new OpenAIConnectivityAdapter({ baseUrl: process.env.OPENAI_BASE_URL }),
      new DeepSeekConnectivityAdapter({ baseUrl: process.env.DEEPSEEK_BASE_URL }),
      new GeminiConnectivityAdapter(),
    ]);
    const providerApprovalService = new ProviderExternalTransferApprovalService(
      new PostgresProviderExternalTransferApprovalRepository(pool),
      aiProviderRegistry,
    );
    const legacyPrivacy = {
      getLegacyExternalTransferAllowed: async (projectId: string) => {
        const privacy = await settingsRepository.getPrivacyRetention(projectId);
        return privacy.availability === 'AVAILABLE' && privacy.data.externalTransferAllowed;
      },
    };
    const semanticEmbeddingRegistry = initialSemanticEmbeddingRegistry();
    const semanticProfileService = new SemanticEmbeddingProfileService(
      aiProviderRegistry,
      semanticEmbeddingRegistry,
      new PostgresSemanticEmbeddingProfileRepository(pool),
      credentialVault,
    );
    const semanticAuthorityResolver = new SemanticEmbeddingAuthorityResolver(
      aiProviderRegistry,
      semanticEmbeddingRegistry,
      semanticProfileService,
      credentialVault,
      {
        deploymentCeiling,
        approvalAuthority: providerApprovalService,
        legacyExternalTransferAllowed: legacyPrivacy.getLegacyExternalTransferAllowed,
      },
    );
    const semanticEmbeddingRouter = new SemanticEmbeddingRouter(
      aiProviderRegistry,
      semanticEmbeddingRegistry,
      credentialVault,
      providerApprovalService,
      deploymentCeiling,
      [new OpenAIEmbeddingConnectivityAdapter({ baseUrl: process.env.OPENAI_BASE_URL })],
      { legacyExternalTransferAllowed: legacyPrivacy.getLegacyExternalTransferAllowed },
    );
    const semanticGenerationBuilder = new SemanticGenerationBuilder(
      semanticIndexRepository,
      semanticCorpusSourceSnapshotReader,
      semanticAuthorityResolver,
      semanticEmbeddingRouter,
      semanticProfileService,
    );
    const semanticRetriever = new SemanticRetriever(
      semanticIndexRepository,
      semanticAuthorityResolver,
      semanticEmbeddingRouter,
      semanticActiveGenerationReader,
      {
        sourceWatermarkReader: semanticCorpusSourceSnapshotReader,
        queryClassifier: new DeterministicSemanticQueryClassificationPolicy(),
      },
    );
    const semanticProjectionRefresh = new SemanticProjectionRefreshService(
      semanticProfileService,
      semanticGenerationBuilder,
    );
    const aiSettingsBackend = new AISettingsBackendService(
      aiProviderRegistry,
      projectAIConfiguration,
      credentialVault,
      connectivityRegistry,
      deploymentCeiling,
      legacyPrivacy,
      providerApprovalService,
      () => new Date().toISOString(),
      {
        isGeminiCredentialConfigured: () => Boolean(process.env.GEMINI_API_KEY?.trim()),
      },
    );
    // The legacy Gemini adapter remains available only for the older durable
    // materialization path. Ask itself uses the A8 request-time router below.
    const aiProvider = recoveryHarness
      ? new FakeAIProviderAdapter()
      : process.env.GEMINI_API_KEY?.trim()
        ? new GeminiAIProviderAdapter({
            apiKey: process.env.GEMINI_API_KEY,
            model: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash',
          })
        : new UnavailableAIProviderAdapter();
    const askAnswerProvider = new StructuredAskAnswerProviderAdapter(
      new UnavailableAIProviderAdapter(),
      {
        allowPrivate: true,
        allowRestricted: false,
        dataPolicyVersion: 'a8-fallback-provider-policy-v1',
      },
    );
    const askProviderPolicy = new AskProviderPolicyResolver(
      new PostgresAskProviderPolicyAuthorityReader(pool),
      {
        providerId: 'google-gemini',
        deploymentPrivateTransferAllowed: deploymentAllowsPrivateExternalTransfer,
        deploymentPrivateTransferAllowedForProvider: (providerId) =>
          deploymentCeiling.allows(providerId),
        providerIdResolver: async (projectId) =>
          (await projectAIConfiguration.getCurrent(projectId))?.activeProviderId,
        providerModelResolver: async (projectId, providerId) => {
          const current = await projectAIConfiguration.getCurrent(projectId);
          return current?.activeProviderId === providerId ? current.activeModelId : undefined;
        },
        providerDescriptor: (providerId, modelId) => {
          const provider = aiProviderRegistry.getProvider(providerId);
          const model = aiProviderRegistry.getModel(
            providerId,
            modelId ?? provider?.models[0]?.modelId ?? '',
          );
          return provider && model
            ? {
                policyIdentity: `${provider.providerPolicyId}:${provider.providerPolicyRevision}`,
                displayName: provider.displayName,
                model: model.modelId,
              }
            : undefined;
        },
        providerPolicyIdentity: askAnswerProvider.identity.dataPolicyVersion,
        providerDisplayName: 'Gemini',
        providerModel: aiProvider.identity.model,
      },
    );
    const executionIdentityResolver = new EffectiveAIConfigurationResolver(
      aiProviderRegistry,
      projectAIConfiguration,
      credentialVault,
      {
        policy: askProviderPolicy,
        legacyAuthority: {
          readLegacyExternalTransferAllowed: legacyPrivacy.getLegacyExternalTransferAllowed,
          readGeminiApproval: (projectId) =>
            providerApprovalService.getCurrent(projectId, 'google-gemini'),
        },
        legacyCredential: () => process.env.GEMINI_API_KEY,
        legacyModelId: aiProviderRegistry.getProvider('google-gemini')?.models[0]?.modelId,
      },
    );
    const providerRouter = new AIProviderRouter(
      aiProviderRegistry,
      connectivityRegistry,
      credentialVault,
      { legacyCredential: () => process.env.GEMINI_API_KEY },
    );
    const askAnswerExecution = new AskAnswerExecutionService(
      new PostgresAskAnswerExecutionRepository(
        pool,
        askWorkspaceProjection,
        new OriginalAssetAskSourceVersionContextReader(originalAssetRepository, assetStorage),
      ),
      askAnswerProvider,
      {
        maxConcurrency: Number.parseInt(process.env.ASK_WORKER_MAX_CONCURRENCY ?? '4', 10),
        providerPolicy: askProviderPolicy,
        executionIdentityResolver,
        providerRouter,
      },
    );
    const askCommandCoordinator = new AskCommandCoordinator(
      commandGateway,
      askConversationRepository,
      askWorkspaceProjection,
      askSourceSelectionValidator,
      askAnswerExecution,
      askProviderPolicy,
    );
    const disableAskWorker = options.disableAskWorker ?? recoveryHarness;

    const compiledTruthRepository = new PostgresCompiledTruthRepository(pool);
    const knowledgeModelRepository = new PostgresKnowledgeModelRepository(pool);
    const discoveryRuntimeRepository = new PostgresDiscoveryRuntimeRepository(pool);
    const discoveryFindingRepository = new PostgresDiscoveryFindingRepository(pool);
    const projectAdminRepository = new PostgresProjectAdministrationRepository(pool);
    const authRepository = new PostgresAuthRepository(pool);
    const discoveryModelProfileService = new DiscoveryModelProfileService(
      aiProviderRegistry,
      projectAIConfiguration,
      credentialVault,
      new PostgresDiscoveryModelProfileRepository(pool),
    );
    const discoveryExecutionWorker = recoveryHarness
      ? undefined
      : new PersistentDiscoveryWorker(
          discoveryRuntimeRepository,
          createProductDiscoveryExecution({
            compiledTruthRepository,
            findingRepository: discoveryFindingRepository,
            runtimeRepository: discoveryRuntimeRepository,
            evidenceRepository,
            semanticRetriever,
            createGenerationService: (budget, executionContext) =>
              createDiscoveryAIGenerationService({
                profiles: discoveryModelProfileService,
                executionResolver: new DiscoveryAIExecutionResolver(executionIdentityResolver),
                providerRouter: {
                  resolve: async (route) => providerRouter.resolveDiscovery(route),
                },
                budgetController: new DiscoveryBudgetControllerV1(
                  budget,
                  {
                    revision: 'discovery-token-estimator:v1',
                    estimateUpperBound: ({ request }) =>
                      Math.max(
                        1,
                        Math.ceil((request.systemInstruction.length + request.prompt.length) / 4),
                      ),
                  },
                  {
                    revision: 'discovery-cost-estimator:v1',
                    estimate: ({ inputTokenUpperBound, maxOutputTokens }) =>
                      inputTokenUpperBound + maxOutputTokens,
                  },
                  {
                    reserve: async (reservation) => {
                      if (!discoveryRuntimeRepository.reserveProviderCall) return 'NOT_FOUND';
                      return discoveryRuntimeRepository.reserveProviderCall({
                        ...executionContext.claim,
                        reservation: {
                          schemaVersion: '1.0.0',
                          projectId: executionContext.claim.projectId,
                          jobId: executionContext.claim.jobId,
                          runId: executionContext.claim.runId,
                          attemptId: executionContext.claim.attemptId,
                          reservationId: reservation.reservationId,
                          providerId: reservation.providerId,
                          modelId: reservation.modelId,
                          inputTokenUpperBound: reservation.inputTokenUpperBound,
                          maxOutputTokens: reservation.maxOutputTokens,
                          estimatedCostMicros: reservation.estimatedCostMicros,
                          state: 'RESERVED',
                          updatedAt: new Date().toISOString(),
                        },
                      });
                    },
                    finalize: async (reservation) => {
                      if (!discoveryRuntimeRepository.finalizeProviderCall) return 'NOT_FOUND';
                      return discoveryRuntimeRepository.finalizeProviderCall({
                        ...executionContext.claim,
                        reservationId: reservation.reservationId,
                        state: reservation.state,
                        actualInputTokens: reservation.actualInputTokens,
                        actualOutputTokens: reservation.actualOutputTokens,
                        actualCostMicros: reservation.actualCostMicros,
                        updatedAt: new Date().toISOString(),
                      });
                    },
                  },
                ),
              }),
            resolveSecurity: async ({ projectId }) => {
              const project = await projectAdminRepository.getProjectDetails(projectId);
              const accountId = process.env.SHOTGUN_BOOTSTRAP_ACCOUNT_ID?.trim();
              if (!project || project.status !== 'ACTIVE' || !accountId) return undefined;
              const membership = await authRepository.findOwnerMembership(accountId, projectId);
              return membership
                ? {
                    projectId,
                    accessScope: membership.scopes,
                    sensitivity: membership.sensitivityClearance,
                  }
                : undefined;
            },
            findAuthoritativeEquivalent: async ({ projectId, candidate }) => {
              const projection = await compiledTruthRepository.findProjection(projectId);
              if (!projection) return false;
              const related = candidate.relatedResourceRefs.filter(
                (resource) => resource.projectId === projectId,
              );
              if (
                candidate.findingType === 'KNOWLEDGE_GAP' &&
                related.length > 0 &&
                related.every((resource) => {
                  const item = projection.items.find((entry) => entry.id === resource.resourceId);
                  return item?.source === 'APPROVED_KNOWLEDGE' && item.state !== 'CONFLICT';
                })
              ) {
                return true;
              }
              if (candidate.findingType !== 'RELATION_HYPOTHESIS') return false;
              const payload = candidate.payload;
              return projection.graph.edges.some((edge) => {
                const forward =
                  edge.from === payload.sourceEndpoint.resourceId &&
                  edge.to === payload.targetEndpoint.resourceId;
                const reverse =
                  edge.from === payload.targetEndpoint.resourceId &&
                  edge.to === payload.sourceEndpoint.resourceId;
                return (
                  edge.source === 'APPROVED_TYPED_EDGE' &&
                  edge.relationType === payload.proposedRelationType &&
                  ((payload.direction === 'UNDIRECTED' &&
                    edge.direction === 'UNDIRECTED' &&
                    (forward || reverse)) ||
                    (payload.direction === 'DIRECTED' && edge.direction === 'DIRECTED' && forward))
                );
              });
            },
            observeReconciliation: async ({ finding, projection }) => {
              const related = finding.relatedResourceRefs.map((resource) =>
                projection.items.find((item) => item.id === resource.resourceId),
              );
              if (
                ['KNOWLEDGE_GAP', 'EVIDENCE_GAP'].includes(finding.findingType) &&
                related.length > 0 &&
                finding.findingType === 'KNOWLEDGE_GAP' &&
                related.every((item) => item?.source === 'APPROVED_KNOWLEDGE')
              ) {
                return 'CANONICAL_EQUIVALENT_ACCEPTED';
              }
              if (related.some((item) => item !== undefined && item.state === 'CONFLICT')) {
                return 'RELEVANT_INPUT_CHANGED';
              }
              // A missing projection item is not proof of source supersession;
              // Source/SourceVersion authority must make that observation.
              return 'UNCHANGED';
            },
          }),
          {
            workerId: `shotgun-discovery-${process.pid}-${randomUUID()}`,
            pollIntervalMs: Number.parseInt(process.env.DISCOVERY_WORKER_INTERVAL_MS ?? '1000', 10),
            leaseDurationMs: Number.parseInt(process.env.DISCOVERY_WORKER_LEASE_MS ?? '30000', 10),
            maxAttempts: Number.parseInt(process.env.DISCOVERY_WORKER_MAX_ATTEMPTS ?? '3', 10),
          },
        );
    const discoveryReentryWorker = recoveryHarness
      ? undefined
      : new PersistentDiscoveryReentryWorker(
          new DiscoveryReentryConsumer(
            new PostgresDiscoveryReentryRepository(pool),
            new PostgresDiscoveryApprovedResourceRevisionResolver(pool, {
              canonicalKnowledgeRepository,
              knowledgeModelRepository,
              compiledTruthRepository,
            }),
          ),
          {
            pollIntervalMs: Number.parseInt(
              process.env.DISCOVERY_REENTRY_WORKER_INTERVAL_MS ?? '1000',
              10,
            ),
            batchLimit: Number.parseInt(
              process.env.DISCOVERY_REENTRY_WORKER_BATCH_LIMIT ?? '25',
              10,
            ),
          },
        );
    if (discoveryExecutionWorker !== undefined) {
      stopDiscoveryExecutionWorker = () => discoveryExecutionWorker.stop();
    }

    const application = await createApplication({
      projectAdminRepository,
      projectBootstrapUnitOfWork: new PostgresProjectBootstrapUnitOfWork(pool),
      projectTombstoneStore: new PostgresProjectTombstoneStore(pool),
      settingsRepository,
      aiSettingsBackend: recoveryHarness ? undefined : aiSettingsBackend,
      providerExternalTransferApprovals: recoveryHarness ? undefined : providerApprovalService,
      frontendCommandGateway: commandGateway,
      frontendKnowledgeDraftRepository: new PostgresFrontendKnowledgeDraftRepository(pool),
      frontendKnowledgeDraftTargetResolver: new PostgresFrontendKnowledgeDraftTargetResolver(pool),
      frontendReviewDraftSourceReader: createPostgresReviewDraftSourceReader(pool),
      askCommandCoordinator,
      frontendProductReadCoordinatorFactory: (
        connector,
        actionCenterProjection,
        frontendSourcesReadCoordinator,
      ) =>
        new FrontendProductReadCoordinator(
          new InMemoryGlobalShellProjection(),
          actionCenterProjection,
          new InMemoryBackgroundSummaryProjection(),
          new InMemoryNotificationSummaryProjection(),
          new PostgresSourceLibraryGlobalSearch(frontendSourcesReadCoordinator),
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
      originalAssetRepository,
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
      knowledgeModelRepository,
      compiledTruthRepository,
      semanticCorpusSourceSnapshotReader,
      discoveryRuntimeRepository,
      discoveryScheduleRepository: new PostgresDiscoveryScheduleRepository(pool),
      discoverySchedulerIntervalMs: recoveryHarness ? false : 30_000,
      ...(discoveryExecutionWorker === undefined ? {} : { discoveryExecutionWorker }),
      ...(discoveryReentryWorker === undefined ? {} : { discoveryReentryWorker }),
      discoverySemanticIndexRepository: semanticIndexRepository,
      semanticRetriever,
      semanticActiveGenerationReader,
      semanticProjectionRefresh,
      actionCandidateRepository: new PostgresActionCandidateRepository(pool),
      actionExecutionRepository: new PostgresActionExecutionRepository(pool),
      authRepository,
      production,
      frontendReviewStore: new PostgresFrontendReviewRepository(pool),
      activitySourcesRead: new PostgresSourcesActivityRead(pool, sourcesProductService),
      activityAskRead: new PostgresAskActivityRead(pool),
      activityDiscoveryRead: discoveryRuntimeRepository,
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
      aiProvider: aiProvider,
      askAnswerExecution,
      aiProviderPolicy: {
        allowPrivate: process.env.GEMINI_ALLOW_PRIVATE === 'true',
        allowRestricted: false,
        maxAttempts: 2,
      },
      // LPA-WP4 (D03/D04): serve the built SPA from the same origin.
      ...(options.spaDirectory === undefined ? {} : { spaDirectory: options.spaDirectory }),
      // LPA-WP5 (D12 recovery harness): optional recovery worker override.
      ...(options.recoveryIntervalMs === undefined
        ? {}
        : { canonicalProjectionRecoveryIntervalMs: options.recoveryIntervalMs }),
      // R3-1: recovery harness runs ONLY the Canonical Projection Recovery —
      // the AI Durable Materialization Recovery is disabled for recovery-only
      // composition. The normal launch keeps it enabled (default true).
      ...(options.aiDurableMaterializationRecoveryEnabled === undefined
        ? {}
        : {
            aiDurableMaterializationRecoveryEnabled:
              options.aiDurableMaterializationRecoveryEnabled,
          }),
      closeResources: async () => {
        removeSourcesWriteRuntime();
        await stopAskAnswerWorker();
        await pool.end();
      },
    });
    const { server } = application;

    let askWorkerStarted = false;
    if (!disableAskWorker) {
      stopAskAnswerWorker = await askAnswerExecution.startWorker(
        Number.parseInt(process.env.ASK_WORKER_INTERVAL_MS ?? '1000', 10),
      );
      askWorkerStarted = true;
    }

    let closed = false;
    let listening = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await server.close();
    };
    const listen = async (): Promise<void> => {
      if (listening) return;
      listening = true;
      await server.listen({ host, port });
    };
    const handle: ShotgunApplicationHandle = {
      server,
      host,
      port,
      url: `http://${host}:${port}`,
      recoveryState: application.state.canonicalProjectionRecovery,
      askWorkerStarted,
      readCanonicalProjectIds: () => application.repositories.canonical.listProjectIds(),
      listen,
      close,
    };
    // LPA-WP4 (D09): idempotent SIGINT/SIGTERM shutdown (duplicate signals or a
    // close path overlapping a signal can never double-close resources).
    if (!options.noSignals) {
      installSignalShutdown({
        close,
        exit: (code) => process.exit(code),
      });
    }
    return handle;
  } catch (error) {
    // R3-4: if application construction throws, release everything already
    // created (process-global Sources runtime, Ask worker if started, pool)
    // and preserve the original error so no resource leaks / stale global
    // registration survives.
    try {
      removeSourcesWriteRuntime();
    } catch {
      // ignore cleanup failure — the original error is preserved below.
    }
    try {
      await stopDiscoveryExecutionWorker();
    } catch {
      // ignore cleanup failure — the original error is preserved below.
    }
    try {
      await stopAskAnswerWorker();
    } catch {
      // ignore cleanup failure — the original error is preserved below.
    }
    try {
      await pool.end();
    } catch {
      // ignore cleanup failure — the original error is preserved below.
    }
    throw error;
  }
};

/**
 * LPA-WP5 (D12): bounded recovery harness — builds the SAME canonical
 * composition against a restored target database and runs the existing
 * STARTUP Canonical Projection Recovery exactly once (periodic worker off, no
 * signal handlers). The caller must `close()` to release the pool/resources.
 * No new recovery algorithm is introduced — the existing Stage 12.1 path is
 * reused (ADR-097).
 */
export const startRecoveryApplication = async (
  options: RecoveryApplicationOptions,
): Promise<ShotgunApplicationHandle> =>
  startShotgunApplication({
    databaseUrl: options.databaseUrl,
    assetRoot: options.assetRoot,
    recoveryIntervalMs: false,
    noSignals: true,
    disableAskWorker: true,
    aiDurableMaterializationRecoveryEnabled: false,
  });
