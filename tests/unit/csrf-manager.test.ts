import { describe, expect, it, vi } from 'vitest';

import {
  getSharedCsrfMutationManager,
  isCsrfFailureResponse,
} from '../../packages/shotgun-api-client/src/index.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const csrfFailure = (code = 'REQUEST_ORIGIN_DENIED'): Response =>
  json({ code, message: 'The Product request was denied.' }, 403);

const protectedRequest = (fetch: typeof globalThis.fetch, token: string): Promise<Response> =>
  fetch('/product-api/frontend/test', {
    method: 'POST',
    headers: { 'x-csrf-token': token },
    credentials: 'same-origin',
  });

describe('shared browser-session CSRF coordination', () => {
  it('proves the stale-token interleave and prevents it for two logical clients', async () => {
    let currentToken = '';
    let csrfIssued = 0;
    const protectedTokens: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/security/csrf')) {
        currentToken = `csrf-${++csrfIssued}`;
        return json({ csrfToken: currentToken });
      }
      const token = new Headers(init?.headers).get('x-csrf-token') ?? '';
      protectedTokens.push(token);
      return token === currentToken ? json({ accepted: true }) : csrfFailure();
    });

    const tokenA = 'csrf-1';
    await fetch('/api/v1/security/csrf');
    await fetch('/api/v1/security/csrf');
    const stale = await protectedRequest(fetch, tokenA);
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ code: 'REQUEST_ORIGIN_DENIED' });

    const clientA = getSharedCsrfMutationManager(fetch);
    const clientB = getSharedCsrfMutationManager(fetch);
    expect(clientA).toBe(clientB);

    const [first, second] = await Promise.all([
      clientA.run((token) => protectedRequest(fetch, token), {
        recoverOnResponse: isCsrfFailureResponse,
      }),
      clientB.run((token) => protectedRequest(fetch, token), {
        recoverOnResponse: isCsrfFailureResponse,
      }),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(csrfIssued).toBe(3);
    expect(protectedTokens.slice(-2)).toEqual(['csrf-3', 'csrf-3']);
  });

  it('keeps later mutations behind an active predecessor when a queued mutation is aborted', async () => {
    const started: string[] = [];
    let resolveActive: () => void = () => undefined;
    const activeOperation = new Promise<void>((resolve) => {
      resolveActive = resolve;
    });
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/security/csrf')) {
        return json({ csrfToken: 'csrf-queue' });
      }
      throw new Error('Unexpected protected request.');
    });
    const manager = getSharedCsrfMutationManager(fetch);

    const active = manager.run(async (token) => {
      started.push('A');
      await activeOperation;
      return token;
    });
    await vi.waitFor(() => expect(started).toEqual(['A']));

    const controller = new AbortController();
    const queued = manager.run(
      async (token) => {
        started.push('B');
        return token;
      },
      { signal: controller.signal },
    );
    const later = manager.run(async (token) => {
      started.push('C');
      return token;
    });

    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(started).toEqual(['A']);

    resolveActive();
    await expect(active).resolves.toBe('csrf-queue');
    await expect(later).resolves.toBe('csrf-queue');
    expect(started).toEqual(['A', 'C']);

    await expect(
      manager.run(async (token) => {
        started.push('D');
        return token;
      }),
    ).resolves.toBe('csrf-queue');
    expect(started).toEqual(['A', 'C', 'D']);
  });

  it('recovers exactly once from REQUEST_ORIGIN_DENIED', async () => {
    let csrfIssued = 0;
    let protectedCalls = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/v1/security/csrf')) {
        return json({ csrfToken: `csrf-${++csrfIssued}` });
      }
      protectedCalls += 1;
      return protectedCalls === 1 ? csrfFailure() : json({ accepted: true });
    });

    const result = await getSharedCsrfMutationManager(fetch).run(
      (token) => protectedRequest(fetch, token),
      { recoverOnResponse: isCsrfFailureResponse },
    );

    expect(result.status).toBe(200);
    expect(csrfIssued).toBe(2);
    expect(protectedCalls).toBe(2);
  });

  it('surfaces a repeated typed CSRF denial without looping', async () => {
    let csrfIssued = 0;
    let protectedCalls = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/v1/security/csrf')) {
        return json({ csrfToken: `csrf-${++csrfIssued}` });
      }
      protectedCalls += 1;
      return csrfFailure();
    });

    const result = await getSharedCsrfMutationManager(fetch).run(
      (token) => protectedRequest(fetch, token),
      { recoverOnResponse: isCsrfFailureResponse },
    );

    expect(result.status).toBe(403);
    expect(csrfIssued).toBe(2);
    expect(protectedCalls).toBe(2);
  });

  it.each(['PROJECT_ACCESS_DENIED', 'AUTHORIZATION_DENIED'])(
    'does not retry authorization denial %s',
    async (code) => {
      let csrfIssued = 0;
      let protectedCalls = 0;
      const fetch = vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith('/api/v1/security/csrf')) {
          return json({ csrfToken: `csrf-${++csrfIssued}` });
        }
        protectedCalls += 1;
        return csrfFailure(code);
      });

      const result = await getSharedCsrfMutationManager(fetch).run(
        (token) => protectedRequest(fetch, token),
        { recoverOnResponse: isCsrfFailureResponse },
      );

      expect(result.status).toBe(403);
      expect(csrfIssued).toBe(1);
      expect(protectedCalls).toBe(1);
    },
  );

  it('does not retry a network failure or convert it into a CSRF recovery', async () => {
    let csrfIssued = 0;
    let protectedCalls = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/v1/security/csrf')) {
        return json({ csrfToken: `csrf-${++csrfIssued}` });
      }
      protectedCalls += 1;
      throw new TypeError('connection closed');
    });

    await expect(
      getSharedCsrfMutationManager(fetch).run((token) => protectedRequest(fetch, token)),
    ).rejects.toThrow('connection closed');
    expect(csrfIssued).toBe(1);
    expect(protectedCalls).toBe(1);
  });
});
