import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import { ShotgunError } from '../../../packages/contracts/src/index.js';

export type UrlAcquisitionLimits = {
  readonly maxRedirects: number;
  readonly connectTimeoutMs: number;
  readonly headerTimeoutMs: number;
  readonly bodyTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxCompressedBytes: number;
  readonly maxDecompressedBytes: number;
};

export type UrlResolverPort = {
  resolve(hostname: string): Promise<readonly string[]>;
};

export type UrlHopResponse = {
  readonly status: number;
  readonly connectedAddress: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: Uint8Array;
  readonly compressedBytes: number;
  readonly redirectLocation?: string;
};

export type UrlHopTransportPort = {
  request(input: {
    readonly url: string;
    readonly approvedAddresses: readonly string[];
    readonly headers: Readonly<Record<string, never>>;
    readonly limits: UrlAcquisitionLimits;
  }): Promise<UrlHopResponse>;
};

export type UrlAcquisitionReceipt = {
  readonly normalizedRequestedUrl: string;
  readonly redactedRequestedUrl: string;
  readonly redactedFinalUrl: string;
  readonly redirectChainDigest: string;
  readonly redirectObservations: readonly {
    readonly ordinal: number;
    readonly from: string;
    readonly to: string;
    readonly status: number;
  }[];
  readonly dnsObservations: readonly {
    readonly ordinal: number;
    readonly host: string;
    readonly addressFamily: 4 | 6;
    readonly addressClass: 'public';
    readonly addressSetDigest: string;
  }[];
  readonly responseStatus: number;
  readonly responseContentType: 'text/plain' | 'text/markdown';
  readonly responseContentLength: number;
  readonly compressedBytes: number;
  readonly decompressedBytes: number;
  readonly responseMetadata: Readonly<Record<string, string>>;
  readonly contentHash: string;
  readonly body: Uint8Array;
};

const sensitiveQueryKey =
  /^(?:access[_-]?token|api[_-]?key|apikey|auth|authorization|cookie|credential|key|password|passwd|secret|session|sig|signature|token)$/i;
const credentialValue =
  /(?:^|[^a-z])(?:bearer|basic|token|secret|password|passwd|api[_-]?key)[=: ]/i;
const sha256 = (value: string | Uint8Array): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const fail = (message: string, operation: string, code = 'POLICY_DENIED'): never => {
  throw new ShotgunError({
    code: code as 'POLICY_DENIED' | 'VALIDATION_ERROR',
    safeMessage: message,
    module: 'url-acquisition',
    operation,
  });
};

const ipv4Number = (value: string): number =>
  value
    .split('.')
    .map(Number)
    .reduce((result, part) => ((result << 8) | part) >>> 0, 0);

const ipv4In = (value: number, base: string, prefix: number): boolean => {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (ipv4Number(base) & mask);
};

const publicIpv4 = (address: string): boolean => {
  const value = ipv4Number(address);
  return ![
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ].some(([base, prefix]) => ipv4In(value, base as string, prefix as number));
};

const publicIpv6 = (address: string): boolean => {
  const normalized = address.toLocaleLowerCase();
  if (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  ) {
    return false;
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? publicIpv4(mapped) : true;
};

export const isPublicAcquisitionAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return publicIpv4(address);
  if (family === 6) return publicIpv6(address);
  return false;
};

const normalizedAddressSet = (addresses: readonly string[]): readonly string[] =>
  [...new Set(addresses.map((address) => address.toLocaleLowerCase()))].sort();

const assertAddressSet = (addresses: readonly string[]): readonly string[] => {
  const normalized = normalizedAddressSet(addresses);
  if (
    normalized.length === 0 ||
    normalized.some((address) => !isPublicAcquisitionAddress(address))
  ) {
    return fail(
      'URL acquisition resolved to a prohibited or empty address set.',
      'validate-address',
    );
  }
  return normalized;
};

const redact = (url: URL): string => {
  const copy = new URL(url.toString());
  for (const key of [...copy.searchParams.keys()]) copy.searchParams.set(key, '[REDACTED]');
  return copy.toString();
};

const normalize = (value: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail('URL acquisition requires a valid absolute URL.', 'parse-url', 'VALIDATION_ERROR');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return fail('URL acquisition permits only HTTP and HTTPS.', 'validate-protocol');
  }
  if (parsed.username || parsed.password) {
    return fail('URL userinfo credentials are prohibited.', 'validate-userinfo');
  }
  if (parsed.hash)
    return fail('URL fragments are prohibited for acquisition.', 'validate-fragment');
  for (const [key, value] of parsed.searchParams) {
    if (sensitiveQueryKey.test(key) || credentialValue.test(value)) {
      return fail('Credential-shaped URL query parameters are prohibited.', 'validate-query');
    }
  }
  parsed.hostname = parsed.hostname.toLocaleLowerCase();
  return parsed;
};

