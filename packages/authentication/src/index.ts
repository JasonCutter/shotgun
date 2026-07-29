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

export type TrustedPrincipalContext = {
  readonly principalId: string;
  readonly actor: Actor;
  readonly authenticationMethod: AuthMethod;
  readonly credentialId?: string;
};

export type AuthSession = {
  readonly sessionId: string;
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly principalId: string;
  readonly activeProjectId: string | null;
  readonly expiresAt: string;
  readonly csrfHash?: string;
};

export type IssuedApiToken = {
  readonly tokenId: string;
  readonly token: string;
  readonly expiresAt: string;
};

export const LOCAL_OWNER_ACCOUNT_ID = 'local-owner';
export const DEFAULT_PROJECT_ID = 'shotgun';

export type AuthRepositoryPort = {
  bootstrapLocalOwnerPrincipal(input: {
    readonly accountId: string;
    readonly passwordHash?: string;
  }): Promise<AuthenticatedPrincipal>;
  bootstrapOwner(input: {
    readonly accountId: string;
    readonly passwordHash?: string;
    readonly projectId: string;
    readonly scopes: readonly string[];
    readonly sensitivityClearance: SecurityContext['sensitivity'];
  }): Promise<void>;
  findOwnerMembership(accountId: string, projectId: string): Promise<ProjectMembership | undefined>;
  findPrincipalByAccountId(accountId: string): Promise<AuthenticatedPrincipal | undefined>;
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
    activeProjectId: string | null,
    expiresAt: string,
  ): Promise<AuthSession>;
  findSession(sessionToken: string): Promise<AuthSession | undefined>;
  revokeSessions(principalId: string): Promise<void>;
  updateSessionCsrf(sessionToken: string, newCsrfToken: string): Promise<void>;
  updateSessionProject(sessionToken: string, activeProjectId: string): Promise<void>;
  verifyCurrentPassword(principalId: string, currentPassword: string): Promise<boolean>;
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
  createProjectOwnerMembership?(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly scopes: readonly string[];
    readonly sensitivityClearance: SecurityContext['sensitivity'];
  }): Promise<void>;
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
  passwordHash?: string;
};
type StoredSession = AuthSession & { readonly tokenHash: string; revokedAt?: string };
type StoredToken = IssuedApiToken & {
  readonly tokenHash: string;
  readonly principalId: string;
  readonly scopeCeiling: readonly string[];
  revokedAt?: string;
};

const isActiveOwner = (membership: ProjectMembership): boolean => {
  if (!membership.isOwner) return false;
  if (!membership.expiresAt) return true;
  return new Date(membership.expiresAt) > new Date();
};

export class InMemoryAuthRepository implements AuthRepositoryPort {
  #principals = new Map<string, StoredPrincipal>();
  #accountIds = new Map<string, string>();
  #memberships = new Map<string, ProjectMembership>();
  #sessions = new Map<string, StoredSession>();
  #tokens = new Map<string, StoredToken>();
  readonly audit: { principalId?: string; projectId?: string; event: string; reason?: string }[] =
    [];

