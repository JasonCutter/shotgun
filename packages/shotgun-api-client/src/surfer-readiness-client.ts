import type {
  SurferReadiness,
  SurferReadinessState,
} from '../../contracts/src/surfer-readiness.js';
import { getSharedCsrfMutationManager, isCsrfFailureResponse } from './csrf-manager.js';
export type { SurferReadiness, SurferReadinessState };
export interface SurferReadinessClient {
  inspect(signal?: AbortSignal): Promise<SurferReadiness>;
}
/** Metadata-only POST. No project/credential/profile/admin command leaves the browser. */
export function createSurferReadinessClient(
  fetcher: typeof fetch = globalThis.fetch,
): SurferReadinessClient {
  const csrf = getSharedCsrfMutationManager(fetcher);
  return {
    inspect: async (signal) => {
      const response = await csrf.run(
        (token) =>
          fetcher('/api/v1/surfer/execution/readiness', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-csrf-token': token },
            body: '{}',
            signal,
          }),
        { signal, recoverOnResponse: isCsrfFailureResponse },
      );
      const text = await response.text();
      if (text.length > 4096 || !response.ok)
        throw Error('Surfer execution settings could not be checked.');
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw Error('Invalid Surfer readiness metadata.');
      }
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Invalid Surfer readiness metadata.');
      const r = value as Record<string, unknown>;
      if (
        Object.keys(r).sort().join(',') !== 'schemaVersion,state' ||
        r.schemaVersion !== '1.0.0' ||
        typeof r.state !== 'string' ||
        ![
          'NOT_CONFIGURED',
          'EXTERNAL_EXECUTION',
          'PROFILE_CONNECTED',
          'CONFIGURATION_CHANGED',
          'CREDENTIAL_UNAVAILABLE',
          'ACCOUNT_REVIEW_REQUIRED',
          'RUN_EXPIRED',
          'UNAVAILABLE',
        ].includes(r.state)
      )
        throw Error('Invalid Surfer readiness metadata.');
      return { schemaVersion: '1.0.0', state: r.state as SurferReadinessState };
    },
  };
}
