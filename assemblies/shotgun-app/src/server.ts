import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';

import { InProcessTransport } from '../../../adapters/transport-in-process/src/index.js';
import {
  createChildQuery,
  createCommand,
  ShotgunKernel,
  type MessageTransport,
} from '../../../packages/kernel/src/index.js';
import { createPingModule } from '../../../modules/ping/src/index.js';
import { createPongModule } from '../../../modules/pong/src/index.js';

type PingRequest = {
  readonly requestId?: string;
  readonly message?: string;
};

export const createApplication = async (transport: MessageTransport = new InProcessTransport()) => {
  const ping = createPingModule();
  const pong = createPongModule();
  const kernel = new ShotgunKernel(transport);
  kernel.register(ping.module, pong.module);
  await kernel.start();

  const server = Fastify({ logger: false });

  server.get('/health', async () => kernel.health());

  server.post<{ Body: PingRequest }>('/demo/ping', async (request) => {
    const requestId = request.body?.requestId ?? randomUUID();
    const command = createCommand({
      messageType: 'PingCommand',
      schemaVersion: '1.0.0',
      producerModule: 'shotgun-app',
      producerVersion: '1.0.0',
      idempotencyKey: `ping:${requestId}`,
      projectId: 'shotgun',
      actor: {
        type: 'user',
        id: 'owner',
      },
      security: {
        accessScope: ['owner'],
        sensitivity: 'private',
        dataClassification: 'personal',
      },
      payload: {
        requestId,
        message: request.body?.message ?? 'hello',
        sequence: 1,
      },
    });

    const commandDelivery = await kernel.connector.sendCommand(command);
    const query = createChildQuery(command, {
      messageType: 'GetPongResult',
      schemaVersion: '1.0.0',
      producerModule: 'shotgun-app',
      producerVersion: '1.0.0',
      payload: { requestId },
    });
    const queryDelivery = await kernel.connector.query(query);

    return {
      commandStatus: commandDelivery.status,
      pong: queryDelivery.result.payload,
      trace: kernel.connector.traces.findByTraceId(command.traceId).map((record) => ({
        messageType: record.messageType,
        messageKind: record.messageKind,
        consumerModule: record.consumerModule,
        status: record.status,
        attemptNumber: record.attemptNumber,
      })),
    };
  });

  server.addHook('onClose', async () => {
    await kernel.shutdown();
  });

  return {
    server,
    kernel,
    state: {
      ping: ping.state,
      pong: pong.state,
    },
  };
};
