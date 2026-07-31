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
      if (!response.ok) throw new Error(`Ask workspace failed with status ${response.status}.`);
      const body = (await response.json()) as { workspace?: unknown };
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
      if (!response.ok) throw new Error(`Get conversation failed with status ${response.status}.`);
      const body = (await response.json()) as { conversation?: unknown };
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
      if (!response.ok) throw new Error(`Get branch failed with status ${response.status}.`);
      const body = (await response.json()) as { branch?: unknown };
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
      if (!response.ok) throw new Error(`Get answer run failed with status ${response.status}.`);
      const body = (await response.json()) as { answerRun?: unknown };
      return decodeAskAnswerRunSnapshot(body.answerRun);
    },
  };
};