  async bootstrapLocalOwnerPrincipal(input: {
    readonly accountId: string;
    readonly passwordHash?: string;
  }): Promise<AuthenticatedPrincipal> {
    const accountId = input.accountId.trim().toLowerCase();
    if (!accountId) throw new Error('Account ID is required.');
    const existingPrincipalId = this.#accountIds.get(accountId);
    if (existingPrincipalId) {
      const existing = this.#principals.get(existingPrincipalId)?.principal;
      if (!existing || existing.status !== 'active') {
        throw new Error('Local Owner principal is unavailable.');
      }
      return { ...existing, authenticationMethod: 'session' };
    }
    const principalId = randomUUID();
    const principal: AuthenticatedPrincipal = {
      principalId,
      actor: { type: 'user', id: principalId },
      kind: 'user',
      status: 'active',
      authenticationMethod: 'session',
      credentialId: principalId,
    };
    this.#principals.set(principalId, {
      principal,
      accountId,
      ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
    });
    this.#accountIds.set(accountId, principalId);
    return principal;
  }

  async bootstrapOwner(input: Parameters<AuthRepositoryPort['bootstrapOwner']>[0]): Promise<void> {
    const accountId = input.accountId.trim().toLowerCase();
    if (!accountId) throw new Error('Account ID is required.');
    // Check if this exact account already has an owner membership in this project
    if (this.#accountIds.has(accountId)) {
      const existingPrincipalId = this.#accountIds.get(accountId)!;
      const existingMembership = this.#memberships.get(`${existingPrincipalId}:${input.projectId}`);
      if (existingMembership && isActiveOwner(existingMembership)) {
        throw new Error('An active Owner already exists.');
      }
      throw new Error('Account ID is already in use.');
    }
    for (const membership of this.#memberships.values()) {
      if (membership.projectId === input.projectId && isActiveOwner(membership)) {
        throw new Error('An active Owner already exists.');
      }
    }
    const principalId = randomUUID();
    const stored: StoredPrincipal = {
      principal: {
        principalId,
        actor: { type: 'user', id: principalId },
        kind: 'user',
        status: 'active',
        authenticationMethod: 'session',
        credentialId: principalId,
      },
      accountId,
      ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
    };
    this.#principals.set(principalId, stored);
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
      !stored.passwordHash ||
      !(await verifyPassword(password, stored.passwordHash))
    )
      return undefined;
    return { ...stored.principal, authenticationMethod: 'session' };
  }

  getStoredPasswordHash(principalId: string): string | undefined {
    return this.#principals.get(principalId)?.passwordHash;
  }

  seedExpiredOwner(accountId: string, projectId: string): void {
    const principalId = randomUUID();
    this.#accountIds.set(accountId, principalId);
    this.#memberships.set(`${principalId}:${projectId}`, {
      principalId,
      projectId,
      scopes: ['owner'],
      sensitivityClearance: 'private',
      isOwner: true,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
  }

  async findOwnerMembership(
    accountId: string,
    projectId: string,
  ): Promise<ProjectMembership | undefined> {
    const normalizedAccountId = accountId.trim().toLowerCase();
    const principalId = this.#accountIds.get(normalizedAccountId);
    if (!principalId) return undefined;
    const membership = this.#memberships.get(`${principalId}:${projectId}`);
    return membership && isActiveOwner(membership) ? membership : undefined;
  }

  async findPrincipalByAccountId(accountId: string): Promise<AuthenticatedPrincipal | undefined> {
    const principalId = this.#accountIds.get(accountId.trim().toLowerCase());
    const stored = principalId ? this.#principals.get(principalId)?.principal : undefined;
    return stored?.status === 'active' ? { ...stored, authenticationMethod: 'session' } : undefined;
  }

  async createSession(
    principalId: string,
    activeProjectId: string | null,
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

  assertZeroProjectSession(sessionId: string, principalId: string): void {
    const session = [...this.#sessions.values()].find(
      (candidate) =>
        candidate.sessionId === sessionId &&
        candidate.principalId === principalId &&
        !candidate.revokedAt &&
        Date.parse(candidate.expiresAt) > Date.now(),
    );
    if (!session) throw new Error('Invalid or expired Session.');
    if (session.activeProjectId !== null) {
      throw new Error('Session is not in zero-project state.');
    }
    const activeMemberships = [...this.#memberships.values()].filter(
      (membership) =>
        membership.principalId === principalId &&
        (!membership.expiresAt || Date.parse(membership.expiresAt) > Date.now()),
    );
    if (activeMemberships.length > 0) {
      throw new Error('Principal already has an accessible Project.');
    }
  }

  updateSessionProjectById(sessionId: string, principalId: string, projectId: string | null): void {
    const entry = [...this.#sessions.entries()].find(
      ([, candidate]) =>
        candidate.sessionId === sessionId &&
        candidate.principalId === principalId &&
        !candidate.revokedAt &&
        Date.parse(candidate.expiresAt) > Date.now(),
    );
    if (!entry) throw new Error('Invalid or expired Session.');
    this.#sessions.set(entry[0], { ...entry[1], activeProjectId: projectId });
  }

  removeProjectMembershipForRollback(principalId: string, projectId: string): void {
    this.#memberships.delete(`${principalId}:${projectId}`);
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

  async verifyCurrentPassword(principalId: string, currentPassword: string): Promise<boolean> {
    const stored = this.#principals.get(principalId);
    if (!stored || stored.principal.status !== 'active' || !stored.passwordHash) return false;
    return verifyPassword(currentPassword, stored.passwordHash);
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
      .filter(
        (t) =>
          t.principalId === principalId && !t.revokedAt && Date.parse(t.expiresAt) > Date.now(),
      )
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
      (membership) =>
        membership.principalId === principalId &&
        (!membership.expiresAt || Date.parse(membership.expiresAt) > Date.now()),
    );
  }

  async createProjectOwnerMembership(input: {
    readonly principalId: string;
    readonly projectId: string;
    readonly scopes: readonly string[];
    readonly sensitivityClearance: SecurityContext['sensitivity'];
  }): Promise<void> {
    this.#memberships.set(`${input.principalId}:${input.projectId}`, {
      principalId: input.principalId,
      projectId: input.projectId,
      scopes: Object.freeze([...input.scopes]),
      sensitivityClearance: input.sensitivityClearance,
      isOwner: true,
    });
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