const contentType = (value: string | undefined): 'text/plain' | 'text/markdown' => {
  const normalized = value?.split(';', 1)[0]?.trim().toLocaleLowerCase();
  if (normalized === 'text/plain' || normalized === 'text/markdown') return normalized;
  return fail(
    'URL response content type is not supported.',
    'validate-content-type',
    'VALIDATION_ERROR',
  );
};

export class SecureUrlAcquisitionCoordinator {
  constructor(
    private readonly resolver: UrlResolverPort,
    private readonly transport: UrlHopTransportPort,
  ) {}

  async acquire(input: {
    readonly requestedUrl: string;
    readonly limits: UrlAcquisitionLimits;
  }): Promise<UrlAcquisitionReceipt> {
    if (
      input.limits.maxRedirects < 0 ||
      input.limits.maxRedirects > 20 ||
      input.limits.maxCompressedBytes <= 0 ||
      input.limits.maxCompressedBytes > 1_048_576 ||
      input.limits.maxDecompressedBytes <= 0 ||
      input.limits.maxDecompressedBytes > 1_048_576
    ) {
      return fail('URL acquisition limits are outside the approved boundary.', 'validate-limits');
    }

    const requested = normalize(input.requestedUrl);
    let current = requested;
    const visited = new Set<string>();
    const redirects: UrlAcquisitionReceipt['redirectObservations'][number][] = [];
    const dns: UrlAcquisitionReceipt['dnsObservations'][number][] = [];

    for (let ordinal = 0; ; ordinal += 1) {
      if (visited.has(current.toString())) {
        return fail('URL acquisition redirect loop detected.', 'redirect-loop');
      }
      visited.add(current.toString());
      const approved = assertAddressSet(await this.resolver.resolve(current.hostname));
      const addressSetDigest = sha256(approved.join('\n'));
      dns.push(
        ...approved.map((address) => ({
          ordinal,
          host: current.hostname,
          addressFamily: isIP(address) as 4 | 6,
          addressClass: 'public' as const,
          addressSetDigest,
        })),
      );

      const response = await this.transport.request({
        url: current.toString(),
        approvedAddresses: approved,
        headers: {},
        limits: input.limits,
      });
      if (!approved.includes(response.connectedAddress.toLocaleLowerCase())) {
        return fail(
          'URL transport connected to an address outside the approved DNS set.',
          'dns-pin',
        );
      }
      const after = assertAddressSet(await this.resolver.resolve(current.hostname));
      if (sha256(after.join('\n')) !== addressSetDigest) {
        return fail('URL DNS address set changed during acquisition.', 'dns-rebinding');
      }

      if (
        response.redirectLocation !== undefined ||
        (response.status >= 300 && response.status < 400)
      ) {
        if (!response.redirectLocation) {
          return fail('URL redirect response is missing a Location value.', 'redirect-location');
        }
        if (ordinal >= input.limits.maxRedirects) {
          return fail('URL acquisition exceeded the redirect limit.', 'redirect-limit');
        }
        const next = normalize(new URL(response.redirectLocation, current).toString());
        redirects.push({
          ordinal,
          from: redact(current),
          to: redact(next),
          status: response.status,
        });
        current = next;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        return fail(
          'URL response status is not successful.',
          'response-status',
          'VALIDATION_ERROR',
        );
      }
      if (
        response.compressedBytes > input.limits.maxCompressedBytes ||
        response.body.byteLength > input.limits.maxDecompressedBytes
      ) {
        return fail(
          'URL response exceeds the approved byte limits.',
          'response-size',
          'VALIDATION_ERROR',
        );
      }
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > input.limits.maxCompressedBytes) {
        return fail(
          'URL response declares an oversized body.',
          'content-length',
          'VALIDATION_ERROR',
        );
      }
      const mediaType = contentType(response.headers['content-type']);
      const responseMetadata: Record<string, string> = {};
      for (const key of ['cache-control', 'etag', 'last-modified'] as const) {
        const value = response.headers[key];
        if (value !== undefined) responseMetadata[key] = value.slice(0, 1024);
      }
      return {
        normalizedRequestedUrl: requested.toString(),
        redactedRequestedUrl: redact(requested),
        redactedFinalUrl: redact(current),
        redirectChainDigest: sha256(JSON.stringify(redirects)),
        redirectObservations: redirects,
        dnsObservations: dns,
        responseStatus: response.status,
        responseContentType: mediaType,
        responseContentLength: response.body.byteLength,
        compressedBytes: response.compressedBytes,
        decompressedBytes: response.body.byteLength,
        responseMetadata,
        contentHash: sha256(response.body),
        body: response.body,
      };
    }
  }
}
