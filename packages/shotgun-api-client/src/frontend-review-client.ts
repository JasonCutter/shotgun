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
import { getSharedCsrfMutationManager, isCsrfFailureResponse } from './csrf-manager.js';

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
  recordComparisonV2Decision(
    params: ComparisonV2DecisionRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ComparisonV2DecisionResult>;
  resolveComparisonV2Operation(
    params: ComparisonV2OperationResolutionRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ComparisonV2OperationResolutionResult>;
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

export type ComparisonV2DecisionRequest = {
  readonly changeSetId: string;
  readonly expectedRevisionNumber: number;
  readonly expectedContentDigest: string;
  readonly decision: 'APPROVE' | 'HOLD' | 'REJECT';
  readonly reason: string;
  readonly decisionId: string;
};

export type ComparisonV2DecisionResult = {
  readonly commandStatus: string;
  readonly decision: {
    readonly decision: 'APPROVE' | 'HOLD' | 'REJECT';
    readonly decisionId: string;
  };
  readonly changeSet: unknown;
  readonly manifest?: unknown;
  readonly handoff?: unknown;
};

export type ComparisonV2OperationResolutionRequest = {
  readonly changeSetId: string;
  readonly expectedDraftRevision: number;
  readonly expectedDraftDigest: string;
  readonly chosenOperation: 'ADD_CLAIM' | 'NO_OP';
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
};

export type ComparisonV2OperationResolutionResult = {
  readonly commandStatus: string;
  readonly resolution: unknown;
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

const decodeComparisonV2DecisionResult = (value: unknown): ComparisonV2DecisionResult => {
  if (!isRecord(value)) return identityMismatch('Comparison V2 decision result must be an object.');
  const decision = value['decision'];
  if (!isRecord(decision))
    return identityMismatch('Comparison V2 decision result is missing its decision.');
  const decisionKind = decision['decision'];
  const decisionId = decision['decisionId'];
  if (
    !['APPROVE', 'HOLD', 'REJECT'].includes(String(decisionKind)) ||
    typeof decisionId !== 'string' ||
    decisionId.trim().length === 0
  ) {
    return identityMismatch('Comparison V2 decision result has an invalid decision identity.');
  }
  if (typeof value['commandStatus'] !== 'string' || value['changeSet'] === undefined) {
    return identityMismatch('Comparison V2 decision result is incomplete.');
  }
  return {
    commandStatus: value['commandStatus'],
    decision: {
      decision: decisionKind as ComparisonV2DecisionResult['decision']['decision'],
      decisionId,
    },
    changeSet: value['changeSet'],
    ...(value['manifest'] === undefined ? {} : { manifest: value['manifest'] }),
    ...(value['handoff'] === undefined ? {} : { handoff: value['handoff'] }),
  };
};

const decodeComparisonV2OperationResolutionResult = (
  value: unknown,
): ComparisonV2OperationResolutionResult => {
  if (
    !isRecord(value) ||
    typeof value['commandStatus'] !== 'string' ||
    value['resolution'] === undefined
  ) {
    return identityMismatch('Comparison V2 operation resolution result is incomplete.');
  }
  return { commandStatus: value['commandStatus'], resolution: value['resolution'] };
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
 * credentials, shared CSRF coordination with a single retry only for
 * REQUEST_ORIGIN_DENIED, strict decoding
 * of every response and no automatic mutation retry (ADR-119). The server is
 * always the Review authority; this client never computes dependencies,
 * capabilities, Approval purpose or recovery itself.
 */
export const createFrontendReviewClient = (
  options: { readonly fetch?: typeof globalThis.fetch } = {},
): FrontendReviewClient => {
  const request = options.fetch ?? globalThis.fetch;
  const csrf = getSharedCsrfMutationManager(request);

  const mutate = async (path: string, params: unknown, signal?: AbortSignal): Promise<Response> => {
    return csrf.run(
      (token) =>
        request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          credentials: 'same-origin',
          body: JSON.stringify(params),
          signal,
        }),
      { signal, recoverOnResponse: isCsrfFailureResponse },
    );
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
    async recordComparisonV2Decision(params, requestOptions) {
      const response = await mutate('/reviews/v2/decision', params, requestOptions?.signal);
      const body = await assertOk(response);
      return decodeComparisonV2DecisionResult(body);
    },
    async resolveComparisonV2Operation(params, requestOptions) {
      const response = await mutate(
        '/reviews/v2/resolve-operation',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeComparisonV2OperationResolutionResult(body);
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
