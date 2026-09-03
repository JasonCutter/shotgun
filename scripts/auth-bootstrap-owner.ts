import 'dotenv/config';

import { fileURLToPath } from 'node:url';

import { PostgresAuthRepository } from '../adapters/postgres-auth/src/index.js';
import { createPostgresPool } from '../adapters/postgres/src/index.js';
import { hashPassword } from '../packages/authentication/src/index.js';
import {
  decodeShotgunEnvironment,
  formatEnvironmentIssues,
  type BootstrapConfiguration,
} from '../packages/runtime-configuration/src/index.js';

export const readBootstrapConfiguration = (
  environment: NodeJS.ProcessEnv = process.env,
): BootstrapConfiguration => {
  const configuration = decodeShotgunEnvironment(environment, 'bootstrap');
  if (configuration.issues.length > 0 || configuration.bootstrap === undefined) {
    throw new Error(
      `Bootstrap environment configuration invalid: ${formatEnvironmentIssues(configuration.issues)}.`,
    );
  }
  return configuration.bootstrap;
};

export const runOwnerBootstrap = async (
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> => {
  const { databaseUrl, accountId, password, projectId } = readBootstrapConfiguration(environment);
  const pool = createPostgresPool(databaseUrl);
  try {
    await new PostgresAuthRepository(pool).bootstrapOwner({
      accountId,
      passwordHash: await hashPassword(password),
      projectId,
      scopes: [
        'owner',
        'action:candidate:stage',
        'action:approve',
        'action:execute',
        'action:verify',
        'action:read',
        'action:audit:read',
      ],
      sensitivityClearance: 'restricted',
    });
    console.log('Owner bootstrap completed.');
  } finally {
    await pool.end();
  }
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runOwnerBootstrap().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Owner bootstrap failed.');
    process.exitCode = 1;
  });
}
