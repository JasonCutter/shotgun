import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';

describe('AKP-4 WP3 durable manual Discovery API', () => {
  it('uses a stable request identity and returns the durable Job result', async () => {
    const app = await createApplication();
    const first = await app.server.inject({
      method: 'POST',
      url: '/knowledge/discovery/run',
      payload: {
        commandId: 'api-command-1',
        requestId: 'api-request-1',
        requestedScanMode: 'FULL_SCAN',
      },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      discovery: { disposition: 'CREATED', lifecycleState: 'WAITING_FOR_PROJECTION' },
    });
    const replay = await app.server.inject({
      method: 'POST',
      url: '/knowledge/discovery/run',
      payload: {
        commandId: 'api-command-1',
        requestId: 'api-request-1',
        requestedScanMode: 'FULL_SCAN',
      },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      discovery: { disposition: 'ALREADY_EXISTS', jobId: first.json().discovery.jobId },
    });
    await app.server.close();
  });
});
