import {
  createProductFailureEnvelope,
  type ErrorCode,
  type FailureCategory,
  type FailureRecovery,
  type FailureRetryability,
  type ProductFailureEnvelope,
} from '../../contracts/src/index.js';

export type ShotgunApiErrorCode =
  | ErrorCode
  | 'REMOTE_UNCLASSIFIED'
  | 'INVALID_PRODUCT_API_RESPONSE';

export class ShotgunApiError extends Error {
  readonly status: number;
  readonly code: ShotgunApiErrorCode;
  readonly category: FailureCategory;
  readonly retryability: FailureRetryability;
  readonly recovery: FailureRecovery;
  readonly correlationId?: string;
  readonly clientRequestId?: string;
  readonly failure?: ProductFailureEnvelope;

  constructor(input: {
    readonly status: number;
    readonly code: ShotgunApiErrorCode;
    readonly category: FailureCategory;
    readonly retryability: FailureRetryability;
    readonly recovery: FailureRecovery;
    readonly message: string;
    readonly correlationId?: string;
    readonly clientRequestId?: string;
    readonly failure?: ProductFailureEnvelope;
  }) {
    super(input.message);
    this.name = 'ShotgunApiError';
    this.status = input.status;
    this.code = input.code;
    this.category = input.category;
    this.retryability = input.retryability;
    this.recovery = input.recovery;
    this.correlationId = input.correlationId;
    this.clientRequestId = input.clientRequestId;
    this.failure = input.failure;
  }
}

export const productFailureApiError = (
  status: number,
  failure: ProductFailureEnvelope,
  clientRequestId?: string,
): ShotgunApiError =>
  new ShotgunApiError({
    status,
    code: failure.code,
    category: failure.category,
    retryability: failure.retryability,
    recovery: failure.recovery,
    message: failure.message,
    ...(failure.correlationId === undefined ? {} : { correlationId: failure.correlationId }),
    ...(clientRequestId === undefined ? {} : { clientRequestId }),
    failure,
  });

export const outcomeIndeterminateApiError = (clientRequestId?: string): ShotgunApiError =>
  productFailureApiError(
    0,
    createProductFailureEnvelope({
      code: 'OUTCOME_INDETERMINATE',
      message:
        'The mutation response was not received. Resolve the existing outcome before retrying.',
    }),
    clientRequestId,
  );

export const remoteUnclassifiedProductApiFailure = (status: number): ShotgunApiError =>
  new ShotgunApiError({
    status,
    code: 'REMOTE_UNCLASSIFIED',
    category: 'TERMINAL',
    retryability: 'NEVER',
    recovery: 'CONTACT_SUPPORT',
    message: 'Remote Product API failure could not be decoded.',
  });

export const invalidProductApiResponse = (): ShotgunApiError =>
  new ShotgunApiError({
    status: 502,
    code: 'INVALID_PRODUCT_API_RESPONSE',
    category: 'TERMINAL',
    retryability: 'NEVER',
    recovery: 'CONTACT_SUPPORT',
    message: 'Invalid Product API Response',
  });
