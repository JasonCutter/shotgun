import pingCommandSchema from '../../../packages/contracts/schemas/ping-command.v1.schema.json';
import pongEventSchema from '../../../packages/contracts/schemas/pong-event.v1.schema.json';
import type {
  CommandEnvelope,
  JobContext,
  ProvenanceContext,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

type PingPayload = {
  readonly requestId: string;
  readonly message: string;
  readonly sequence: number;
};

export type PingModuleState = {
  commandSideEffects: number;
  lastJob?: JobContext;
  lastProvenance?: ProvenanceContext;
};

export const createPingModule = (): {
  readonly module: ShotgunModule;
  readonly state: PingModuleState;
} => {
  const state: PingModuleState = {
    commandSideEffects: 0,
  };

  const module: ShotgunModule = {
    manifest: {
      id: 'stage1.ping',
      version: '1.0.0',
      owner: 'Shotgun Kernel',
      compatibility: {
        runtime: '>=1.0.0 <2.0.0',
        contracts: [
          { name: 'PingCommand', range: '>=1.0.0 <2.0.0' },
          { name: 'PongEvent', range: '>=1.0.0 <2.0.0' },
        ],
      },
      deployment: {
        modes: ['in_process'],
      },
      dataOwnership: {
        owns: ['ping-side-effect-counter'],
        readsViaPorts: [],
        directSchemaAccess: false,
      },
      consumes: {
        commands: [{ name: 'PingCommand', range: '>=1.0.0 <2.0.0' }],
        events: [],
      },
      produces: {
        events: [{ name: 'PongEvent', range: '>=1.0.0 <2.0.0' }],
      },
      provides: {
        queries: [],
        capabilities: [{ name: 'ping-command', priority: 100 }],
      },
      requires: {
        capabilities: [],
      },
      security: {
        requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
        defaultOnMissingContext: 'deny',
      },
      approvalPolicy: {
        canWriteCanonical: false,
        canExecuteExternalAction: false,
      },
    },
    contracts: [
      {
        name: 'PingCommand',
        version: '1.0.0',
        kind: 'command',
        inputSchema: pingCommandSchema,
      },
      {
        name: 'PongEvent',
        version: '1.0.0',
        kind: 'event',
        inputSchema: pongEventSchema,
      },
    ],
    handlers: {
      commands: [
        {
          messageType: 'PingCommand',
          version: '1.0.0',
          requiredAccessScopes: ['owner'],
          async handle(envelope: CommandEnvelope, context) {
            const payload = envelope.payload as PingPayload;
            state.commandSideEffects += 1;
            state.lastJob = envelope.job;
            state.lastProvenance = envelope.provenance;
            await context.publish({
              messageType: 'PongEvent',
              schemaVersion: '1.0.0',
              idempotencyKey: `pong:${payload.requestId}`,
              orderingKey: payload.requestId,
              sequence: payload.sequence,
              payload: {
                requestId: payload.requestId,
                reply: `pong:${payload.message}`,
              },
            });
            return {
              accepted: true,
              requestId: payload.requestId,
            };
          },
        },
      ],
      events: [],
      queries: [],
    },
  };

  return { module, state };
};
