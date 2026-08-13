import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PostgresAuthRepository } from '../../adapters/postgres-auth/src/index.js';
import { createPostgresPool } from '../../adapters/postgres/src/index.js';
import {
  DEFAULT_PROJECT_ID,
  hashPassword,
  hashSecuritySecret,
  InMemoryAuthRepository,
  LOCAL_OWNER_ACCOUNT_ID,
  LocalOwnerAuthenticationAdapter,
} from '../../packages/authentication/src/index.js';
import { dropSchemas, migrateUpTo } from '../../scripts/database.js';

import { requireTestDatabaseTarget } from '../../scripts/database-target-guard.js';

const databaseUrl = await requireTestDatabaseTarget();
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

    it('Scenario 3 & 4: creates an isolated zero-project Local Owner Principal without replacing a regular owner', async () => {
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

      expect(result.status).toBe('authenticated');
      if (result.status !== 'authenticated') return;
      expect(result.context).toBeUndefined();
      expect(result.session.activeProjectId).toBeNull();

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
      expect(await repository.findPrincipalByAccountId(LOCAL_OWNER_ACCOUNT_ID)).toMatchObject({
        principalId: result.principalContext.principalId,
      });
      expect(await repository.listMemberships(result.principalContext.principalId)).toEqual([]);
    });

    it('resolves an existing Local Owner UUID Project from durable membership without mutation', async () => {
      const repository = new PostgresAuthRepository(pool!);
      const projectId = 'abbde1df-e128-4076-8ed8-cf990942aad4';
      await repository.bootstrapOwner({
        accountId: LOCAL_OWNER_ACCOUNT_ID,
        projectId,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });
      const before = await repository.findOwnerMembership(LOCAL_OWNER_ACCOUNT_ID, projectId);
      if (!before) throw new Error('Fixture Local Owner membership was not created.');
      const adapter = new LocalOwnerAuthenticationAdapter(repository);

      const result = await adapter.establishSession({
        isLoopbackBind: true,
        isRemoteLoopback: true,
        isSameOrigin: true,
        localOwnerEnabled: true,
      });

      expect(result.status).toBe('authenticated');
      if (result.status !== 'authenticated') return;
      expect(result.session.activeProjectId).toBe(projectId);
      expect(result.context?.projectId).toBe(projectId);
      expect((await repository.findSession(result.session.sessionToken))?.activeProjectId).toBe(
        projectId,
      );
      expect(await repository.findOwnerMembership(LOCAL_OWNER_ACCOUNT_ID, projectId)).toEqual(
        before,
      );
      expect(await repository.listMemberships(before.principalId)).toEqual([before]);
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

      expect(first.principalContext.principalId).toBe(second.principalContext.principalId);

      const principals = await pool!.query(
        'SELECT count(*) FROM auth.principals WHERE account_id = $1',
        [LOCAL_OWNER_ACCOUNT_ID],
      );
      expect(Number.parseInt(principals.rows[0].count, 10)).toBe(1);

      const memberships = await pool!.query(
        'SELECT count(*) FROM auth.project_memberships WHERE principal_id = $1',
        [first.principalContext.principalId],
      );
      expect(Number.parseInt(memberships.rows[0].count, 10)).toBe(0);
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

    it('Scenario 7: handles active vs expired owner membership in Postgres and behaves identically to InMemoryAuthRepository', async () => {
      const dbRepository = new PostgresAuthRepository(pool!);
      const memRepository = new InMemoryAuthRepository();

      // 1. Insert an expired owner membership into Postgres & InMemory
      const expiredPrincipalId = randomUUID();
      await pool!.query(
        "INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at) VALUES ($1, 'user', 'active', 'expired-owner', now())",
        [expiredPrincipalId],
      );
      await pool!.query(
        "INSERT INTO auth.project_memberships (principal_id, project_id, scopes, sensitivity_clearance, is_owner, expires_at) VALUES ($1, $2, '{owner}', 'private', true, now() - interval '1 hour')",
        [expiredPrincipalId, DEFAULT_PROJECT_ID],
      );
      memRepository.seedExpiredOwner('expired-owner', DEFAULT_PROJECT_ID);

      // Expired owner should NOT be returned by findOwnerMembership
      expect(
        await dbRepository.findOwnerMembership('expired-owner', DEFAULT_PROJECT_ID),
      ).toBeUndefined();
      expect(
        await memRepository.findOwnerMembership('expired-owner', DEFAULT_PROJECT_ID),
      ).toBeUndefined();

      // Expired owner allows bootstrapping new active owner in both Postgres & InMemory
      await dbRepository.bootstrapOwner({
        accountId: LOCAL_OWNER_ACCOUNT_ID,
        projectId: DEFAULT_PROJECT_ID,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });
      await memRepository.bootstrapOwner({
        accountId: LOCAL_OWNER_ACCOUNT_ID,
        projectId: DEFAULT_PROJECT_ID,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      });

      const dbNewOwner = await dbRepository.findOwnerMembership(
        LOCAL_OWNER_ACCOUNT_ID,
        DEFAULT_PROJECT_ID,
      );
      expect(dbNewOwner).toBeDefined();
      expect(dbNewOwner?.isOwner).toBe(true);

      const memNewOwner = await memRepository.findOwnerMembership(
        LOCAL_OWNER_ACCOUNT_ID,
        DEFAULT_PROJECT_ID,
      );
      expect(memNewOwner).toBeDefined();
      expect(memNewOwner?.isOwner).toBe(true);

      // 2. Active owner exists -> rejects new owner creation in both Postgres & InMemory
      await expect(
        dbRepository.bootstrapOwner({
          accountId: 'another-owner',
          projectId: DEFAULT_PROJECT_ID,
          scopes: ['owner'],
          sensitivityClearance: 'private',
        }),
      ).rejects.toThrow('An active Owner already exists.');

      await expect(
        memRepository.bootstrapOwner({
          accountId: 'another-owner',
          projectId: DEFAULT_PROJECT_ID,
          scopes: ['owner'],
          sensitivityClearance: 'private',
        }),
      ).rejects.toThrow('An active Owner already exists.');
    });
  });

  describe('Real Migration 014 -> 015 Upgrade Test', () => {
    afterEach(async () => {
      await dropSchemas(databaseUrl);
      await migrateUpTo(undefined, databaseUrl);
    });

    it('upgrades clean schema from migration 014 to 015 with existing data backfill and safety checks', async () => {
      try {
        // 1. Prepare schema up to Migration 014
        await dropSchemas(databaseUrl);
        await migrateUpTo('014_stage12_1_ai_durable_materialization.sql', databaseUrl);

        // 2. Insert existing Password Principal, Credential, Membership, Session into 014 schema
        const principalId = randomUUID();
        const accountId = 'user-014';
        const passwordHash = await hashPassword('pass-014');

        // Note: In Migration 014 schema, auth.principals has NO account_id column!
        await pool!.query(
          "INSERT INTO auth.principals (principal_id, actor_type, status, created_at) VALUES ($1, 'user', 'active', now())",
          [principalId],
        );
        await pool!.query(
          "INSERT INTO auth.credentials (credential_id, principal_id, credential_type, account_id, password_hash, password_changed_at) VALUES ($1, $2, 'local_password', $3, $4, now())",
          [randomUUID(), principalId, accountId, passwordHash],
        );
        await pool!.query(
          "INSERT INTO auth.project_memberships (principal_id, project_id, scopes, sensitivity_clearance, is_owner) VALUES ($1, 'shotgun', '{owner}', 'private', true)",
          [principalId],
        );

        const sessionToken = randomUUID();
        const sessionHash = hashSecuritySecret(sessionToken);
        await pool!.query(
          "INSERT INTO auth.sessions (session_id, token_hash, csrf_hash, principal_id, active_project_id, expires_at, created_at) VALUES ($1, $2, $3, $4, 'shotgun', now() + interval '1 day', now())",
          [randomUUID(), sessionHash, hashSecuritySecret('csrf'), principalId],
        );

        // 3. Apply Migration 015 file directly
        const migration015Path = path.resolve(
          process.cwd(),
          'db/migrations/015_local_owner_principal_account_id.sql',
        );
        const migration015Sql = await readFile(migration015Path, 'utf8');
        await pool!.query(migration015Sql);

        // 4. Verification:
        // a. principals.account_id backfilled
        const backfilled = await pool!.query<{ account_id: string }>(
          'SELECT account_id FROM auth.principals WHERE principal_id = $1',
          [principalId],
        );
        expect(backfilled.rows[0]?.account_id).toBe('user-014');

        // b. Existing Password Auth intact post-migration
        const repository = new PostgresAuthRepository(pool!);
        const authenticated = await repository.authenticatePassword('user-014', 'pass-014');
        expect(authenticated).toBeDefined();
        expect(authenticated?.principalId).toBe(principalId);

        // c. Existing Membership intact post-migration
        const membership = await repository.findOwnerMembership('user-014', 'shotgun');
        expect(membership).toBeDefined();
        expect(membership?.principalId).toBe(principalId);

        // d. Existing Session intact post-migration
        const session = await repository.findSession(sessionToken);
        expect(session).toBeDefined();
        expect(session?.principalId).toBe(principalId);

        // e. Credential-less Local Owner lookup works after migration
        await pool!.query('UPDATE auth.project_memberships SET is_owner = false WHERE is_owner');
        const localOwnerPrincipalId = randomUUID();
        await pool!.query(
          "INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at) VALUES ($1, 'user', 'active', $2, now())",
          [localOwnerPrincipalId, LOCAL_OWNER_ACCOUNT_ID],
        );
        await pool!.query(
          "INSERT INTO auth.project_memberships (principal_id, project_id, scopes, sensitivity_clearance, is_owner) VALUES ($1, 'project-b', '{owner}', 'private', true)",
          [localOwnerPrincipalId],
        );
        const localOwnerMembership = await repository.findOwnerMembership(
          LOCAL_OWNER_ACCOUNT_ID,
          'project-b',
        );
        expect(localOwnerMembership).toBeDefined();
        expect(localOwnerMembership?.principalId).toBe(localOwnerPrincipalId);
      } finally {
        await dropSchemas(databaseUrl);
        await migrateUpTo(undefined, databaseUrl);
      }
    });

    it('fails Migration 015 explicitly when duplicate account_ids exist in auth.credentials before migration', async () => {
      try {
        // 1. Prepare schema up to Migration 014
        await dropSchemas(databaseUrl);
        await migrateUpTo('014_stage12_1_ai_durable_materialization.sql', databaseUrl);

        // 2. Insert two principals with credentials having the SAME account_id (duplicate)
        await pool!.query(
          'ALTER TABLE auth.credentials DROP CONSTRAINT credentials_account_id_key',
        );
        const p1 = randomUUID();
        const p2 = randomUUID();
        const hash1 = await hashPassword('pass1');
        const hash2 = await hashPassword('pass2');
        await pool!.query(
          "INSERT INTO auth.principals (principal_id, actor_type, status, created_at) VALUES ($1, 'user', 'active', now()), ($2, 'user', 'active', now())",
          [p1, p2],
        );
        await pool!.query(
          "INSERT INTO auth.credentials (credential_id, principal_id, credential_type, account_id, password_hash, password_changed_at) VALUES ($1, $2, 'local_password', 'dup-account', $5, now()), ($3, $4, 'local_password', 'dup-account', $6, now())",
          [randomUUID(), p1, randomUUID(), p2, hash1, hash2],
        );

        // 3. Applying Migration 015 must fail explicitly due to unique index / constraint violation
        const migration015Path = path.resolve(
          process.cwd(),
          'db/migrations/015_local_owner_principal_account_id.sql',
        );
        const migration015Sql = await readFile(migration015Path, 'utf8');

        await expect(pool!.query(migration015Sql)).rejects.toThrow();
      } finally {
        await dropSchemas(databaseUrl);
        await migrateUpTo(undefined, databaseUrl);
      }
    });
  });
});
