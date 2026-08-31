import { FrontendContractError } from '../../contracts/src/index.js';
import {
  decodeGraphConflictOverlayRequestV1,
  decodeGraphDiscoveryOverlayRequestV1,
  decodeGraphEvidenceDetailRequestV1,
  decodeGraphEvidenceDetailResultV1,
  decodeGraphKnowledgeGapOverlayRequestV1,
  decodeGraphNeighborhoodRequestV1,
  decodeGraphNeighborhoodResultV1,
  decodeGraphOverlayResultV1,
  decodeGraphPathDescriptionV1,
  decodeGraphPathDescribeRequestV1,
  decodeGraphPathRequestV1,
  decodeGraphPathResultV1,
  decodeGraphRecursiveImpactOverlayRequestV1,
  decodeGraphRestoreRequestV1,
  decodeGraphRestoreResultV1,
  decodeGraphSnapshotRefreshRequestV1,
  decodeGraphSnapshotRequestV1,
  decodeGraphSnapshotResultV1,
  type GraphConflictOverlayRequestV1,
  type GraphDiscoveryOverlayRequestV1,
  type GraphEvidenceDetailRequestV1,
  type GraphEvidenceDetailResultV1,
  type GraphKnowledgeGapOverlayRequestV1,
  type GraphNeighborhoodRequestV1,
  type GraphNeighborhoodResultV1,
  type GraphOverlayResultV1,
  type GraphPathDescriptionV1,
  type GraphPathDescribeRequestV1,
  type GraphPathRequestV1,
  type GraphPathResultV1,
  type GraphRecursiveImpactOverlayRequestV1,
  type GraphRestoreRequestV1,
  type GraphRestoreResultV1,
  type GraphSnapshotRefreshRequestV1,
  type GraphSnapshotRequestV1,
  type GraphSnapshotResultV1,
} from '../../contracts/src/index.js';
import { decodeProductApiErrorBody } from './decode.js';
import { productFailureApiError, remoteUnclassifiedProductApiFailure } from './errors.js';
import { getSharedCsrfMutationManager, isCsrfFailureResponse } from './csrf-manager.js';

