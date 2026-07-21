import canonicalClaimSchema from '../../../packages/contracts/schemas/canonical-claim.v1.schema.json';
import canonicalCommitResultSchema from '../../../packages/contracts/schemas/canonical-commit-result.v1.schema.json';
import canonicalCommittedSchema from '../../../packages/contracts/schemas/canonical-committed.v1.schema.json';
import canonicalSearchResponseSchema from '../../../packages/contracts/schemas/canonical-search-response.v1.schema.json';
import canonicalSnapshotSchema from '../../../packages/contracts/schemas/canonical-snapshot.v1.schema.json';
import getCanonicalClaimSchema from '../../../packages/contracts/schemas/get-canonical-claim.v1.schema.json';
import getCanonicalCommitSchema from '../../../packages/contracts/schemas/get-canonical-commit.v1.schema.json';
import getCanonicalSnapshotSchema from '../../../packages/contracts/schemas/get-canonical-snapshot.v1.schema.json';
import getProjectionReadinessSchema from '../../../packages/contracts/schemas/get-projection-readiness.v1.schema.json';
import listCanonicalHistoryOutputSchema from '../../../packages/contracts/schemas/list-canonical-history-output.v1.schema.json';
import listCanonicalHistorySchema from '../../../packages/contracts/schemas/list-canonical-history.v1.schema.json';
import projectionReadinessSchema from '../../../packages/contracts/schemas/projection-readiness.v1.schema.json';
import projectionReadySchema from '../../../packages/contracts/schemas/projection-ready.v1.schema.json';
import rebuildSearchProjectionSchema from '../../../packages/contracts/schemas/rebuild-search-projection.v1.schema.json';
import searchCanonicalKnowledgeSchema from '../../../packages/contracts/schemas/search-canonical-knowledge.v1.schema.json';
import {
  type CanonicalClaim,
  type CanonicalCommittedPayload,
  type CanonicalCommitResult,
  type CanonicalHistoryEvent,
  type CanonicalSearchResponse,
  type CanonicalSearchResult,
  type CanonicalSnapshot,
  type CommandEnvelope,
  type EventEnvelope,
  type ProjectionReadiness,
  type ProjectionWatermark,
  type QueryEnvelope,
  type SearchProjectionDocument,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { HandlerContext, ShotgunModule } from '../../../packages/module-sdk/src/index.js';

export type ProjectionCommitWrite = {
  readonly document?: SearchProjectionDocument;
  readonly commitId: string;
  readonly operation: CanonicalCommittedPayload['operation'];
  readonly canonicalVersion: number;
  readonly snapshotDigest: string;
  readonly projectedAt: string;
};

export type ProjectionRebuildWrite = {
  readonly documents: readonly SearchProjectionDocument[];
  readonly watermark: ProjectionWatermark;
};

export type SearchProjectionRepositoryPort = {
  applyCommit(projectId: string, write: ProjectionCommitWrite): Promise<void>;
  rebuild(projectId: string, write: ProjectionRebuildWrite): Promise<void>;
  markDegraded(projectId: string, error: string, updatedAt: string): Promise<void>;
  findWatermark(projectId: string): Promise<ProjectionWatermark | undefined>;
  search(
    projectId: string,
    query: string,
    limit: number,
    accessScopes: readonly string[],
  ): Promise<readonly CanonicalSearchResult[]>;
};

export type ProjectionClockPort = { now(): string };

const systemClock: ProjectionClockPort = { now: () => new Date().toISOString() };
const SEARCH_PROJECTION_UPDATE_FAILED = 'SEARCH_PROJECTION_UPDATE_FAILED';

const assertContext = (envelope: CommandEnvelope | EventEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'Search requires complete security context.',
      module: 'stage7.projection-search',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return { projectId: envelope.projectId, security: envelope.security };
};

const canonicalSnapshot = async (context: HandlerContext): Promise<CanonicalSnapshot> =>
  (
    await context.query<Record<string, never>, CanonicalSnapshot>({
      messageType: 'GetCanonicalSnapshot',
      schemaVersion: '1.0.0',
      payload: {},
    })
  ).payload;

const readinessFor = (
  snapshot: CanonicalSnapshot,
  watermark: ProjectionWatermark | undefined,
): ProjectionReadiness => {
  if (!watermark) {
    const ready = snapshot.version === 0;
    return {
      status: ready ? 'READY' : 'STALE',
      projectedCanonicalVersion: 0,
      canonicalVersion: snapshot.version,
      lag: snapshot.version,
      ...(ready ? { projectedSnapshotDigest: snapshot.digest } : {}),
      canonicalSnapshotDigest: snapshot.digest,
      ...(!ready ? { reason: 'Search Projection has not processed the Canonical Commit.' } : {}),
    };
  }
  const matches =
    watermark.canonicalVersion === snapshot.version && watermark.snapshotDigest === snapshot.digest;
  const status = watermark.status === 'DEGRADED' ? 'DEGRADED' : matches ? 'READY' : 'STALE';
  return {
    status,
    projectedCanonicalVersion: watermark.canonicalVersion,
    canonicalVersion: snapshot.version,
    lag: Math.max(0, snapshot.version - watermark.canonicalVersion),
    projectedSnapshotDigest: watermark.snapshotDigest,
    canonicalSnapshotDigest: snapshot.digest,
    ...(watermark.lastCommitId ? { lastCommitId: watermark.lastCommitId } : {}),
    updatedAt: watermark.updatedAt,
    ...(status !== 'READY'
      ? { reason: watermark.lastError ?? 'Search Projection is behind Canonical Knowledge.' }
      : {}),
  };
};

const documentFor = (
  claim: CanonicalClaim,
  commit: CanonicalCommitResult,
  canonicalVersion: number,
  projectedAt: string,
): SearchProjectionDocument => ({
  projectId: claim.projectId,
  claimId: claim.claimId,
  commitId: commit.commitId,
  revisionId: commit.revisionId,
  canonicalVersion,
  claimText: claim.claimText,
  sourceVersionId: claim.sourceVersionId,
  evidenceIds: claim.evidenceIds,
  accessScope: claim.accessScope,
  sensitivity: claim.sensitivity,
  projectedAt,
});

const loadDocument = async (
  context: HandlerContext,
  claimId: string,
  commitId: string,
  canonicalVersion: number,
  projectedAt: string,
): Promise<SearchProjectionDocument> => {
  const claim = (
    await context.query<{ claimId: string }, CanonicalClaim>({
      messageType: 'GetCanonicalClaim',
      schemaVersion: '1.0.0',
      payload: { claimId },
    })
  ).payload;
  const commit = (
    await context.query<{ commitId: string }, CanonicalCommitResult>({
      messageType: 'GetCanonicalCommit',
      schemaVersion: '1.0.0',
      payload: { commitId },
    })
  ).payload;
  return documentFor(claim, commit, canonicalVersion, projectedAt);
};

export const createProjectionSearchModule = (
  repository: SearchProjectionRepositoryPort,
  clock: ProjectionClockPort = systemClock,
): ShotgunModule => ({
  manifest: {
    id: 'stage7.projection-search',
    version: '1.0.0',
    owner: 'Shotgun Cited Search',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' },
        { name: 'SearchCanonicalKnowledge', range: '>=1.0.0 <2.0.0' },
        { name: 'GetProjectionReadiness', range: '>=1.0.0 <2.0.0' },
        { name: 'RebuildSearchProjection', range: '>=1.0.0 <2.0.0' },
        { name: 'ProjectionReady', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['projection.search_documents', 'projection.watermarks'],
      readsViaPorts: [
        'GetCanonicalSnapshot query',
        'GetCanonicalClaim query',
        'GetCanonicalCommit query',
        'ListCanonicalHistory query',
      ],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [{ name: 'RebuildSearchProjection', range: '>=1.0.0 <2.0.0' }],
      events: [{ name: 'CanonicalCommitted', range: '>=1.0.0 <2.0.0' }],
    },
    produces: { events: [{ name: 'ProjectionReady', range: '>=1.0.0 <2.0.0' }] },
    provides: {
      queries: [
        { name: 'SearchCanonicalKnowledge', range: '>=1.0.0 <2.0.0' },
        { name: 'GetProjectionReadiness', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [{ name: 'canonical-search-provider', priority: 100 }],
    },
    requires: { capabilities: ['canonical-knowledge-provider'] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: false },
  },
  contracts: [
    {
      name: 'CanonicalCommitted',
      version: '1.0.0',
      kind: 'event',
      inputSchema: canonicalCommittedSchema,
    },
    {
      name: 'GetCanonicalSnapshot',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getCanonicalSnapshotSchema,
      outputSchema: canonicalSnapshotSchema,
    },
    {
      name: 'GetCanonicalClaim',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getCanonicalClaimSchema,
      outputSchema: canonicalClaimSchema,
    },
    {
      name: 'GetCanonicalCommit',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getCanonicalCommitSchema,
      outputSchema: canonicalCommitResultSchema,
    },
    {
      name: 'ListCanonicalHistory',
      version: '1.0.0',
      kind: 'query',
      inputSchema: listCanonicalHistorySchema,
      outputSchema: listCanonicalHistoryOutputSchema,
    },
    {
      name: 'SearchCanonicalKnowledge',
      version: '1.0.0',
      kind: 'query',
      inputSchema: searchCanonicalKnowledgeSchema,
      outputSchema: canonicalSearchResponseSchema,
    },
    {
      name: 'GetProjectionReadiness',
      version: '1.0.0',
      kind: 'query',
      inputSchema: getProjectionReadinessSchema,
      outputSchema: projectionReadinessSchema,
    },
    {
      name: 'RebuildSearchProjection',
      version: '1.0.0',
      kind: 'command',
      inputSchema: rebuildSearchProjectionSchema,
    },
    {
      name: 'ProjectionReady',
      version: '1.0.0',
      kind: 'event',
      inputSchema: projectionReadySchema,
    },
  ],
  handlers: {
    commands: [
      {
        messageType: 'RebuildSearchProjection',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId } = assertContext(envelope);
          const snapshot = await canonicalSnapshot(context);
          const projectedAt = clock.now();
          const documents = await Promise.all(
            snapshot.claims.map(async (item) => {
              const claim = (
                await context.query<{ claimId: string }, CanonicalClaim>({
                  messageType: 'GetCanonicalClaim',
                  schemaVersion: '1.0.0',
                  payload: { claimId: item.claimId },
                })
              ).payload;
              return loadDocument(
                context,
                claim.claimId,
                claim.createdFromManifestId,
                snapshot.version,
                projectedAt,
              );
            }),
          );
          const history = (
            await context.query<Record<string, never>, { items: readonly CanonicalHistoryEvent[] }>(
              {
                messageType: 'ListCanonicalHistory',
                schemaVersion: '1.0.0',
                payload: {},
              },
            )
          ).payload.items;
          const lastCommitId = history.at(-1)?.commitId;
          try {
            await repository.rebuild(projectId, {
              documents,
              watermark: {
                projectId,
                ...(lastCommitId ? { lastCommitId } : {}),
                canonicalVersion: snapshot.version,
                snapshotDigest: snapshot.digest,
                status: 'READY',
                updatedAt: projectedAt,
              },
            });
            await context.publish({
              messageType: 'ProjectionReady',
              schemaVersion: '1.0.0',
              idempotencyKey: `projection-rebuild:${projectId}:${snapshot.digest}`,
              payload: {
                ...(lastCommitId ? { commitId: lastCommitId } : {}),
                canonicalVersion: snapshot.version,
                snapshotDigest: snapshot.digest,
                status: 'READY',
              },
            });
            return { rebuilt: documents.length, canonicalVersion: snapshot.version };
          } catch (error) {
            await repository.markDegraded(
              projectId,
              SEARCH_PROJECTION_UPDATE_FAILED,
              projectedAt,
            );
            throw error;
          }
        },
      },
    ],
    events: [
      {
        messageType: 'CanonicalCommitted',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId } = assertContext(envelope);
          const payload = envelope.payload as CanonicalCommittedPayload;
          const projectedAt = clock.now();
          try {
            const document = payload.claimId
              ? await loadDocument(
                  context,
                  payload.claimId,
                  payload.commitId,
                  payload.canonicalVersion,
                  projectedAt,
                )
              : undefined;
            await repository.applyCommit(projectId, {
              ...(document ? { document } : {}),
              commitId: payload.commitId,
              operation: payload.operation,
              canonicalVersion: payload.canonicalVersion,
              snapshotDigest: payload.snapshotDigest,
              projectedAt,
            });
          } catch (error) {
            await repository.markDegraded(
              projectId,
              SEARCH_PROJECTION_UPDATE_FAILED,
              projectedAt,
            );
            throw error;
          }
          await context.publish({
            messageType: 'ProjectionReady',
            schemaVersion: '1.0.0',
            idempotencyKey: `projection-ready:${payload.commitId}`,
            payload: {
              commitId: payload.commitId,
              canonicalVersion: payload.canonicalVersion,
              snapshotDigest: payload.snapshotDigest,
              status: 'READY',
            },
          });
        },
      },
    ],
    queries: [
      {
        messageType: 'GetProjectionReadiness',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId } = assertContext(envelope);
          return readinessFor(
            await canonicalSnapshot(context),
            await repository.findWatermark(projectId),
          );
        },
      },
      {
        messageType: 'SearchCanonicalKnowledge',
        version: '1.0.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context): Promise<CanonicalSearchResponse> {
          const { projectId, security } = assertContext(envelope);
          const payload = envelope.payload as { query: string; limit?: number };
          const query = payload.query.trim();
          const readiness = readinessFor(
            await canonicalSnapshot(context),
            await repository.findWatermark(projectId),
          );
          return {
            query,
            items:
              readiness.status === 'READY'
                ? await repository.search(
                    projectId,
                    query,
                    payload.limit ?? 10,
                    security.accessScope,
                  )
                : [],
            readiness,
          };
        },
      },
    ],
  },
});
