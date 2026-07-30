import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

import { ShotgunError } from '../../../packages/contracts/src/index.js';
import type {
  UrlHopResponse,
  UrlHopTransportPort,
  UrlResolverPort,
} from '../../../modules/url-acquisition/src/index.js';

const normalizedRemoteAddress = (address: string | undefined): string => {
  const value = address?.toLocaleLowerCase() ?? '';
  return value.startsWith('::ffff:') ? value.slice(7) : value;
};

const transportError = (error: unknown, operation: string): ShotgunError =>
  error instanceof ShotgunError
    ? error
    : new ShotgunError({
        code: 'RETRYABLE_DEPENDENCY',
        safeMessage: 'URL acquisition transport failed.',
        module: 'url-acquisition-node',
        operation,
        retryable: true,
        cause: error,
      });

type LookupOneCallback = (
  error: NodeJS.ErrnoException | null,
  address: string,
  family: 4 | 6,
) => void;
type LookupAllCallback = (
  error: NodeJS.ErrnoException | null,
  addresses: readonly { readonly address: string; readonly family: 4 | 6 }[],
) => void;

export class NodeUrlResolver implements UrlResolverPort {
  async resolve(hostname: string): Promise<readonly string[]> {
    try {
      const records = await lookup(hostname, { all: true, verbatim: true });
      return records.map((record) => record.address);
    } catch (error) {
      throw transportError(error, 'dns-lookup');
    }
  }
}

export class NodeUrlHopTransport implements UrlHopTransportPort {
  async request(input: Parameters<UrlHopTransportPort['request']>[0]): Promise<UrlHopResponse> {
    const parsed = new URL(input.url);
    const address = input.approvedAddresses[0];
    const addressFamily = address ? isIP(address) : 0;
    if (!address || (addressFamily !== 4 && addressFamily !== 6)) {
      throw new ShotgunError({
        code: 'POLICY_DENIED',
        safeMessage: 'URL acquisition has no approved destination address.',
        module: 'url-acquisition-node',
        operation: 'select-address',
      });
    }
    const family = addressFamily as 4 | 6;
    const client = parsed.protocol === 'https:' ? https : http;
    return new Promise<UrlHopResponse>((resolve, reject) => {
      let settled = false;
      let responseStarted = false;
      let connected = false;
      let terminalError: ShotgunError | undefined;
      const timers: {
        total?: NodeJS.Timeout;
        connect?: NodeJS.Timeout;
        header?: NodeJS.Timeout;
        body?: NodeJS.Timeout;
      } = {};

      const clearTimers = () => {
        if (timers.total) clearTimeout(timers.total);
        if (timers.connect) clearTimeout(timers.connect);
        if (timers.header) clearTimeout(timers.header);
        if (timers.body) clearTimeout(timers.body);
      };
      const finishError = (error: unknown, operation: string) => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(transportError(error, operation));
      };
      const timeout = (phase: string) =>
        new ShotgunError({
          code: 'TIMEOUT',
          safeMessage: `URL acquisition ${phase} timeout.`,
          module: 'url-acquisition-node',
          operation: `${phase}-timeout`,
          retryable: true,
        });
      const destroyWith = (request: http.ClientRequest, error: ShotgunError) => {
        terminalError = error;
        request.destroy(error);
      };

      const request = client.request(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          method: 'GET',
          path: `${parsed.pathname}${parsed.search}`,
          servername: parsed.protocol === 'https:' ? parsed.hostname : undefined,
          headers: {
            accept: 'text/plain, text/markdown;q=0.9',
            'accept-encoding': 'identity',
            'user-agent': 'Shotgun-Source-Acquisition/1.0',
          },
          lookup: (_hostname, options, callback) => {
            if (typeof options === 'object' && options.all === true) {
              (callback as LookupAllCallback)(null, [{ address, family }]);
              return;
            }
            (callback as LookupOneCallback)(null, address, family);
          },
          agent: false,
        },
        (response) => {
          responseStarted = true;
          if (timers.header) clearTimeout(timers.header);
          const encoding = response.headers['content-encoding'];
          if (encoding && encoding.toLocaleLowerCase() !== 'identity') {
            response.resume();
            finishError(
              new ShotgunError({
                code: 'VALIDATION_ERROR',
                safeMessage: 'Compressed URL responses are not accepted by this runtime.',
                module: 'url-acquisition-node',
                operation: 'content-encoding',
              }),
              'content-encoding',
            );
            return;
          }
          const chunks: Buffer[] = [];
          let received = 0;
          const resetBodyTimer = () => {
            if (timers.body) clearTimeout(timers.body);
            timers.body = setTimeout(() => {
              destroyWith(request, timeout('body'));
            }, input.limits.bodyTimeoutMs);
          };
          resetBodyTimer();
          response.on('data', (chunk: Buffer | Uint8Array | string) => {
            resetBodyTimer();
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            received += bytes.byteLength;
            if (received > input.limits.maxCompressedBytes) {
              destroyWith(
                request,
                new ShotgunError({
                  code: 'VALIDATION_ERROR',
                  safeMessage: 'URL response exceeds the approved byte limit.',
                  module: 'url-acquisition-node',
                  operation: 'stream-size-limit',
                }),
              );
              return;
            }
            chunks.push(bytes);
          });
          response.once('end', () => {
            if (settled) return;
            settled = true;
            clearTimers();
            const headers: Record<string, string | undefined> = {};
            for (const [key, value] of Object.entries(response.headers)) {
              headers[key.toLocaleLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
            }
            resolve({
              status: response.statusCode ?? 0,
              connectedAddress: normalizedRemoteAddress(response.socket.remoteAddress),
              headers,
              body: Buffer.concat(chunks),
              compressedBytes: received,
              ...(typeof response.headers.location === 'string'
                ? { redirectLocation: response.headers.location }
                : {}),
            });
          });
          response.once('error', (error) =>
            finishError(terminalError ?? error, 'response-stream'),
          );
        },
      );

      timers.total = setTimeout(
        () => destroyWith(request, timeout('total')),
        input.limits.totalTimeoutMs,
      );
      timers.connect = setTimeout(
        () => destroyWith(request, timeout('connect')),
        input.limits.connectTimeoutMs,
      );
      timers.header = setTimeout(
        () => destroyWith(request, timeout('header')),
        input.limits.headerTimeoutMs,
      );
      request.once('socket', (socket) => {
        const onConnected = () => {
          connected = true;
          if (timers.connect) clearTimeout(timers.connect);
        };
        socket.once(parsed.protocol === 'https:' ? 'secureConnect' : 'connect', onConnected);
      });
      request.once('error', (error) => {
        const phase = !connected ? 'connect' : !responseStarted ? 'headers' : 'request';
        finishError(terminalError ?? error, phase);
      });
      request.end();
    });
  }
}
