import { describe, expect, it } from 'vitest';

import { createServer } from '../../assemblies/shotgun-app/src/server.js';

describe('health check', () => {
  it('loads the empty kernel test module into the application', async () => {
    const server = await createServer();

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', modules: ['test.module'] });

    await server.close();
  });
});
