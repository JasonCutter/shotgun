import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import { hashPassword } from '../../packages/authentication/src/index.js';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPostgresPool(databaseUrl) : undefined;

describe.runIf(pool)('Stage 12.1 P0-1 PostgreSQL authentication persistence', () => {
  beforeEach(async () => {
    await pool!.query(
      'TRUNCATE auth.audit_events, auth.api_tokens, auth.sessions, auth.project_memberships, auth.credentials, auth.principals CASCADE',
    );
  });
  afterAll(async () => {
    await pool!.end();
  });

  it('stores only credential/token hashes and revokes sessions and opaque tokens', async () => {
    const repository = new PostgresAuthRepository(pool!);
    await repository.bootstrapOwner({
      accountId: 'owner',
      passwordHash: await hashPassword('initial-password'),
      projectId: 'shotgun',
      scopes: ['owner', 'action:approve'],
      sensitivityClearance: 'private',
    });
    const principal = await repository.authenticatePassword('owner', 'initial-password');
    if (!principal) throw new Error('Expected bootstrap owner.');
    const session = await repository.createSession(
      principal.principalId,
      'shotgun',
      new Date(Date.now() + 60_000).toISOString(),
    );
    const token = await repository.issueApiToken({
      principalId: principal.principalId,
      scopes: ['action:approve'],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(await repository.findSession(session.sessionToken)).toBeDefined();
    expect(await repository.findApiToken(token.token)).toMatchObject({
      principalId: principal.principalId,
    });

    await repository.changePassword(principal.principalId, await hashPassword('changed-password'));
    expect(await repository.findSession(session.sessionToken)).toBeUndefined();
    expect(await repository.authenticatePassword('owner', 'initial-password')).toBeUndefined();
    expect(await repository.authenticatePassword('owner', 'changed-password')).toBeDefined();
    await repository.revokeApiTokens(principal.principalId);
    expect(await repository.findApiToken(token.token)).toBeUndefined();

    await repository.appendAudit({
      principalId: principal.principalId,
      projectId: 'shotgun',
      event: 'TEST_AUTH_AUDIT',
    });
    await expect(pool!.query("UPDATE auth.audit_events SET event = 'TAMPERED'")).rejects.toThrow(
      /append-only/,
    );
  });


});
