import { randomBytes, randomUUID } from 'node:crypto';

import type { Pool, QueryResultRow } from 'pg';

import {
  type AuthRepositoryPort,
  type AuthenticatedPrincipal,
  type AuthSession,
  type IssuedApiToken,
  type ProjectMembership,
  hashSecuritySecret,
  verifyPassword,
} from '../../../packages/authentication/src/index.js';
import type { SecurityContext } from '../../../packages/contracts/src/index.js';

const secret = (bytes = 32): string => randomBytes(bytes).toString('base64url');
const now = (): string => new Date().toISOString();

type PrincipalRow = QueryResultRow & {
  principal_id: string;
  actor_type: 'user' | 'service';
  status: 'active' | 'disabled';
  credential_id: string;
};
type MembershipRow = QueryResultRow & {
  principal_id: string;
  project_id: string;
  scopes: string[];
  sensitivity_clearance: SecurityContext['sensitivity'];
  is_owner: boolean;
  expires_at: Date | null;
};

const principal = (
  row: PrincipalRow,
  method: AuthenticatedPrincipal['authenticationMethod'],
  credentialId = row.credential_id,
): AuthenticatedPrincipal => ({
  principalId: row.principal_id,
  actor: { type: row.actor_type === 'service' ? 'service' : 'user', id: row.principal_id },
  kind: row.actor_type,
  status: row.status,
  authenticationMethod: method,
  credentialId,
});

const membership = (row: MembershipRow): ProjectMembership => ({
  principalId: row.principal_id,
  projectId: row.project_id,
  scopes: row.scopes,
  sensitivityClearance: row.sensitivity_clearance,
  isOwner: row.is_owner,
  expiresAt: row.expires_at?.toISOString(),
});

export class PostgresAuthRepository implements AuthRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async bootstrapOwner(input: Parameters<AuthRepositoryPort['bootstrapOwner']>[0]): Promise<void> {
    const client = await this.pool.connect();
    const accountId = input.accountId.trim().toLowerCase();
    if (!accountId) throw new Error('Account ID is required.');
    try {
      await client.query('BEGIN');
      const existingAccount = await client.query<{ principal_id: string }>(
        'SELECT principal_id::text FROM auth.principals WHERE account_id = $1 FOR UPDATE',
        [accountId],
      );
      const existingAccountRow = existingAccount.rows[0];
      if (existingAccountRow) {
        const existingMembership = await client.query<{ is_owner: boolean }>(
          'SELECT is_owner FROM auth.project_memberships WHERE principal_id = $1 AND project_id = $2',
          [existingAccountRow.principal_id, input.projectId],
        );
        if (existingMembership.rows[0]?.is_owner) {
          throw new Error('An active Owner already exists.');
        }
        throw new Error('Account ID is already in use.');
      }
      const existingOwner = await client.query(
        'SELECT 1 FROM auth.project_memberships WHERE is_owner AND project_id = $1 AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE',
        [input.projectId],
      );
      if (existingOwner.rowCount && existingOwner.rowCount > 0) {
        throw new Error('An active Owner already exists.');
      }
      const principalId = randomUUID();
      await client.query(
        'INSERT INTO auth.principals (principal_id, actor_type, status, account_id, created_at) VALUES ($1, $2, $3, $4, $5)',
        [principalId, 'user', 'active', input.accountId.trim().toLowerCase(), now()],
      );
      if (input.passwordHash && input.passwordHash.trim() !== '') {
        await client.query(
          'INSERT INTO auth.credentials (credential_id, principal_id, credential_type, account_id, password_hash, password_changed_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            randomUUID(),
            principalId,
            'local_password',
            input.accountId.trim().toLowerCase(),
            input.passwordHash,
            now(),
          ],
        );
      }
      await client.query(
        'UPDATE auth.project_memberships SET is_owner = false WHERE is_owner AND project_id = $1 AND expires_at IS NOT NULL AND expires_at <= now()',
        [input.projectId],
      );
      await client.query(
        'INSERT INTO auth.project_memberships (principal_id, project_id, scopes, sensitivity_clearance, is_owner) VALUES ($1, $2, $3, $4, true)',
        [principalId, input.projectId, input.scopes, input.sensitivityClearance],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async authenticatePassword(
    accountId: string,
    password: string,
  ): Promise<AuthenticatedPrincipal | undefined> {
    const result = await this.pool.query<PrincipalRow & { password_hash: string }>(
      `SELECT p.principal_id::text, p.actor_type, p.status, c.credential_id::text, c.password_hash FROM auth.credentials c JOIN auth.principals p ON p.principal_id = c.principal_id WHERE c.account_id = $1 AND c.disabled_at IS NULL`,
      [accountId.trim().toLowerCase()],
    );
    const row = result.rows[0];
    if (!row || row.status !== 'active' || !(await verifyPassword(password, row.password_hash)))
      return undefined;
    return principal(row, 'session');
  }

  async findOwnerMembership(
    accountId: string,
    projectId: string,
  ): Promise<ProjectMembership | undefined> {
    const result = await this.pool.query<MembershipRow>(
      `SELECT m.principal_id::text, m.project_id, m.scopes, m.sensitivity_clearance, m.is_owner, m.expires_at
       FROM auth.project_memberships m
       JOIN auth.principals p ON p.principal_id = m.principal_id
       WHERE p.account_id = $1
         AND m.project_id = $2
         AND m.is_owner
         AND (m.expires_at IS NULL OR m.expires_at > now())
       LIMIT 1`,
      [accountId.trim().toLowerCase(), projectId],
    );
    return result.rows[0] ? membership(result.rows[0]) : undefined;
  }

  async createSession(
    principalId: string,
    activeProjectId: string,
    expiresAt: string,
  ): Promise<AuthSession> {
    const sessionToken = secret();
    const csrfToken = secret(24);
    const sessionId = randomUUID();
    await this.pool.query(
      'INSERT INTO auth.sessions (session_id, token_hash, csrf_hash, principal_id, active_project_id, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        sessionId,
        hashSecuritySecret(sessionToken),
        hashSecuritySecret(csrfToken),
        principalId,
        activeProjectId,
        expiresAt,
        now(),
      ],
    );
    return { sessionId, sessionToken, csrfToken, principalId, activeProjectId, expiresAt };
  }

