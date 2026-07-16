import { describe, expect, it } from 'vitest';

import { createApplication } from '../../assemblies/shotgun-app/src/server.js';

describe('Stage 1 application', () => {
  it('loads two independent modules and exposes their capabilities', async () => {
    const { server } = await createApplication();

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      modules: ['stage1.ping', 'stage1.pong'],
      capabilities: ['ping-command', 'pong-query'],
    });

    await server.close();
  });

  it('demonstrates PingCommand to PongEvent to QueryResult through the API', async () => {
    const { server } = await createApplication();

    const response = await server.inject({
      method: 'POST',
      url: '/demo/ping',
      payload: {
        requestId: 'demo-1',
        message: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      commandStatus: 'processed',
      pong: {
        requestId: 'demo-1',
        reply: 'pong:hello',
        receivedCount: 1,
      },
    });
    expect(
      response
        .json()
        .trace.filter((record: { status: string }) => record.status === 'succeeded')
        .map((record: { messageType: string }) => record.messageType),
    ).toEqual(['PongEvent', 'PingCommand', 'GetPongResult']);

    await server.close();
  });
});
