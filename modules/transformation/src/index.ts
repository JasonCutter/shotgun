import documentTransformedSchema from '../../../packages/contracts/schemas/document-transformed.v1.schema.json';
import getDocumentRevisionOutputSchema from '../../../packages/contracts/schemas/get-document-revision-output.v1.schema.json';
import getDocumentRevisionSchema from '../../../packages/contracts/schemas/get-document-revision.v1.schema.json';
import originalAssetStoredSchema from '../../../packages/contracts/schemas/original-asset-stored.v1.schema.json';
import resolveAssetOutputSchema from '../../../packages/contracts/schemas/resolve-asset-output.v1.schema.json';
import resolveAssetSchema from '../../../packages/contracts/schemas/resolve-asset.v1.schema.json';
import {
  type AssetReference,
  type DocumentIR,
  type EventEnvelope,
  type QueryEnvelope,
  type SecurityContext,
  type SourceMap,
  ShotgunError,
  type TextPositionSelector,
  type TextQuoteSelector,
  type TransformationRevision,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type PlainTextTransformationInput = {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly sourceContentHash: string;
  readonly mediaType: 'text/plain' | 'text/markdown';
  readonly text: string;
};

export type PlainTextTransformationOutput = {
  readonly documentIR: DocumentIR;
  readonly sourceMap: SourceMap;
  readonly documentHash: string;
  readonly sourceMapHash: string;
};

export type PlainTextTransformerPort = {
  readonly identity: {
    readonly id: string;
    readonly version: string;
  };
  transform(input: PlainTextTransformationInput): PlainTextTransformationOutput;
};

export type EvidenceLocatorPort = {
  locate(source: string, quote: TextQuoteSelector): TextPositionSelector | undefined;
};

export type SaveTransformationInput = {
  readonly projectId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly sourceContentHash: string;
  readonly transformer: PlainTextTransformerPort['identity'];
  readonly output: PlainTextTransformationOutput;
  readonly accessScope: readonly string[];
  readonly sensitivity: SecurityContext['sensitivity'];
  readonly createdAt: string;
};

export type SavedTransformation = {
  readonly attemptId: string;
  readonly revision: TransformationRevision;
  readonly reusedRevision: boolean;
};

export type TransformationRepositoryPort = {
  save(input: SaveTransformationInput): Promise<SavedTransformation>;
  findBySourceVersion(
    projectId: string,
    sourceVersionId: string,
    transformerId: string,
    transformerVersion: string,
  ): Promise<TransformationRevision | undefined>;
};

type OriginalAssetStoredPayload = {
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly assetReference: AssetReference;
};

type ResolvedAsset = {
  readonly assetReference: AssetReference;
  readonly contentBase64: string;
  readonly text?: string;
};

const assertContext = (envelope: EventEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Transformation access requires complete security context.',
      module: 'stage3.transformation',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return {
    projectId: envelope.projectId,
    security: envelope.security,
  };
};

const assertScope = (
  revision: TransformationRevision,
  scopes: readonly string[],
  correlationId: string,
) => {
  const actual = new Set(scopes);
  if (revision.accessScope.some((scope) => !actual.has(scope))) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'The caller cannot access this Document Revision.',
      module: 'stage3.transformation',
      operation: 'get-document-revision',
      correlationId,
    });
  }
};

