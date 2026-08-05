import type { ErrorCode } from '../../../packages/contracts/src/index.js';

/**
 * FE-P4-S2 External Action domain error. `apiCode` maps one-to-one to the
 * shared typed Product failure envelope codes registered in
 * `failure-contract.ts` (22 External Action reasons).
 */
export class ExternalActionCommandError extends Error {
  readonly apiCode: ErrorCode;

  constructor(apiCode: ErrorCode, message: string) {
    super(message);
    this.name = 'ExternalActionCommandError';
    this.apiCode = apiCode;
  }
}

export function externalActionFailure(code: ErrorCode, message: string): never {
  throw new ExternalActionCommandError(code, message);
}
