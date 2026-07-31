import {
  FrontendContractError,
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

const identityMismatch = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
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
      const workspace = decodeAskWorkspaceView(body.workspace);
      if (
        conversationId &&
        workspace.selectedConversation?.conversationId !== conversationId
      ) {
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
  };
};
