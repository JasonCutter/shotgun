import {
  FrontendContractError,
  decodeListDiscoveryFindingsRequestV1,
  decodeListDiscoveryFindingsResultV1,
  decodeReadDiscoveryFindingRequestV1,
  decodeReadDiscoveryFindingResultV1,
  type DiscoveryProductFindingDetailV1,
  type DiscoveryProductFindingSummaryV1,
  type ListDiscoveryFindingsRequestV1,
  type ListDiscoveryFindingsResultV1,
  type ReadDiscoveryFindingRequestV1,
  type ReadDiscoveryFindingResultV1,
} from '../../contracts/src/index.js';
import { decodeProductApiErrorBody } from './decode.js';
import { productFailureApiError, remoteUnclassifiedProductApiFailure } from './errors.js';
import { getSharedCsrfMutationManager, isCsrfFailureResponse } from './csrf-manager.js';

/** AKP-6 WP1 — strict, same-origin Discovery Product read client. */
export type FrontendDiscoveryClient = {
  listDiscoveryFindings(
    request: ListDiscoveryFindingsRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ListDiscoveryFindingsResultV1>;
  readDiscoveryFinding(
    request: ReadDiscoveryFindingRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadDiscoveryFindingResultV1>;
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

const resultBody = (body: unknown): unknown => {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('result' in body)) {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      'Discovery Product response is missing result.',
    );
  }
  return (body as { readonly result: unknown }).result;
};

const identityMismatch = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

export const createFrontendDiscoveryClient = (
  options: { readonly fetch?: typeof globalThis.fetch } = {},
): FrontendDiscoveryClient => {
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
    return resultBody(await assertOk(response));
  };

  return {
    async listDiscoveryFindings(params, requestOptions) {
      const decodedRequest = decodeListDiscoveryFindingsRequestV1(params);
      return decodeListDiscoveryFindingsResultV1(
        await post(
          '/product-api/frontend/knowledge/discoveries/list',
          decodedRequest,
          requestOptions?.signal,
        ),
      );
    },
    async readDiscoveryFinding(params, requestOptions) {
      const decodedRequest = decodeReadDiscoveryFindingRequestV1(params);
      const result = decodeReadDiscoveryFindingResultV1(
        await post(
          '/product-api/frontend/knowledge/discoveries/read',
          decodedRequest,
          requestOptions?.signal,
        ),
      );
      if (
        result.finding.findingId !== decodedRequest.findingId ||
        result.finding.findingRevision !== decodedRequest.findingRevision ||
        result.finding.projectId !== result.projectId
      ) {
        identityMismatch('Discovery Product detail does not match the requested identity.');
      }
      return result;
    },
  };
};

export type {
  DiscoveryProductFindingDetailV1,
  DiscoveryProductFindingSummaryV1,
  ListDiscoveryFindingsRequestV1,
  ListDiscoveryFindingsResultV1,
  ReadDiscoveryFindingRequestV1,
  ReadDiscoveryFindingResultV1,
};
