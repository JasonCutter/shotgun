export class ShotgunApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId?: string;

  constructor(input: {
    readonly status: number;
    readonly code: string;
    readonly message: string;
    readonly correlationId?: string;
  }) {
    super(input.message);
    this.name = 'ShotgunApiError';
    this.status = input.status;
    this.code = input.code;
    this.correlationId = input.correlationId;
  }
}

export const invalidProductApiResponse = (): ShotgunApiError =>
  new ShotgunApiError({
    status: 502,
    code: 'INVALID_PRODUCT_API_RESPONSE',
    message: 'Invalid Product API Response',
  });
