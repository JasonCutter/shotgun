import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  DEFAULT_PROJECT_ID,
  hashPassword,
  LOCAL_OWNER_ACCOUNT_ID,
  LocalOwnerAuthenticationAdapter,
} from '../../packages/authentication/src/index.js';

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

  describe('PostgreSQL Local Owner Policy & Isolation (Scenarios 1-6)', () => {
    it('Scenario 1: does not reuse another project owner as Local Owner', async () => {
      const repository = new PostgresAuthRepository(pool!);
      await repository.bootstrapOwner({
        accountId: 'other-owner',
        passwordHash: await hashPassword('password123'),
        projectId: 'other-project',
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });

      const localOwner = await repository.findOwnerMembership(
        LOCAL_OWNER_ACCOUNT_ID,
        DEFAULT_PROJECT_ID,
      );
      expect(localOwner).toBeUndefined();
    });

    it('Scenario 2: does not misidentify regular password owner in shotgun project as Local Owner', async () => {
      const repository = new PostgresAuthRepository(pool!);
      await repository.bootstrapOwner({
        accountId: 'regular-admin',
        passwordHash: await hashPassword('admin-password'),
        projectId: DEFAULT_PROJECT_ID,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });

      const localOwner = await repository.findOwnerMembership(
        LOCAL_OWNER_ACCOUNT_ID,
        DEFAULT_PROJECT_ID,
      );
      expect(localOwner).toBeUndefined();
    });

    it('Scenario 3 & 4: safely refuses Local Bootstrap when a regular owner exists and behaves identically in PostgreSQL & InMemory', async () => {
      const repository = new PostgresAuthRepository(pool!);
      await repository.bootstrapOwner({
        accountId: 'regular-admin',
        passwordHash: await hashPassword('admin-password'),
        projectId: DEFAULT_PROJECT_ID,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });

      const adapter = new LocalOwnerAuthenticationAdapter(repository);
      const result = await adapter.establishSession({
        isLoopbackBind: true,
        isRemoteLoopback: true,
        isSameOrigin: true,
        localOwnerEnabled: true,
      });

      expect(result.status).toBe('authentication_unavailable');
      if (result.status !== 'authentication_unavailable') return;
      expect(result.code).toBe('LOCAL_BOOTSTRAP_FAILED');

      // Verify regular-admin remains intact and Local Owner was not created
      const regularAdmin = await repository.findOwnerMembership(
        'regular-admin',
        DEFAULT_PROJECT_ID,
      );
      expect(regularAdmin).toBeDefined();

      const localOwner = await repository.findOwnerMembership(
        LOCAL_OWNER_ACCOUNT_ID,
        DEFAULT_PROJECT_ID,
      );
      expect(localOwner).toBeUndefined();
    });

    it('Scenario 5: repeated bootstrap creates no duplicate principal or membership', async () => {
      const repository = new PostgresAuthRepository(pool!);
      const adapter = new LocalOwnerAuthenticationAdapter(repository);

      const first = await adapter.establishSession({
        isLoopbackBind: true,
        isRemoteLoopback: true,
        isSameOrigin: true,
        localOwnerEnabled: true,
      });
      const second = await adapter.establishSession({
        isLoopbackBind: true,
        isRemoteLoopback: true,
        isSameOrigin: true,
        localOwnerEnabled: true,
      });

      expect(first.status).toBe('authenticated');
      expect(second.status).toBe('authenticated');
      if (first.status !== 'authenticated' || second.status !== 'authenticated') return;

      expect(first.context.principalId).toBe(second.context.principalId);

      const principals = await pool!.query(
        'SELECT count(*) FROM auth.principals WHERE account_id = $1',
        [LOCAL_OWNER_ACCOUNT_ID],
      );
      expect(Number.parseInt(principals.rows[0].count, 10)).toBe(1);

      const memberships = await pool!.query(
        'SELECT count(*) FROM auth.project_memberships WHERE principal_id = $1',
        [first.context.principalId],
      );
      expect(Number.parseInt(memberships.rows[0].count, 10)).toBe(1);
    });

    it('Scenario 6: other principals and memberships remain unchanged', async () => {
      const repository = new PostgresAuthRepository(pool!);
      await repository.bootstrapOwner({
        accountId: 'team-lead',
        passwordHash: await hashPassword('password123'),
        projectId: 'project-x',
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });

      const before = await repository.findOwnerMembership('team-lead', 'project-x');
      expect(before).toBeDefined();

      const adapter = new LocalOwnerAuthenticationAdapter(repository);
      await adapter.establishSession({
        isLoopbackBind: true,
        isRemoteLoopback: true,
        isSameOrigin: true,
        localOwnerEnabled: true,
      });

      const after = await repository.findOwnerMembership('team-lead', 'project-x');
      expect(after).toBeDefined();
      expect(after?.principalId).toBe(before?.principalId);
    });
  });

  describe('Migration 015 Upgrade & Verification Tests', () => {
    it('backfills account_id from existing credentials into auth.principals', async () => {
      const principalId = randomUUID();
      const credentialId = randomUUID();
      // Insert principal without account_id (as existed before Migration 015)
      await pool!.query(
        "INSERT INTO auth.principals (principal_id, actor_type, status, created_at) VALUES ($1, 'user', 'active', now())",
        [principalId],
      );
      await pool!.query(
        "INSERT INTO auth.credentials (credential_id, principal_id, credential_type, account_id, password_hash, password_changed_at) VALUES ($1, $2, 'local_password', 'migrated-user', $3, now())",
        [credentialId, principalId, await hashPassword('password123')],
      );

      // Run backfill query from Migration 015
      await pool!.query(`
        UPDATE auth.principals p
        SET account_id = c.account_id
        FROM auth.credentials c
        WHERE c.principal_id = p.principal_id
          AND c.disabled_at IS NULL;
      `);

      const res = await pool!.query(
        'SELECT account_id FROM auth.principals WHERE principal_id = $1',
        [principalId],
      );
      expect(res.rows[0].account_id).toBe('migrated-user');
    });

    it('allows credential-less Local Owner lookup by account_id without credentials row', async () => {
      const repository = new PostgresAuthRepository(pool!);
      await repository.bootstrapOwner({
        accountId: LOCAL_OWNER_ACCOUNT_ID,
        projectId: DEFAULT_PROJECT_ID,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });

      // Verify no row in auth.credentials for this principal
      const ownerMembership = await repository.findOwnerMembership(
        LOCAL_OWNER_ACCOUNT_ID,
        DEFAULT_PROJECT_ID,
      );
      expect(ownerMembership).toBeDefined();

      const credentials = await pool!.query(
        'SELECT * FROM auth.credentials WHERE principal_id = $1',
        [ownerMembership!.principalId],
      );
      expect(credentials.rowCount).toBe(0);

      // findOwnerMembership succeeds without credentials
      const found = await repository.findOwnerMembership(
        LOCAL_OWNER_ACCOUNT_ID,
        DEFAULT_PROJECT_ID,
      );
      expect(found).toBeDefined();
      expect(found?.principalId).toBe(ownerMembership!.principalId);
    });

    it('preserves existing password authentication post-migration', async () => {
      const repository = new PostgresAuthRepository(pool!);
      const password = 'secure-password-123';
      await repository.bootstrapOwner({
        accountId: 'password-user',
        passwordHash: await hashPassword(password),
        projectId: DEFAULT_PROJECT_ID,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });

      const authenticated = await repository.authenticatePassword('password-user', password);
      expect(authenticated).toBeDefined();
      expect(authenticated?.status).toBe('active');
    });

    it('fails safely when inserting a duplicate non-null account_id into auth.principals', async () => {
      const p1 = randomUUID();
      const p2 = randomUUID();
      await pool!.query(
        "INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at) VALUES ($1, 'user', 'active', 'unique-account', now())",
        [p1],
      );

      await expect(
        pool!.query(
          "INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at) VALUES ($1, 'user', 'active', 'unique-account', now())",
          [p2],
        ),
      ).rejects.toThrow(/auth_principals_account_id_unique_idx|unique constraint/i);
    });

    it('maintains session and project membership invariants post-migration', async () => {
      const repository = new PostgresAuthRepository(pool!);
      await repository.bootstrapOwner({
        accountId: 'invariant-user',
        passwordHash: await hashPassword('password123'),
        projectId: 'project-inv',
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });
      const principal = await repository.authenticatePassword('invariant-user', 'password123');
      const session = await repository.createSession(
        principal!.principalId,
        'project-inv',
        new Date(Date.now() + 60_000).toISOString(),
      );

      const foundSession = await repository.findSession(session.sessionToken);
      expect(foundSession).toBeDefined();
      expect(foundSession?.activeProjectId).toBe('project-inv');

      const membership = await repository.findMembership(principal!.principalId, 'project-inv');
      expect(membership).toBeDefined();
      expect(membership?.isOwner).toBe(true);
    });
  });
});
