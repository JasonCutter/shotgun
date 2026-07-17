import { createHash } from 'node:crypto';

import getIntakeResultOutputSchema from '../../../packages/contracts/schemas/get-intake-result-output.v1.schema.json';
import getIntakeResultSchema from '../../../packages/contracts/schemas/get-intake-result.v1.schema.json';
import intakeAcceptedSchema from '../../../packages/contracts/schemas/intake-accepted.v1.schema.json';
import originalAssetStoredSchema from '../../../packages/contracts/schemas/original-asset-stored.v1.schema.json';
import resolveAssetOutputSchema from '../../../packages/contracts/schemas/resolve-asset-output.v1.schema.json';
import resolveAssetSchema from '../../../packages/contracts/schemas/resolve-asset.v1.schema.json';
import {
  type AssetReference,
  type DocumentIR,
  type EventEnvelope,
  type QueryEnvelope,
  type SecurityContext,
  ShotgunError,
  stableJson,
  validateAssetReference,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

type MaterialKind = 'plain_text' | 'document' | 'image';
type SupportedMediaType = DocumentIR['mediaType'];

export type StoreOriginalAssetInput = {
  readonly submissionId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedSourceId?: string;
  readonly channel: 'direct_text' | 'file_upload';
  readonly materialKind: MaterialKind;
  readonly mediaType: SupportedMediaType;
  readonly originalFileName?: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
};

export type StoredIntakeResult = {
  readonly submissionId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly versionNumber: number;
  readonly channel: 'direct_text' | 'file_upload';
  readonly materialKind: MaterialKind;
  readonly originalFileName?: string;
  readonly assetReference: AssetReference;
  readonly storageKey: string;
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly assetReused: boolean;
  readonly versionCreated: boolean;
};

export type OriginalAssetRepositoryPort = {
  assertSource(projectId: string, sourceId: string): Promise<void>;
  store(input: StoreOriginalAssetInput): Promise<StoredIntakeResult>;
  findBySubmission(
    projectId: string,
    submissionId: string,
  ): Promise<StoredIntakeResult | undefined>;
  findByVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<StoredIntakeResult | undefined>;
};

export type AssetStoragePort = {
  put(contentHash: string, bytes: Uint8Array): Promise<string>;
  read(storageKey: string): Promise<Uint8Array>;
};

type IntakeAcceptedPayload = {
  readonly submissionId: string;
  readonly sourceId?: string;
  readonly channel: 'direct_text' | 'file_upload';
  readonly materialKind: MaterialKind;
  readonly mediaType: SupportedMediaType;
  readonly originalFileName?: string;
  readonly contentBase64: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
};

type GetIntakeResultPayload = {
  readonly submissionId: string;
};

type ResolveAssetPayload = {
  readonly assetReference: AssetReference;
};

const sha256 = (bytes: Uint8Array): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const assertEnvelopeContext = (
  envelope: EventEnvelope | QueryEnvelope,
): {
  readonly projectId: string;
  readonly actorId: string;
  readonly security: SecurityContext;
} => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Original Asset access requires complete security context.',
      module: 'stage2.original-asset',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return {
    projectId: envelope.projectId,
    actorId: envelope.actor.id,
    security: envelope.security,
  };
};

const assertStoredScope = (
  result: StoredIntakeResult,
  actualScopes: readonly string[],
  correlationId: string,
): void => {
  const actual = new Set(actualScopes);
  const missing = result.assetReference.accessScope.filter((scope) => !actual.has(scope));
  if (missing.length > 0) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'The caller does not have access to this Asset Reference.',
      module: 'stage2.original-asset',
      operation: 'resolve-asset-scope',
      correlationId,
    });
  }
};

const publicResult = (result: StoredIntakeResult) => ({
  submissionId: result.submissionId,
  sourceId: result.sourceId,
  sourceVersionId: result.sourceVersionId,
  versionNumber: result.versionNumber,
  channel: result.channel,
  materialKind: result.materialKind,
  originalFileName: result.originalFileName,
  assetReference: result.assetReference,
  assetReused: result.assetReused,
  versionCreated: result.versionCreated,
});

