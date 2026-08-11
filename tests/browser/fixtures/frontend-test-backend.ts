import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApplication } from '../../../assemblies/shotgun-app/src/server.js';
import { configureSourcesWriteRuntime } from '../../../assemblies/shotgun-app/src/product-api/sources-write-runtime.js';
import { InMemoryFrontendCommandGateway } from '../../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { PostgresFrontendCommandGateway } from '../../../adapters/frontend-command-gateway-postgres/src/index.js';
import { InMemoryAskConversationRepository } from '../../../adapters/frontend-ask-write-in-memory/src/index.js';
import { SealedSourcesStagingService } from '../../../adapters/frontend-sources-staging-sealed/src/index.js';
import { PostgresSourcesProductService } from '../../../adapters/frontend-sources-write-postgres/src/product-service.js';
import {
  InMemoryActionCenterProjection,
  InMemoryAskWorkspaceProjection,
  InMemoryBackgroundSummaryProjection,
  InMemoryGlobalSearch,
  InMemoryGlobalShellProjection,
  InMemoryNotificationSummaryProjection,
  InMemoryRouteGuardProjection,
} from '../../../adapters/frontend-product-read-in-memory/src/index.js';
import {
  createPostgresPool,
  PostgresIntakeRepository,
  PostgresOriginalAssetRepository,
  PostgresProjectAdministrationRepository,
  PostgresProjectBootstrapUnitOfWork,
} from '../../../adapters/postgres/src/index.js';
import { PostgresAuthRepository } from '../../../adapters/postgres-auth/src/index.js';
import { InMemorySettingsRepository } from '../../../adapters/settings-project-admin-in-memory/src/index.js';
import { InMemoryAssetStorage } from '../../../adapters/stage2-in-memory/src/index.js';
import { InMemoryEvidenceRepository } from '../../../adapters/stage3-in-memory/src/index.js';
import {
  AskCommandCoordinator,
  assertAskSourceSelectionContract,
  type AskSourceSelectionValidatorPort,
} from '../../../modules/frontend-ask-write/src/index.js';
import { FrontendProductReadCoordinator } from '../../../modules/frontend-product-read/src/index.js';
import {
  DEFAULT_PROJECT_ID,
  LOCAL_OWNER_ACCOUNT_ID,
} from '../../../packages/authentication/src/index.js';
import {
  sha256Text,
  type AskAnswerRunSnapshot,
  type AskConversationView,
} from '../../../packages/contracts/src/index.js';
import { requireTestDatabaseTarget } from '../../../scripts/database-target-guard.js';
import { ASK_FIXTURE } from './ask-workspace-fixture.js';

