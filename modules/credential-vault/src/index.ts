import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

export const CREDENTIAL_ENCRYPTION_VERSION = 'aes-256-gcm:v1';
export const CREDENTIAL_ENVELOPE_VERSION = 'credential-envelope:v1';

export type CredentialLifecycleState = 'active' | 'superseded' | 'revoked' | 'removed';

export type CredentialEnvelope = {
  readonly version: typeof CREDENTIAL_ENVELOPE_VERSION;
  readonly algorithm: 'aes-256-gcm';
  readonly nonce: string;
  readonly ciphertext: string;
  readonly authTag: string;
};

export type CredentialMetadata = {
  readonly credentialId: string;
  readonly projectId: string;
  readonly providerId: string;
  readonly encryptionVersion: typeof CREDENTIAL_ENCRYPTION_VERSION;
  readonly keyVersion: string;
  readonly credentialRevision: number;
  readonly lifecycleState: CredentialLifecycleState;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type StoredCredentialRevision = CredentialMetadata & {
  readonly encryptedSecret: CredentialEnvelope;
  /** Non-secret client identity for the dedicated credential-write recovery boundary. */
  readonly clientRequestId?: string;
};

export type CredentialScope = {
  readonly projectId: string;
  readonly providerId: string;
  readonly credentialId: string;
  readonly credentialRevision: number;
};

export type CredentialExecutionMetadata = CredentialMetadata;

export type CredentialExecutionResult = { readonly status: 'SUCCEEDED' | 'FAILED' };

export type CredentialExecutionCallback = (
  secret: Uint8Array,
  metadata: CredentialExecutionMetadata,
) => Promise<CredentialExecutionResult>;

export type CredentialVaultAvailability =
  | { readonly state: 'AVAILABLE'; readonly keyVersion: string }
  | {
      readonly state: 'UNAVAILABLE';
      readonly reason:
        'MISSING_MASTER_KEY' | 'MALFORMED_MASTER_KEY' | 'UNSUPPORTED_MASTER_KEY_VERSION';
    };

export type CredentialVaultRepositoryPort = {
  insertRevision(record: StoredCredentialRevision): Promise<void>;
  findExact(scope: CredentialScope): Promise<StoredCredentialRevision | undefined>;
  findByClientRequestId(input: {
    readonly projectId: string;
    readonly clientRequestId: string;
  }): Promise<StoredCredentialRevision | undefined>;
  listCurrent(projectId: string): Promise<readonly StoredCredentialRevision[]>;
  advanceRevision(input: {
    readonly projectId: string;
    readonly providerId: string;
    readonly credentialId: string;
    readonly expectedRevision: number;
    readonly next: StoredCredentialRevision;
  }): Promise<'UPDATED' | 'NOT_FOUND' | 'CONFLICT'>;
  updateLifecycle(input: {
    readonly scope: CredentialScope;
    readonly expectedState: 'active';
    readonly nextState: Exclude<CredentialLifecycleState, 'active'>;
    readonly updatedAt: string;
  }): Promise<StoredCredentialRevision | 'NOT_FOUND' | 'CONFLICT'>;
};

export type CredentialMasterKey = {
  readonly key: Uint8Array;
  readonly keyVersion: string;
};

export type CredentialMasterKeyAuthority = {
  read(): CredentialMasterKey;
};

export class CredentialMasterKeyError extends Error {
  constructor(
    readonly reason: Exclude<CredentialVaultAvailability, { state: 'AVAILABLE' }>['reason'],
  ) {
    super('Credential master key is unavailable.');
    this.name = 'CredentialMasterKeyError';
  }
}

export class CredentialVaultError extends Error {
  constructor(
    readonly code:
      | 'CONFIGURATION_REQUIRED'
      | 'AI_CAPABILITY_UNAVAILABLE'
      | 'NOT_FOUND'
      | 'OWNERSHIP_DENIED'
      | 'CONFLICT'
      | 'INVALID_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'CredentialVaultError';
  }
}

export class EnvironmentCredentialMasterKeyAuthority implements CredentialMasterKeyAuthority {
  constructor(
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
  ) {}

  read(): CredentialMasterKey {
    const encoded = this.environment.SHOTGUN_CREDENTIAL_MASTER_KEY?.trim();
    if (!encoded) throw new CredentialMasterKeyError('MISSING_MASTER_KEY');
    if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) {
      throw new CredentialMasterKeyError('MALFORMED_MASTER_KEY');
    }

    const key = Buffer.from(encoded, 'base64url');
    if (key.length !== 32) throw new CredentialMasterKeyError('MALFORMED_MASTER_KEY');

    const keyVersion = this.environment.SHOTGUN_CREDENTIAL_MASTER_KEY_VERSION?.trim() || 'v1';
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(keyVersion)) {
      throw new CredentialMasterKeyError('UNSUPPORTED_MASTER_KEY_VERSION');
    }
    return { key, keyVersion };
  }
}

