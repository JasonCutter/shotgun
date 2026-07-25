import {
  FrontendContractError,
  decodeSessionBoundaryView,
} from '../../contracts/src/frontend-entry.js';
import type {
  ProductSessionView,
  RequestOptions,
  SessionBoundaryView,
  ShotgunApiClient,
} from './contracts.js';
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

export const mapErrorToSessionBoundaryView = (error: unknown): SessionBoundaryView => {
  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (isBrowserOffline) {
    return decodeSessionBoundaryView({
      schemaVersion: '1.0.0',
      authenticationAdapter: 'local_owner',
      connectivityState: 'OFFLINE',
      authenticationState: 'authentication_unavailable',
      sessionState: 'UNAVAILABLE',
      backendReadiness: 'UNAVAILABLE',
      reasonCode: 'LOCAL_SERVER_UNAVAILABLE',
      recoveryActions: [
        { id: 'RECONNECT', label: '다시 연결', enabled: true },
        { id: 'CHECK_LOCAL_SERVER', label: '로컬 서버 상태 확인', enabled: true },
      ],
      session: null,
    });
  }

  if (error instanceof FrontendContractError) {
    return decodeSessionBoundaryView({
      schemaVersion: '1.0.0',
      authenticationAdapter: 'local_owner',
      connectivityState: 'ONLINE',
      authenticationState: 'authentication_unavailable',
      sessionState: 'UNAVAILABLE',
      backendReadiness: 'UNAVAILABLE',
      reasonCode: 'PROVISIONING_FAILED',
      recoveryActions: [
        { id: 'RECONNECT', label: '다시 연결', enabled: true },
        { id: 'CHECK_SETTINGS', label: '설정 확인', enabled: true },
      ],
      session: null,
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return decodeSessionBoundaryView({
      schemaVersion: '1.0.0',
      authenticationAdapter: 'local_owner',
      connectivityState: 'ONLINE',
      authenticationState: 'authentication_unavailable',
      sessionState: 'ESTABLISHING',
      backendReadiness: 'DEGRADED',
      reasonCode: 'LOCAL_SESSION_ESTABLISHING',
      recoveryActions: [],
      session: null,
    });
  }

  if (error instanceof ShotgunApiError) {
    if (error.code === 'LOCAL_BOOTSTRAP_DISABLED') {
      return decodeSessionBoundaryView({
        schemaVersion: '1.0.0',
        authenticationAdapter: 'local_owner',
        connectivityState: 'ONLINE',
        authenticationState: 'authentication_unavailable',
        sessionState: 'UNAVAILABLE',
        backendReadiness: 'READY',
        reasonCode: 'LOCAL_OWNER_DISABLED',
        recoveryActions: [
          { id: 'CHECK_SETTINGS', label: '설정 확인', enabled: true },
          { id: 'RECONNECT', label: '다시 연결', enabled: true },
        ],
        session: null,
      });
    }

    if (error.code === 'LOCAL_BOOTSTRAP_FORBIDDEN') {
      return decodeSessionBoundaryView({
        schemaVersion: '1.0.0',
        authenticationAdapter: 'local_owner',
        connectivityState: 'ONLINE',
        authenticationState: 'authentication_unavailable',
        sessionState: 'UNAVAILABLE',
        backendReadiness: 'READY',
        reasonCode: 'ORIGIN_NOT_ALLOWED',
        recoveryActions: [{ id: 'CHECK_SETTINGS', label: '설정 확인', enabled: true }],
        session: null,
      });
    }

    if (error.code === 'LOCAL_BOOTSTRAP_FAILED') {
      return decodeSessionBoundaryView({
        schemaVersion: '1.0.0',
        authenticationAdapter: 'local_owner',
        connectivityState: 'ONLINE',
        authenticationState: 'authentication_unavailable',
        sessionState: 'UNAVAILABLE',
        backendReadiness: 'READY',
        reasonCode: 'PROVISIONING_FAILED',
        recoveryActions: [
          { id: 'RECONNECT', label: '다시 연결', enabled: true },
          { id: 'CHECK_SETTINGS', label: '설정 확인', enabled: true },
        ],
        session: null,
      });
    }

    if (error.status === 401) {
      return decodeSessionBoundaryView({
        schemaVersion: '1.0.0',
        authenticationAdapter: 'local_owner',
        connectivityState: 'ONLINE',
        authenticationState: 'authentication_required',
        sessionState: 'REVOKED',
        backendReadiness: 'READY',
        reasonCode: 'SESSION_REVOKED',
        recoveryActions: [{ id: 'RECONNECT', label: '다시 연결', enabled: true }],
        session: null,
      });
    }
  }

  return decodeSessionBoundaryView({
    schemaVersion: '1.0.0',
    authenticationAdapter: 'local_owner',
    connectivityState: 'ONLINE',
    authenticationState: 'authentication_unavailable',
    sessionState: 'UNAVAILABLE',
    backendReadiness: 'UNAVAILABLE',
    reasonCode: 'LOCAL_SERVER_UNAVAILABLE',
    recoveryActions: [
      { id: 'RECONNECT', label: '다시 연결', enabled: true },
      { id: 'CHECK_LOCAL_SERVER', label: '로컬 서버 상태 확인', enabled: true },
    ],
    session: null,
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

    async getSessionBoundary(requestOptions?: RequestOptions): Promise<SessionBoundaryView> {
      try {
        const response = await request('/session', { signal: requestOptions?.signal });
        const session = decodeSessionEnvelope(await assertOk(response));
        return decodeSessionBoundaryView({
          schemaVersion: '1.0.0',
          authenticationAdapter: 'local_owner',
          connectivityState: 'ONLINE',
          authenticationState: 'authenticated',
          sessionState: 'READY',
          backendReadiness: 'READY',
          reasonCode: 'LOCAL_SESSION_READY',
          recoveryActions: [],
          session,
        });
      } catch (error) {
        return mapErrorToSessionBoundaryView(error);
      }
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