  async findSession(sessionToken: string): Promise<AuthSession | undefined> {
    const result = await this.pool.query<{
      session_id: string;
      principal_id: string;
      active_project_id: string;
      expires_at: Date;
      csrf_hash: string;
    }>(
      'SELECT session_id::text, principal_id::text, active_project_id, expires_at, csrf_hash FROM auth.sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()',
      [hashSecuritySecret(sessionToken)],
    );
    const row = result.rows[0];
    return row
      ? {
          sessionId: row.session_id,
          sessionToken,
          csrfToken: '',
          csrfHash: row.csrf_hash,
          principalId: row.principal_id,
          activeProjectId: row.active_project_id,
          expiresAt: row.expires_at.toISOString(),
        }
      : undefined;
  }

  async findPrincipal(
    principalId: string,
    method: AuthenticatedPrincipal['authenticationMethod'],
    credentialId: string,
  ): Promise<AuthenticatedPrincipal | undefined> {
    const result = await this.pool.query<PrincipalRow>(
      `SELECT p.principal_id::text, p.actor_type, p.status, $2::text AS credential_id FROM auth.principals p WHERE p.principal_id = $1`,
      [principalId, credentialId],
    );
    const row = result.rows[0];
    return row?.status === 'active' ? principal(row, method, credentialId) : undefined;
  }

  async updateSessionCsrf(sessionToken: string, newCsrfToken: string): Promise<void> {
    await this.pool.query('UPDATE auth.sessions SET csrf_hash = $2 WHERE token_hash = $1', [
      hashSecuritySecret(sessionToken),
      hashSecuritySecret(newCsrfToken),
    ]);
  }

  async updateSessionProject(sessionToken: string, activeProjectId: string): Promise<void> {
    await this.pool.query('UPDATE auth.sessions SET active_project_id = $2 WHERE token_hash = $1', [
      hashSecuritySecret(sessionToken),
      activeProjectId,
    ]);
  }