export type AuthenticationContext = {
  readonly isLoopbackBind?: boolean;
  readonly isRemoteLoopback?: boolean;
  readonly isSameOrigin?: boolean;
  readonly localOwnerEnabled?: boolean;
  readonly methodHint?: string;
  readonly sessionToken?: string;
  readonly credentials?: Record<string, unknown>;
};

export type AuthenticationResult =
  | {
      readonly status: 'authenticated';
      readonly session: AuthSession;
      readonly principalContext: TrustedPrincipalContext;
      readonly context?: TrustedSecurityContext;
    }
  | {
      readonly status: 'authentication_required';
      readonly method?: string;
      readonly reason: string;
    }
  | {
      readonly status: 'authentication_unavailable';
      readonly code: string;
      readonly reason: string;
    };

export type AuthenticationPort = {
  establishSession(context: AuthenticationContext): Promise<AuthenticationResult>;
  revokeSession(sessionId: string): Promise<void>;
};

export type LocalOwnerProvisioningService = {
  ensureLocalOwnerIdentity(input?: { readonly defaultProjectId?: string }): Promise<{
    readonly principal: AuthenticatedPrincipal;
    readonly membership?: ProjectMembership;
  }>;
};

export class DefaultLocalOwnerProvisioningService implements LocalOwnerProvisioningService {
  constructor(private readonly repository: AuthRepositoryPort) {}

  async ensureLocalOwnerIdentity(input?: { readonly defaultProjectId?: string }): Promise<{
    readonly principal: AuthenticatedPrincipal;
    readonly membership?: ProjectMembership;
  }> {
    const defaultProjectId = input?.defaultProjectId?.trim() || DEFAULT_PROJECT_ID;
    let principal = await this.repository.findPrincipalByAccountId(LOCAL_OWNER_ACCOUNT_ID);
    let ownerMembership = await this.repository.findOwnerMembership(
      LOCAL_OWNER_ACCOUNT_ID,
      defaultProjectId,
    );
    if (!principal) {
      principal = await this.repository.bootstrapLocalOwnerPrincipal({
        accountId: LOCAL_OWNER_ACCOUNT_ID,
      });
      ownerMembership = undefined;
    }

    const resolvedPrincipal = await this.repository.findPrincipal(
      principal.principalId,
      'session',
      principal.principalId,
    );

    if (!resolvedPrincipal) {
      throw new Error('Local owner principal not found.');
    }

    return {
      principal: resolvedPrincipal,
      ...(ownerMembership === undefined ? {} : { membership: ownerMembership }),
    };
  }
}

export class LocalOwnerAuthenticationAdapter implements AuthenticationPort {
  private readonly provisioningService: LocalOwnerProvisioningService;

