import type { Page, Request, Response } from '@playwright/test';

const waitForSuccessfulPost = (page: Page, pathname: string): Promise<Response> =>
  page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'POST' &&
      url.pathname === pathname &&
      response.status() === 200
    );
  });

const ASK_ROUTE_GUARD_PATH = '/product-api/frontend/route-guard';

const isAskRouteGuardRequest = (request: Request): boolean => {
  try {
    return new URL(request.url()).pathname === ASK_ROUTE_GUARD_PATH;
  } catch {
    return false;
  }
};

const observeAskRouteGuard = (page: Page) => {
  const requests: string[] = [];
  const responses: Array<{ readonly method: string; readonly status: number }> = [];
  const failures: Array<{ readonly method: string; readonly errorText: string }> = [];
  const onRequest = (request: Request) => {
    if (isAskRouteGuardRequest(request)) requests.push(request.method());
  };
  const onResponse = (response: Response) => {
    if (isAskRouteGuardRequest(response.request())) {
      responses.push({ method: response.request().method(), status: response.status() });
    }
  };
  const onRequestFailed = (request: Request) => {
    if (isAskRouteGuardRequest(request)) {
      failures.push({
        method: request.method(),
        errorText: request.failure()?.errorText ?? 'unknown',
      });
    }
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  return {
    async summary() {
      const askWorkspaceVisible = await page
        .locator('.ask-workspace')
        .isVisible()
        .catch(() => false);
      return JSON.stringify({
        requests,
        responses,
        failures,
        url: new URL(page.url()).pathname,
        askWorkspaceVisible,
      });
    },
    dispose() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfailed', onRequestFailed);
    },
  };
};

/** Wait for the route loader's successful authorization before asserting the new Ask route. */
export const waitForAskConversationRouteReady = async (page: Page): Promise<Response> => {
  const observation = observeAskRouteGuard(page);
  try {
    const request = await page.waitForRequest(
      (candidate) => isAskRouteGuardRequest(candidate) && candidate.method() === 'POST',
    );
    const response = await request.response();
    if (response === null) {
      throw new Error('The Ask conversation route-guard request did not receive a response.');
    }
    if (response.status() !== 200) {
      throw new Error(
        `The Ask conversation route-guard returned HTTP ${response.status()} instead of 200.`,
      );
    }
    return response;
  } catch (reason: unknown) {
    const message = reason instanceof Error ? reason.message : String(reason);
    throw new Error(`${message}\nAsk route-guard observation: ${await observation.summary()}`);
  } finally {
    observation.dispose();
  }
};

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
