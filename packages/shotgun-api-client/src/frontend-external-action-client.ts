import { FrontendContractError } from '../../contracts/src/index.js';
import {
  decodeApproveExternalActionResultV1,
  decodeCancelExternalActionResultV1,
  decodeExecuteExternalActionResultV1,
  decodeGetActionManifestResultV1,
  decodeGetActionResultResultV1,
  decodeGetExecutionAttemptsResultV1,
  decodeGetExecutionResultV1,
  decodeGetExternalActionApprovalResultV1,
  decodeGetExternalActionDetailResultV1,
  decodeGetExternalActionResultV1,
  decodeGetPreflightResultV1,
  decodeGetRiskDecisionResultV1,
  decodeGetVerificationResultV1,
  decodeListExternalActionAuditResultV1,
  decodeListExternalActionsResultV1,
  decodePreflightExternalActionResultV1,
  decodePrepareActionManifestResultV1,
  decodePrepareCompensatingActionResultV1,
  decodeResolveExternalActionOutcomeResultV1,
  decodeRetryExecutionAttemptResultV1,
  decodeRollbackExternalActionResultV1,
  decodeValidateActionCandidateResultV1,
  decodeVerifyExternalActionResultV1,
  frontendExternalActionApproveDigest,
  frontendExternalActionCancelDigest,
  frontendExternalActionCandidateDigest,
  frontendExternalActionCompensationDigest,
  frontendExternalActionExecuteDigest,
  frontendExternalActionManifestDigest,
  frontendExternalActionPreflightDigest,
  frontendExternalActionRetryDigest,
  frontendExternalActionRollbackDigest,
  frontendExternalActionVerifyDigest,
  type ApproveExternalActionRequestV1,
  type ApproveExternalActionResultV1,
  type CancelExternalActionRequestV1,
  type CancelExternalActionResultV1,
  type ExecuteExternalActionRequestV1,
  type ExecuteExternalActionResultV1,
  type GetActionManifestRequestV1,
  type GetActionManifestResultV1,
  type GetActionResultRequestV1,
  type GetActionResultResultV1,
  type GetExecutionAttemptsRequestV1,
  type GetExecutionAttemptsResultV1,
  type GetExecutionRequestV1,
  type GetExecutionResultV1,
  type GetExternalActionApprovalRequestV1,
  type GetExternalActionApprovalResultV1,
  type GetExternalActionDetailRequestV1,
  type GetExternalActionDetailResultV1,
  type GetExternalActionRequestV1,
  type GetExternalActionResultV1,
  type GetPreflightRequestV1,
  type GetPreflightResultV1,
  type GetRiskDecisionRequestV1,
  type GetRiskDecisionResultV1,
  type GetVerificationRequestV1,
  type GetVerificationResultV1,
  type ListExternalActionAuditRequestV1,
  type ListExternalActionAuditResultV1,
  type ListExternalActionsRequestV1,
  type ListExternalActionsResultV1,
  type PreflightExternalActionRequestV1,
  type PreflightExternalActionResultV1,
  type PrepareActionManifestRequestV1,
  type PrepareActionManifestResultV1,
  type PrepareCompensatingActionRequestV1,
  type PrepareCompensatingActionResultV1,
  type ResolveExternalActionOutcomeRequestV1,
  type ResolveExternalActionOutcomeResultV1,
  type RetryExecutionAttemptRequestV1,
  type RetryExecutionAttemptResultV1,
  type RollbackExternalActionRequestV1,
  type RollbackExternalActionResultV1,
  type ValidateActionCandidateRequestV1,
  type ValidateActionCandidateResultV1,
  type VerifyExternalActionRequestV1,
  type VerifyExternalActionResultV1,
} from '../../contracts/src/index.js';
import { decodeProductApiErrorBody } from './decode.js';
import { productFailureApiError, remoteUnclassifiedProductApiFailure } from './errors.js';

// The shared per-command semantic digests are re-exported so the browser
// computes exactly the digests the server validates for OUTCOME_UNKNOWN
// resolution by the ORIGINAL command identity (never a re-execute).
export {
  frontendExternalActionApproveDigest,
  frontendExternalActionCancelDigest,
  frontendExternalActionCandidateDigest,
  frontendExternalActionCompensationDigest,
  frontendExternalActionExecuteDigest,
  frontendExternalActionManifestDigest,
  frontendExternalActionPreflightDigest,
  frontendExternalActionRetryDigest,
  frontendExternalActionRollbackDigest,
  frontendExternalActionVerifyDigest,
};

