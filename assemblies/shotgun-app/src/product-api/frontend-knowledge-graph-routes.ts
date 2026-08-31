import type { FastifyInstance } from 'fastify';

import type { SecurityHeaders } from '../server.js';
import {
  FrontendContractError,
  ShotgunError,
  decodeGraphConflictOverlayRequestV1,
  decodeGraphDiscoveryOverlayRequestV1,
  decodeGraphEvidenceDetailRequestV1,
  decodeGraphKnowledgeGapOverlayRequestV1,
  decodeGraphNeighborhoodRequestV1,
  decodeGraphPathDescribeRequestV1,
  decodeGraphPathRequestV1,
  decodeGraphRecursiveImpactOverlayRequestV1,
  decodeGraphRestoreRequestV1,
  decodeGraphSnapshotRefreshRequestV1,
  decodeGraphSnapshotRequestV1,
  type ErrorCode,
} from '../../../../packages/contracts/src/index.js';
import type { GraphReadDomain } from '../../../../modules/frontend-knowledge-graph/src/index.js';
import type { GraphReadScopeV1 } from '../../../../modules/frontend-knowledge-graph/src/index.js';

export type GraphScopeResolver = (headers: SecurityHeaders) => Promise<GraphReadScopeV1>;

const toGraphError = (error: unknown, operation: string): never => {
  if (error instanceof ShotgunError) throw error;
  if (error instanceof FrontendContractError) {
    throw new ShotgunError({
      code: error.code as ErrorCode,
      safeMessage: error.message,
      module: 'frontend-knowledge-graph-api',
      operation,
    });
  }
  throw new ShotgunError({
    code: 'INTERNAL_UNCLASSIFIED',
    safeMessage: 'Graph read failed.',
    module: 'frontend-knowledge-graph-api',
    operation,
    cause: error,
  });
};

const reply = async <T>(action: () => Promise<T>): Promise<T> => {
  try {
    return await action();
  } catch (error) {
    throw toGraphError(error, 'graph-read');
  }
};

export function registerFrontendKnowledgeGraphRoutes(
  server: FastifyInstance,
  domain: GraphReadDomain,
  resolveScope: GraphScopeResolver,
): void {
  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/graph/snapshot',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const decoded = decodeGraphSnapshotRequestV1(request.body);
      return reply(() => domain.snapshot(scope, decoded));
    },
  );

  // Discovery deep links carry only the Finding identity. The server resolves
  // the exact Finding revision and derives authorized graph roots before the
  // ordinary snapshot contract is evaluated; browser-supplied endpoint refs
  // never select the focused base graph.
  server.post<{
    Body: unknown;
    Headers: SecurityHeaders;
    Params: { readonly findingId: string; readonly findingRevision: string };
  }>(
    '/product-api/frontend/knowledge/graph/snapshot/discovery/:findingId/:findingRevision',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const findingId = request.params.findingId.trim();
      const revisionText = request.params.findingRevision;
      if (!findingId || !/^[1-9]\d*$/u.test(revisionText)) {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          'Discovery snapshot Finding identity is invalid',
        );
      }
      const findingRevision = Number(revisionText);
      if (!Number.isSafeInteger(findingRevision) || findingRevision < 1) {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          'Discovery snapshot Finding revision is invalid',
        );
      }
      const decoded = decodeGraphSnapshotRequestV1(request.body);
      return reply(() => domain.discoverySnapshot(scope, decoded, findingId, findingRevision));
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/graph/neighborhood',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const decoded = decodeGraphNeighborhoodRequestV1(request.body);
      return reply(() => domain.neighborhood(scope, decoded));
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/graph/path',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const decoded = decodeGraphPathRequestV1(request.body);
      return reply(() => domain.path(scope, decoded));
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/graph/path/describe',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const decoded = decodeGraphPathDescribeRequestV1(request.body);
      return reply(() => domain.pathDescription(scope, decoded));
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/graph/overlay/conflict',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const decoded = decodeGraphConflictOverlayRequestV1(request.body);
      return reply(() => domain.conflictOverlay(scope, decoded));
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/graph/overlay/gap',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const decoded = decodeGraphKnowledgeGapOverlayRequestV1(request.body);
      return reply(() => domain.gapOverlay(scope, decoded));
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/graph/overlay/impact',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const decoded = decodeGraphRecursiveImpactOverlayRequestV1(request.body);
      return reply(() => domain.impactOverlay(scope, decoded));
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/graph/overlay/discovery',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const decoded = decodeGraphDiscoveryOverlayRequestV1(request.body);
      return reply(() => domain.discoveryOverlay(scope, decoded));
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/graph/evidence',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const decoded = decodeGraphEvidenceDetailRequestV1(request.body);
      return reply(() => domain.evidenceDetail(scope, decoded));
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/graph/snapshot/refresh',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const decoded = decodeGraphSnapshotRefreshRequestV1(request.body);
      return reply(() => domain.refresh(scope, decoded));
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/graph/restore',
    async (request) => {
      const scope = await resolveScope(request.headers);
      const decoded = decodeGraphRestoreRequestV1(request.body);
      return reply(() => domain.restore(scope, decoded));
    },
  );
}
