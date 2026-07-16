export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'POLICY_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STALE_VERSION'
  | 'STALE_APPROVAL'
  | 'RETRYABLE_DEPENDENCY'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'OUTCOME_UNKNOWN'
  | 'TERMINAL_FAILURE'
  | 'UNSUPPORTED_SCHEMA'
  | 'REPLAY_BLOCKED';

export type ShotgunErrorInput = {
  readonly code: ErrorCode;
  readonly safeMessage: string;
  readonly module: string;
  readonly operation: string;
  readonly correlationId?: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
};

export class ShotgunError extends Error {
  readonly code: ErrorCode;
  readonly safeMessage: string;
  readonly module: string;
  readonly operation: string;
  readonly correlationId?: string;
  readonly retryable: boolean;

  constructor(input: ShotgunErrorInput) {
    super(input.safeMessage, { cause: input.cause });
    this.name = 'ShotgunError';
    this.code = input.code;
    this.safeMessage = input.safeMessage;
    this.module = input.module;
    this.operation = input.operation;
    this.correlationId = input.correlationId;
    this.retryable = input.retryable ?? false;
  }
}

export const toShotgunError = (
  error: unknown,
  fallback: Omit<ShotgunErrorInput, 'cause'>,
): ShotgunError =>
  error instanceof ShotgunError
    ? error
    : new ShotgunError({
        ...fallback,
        cause: error,
      });
