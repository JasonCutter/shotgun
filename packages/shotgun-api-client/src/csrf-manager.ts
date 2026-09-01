import { decodeCsrfEnvelope, decodeProductApiErrorBody } from './decode.js';
import {
  ShotgunApiError,
  productFailureApiError,
  remoteUnclassifiedProductApiFailure,
} from './errors.js';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const abortErrorFor = (signal: AbortSignal): Error => {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('The protected request was aborted.');
  error.name = 'AbortError';
  return error;
};

const waitForPreceding = (preceding: Promise<void>, signal?: AbortSignal): Promise<void> => {
  if (!signal) return preceding;
  if (signal.aborted) return Promise.reject(abortErrorFor(signal));
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortErrorFor(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void preceding.then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
};

export type CsrfMutationOptions<T> = {
  readonly signal?: AbortSignal;
  readonly recoverOnResponse?: (result: T) => boolean | Promise<boolean>;
};

export type CsrfMutationManager = {
  run<T>(mutation: (csrfToken: string) => Promise<T>, options?: CsrfMutationOptions<T>): Promise<T>;
  invalidate(): void;
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const acquireCsrfToken = async (
  fetchImplementation: FetchImplementation,
  signal?: AbortSignal,
): Promise<string> => {
  const response = await fetchImplementation('/api/v1/security/csrf', {
    credentials: 'same-origin',
    signal,
  });
  const body = await readJson(response);
  if (!response.ok) {
    const failure = decodeProductApiErrorBody(body);
    if (!failure) throw remoteUnclassifiedProductApiFailure(response.status);
    throw productFailureApiError(response.status, failure);
  }
  return decodeCsrfEnvelope(body);
};

export const isCsrfFailureResponse = async (response: Response): Promise<boolean> => {
  if (response.status !== 403) return false;
  try {
    const body = await readJson(response.clone());
    return decodeProductApiErrorBody(body)?.code === 'REQUEST_ORIGIN_DENIED';
  } catch {
    return false;
  }
};

export const isCsrfFailureError = (error: unknown): boolean =>
  error instanceof ShotgunApiError && error.code === 'REQUEST_ORIGIN_DENIED';

export const createCsrfMutationManager = (
  fetchImplementation: FetchImplementation = globalThis.fetch,
): CsrfMutationManager => {
  let tail: Promise<void> = Promise.resolve();
  let csrfToken: string | undefined;

  return {
    async run<T>(
      mutation: (csrfToken: string) => Promise<T>,
      options: CsrfMutationOptions<T> = {},
    ): Promise<T> {
      const preceding = tail;
      let release = (): void => undefined;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        await waitForPreceding(preceding, options.signal);
        let recovered = false;
        while (true) {
          const token = csrfToken ?? (await acquireCsrfToken(fetchImplementation, options.signal));
          try {
            const result = await mutation(token);
            if (
              !recovered &&
              options.recoverOnResponse !== undefined &&
              (await options.recoverOnResponse(result))
            ) {
              csrfToken = undefined;
              recovered = true;
              continue;
            }
            csrfToken = token;
            return result;
          } catch (error) {
            if (!recovered && isCsrfFailureError(error)) {
              csrfToken = undefined;
              recovered = true;
              continue;
            }
            throw error;
          }
        }
      } finally {
        release();
      }
    },
    invalidate(): void {
      csrfToken = undefined;
    },
  };
};

const sharedManagers = new WeakMap<FetchImplementation, CsrfMutationManager>();

export const getSharedCsrfMutationManager = (
  fetchImplementation: FetchImplementation = globalThis.fetch,
): CsrfMutationManager => {
  const existing = sharedManagers.get(fetchImplementation);
  if (existing) return existing;
  const manager = createCsrfMutationManager(fetchImplementation);
  sharedManagers.set(fetchImplementation, manager);
  return manager;
};
