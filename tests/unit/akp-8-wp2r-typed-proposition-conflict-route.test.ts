import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import {
  InMemoryTypedPropositionConflictRuleRepository,
  type TypedPropositionConflictRuleRepositoryPort,
  type TypedPropositionConflictRuleTransactionHandleV1,
} from '../../modules/knowledge-model/src/index.js';
import { registerTypedPropositionConflictRuleRoutes } from '../../assemblies/shotgun-app/src/product-api/typed-proposition-conflict-routes.js';
import {
  ShotgunError,
  TYPED_PROPOSITION_CONFLICT_RULE_COMMAND_TYPE,
} from '../../packages/contracts/src/index.js';
import type { AuthRepositoryPort } from '../../packages/authentication/src/index.js';
import type { SettingsRepositoryPort } from '../../modules/settings-policy/src/index.js';
import type {
  CompleteFrontendCommandInput,
  FrontendCommandGatewayPort,
} from '../../modules/frontend-command-gateway/src/index.js';

const projectId = 'project-route';
const principalId = 'owner-route';

const request = (overrides: Record<string, unknown> = {}) => ({
  envelopeVersion: '1.0.0',
  commandType: TYPED_PROPOSITION_CONFLICT_RULE_COMMAND_TYPE,
  commandSchemaVersion: '1.0.0',
  clientRequestId: 'client-create-1',
  idempotencyKey: 'idempotency-create-1',
  projectContext: {
    activeProjectId: projectId,
    targetProjectId: projectId,
    resourceProjectId: projectId,
  },
  policyBinding: { mode: 'CURRENT' },
  preconditions: [],
  clientIssuedAt: '2026-09-01T00:00:00.000Z',
  payload: {
    operation: 'CREATE',
    leftRelationType: 'supports',
    rightRelationType: 'contradicts',
    directionSemantics: 'DIRECTED_SAME_ORIENTATION',
  },
  ...overrides,
});

const register = (
  repository: TypedPropositionConflictRuleRepositoryPort,
  gateway: FrontendCommandGatewayPort,
) => {
  const server = Fastify();
  registerTypedPropositionConflictRuleRoutes(
    server,
    repository,
    {
      getSettingsSnapshot: async () => ({ policyContextRevision: 1 }),
    } as unknown as SettingsRepositoryPort,
    gateway,
    {
      findMembership: async () => ({
        projectId,
        isOwner: true,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      }),
    } as unknown as AuthRepositoryPort,
    async () => ({ context: { principalId, projectId } }),
  );
  return server;
};

describe('AKP-8 WP2R conflict-rule Product transaction', () => {
  it('completes CREATE in the shared transaction and replays by clientRequestId', async () => {
    class TrackingGateway extends InMemoryFrontendCommandGateway {
      completeInTransactionCalls = 0;

      override async completeInTransaction(
        transaction: unknown,
        input: CompleteFrontendCommandInput,
      ) {
        this.completeInTransactionCalls += 1;
        expect(transaction).toBeUndefined();
        return super.completeInTransaction(transaction, input);
      }
    }

    const repository = new InMemoryTypedPropositionConflictRuleRepository();
    const gateway = new TrackingGateway();
    const server = register(repository, gateway);
    const first = await server.inject({
      method: 'POST',
      url: '/api/v1/discovery/conflict-rules/commands',
      payload: request(),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ replayed: false, outcome: { outcomeState: 'COMPLETED' } });
    expect(gateway.completeInTransactionCalls).toBe(1);
    expect(
      (await repository.listRuleRevisions(projectId)).filter((rule) => rule.status === 'ACTIVE'),
    ).toHaveLength(1);

    const replay = await server.inject({
      method: 'POST',
      url: '/api/v1/discovery/conflict-rules/commands',
      payload: request(),
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ replayed: true, outcome: { outcomeState: 'COMPLETED' } });
    expect(gateway.completeInTransactionCalls).toBe(1);
    expect(await repository.listRuleRevisions(projectId)).toHaveLength(1);
    await server.close();
  });

  it('rolls back a failed REVISE and rejects the accepted command', async () => {
    class FailingRepository extends InMemoryTypedPropositionConflictRuleRepository {
      failSupersede = false;

      override async transaction<T>(
        action: (handle: TypedPropositionConflictRuleTransactionHandleV1) => Promise<T>,
      ): Promise<T> {
        return super.transaction<T>((handle) => {
          if (!this.failSupersede) return action(handle);
          const transactional = new Proxy(handle.repository, {
            get(target, property, receiver) {
              if (property === 'supersedeRule') {
                return async () => {
                  throw new Error('injected supersede failure');
                };
              }
              return Reflect.get(target, property, receiver);
            },
          }) as TypedPropositionConflictRuleRepositoryPort;
          return action({ ...handle, repository: transactional });
        });
      }
    }

    const repository = new FailingRepository();
    const gateway = new InMemoryFrontendCommandGateway();
    const server = register(repository, gateway);
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/discovery/conflict-rules/commands',
      payload: request(),
    });
    const ruleId = created.json().rule.ruleId as string;
    repository.failSupersede = true;
    const reviseRequest = request({
      clientRequestId: 'client-revise-1',
      idempotencyKey: 'idempotency-revise-1',
      payload: {
        operation: 'REVISE',
        ruleId,
        expectedRuleRevision: 1,
        leftRelationType: 'supports-revised',
        rightRelationType: 'contradicts',
        directionSemantics: 'DIRECTED_SAME_ORIENTATION',
      },
    });
    const failed = await server.inject({
      method: 'POST',
      url: '/api/v1/discovery/conflict-rules/commands',
      payload: reviseRequest,
    });
    expect(failed.statusCode).toBe(500);
    expect(await repository.listRuleRevisions(projectId)).toEqual([
      expect.objectContaining({ ruleId, ruleRevision: 1, status: 'ACTIVE' }),
    ]);
    await expect(
      gateway.findByClientRequestId(principalId, 'client-revise-1'),
    ).resolves.toMatchObject({ outcomeState: 'REJECTED' });
    await server.close();
  });

  it('marks completion uncertainty without false REJECTED state', async () => {
    class UnknownGateway extends InMemoryFrontendCommandGateway {
      override async completeInTransaction(): Promise<never> {
        throw new ShotgunError({
          code: 'OUTCOME_UNKNOWN',
          safeMessage: 'commit acknowledgement lost',
          module: 'test',
          operation: 'complete',
        });
      }
    }

    const repository = new InMemoryTypedPropositionConflictRuleRepository();
    const gateway = new UnknownGateway();
    const server = register(repository, gateway);
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/discovery/conflict-rules/commands',
      payload: request({
        clientRequestId: 'client-unknown-1',
        idempotencyKey: 'idempotency-unknown-1',
      }),
    });
    expect(response.statusCode).toBe(500);
    expect(await repository.listRuleRevisions(projectId)).toHaveLength(0);
    await expect(
      gateway.findByClientRequestId(principalId, 'client-unknown-1'),
    ).resolves.toMatchObject({ outcomeState: 'OUTCOME_UNKNOWN' });
    await server.close();
  });
});