const sha256Bytes = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export async function startFrontendTestBackend() {
  const databaseUrl = await requireTestDatabaseTarget();
  const pool = createPostgresPool(databaseUrl);
  const authRepository = new PostgresAuthRepository(pool);
  const projectAdminRepository = new PostgresProjectAdministrationRepository(pool);

  const localOwner = await authRepository.bootstrapLocalOwnerPrincipal({
    accountId: LOCAL_OWNER_ACCOUNT_ID,
  });
  const principalId = localOwner.principalId;

  await projectAdminRepository.createProject({
    commandId: 'browser-fixture-default-project',
    clientRequestId: 'browser-fixture-default-project',
    idempotencyKey: 'browser-fixture-default-project',
    projectId: DEFAULT_PROJECT_ID,
    name: 'shotgun',
    description: 'Browser test default Project',
    actorPrincipalId: principalId,
    expectedProjectRevision: 0,
  });
  await authRepository.createProjectOwnerMembership({
    principalId,
    projectId: DEFAULT_PROJECT_ID,
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });

  await projectAdminRepository.createProject({
    commandId: 'browser-fixture-project-b',
    clientRequestId: 'browser-fixture-project-b',
    idempotencyKey: 'browser-fixture-project-b',
    projectId: ASK_FIXTURE.projectBId,
    name: 'Project B',
    description: 'Browser test Project',
    actorPrincipalId: principalId,
    expectedProjectRevision: 0,
  });
  await authRepository.createProjectOwnerMembership({
    principalId,
    projectId: ASK_FIXTURE.projectBId,
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });

  const assetStorage = new InMemoryAssetStorage();
  const evidenceRepository = new InMemoryEvidenceRepository(() => ASK_FIXTURE.evidenceId);
  const sourceBytes = new TextEncoder().encode(ASK_FIXTURE.sourceText);
  const sourceContentHash = sha256Bytes(sourceBytes);
  const sourceStorageKey = await assetStorage.put(sourceContentHash, sourceBytes);
  const indexedEvidence = await evidenceRepository.index([
    {
      revisionId: 'ask-fixture-revision-1',
      projectId: ASK_FIXTURE.projectBId,
      sourceId: ASK_FIXTURE.sourceId,
      sourceVersionId: ASK_FIXTURE.sourceVersionId,
      pointer: ASK_FIXTURE.evidencePointer,
      nodeKind: 'paragraph',
      origin: 'source',
      position: {
        type: 'TextPositionSelector',
        start: 0,
        end: ASK_FIXTURE.sourceText.length,
        unit: 'unicode-code-point',
      },
      quote: {
        type: 'TextQuoteSelector',
        exact: ASK_FIXTURE.sourceText,
      },
      exactHash: sha256Text(ASK_FIXTURE.sourceText),
      accessScope: ['owner'],
      sensitivity: 'private',
      createdAt: '2026-07-31T10:00:00.000Z',
    },
  ]);
  const evidenceId = indexedEvidence.items[0]!.evidenceId;

  const answerRun: AskAnswerRunSnapshot = {
    schemaVersion: '1.0.0',
    answerRunId: ASK_FIXTURE.answerRunId,
    conversationId: ASK_FIXTURE.conversationId,
    branchId: ASK_FIXTURE.branchId,
    turnId: ASK_FIXTURE.turnId,
    projectId: ASK_FIXTURE.projectBId,
    mode: 'CANONICAL_ONLY',
    state: 'SUCCEEDED',
    question: 'What does the approved Shotgun record establish?',
    statements: [
      {
        statementId: ASK_FIXTURE.statementId,
        text: ASK_FIXTURE.sourceText,
        citations: [
          {
            citationId: ASK_FIXTURE.citationId,
            sourceId: ASK_FIXTURE.sourceId,
            sourceVersionId: ASK_FIXTURE.sourceVersionId,
            evidenceId,
          },
        ],
      },
    ],
    sourceSelections: [
      {
        sourceId: ASK_FIXTURE.sourceId,
        sourceVersionId: ASK_FIXTURE.sourceVersionId,
        evidenceIds: [evidenceId],
      },
    ],
    capabilities: ['EXPORT', 'CREATE_INTAKE_DRAFT', 'CREATE_DRAFT_CHANGE_SET', 'PROPOSE_DIRECTIVE'],
    answerRevision: 'ask-answer-revision-1',
    conversationRevision: 'ask-conversation-revision-1',
    accessRevision: '1',
    policyContextRevision: '1',
    createdAt: '2026-07-31T10:00:00.000Z',
    updatedAt: '2026-07-31T10:00:00.000Z',
    stale: false,
  };
  const conversation: AskConversationView = {
    schemaVersion: '1.0.0',
    conversationId: ASK_FIXTURE.conversationId,
    projectId: ASK_FIXTURE.projectBId,
    title: ASK_FIXTURE.conversationTitle,
    activeBranchId: ASK_FIXTURE.branchId,
    branches: [
      {
        branchId: ASK_FIXTURE.branchId,
        branchRevision: 'ask-branch-revision-1',
        label: 'Main Branch',
        turns: [
          {
            turnId: ASK_FIXTURE.turnId,
            turnRevision: 'ask-turn-revision-1',
            ordinal: 1,
            userMessage: answerRun.question,
            createdAt: answerRun.createdAt,
            answerRun,
          },
        ],
      },
    ],
    conversationRevision: answerRun.conversationRevision,
    createdAt: answerRun.createdAt,
    updatedAt: answerRun.updatedAt,
  };
  const inaccessibleAnswerRun: AskAnswerRunSnapshot = {
    ...answerRun,
    answerRunId: 'ask-answer-run-project-c',
    conversationId: ASK_FIXTURE.inaccessibleConversationId,
    branchId: 'ask-branch-project-c',
    turnId: 'ask-turn-project-c',
    projectId: ASK_FIXTURE.inaccessibleProjectId,
    statements: [],
    sourceSelections: [],
  };
  const inaccessibleConversation: AskConversationView = {
    ...conversation,
    conversationId: ASK_FIXTURE.inaccessibleConversationId,
    projectId: ASK_FIXTURE.inaccessibleProjectId,
    activeBranchId: inaccessibleAnswerRun.branchId,
    branches: [
      {
        branchId: inaccessibleAnswerRun.branchId,
        branchRevision: 'ask-branch-project-c-revision-1',
        label: 'Masked Branch',
        turns: [
          {
            turnId: inaccessibleAnswerRun.turnId,
            turnRevision: 'ask-turn-project-c-revision-1',
            ordinal: 1,
            userMessage: inaccessibleAnswerRun.question,
            createdAt: inaccessibleAnswerRun.createdAt,
            answerRun: inaccessibleAnswerRun,
          },
        ],
      },
    ],
  };

  const askProjection = new InMemoryAskWorkspaceProjection([
    'CANONICAL_ONLY',
    'SOURCE_EXPLORATION',
    'HYBRID',
  ]);
  askProjection.addConversation(conversation);
  askProjection.addConversation(inaccessibleConversation);
  const frontendProductReadCoordinator = new FrontendProductReadCoordinator(
    new InMemoryGlobalShellProjection(),
    new InMemoryActionCenterProjection(),
    new InMemoryBackgroundSummaryProjection(),
    new InMemoryNotificationSummaryProjection(),
    new InMemoryGlobalSearch(),
    new InMemoryRouteGuardProjection(),
    askProjection,
  );
  const sourcesProjectionRepository = {
    async listProjectSourceVersions(projectId: string) {
      if (projectId === DEFAULT_PROJECT_ID) {
        return [
          {
            projectId: DEFAULT_PROJECT_ID,
            sourceId: ASK_FIXTURE.selectableSourceId,
            sourceVersionId: ASK_FIXTURE.selectableSourceVersionId,
            versionNumber: 1,
            mediaType: 'text/plain',
            contentHash: sourceContentHash,
            sizeBytes: sourceBytes.byteLength,
            originalFileName: 'ask-exploration-source.txt',
            storageKey: sourceStorageKey,
            accessScope: ['owner'],
            sensitivity: 'private' as const,
            createdAt: '2026-07-31T10:00:00.000Z',
          },
        ];
      }
      if (projectId !== ASK_FIXTURE.projectBId) return [];
      return [
        {
          projectId: ASK_FIXTURE.projectBId,
          sourceId: ASK_FIXTURE.sourceId,
          sourceVersionId: ASK_FIXTURE.sourceVersionId,
          versionNumber: 1,
          mediaType: 'text/plain',
          contentHash: sourceContentHash,
          sizeBytes: sourceBytes.byteLength,
          originalFileName: 'ask-citation-source.txt',
          storageKey: sourceStorageKey,
          accessScope: ['owner'],
          sensitivity: 'private' as const,
          createdAt: '2026-07-31T10:00:00.000Z',
        },
      ];
    },
  };

  const commandGateway = new PostgresFrontendCommandGateway(pool);
  const askGateway = new InMemoryFrontendCommandGateway();
  const askRepository = new InMemoryAskConversationRepository();
  askRepository.onSave = (aggregate) => askProjection.addConversation(aggregate.conversation);
  const askSourceSelectionValidator: AskSourceSelectionValidatorPort = {
    async validate(input) {
      assertAskSourceSelectionContract(input);
      for (const selection of input.sourceSelections) {
        if (
          input.projectId !== DEFAULT_PROJECT_ID ||
          selection.sourceId !== ASK_FIXTURE.selectableSourceId ||
          selection.sourceVersionId !== ASK_FIXTURE.selectableSourceVersionId ||
          selection.evidenceIds.length !== 0
        ) {
          throw new Error('The browser fixture received a SourceSelection outside its authority.');
        }
      }
    },
  };
  const askCommandCoordinator = new AskCommandCoordinator(
    askGateway,
    askRepository,
    askProjection,
    askSourceSelectionValidator,
  );
  const staging = new SealedSourcesStagingService(
    assetStorage,
    'browser-fixture-sources-staging-secret-32-characters',
  );
  const removeWriteRuntime = configureSourcesWriteRuntime({
    commandGateway,
    staging,
    productService: new PostgresSourcesProductService(pool, staging),
  });
  const application = await createApplication({
    authRepository,
    projectAdminRepository,
    projectBootstrapUnitOfWork: new PostgresProjectBootstrapUnitOfWork(pool),
    settingsRepository: new InMemorySettingsRepository(),
    frontendCommandGateway: commandGateway,
    frontendProductReadCoordinator,
    askCommandCoordinator,
    sourcesProjectionRepository,
    intakeRepository: new PostgresIntakeRepository(pool),
    originalAssetRepository: new PostgresOriginalAssetRepository(pool),
    evidenceRepository,
    assetStorage,
    canonicalProjectionRecoveryIntervalMs: false,
    closeResources: async () => {
      removeWriteRuntime();
      await pool.end();
    },
  });
  await application.server.listen({ host: '127.0.0.1', port: 3001 });

  let closing = false;
  return {
    close: async () => {
      if (closing) return;
      closing = true;
      await application.server.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void (async () => {
    const backend = await startFrontendTestBackend();
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
