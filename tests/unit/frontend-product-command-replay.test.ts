import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { InMemoryFrontendCommandGateway } from '../../adapters/frontend-command-gateway-in-memory/src/index.js';
import { registerFrontendProductRoutes } from '../../assemblies/shotgun-app/src/product-api/frontend-product-routes.js';
import type { AskAnswerExecutionService } from '../../modules/frontend-ask-execution/src/index.js';
import type { FrontendProductReadCoordinator } from '../../modules/frontend-product-read/src/index.js';
import type { ProjectAdministrationRepositoryPort } from '../../modules/project-administration/src/index.js';
import type { SettingsRepositoryPort } from '../../modules/settings-policy/src/index.js';
import type { AuthRepositoryPort } from '../../packages/authentication/src/index.js';

describe('Frontend AnswerRun command replay recovery', () => {
  it('resumes accepted replays and applies cancel/retry/export/feedback/seed exactly once', async () => {
    const server = Fastify();
    const gateway = new InMemoryFrontendCommandGateway();
    const accept = gateway.accept.bind(gateway);
    gateway.accept = async (input) => {
      const accepted = await accept(input);
      if (accepted.replayed) return accepted;
      return accept({
        ...input,
        commandId: `forced-replay-${input.request.clientRequestId}`,
      });
    };

    const answerRun = {
      answerRunId: 'run-1',
      projectId: 'shotgun',
      state: 'CANCEL_REQUESTED',
    };
    const coordinator = {
      getAskAnswerRun: async () => answerRun,
    } as unknown as FrontendProductReadCoordinator;
    const authRepository = {
      listMemberships: async () => [
        {
          projectId: 'shotgun',
          isOwner: true,
          scopes: ['owner'],
          sensitivityClearance: 'private',
        },
      ],
      findMembership: async () => ({
        projectId: 'shotgun',
        isOwner: true,
        scopes: ['owner'],
        sensitivityClearance: 'private',
      }),
    } as unknown as AuthRepositoryPort;
    const projectRepository = {
      getProjects: async () => ({ projects: [{ id: 'shotgun', name: 'Shotgun' }] }),
    } as unknown as ProjectAdministrationRepositoryPort;
    const settingsRepository = {
      getSettingsSnapshot: async () => ({ policyContextRevision: 1 }),
    } as unknown as SettingsRepositoryPort;

    const calls = { cancel: 0, retry: 0, export: 0, feedback: 0, seed: 0 };
    const exportsByRequestId = new Map<string, object>();
    const feedbackByRequestId = new Map<string, object>();
    const seedsByRequestId = new Map<string, object>();
    let transactionTail = Promise.resolve();
    const execution = {
      withCommandTransaction: async (action: (transaction: unknown) => Promise<unknown>) => {
        const previous = transactionTail;
        let release!: () => void;
        transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await action({ rawTransaction: {}, afterCommit: () => {} });
        } finally {
          release();
        }
      },
      cancel: async () => {
        calls.cancel += 1;
        return answerRun;
      },
      retry: async () => {
        calls.retry += 1;
        return answerRun;
      },
      export: async (
        _scope: unknown,
        answerRunId: string,
        format: string,
        requestId: string,
      ) => {
        calls.export += 1;
        const result = {
          answerRunId,
          projectId: 'shotgun',
          exportId: 'export-1',
          format,
          content: '{}',
        };
        exportsByRequestId.set(requestId, result);
        return result;
      },
      findExportByRequestId: async (_scope: unknown, _answerRunId: string, requestId: string) =>
        exportsByRequestId.get(requestId),
      feedback: async (
        _scope: unknown,
        answerRunId: string,
        kind: string,
        comment: string | undefined,
        requestId: string,
      ) => {
        calls.feedback += 1;
        const result = {
          answerRunId,
          projectId: 'shotgun',
          feedbackId: 'feedback-1',
          kind,
          ...(comment === undefined ? {} : { comment }),
        };
        feedbackByRequestId.set(requestId, result);
        return result;
      },
      findFeedbackByRequestId: async (_scope: unknown, _answerRunId: string, requestId: string) =>
        feedbackByRequestId.get(requestId),
      transitionSeed: async (
        _scope: unknown,
        answerRunId: string,
        kind: string,
        requestId: string,
      ) => {
        calls.seed += 1;
        const result = {
          answerRunId,
          projectId: 'shotgun',
          seedId: 'seed-1',
          kind,
          payload: {},
        };
        seedsByRequestId.set(requestId, result);
        return result;
      },
      findTransitionSeedByRequestId: async (
        _scope: unknown,
        _answerRunId: string,
        _kind: string,
        requestId: string,
      ) => seedsByRequestId.get(requestId),
    } as unknown as AskAnswerExecutionService;

    registerFrontendProductRoutes(
      server,
      coordinator,
      authRepository,
      projectRepository,
      settingsRepository,
      async () => ({
        principalContext: { principalId: 'principal-1' },
        session: { sessionId: 'session-1', activeProjectId: 'shotgun' },
      }),
      {
        askAnswerExecution: execution,
        frontendCommandGateway: gateway,
      },
    );

    const cases = [
      {
        action: 'cancel' as const,
        url: '/product-api/frontend/ask/answer-runs/run-1/cancel',
        payload: {
          schemaVersion: '1.0.0',
          clientRequestId: 'cancel-request-1',
          idempotencyKey: 'cancel-idempotency-1',
        },
      },
      {
        action: 'retry' as const,
        url: '/product-api/frontend/ask/answer-runs/run-1/retry',
        payload: {
          schemaVersion: '1.0.0',
          clientRequestId: 'retry-request-1',
          idempotencyKey: 'retry-idempotency-1',
          mode: 'SAME_CONTEXT',
        },
      },
      {
        action: 'export' as const,
        url: '/product-api/frontend/ask/answer-runs/run-1/export',
        payload: {
          schemaVersion: '1.0.0',
          clientRequestId: 'export-request-1',
          idempotencyKey: 'export-idempotency-1',
          format: 'JSON',
        },
      },
      {
        action: 'feedback' as const,
        url: '/product-api/frontend/ask/answer-runs/run-1/feedback',
        payload: {
          schemaVersion: '1.0.0',
          clientRequestId: 'feedback-request-1',
          idempotencyKey: 'feedback-idempotency-1',
          kind: 'HELPFUL',
        },
      },
      {
        action: 'seed' as const,
        url: '/product-api/frontend/ask/answer-runs/run-1/transition-seed',
        payload: {
          schemaVersion: '1.0.0',
          clientRequestId: 'seed-request-1',
          idempotencyKey: 'seed-idempotency-1',
          kind: 'USER_DIRECTIVE',
        },
      },
    ];

    for (const testCase of cases) {
      const responses = await Promise.all([
        server.inject({ method: 'POST', url: testCase.url, payload: testCase.payload }),
        server.inject({ method: 'POST', url: testCase.url, payload: testCase.payload }),
      ]);

      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(calls[testCase.action]).toBe(1);
      const outcome = await gateway.findByClientRequestId('principal-1', testCase.payload.clientRequestId, {
        resourceKind: 'ASK_ANSWER_RUN',
        resourceId: 'run-1',
      });
      expect(outcome).toMatchObject({ outcomeState: 'COMPLETED' });
      expect(outcome?.producedResources.length).toBeGreaterThan(0);
    }

    await server.close();
  });
});
