import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApplication } from '../../../assemblies/shotgun-app/src/server.js';
import {
  DEFAULT_PROJECT_ID,
  InMemoryAuthRepository,
  LOCAL_OWNER_ACCOUNT_ID,
  type ProjectMembership,
} from '../../../packages/authentication/src/index.js';

export async function startFrontendTestBackend() {
  const authRepository = new InMemoryAuthRepository();
  // Bootstrap a credential-less Local Owner in the default project (shotgun)
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
  if (!ownerMembership) throw new Error('Frontend browser fixture local owner was not created.');
  const principalId = ownerMembership.principalId;

  const projectB: ProjectMembership = {
    principalId,
    projectId: 'project-b',
    scopes: ['owner'],
    sensitivityClearance: 'private',
    isOwner: false,
  };
  const findMembership = authRepository.findMembership.bind(authRepository);
  const listMemberships = authRepository.listMemberships.bind(authRepository);
  authRepository.findMembership = async (pid, projectId) =>
    pid === projectB.principalId && projectId === projectB.projectId
      ? projectB
      : findMembership(pid, projectId);
  authRepository.listMemberships = async (pid) => [
    ...(await listMemberships(pid)),
    ...(pid === projectB.principalId ? [projectB] : []),
  ];

  const application = await createApplication({
    authRepository,
    canonicalProjectionRecoveryIntervalMs: false,
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
  const backend = await startFrontendTestBackend();
  const shutdown = () => {
    void backend.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
