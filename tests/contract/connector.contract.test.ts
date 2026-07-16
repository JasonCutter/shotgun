import { describe, expect, it } from 'vitest';

import { InMemoryTransport } from '../../adapters/transport-in-memory/src/index.js';
import { InProcessTransport } from '../../adapters/transport-in-process/src/index.js';
import { createChildEvent } from '../../packages/contracts/src/index.js';
import { createStage1Harness, pongQueryFrom, securePingCommand } from '../helpers/stage-1.js';

const transports = [
  ['in-memory', () => new InMemoryTransport()],
  ['in-process', () => new InProcessTransport()],
] as const;

describe.each(transports)('%s connector contract', (_name, createTransport) => {
  it('connects two modules through command, event and query contracts', async () => {
    const { kernel, ping, pong } = await createStage1Harness(createTransport());
    const command = securePingCommand('flow-1');

    const commandDelivery = await kernel.connector.sendCommand(command);
    const queryDelivery = await kernel.connector.query(pongQueryFrom(command));

    expect(commandDelivery.status).toBe('processed');
    expect(queryDelivery.result.payload).toEqual({
      requestId: 'flow-1',
      reply: 'pong:hello',
      receivedCount: 1,
    });
    expect(ping.commandSideEffects).toBe(1);
    expect(pong.eventSideEffects).toBe(1);
    expect(ping.lastJob).toMatchObject({ attemptNumber: 1 });
    expect(pong.lastJob).toMatchObject({ attemptNumber: 1 });
    expect(ping.lastJob?.jobId).not.toBe(pong.lastJob?.jobId);
    expect(ping.lastProvenance).toEqual(command.provenance);
    expect(pong.lastProvenance).toEqual(command.provenance);
  });

  it('deduplicates repeated commands and repeated at-least-once events', async () => {
    const { kernel, ping, pong } = await createStage1Harness(createTransport());
    const command = securePingCommand('dedup-command');

    await kernel.connector.sendCommand(command);
    const duplicateCommand = await kernel.connector.sendCommand(command);

    const eventParent = securePingCommand('dedup-event');
    const event = createChildEvent(eventParent, {
      messageType: 'PongEvent',
      schemaVersion: '1.0.0',
      producerModule: 'contract-test',
      producerVersion: '1.0.0',
      idempotencyKey: 'pong:dedup-event',
      orderingKey: 'dedup-event',
      sequence: 1,
      payload: {
        requestId: 'dedup-event',
        reply: 'pong:event',
      },
    });
    await kernel.connector.publishEvent(event);
    const duplicateEvent = await kernel.connector.publishEvent(event);

    expect(duplicateCommand.status).toBe('duplicate');
    expect(duplicateEvent.consumers).toEqual([
      {
        consumerId: 'stage1.pong',
        status: 'duplicate',
      },
    ]);
    expect(ping.commandSideEffects).toBe(1);
    expect(pong.eventSideEffects).toBe(2);
  });

  it('denies protected handlers when security context is missing', async () => {
    const { kernel } = await createStage1Harness(createTransport());
    const valid = securePingCommand('security');
    const invalid = {
      ...valid,
      actor: undefined,
      security: undefined,
    };

    await expect(kernel.connector.sendCommand(invalid)).rejects.toMatchObject({
      code: 'POLICY_DENIED',
    });
  });

  it('keeps one trace across command, event and query', async () => {
    const { kernel } = await createStage1Harness(createTransport());
    const command = securePingCommand('trace');

    await kernel.connector.sendCommand(command);
    await kernel.connector.query(pongQueryFrom(command));

    const succeeded = kernel.connector.traces
      .findByTraceId(command.traceId)
      .filter((record) => record.status === 'succeeded');
    expect(succeeded.map((record) => record.messageType)).toEqual([
      'PongEvent',
      'PingCommand',
      'GetPongResult',
    ]);
    expect(new Set(succeeded.map((record) => record.correlationId))).toEqual(
      new Set([command.correlationId]),
    );
  });
});
