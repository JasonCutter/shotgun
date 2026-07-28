import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';

describe('Product API typed failure envelope', () => {
  let app: Awaited<ReturnType<typeof createApplication>>;

  beforeAll(async () => {
    app = await createApplication({ canonicalProjectionRecoveryIntervalMs: false });
    app.server.get('/__test/internal-failure', async () => {
      throw new Error('postgres://admin:password@private-host/database');
    });
  });

  afterAll(async () => {
    await app.server.close();
  });

  it('returns a versioned descriptor-backed authentication failure', async () => {
    const response = await app.server.inject({ method: 'GET', url: '/api/v1/session' });
    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({
      schemaVersion: '1.0.0',
      code: 'AUTHENTICATION_INVALID',
      category: 'AUTHENTICATION',
      retryability: 'NEVER',
      recovery: 'REAUTHENTICATE',
    });
  });

  it('normalizes an unknown internal failure without exposing its cause', async () => {
    const response = await app.server.inject({ method: 'GET', url: '/__test/internal-failure' });
    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      schemaVersion: '1.0.0',
      code: 'INTERNAL_UNCLASSIFIED',
      category: 'TERMINAL',
      retryability: 'UNKNOWN',
      recovery: 'CONTACT_SUPPORT',
      message: 'Request failed.',
    });
    expect(response.body).not.toContain('password');
    expect(response.body).not.toContain('private-host');
  });
});