export const createTransformationModule = (
  repository: TransformationRepositoryPort,
  transformer: PlainTextTransformerPort,
): ShotgunModule => ({
  manifest: {
    id: 'stage3.transformation',
    version: '1.0.0',
    owner: 'Shotgun Transformation',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'OriginalAssetStored', range: '>=1.0.0 <2.0.0' },
        { name: 'ResolveAsset', range: '>=1.0.0 <2.0.0' },
        { name: 'DocumentTransformed', range: '>=1.0.0 <2.0.0' },
        { name: 'GetDocumentRevision', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['transformation.attempts', 'transformation.revisions'],
      readsViaPorts: ['PlainTextTransformerPort', 'ResolveAsset query'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [],
      events: [{ name: 'OriginalAssetStored', range: '>=1.0.0 <2.0.0' }],
    },
    produces: {
      events: [{ name: 'DocumentTransformed', range: '>=1.0.0 <2.0.0' }],
    },
    provides: {
      queries: [{ name: 'GetDocumentRevision', range: '>=1.0.0 <2.0.0' }],
      capabilities: [
        { name: 'plain-text-transformation', priority: 100 },
        { name: 'document-revision-provider', priority: 100 },
      ],
    },
    requires: { capabilities: ['asset-resolver'] },
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
      name: 'OriginalAssetStored',
      version: '1.0.0',
      kind: 'event',
      inputSchema: originalAssetStoredSchema,
    },
    {
      name: 'ResolveAsset',
      version: '1.0.0',
      kind: 'query',
      inputSchema: resolveAssetSchema,
      outputSchema: resolveAssetOutputSchema,
    },
    {
      name: 'DocumentTransformed',
      version: '1.0.0',
      kind: 'event',
      inputSchema: documentTransformedSchema,
    },
    {
      name: 'GetDocumentRevision',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getDocumentRevisionSchema,
      outputSchema: getDocumentRevisionOutputSchema,
    },
  ],
  handlers: {
    commands: [],
    events: [
      {
        messageType: 'OriginalAssetStored',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const payload = envelope.payload as OriginalAssetStoredPayload;
          const { projectId, security } = assertContext(envelope);
          if (
            !['text/plain', 'text/markdown'].includes(payload.assetReference.mediaType) ||
            payload.assetReference.versionId !== payload.sourceVersionId
          ) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: 'Stage 3 requires a matching plain-text SourceVersion Asset Reference.',
              module: 'stage3.transformation',
              operation: 'transform-original-asset',
              correlationId: envelope.correlationId,
            });
          }
          const resolved = (
            await context.query<{ assetReference: AssetReference }, ResolvedAsset>({
              messageType: 'ResolveAsset',
              schemaVersion: '1.0.0',
              payload: { assetReference: payload.assetReference },
            })
          ).payload;
          if (
            resolved.assetReference.contentHash !== payload.assetReference.contentHash ||
            resolved.text === undefined
          ) {
            throw new ShotgunError({
              code: 'STALE_VERSION',
              safeMessage: 'The resolved original does not match the immutable SourceVersion.',
              module: 'stage3.transformation',
              operation: 'resolve-original',
              correlationId: envelope.correlationId,
            });
          }
          const output = transformer.transform({
            sourceId: payload.sourceId,
            sourceVersionId: payload.sourceVersionId,
            sourceContentHash: payload.assetReference.contentHash,
            mediaType: payload.assetReference.mediaType as 'text/plain' | 'text/markdown',
            text: resolved.text,
          });
          const saved = await repository.save({
            projectId,
            sourceId: payload.sourceId,
            sourceVersionId: payload.sourceVersionId,
            sourceContentHash: payload.assetReference.contentHash,
            transformer: transformer.identity,
            output,
            accessScope: security.accessScope,
            sensitivity: security.sensitivity,
            createdAt: envelope.createdAt,
          });
          await context.publish({
            messageType: 'DocumentTransformed',
            schemaVersion: '1.0.0',
            idempotencyKey: `document-transformed:${projectId}:${saved.revision.revisionId}`,
            payload: {
              attemptId: saved.attemptId,
              revisionId: saved.revision.revisionId,
              sourceId: saved.revision.sourceId,
              sourceVersionId: saved.revision.sourceVersionId,
              transformerId: saved.revision.transformer.id,
              transformerVersion: saved.revision.transformer.version,
              documentHash: saved.revision.documentHash,
              sourceMapHash: saved.revision.sourceMapHash,
              reusedRevision: saved.reusedRevision,
            },
          });
        },
      },
    ],
    queries: [
      {
        messageType: 'GetDocumentRevision',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope) {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { readonly sourceVersionId: string };
          const revision = await repository.findBySourceVersion(
            projectId,
            payload.sourceVersionId,
            transformer.identity.id,
            transformer.identity.version,
          );
          if (!revision) {
            throw new ShotgunError({
              code: 'NOT_FOUND',
              safeMessage: 'The Document Revision was not found.',
              module: 'stage3.transformation',
              operation: 'get-document-revision',
              correlationId: envelope.correlationId,
            });
          }
          assertScope(revision, security.accessScope, envelope.correlationId);
          return revision;
        },
      },
    ],
  },
});
