import { describe, expect, it, vi } from 'vitest';

import {
  createShotgunApiClient,
  ShotgunApiError,
  type ProductSessionView,
} from '../../packages/shotgun-api-client/src/index.js';

const session = (projectId = 'project-a'): ProductSessionView => ({
  apiVersion: '1.0.0',
  principal: {
    id: 'principal-a',
    actor: { type: 'user', id: 'principal-a' },
    authenticationMethod: 'session',
  },
  activeProject: { id: projectId },
  accessibleProjects: [
    { id: 'project-a', isOwner: true },
    { id: 'project-b', isOwner: false },
  ],
  session: { expiresAt: '2026-07-23T00:00:00.000Z' },
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('shotgun-api-client', () => {
  it('decodes a valid session and ignores non-contract authority fields', async () => {
    const fetch = vi.fn(async () =>
      json({
        session: {
          ...session(),
          scopes: ['owner'],
          sensitivityClearance: 'restricted',
          credentialId: 'hidden',
          sessionToken: 'hidden',
          csrfHash: 'hidden',
        },
      }),
    );
    const result = await createShotgunApiClient({ fetch }).getSession();
    expect(result).toEqual(session());
    expect(result).not.toHaveProperty('scopes');
  });

  it.each([
    { session: { ...session(), activeProject: undefined } },
    { session: { ...session(), accessibleProjects: {} } },
    { session: { ...session(), activeProject: { id: 'project-c' } } },
  ])('rejects malformed Product API responses', async (body) => {
    const client = createShotgunApiClient({ fetch: vi.fn(async () => json(body)) });
    await expect(client.getSession()).rejects.toMatchObject({
      code: 'INVALID_PRODUCT_API_RESPONSE',
      message: 'Invalid Product API Response',
    });
  });

  it('uses same-origin credentials and never sends authority or bearer headers', async () => {
    let csrfIndex = 0;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const url = String(input);
      if (url.endsWith('/security/csrf')) return json({ csrfToken: `csrf-${++csrfIndex}` });
      if (url.endsWith('/session/logout')) return json({ message: 'Logged out' });
      if (url.endsWith('/session/active-project')) return json({ session: session('project-b') });
      return json({ session: session() });
    });
    const client = createShotgunApiClient({ fetch });
    await client.bootstrapLocalOwner();
    await client.getSession();
    await client.switchActiveProject('project-b');
    await client.logout();

    const forbidden = [
      'x-project-id',
      'x-actor-id',
      'x-access-scope',
      'x-sensitivity',
      'x-shotgun-project',
      'authorization',
    ];
    for (const [, init] of fetch.mock.calls) {
      expect(init?.credentials).toBe('same-origin');
      const headers = new Headers(init?.headers);
      for (const name of forbidden) expect(headers.has(name)).toBe(false);
    }
  });

  it('serializes project switch and logout through distinct CSRF rotations', async () => {
    const calls: string[] = [];
    let csrfIndex = 0;
    let releaseFirst = (): void => undefined;
    const firstMutation = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/security/csrf')) {
        const token = `csrf-${++csrfIndex}`;
        calls.push(token);
        return json({ csrfToken: token });
      }
      if (url.endsWith('/session/active-project')) {
        calls.push('switch');
        await firstMutation;
        return json({ session: session('project-b') });
      }
      calls.push('logout');
      return json({ message: 'Logged out' });
    });
    const client = createShotgunApiClient({ fetch });
    const switching = client.switchActiveProject('project-b');
    const logout = client.logout();
    await vi.waitFor(() => expect(calls).toEqual(['csrf-1', 'switch']));
    releaseFirst();
    await Promise.all([switching, logout]);
    expect(calls).toEqual(['csrf-1', 'switch', 'csrf-2', 'logout']);
  });

  it('releases the mutation lock after a network failure', async () => {
    let mutationCount = 0;
    let csrfIndex = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/security/csrf')) return json({ csrfToken: `csrf-${++csrfIndex}` });
      if (url.endsWith('/session/active-project') && mutationCount++ === 0) {
        throw new TypeError('network unavailable');
      }
      return json({ session: session('project-b') });
    });
    const client = createShotgunApiClient({ fetch });
    const first = client.switchActiveProject('project-b');
    const second = client.switchActiveProject('project-b');
    await expect(first).rejects.toThrow('network unavailable');
    await expect(second).resolves.toEqual(session('project-b'));
    expect(csrfIndex).toBe(2);
  });

  it('does not retry a CSRF denial', async () => {
    let mutationCalls = 0;
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/security/csrf')) return json({ csrfToken: 'csrf-1' });
      mutationCalls += 1;
      return json(
        { code: 'REQUEST_ORIGIN_DENIED', message: 'A valid CSRF token is required.' },
        403,
      );
    });
    const client = createShotgunApiClient({ fetch });
    await expect(client.switchActiveProject('project-b')).rejects.toBeInstanceOf(ShotgunApiError);
    expect(mutationCalls).toBe(1);
  });

  it('classifies an unreceived Section 2 command response as outcome indeterminate', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/security/csrf')) return json({ csrfToken: 'csrf-command' });
      throw new TypeError('response connection closed');
    });
    const client = createShotgunApiClient({ fetch });
    await expect(
      client.applySettingsCommand({
        activeProjectId: 'project-a',
        targetProjectId: 'project-a',
        resourceProjectId: 'project-a',
        clientRequestId: 'request-a',
        idempotencyKey: 'intent-a',
        expectedSettingsRevision: 1,
        observedPolicyContextRevision: 1,
        settings: { 'models.defaultAnswerProfile': 'model-b' },
      }),
    ).rejects.toMatchObject({
      code: 'OUTCOME_INDETERMINATE',
      status: 0,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('executes getSession correctly returning session envelope', async () => {
    const fetch = vi.fn(async () => json({ session: session() }));
    const result = await createShotgunApiClient({ fetch }).getSession();
    expect(result.principal.id).toBe('principal-a');
    expect(result.activeProject.id).toBe('project-a');
  });

  it('throws ShotgunApiError on 401 Unauthorized during getSession', async () => {
    const fetch = vi.fn(async () =>
      json({ code: 'SESSION_EXPIRED', message: 'Session expired' }, 401),
    );
    await expect(createShotgunApiClient({ fetch }).getSession()).rejects.toBeInstanceOf(
      ShotgunApiError,
    );
  });
});
