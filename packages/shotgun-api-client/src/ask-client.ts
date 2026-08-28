import {
  FrontendContractError,
  decodeAnyFrontendCommandOutcomeView,
  decodeAskAnswerRunSnapshot,
  decodeAskConversationSourceContextView,
  decodeAskProviderEligibilityView,
  decodeAskAnswerRunEventsView,
  decodeAskAnswerRunExportView,
  decodeAskAnswerRunFeedbackView,
  decodeAskTransitionSeedView,
  decodeAskBranchView,
  decodeAskConversationView,
  decodeAskQuestionSubmissionOutcomeView,
  decodeAskQuestionSubmissionView,
  decodeAskWorkspaceViewWithInvariants,
  type AskAnswerRunSnapshot,
  type AskAnswerRunEventsView,
  type AskAnswerRunExportRequest,
  type AskAnswerRunExportView,
  type AskAnswerRunFeedbackRequest,
  type AskAnswerRunFeedbackView,
  type AskAnswerRunRetryRequest,
  type AskAnswerRunTransitionSeedRequest,
  type AskTransitionSeedView,
  type AskBranchView,
  type AskConversationView,
  type AskConversationSourceContextQuery,
  type AskConversationSourceContextView,
  type AskQuestionSubmissionOutcomeView,
  type AskQuestionSubmissionView,
  type AskProviderEligibilityRequest,
  type AskProviderEligibilityView,
  type AskWorkspaceView,
  type AnyFrontendCommandOutcomeView,
  type SubmitAskQuestionRequest,
} from '../../contracts/src/index.js';
import { decodeProductApiErrorBody } from './decode.js';
import { productFailureApiError, remoteUnclassifiedProductApiFailure } from './errors.js';
import { getSharedCsrfMutationManager, isCsrfFailureResponse } from './csrf-manager.js';

