import type { ProductSessionView, RequestOptions, ShotgunApiClient } from './contracts.js';
import { createCsrfMutationManager } from './csrf-manager.js';
import {
  decodeCsrfEnvelope,
  decodeLogoutEnvelope,
  decodeProductApiErrorBody,
  decodeSessionEnvelope,
} from './decode.js';
import { ShotgunApiError } from './errors.js';

const apiPath = (path: string): string => `/api/v1${path}`;

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
  const error = decodeProductApiErrorBody(body);
  throw new ShotgunApiError({
    status: response.status,
    code: error?.code ?? 'REQUEST_FAILED',
    message: error?.message ?? 'Request failed.',
    ...(error?.correlationId === undefined ? {} : { correlationId: error.correlationId }),
  });
};

export const createShotgunApiClient = (
  options: {
    readonly fetch?: typeof globalThis.fetch;
  } = {},
): ShotgunApiClient => {
  const fetchImplementation = options.fetch ?? globalThis.fetch;

  const request = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetchImplementation(apiPath(path), {
      ...init,
      credentials: 'same-origin',
    });

  const csrf = createCsrfMutationManager();

  const runMutation = async <T>(
    signal: AbortSignal | undefined,
    mutation: (csrfToken: string) => Promise<T>,
  ): Promise<T> =>
    csrf.run(async () => {
      const response = await request('/security/csrf', { signal });
      return decodeCsrfEnvelope(await assertOk(response));
    }, mutation);

  return {
    async bootstrapLocalOwner(requestOptions?: RequestOptions): Promise<ProductSessionView> {
      const response = await request('/session/local-bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
        signal: requestOptions?.signal,
      });
      return decodeSessionEnvelope(await assertOk(response));
    },

    async getSession(requestOptions?: RequestOptions): Promise<ProductSessionView> {
      const response = await request('/session', { signal: requestOptions?.signal });
      return decodeSessionEnvelope(await assertOk(response));
    },

    async switchActiveProject(
      projectId: string,
      requestOptions?: RequestOptions,
    ): Promise<ProductSessionView> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request('/session/active-project', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify({ projectId }),
          signal: requestOptions?.signal,
        });
        return decodeSessionEnvelope(await assertOk(response));
      });
    },

    async logout(requestOptions?: RequestOptions): Promise<void> {
      return runMutation(requestOptions?.signal, async (csrfToken) => {
        const response = await request('/session/logout', {
          method: 'POST',
          headers: { 'x-csrf-token': csrfToken },
          signal: requestOptions?.signal,
        });
        decodeLogoutEnvelope(await assertOk(response));
      });
    },
  };
};
