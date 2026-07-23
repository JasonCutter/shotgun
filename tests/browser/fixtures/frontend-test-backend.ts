import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApplication } from '../../../assemblies/shotgun-app/src/server.js';
import {
  hashPassword,
  InMemoryAuthRepository,
  type ProjectMembership,
} from '../../../packages/authentication/src/index.js';

export async function startFrontendTestBackend() {
  const authRepository = new InMemoryAuthRepository();
  await authRepository.bootstrapOwner({
    accountId: 'frontend-owner',
    passwordHash: await hashPassword('frontend-password'),
    projectId: 'project-a',
    scopes: ['owner'],
    sensitivityClearance: 'private',
  });
  const principal = await authRepository.authenticatePassword(
    'frontend-owner',
    'frontend-password',
  );
  if (!principal) throw new Error('Frontend browser fixture principal was not created.');

  const projectB: ProjectMembership = {
    principalId: principal.principalId,
    projectId: 'project-b',
    scopes: ['owner'],
    sensitivityClearance: 'private',
    isOwner: false,
  };
  const findMembership = authRepository.findMembership.bind(authRepository);
  const listMemberships = authRepository.listMemberships.bind(authRepository);
  authRepository.findMembership = async (principalId, projectId) =>
    principalId === projectB.principalId && projectId === projectB.projectId
      ? projectB
      : findMembership(principalId, projectId);
  authRepository.listMemberships = async (principalId) => [
    ...(await listMemberships(principalId)),
    ...(principalId === projectB.principalId ? [projectB] : []),
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
