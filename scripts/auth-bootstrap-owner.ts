import 'dotenv/config';

import { PostgresAuthRepository } from '../adapters/postgres-auth/src/index.js';
import { createPostgresPool } from '../adapters/postgres/src/index.js';
import { hashPassword } from '../packages/authentication/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const accountId = process.env.SHOTGUN_BOOTSTRAP_ACCOUNT_ID;
const password = process.env.SHOTGUN_BOOTSTRAP_PASSWORD;
const projectId = process.env.SHOTGUN_BOOTSTRAP_PROJECT_ID ?? 'shotgun';
if (!databaseUrl || !accountId || !password) {
  throw new Error(
    'Set DATABASE_URL, SHOTGUN_BOOTSTRAP_ACCOUNT_ID, and SHOTGUN_BOOTSTRAP_PASSWORD.',
  );
}

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
