import {
  FrontendContractError,
  decodeListDiscoveryFindingsRequestV1,
  decodeListDiscoveryFindingsResultV1,
  decodeReadDiscoveryFindingRequestV1,
  decodeReadDiscoveryFindingResultV1,
  decodeDiscoveryDismissFindingCommandRequestV1,
  decodeDiscoveryFeedbackProductCommandRequestV1,
  decodeDiscoveryFeedbackProductStateRequestV1,
  decodeDiscoveryFeedbackProductStateV1,
  decodeAnyFrontendCommandOutcomeView,
  FRONTEND_DISCOVERY_COMMAND_TYPES,
  type AnyFrontendCommandOutcomeView,
  type DiscoveryDismissFindingCommandRequestV1,
  type DiscoveryFeedbackProductCommandRequestV1,
  type DiscoveryFeedbackProductStateRequestV1,
  type DiscoveryFeedbackProductStateV1,
  type DiscoveryProductFindingDetailV1,
  type DiscoveryProductFindingSummaryV1,
  type ListDiscoveryFindingsRequestV1,
  type ListDiscoveryFindingsResultV1,
  type ReadDiscoveryFindingRequestV1,
  type ReadDiscoveryFindingResultV1,
} from '../../contracts/src/index.js';
import { decodeProductApiErrorBody } from './decode.js';
import {
  ShotgunApiError,
  outcomeIndeterminateApiError,
  productFailureApiError,
  remoteUnclassifiedProductApiFailure,
} from './errors.js';
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
  dismissDiscoveryFinding(
    request: DiscoveryDismissFindingCommandRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ReadDiscoveryFindingResultV1>;
  submitDiscoveryFeedback(
    request: DiscoveryFeedbackProductCommandRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<{
    readonly state: DiscoveryFeedbackProductStateV1;
    readonly outcome: AnyFrontendCommandOutcomeView;
  }>;
  readDiscoveryFeedbackState(
    request: DiscoveryFeedbackProductStateRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<DiscoveryFeedbackProductStateV1>;
  resolveDiscoveryFeedbackCommand(
    clientRequestId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AnyFrontendCommandOutcomeView>;
  resolveDiscoveryDismissCommand(
    clientRequestId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AnyFrontendCommandOutcomeView>;
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
  const postEnvelope = async (
    path: string,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> => {
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
    const body = await assertOk(response);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new FrontendContractError(
        'UNSUPPORTED_SCHEMA',
        'Discovery Product response is invalid.',
      );
    }
    return body as Record<string, unknown>;
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
    async dismissDiscoveryFinding(params, requestOptions) {
      const decodedRequest = decodeDiscoveryDismissFindingCommandRequestV1(params);
      try {
        const result = decodeReadDiscoveryFindingResultV1(
          await post(
            '/product-api/frontend/knowledge/discoveries/dismiss',
            decodedRequest,
            requestOptions?.signal,
          ),
        );
        if (
          result.finding.findingId !== decodedRequest.findingId ||
          result.finding.findingRevision !== decodedRequest.findingRevision ||
          result.finding.projectId !== result.projectId
        ) {
          identityMismatch('Discovery dismiss result does not match the requested identity.');
        }
        return result;
      } catch (error) {
        if (error instanceof ShotgunApiError || error instanceof FrontendContractError) {
          throw error;
        }
        throw outcomeIndeterminateApiError(decodedRequest.clientRequestId);
      }
    },
    async submitDiscoveryFeedback(params, requestOptions) {
      const decodedRequest = decodeDiscoveryFeedbackProductCommandRequestV1(params);
      try {
        const body = await postEnvelope(
          '/product-api/frontend/knowledge/discoveries/feedback',
          decodedRequest,
          requestOptions?.signal,
        );
        const state = decodeDiscoveryFeedbackProductStateV1(body.result);
        const outcome = decodeAnyFrontendCommandOutcomeView(body.outcome);
        if (
          outcome.clientRequestId !== decodedRequest.clientRequestId ||
          outcome.commandType !== FRONTEND_DISCOVERY_COMMAND_TYPES.feedback ||
          state.findingId !== decodedRequest.findingId ||
          state.findingRevision !== decodedRequest.findingRevision ||
          state.projectId.length === 0
        ) {
          identityMismatch('Discovery feedback result does not match the requested identity.');
        }
        return { state, outcome };
      } catch (error) {
        if (error instanceof ShotgunApiError || error instanceof FrontendContractError) {
          throw error;
        }
        throw outcomeIndeterminateApiError(decodedRequest.clientRequestId);
      }
    },
    async readDiscoveryFeedbackState(params, requestOptions) {
      const decodedRequest = decodeDiscoveryFeedbackProductStateRequestV1(params);
      const state = decodeDiscoveryFeedbackProductStateV1(
        await post(
          '/product-api/frontend/knowledge/discoveries/feedback/state',
          decodedRequest,
          requestOptions?.signal,
        ),
      );
      if (
        state.findingId !== decodedRequest.findingId ||
        state.findingRevision !== decodedRequest.findingRevision ||
        state.projectId.length === 0
      ) {
        identityMismatch('Discovery feedback state does not match the requested identity.');
      }
      return state;
    },
    async resolveDiscoveryFeedbackCommand(clientRequestId, requestOptions) {
      const response = await request(
        `/api/v1/frontend-commands/by-client-request/${encodeURIComponent(clientRequestId)}`,
        { credentials: 'same-origin', signal: requestOptions?.signal },
      );
      const body = (await assertOk(response)) as { outcome?: unknown };
      const outcome = decodeAnyFrontendCommandOutcomeView(body.outcome);
      if (
        outcome.clientRequestId !== clientRequestId ||
        outcome.commandType !== FRONTEND_DISCOVERY_COMMAND_TYPES.feedback
      ) {
        identityMismatch('Discovery feedback command outcome identity does not match the request.');
      }
      return outcome;
    },
    async resolveDiscoveryDismissCommand(clientRequestId, requestOptions) {
      const response = await request(
        `/api/v1/frontend-commands/by-client-request/${encodeURIComponent(clientRequestId)}`,
        { credentials: 'same-origin', signal: requestOptions?.signal },
      );
      const body = (await assertOk(response)) as { outcome?: unknown };
      const outcome = decodeAnyFrontendCommandOutcomeView(body.outcome);
      if (
        outcome.clientRequestId !== clientRequestId ||
        outcome.commandType !== FRONTEND_DISCOVERY_COMMAND_TYPES.dismiss
      ) {
        identityMismatch('Discovery dismiss command outcome identity does not match the request.');
      }
      return outcome;
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
  DiscoveryDismissFindingCommandRequestV1,
  DiscoveryFeedbackProductCommandRequestV1,
  DiscoveryFeedbackProductStateRequestV1,
  DiscoveryFeedbackProductStateV1,
};
