import { FrontendContractError } from '../../contracts/src/index.js';
import {
  decodeAddReviewCommentResultV1,
  decodeCreateReversalDraftChangeSetRequestV1,
  decodeGetReviewApprovalResultV1,
  decodeGetReviewContextResultV1,
  decodeGetReviewItemDetailResultV1,
  decodeListReviewQueueResultV1,
  decodeRecordReviewDecisionsResultV1,
  decodeResolveReviewCommandOutcomeResultV1,
  decodeRevalidateReviewContextResultV1,
  decodeReversalDraftChangeSetV1,
  decodeReversalEligibilityV1,
  frontendReviewAddCommentDigest,
  frontendReviewRecordDecisionsDigest,
  frontendReviewRevalidateDigest,
  type AddReviewCommentRequestV1,
  type AddReviewCommentResultV1,
  type CreateReversalDraftChangeSetRequestV1,
  type CreateReversalDraftChangeSetResultV1,
  type GetReviewApprovalRequestV1,
  type GetReviewApprovalResultV1,
  type GetReviewContextRequestV1,
  type GetReviewContextResultV1,
  type GetReviewItemDetailRequestV1,
  type GetReviewItemDetailResultV1,
  type ListReviewQueueRequestV1,
  type ListReviewQueueResultV1,
  type RecordReviewDecisionsRequestV1,
  type RecordReviewDecisionsResultV1,
  type ResolveReviewCommandOutcomeRequestV1,
  type ResolveReviewCommandOutcomeResultV1,
  type RevalidateReviewContextRequestV1,
  type RevalidateReviewContextResultV1,
} from '../../contracts/src/index.js';
import { decodeProductApiErrorBody } from './decode.js';
import { productFailureApiError, remoteUnclassifiedProductApiFailure } from './errors.js';

// The shared per-command semantic digests are re-exported so the browser
// Review Draft State Machine computes exactly the same digests the server
// validates for OUTCOME_UNKNOWN resolution.
export {
  frontendReviewAddCommentDigest,
  frontendReviewRecordDecisionsDigest,
  frontendReviewRevalidateDigest,
};

