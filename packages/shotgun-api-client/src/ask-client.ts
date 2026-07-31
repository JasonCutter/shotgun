import {
  decodeAskAnswerRunSnapshot,
  decodeAskBranchView,
  decodeAskConversationView,
  decodeAskWorkspaceView,
  type AskAnswerRunSnapshot,
  type AskBranchView,
  type AskConversationView,
  type AskWorkspaceView,
} from '../../contracts/src/index.js';
import { decodeProductApiErrorBody } from './decode.js';
import { productFailureApiError, remoteUnclassifiedProductApiFailure } from './errors.js';

export type AskWorkspaceClient = {
  getWorkspace(
    conversationId?: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskWorkspaceView>;
  getConversation(
    conversationId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskConversationView>;
  getBranch(
    conversationId: string,
    branchId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskBranchView>;
  getAnswerRun(
    answerRunId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskAnswerRunSnapshot>;
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

export const createAskWorkspaceClient = (
  options: { readonly fetch?: typeof globalThis.fetch } = {},
): AskWorkspaceClient => {
  const request = options.fetch ?? globalThis.fetch;
  return {
    async getWorkspace(conversationId, requestOptions) {
      const parameters = new URLSearchParams();
      if (conversationId) parameters.set('conversationId', conversationId);
      const query = parameters.size === 0 ? '' : `?${parameters.toString()}`;
      const response = await request(`/product-api/frontend/ask${query}`, {
        credentials: 'same-origin',
        signal: requestOptions?.signal,
      });
      const body = (await assertOk(response)) as { workspace?: unknown };
      return decodeAskWorkspaceView(body.workspace);
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
      return decodeAskConversationView(body.conversation);
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
      return decodeAskBranchView(body.branch);
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
      return decodeAskAnswerRunSnapshot(body.answerRun);
    },
  };
};
