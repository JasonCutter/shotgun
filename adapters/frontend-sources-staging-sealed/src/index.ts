import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import type { AssetStoragePort } from '../../../modules/original-asset/src/index.js';
import type {
  SecureUrlAcquisitionCoordinator,
  UrlAcquisitionLimits,
  UrlAcquisitionReceipt,
} from '../../../modules/url-acquisition/src/index.js';
import {
  ShotgunError,
  SOURCES_SCHEMA_VERSION,
  type SourcesStagingInputKind,
  type SourcesStagingReceipt,
} from '../../../packages/contracts/src/index.js';
import type {
  ResolvedSourcesStagingArtifact,
  SourcesStagingServicePort,
} from '../../../modules/frontend-sources-write/src/product-service.js';
import type { SourcesUrlSuccessProvenance } from '../../../modules/frontend-sources-write/src/index.js';

export const DEFAULT_SOURCES_URL_LIMITS: UrlAcquisitionLimits = {
  maxRedirects: 5,
  connectTimeoutMs: 5_000,
  headerTimeoutMs: 10_000,
  bodyTimeoutMs: 10_000,
  totalTimeoutMs: 30_000,
  maxCompressedBytes: 1_048_576,
  maxDecompressedBytes: 1_048_576,
};

const MAX_BYTES = 1_048_576;
const TOKEN_PREFIX = 'sources-stage-v1.';
const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const fail = (
  code: 'VALIDATION_ERROR' | 'POLICY_DENIED' | 'RETENTION_EXPIRED',
  message: string,
): never => {
  throw new ShotgunError({
    code,
    safeMessage: message,
    module: 'frontend-sources-staging-sealed',
    operation: 'sealed-staging-reference',
  });
};

const bounded = (value: string, maximum: number, label: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || value.length > maximum) {
    return fail('VALIDATION_ERROR', `${label} is invalid.`);
  }
  return value;
};

const toUrlProvenance = (
  receipt: UrlAcquisitionReceipt,
  now: string,
  limits: UrlAcquisitionLimits,
): SourcesUrlSuccessProvenance => ({
  normalizedRequestedUrl: receipt.normalizedRequestedUrl,
  redactedRequestedUrl: receipt.redactedRequestedUrl,
  redactedFinalUrl: receipt.redactedFinalUrl,
  redirectChainDigest: receipt.redirectChainDigest,
  redirectObservations: receipt.redirectObservations,
  dnsObservations: receipt.dnsObservations,
  responseStatus: receipt.responseStatus,
  responseContentType: receipt.responseContentType,
  responseContentLength: receipt.responseContentLength,
  compressedBytes: receipt.compressedBytes,
  decompressedBytes: receipt.decompressedBytes,
  responseMetadata: receipt.responseMetadata,
  retentionClass: 'sources-staging-30d',
  retentionExpiresAt: new Date(Date.parse(now) + 30 * 24 * 60 * 60 * 1_000).toISOString(),
  retrievedAt: now,
  limits,
});

const isArtifact = (value: unknown): value is ResolvedSourcesStagingArtifact => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['draftId'] === 'string' &&
    typeof candidate['itemId'] === 'string' &&
    typeof candidate['projectId'] === 'string' &&
    typeof candidate['principalId'] === 'string' &&
    ['DIRECT_TEXT', 'FILE', 'URL'].includes(String(candidate['kind'])) &&
    typeof candidate['label'] === 'string' &&
    ['direct_text', 'file_upload', 'url_acquisition'].includes(String(candidate['channel'])) &&
    ['text/plain', 'text/markdown'].includes(String(candidate['mediaType'])) &&
    typeof candidate['contentHash'] === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(candidate['contentHash']) &&
    Number.isInteger(candidate['sizeBytes']) &&
    Number(candidate['sizeBytes']) > 0 &&
    Number(candidate['sizeBytes']) <= MAX_BYTES &&
    typeof candidate['storageKey'] === 'string' &&
    typeof candidate['issuedAt'] === 'string' &&
    !Number.isNaN(Date.parse(candidate['issuedAt'])) &&
    typeof candidate['expiresAt'] === 'string' &&
    !Number.isNaN(Date.parse(candidate['expiresAt']))
  );
};

export class SealedSourcesStagingService implements SourcesStagingServicePort {
  private readonly key: Buffer;

  constructor(
    private readonly storage: AssetStoragePort,
    secret: string,
    private readonly urlAcquisition?: SecureUrlAcquisitionCoordinator,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (secret.trim().length < 32) {
      throw new Error('SOURCES_STAGING_SECRET must contain at least 32 characters.');
    }
    this.key = createHash('sha256').update(secret).digest();
  }

