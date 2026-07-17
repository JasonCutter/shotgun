import { argon2, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { Actor, SecurityContext } from '../../contracts/src/index.js';

export type PrincipalKind = 'user' | 'service';
export type PrincipalStatus = 'active' | 'disabled';
export type AuthMethod = 'session' | 'api_token' | 'development';

export type AuthenticatedPrincipal = {
  readonly principalId: string;
  readonly actor: Actor;
  readonly kind: PrincipalKind;
  readonly status: PrincipalStatus;
  readonly authenticationMethod: AuthMethod;
  readonly credentialId: string;
};

export type ProjectMembership = {
  readonly principalId: string;
  readonly projectId: string;
  readonly scopes: readonly string[];
  readonly sensitivityClearance: SecurityContext['sensitivity'];
  readonly isOwner: boolean;
  readonly expiresAt?: string;
};

export type TrustedSecurityContext = {
  readonly projectId: string;
  readonly actor: Actor;
  readonly principalId: string;
  readonly authenticationMethod: AuthMethod;
  readonly security: SecurityContext;
};

export type AuthSession = {
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly principalId: string;
  readonly activeProjectId: string;
  readonly expiresAt: string;
  readonly csrfHash?: string;
};

export type IssuedApiToken = {
  readonly tokenId: string;
  readonly token: string;
  readonly expiresAt: string;
};

export type AuthRepositoryPort = {
  bootstrapOwner(input: {
    readonly accountId: string;
    readonly passwordHash: string;
    readonly projectId: string;
    readonly scopes: readonly string[];
    readonly sensitivityClearance: SecurityContext['sensitivity'];
  }): Promise<void>;
  authenticatePassword(
    accountId: string,
    password: string,
  ): Promise<AuthenticatedPrincipal | undefined>;
  findPrincipal(
    principalId: string,
    method: AuthMethod,
    credentialId: string,
  ): Promise<AuthenticatedPrincipal | undefined>;
  createSession(
    principalId: string,
    activeProjectId: string,
    expiresAt: string,
  ): Promise<AuthSession>;
  findSession(sessionToken: string): Promise<AuthSession | undefined>;
  revokeSessions(principalId: string): Promise<void>;
  updateSessionCsrf(sessionToken: string, newCsrfToken: string): Promise<void>;
  updateSessionProject(sessionToken: string, activeProjectId: string): Promise<void>;
  changePassword(principalId: string, passwordHash: string): Promise<void>;
  disablePrincipal(principalId: string): Promise<void>;
  issueApiToken(input: {
    readonly principalId: string;
    readonly scopes: readonly string[];
    readonly expiresAt: string;
  }): Promise<IssuedApiToken>;
  findApiToken(
    token: string,
  ): Promise<(AuthenticatedPrincipal & { readonly scopeCeiling: readonly string[] }) | undefined>;
  revokeApiTokens(principalId: string): Promise<void>;
  listApiTokens(principalId: string): Promise<readonly Omit<IssuedApiToken, 'token'>[]>;
  findMembership(principalId: string, projectId: string): Promise<ProjectMembership | undefined>;
  listMemberships(principalId: string): Promise<readonly ProjectMembership[]>;
  appendAudit(event: {
    readonly principalId?: string;
    readonly projectId?: string;
    readonly event: string;
    readonly reason?: string;
  }): Promise<void>;
};

const sensitivityRank: Record<SecurityContext['sensitivity'], number> = {
  public: 0,
  internal: 1,
  private: 2,
  restricted: 3,
};

export const hasSensitivityClearance = (
  clearance: SecurityContext['sensitivity'],
  required: SecurityContext['sensitivity'],
): boolean => sensitivityRank[clearance] >= sensitivityRank[required];

export const hashSecuritySecret = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const encode = (value: Uint8Array): string => Buffer.from(value).toString('base64url');
const decode = (value: string): Buffer => Buffer.from(value, 'base64url');

const argon2Key = async (password: string, nonce: Uint8Array): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      { message: password, nonce, parallelism: 1, tagLength: 32, memory: 65536, passes: 3 },
      (error, derivedKey) => (error ? reject(error) : resolve(Buffer.from(derivedKey))),
    );
  });

export const hashPassword = async (password: string): Promise<string> => {
  const nonce = randomBytes(16);
  const digest = await argon2Key(password, nonce);
  return `argon2id$v=1$${encode(nonce)}$${encode(digest)}`;
};

