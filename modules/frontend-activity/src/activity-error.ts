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
  readonly domainKind: 'SOURCES' | 'ASK' | 'EXTERNAL_ACTION' | 'DISCOVERY';
  readonly safe: boolean;

  constructor(input: {
    readonly code: ActivityAdapterErrorCode;
    readonly adapterId: string;
    readonly domainKind: 'SOURCES' | 'ASK' | 'EXTERNAL_ACTION' | 'DISCOVERY';
    readonly message: string;
    /** True only for explicitly allow-listed safe messages (ADR-130 §7). */
    readonly safe?: boolean;
  }) {
    super(input.message);
    this.name = 'ActivityAdapterError';
    this.code = input.code;
    this.adapterId = input.adapterId;
    this.domainKind = input.domainKind;
    // Fails closed: unknown exceptions are never treated as safe by default.
    this.safe = input.safe ?? false;
  }
}

/** Fixed, non-disclosing message for unrecognized adapter failures. */
export const ACTIVITY_ADAPTER_GENERIC_FAILURE_MESSAGE =
  'Activity adapter read failed; details are not disclosed';

/**
 * Convert a caught adapter error into a typed ActivityAdapterError.
 *
 * Recognized `ActivityAdapterError` instances pass through unchanged (their
 * `safe` flag is set by the allow-list at creation). Any other exception is
 * replaced by a fixed generic message: raw internals (queries, provider
 * responses, paths, identifiers, configuration) are never propagated.
 */
export const asActivityAdapterError = (input: {
  readonly adapterId: string;
  readonly domainKind: 'SOURCES' | 'ASK' | 'EXTERNAL_ACTION' | 'DISCOVERY';
  readonly error: unknown;
}): ActivityAdapterError => {
  if (input.error instanceof ActivityAdapterError) return input.error;
  return new ActivityAdapterError({
    code: 'ACTIVITY_ADAPTER_DEGRADED',
    adapterId: input.adapterId,
    domainKind: input.domainKind,
    message: ACTIVITY_ADAPTER_GENERIC_FAILURE_MESSAGE,
    safe: false,
  });
};

/** Activity decoders surface contract errors through the shared class. */
export { FrontendContractError };