  constructor(
    private readonly repository: AuthRepositoryPort,
    provisioningService?: LocalOwnerProvisioningService,
  ) {
    this.provisioningService =
      provisioningService ?? new DefaultLocalOwnerProvisioningService(repository);
  }

  async establishSession(authContext: AuthenticationContext): Promise<AuthenticationResult> {
    if (authContext.sessionToken) {
      const session = await this.repository.findSession(authContext.sessionToken);
      if (!session) {
        return {
          status: 'authentication_required',
          reason: 'Session is invalid, expired, or revoked.',
        };
      }
      const principal = await this.repository.findPrincipal(
        session.principalId,
        'session',
        session.sessionId,
      );
      if (!principal) {
        return {
          status: 'authentication_required',
          reason: 'Principal not found.',
        };
      }
      const principalContext: TrustedPrincipalContext = {
        principalId: principal.principalId,
        actor: principal.actor,
        authenticationMethod: principal.authenticationMethod,
        credentialId: principal.credentialId,
      };
      if (session.activeProjectId === null) {
        const memberships = await this.repository.listMemberships(principal.principalId);
        if (memberships.length > 0) {
          return {
            status: 'authentication_unavailable',
            code: 'LOCAL_PROJECT_SELECTION_REQUIRED',
            reason: 'An accessible Project exists but the Session has no authoritative selection.',
          };
        }
        return {
          status: 'authenticated',
          session,
          principalContext,
        };
      }
      const trustedContext = await authorize({
        repository: this.repository,
        principal,
        projectId: session.activeProjectId,
        requiredScopes: [],
      });
      if (!trustedContext) {
        return {
          status: 'authentication_unavailable',
          code: 'PROJECT_ACCESS_DENIED',
          reason: 'Membership in active project is missing or unauthorized.',
        };
      }
      return {
        status: 'authenticated',
        session,
        principalContext,
        context: trustedContext,
      };
    }

    // Fail-Closed Security Validation: Every requirement must be strictly boolean true
    if (
      authContext.localOwnerEnabled !== true ||
      authContext.isLoopbackBind !== true ||
      authContext.isRemoteLoopback !== true ||
      authContext.isSameOrigin !== true
    ) {
      const code =
        authContext.localOwnerEnabled === false
          ? 'LOCAL_BOOTSTRAP_DISABLED'
          : 'LOCAL_BOOTSTRAP_FORBIDDEN';
      return {
        status: 'authentication_unavailable',
        code,
        reason: 'Local Owner bootstrap security requirements were not strictly met (fail-closed).',
      };
    }

    try {
      const { principal, membership } = await this.provisioningService.ensureLocalOwnerIdentity({
        defaultProjectId: DEFAULT_PROJECT_ID,
      });

      const session = await this.repository.createSession(
        principal.principalId,
        membership?.projectId ?? null,
        new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      );

      const trustedContext = membership
        ? await authorize({
            repository: this.repository,
            principal,
            projectId: membership.projectId,
            requiredScopes: [],
          })
        : undefined;

      return {
        status: 'authenticated',
        session,
        principalContext: {
          principalId: principal.principalId,
          actor: principal.actor,
          authenticationMethod: principal.authenticationMethod,
          credentialId: principal.credentialId,
        },
        ...(trustedContext === undefined ? {} : { context: trustedContext }),
      };
    } catch (error) {
      return {
        status: 'authentication_unavailable',
        code: 'LOCAL_BOOTSTRAP_FAILED',
        reason: error instanceof Error ? error.message : 'Local owner provisioning failed.',
      };
    }
  }

  async revokeSession(identifier: string): Promise<void> {
    if (!identifier) return;
    const session = await this.repository.findSession(identifier);
    if (session) {
      await this.repository.revokeSessions(session.principalId);
    } else {
      await this.repository.revokeSessions(identifier);
    }
  }
}

export class FakeInteractiveAuthenticationAdapter implements AuthenticationPort {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async establishSession(_request: unknown): Promise<AuthenticationResult> {
    return {
      status: 'authentication_required',
      method: 'password',
      reason: 'Interactive authentication required.',
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async revokeSession(_identifier: string): Promise<void> {}
}
