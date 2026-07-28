import { describe, expect, it, vi } from 'vitest';

import {
  ShotgunApiError,
  createShotgunApiClient,
} from '../../packages/shotgun-api-client/src/index.js';

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('typed Product API client failures', () => {
  it('runtime-decodes the versioned failure envelope and preserves its cause', async () => {
    const client = createShotgunApiClient({
      fetch: vi.fn(async () =>
        json(
          {
            schemaVersion: '1.0.0',
            code: 'REVISION_CONFLICT',
            category: 'CONFLICT',
            retryability: 'CONDITIONAL',
            recovery: 'REFRESH_AND_REAPPLY',
            message: 'The server revision changed.',
            correlationId: 'correlation-a',
            details: {
              code: 'REVISION_CONFLICT',
              expectedRevision: '7',
              actualRevision: '8',
            },
          },
          409,
        ),
      ),
    });

    await expect(client.getSession()).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      status: 409,
      category: 'CONFLICT',
      retryability: 'CONDITIONAL',
      recovery: 'REFRESH_AND_REAPPLY',
      correlationId: 'correlation-a',
      failure: {
        schemaVersion: '1.0.0',
        code: 'REVISION_CONFLICT',
      },
    });
  });

  it('upgrades the additive legacy code/message body through the registry', async () => {
    const client = createShotgunApiClient({
      fetch: vi.fn(async () => json({ code: 'SESSION_EXPIRED', message: 'Session expired.' }, 401)),
    });

    await expect(client.getSession()).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
      category: 'AUTHENTICATION',
      retryability: 'NEVER',
      recovery: 'REAUTHENTICATE',
    });
  });

  it('fails closed when a remote code is unknown instead of guessing recovery', async () => {
    const client = createShotgunApiClient({
      fetch: vi.fn(async () =>
        json(
          {
            schemaVersion: '1.0.0',
            code: 'FUTURE_UNKNOWN_FAILURE',
            category: 'CONFLICT',
            retryability: 'SAFE',
            recovery: 'RETRY',
            message: 'Unknown remote failure.',
          },
          503,
        ),
      ),
    });

    const result = client.getSession();
    await expect(result).rejects.toBeInstanceOf(ShotgunApiError);
    await expect(result).rejects.toMatchObject({
      code: 'REMOTE_UNCLASSIFIED',
      status: 503,
      category: 'TERMINAL',
      retryability: 'NEVER',
      recovery: 'CONTACT_SUPPORT',
      failure: undefined,
    });
  });

  it('retains clientRequestId when a submitted command response is not received', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/security/csrf')) {
        return new Response(JSON.stringify({ csrfToken: 'csrf-a' }), { status: 200 });
      }
      throw new TypeError('connection closed after submit');
    });
    const client = createShotgunApiClient({ fetch });

    await expect(
      client.applySettingsCommand({
        activeProjectId: 'project-a',
        targetProjectId: 'project-a',
        resourceProjectId: 'project-a',
        clientRequestId: 'request-preserved',
        idempotencyKey: 'intent-preserved',
        expectedSettingsRevision: 1,
        observedPolicyContextRevision: 1,
        settings: {},
      }),
    ).rejects.toMatchObject({
      code: 'OUTCOME_INDETERMINATE',
      clientRequestId: 'request-preserved',
      recovery: 'RESOLVE_EXISTING_OUTCOME',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
