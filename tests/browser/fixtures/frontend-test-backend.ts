import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApplication } from '../../../assemblies/shotgun-app/src/server.js';
import { configureSourcesWriteRuntime } from '../../../assemblies/shotgun-app/src/product-api/sources-write-runtime.js';
import { SealedSourcesStagingService } from '../../../adapters/frontend-sources-staging-sealed/src/index.js';
import { PostgresFrontendCommandGateway } from '../../../adapters/frontend-command-gateway-postgres/src/index.js';
import { PostgresSourcesProductService } from '../../../adapters/frontend-sources-write-postgres/src/product-service.js';
import {
  createPostgresPool,
  PostgresIntakeRepository,
  PostgresOriginalAssetRepository,
  PostgresProjectAdministrationRepository,
  PostgresProjectBootstrapUnitOfWork,
} from '../../../adapters/postgres/src/index.js';
import { InMemorySettingsRepository } from '../../../adapters/settings-project-admin-in-memory/src/index.js';
import { InMemoryAssetStorage } from '../../../adapters/stage2-in-memory/src/index.js';
import { PostgresAuthRepository } from '../../../adapters/postgres-auth/src/index.js';
import {
  DEFAULT_PROJECT_ID,
  LOCAL_OWNER_ACCOUNT_ID,
} from '../../../packages/authentication/src/index.js';

export async function startFrontendTestBackend() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the browser fixture.');
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
    projectId: 'project-b',
    name: 'Project B',
    description: 'Browser test Project',
    actorPrincipalId: principalId,
    expectedProjectRevision: 0,
  });
  await authRepository.createProjectOwnerMembership({
    principalId,
    projectId: 'project-b',
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });

  const assetStorage = new InMemoryAssetStorage();
  const commandGateway = new PostgresFrontendCommandGateway(pool);
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
    intakeRepository: new PostgresIntakeRepository(pool),
    originalAssetRepository: new PostgresOriginalAssetRepository(pool),
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