export const createOriginalAssetModule = (
  repository: OriginalAssetRepositoryPort,
  storage: AssetStoragePort,
): ShotgunModule => ({
  manifest: {
    id: 'stage2.original-asset',
    version: '1.0.0',
    owner: 'Shotgun Original Asset',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'IntakeAccepted', range: '>=1.0.0 <2.0.0' },
        { name: 'OriginalAssetStored', range: '>=1.0.0 <2.0.0' },
        { name: 'GetIntakeResult', range: '>=1.0.0 <2.0.0' },
        { name: 'ResolveAsset', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process'] },
    dataOwnership: {
      owns: [
        'asset.sources',
        'asset.source_versions',
        'asset.original_assets',
        'asset.storage_receipts',
      ],
      readsViaPorts: ['AssetStoragePort'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [{ name: 'IntakeAccepted', range: '>=1.0.0 <2.0.0' }],
    },
    produces: {
      events: [{ name: 'OriginalAssetStored', range: '>=1.0.0 <2.0.0' }],
    },
    provides: {
      queries: [
        { name: 'GetIntakeResult', range: '>=1.0.0 <2.0.0' },
        { name: 'ResolveAsset', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [
        { name: 'original-asset-store', priority: 100 },
        { name: 'asset-resolver', priority: 100 },
      ],
    },
    requires: { capabilities: [] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: {
      canWriteCanonical: false,
      canExecuteExternalAction: false,
    },
  },
  contracts: [
    {
      name: 'IntakeAccepted',
      version: '1.0.0',
      kind: 'event',
      inputSchema: intakeAcceptedSchema,
    },
    {
      name: 'OriginalAssetStored',
      version: '1.0.0',
      kind: 'event',
      inputSchema: originalAssetStoredSchema,
    },
    {
      name: 'GetIntakeResult',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getIntakeResultSchema,
      outputSchema: getIntakeResultOutputSchema,
    },
    {
      name: 'ResolveAsset',
      version: '1.0.0',
      kind: 'query',
      inputSchema: resolveAssetSchema,
      outputSchema: resolveAssetOutputSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [
      {
        messageType: 'IntakeAccepted',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const payload = envelope.payload as IntakeAcceptedPayload;
          const { projectId, actorId, security } = assertEnvelopeContext(envelope);
          const bytes = Buffer.from(payload.contentBase64, 'base64');
          if (bytes.byteLength !== payload.sizeBytes || sha256(bytes) !== payload.contentHash) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: 'Intake content does not match its declared size and hash.',
              module: 'stage2.original-asset',
              operation: 'verify-intake-content',
              correlationId: envelope.correlationId,
            });
          }

          if (payload.sourceId) {
            await repository.assertSource(projectId, payload.sourceId);
          }
          const storageKey = await storage.put(payload.contentHash, bytes);
          const result = await repository.store({
            submissionId: payload.submissionId,
            projectId,
            actorId,
            requestedSourceId: payload.sourceId,
            channel: payload.channel,
            materialKind: payload.materialKind,
            mediaType: payload.mediaType,
            originalFileName: payload.originalFileName,
            contentHash: payload.contentHash,
            sizeBytes: payload.sizeBytes,
            storageKey,
            accessScope: security.accessScope,
            sensitivity: security.sensitivity,
            createdAt: payload.createdAt,
          });

          await context.publish({
            messageType: 'OriginalAssetStored',
            schemaVersion: '1.0.0',
            idempotencyKey: `original-asset-stored:${projectId}:${payload.submissionId}`,
            payload: {
              submissionId: result.submissionId,
              sourceId: result.sourceId,
              sourceVersionId: result.sourceVersionId,
              versionNumber: result.versionNumber,
              assetReference: result.assetReference,
              assetReused: result.assetReused,
              versionCreated: result.versionCreated,
            },
          });
        },
      },
    ],
    queries: [
      {
        messageType: 'GetIntakeResult',
        version: '1.0.0',
        async handle(envelope) {
          const payload = envelope.payload as GetIntakeResultPayload;
          const { projectId, security } = assertEnvelopeContext(envelope);
          const result = await repository.findBySubmission(projectId, payload.submissionId);
          if (!result) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: `Intake submission '${payload.submissionId}' was not found.`,
              module: 'stage2.original-asset',
              operation: 'get-intake-result',
              correlationId: envelope.correlationId,
            });
          }
          assertStoredScope(result, security.accessScope, envelope.correlationId);
          return publicResult(result);
        },
      },
      {
        messageType: 'ResolveAsset',
        version: '1.0.0',
        async handle(envelope) {
          const payload = envelope.payload as ResolveAssetPayload;
          validateAssetReference(payload.assetReference);
          const { projectId, security } = assertEnvelopeContext(envelope);
          const result = await repository.findByVersion(
            projectId,
            payload.assetReference.versionId,
          );
          if (!result) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Asset Reference was not found in this project.',
              module: 'stage2.original-asset',
              operation: 'resolve-asset',
              correlationId: envelope.correlationId,
            });
          }
          assertStoredScope(result, security.accessScope, envelope.correlationId);
          if (stableJson(result.assetReference) !== stableJson(payload.assetReference)) {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage:
                'The supplied Asset Reference does not match the stored immutable version.',
              module: 'stage2.original-asset',
              operation: 'validate-asset-reference',
              correlationId: envelope.correlationId,
            });
          }

          const bytes = await storage.read(result.storageKey);
          if (
            bytes.byteLength !== result.assetReference.sizeBytes ||
            sha256(bytes) !== result.assetReference.contentHash
          ) {
            throw new ShotgunError({
              code: 'STALE_VERSION',
              safeMessage: 'The stored original failed its immutable hash verification.',
              module: 'stage2.original-asset',
              operation: 'verify-stored-original',
              correlationId: envelope.correlationId,
            });
          }
          const isText = result.assetReference.mediaType.startsWith('text/');
          return {
            assetReference: result.assetReference,
            contentBase64: Buffer.from(bytes).toString('base64'),
            ...(isText ? { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) } : {}),
          };
        },
      },
    ],
  },
});
