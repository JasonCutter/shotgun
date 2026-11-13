/** Ephemeral loopback operator UI. Never imported by the Shotgun app or a provider runtime. */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSurferJson } from '../packages/contracts/src/surfer-learning.js';
import { runSurferAccountAdmin } from './surfer-account-admin.js';
import { surferAccountConsolePage } from './surfer-account-console-page.js';

export function projectSurferConsoleReview(
  result: Awaited<ReturnType<typeof runSurferAccountAdmin>>,
) {
  if (
    result.kind === 'ROOT_RENEWAL' ||
    result.mode !== 'REVIEW' ||
    !('proposal' in result) ||
    !result.proposal
  )
    throw new Error('Review required.');
  // A deliberate allowlist. Do not send the command, environment, URL or profile to the page.
  return {
    requestDigest: result.requestDigest,
    kind: result.kind,
    action: result.action,
    commandId: result.commandId,
    rootId: result.rootId,
    rootExpiresAtMs: result.rootExpiresAtMs,
    dailyCallLimit: result.dailyCallLimit,
    proposal: structuredClone(result.proposal),
    currentState: structuredClone(result.currentState),
  };
}
export type SurferConsoleReview = ReturnType<typeof projectSurferConsoleReview>;
type Phase = 'REVIEW' | 'APPLYING' | 'CONFIRMED' | 'NOT_CONFIRMED';
export async function startSurferOperatorConsole(options: {
  review: SurferConsoleReview;
  apply(): Promise<{ current: boolean; replayed: boolean }>;
  lifetimeMs?: number;
}) {
  const review = structuredClone(options.review),
    lifetime = options.lifetimeMs ?? 600000;
  assertSurferJson(review);
  if (
    !/^sha256:[a-f0-9]{64}$/.test(review.requestDigest) ||
    !Number.isSafeInteger(lifetime) ||
    lifetime < 100 ||
    lifetime > 600000
  )
    throw new Error('Invalid operator session.');
  const token = randomBytes(32).toString('hex'),
    expiresAtMs = Date.now() + lifetime,
    hash = (content: string) => createHash('sha256').update(content).digest('base64'),
    script = /<script>([\s\S]*?)<\/script>/.exec(surferAccountConsolePage)![1]!,
    style = /<style>([\s\S]*?)<\/style>/.exec(surferAccountConsolePage)![1]!;
  let origin = '',
    phase: Phase = 'REVIEW',
    current = false,
    replayed = false,
    closing = false,
    inFlight: Promise<void> | undefined,
    closed: Promise<void> | undefined;
  const snapshot = () => ({
    schemaVersion: '1.0.0',
    phase,
    review,
    current,
    replayed,
    expiresAtMs,
  });
  const headers = (response: ServerResponse) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader(
      'content-security-policy',
      `default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    );
  };
  const json = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  };
  const read = async (request: IncomingMessage) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const b = Buffer.from(chunk);
      size += b.length;
      if (size > 4096) throw new Error('Body too large.');
      chunks.push(b);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assertSurferJson(value);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Object required.');
    return value as Record<string, unknown>;
  };
  const server = createServer((request, response) => {
    headers(response);
    void (async () => {
      const exactHost = request.headers.host === new URL(origin).host;
      if (!exactHost || closing || Date.now() >= expiresAtMs)
        return json(response, 403, { error: 'UNAVAILABLE' });
      if (request.method === 'GET' && request.url === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(surferAccountConsolePage);
        return;
      }
      const bearer = request.headers.authorization;
      if (
        request.method !== 'POST' ||
        !['/api/state', '/api/apply'].includes(request.url ?? '') ||
        request.headers.origin !== origin ||
        request.headers['content-type'] !== 'application/json' ||
        !bearer ||
        !/^Bearer [a-f0-9]{64}$/.test(bearer) ||
        !timingSafeEqual(Buffer.from(bearer.slice(7)), Buffer.from(token))
      )
        return json(response, 403, { error: 'UNAVAILABLE' });
      const body = await read(request);
      // Recheck after body I/O: expiration/stop cannot admit a new mutation.
      if (closing || Date.now() >= expiresAtMs)
        return json(response, 403, { error: 'UNAVAILABLE' });
      if (request.url === '/api/state') {
        if (Object.keys(body).length) return json(response, 400, { error: 'INVALID_REQUEST' });
        return json(response, 200, snapshot());
      }
      if (
        Object.keys(body).join(',') !== 'requestDigest' ||
        body.requestDigest !== review.requestDigest
      )
        return json(response, 400, { error: 'INVALID_REQUEST' });
      if (phase !== 'REVIEW') return json(response, 409, { error: 'ALREADY_ATTEMPTED' });
      phase = 'APPLYING';
      inFlight = (async () => {
        try {
          const result = await options.apply();
          if (typeof result.current !== 'boolean' || typeof result.replayed !== 'boolean')
            throw new Error('Unknown result.');
          current = result.current;
          replayed = result.replayed;
          phase = 'CONFIRMED';
        } catch {
          phase = 'NOT_CONFIRMED';
        }
      })();
      await inFlight;
      return json(response, 200, snapshot());
    })().catch(() => {
      if (!response.headersSent) json(response, 400, { error: 'INVALID_REQUEST' });
      else response.destroy();
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 16;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback unavailable.');
  origin = `http://127.0.0.1:${address.port}`;
  const close = () => {
    if (!closed) {
      closing = true;
      clearTimeout(timer);
      closed = (async () => {
        // Destroy idle/partial transports; the admitted operation is drained independently.
        const stopped = new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        server.closeAllConnections();
        await Promise.all([stopped, inFlight]);
      })();
    }
    return closed;
  };
  const timer = setTimeout(() => void close().catch(() => undefined), lifetime);
  timer.unref();
  return { url: origin + '/#' + token, close };
}
export async function openSurferAccountConsole(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) {
  if (args.length !== 3 || args[0] !== '--request-file' || !args[1] || args[2] !== '--serve-review')
    throw new Error('Explicit console arguments required.');
  const env = { ...environment },
    base = ['--request-file', args[1]],
    review = projectSurferConsoleReview(await runSurferAccountAdmin(base, env));
  return startSurferOperatorConsole({
    review,
    apply: async () => {
      const result = await runSurferAccountAdmin(
        [...base, '--apply-digest', review.requestDigest],
        env,
      );
      if (
        !('current' in result) ||
        typeof result.current !== 'boolean' ||
        typeof result.replayed !== 'boolean'
      )
        throw new Error('Unknown apply result.');
      return { current: result.current, replayed: result.replayed };
    },
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const console = await openSurferAccountConsole(process.argv.slice(2), process.env);
    process.stdout.write(
      JSON.stringify({ status: 'LOCAL_OPERATOR_CONSOLE', url: console.url, lifetimeSeconds: 600 }) +
        '\n',
    );
    const stop = () =>
      void console.close().catch(() => {
        process.exitCode = 1;
      });
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch {
    process.stderr.write('Surfer operator console unavailable. No console session was started.\n');
    process.exitCode = 1;
  }
}
