import type { Page, Response } from '@playwright/test';

const waitForSuccessfulPost = (page: Page, pathname: string): Promise<Response> =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'POST' &&
      url.pathname === pathname &&
      response.status() === 200
    );
  });

/** Wait for the route loader's successful authorization before asserting the new Ask route. */
export const waitForAskConversationRouteReady = (page: Page): Promise<Response> =>
  waitForSuccessfulPost(page, '/product-api/frontend/route-guard');

/** Wait for the project-scoped Source library query to finish successfully. */
export const waitForAskProjectSourceContextReady = (page: Page): Promise<Response> =>
  waitForSuccessfulPost(page, '/product-api/frontend/sources/query');

/** Wait for a Conversation-scoped Source Context query to finish successfully. */
export const waitForAskConversationSourceContextReady = (
  page: Page,
  conversationId: string,
): Promise<Response> =>
  waitForSuccessfulPost(
    page,
    `/product-api/frontend/ask/conversations/${encodeURIComponent(conversationId)}/source-context/query`,
  );
