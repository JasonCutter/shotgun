import { createApplication } from '../../../assemblies/shotgun-app/src/server.js';
import { InMemoryProjectAdministrationRepository } from '../../../adapters/settings-project-admin-in-memory/src/index.js';
import {
  DEFAULT_PROJECT_ID,
  InMemoryAuthRepository,
  LOCAL_OWNER_ACCOUNT_ID,
} from '../../../packages/authentication/src/index.js';
import {
  createPerformanceReadCoordinator,
  type PerformanceDatasetManifest,
} from '../frontend-section3-performance-seed.js';

export const startFrontendPerformanceBackend = async (
  manifest: PerformanceDatasetManifest,
  options: {
    readonly port: number;
    readonly zeroProject?: boolean;
  },
) => {
  const authRepository = new InMemoryAuthRepository();
  const projectAdminRepository = new InMemoryProjectAdministrationRepository(
    async ({ principalId, projectId }) => {
      await authRepository.createProjectOwnerMembership({
        principalId,
        projectId,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });
    },
  );

  if (!options.zeroProject) {
    await authRepository.bootstrapOwner({
      accountId: LOCAL_OWNER_ACCOUNT_ID,
      projectId: DEFAULT_PROJECT_ID,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });
    const ownerMembership = await authRepository.findOwnerMembership(
      LOCAL_OWNER_ACCOUNT_ID,
      DEFAULT_PROJECT_ID,
    );
    if (!ownerMembership) throw new Error('Performance Local Owner was not created.');
    for (let index = 2; index <= manifest.exposedProjectPage; index += 1) {
      const suffix = String(index).padStart(4, '0');
      await projectAdminRepository.createProject({
        commandId: `perf-project-command-${suffix}`,
        clientRequestId: `perf-project-request-${suffix}`,
        idempotencyKey: `perf-project-idempotency-${suffix}`,
        projectId: `perf-project-${suffix}`,
        name: `Performance Project ${suffix}`,
        description: 'Deterministic performance seed Project.',
        actorPrincipalId: ownerMembership.principalId,
        expectedProjectRevision: 0,
      });
    }
  }

  const application = await createApplication({
    authRepository,
    projectAdminRepository,
    frontendProductReadCoordinator: createPerformanceReadCoordinator(manifest),
    canonicalProjectionRecoveryIntervalMs: false,
    production: false,
  });
  await application.server.listen({ host: '127.0.0.1', port: options.port });
  return {
    close: async () => application.server.close(),
  };
};
