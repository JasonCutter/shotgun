import { assertSurferJson, surferFailure } from './surfer-learning.js';
export type SurferReadinessState =
  | 'NOT_CONFIGURED'
  | 'EXTERNAL_EXECUTION'
  | 'PROFILE_CONNECTED'
  | 'CONFIGURATION_CHANGED'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'ACCOUNT_REVIEW_REQUIRED'
  | 'RUN_EXPIRED'
  | 'UNAVAILABLE';
/** Metadata only. No provider probe,send grant or Source/semantic acceptance. */
export type SurferReadiness = { schemaVersion: '1.0.0'; state: SurferReadinessState };
export function decodeSurferReadiness(value: unknown): SurferReadiness {
  assertSurferJson(value);
  const r = value as SurferReadiness;
  if (
    !r ||
    Object.keys(r).sort().join(',') !== 'schemaVersion,state' ||
    r.schemaVersion !== '1.0.0' ||
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
    throw surferFailure('Invalid Surfer readiness metadata.');
  return { schemaVersion: '1.0.0', state: r.state };
}
export function decodeSurferReadinessQuery(value: unknown): void {
  assertSurferJson(value);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length)
    throw surferFailure('Readiness accepts an empty request only.');
}
