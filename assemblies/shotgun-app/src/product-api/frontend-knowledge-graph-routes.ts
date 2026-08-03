import type { FastifyInstance } from 'fastify';

import type { SecurityHeaders } from '../server.js';
import {
  FrontendContractError,
  ShotgunError,
  decodeGraphConflictOverlayRequestV1,
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

export type GraphScopeResolver = (
  headers: SecurityHeaders,
) => Promise<GraphReadScopeV1>;

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
