import {
  type SurferAccountAuthorityConfigV2 as SurferAccountAuthorityConfig,
  decodeSurferAccountAuthorityConfigV2 as decodeSurferAccountAuthorityConfig,
} from './surfer-account-authority-v2.js';
import { assertSurferJson, surferFailure } from './surfer-learning.js';

export type SurferTransportDiagnostic = {
  schemaVersion: '1.0.0';
  phase: 'HEADERS' | 'BODY';
  classification:
    'DNS' | 'CONNECTION' | 'TLS' | 'TIMEOUT' | 'CANCELLED' | 'HTTP' | 'RESPONSE_DECODE' | 'UNKNOWN';
  errorName:
    | 'Error'
    | 'TypeError'
    | 'SyntaxError'
    | 'AbortError'
    | 'TimeoutError'
    | 'AggregateError'
    | 'UNKNOWN';
  codes: string[];
  responseStatus: number | null;
  delivery: 'UNCONFIRMED' | 'RESPONSE_HEADERS_RECEIVED';
  causeChainTruncated: boolean;
  retryPermitted: false;
};
export type SurferAccountCloseoutRequest = {
  schemaVersion: '1.0.0';
  config: SurferAccountAuthorityConfig;
  legacyAuthorityId: string;
  stoppedRunId: string;
  closureRef: string;
};
export type SurferAccountCloseoutReceipt = {
  schemaVersion: '1.0.0';
  rootId: string;
  registrationId: string;
  stoppedRunId: string;
  closureRef: string;
  rootDisabled: true;
  registrationDisabled: true;
  legacyLinkAbsent: true;
  alreadyClosed: boolean;
  grantsPreserved: number;
  unsettledGrantsPreserved: number;
  counterDigest: string;
  grantDigest: string;
  legacyDigest: string;
};
/** Operator management capability; the runtime role is intentionally not granted these writes. */
export interface SurferAccountCloseoutPort {
  close(request: SurferAccountCloseoutRequest): Promise<SurferAccountCloseoutReceipt>;
}
export function decodeSurferAccountCloseout(input: unknown): SurferAccountCloseoutRequest {
  assertSurferJson(input);
  const r = structuredClone(input) as SurferAccountCloseoutRequest;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  if (
    !r ||
    Object.keys(r).sort().join(',') !==
      'closureRef,config,legacyAuthorityId,schemaVersion,stoppedRunId' ||
    r.schemaVersion !== '1.0.0' ||
    !uuid.test(r.legacyAuthorityId) ||
    !uuid.test(r.stoppedRunId) ||
    typeof r.closureRef !== 'string' ||
    !r.closureRef ||
    r.closureRef.length > 256
  )
    throw surferFailure('Invalid exact account closeout scope.');
  r.config = decodeSurferAccountAuthorityConfig(r.config);
  return r;
}
