import {
  createProductFailureEnvelope,
  getFailureDescriptor,
  isErrorCode,
  type ErrorCode,
  type FailureCategory,
  type FailureRecovery,
  type FailureRetryability,
  type ProductFailureEnvelope,
} from '../../contracts/src/index.js';

export type ClientFailureCode =
  | 'REMOTE_UNCLASSIFIED'
  | 'INVALID_PRODUCT_API_RESPONSE'
  | 'LOCAL_BOOTSTRAP_DISABLED'
  | 'LOCAL_BOOTSTRAP_FORBIDDEN'
  | 'LOCAL_BOOTSTRAP_FAILED'
  | 'LOCAL_SERVER_UNAVAILABLE';

export type ShotgunApiErrorCode = ErrorCode | ClientFailureCode;

type ClientFailureDescriptor = {
  readonly category: FailureCategory;
  readonly retryability: FailureRetryability;
  readonly recovery: FailureRecovery;
};

const CLIENT_FAILURE_DESCRIPTORS = {
  REMOTE_UNCLASSIFIED: {
    category: 'TERMINAL',
    retryability: 'NEVER',
    recovery: 'CONTACT_SUPPORT',
  },
  INVALID_PRODUCT_API_RESPONSE: {
    category: 'TERMINAL',
    retryability: 'NEVER',
    recovery: 'CONTACT_SUPPORT',
  },
  LOCAL_BOOTSTRAP_DISABLED: {
    category: 'VALIDATION',
    retryability: 'NEVER',
    recovery: 'FIX_REQUEST',
  },
  LOCAL_BOOTSTRAP_FORBIDDEN: {
    category: 'AUTHORIZATION',
    retryability: 'NEVER',
    recovery: 'REQUEST_ACCESS',
  },
  LOCAL_BOOTSTRAP_FAILED: {
    category: 'TERMINAL',
    retryability: 'UNKNOWN',
    recovery: 'CONTACT_SUPPORT',
  },
  LOCAL_SERVER_UNAVAILABLE: {
    category: 'DEPENDENCY',
    retryability: 'SAFE',
    recovery: 'RETRY',
  },
} satisfies Record<ClientFailureCode, ClientFailureDescriptor>;

const descriptorFor = (code: ShotgunApiErrorCode): ClientFailureDescriptor =>
  isErrorCode(code) ? getFailureDescriptor(code) : CLIENT_FAILURE_DESCRIPTORS[code];

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
    readonly category?: FailureCategory;
    readonly retryability?: FailureRetryability;
    readonly recovery?: FailureRecovery;
    readonly message: string;
    readonly correlationId?: string;
    readonly clientRequestId?: string;
    readonly failure?: ProductFailureEnvelope;
  }) {
    super(input.message);
    const descriptor = descriptorFor(input.code);
    this.name = 'ShotgunApiError';
    this.status = input.status;
    this.code = input.code;
    this.category = input.category ?? descriptor.category;
    this.retryability = input.retryability ?? descriptor.retryability;
    this.recovery = input.recovery ?? descriptor.recovery;
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
    message: 'Remote Product API failure could not be decoded.',
  });

export const invalidProductApiResponse = (): ShotgunApiError =>
  new ShotgunApiError({
    status: 502,
    code: 'INVALID_PRODUCT_API_RESPONSE',
    message: 'Invalid Product API Response',
  });