export type FrontendReviewClient = {
  listReviewQueue(
    params: ListReviewQueueRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ListReviewQueueResultV1>;
  getReviewContext(
    params: GetReviewContextRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetReviewContextResultV1>;
  getReviewItemDetail(
    params: GetReviewItemDetailRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetReviewItemDetailResultV1>;
  revalidateReviewContext(
    params: RevalidateReviewContextRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RevalidateReviewContextResultV1>;
  recordReviewDecisions(
    params: RecordReviewDecisionsRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RecordReviewDecisionsResultV1>;
  addReviewComment(
    params: AddReviewCommentRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AddReviewCommentResultV1>;
  getReviewApproval(
    params: GetReviewApprovalRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetReviewApprovalResultV1>;
  resolveCommandOutcome(
    params: ResolveReviewCommandOutcomeRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ResolveReviewCommandOutcomeResultV1>;
  /**
   * FE-P5-S2 WP5 B — Reversal initiation (change-set-review owning route, WP3).
   * The server derives the current capability and principal; the browser only
   * names the historical revision. Returns the CANDIDATE Reversal draft +
   * eligibility.
   */
  createReversalDraftChangeSet(
    params: CreateReversalDraftChangeSetRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CreateReversalDraftChangeSetResultV1>;
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

const invalidReversalResponse = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const decodeCreateReversalResult = (value: unknown): CreateReversalDraftChangeSetResultV1 => {
  if (!isRecord(value)) invalidReversalResponse('Reversal result must be an object.');
  const record = value as Record<string, unknown>;
  return Object.freeze({
    schemaVersion: '1.0.0',
    reversal: decodeReversalDraftChangeSetV1(record['reversal'], 'reversal.reversal'),
    eligibility: decodeReversalEligibilityV1(record['eligibility'], 'reversal.eligibility'),
  });
};

/**
 * Typed FE-P4-S1 Review client. Mirrors the Knowledge Draft client: same-origin
 * credentials, cached CSRF token with a single retry on 403, strict decoding
 * of every response and no automatic mutation retry (ADR-119). The server is
 * always the Review authority; this client never computes dependencies,
 * capabilities, Approval purpose or recovery itself.
 */
export const createFrontendReviewClient = (
  options: { readonly fetch?: typeof globalThis.fetch } = {},
): FrontendReviewClient => {
  const request = options.fetch ?? globalThis.fetch;
  let csrfToken: string | undefined;

  const csrf = async (signal?: AbortSignal): Promise<string> => {
    if (csrfToken) return csrfToken;
    const response = await request('/api/v1/security/csrf', {
      credentials: 'same-origin',
      signal,
    });
    const body = (await assertOk(response)) as { readonly csrfToken?: unknown };
    if (typeof body.csrfToken !== 'string' || body.csrfToken.length === 0) {
      throw new FrontendContractError('UNSUPPORTED_SCHEMA', 'The CSRF token response is invalid.');
    }
    csrfToken = body.csrfToken;
    return csrfToken;
  };

  const mutate = async (path: string, params: unknown, signal?: AbortSignal): Promise<Response> => {
    const send = async (token: string): Promise<Response> =>
      request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        credentials: 'same-origin',
        body: JSON.stringify(params),
        signal,
      });
    let response = await send(await csrf(signal));
    if (response.status === 403) {
      csrfToken = undefined;
      response = await send(await csrf(signal));
    }
    return response;
  };

  return {
    async listReviewQueue(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/review/queue',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeListReviewQueueResultV1(body);
    },
    async getReviewContext(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/review/contexts/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetReviewContextResultV1(body);
      if (result.context.reviewContextId !== params.reviewContextId) {
        identityMismatch('Context read result does not match the requested Review Context.');
      }
      return result;
    },
    async getReviewItemDetail(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/review/items/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetReviewItemDetailResultV1(body);
      if (result.item.reviewItemId !== params.reviewItemId) {
        identityMismatch('Item detail result does not match the requested Review Item.');
      }
      return result;
    },
    async revalidateReviewContext(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/review/contexts/revalidate',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeRevalidateReviewContextResultV1(body);
      if (
        result.context.reviewContextId !== params.reviewContextId ||
        result.clientRequestId !== params.clientRequestId
      ) {
        identityMismatch('Revalidate result does not match the requested Review Context.');
      }
      return result;
    },
    async recordReviewDecisions(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/review/decisions',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeRecordReviewDecisionsResultV1(body);
      if (
        result.reviewContextId !== params.reviewContextId ||
        result.clientRequestId !== params.clientRequestId ||
        result.contextRevision !== params.expectedContextRevision
      ) {
        identityMismatch('Decisions result does not match the requested Review command.');
      }
      return result;
    },
    async addReviewComment(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/review/comments',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeAddReviewCommentResultV1(body);
      if (
        result.comment.reviewContextId !== params.reviewContextId ||
        result.clientRequestId !== params.clientRequestId
      ) {
        identityMismatch('Comment result does not match the requested Review command.');
      }
      return result;
    },
    async getReviewApproval(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/review/approvals/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetReviewApprovalResultV1(body);
      if (result.approval.approvalId !== params.approvalId) {
        identityMismatch('Approval read result does not match the requested Approval.');
      }
      return result;
    },
    async resolveCommandOutcome(params, requestOptions) {
      const query = new URLSearchParams({
        idempotencyKey: params.idempotencyKey,
        semanticDigest: params.semanticDigest,
      });
      const response = await request(
        `/product-api/frontend/review/command-outcomes/by-client-request/${encodeURIComponent(
          params.clientRequestId,
        )}?${query.toString()}`,
        { credentials: 'same-origin', signal: requestOptions?.signal },
      );
      const body = await assertOk(response);
      const result = decodeResolveReviewCommandOutcomeResultV1(body);
      if (result.originalClientRequestId !== params.clientRequestId) {
        identityMismatch('Outcome result does not match the original Review command.');
      }
      return result;
    },
    async createReversalDraftChangeSet(params, requestOptions) {
      // Strict request gate: only the frozen fields are accepted; capability,
      // principal and timestamp are never browser-supplied.
      decodeCreateReversalDraftChangeSetRequestV1(params, 'createReversalDraftChangeSet');
      const response = await mutate(
        '/product-api/frontend/review/reversal-draft',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeCreateReversalResult(body);
      if (result.reversal.sourceRevisionId !== params.sourceRevisionId) {
        identityMismatch('Reversal result does not match the requested source revision.');
      }
      return result;
    },
  };
};
