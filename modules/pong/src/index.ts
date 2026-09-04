import getPongResultOutputSchema from '../../../packages/contracts/schemas/get-pong-result-output.v1.schema.json';
import getPongResultSchema from '../../../packages/contracts/schemas/get-pong-result.v1.schema.json';
import pongEventSchema from '../../../packages/contracts/schemas/pong-event.v1.schema.json';
import {
  type EventEnvelope,
  type JobContext,
  type ProvenanceContext,
  type QueryEnvelope,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';

type PongPayload = {
  readonly requestId: string;
  readonly reply: string;
};

type GetPongResultPayload = {
  readonly requestId: string;
};

export type PongResult = {
  readonly requestId: string;
  readonly reply: string;
  readonly receivedCount: number;
};

export type PongModuleState = {
  eventSideEffects: number;
  lastJob?: JobContext;
  lastProvenance?: ProvenanceContext;
  readonly results: Map<string, PongResult>;
};

export const createPongModule = (): {
  readonly module: ShotgunModule;
  readonly state: PongModuleState;
} => {
  const state: PongModuleState = {
    eventSideEffects: 0,
    results: new Map(),
  };

  const module: ShotgunModule = {
    manifest: {
      id: 'stage1.pong',
      version: '1.0.0',
      owner: 'Shotgun Kernel',
      compatibility: {
        runtime: '>=1.0.0 <2.0.0',
        contracts: [
          { name: 'PongEvent', range: '>=1.0.0 <2.0.0' },
          { name: 'GetPongResult', range: '>=1.0.0 <2.0.0' },
        ],
      },
      deployment: {
        modes: ['in_process'],
      },
      dataOwnership: {
        owns: ['pong-read-model'],
        readsViaPorts: [],
        directSchemaAccess: false,
      },
      consumes: {
        commands: [],
        events: [{ name: 'PongEvent', range: '>=1.0.0 <2.0.0' }],
      },
      produces: {
        events: [],
        handoffs: [],
      },
      provides: {
        queries: [{ name: 'GetPongResult', range: '>=1.0.0 <2.0.0' }],
        capabilities: [{ name: 'pong-query', priority: 100 }],
      },
      requires: {
        capabilities: ['ping-command'],
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
        name: 'PongEvent',
        version: '1.0.0',
        kind: 'event',
        inputSchema: pongEventSchema,
      },
      {
        name: 'GetPongResult',
        version: '1.0.0',
        kind: 'query',
        inputSchema: getPongResultSchema,
        outputSchema: getPongResultOutputSchema,
      },
    ],
    handlers: {
      commands: [],
      events: [
        {
          messageType: 'PongEvent',
          version: '1.0.0',
          requiredAccessScopes: ['owner'],
          handle(envelope: EventEnvelope) {
            const payload = envelope.payload as PongPayload;
            state.eventSideEffects += 1;
            state.lastJob = envelope.job;
            state.lastProvenance = envelope.provenance;
            state.results.set(payload.requestId, {
              requestId: payload.requestId,
              reply: payload.reply,
              receivedCount: state.eventSideEffects,
            });
          },
        },
      ],
      queries: [
        {
          messageType: 'GetPongResult',
          version: '1.0.0',
          requiredAccessScopes: ['owner'],
          handle(envelope: QueryEnvelope) {
            const payload = envelope.payload as GetPongResultPayload;
            const result = state.results.get(payload.requestId);
            if (!result) {
              throw new ShotgunError({
                code: 'NOT_FOUND',
                safeMessage: `Pong result '${payload.requestId}' was not found.`,
                module: 'stage1.pong',
                operation: 'GetPongResult',
                correlationId: envelope.correlationId,
              });
            }
            return result;
          },
        },
      ],
    },
  };

  return { module, state };
};