export type FrontendExternalActionClient = {
  // Reads
  listExternalActions(
    params: ListExternalActionsRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ListExternalActionsResultV1>;
  getExternalAction(
    params: GetExternalActionRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetExternalActionResultV1>;
  getExternalActionDetail(
    params: GetExternalActionDetailRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetExternalActionDetailResultV1>;
  getActionManifest(
    params: GetActionManifestRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetActionManifestResultV1>;
  getRiskDecision(
    params: GetRiskDecisionRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetRiskDecisionResultV1>;
  getPreflight(
    params: GetPreflightRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetPreflightResultV1>;
  getExecution(
    params: GetExecutionRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetExecutionResultV1>;
  getExecutionAttempts(
    params: GetExecutionAttemptsRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetExecutionAttemptsResultV1>;
  getVerification(
    params: GetVerificationRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetVerificationResultV1>;
  getActionResult(
    params: GetActionResultRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetActionResultResultV1>;
  listExternalActionAudit(
    params: ListExternalActionAuditRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ListExternalActionAuditResultV1>;
  getExternalActionApproval(
    params: GetExternalActionApprovalRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<GetExternalActionApprovalResultV1>;
  // Governed writes
  validateActionCandidate(
    params: ValidateActionCandidateRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ValidateActionCandidateResultV1>;
  prepareActionManifest(
    params: PrepareActionManifestRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<PrepareActionManifestResultV1>;
  approveExternalAction(
    params: ApproveExternalActionRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ApproveExternalActionResultV1>;
  preflightExternalAction(
    params: PreflightExternalActionRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<PreflightExternalActionResultV1>;
  executeExternalAction(
    params: ExecuteExternalActionRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ExecuteExternalActionResultV1>;
  retryExecutionAttempt(
    params: RetryExecutionAttemptRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RetryExecutionAttemptResultV1>;
  verifyExternalAction(
    params: VerifyExternalActionRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<VerifyExternalActionResultV1>;
  cancelExternalAction(
    params: CancelExternalActionRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<CancelExternalActionResultV1>;
  rollbackExternalAction(
    params: RollbackExternalActionRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RollbackExternalActionResultV1>;
  prepareCompensatingAction(
    params: PrepareCompensatingActionRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<PrepareCompensatingActionResultV1>;
  resolveExternalActionOutcome(
    params: ResolveExternalActionOutcomeRequestV1,
    options?: { readonly signal?: AbortSignal },
  ): Promise<ResolveExternalActionOutcomeResultV1>;
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
 * Fail-closed command identity binding (Review 4863146027 item 4). Every
 * governed result MUST echo the full command identity — `clientRequestId`,
 * `idempotencyKey` and `actionId` (whichever the command carries) — before the
 * result is trusted. A mismatch is an integrity failure, never silently
 * accepted. Command-specific identities (manifest/execution/source ids) are
 * asserted by the caller on top of this shared check.
 */
const assertCommandIdentity = (
  result: {
    readonly clientRequestId?: string;
    readonly idempotencyKey?: string;
    readonly actionId?: string;
  },
  params: {
    readonly clientRequestId: string;
    readonly idempotencyKey?: string;
    readonly actionId?: string;
  },
  message: string,
): void => {
  const fields: ReadonlyArray<readonly [string, string | undefined, string | undefined]> = [
    ['clientRequestId', params.clientRequestId, result.clientRequestId],
    ['idempotencyKey', params.idempotencyKey, result.idempotencyKey],
    ['actionId', params.actionId, result.actionId],
  ];
  for (const [field, expected, actual] of fields) {
    if (expected !== undefined && actual !== expected) {
      identityMismatch(`${message}: ${field} does not match the requested command.`);
    }
  }
};

/**
 * Typed FE-P4-S2 WP4 External Action client. Same-origin credentials, cached
 * CSRF token with a single retry on 403 (session refresh) for READ POSTs only,
 * strict decoding of every response, `AbortSignal` support and NO automatic
 * governed-mutation retry (Review 4863146027 item 2). A governed mutation is
 * sent exactly ONCE; a general 403 (project access denied, capability denied,
 * session loss, policy change) returns the typed failure without a resend.
 * The server is always the authority for Principal, Project, access, policy,
 * capability, credential and budget; this client never derives them itself and
 * never re-executes an OUTCOME_UNKNOWN command — recovery is always
 * `resolveExternalActionOutcome` by the original command identity.
 */
export const createFrontendExternalActionClient = (
  options: { readonly fetch?: typeof globalThis.fetch } = {},
): FrontendExternalActionClient => {
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

  const post = (
    path: string,
    params: unknown,
    token: string,
    signal?: AbortSignal,
  ): Promise<Response> =>
    request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': token },
      credentials: 'same-origin',
      body: JSON.stringify(params),
      signal,
    });

  // READ POST: idempotent and safe, so a CSRF refresh + single retry on a
  // general 403 is allowed (session rotation must not break a plain read).
  const read = async (path: string, params: unknown, signal?: AbortSignal): Promise<Response> => {
    let response = await post(path, params, await csrf(signal), signal);
    if (response.status === 403) {
      csrfToken = undefined;
      response = await post(path, params, await csrf(signal), signal);
    }
    return response;
  };

  // GOVERNED MUTATION: sent exactly once. A general 403 is never auto-retried
  // — the typed failure is surfaced to the caller instead (Review 4863146027
  // item 2; AC-20). Only a CSRF rejection explicitly retried by the caller is
  // ever re-sent, and no mutation is re-sent with a NEW identity.
  const mutate = async (path: string, params: unknown, signal?: AbortSignal): Promise<Response> =>
    post(path, params, await csrf(signal), signal);

  return {
    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------
    async listExternalActions(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/queue',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      return decodeListExternalActionsResultV1(body);
    },
    async getExternalAction(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/actions/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetExternalActionResultV1(body);
      if (result.action.actionId !== params.actionId) {
        identityMismatch('Action read result does not match the requested External Action.');
      }
      return result;
    },
    async getExternalActionDetail(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/actions/detail',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetExternalActionDetailResultV1(body);
      if (result.action.actionId !== params.actionId) {
        identityMismatch('Detail result does not match the requested External Action.');
      }
      return result;
    },
    async getActionManifest(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/manifests/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetActionManifestResultV1(body);
      if (result.manifest.actionId !== params.actionId) {
        identityMismatch('Manifest read result does not match the requested External Action.');
      }
      return result;
    },
    async getRiskDecision(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/risk-decisions/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetRiskDecisionResultV1(body);
      if (result.riskDecision.actionId !== params.actionId) {
        identityMismatch('Risk decision read result does not match the requested action.');
      }
      return result;
    },
    async getPreflight(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/preflights/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetPreflightResultV1(body);
      if (result.preflight.actionId !== params.actionId) {
        identityMismatch('Preflight read result does not match the requested action.');
      }
      return result;
    },
    async getExecution(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/executions/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetExecutionResultV1(body);
      if (result.execution.actionId !== params.actionId) {
        identityMismatch('Execution read result does not match the requested action.');
      }
      return result;
    },
    async getExecutionAttempts(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/executions/attempts',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetExecutionAttemptsResultV1(body);
      if (result.attempts.some((attempt) => attempt.actionId !== params.actionId)) {
        identityMismatch('Attempt list contains an attempt for a different External Action.');
      }
      return result;
    },
    async getVerification(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/verifications/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetVerificationResultV1(body);
      if (result.verification.actionId !== params.actionId) {
        identityMismatch('Verification read result does not match the requested action.');
      }
      return result;
    },
    async getActionResult(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/results/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetActionResultResultV1(body);
      if (result.result.actionId !== params.actionId) {
        identityMismatch('Result read does not match the requested action.');
      }
      return result;
    },
    async listExternalActionAudit(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/audit',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeListExternalActionAuditResultV1(body);
      if (result.events.some((event) => event.actionId !== params.actionId)) {
        identityMismatch('Audit list contains an event for a different External Action.');
      }
      return result;
    },
    async getExternalActionApproval(params, requestOptions) {
      const response = await read(
        '/product-api/frontend/external-action/approvals/read',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeGetExternalActionApprovalResultV1(body);
      if (result.approval.actionId !== params.actionId) {
        identityMismatch('Approval read result does not match the requested action.');
      }
      return result;
    },

    // ------------------------------------------------------------------
    // Governed writes
    // ------------------------------------------------------------------
    async validateActionCandidate(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/external-action/validate',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeValidateActionCandidateResultV1(body);
      assertCommandIdentity(result, params, 'Validate result');
      if (result.candidate.candidateId !== params.candidateId) {
        identityMismatch('Validate result candidate does not match the requested candidate.');
      }
      return result;
    },
    async prepareActionManifest(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/external-action/prepare',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodePrepareActionManifestResultV1(body);
      assertCommandIdentity(result, params, 'Prepare result');
      if (result.manifest.actionId !== params.actionId) {
        identityMismatch('Prepare result manifest does not match the requested action.');
      }
      return result;
    },
    async approveExternalAction(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/external-action/approve',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeApproveExternalActionResultV1(body);
      assertCommandIdentity(result, params, 'Approve result');
      if (result.approval.actionId !== params.actionId) {
        identityMismatch('Approve result approval does not match the requested action.');
      }
      if (result.approval.manifestId !== params.manifestId) {
        identityMismatch('Approve result approval does not match the requested manifest.');
      }
      if (result.approval.manifestRevision !== params.manifestRevision) {
        identityMismatch('Approve result approval does not match the requested manifest revision.');
      }
      if (result.approval.targetRevision !== params.expectedTargetRevision) {
        identityMismatch('Approve result approval does not match the requested target revision.');
      }
      if (result.approval.externalRevision !== params.expectedExternalRevision) {
        identityMismatch('Approve result approval does not match the requested external revision.');
      }
      return result;
    },
    async preflightExternalAction(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/external-action/preflight',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodePreflightExternalActionResultV1(body);
      assertCommandIdentity(result, params, 'Preflight result');
      if (result.preflight.actionId !== params.actionId) {
        identityMismatch('Preflight result preflight does not match the requested action.');
      }
      if (result.preflight.manifestRevision !== params.manifestRevision) {
        identityMismatch('Preflight result does not match the requested manifest revision.');
      }
      return result;
    },
    async executeExternalAction(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/external-action/execute',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeExecuteExternalActionResultV1(body);
      assertCommandIdentity(result, params, 'Execute result');
      if (result.execution.actionId !== params.actionId) {
        identityMismatch('Execute result execution does not match the requested action.');
      }
      if (result.execution.manifestRevision !== params.manifestRevision) {
        identityMismatch('Execute result does not match the requested manifest revision.');
      }
      if (result.attempt.idempotencyKey !== params.idempotencyKey) {
        identityMismatch('Execute result attempt does not match the requested idempotency key.');
      }
      if (result.attempt.externalRevision !== params.expectedExternalRevision) {
        identityMismatch('Execute result attempt does not match the requested external revision.');
      }
      return result;
    },
    async retryExecutionAttempt(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/external-action/retry',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeRetryExecutionAttemptResultV1(body);
      assertCommandIdentity(result, params, 'Retry result');
      if (result.attempt.executionId !== params.executionId) {
        identityMismatch('Retry result attempt does not match the requested execution.');
      }
      if (result.attempt.causationId !== params.causationId) {
        identityMismatch('Retry result attempt does not match the requested causation id.');
      }
      return result;
    },
    async verifyExternalAction(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/external-action/verify',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeVerifyExternalActionResultV1(body);
      assertCommandIdentity(result, params, 'Verify result');
      if (result.verification.executionId !== params.executionId) {
        identityMismatch('Verify result verification does not match the requested execution.');
      }
      if (params.attemptId !== undefined && result.verification.attemptId !== params.attemptId) {
        identityMismatch('Verify result verification does not match the requested attempt.');
      }
      if (result.verification.targetRevision !== params.expectedTargetRevision) {
        identityMismatch(
          'Verify result verification does not match the requested target revision.',
        );
      }
      if (result.verification.externalRevision !== params.expectedExternalRevision) {
        identityMismatch(
          'Verify result verification does not match the requested external revision.',
        );
      }
      return result;
    },
    async cancelExternalAction(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/external-action/cancel',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeCancelExternalActionResultV1(body);
      assertCommandIdentity(result, params, 'Cancel result');
      return result;
    },
    async rollbackExternalAction(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/external-action/rollback',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodeRollbackExternalActionResultV1(body);
      assertCommandIdentity(result, params, 'Rollback result');
      if (result.rollback.actionId !== params.actionId) {
        identityMismatch('Rollback result rollback does not match the requested action.');
      }
      if (
        result.rollback.executionRef !== undefined &&
        result.rollback.executionRef.resourceId !== params.executionId
      ) {
        identityMismatch('Rollback result rollback does not match the requested execution.');
      }
      return result;
    },
    async prepareCompensatingAction(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/external-action/compensations/prepare',
        params,
        requestOptions?.signal,
      );
      const body = await assertOk(response);
      const result = decodePrepareCompensatingActionResultV1(body);
      assertCommandIdentity(result, params, 'Compensation result');
      if (
        result.compensation.sourceActionId !== params.sourceActionId ||
        result.compensation.sourceExecutionId !== params.sourceExecutionId
      ) {
        identityMismatch('Compensation result does not match the requested source command.');
      }
      return result;
    },
    async resolveExternalActionOutcome(params, requestOptions) {
      const query = new URLSearchParams({
        idempotencyKey: params.idempotencyKey,
        semanticDigest: params.semanticDigest,
      });
      const response = await request(
        `/product-api/frontend/external-action/command-outcomes/by-client-request/${encodeURIComponent(
          params.clientRequestId,
        )}?${query.toString()}`,
        { credentials: 'same-origin', signal: requestOptions?.signal },
      );
      const body = await assertOk(response);
      const result = decodeResolveExternalActionOutcomeResultV1(body);
      if (
        result.originalClientRequestId !== params.clientRequestId ||
        result.originalIdempotencyKey !== params.idempotencyKey
      ) {
        identityMismatch('Outcome result does not match the original External Action command.');
      }
      return result;
    },
  };
};