export class StaticCredentialMasterKeyAuthority implements CredentialMasterKeyAuthority {
  constructor(private readonly value: CredentialMasterKey) {
    if (value.key.length !== 32) throw new Error('Static credential master key must be 32 bytes.');
  }

  read(): CredentialMasterKey {
    return { key: Buffer.from(this.value.key), keyVersion: this.value.keyVersion };
  }
}

export type CredentialVaultPort = {
  create(input: {
    readonly projectId: string;
    readonly providerId: string;
    readonly secret: string | Uint8Array;
    /** Server-generated identity used only by the secret-safe write recovery boundary. */
    readonly credentialId?: string;
    /** Non-secret request identity; never enters generic command/outcome persistence. */
    readonly clientRequestId?: string;
    readonly now?: string;
  }): Promise<CredentialMetadata>;
  replace(input: {
    readonly projectId: string;
    readonly providerId: string;
    readonly credentialId: string;
    readonly expectedRevision: number;
    readonly secret: string | Uint8Array;
    /** Non-secret request identity; never enters generic command/outcome persistence. */
    readonly clientRequestId?: string;
    readonly now?: string;
  }): Promise<CredentialMetadata>;
  revoke(scope: CredentialScope, now?: string): Promise<CredentialMetadata>;
  remove(scope: CredentialScope, now?: string): Promise<CredentialMetadata>;
  getMetadata(scope: CredentialScope): Promise<CredentialMetadata | undefined>;
  /** Returns only non-secret credential metadata for a prior credential write request. */
  getWriteOutcome(input: {
    readonly projectId: string;
    readonly clientRequestId: string;
  }): Promise<CredentialMetadata | undefined>;
  /** Non-secret current metadata only; encrypted envelopes are never returned. */
  listMetadata?(projectId: string): Promise<readonly CredentialMetadata[]>;
  getAvailability(): CredentialVaultAvailability;
  withCredential(
    scope: CredentialScope,
    callback: CredentialExecutionCallback,
  ): Promise<CredentialExecutionResult>;
};

const identifier = (name: string, value: string): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) {
    throw new CredentialVaultError('INVALID_INPUT', `${name} is invalid.`);
  }
  return normalized;
};

const revision = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new CredentialVaultError('INVALID_INPUT', 'Credential revision is invalid.');
  }
  return value;
};

const scopeOf = (scope: CredentialScope): CredentialScope => ({
  projectId: identifier('Project ID', scope.projectId),
  providerId: identifier('Provider ID', scope.providerId),
  credentialId: identifier('Credential ID', scope.credentialId),
  credentialRevision: revision(scope.credentialRevision),
});

const secretBytes = (secret: string | Uint8Array): Buffer => {
  const bytes = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret);
  if (bytes.length === 0 || bytes.length > 16_384) {
    throw new CredentialVaultError('INVALID_INPUT', 'Credential secret is invalid.');
  }
  return bytes;
};

const associatedData = (
  metadata: Pick<
    CredentialMetadata,
    'credentialId' | 'projectId' | 'providerId' | 'credentialRevision'
  >,
): Buffer =>
  Buffer.from(
    `${CREDENTIAL_ENVELOPE_VERSION}|${metadata.projectId}|${metadata.providerId}|${metadata.credentialId}|${metadata.credentialRevision}`,
    'utf8',
  );

const encrypt = (
  plaintext: Buffer,
  key: CredentialMasterKey,
  metadata: Pick<
    CredentialMetadata,
    'credentialId' | 'projectId' | 'providerId' | 'credentialRevision'
  >,
): CredentialEnvelope => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key.key), nonce);
  cipher.setAAD(associatedData(metadata));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: CREDENTIAL_ENVELOPE_VERSION,
    algorithm: 'aes-256-gcm',
    nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  };
};