export type AskWorkspaceClient = {
  getWorkspace(
    conversationId?: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskWorkspaceView>;
  getConversation(
    conversationId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskConversationView>;
  getConversationSourceContext(
    conversationId: string,
    query: AskConversationSourceContextQuery,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskConversationSourceContextView>;
  getBranch(
    conversationId: string,
    branchId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskBranchView>;
  getAnswerRun(
    answerRunId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskAnswerRunSnapshot>;
  getProviderEligibility(
    request: AskProviderEligibilityRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskProviderEligibilityView>;
  submitQuestion(
    params: SubmitAskQuestionRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskQuestionSubmissionView>;
  getQuestionSubmissionByClientRequestId(
    clientRequestId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskQuestionSubmissionOutcomeView>;
  getAnswerRunCommandOutcome?(
    answerRunId: string,
    clientRequestId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AnyFrontendCommandOutcomeView>;
  getAnswerRunEvents?(
    answerRunId: string,
    afterOrdinal?: number,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskAnswerRunEventsView>;
  cancelAnswerRun?(
    answerRunId: string,
    request: {
      readonly schemaVersion: '1.0.0';
      readonly clientRequestId: string;
      readonly idempotencyKey: string;
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskAnswerRunSnapshot>;
  retryAnswerRun?(
    answerRunId: string,
    request: AskAnswerRunRetryRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskAnswerRunSnapshot>;
  exportAnswerRun?(
    answerRunId: string,
    request: AskAnswerRunExportRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskAnswerRunExportView>;
  submitAnswerFeedback?(
    answerRunId: string,
    request: AskAnswerRunFeedbackRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskAnswerRunFeedbackView>;
  createAnswerTransitionSeed?(
    answerRunId: string,
    request: AskAnswerRunTransitionSeedRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskTransitionSeedView>;
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

export const createAskWorkspaceClient = (
  options: { readonly fetch?: typeof globalThis.fetch } = {},
): AskWorkspaceClient => {
  const request = options.fetch ?? globalThis.fetch;
  const csrf = getSharedCsrfMutationManager(request);

  const submit = async (
    params: SubmitAskQuestionRequest,
    signal?: AbortSignal,
  ): Promise<Response> => {
    return csrf.run(
      (token) =>
        request('/product-api/frontend/ask/questions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': token },
          credentials: 'same-origin',
          body: JSON.stringify(params),
          signal,
        }),
      { signal, recoverOnResponse: isCsrfFailureResponse },
    );
  };

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
    async getProviderEligibility(params, requestOptions) {
      const response = await mutate(
        '/product-api/frontend/ask/provider-eligibility',
        params,
        requestOptions?.signal,
      );
      const body = (await assertOk(response)) as { providerEligibility?: unknown };
      return decodeAskProviderEligibilityView(body.providerEligibility);
    },
    async getWorkspace(conversationId, requestOptions) {
      const parameters = new URLSearchParams();
      if (conversationId) parameters.set('conversationId', conversationId);
      const query = parameters.size === 0 ? '' : `?${parameters.toString()}`;
      const response = await request(`/product-api/frontend/ask${query}`, {
        credentials: 'same-origin',
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { workspace?: unknown };
      const workspace = decodeAskWorkspaceViewWithInvariants(body.workspace);
      if (conversationId && workspace.selectedConversation?.conversationId !== conversationId) {
        identityMismatch('Ask Workspace response does not match the requested Conversation.');
      }
      return workspace;
    },
    async getConversation(conversationId, requestOptions) {
      const response = await request(
        `/product-api/frontend/ask/conversations/${encodeURIComponent(conversationId)}`,
        {
          credentials: 'same-origin',
          signal: requestOptions?.signal,
        },
      );
      const body = (await assertOk(response)) as { conversation?: unknown };
      const conversation = decodeAskConversationView(body.conversation);
      if (conversation.conversationId !== conversationId) {
        identityMismatch('Ask Conversation response identity does not match the request.');
      }
      return conversation;
    },
    async getConversationSourceContext(conversationId, query, requestOptions) {
      const response = await mutate(
        `/product-api/frontend/ask/conversations/${encodeURIComponent(conversationId)}/source-context/query`,
        query,
        requestOptions?.signal,
      );
      const body = (await assertOk(response)) as { sourceContext?: unknown };
      const sourceContext = decodeAskConversationSourceContextView(body.sourceContext);
      if (sourceContext.conversationId !== conversationId) {
        identityMismatch('Ask Source Context response identity does not match the request.');
      }
      return sourceContext;
    },
    async getBranch(conversationId, branchId, requestOptions) {
      const response = await request(
        `/product-api/frontend/ask/conversations/${encodeURIComponent(conversationId)}/branches/${encodeURIComponent(branchId)}`,
        {
          credentials: 'same-origin',
          signal: requestOptions?.signal,
        },
      );
      const body = (await assertOk(response)) as { branch?: unknown };
      const branch = decodeAskBranchView(body.branch);
      if (branch.branchId !== branchId) {
        identityMismatch('Ask Branch response identity does not match the request.');
      }
      for (const turn of branch.turns) {
        if (
          turn.answerRun.conversationId !== conversationId ||
          turn.answerRun.branchId !== branchId ||
          turn.answerRun.turnId !== turn.turnId
        ) {
          identityMismatch('Ask Branch response contains a mismatched AnswerRun identity.');
        }
      }
      return branch;
    },
    async getAnswerRun(answerRunId, requestOptions) {
      const response = await request(
        `/product-api/frontend/ask/answer-runs/${encodeURIComponent(answerRunId)}`,
        {
          credentials: 'same-origin',
          signal: requestOptions?.signal,
        },
      );
      const body = (await assertOk(response)) as { answerRun?: unknown };
      const answerRun = decodeAskAnswerRunSnapshot(body.answerRun);
      if (answerRun.answerRunId !== answerRunId) {
        identityMismatch('Ask AnswerRun response identity does not match the request.');
      }
      return answerRun;
    },
    async submitQuestion(params, requestOptions) {
      const response = await submit(params, requestOptions?.signal);
      const body = (await assertOk(response)) as { submission?: unknown };
      const submission = decodeAskQuestionSubmissionView(body.submission);
      if (params.conversationId && submission.answerRun.conversationId !== params.conversationId) {
        identityMismatch(
          'Ask Question submission response does not match the requested Conversation.',
        );
      }
      return submission;
    },
    async getQuestionSubmissionByClientRequestId(clientRequestId, requestOptions) {
      const response = await request(
        `/product-api/frontend/ask/question-submissions/by-client-request/${encodeURIComponent(clientRequestId)}`,
        {
          credentials: 'same-origin',
          signal: requestOptions?.signal,
        },
      );
      const body = (await assertOk(response)) as { outcome?: unknown };
      const outcome = decodeAskQuestionSubmissionOutcomeView(body.outcome);
      if (outcome.clientRequestId !== clientRequestId) {
        identityMismatch('Ask Question submission outcome clientRequestId does not match request.');
      }
      return outcome;
    },
    async getAnswerRunEvents(answerRunId, afterOrdinal, requestOptions) {
      const query =
        afterOrdinal === undefined
          ? ''
          : `?afterOrdinal=${encodeURIComponent(String(afterOrdinal))}`;
      const response = await request(
        `/product-api/frontend/ask/answer-runs/${encodeURIComponent(answerRunId)}/events${query}`,
        { credentials: 'same-origin', signal: requestOptions?.signal },
      );
      const body = (await assertOk(response)) as { events?: unknown };
      const events = decodeAskAnswerRunEventsView(body.events);
      if (events.answerRunId !== answerRunId)
        identityMismatch('Ask events identity does not match the request.');
      return events;
    },
    async getAnswerRunCommandOutcome(answerRunId, clientRequestId, requestOptions) {
      const response = await request(
        `/product-api/frontend/ask/answer-runs/${encodeURIComponent(answerRunId)}/commands/by-client-request/${encodeURIComponent(clientRequestId)}`,
        { credentials: 'same-origin', signal: requestOptions?.signal },
      );
      const body = (await assertOk(response)) as {
        outcome?: unknown;
        targetResource?: { readonly resourceKind?: unknown; readonly resourceId?: unknown };
      };
      const outcome = decodeAnyFrontendCommandOutcomeView(body.outcome);
      if (outcome.clientRequestId !== clientRequestId)
        identityMismatch('AnswerRun command outcome identity does not match the request.');
      if (
        body.targetResource?.resourceKind !== 'ASK_ANSWER_RUN' ||
        body.targetResource.resourceId !== answerRunId
      ) {
        identityMismatch('AnswerRun command outcome target does not match the request.');
      }
      if (
        outcome.outcomeState === 'COMPLETED' &&
        !outcome.producedResources.some(
          (resource) =>
            resource.resourceKind === 'ASK_ANSWER_RUN' && resource.resourceId === answerRunId,
        )
      ) {
        identityMismatch('AnswerRun command outcome resource does not match the request.');
      }
      return outcome;
    },
    async cancelAnswerRun(answerRunId, params, requestOptions) {
      const response = await mutate(
        `/product-api/frontend/ask/answer-runs/${encodeURIComponent(answerRunId)}/cancel`,
        params,
        requestOptions?.signal,
      );
      const body = (await assertOk(response)) as { answerRun?: unknown };
      const answerRun = decodeAskAnswerRunSnapshot(body.answerRun);
      if (answerRun.answerRunId !== answerRunId)
        identityMismatch('Cancel response identity does not match the request.');
      return answerRun;
    },
    async retryAnswerRun(answerRunId, params, requestOptions) {
      const response = await mutate(
        `/product-api/frontend/ask/answer-runs/${encodeURIComponent(answerRunId)}/retry`,
        params,
        requestOptions?.signal,
      );
      const body = (await assertOk(response)) as { answerRun?: unknown };
      const answerRun = decodeAskAnswerRunSnapshot(body.answerRun);
      if (answerRun.answerRunId !== answerRunId)
        identityMismatch('Retry response identity does not match the request.');
      return answerRun;
    },
    async exportAnswerRun(answerRunId, params, requestOptions) {
      const response = await mutate(
        `/product-api/frontend/ask/answer-runs/${encodeURIComponent(answerRunId)}/export`,
        params,
        requestOptions?.signal,
      );
      const body = (await assertOk(response)) as { export?: unknown };
      const exported = decodeAskAnswerRunExportView(body.export);
      if (exported.answerRunId !== answerRunId)
        identityMismatch('Export response identity does not match the request.');
      return exported;
    },
    async submitAnswerFeedback(answerRunId, params, requestOptions) {
      const response = await mutate(
        `/product-api/frontend/ask/answer-runs/${encodeURIComponent(answerRunId)}/feedback`,
        params,
        requestOptions?.signal,
      );
      const body = (await assertOk(response)) as { feedback?: unknown };
      const feedback = decodeAskAnswerRunFeedbackView(body.feedback);
      if (feedback.answerRunId !== answerRunId)
        identityMismatch('Feedback response identity does not match the request.');
      return feedback;
    },
    async createAnswerTransitionSeed(answerRunId, params, requestOptions) {
      const response = await mutate(
        `/product-api/frontend/ask/answer-runs/${encodeURIComponent(answerRunId)}/transition-seed`,
        params,
        requestOptions?.signal,
      );
      const body = (await assertOk(response)) as { seed?: unknown };
      const seed = decodeAskTransitionSeedView(body.seed);
      if (seed.answerRunId !== answerRunId)
        identityMismatch('Transition seed identity does not match the request.');
      return seed;
    },
  };
};
