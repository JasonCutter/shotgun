import { FrontendContractError } from '../../../packages/contracts/src/index.js';

/**
 * FE-P5-S1 Activity adapter error. Adapter failures are surfaced as partial or
 * degraded projection results, never fabricated success (Contract Snapshot §3
 * and §9, AC-10). `safe` carries only allow-listed, non-disclosing details.
 */

export type ActivityAdapterErrorCode =
  'ACTIVITY_ADAPTER_UNAVAILABLE' | 'ACTIVITY_ADAPTER_DEGRADED' | 'ACTIVITY_ADAPTER_INVALID_READ';

export class ActivityAdapterError extends Error {
  readonly code: ActivityAdapterErrorCode;
  readonly adapterId: string;
  readonly domainKind: 'SOURCES' | 'ASK' | 'EXTERNAL_ACTION';
  readonly safe: boolean;

  constructor(input: {
    readonly code: ActivityAdapterErrorCode;
    readonly adapterId: string;
    readonly domainKind: 'SOURCES' | 'ASK' | 'EXTERNAL_ACTION';
    readonly message: string;
    readonly safe?: boolean;
  }) {
    super(input.message);
    this.name = 'ActivityAdapterError';
    this.code = input.code;
    this.adapterId = input.adapterId;
    this.domainKind = input.domainKind;
    this.safe = input.safe ?? true;
  }
}

/** Convert a caught adapter error into a typed ActivityAdapterError. */
export const asActivityAdapterError = (input: {
  readonly adapterId: string;
  readonly domainKind: 'SOURCES' | 'ASK' | 'EXTERNAL_ACTION';
  readonly error: unknown;
}): ActivityAdapterError => {
  if (input.error instanceof ActivityAdapterError) return input.error;
  const message =
    input.error instanceof Error ? input.error.message : 'Activity adapter read failed';
  return new ActivityAdapterError({
    code: 'ACTIVITY_ADAPTER_DEGRADED',
    adapterId: input.adapterId,
    domainKind: input.domainKind,
    message,
  });
};

/** Activity decoders surface contract errors through the shared class. */
export { FrontendContractError };