const decode = (value: string, expectedLength: number | undefined, field: string): Buffer => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${field} is malformed.`);
  const decoded = Buffer.from(value, 'base64url');
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new Error(`${field} is malformed.`);
  }
  if (decoded.length === 0) throw new Error(`${field} is malformed.`);
  return decoded;
};

const decrypt = (
  envelope: CredentialEnvelope,
  key: CredentialMasterKey,
  metadata: Pick<
    CredentialMetadata,
    'credentialId' | 'projectId' | 'providerId' | 'credentialRevision'
  >,
): Buffer => {
  if (envelope.version !== CREDENTIAL_ENVELOPE_VERSION || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('Credential envelope version is unsupported.');
  }
  const nonce = decode(envelope.nonce, 12, 'Credential nonce');
  const authTag = decode(envelope.authTag, 16, 'Credential authentication tag');
  const ciphertext = decode(envelope.ciphertext, undefined, 'Credential ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key.key), nonce);
  decipher.setAAD(associatedData(metadata));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
};

export class CredentialVaultService implements CredentialVaultPort {
  constructor(
    private readonly repository: CredentialVaultRepositoryPort,
    private readonly masterKey: CredentialMasterKeyAuthority,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  getAvailability(): CredentialVaultAvailability {
    try {
      const key = this.masterKey.read();
      if (key.key.length !== 32 || !/^[A-Za-z0-9._-]{1,32}$/.test(key.keyVersion)) {
        key.key.fill(0);
        return { state: 'UNAVAILABLE', reason: 'MALFORMED_MASTER_KEY' };
      }
      const keyVersion = key.keyVersion;
      key.key.fill(0);
      return { state: 'AVAILABLE', keyVersion };
    } catch (error) {
      if (error instanceof CredentialMasterKeyError) {
        return { state: 'UNAVAILABLE', reason: error.reason };
      }
      return { state: 'UNAVAILABLE', reason: 'MALFORMED_MASTER_KEY' };
    }
  }

  async create(input: Parameters<CredentialVaultPort['create']>[0]): Promise<CredentialMetadata> {
    const projectId = identifier('Project ID', input.projectId);
    const providerId = identifier('Provider ID', input.providerId);
    const clientRequestId = input.clientRequestId
      ? identifier('Client request ID', input.clientRequestId)
      : undefined;
    if (clientRequestId) {
      const recovered = await this.repository.findByClientRequestId({ projectId, clientRequestId });
      if (recovered) return metadataOf(recovered);
    }
    const credentialId = input.credentialId
      ? identifier('Credential ID', input.credentialId)
      : randomUUID();
    const createdAt = input.now ?? this.clock();
    const bytes = secretBytes(input.secret);
    let key: CredentialMasterKey | undefined;
    try {
      key = this.readKey();
      const metadata: CredentialMetadata = {
        credentialId,
        projectId,
        providerId,
        encryptionVersion: CREDENTIAL_ENCRYPTION_VERSION,
        keyVersion: key.keyVersion,
        credentialRevision: 1,
        lifecycleState: 'active',
        createdAt,
        updatedAt: createdAt,
      };
      await this.repository.insertRevision({
        ...metadata,
        encryptedSecret: encrypt(bytes, key, metadata),
        ...(clientRequestId ? { clientRequestId } : {}),
      });
      if (clientRequestId) {
        const recovered = await this.repository.findByClientRequestId({
          projectId,
          clientRequestId,
        });
        if (recovered) return metadataOf(recovered);
      }
      return metadata;
    } finally {
      bytes.fill(0);
      key?.key.fill(0);
    }
  }

  async replace(input: Parameters<CredentialVaultPort['replace']>[0]): Promise<CredentialMetadata> {
    const projectId = identifier('Project ID', input.projectId);
    const providerId = identifier('Provider ID', input.providerId);
    const credentialId = identifier('Credential ID', input.credentialId);
    const expectedRevision = revision(input.expectedRevision);
    const clientRequestId = input.clientRequestId
      ? identifier('Client request ID', input.clientRequestId)
      : undefined;
    if (clientRequestId) {
      const recovered = await this.repository.findByClientRequestId({ projectId, clientRequestId });
      if (recovered) return metadataOf(recovered);
    }
    const current = await this.repository.findExact({
      projectId,
      providerId,
      credentialId,
      credentialRevision: expectedRevision,
    });
    if (!current) throw new CredentialVaultError('NOT_FOUND', 'Credential revision was not found.');
    if (current.lifecycleState !== 'active') {
      throw new CredentialVaultError('CONFLICT', 'Credential revision is not active.');
    }

    const bytes = secretBytes(input.secret);
    let key: CredentialMasterKey | undefined;
    try {
      key = this.readKey();
      const updatedAt = input.now ?? this.clock();
      const next: CredentialMetadata = {
        ...current,
        keyVersion: key.keyVersion,
        credentialRevision: expectedRevision + 1,
        lifecycleState: 'active',
        updatedAt,
      };
      const result = await this.repository.advanceRevision({
        projectId,
        providerId,
        credentialId,
        expectedRevision,
        next: {
          ...next,
          encryptedSecret: encrypt(bytes, key, next),
          ...(clientRequestId ? { clientRequestId } : {}),
        },
      });
      if (result === 'NOT_FOUND') {
        throw new CredentialVaultError('NOT_FOUND', 'Credential revision was not found.');
      }
      if (result === 'CONFLICT') {
        if (clientRequestId) {
          const recovered = await this.repository.findByClientRequestId({
            projectId,
            clientRequestId,
          });
          if (recovered) return metadataOf(recovered);
        }
        throw new CredentialVaultError('CONFLICT', 'Credential revision changed concurrently.');
      }
      if (clientRequestId) {
        const recovered = await this.repository.findByClientRequestId({
          projectId,
          clientRequestId,
        });
        if (recovered) return metadataOf(recovered);
      }
      return next;
    } finally {
      bytes.fill(0);
      key?.key.fill(0);
    }
  }

  async revoke(scope: CredentialScope, now = this.clock()): Promise<CredentialMetadata> {
    return this.updateLifecycle(scope, 'revoked', now);
  }

  async remove(scope: CredentialScope, now = this.clock()): Promise<CredentialMetadata> {
    return this.updateLifecycle(scope, 'removed', now);
  }

  async getMetadata(scope: CredentialScope): Promise<CredentialMetadata | undefined> {
    const stored = await this.repository.findExact(scopeOf(scope));
    return stored ? metadataOf(stored) : undefined;
  }

  async getWriteOutcome(input: {
    readonly projectId: string;
    readonly clientRequestId: string;
  }): Promise<CredentialMetadata | undefined> {
    const recovered = await this.repository.findByClientRequestId({
      projectId: identifier('Project ID', input.projectId),
      clientRequestId: identifier('Client request ID', input.clientRequestId),
    });
    return recovered ? metadataOf(recovered) : undefined;
  }

  async listMetadata(projectId: string): Promise<readonly CredentialMetadata[]> {
    const records = await this.repository.listCurrent(projectId);
    return records.map(metadataOf);
  }

  async withCredential(
    scope: CredentialScope,
    callback: CredentialExecutionCallback,
  ): Promise<CredentialExecutionResult> {
    const normalized = scopeOf(scope);
    const stored = await this.repository.findExact(normalized);
    if (!stored) throw new CredentialVaultError('NOT_FOUND', 'Credential revision was not found.');
    if (stored.lifecycleState !== 'active') {
      throw new CredentialVaultError(
        'AI_CAPABILITY_UNAVAILABLE',
        'Credential revision is unavailable.',
      );
    }

    const key = this.readKey();
    let plaintext: Buffer | undefined;
    try {
      if (stored.encryptionVersion !== CREDENTIAL_ENCRYPTION_VERSION) {
        throw new Error('Credential encryption version is unsupported.');
      }
      if (stored.keyVersion !== key.keyVersion) {
        throw new Error('Credential key version is unavailable.');
      }
      plaintext = decrypt(stored.encryptedSecret, key, stored);
    } catch (error) {
      if (error instanceof CredentialVaultError) throw error;
      throw new CredentialVaultError(
        'AI_CAPABILITY_UNAVAILABLE',
        'Credential resolution failed closed.',
      );
    }
    try {
      return await callback(plaintext, metadataOf(stored));
    } finally {
      plaintext?.fill(0);
      key.key.fill(0);
    }
  }

  private readKey(): CredentialMasterKey {
    try {
      const key = this.masterKey.read();
      if (key.key.length !== 32) {
        key.key.fill(0);
        throw new CredentialMasterKeyError('MALFORMED_MASTER_KEY');
      }
      if (!/^[A-Za-z0-9._-]{1,32}$/.test(key.keyVersion)) {
        key.key.fill(0);
        throw new CredentialMasterKeyError('UNSUPPORTED_MASTER_KEY_VERSION');
      }
      return key;
    } catch (error) {
      if (error instanceof CredentialMasterKeyError) {
        throw new CredentialVaultError(
          'CONFIGURATION_REQUIRED',
          'Credential capability is unavailable.',
        );
      }
      throw new CredentialVaultError(
        'CONFIGURATION_REQUIRED',
        'Credential capability is unavailable.',
      );
    }
  }

  private async updateLifecycle(
    scope: CredentialScope,
    nextState: Exclude<CredentialLifecycleState, 'active'>,
    updatedAt: string,
  ): Promise<CredentialMetadata> {
    const normalized = scopeOf(scope);
    const result = await this.repository.updateLifecycle({
      scope: normalized,
      expectedState: 'active',
      nextState,
      updatedAt,
    });
    if (result === 'NOT_FOUND') {
      throw new CredentialVaultError('NOT_FOUND', 'Credential revision was not found.');
    }
    if (result === 'CONFLICT') {
      throw new CredentialVaultError('CONFLICT', 'Credential revision is not active.');
    }
    return metadataOf(result);
  }
}

const metadataOf = (record: StoredCredentialRevision): CredentialMetadata => {
  return {
    credentialId: record.credentialId,
    projectId: record.projectId,
    providerId: record.providerId,
    encryptionVersion: record.encryptionVersion,
    keyVersion: record.keyVersion,
    credentialRevision: record.credentialRevision,
    lifecycleState: record.lifecycleState,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
};

export const credentialMetadata = metadataOf;
