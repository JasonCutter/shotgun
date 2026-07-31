import {
  decodeAskWorkspaceView,
  type AskWorkspaceView,
} from '../../contracts/src/index.js';

export type AskWorkspaceClient = {
  getWorkspace(
    conversationId?: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<AskWorkspaceView>;
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
  };
};