export const verifyPassword = async (password: string, encoded: string): Promise<boolean> => {
  const [algorithm, version, nonceText, digestText] = encoded.split('$');
  if (algorithm !== 'argon2id' || version !== 'v=1' || !nonceText || !digestText) return false;
  const actual = await argon2Key(password, decode(nonceText));
  const expected = decode(digestText);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const randomSecret = (bytes = 32): string => randomBytes(bytes).toString('base64url');
const now = (): string => new Date().toISOString();

type StoredPrincipal = {
  principal: AuthenticatedPrincipal;
  accountId: string;
  passwordHash: string;
};
type StoredSession = AuthSession & { readonly tokenHash: string; revokedAt?: string };
type StoredToken = IssuedApiToken & {
  readonly tokenHash: string;
  readonly principalId: string;
  readonly scopeCeiling: readonly string[];
  revokedAt?: string;
};

export class InMemoryAuthRepository implements AuthRepositoryPort {
  #principals = new Map<string, StoredPrincipal>();
  #accountIds = new Map<string, string>();
  #memberships = new Map<string, ProjectMembership>();
  #sessions = new Map<string, StoredSession>();
  #tokens = new Map<string, StoredToken>();
  readonly audit: { principalId?: string; projectId?: string; event: string; reason?: string }[] =
    [];

  async bootstrapOwner(input: Parameters<AuthRepositoryPort['bootstrapOwner']>[0]): Promise<void> {
    if ([...this.#memberships.values()].some((membership) => membership.isOwner)) {
      throw new Error('An active Owner already exists.');
    }
    const accountId = input.accountId.trim().toLowerCase();
    if (!accountId || this.#accountIds.has(accountId))
      throw new Error('Account ID is already in use.');
    const principalId = randomUUID();
    this.#principals.set(principalId, {
      principal: {
        principalId,
        actor: { type: 'user', id: principalId },
        kind: 'user',
        status: 'active',
        authenticationMethod: 'session',
        credentialId: principalId,
      },
      accountId,
      passwordHash: input.passwordHash,
    });
    this.#accountIds.set(accountId, principalId);
    this.#memberships.set(`${principalId}:${input.projectId}`, {
      principalId,
      projectId: input.projectId,
      scopes: input.scopes,
      sensitivityClearance: input.sensitivityClearance,
      isOwner: true,
    });
  }

  async authenticatePassword(
    accountId: string,
    password: string,
  ): Promise<AuthenticatedPrincipal | undefined> {
    const principalId = this.#accountIds.get(accountId.trim().toLowerCase());
    const stored = principalId ? this.#principals.get(principalId) : undefined;
    if (
      !stored ||
      stored.principal.status !== 'active' ||
      !(await verifyPassword(password, stored.passwordHash))
    )
      return undefined;
    return { ...stored.principal, authenticationMethod: 'session' };
  }

  async createSession(
    principalId: string,
    activeProjectId: string,
    expiresAt: string,
  ): Promise<AuthSession> {
    const sessionToken = randomSecret();
    const session: StoredSession = {
      sessionId: randomUUID(),
      sessionToken,
      csrfToken: randomSecret(24),
      principalId,
      activeProjectId,
      expiresAt,
      tokenHash: hashSecuritySecret(sessionToken),
    };
    this.#sessions.set(session.tokenHash, session);
    return session;
  }

  async findSession(sessionToken: string): Promise<AuthSession | undefined> {
    const session = this.#sessions.get(hashSecuritySecret(sessionToken));
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now())
      return undefined;
    return { ...session, csrfHash: hashSecuritySecret(session.csrfToken) };
  }

  async revokeSessions(principalId: string): Promise<void> {
    for (const session of this.#sessions.values())
      if (session.principalId === principalId) session.revokedAt = now();
  }

  async updateSessionCsrf(sessionToken: string, newCsrfToken: string): Promise<void> {
    const session = this.#sessions.get(hashSecuritySecret(sessionToken));
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now())
      throw new Error('Invalid or expired session.');
    this.#sessions.set(session.tokenHash, {
      ...session,
      csrfToken: newCsrfToken,
    });
  }

  async updateSessionProject(sessionToken: string, activeProjectId: string): Promise<void> {
    const session = this.#sessions.get(hashSecuritySecret(sessionToken));
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now())
      throw new Error('Invalid or expired session.');
    this.#sessions.set(session.tokenHash, {
      ...session,
      activeProjectId,
    });
  }

  async findPrincipal(
    principalId: string,
    method: AuthMethod,
    credentialId: string,
  ): Promise<AuthenticatedPrincipal | undefined> {
    const stored = this.#principals.get(principalId)?.principal;
    return stored?.status === 'active'
      ? { ...stored, authenticationMethod: method, credentialId }
      : undefined;
  }

  async changePassword(principalId: string, passwordHash: string): Promise<void> {
    const stored = this.#principals.get(principalId);
    if (!stored) throw new Error('Principal not found.');
    stored.passwordHash = passwordHash;
    await this.revokeSessions(principalId);
  }

  async disablePrincipal(principalId: string): Promise<void> {
    const stored = this.#principals.get(principalId);
    if (!stored) throw new Error('Principal not found.');
    stored.principal = { ...stored.principal, status: 'disabled' };
    await this.revokeSessions(principalId);
    await this.revokeApiTokens(principalId);
  }

  async issueApiToken(
    input: Parameters<AuthRepositoryPort['issueApiToken']>[0],
  ): Promise<IssuedApiToken> {
    const token = randomSecret();
    const issued: StoredToken = {
      tokenId: randomUUID(),
      token,
      expiresAt: input.expiresAt,
      tokenHash: hashSecuritySecret(token),
      principalId: input.principalId,
      scopeCeiling: input.scopes,
    };
    this.#tokens.set(issued.tokenHash, issued);
    return { tokenId: issued.tokenId, token, expiresAt: issued.expiresAt };
  }

  async findApiToken(
    token: string,
  ): Promise<(AuthenticatedPrincipal & { readonly scopeCeiling: readonly string[] }) | undefined> {
    const stored = this.#tokens.get(hashSecuritySecret(token));
    const principal = stored ? this.#principals.get(stored.principalId)?.principal : undefined;
    if (
      !stored ||
      stored.revokedAt ||
      Date.parse(stored.expiresAt) <= Date.now() ||
      !principal ||
      principal.status !== 'active'
    )
      return undefined;
    return {
      ...principal,
      authenticationMethod: 'api_token',
      credentialId: stored.tokenId,
      scopeCeiling: stored.scopeCeiling,
    };
  }

  async revokeApiTokens(principalId: string): Promise<void> {
    for (const token of this.#tokens.values())
      if (token.principalId === principalId) token.revokedAt = now();
  }

  async listApiTokens(principalId: string): Promise<readonly Omit<IssuedApiToken, 'token'>[]> {
    return [...this.#tokens.values()]
      .filter((t) => t.principalId === principalId && !t.revokedAt && Date.parse(t.expiresAt) > Date.now())
      .map((t) => ({ tokenId: t.tokenId, expiresAt: t.expiresAt }));
  }

  async findMembership(
    principalId: string,
    projectId: string,
  ): Promise<ProjectMembership | undefined> {
    const membership = this.#memberships.get(`${principalId}:${projectId}`);
    return membership && (!membership.expiresAt || Date.parse(membership.expiresAt) > Date.now())
      ? membership
      : undefined;
  }

  async listMemberships(principalId: string): Promise<readonly ProjectMembership[]> {
    return [...this.#memberships.values()].filter(
      (membership) => membership.principalId === principalId,
    );
  }

  async appendAudit(event: {
    principalId?: string;
    projectId?: string;
    event: string;
    reason?: string;
  }): Promise<void> {
    this.audit.push(event);
  }
}

export const authorize = async (input: {
  readonly repository: AuthRepositoryPort;
  readonly principal: AuthenticatedPrincipal;
  readonly projectId: string;
  readonly requiredScopes: readonly string[];
  readonly resourceSensitivity?: SecurityContext['sensitivity'];
  readonly tokenScopeCeiling?: readonly string[];
}): Promise<TrustedSecurityContext | undefined> => {
  const membership = await input.repository.findMembership(
    input.principal.principalId,
    input.projectId,
  );
  if (!membership) return undefined;
  const allowedScopes = membership.scopes.filter(
    (scope) => !input.tokenScopeCeiling || input.tokenScopeCeiling.includes(scope),
  );
  if (!input.requiredScopes.every((scope) => allowedScopes.includes(scope))) return undefined;
  const sensitivity = input.resourceSensitivity ?? membership.sensitivityClearance;
  if (!hasSensitivityClearance(membership.sensitivityClearance, sensitivity)) return undefined;
  return {
    projectId: input.projectId,
    actor: input.principal.actor,
    principalId: input.principal.principalId,
    authenticationMethod: input.principal.authenticationMethod,
    security: { accessScope: allowedScopes, sensitivity, dataClassification: 'personal' },
  };
};