  async revokeSessions(principalId: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth.sessions SET revoked_at = now() WHERE principal_id = $1 AND revoked_at IS NULL',
      [principalId],
    );
  }

  async verifyCurrentPassword(principalId: string, currentPassword: string): Promise<boolean> {
    const result = await this.pool.query<{ password_hash: string }>(
      'SELECT c.password_hash FROM auth.credentials c JOIN auth.principals p ON p.principal_id = c.principal_id WHERE c.principal_id = $1 AND c.disabled_at IS NULL AND p.status = $2',
      [principalId, 'active'],
    );
    const row = result.rows[0];
    if (!row) return false;
    return verifyPassword(currentPassword, row.password_hash);
  }

  async changePassword(principalId: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth.credentials SET password_hash = $2, password_changed_at = now() WHERE principal_id = $1 AND disabled_at IS NULL',
      [principalId, passwordHash],
    );
    await this.revokeSessions(principalId);
  }
  async disablePrincipal(principalId: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth.principals SET status = $2, disabled_at = now() WHERE principal_id = $1',
      [principalId, 'disabled'],
    );
    await this.revokeSessions(principalId);
    await this.revokeApiTokens(principalId);
  }

  async issueApiToken(
    input: Parameters<AuthRepositoryPort['issueApiToken']>[0],
  ): Promise<IssuedApiToken> {
    const token = secret();
    const issued = { tokenId: randomUUID(), token, expiresAt: input.expiresAt };
    await this.pool.query(
      'INSERT INTO auth.api_tokens (token_id, token_hash, principal_id, scope_ceiling, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        issued.tokenId,
        hashSecuritySecret(token),
        input.principalId,
        input.scopes,
        input.expiresAt,
        now(),
      ],
    );
    return issued;
  }

  async findApiToken(
    token: string,
  ): Promise<(AuthenticatedPrincipal & { readonly scopeCeiling: readonly string[] }) | undefined> {
    const result = await this.pool.query<
      PrincipalRow & { token_id: string; scope_ceiling: string[] }
    >(
      `SELECT p.principal_id::text, p.actor_type, p.status, t.token_id::text, t.scope_ceiling, t.token_id::text AS credential_id FROM auth.api_tokens t JOIN auth.principals p ON p.principal_id = t.principal_id WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now()`,
      [hashSecuritySecret(token)],
    );
    const row = result.rows[0];
    return row && row.status === 'active'
      ? { ...principal(row, 'api_token', row.token_id), scopeCeiling: row.scope_ceiling }
      : undefined;
  }

  async revokeApiTokens(principalId: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth.api_tokens SET revoked_at = now() WHERE principal_id = $1 AND revoked_at IS NULL',
      [principalId],
    );
  }
  async listApiTokens(principalId: string): Promise<readonly Omit<IssuedApiToken, 'token'>[]> {
    const result = await this.pool.query<{ token_id: string; expires_at: Date }>(
      'SELECT token_id::text, expires_at FROM auth.api_tokens WHERE principal_id = $1 AND revoked_at IS NULL AND expires_at > now()',
      [principalId],
    );
    return result.rows.map((r) => ({ tokenId: r.token_id, expiresAt: r.expires_at.toISOString() }));
  }

  async findMembership(
    principalId: string,
    projectId: string,
  ): Promise<ProjectMembership | undefined> {
    const result = await this.pool.query<MembershipRow>(
      'SELECT principal_id::text, project_id, scopes, sensitivity_clearance, is_owner, expires_at FROM auth.project_memberships WHERE principal_id = $1 AND project_id = $2 AND (expires_at IS NULL OR expires_at > now())',
      [principalId, projectId],
    );
    return result.rows[0] ? membership(result.rows[0]) : undefined;
  }
  async listMemberships(principalId: string): Promise<readonly ProjectMembership[]> {
    const result = await this.pool.query<MembershipRow>(
      'SELECT principal_id::text, project_id, scopes, sensitivity_clearance, is_owner, expires_at FROM auth.project_memberships WHERE principal_id = $1 AND (expires_at IS NULL OR expires_at > now())',
      [principalId],
    );
    return result.rows.map(membership);
  }
  async createProjectOwnerMembership(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly scopes: readonly string[];
    readonly sensitivityClearance: SecurityContext['sensitivity'];
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth.project_memberships (
         principal_id, project_id, scopes, sensitivity_clearance, is_owner
       )
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (principal_id, project_id) DO UPDATE
       SET scopes = EXCLUDED.scopes,
           sensitivity_clearance = EXCLUDED.sensitivity_clearance,
           is_owner = true`,
      [input.principalId, input.projectId, [...input.scopes], input.sensitivityClearance],
    );
  }
  async appendAudit(event: {
    principalId?: string;
    projectId?: string;
    event: string;
    reason?: string;
  }): Promise<void> {
    await this.pool.query(
      'INSERT INTO auth.audit_events (audit_event_id, principal_id, project_id, event, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [
        randomUUID(),
        event.principalId ?? null,
        event.projectId ?? null,
        event.event,
        event.reason ?? null,
        now(),
      ],
    );
  }
}
