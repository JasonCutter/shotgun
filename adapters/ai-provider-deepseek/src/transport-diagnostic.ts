import type { SurferTransportDiagnostic } from '../../../packages/contracts/src/surfer-runtime-controls.js';
const codes = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ABORT_ERR',
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'OUTCOME_UNKNOWN',
  'TIMEOUT',
  'RETRYABLE_DEPENDENCY',
  'TERMINAL_FAILURE',
]);
const names = new Set([
  'Error',
  'TypeError',
  'SyntaxError',
  'AbortError',
  'TimeoutError',
  'AggregateError',
]);
/** Reads data descriptors only: never error messages, URLs, bodies, headers or accessor values. */
function data(value: unknown, key: string): unknown {
  try {
    return value && typeof value === 'object'
      ? Object.getOwnPropertyDescriptor(value, key)?.value
      : undefined;
  } catch {
    return undefined;
  }
}
function name(value: unknown): SurferTransportDiagnostic['errorName'] {
  let v = value;
  for (let i = 0; i < 3 && v && typeof v === 'object'; i++) {
    const n = data(v, 'name');
    if (typeof n === 'string' && names.has(n)) return n as SurferTransportDiagnostic['errorName'];
    try {
      v = Object.getPrototypeOf(v);
    } catch {
      return 'UNKNOWN';
    }
  }
  return 'UNKNOWN';
}
export function observeSurferTransportFailure(
  error: unknown,
  context: {
    phase: 'HEADERS' | 'BODY';
    status: number | null;
    timedOut: boolean;
    aborted: boolean;
  },
): SurferTransportDiagnostic {
  let current = error,
    truncated = false;
  const seen = new Set<unknown>(),
    found: string[] = [];
  for (let i = 0; current && typeof current === 'object'; i++) {
    if (i === 5 || seen.has(current)) {
      truncated = true;
      break;
    }
    seen.add(current);
    const code = data(current, 'code');
    if (typeof code === 'string' && codes.has(code) && !found.includes(code)) found.push(code);
    current = data(current, 'cause');
  }
  const status =
    Number.isInteger(context.status) &&
    Number(context.status) >= 100 &&
    Number(context.status) <= 599
      ? context.status
      : null;
  const errorName = name(error);
  const classification: SurferTransportDiagnostic['classification'] = context.timedOut
    ? 'TIMEOUT'
    : context.aborted
      ? 'CANCELLED'
      : status !== null && status >= 400
        ? 'HTTP'
        : found.some((c) => c === 'ENOTFOUND' || c === 'EAI_AGAIN')
          ? 'DNS'
          : found.some(
                (c) =>
                  c.startsWith('ERR_TLS_') ||
                  [
                    'CERT_HAS_EXPIRED',
                    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
                    'DEPTH_ZERO_SELF_SIGNED_CERT',
                  ].includes(c),
              )
            ? 'TLS'
            : found.some((c) => c === 'ETIMEDOUT' || c.includes('_TIMEOUT'))
              ? 'TIMEOUT'
              : found.some((c) =>
                    [
                      'ECONNREFUSED',
                      'ECONNRESET',
                      'EPIPE',
                      'ENETUNREACH',
                      'EHOSTUNREACH',
                      'UND_ERR_SOCKET',
                    ].includes(c),
                  )
                ? 'CONNECTION'
                : context.phase === 'BODY' &&
                    (errorName === 'SyntaxError' || found.includes('VALIDATION_ERROR'))
                  ? 'RESPONSE_DECODE'
                  : 'UNKNOWN';
  return {
    schemaVersion: '1.0.0',
    phase: context.phase,
    classification,
    errorName,
    codes: found,
    responseStatus: status,
    delivery: status === null ? 'UNCONFIRMED' : 'RESPONSE_HEADERS_RECEIVED',
    causeChainTruncated: truncated,
    retryPermitted: false,
  };
}
