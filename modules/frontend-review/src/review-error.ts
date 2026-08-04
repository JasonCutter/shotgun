import type { ErrorCode } from '../../../packages/contracts/src/index.js';

/**
 * FE-P4-S1 Review domain error. `apiCode` maps one-to-one to the shared typed
 * Product failure envelope codes registered in `failure-contract.ts`.
 */
export class ReviewCommandError extends Error {
  readonly apiCode: ErrorCode;

  constructor(apiCode: ErrorCode, message: string) {
    super(message);
    this.name = 'ReviewCommandError';
    this.apiCode = apiCode;
  }
}

export function reviewFailure(code: ErrorCode, message: string): never {
  throw new ReviewCommandError(code, message);
}