  async stageBytes(input: {
    readonly draftId: string;
    readonly itemId: string;
    readonly projectId: string;
    readonly principalId: string;
    readonly kind: 'DIRECT_TEXT' | 'FILE';
    readonly label: string;
    readonly mediaType: 'text/plain' | 'text/markdown';
    readonly fileName?: string;
    readonly bytes: Uint8Array;
  }): Promise<SourcesStagingReceipt> {
    this.assertCommon(input);
    if (input.bytes.byteLength <= 0 || input.bytes.byteLength > MAX_BYTES) {
      return fail('VALIDATION_ERROR', 'Sources staging accepts between 1 byte and one MiB.');
    }
    if (input.kind === 'DIRECT_TEXT' && input.mediaType !== 'text/plain') {
      return fail('VALIDATION_ERROR', 'Direct Text staging requires text/plain.');
    }
    if (input.kind === 'FILE' && input.fileName === undefined) {
      return fail('VALIDATION_ERROR', 'File staging requires a filename.');
    }
    const contentHash = sha256(input.bytes);
    const storageKey = await this.storage.put(contentHash, input.bytes);
    const issuedAt = this.now().toISOString();
    const expiresAt = new Date(Date.parse(issuedAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
    const artifact: ResolvedSourcesStagingArtifact = {
      draftId: input.draftId,
      itemId: input.itemId,
      projectId: input.projectId,
      principalId: input.principalId,
      kind: input.kind,
      label: input.label,
      channel: input.kind === 'DIRECT_TEXT' ? 'direct_text' : 'file_upload',
      mediaType: input.mediaType,
      contentHash,
      sizeBytes: input.bytes.byteLength,
      storageKey,
      ...(input.fileName === undefined ? {} : { fileName: input.fileName }),
      issuedAt,
      expiresAt,
    };
    return this.receipt(artifact);
  }

  async stageUrl(input: {
    readonly draftId: string;
    readonly itemId: string;
    readonly projectId: string;
    readonly principalId: string;
    readonly label: string;
    readonly requestedUrl: string;
  }): Promise<SourcesStagingReceipt> {
    this.assertCommon(input);
    if (!this.urlAcquisition) {
      throw new ShotgunError({
        code: 'CAPABILITY_DENIED',
        safeMessage: 'Production URL acquisition is not configured.',
        module: 'frontend-sources-staging-sealed',
        operation: 'stage-url',
      });
    }
    const limits = DEFAULT_SOURCES_URL_LIMITS;
    const acquired = await this.urlAcquisition.acquire({
      requestedUrl: bounded(input.requestedUrl, 8_192, 'requestedUrl'),
      limits,
    });
    const storageKey = await this.storage.put(acquired.contentHash, acquired.body);
    const issuedAt = this.now().toISOString();
    const expiresAt = new Date(Date.parse(issuedAt) + 30 * 24 * 60 * 60 * 1_000).toISOString();
    const artifact: ResolvedSourcesStagingArtifact = {
      draftId: input.draftId,
      itemId: input.itemId,
      projectId: input.projectId,
      principalId: input.principalId,
      kind: 'URL',
      label: input.label,
      channel: 'url_acquisition',
      mediaType: acquired.responseContentType,
      contentHash: acquired.contentHash,
      sizeBytes: acquired.body.byteLength,
      storageKey,
      redactedRequestedUrl: acquired.redactedRequestedUrl,
      urlProvenance: toUrlProvenance(acquired, issuedAt, limits),
      issuedAt,
      expiresAt,
    };
    return this.receipt(artifact);
  }

  async resolve(input: {
    readonly stagingReference: string;
    readonly draftId: string;
    readonly itemId: string;
    readonly projectId: string;
    readonly principalId: string;
    readonly kind: SourcesStagingInputKind;
  }): Promise<ResolvedSourcesStagingArtifact> {
    const artifact = this.open(input.stagingReference);
    if (
      artifact.draftId !== input.draftId ||
      artifact.itemId !== input.itemId ||
      artifact.projectId !== input.projectId ||
      artifact.principalId !== input.principalId ||
      artifact.kind !== input.kind
    ) {
      return fail(
        'POLICY_DENIED',
        'The Sources staging reference does not match this request context.',
      );
    }
    if (Date.parse(artifact.expiresAt) <= this.now().getTime()) {
      return fail('RETENTION_EXPIRED', 'The Sources staging reference has expired.');
    }
    return { ...artifact, stagingReference: input.stagingReference };
  }

  private assertCommon(input: {
    readonly draftId: string;
    readonly itemId: string;
    readonly projectId: string;
    readonly principalId: string;
    readonly label: string;
  }): void {
    bounded(input.draftId, 512, 'draftId');
    bounded(input.itemId, 200, 'itemId');
    bounded(input.projectId, 512, 'projectId');
    bounded(input.principalId, 512, 'principalId');
    bounded(input.label, 500, 'label');
  }

  private receipt(artifact: ResolvedSourcesStagingArtifact): SourcesStagingReceipt {
    return {
      schemaVersion: SOURCES_SCHEMA_VERSION,
      draftId: artifact.draftId,
      itemId: artifact.itemId,
      kind: artifact.kind,
      label: artifact.label,
      stagingReference: this.seal(artifact),
      mediaType: artifact.mediaType,
      sizeBytes: artifact.sizeBytes,
      contentHash: artifact.contentHash,
      ...(artifact.fileName === undefined ? {} : { fileName: artifact.fileName }),
      ...(artifact.redactedRequestedUrl === undefined
        ? {}
        : { redactedRequestedUrl: artifact.redactedRequestedUrl }),
      expiresAt: artifact.expiresAt,
    };
  }

  private seal(artifact: ResolvedSourcesStagingArtifact): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(TOKEN_PREFIX, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(artifact), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${TOKEN_PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
  }

  private open(reference: string): ResolvedSourcesStagingArtifact {
    if (!reference.startsWith(TOKEN_PREFIX)) {
      return fail('POLICY_DENIED', 'The Sources staging reference is invalid.');
    }
    const encoded = reference.slice(TOKEN_PREFIX.length);
    const packed = Buffer.from(encoded, 'base64url');
    if (packed.byteLength < 29 || packed.toString('base64url') !== encoded) {
      return fail('POLICY_DENIED', 'The Sources staging reference is invalid.');
    }
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAAD(Buffer.from(TOKEN_PREFIX, 'utf8'));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const parsed: unknown = JSON.parse(plaintext.toString('utf8'));
      if (!isArtifact(parsed)) {
        return fail('POLICY_DENIED', 'The Sources staging reference payload is invalid.');
      }
      return parsed;
    } catch {
      return fail('POLICY_DENIED', 'The Sources staging reference could not be authenticated.');
    }
  }
}