export type FrontendKnowledgeGraphClient = {
  getGraphSnapshot(
    params: GraphSnapshotRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GraphSnapshotResultV1>;
  expandGraphNeighborhood(
    params: GraphNeighborhoodRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GraphNeighborhoodResultV1>;
  findGraphPath(
    params: GraphPathRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GraphPathResultV1>;
  describeGraphPath(
    params: GraphPathDescribeRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GraphPathDescriptionV1>;
  getConflictOverlay(
    params: GraphConflictOverlayRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GraphOverlayResultV1>;
  getDiscoveryOverlay(
    params: GraphDiscoveryOverlayRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GraphOverlayResultV1>;
  getKnowledgeGapOverlay(
    params: GraphKnowledgeGapOverlayRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GraphOverlayResultV1>;
  getRecursiveImpactOverlay(
    params: GraphRecursiveImpactOverlayRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GraphOverlayResultV1>;
  getGraphEvidenceDetail(
    params: GraphEvidenceDetailRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GraphEvidenceDetailResultV1>;
  refreshGraphSnapshot(
    params: GraphSnapshotRefreshRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GraphSnapshotResultV1>;
  restoreGraphDeepLink(
    params: GraphRestoreRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GraphRestoreResultV1>;
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const assertOk = async (response: Response): Promise<unknown> => {
  const body = await readJson(response);
  if (response.ok) return body;
  const failure = decodeProductApiErrorBody(body);
  if (!failure) throw remoteUnclassifiedProductApiFailure(response.status);
  throw productFailureApiError(response.status, failure);
};

const identityMismatch = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

/**
 * Typed FE-P3-S3 graph read client. Same-origin credentials, shared CSRF with a
 * single retry only for REQUEST_ORIGIN_DENIED, strict decoding of every response, `AbortSignal`
 * cancellation and typed failure mapping.
 */
export const createFrontendKnowledgeGraphClient = (
  options: { readonly fetch?: typeof globalThis.fetch } = {},
): FrontendKnowledgeGraphClient => {
  const request = options.fetch ?? globalThis.fetch;
  const csrf = getSharedCsrfMutationManager(request);

  const post = async (path: string, params: unknown, signal?: AbortSignal): Promise<unknown> => {
    const send = async (token: string): Promise<Response> =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        credentials: 'same-origin',
        body: JSON.stringify(params),
        signal,
      });
    const response = await csrf.run((token) => send(token), {
      signal,
      recoverOnResponse: isCsrfFailureResponse,
    });
    return assertOk(response);
  };

  return {
    async getGraphSnapshot(params, requestOptions) {
      return decodeGraphSnapshotResultV1(
        await post(
          '/product-api/frontend/knowledge/graph/snapshot',
          decodeGraphSnapshotRequestV1(params),
          requestOptions?.signal,
        ),
        'result',
      );
    },
    async expandGraphNeighborhood(params, requestOptions) {
      return decodeGraphNeighborhoodResultV1(
        await post(
          '/product-api/frontend/knowledge/graph/neighborhood',
          decodeGraphNeighborhoodRequestV1(params),
          requestOptions?.signal,
        ),
        'result',
      );
    },
    async findGraphPath(params, requestOptions) {
      return decodeGraphPathResultV1(
        await post(
          '/product-api/frontend/knowledge/graph/path',
          decodeGraphPathRequestV1(params),
          requestOptions?.signal,
        ),
        'result',
      );
    },
    async describeGraphPath(params, requestOptions) {
      return decodeGraphPathDescriptionV1(
        await post(
          '/product-api/frontend/knowledge/graph/path/describe',
          decodeGraphPathDescribeRequestV1(params),
          requestOptions?.signal,
        ),
        'result',
      );
    },
    async getConflictOverlay(params, requestOptions) {
      return decodeGraphOverlayResultV1(
        await post(
          '/product-api/frontend/knowledge/graph/overlay/conflict',
          decodeGraphConflictOverlayRequestV1(params),
          requestOptions?.signal,
        ),
        'result',
      );
    },
    async getDiscoveryOverlay(params, requestOptions) {
      const decoded = decodeGraphDiscoveryOverlayRequestV1(params);
      const result = decodeGraphOverlayResultV1(
        await post(
          '/product-api/frontend/knowledge/graph/overlay/discovery',
          decoded,
          requestOptions?.signal,
        ),
        'result',
      );
      const sourceRef = result.identity.sourceRef;
      if (
        result.identity.overlayKind !== 'DISCOVERY' ||
        result.baseSnapshotId !== decoded.baseSnapshotId ||
        result.projectionRevision !== decoded.projectionRevision ||
        (result.health !== 'UNAVAILABLE' &&
          (sourceRef?.kind !== 'DISCOVERY_FINDING' ||
            sourceRef.findingId !== decoded.findingId ||
            sourceRef.findingRevision !== decoded.findingRevision))
      ) {
        identityMismatch('Discovery overlay result does not match the requested identity.');
      }
      return result;
    },
    async getKnowledgeGapOverlay(params, requestOptions) {
      return decodeGraphOverlayResultV1(
        await post(
          '/product-api/frontend/knowledge/graph/overlay/gap',
          decodeGraphKnowledgeGapOverlayRequestV1(params),
          requestOptions?.signal,
        ),
        'result',
      );
    },
    async getRecursiveImpactOverlay(params, requestOptions) {
      return decodeGraphOverlayResultV1(
        await post(
          '/product-api/frontend/knowledge/graph/overlay/impact',
          decodeGraphRecursiveImpactOverlayRequestV1(params),
          requestOptions?.signal,
        ),
        'result',
      );
    },
    async getGraphEvidenceDetail(params, requestOptions) {
      const result = decodeGraphEvidenceDetailResultV1(
        await post(
          '/product-api/frontend/knowledge/graph/evidence',
          decodeGraphEvidenceDetailRequestV1(params),
          requestOptions?.signal,
        ),
        'result',
      );
      if (result.snapshotId !== params.snapshotId) {
        identityMismatch('Evidence detail result does not match the requested snapshot.');
      }
      return result;
    },
    async refreshGraphSnapshot(params, requestOptions) {
      const result = decodeGraphSnapshotResultV1(
        await post(
          '/product-api/frontend/knowledge/graph/snapshot/refresh',
          decodeGraphSnapshotRefreshRequestV1(params),
          requestOptions?.signal,
        ),
        'result',
      );
      if (result.identity.snapshotId === params.snapshotId) {
        identityMismatch('Snapshot refresh must issue a new snapshot identity.');
      }
      return result;
    },
    async restoreGraphDeepLink(params, requestOptions) {
      return decodeGraphRestoreResultV1(
        await post(
          '/product-api/frontend/knowledge/graph/restore',
          decodeGraphRestoreRequestV1(params),
          requestOptions?.signal,
        ),
        'result',
      );
    },
  };
};
