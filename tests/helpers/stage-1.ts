import {
  createChildQuery,
  createCommand,
  ShotgunKernel,
  type MessageTransport,
} from '../../packages/kernel/src/index.js';
import { createPingModule } from '../../modules/ping/src/index.js';
import { createPongModule } from '../../modules/pong/src/index.js';

export const createStage1Harness = async (transport: MessageTransport) => {
  const ping = createPingModule();
  const pong = createPongModule();
  const kernel = new ShotgunKernel(transport);
  kernel.register(ping.module, pong.module);
  await kernel.start();
  return {
    kernel,
    ping: ping.state,
    pong: pong.state,
  };
};

export const securePingCommand = (requestId: string) =>
  createCommand({
    messageType: 'PingCommand',
    schemaVersion: '1.0.0',
    producerModule: 'contract-test',
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
    provenance: {
      sourceVersionIds: [`source:${requestId}`],
      evidenceIds: [`evidence:${requestId}`],
      policyVersion: 'stage-1',
    },
    payload: {
      requestId,
      message: 'hello',
      sequence: 1,
    },
  });

export const pongQueryFrom = (command: ReturnType<typeof securePingCommand>) =>
  createChildQuery(command, {
    messageType: 'GetPongResult',
    schemaVersion: '1.0.0',
    producerModule: 'contract-test',
    producerVersion: '1.0.0',
    payload: {
      requestId: command.payload.requestId,
    },
  });
