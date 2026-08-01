import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import type { FrontendProductReadCoordinator } from '../../../../modules/frontend-product-read/src/index.js';
import type { AskCommandCoordinator } from '../../../../modules/frontend-ask-write/src/index.js';
import {
  ASK_EXECUTION_COMMAND_TYPES,
  type AskAnswerExecutionService,
  type AskExecutionScope,
} from '../../../../modules/frontend-ask-execution/src/index.js';
import type { FrontendCommandGatewayPort } from '../../../../modules/frontend-command-gateway/src/index.js';
import type { ProjectAdministrationRepositoryPort } from '../../../../modules/project-administration/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import {
  ShotgunError,
  decodeGlobalSearchRequest,
  decodeAskAnswerRunCommandIdentity,
  decodeAskAnswerRunExportRequest,
  decodeAskAnswerRunFeedbackRequest,
  decodeAskAnswerRunRetryRequest,
  decodeAskAnswerRunTransitionSeedRequest,
  decodeSubmitAskQuestionRequest,
  decodeTargetRouteView,
  type AnyFrontendCommandRequest,
  type ErrorCode,
} from '../../../../packages/contracts/src/index.js';
import type { SecurityHeaders } from '../server.js';

type PrincipalSessionResolver = (
  headers: Record<string, string | string[] | undefined>,
) => Promise<{
  principalContext: { principalId: string };
  context?: { principalId: string; projectId: string };
  session: { sessionId: string; activeProjectId: string | null };
}>;

export const registerFrontendProductRoutes = (
  server: FastifyInstance,
  coordinator: FrontendProductReadCoordinator,
  authRepository: AuthRepositoryPort,
  projectRepository: ProjectAdministrationRepositoryPort,
  settingsRepository: SettingsRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
  options?: {
    readonly askCommandCoordinator?: AskCommandCoordinator;
    readonly askAnswerExecution?: AskAnswerExecutionService;
    readonly frontendCommandGateway?: FrontendCommandGatewayPort;
  },
): void => {
  const timed = async <T>(operation: () => Promise<T>) => {
    const startedAt = performance.now();
    const value = await operation();
    return { value, durationMs: performance.now() - startedAt };
  };
  const serverTiming = (queryMs: number, projectionMs: number): string =>
    `query;dur=${queryMs.toFixed(3)}, projection;dur=${projectionMs.toFixed(3)}`;
  const buildScope = async (headers: SecurityHeaders) => {
    const current = await requirePrincipalBrowserSession(headers);
    const memberships = await authRepository.listMemberships(current.principalContext.principalId);
    const projects = await projectRepository.getProjects(
      memberships.map((membership) => membership.projectId),
    );
    const accessibleProjects = memberships.flatMap((membership) => {
      const project = projects.projects.find((candidate) => candidate.id === membership.projectId);
      return project
        ? [
            {
              id: project.id,
              label: project.name,
              isOwner: membership.isOwner,
              sensitivityClearance: membership.sensitivityClearance,
            },
          ]
        : [];
    });
    const activeProject = current.session.activeProjectId
      ? (accessibleProjects.find((project) => project.id === current.session.activeProjectId) ??
        null)
      : null;
    if (current.session.activeProjectId && !activeProject) {
      throw new ShotgunError({
        code: 'LOCAL_PROJECT_SELECTION_REQUIRED',
        safeMessage: 'The active Project is not in the accessible Project set.',
        module: 'frontend-product-read',
        operation: 'build-read-scope',
      });
    }
    const policyContextRevision = activeProject
      ? String(
          (await settingsRepository.getSettingsSnapshot(activeProject.id)).policyContextRevision,
        )
      : '0';
    return {
      principalId: current.principalContext.principalId,
      sessionId: current.session.sessionId,
      activeProject,
      accessibleProjects,
      accessRevision: String(memberships.length),
      policyContextRevision,
    };
  };

  const executionScopeFor = async (
    scope: Awaited<ReturnType<typeof buildScope>>,
    answerRunId: string,
  ): Promise<AskExecutionScope> => {
    const answerRun = await coordinator.getAskAnswerRun({ ...scope, answerRunId });
    const project = scope.accessibleProjects.find(
      (candidate) => candidate.id === answerRun.projectId,
    );
    if (!project) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The requested AnswerRun was not found.',
        module: 'frontend-product-read',
        operation: 'resolve-answer-run-project',
      });
    }
    return {
      principalId: scope.principalId,
      projectId: project.id,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      sensitivityClearance: project.sensitivityClearance,
    };
  };

  const runAnswerCommand = async <T>(input: {
    readonly scope: Awaited<ReturnType<typeof buildScope>>;
    readonly executionScope: AskExecutionScope;
    readonly answerRunId: string;
    readonly commandType: string;
    readonly request: Record<string, unknown>;
    readonly action: () => Promise<T>;
    readonly onReplay?: () => Promise<T>;
  }): Promise<T> => {
    const gateway = options?.frontendCommandGateway;
    if (!gateway) return input.action();
    const now = new Date().toISOString();
    const commandRequest: AnyFrontendCommandRequest = {
      envelopeVersion: '1.0.0',
      commandType: input.commandType,
      commandSchemaVersion: '1.0.0',
      clientRequestId: String(input.request.clientRequestId),
      idempotencyKey: String(input.request.idempotencyKey),
      projectContext: {
        activeProjectId: input.scope.activeProject?.id ?? input.executionScope.projectId,
        targetProjectId: input.executionScope.projectId,
        resourceProjectId: input.executionScope.projectId,
        observedProjectAccessRevision: input.scope.accessRevision,
      },
      policyBinding: {
        mode: 'CURRENT',
        observedPolicyContextRevision: input.scope.policyContextRevision,
      },
      preconditions: [
        {
          purpose: 'TARGET',
          subject: { resourceKind: 'ASK_ANSWER_RUN', resourceId: input.answerRunId },
          expectedDigest: `${input.commandType}:${input.answerRunId}`,
          digestKind: 'answer-run-identity-v1',
        },
      ],
      clientIssuedAt: now,
      payload: input.request,
    };
    const commandId = `cmd-${randomUUID()}`;
    const accepted = await gateway.accept({
      commandId,
      commandRevision: '1',
      principalId: input.scope.principalId,
      request: commandRequest,
      commandSemanticDigest: JSON.stringify({
        commandType: input.commandType,
        request: input.request,
      }),
      acceptedPolicyContext: {
        policyContextId: 'frontend-ask-answer-current-policy',
        policyContextRevision: input.scope.policyContextRevision,
        acceptedAt: now,
      },
      correlationId: `corr-${randomUUID()}`,
      traceId: `trace-${randomUUID()}`,
      receivedAt: now,
      acceptedAt: now,
    });
    if (accepted.replayed) {
      if (accepted.outcome.outcomeState === 'COMPLETED') {
        return input.onReplay ? input.onReplay() : input.action();
      }
      if (accepted.outcome.outcomeState === 'REJECTED') {
        throw new ShotgunError({
          code: accepted.outcome.rejection?.code ?? 'CONFLICT',
          safeMessage:
            accepted.outcome.rejection?.message ?? 'The AnswerRun command was previously rejected.',
          module: 'frontend-product-command',
          operation: 'replay-answer-command',
        });
      }
      throw new ShotgunError({
        code: 'CONFLICT',
        safeMessage: 'The AnswerRun command is already being processed.',
        module: 'frontend-product-command',
        operation: 'replay-answer-command',
        retryable: true,
      });
    }
    try {
      const result = await input.action();
      await gateway.complete({
        commandId: accepted.outcome.commandId,
        producedResources: [{ resourceKind: 'ASK_ANSWER_RUN', resourceId: input.answerRunId }],
        completedAt: new Date().toISOString(),
      });
      return result;
    } catch (error) {
      const code: ErrorCode = error instanceof ShotgunError ? error.code : 'INTERNAL_UNCLASSIFIED';
      await gateway.reject({
        commandId: accepted.outcome.commandId,
        code,
        message: error instanceof Error ? error.message : 'AnswerRun command failed.',
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  };

  server.get<{ Headers: SecurityHeaders }>(
    '/product-api/frontend/global-shell',
    async (request, reply) => {
      const scope = await timed(() => buildScope(request.headers));
      const projection = await timed(() => coordinator.getGlobalShell(scope.value));
      reply.header('server-timing', serverTiming(scope.durationMs, projection.durationMs));
      return { shell: projection.value };
    },
  );

  server.get<{ Headers: SecurityHeaders }>('/product-api/frontend/home', async (request, reply) => {
    const scope = await timed(() => buildScope(request.headers));
    if (!scope.value.activeProject) {
      throw new ShotgunError({
        code: 'PROJECT_CONTEXT_REQUIRED',
        safeMessage: 'Home requires an active Project.',
        module: 'frontend-product-read',
        operation: 'get-home',
      });
    }
    const projection = await timed(() =>
      coordinator.getHome({ ...scope.value, activeProject: scope.value.activeProject! }),
    );
    reply.header('server-timing', serverTiming(scope.durationMs, projection.durationMs));
    return { home: projection.value };
  });

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/search/query',
    async (request, reply) => {
      const scope = await timed(() => buildScope(request.headers));
      if (!scope.value.activeProject) {
        throw new ShotgunError({
          code: 'PROJECT_CONTEXT_REQUIRED',
          safeMessage: 'Search requires an active Project.',
          module: 'frontend-product-read',
          operation: 'global-search',
        });
      }
      const decoded = decodeGlobalSearchRequest(request.body);
      if (
        decoded.scope.kind === 'CROSS_PROJECT' &&
        decoded.scope.projectIds.some(
          (projectId) =>
            !scope.value.accessibleProjects.some((project) => project.id === projectId),
        )
      ) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: 'Cross-project Search scope is not accessible.',
          module: 'frontend-product-read',
          operation: 'global-search',
        });
      }
      const projection = await timed(() =>
        coordinator.search({
          ...scope.value,
          activeProject: scope.value.activeProject!,
          request: decoded,
        }),
      );
      reply.header('server-timing', serverTiming(scope.durationMs, projection.durationMs));
      return { result: projection.value };
    },
  );

  server.post<{
    Body: { targetRoute?: unknown; resourceProjectId?: unknown };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/route-guard', async (request, reply) => {
    const scope = await timed(() => buildScope(request.headers));
    const requestedRoute = decodeTargetRouteView(request.body?.targetRoute);
    const resourceProjectId = request.body?.resourceProjectId;
    if (resourceProjectId !== undefined && typeof resourceProjectId !== 'string') {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'resourceProjectId is invalid.',
        module: 'frontend-product-read',
        operation: 'route-guard',
      });
    }
    const projection = await timed(() =>
      coordinator.guard({
        ...scope.value,
        requestedRoute,
        ...(resourceProjectId === undefined ? {} : { resourceProjectId }),
      }),
    );
    reply.header('server-timing', serverTiming(scope.durationMs, projection.durationMs));
    return { decision: projection.value };
  });

  server.get<{
    Querystring: { conversationId?: string };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/ask', async (request, reply) => {
    const scope = await timed(() => buildScope(request.headers));
    const conversationId = request.query.conversationId;
    const projection = await timed(() =>
      coordinator.getAskWorkspace({
        ...scope.value,
        ...(conversationId ? { conversationId } : {}),
      }),
    );
    reply.header('server-timing', serverTiming(scope.durationMs, projection.durationMs));
    return { workspace: projection.value };
  });

  server.get<{
    Params: { conversationId: string };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/ask/conversations/:conversationId', async (request, reply) => {
    const scope = await timed(() => buildScope(request.headers));
    const projection = await timed(() =>
      coordinator.getAskConversation({
        ...scope.value,
        conversationId: request.params.conversationId,
      }),
    );
    reply.header('server-timing', serverTiming(scope.durationMs, projection.durationMs));
    return { conversation: projection.value };
  });

  server.get<{
    Params: { conversationId: string; branchId: string };
    Headers: SecurityHeaders;
  }>(
    '/product-api/frontend/ask/conversations/:conversationId/branches/:branchId',
    async (request, reply) => {
      const scope = await timed(() => buildScope(request.headers));
      const projection = await timed(() =>
        coordinator.getAskBranch({
          ...scope.value,
          conversationId: request.params.conversationId,
          branchId: request.params.branchId,
        }),
      );
      reply.header('server-timing', serverTiming(scope.durationMs, projection.durationMs));
      return { branch: projection.value };
    },
  );

  server.get<{
    Params: { answerRunId: string };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/ask/answer-runs/:answerRunId', async (request, reply) => {
    const scope = await timed(() => buildScope(request.headers));
    const projection = await timed(() =>
      coordinator.getAskAnswerRun({
        ...scope.value,
        answerRunId: request.params.answerRunId,
      }),
    );
    reply.header('server-timing', serverTiming(scope.durationMs, projection.durationMs));
    return { answerRun: projection.value };
  });

  server.get<{
    Params: { answerRunId: string };
    Querystring: { afterOrdinal?: string };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/ask/answer-runs/:answerRunId/events', async (request, reply) => {
    const scope = await timed(() => buildScope(request.headers));
    if (!options?.askAnswerExecution) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'Ask answer execution is not configured.',
        module: 'frontend-product-read',
        operation: 'get-answer-run-events',
      });
    }
    const afterOrdinal =
      request.query.afterOrdinal === undefined ? undefined : Number(request.query.afterOrdinal);
    if (afterOrdinal !== undefined && (!Number.isInteger(afterOrdinal) || afterOrdinal < 0)) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'afterOrdinal must be a non-negative integer.',
        module: 'frontend-product-read',
        operation: 'get-answer-run-events',
      });
    }
    const executionScope = await executionScopeFor(scope.value, request.params.answerRunId);
    const events = await options.askAnswerExecution.events(
      executionScope,
      request.params.answerRunId,
      afterOrdinal,
    );
    reply.header('server-timing', serverTiming(scope.durationMs, 0));
    return {
      events: {
        schemaVersion: '1.0.0',
        answerRunId: request.params.answerRunId,
        events,
      },
    };
  });

  server.post<{
    Params: { answerRunId: string };
    Body: unknown;
    Headers: SecurityHeaders;
  }>('/product-api/frontend/ask/answer-runs/:answerRunId/cancel', async (request) => {
    const scope = await timed(() => buildScope(request.headers));
    if (!options?.askAnswerExecution) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'Ask answer execution is not configured.',
        module: 'frontend-product-read',
        operation: 'cancel-answer-run',
      });
    }
    const decoded = decodeAskAnswerRunCommandIdentity(request.body);
    const executionScope = await executionScopeFor(scope.value, request.params.answerRunId);
    return {
      answerRun: await runAnswerCommand({
        scope: scope.value,
        executionScope,
        answerRunId: request.params.answerRunId,
        commandType: ASK_EXECUTION_COMMAND_TYPES.cancel,
        request: decoded,
        action: () =>
          options.askAnswerExecution!.cancel(executionScope, request.params.answerRunId),
      }),
    };
  });

  server.post<{
    Params: { answerRunId: string };
    Body: unknown;
    Headers: SecurityHeaders;
  }>('/product-api/frontend/ask/answer-runs/:answerRunId/retry', async (request) => {
    const scope = await timed(() => buildScope(request.headers));
    if (!options?.askAnswerExecution) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'Ask answer execution is not configured.',
        module: 'frontend-product-read',
        operation: 'retry-answer-run',
      });
    }
    const decoded = decodeAskAnswerRunRetryRequest(request.body);
    const executionScope = await executionScopeFor(scope.value, request.params.answerRunId);
    return {
      answerRun: await runAnswerCommand({
        scope: scope.value,
        executionScope,
        answerRunId: request.params.answerRunId,
        commandType: ASK_EXECUTION_COMMAND_TYPES.retry,
        request: decoded,
        action: () =>
          options.askAnswerExecution!.retry(
            executionScope,
            request.params.answerRunId,
            decoded.mode,
          ),
        onReplay: () =>
          coordinator.getAskAnswerRun({ ...scope.value, answerRunId: request.params.answerRunId }),
      }),
    };
  });

  server.post<{
    Params: { answerRunId: string };
    Body: unknown;
    Headers: SecurityHeaders;
  }>('/product-api/frontend/ask/answer-runs/:answerRunId/export', async (request) => {
    const scope = await timed(() => buildScope(request.headers));
    if (!options?.askAnswerExecution) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'Ask answer execution is not configured.',
        module: 'frontend-product-read',
        operation: 'export-answer-run',
      });
    }
    const decoded = decodeAskAnswerRunExportRequest(request.body);
    const executionScope = await executionScopeFor(scope.value, request.params.answerRunId);
    return {
      export: await runAnswerCommand({
        scope: scope.value,
        executionScope,
        answerRunId: request.params.answerRunId,
        commandType: ASK_EXECUTION_COMMAND_TYPES.export,
        request: decoded,
        action: () =>
          options.askAnswerExecution!.export(
            executionScope,
            request.params.answerRunId,
            decoded.format,
            decoded.clientRequestId,
          ),
      }),
    };
  });

  server.post<{
    Params: { answerRunId: string };
    Body: unknown;
    Headers: SecurityHeaders;
  }>('/product-api/frontend/ask/answer-runs/:answerRunId/feedback', async (request) => {
    const scope = await timed(() => buildScope(request.headers));
    if (!options?.askAnswerExecution) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'Ask answer execution is not configured.',
        module: 'frontend-product-read',
        operation: 'feedback-answer-run',
      });
    }
    const decoded = decodeAskAnswerRunFeedbackRequest(request.body);
    const executionScope = await executionScopeFor(scope.value, request.params.answerRunId);
    return {
      feedback: await runAnswerCommand({
        scope: scope.value,
        executionScope,
        answerRunId: request.params.answerRunId,
        commandType: ASK_EXECUTION_COMMAND_TYPES.feedback,
        request: decoded,
        action: () =>
          options.askAnswerExecution!.feedback(
            executionScope,
            request.params.answerRunId,
            decoded.kind,
            decoded.comment,
            decoded.clientRequestId,
          ),
      }),
    };
  });

  server.post<{
    Params: { answerRunId: string };
    Body: unknown;
    Headers: SecurityHeaders;
  }>('/product-api/frontend/ask/answer-runs/:answerRunId/transition-seed', async (request) => {
    const scope = await timed(() => buildScope(request.headers));
    if (!options?.askAnswerExecution) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'Ask answer execution is not configured.',
        module: 'frontend-product-read',
        operation: 'create-answer-transition-seed',
      });
    }
    const decoded = decodeAskAnswerRunTransitionSeedRequest(request.body);
    const executionScope = await executionScopeFor(scope.value, request.params.answerRunId);
    return {
      seed: await runAnswerCommand({
        scope: scope.value,
        executionScope,
        answerRunId: request.params.answerRunId,
        commandType: ASK_EXECUTION_COMMAND_TYPES.transitionSeed,
        request: decoded,
        action: () =>
          options.askAnswerExecution!.transitionSeed(
            executionScope,
            request.params.answerRunId,
            decoded.kind,
            decoded.clientRequestId,
          ),
      }),
    };
  });

  server.post<{
    Body: unknown;
    Headers: SecurityHeaders;
  }>('/product-api/frontend/ask/questions', async (request, reply) => {
    const scope = await timed(() => buildScope(request.headers));
    const decodedRequest = decodeSubmitAskQuestionRequest(request.body);
    const projection = await timed(() => {
      if (!options?.askCommandCoordinator) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'AskCommandCoordinator is not configured.',
          module: 'frontend-product-read',
          operation: 'submit-question',
        });
      }
      return options.askCommandCoordinator.submitQuestion({
        ...scope.value,
        request: decodedRequest,
      });
    });
    reply.header('server-timing', serverTiming(scope.durationMs, projection.durationMs));
    return { submission: projection.value };
  });

  server.get<{
    Params: { clientRequestId: string };
    Headers: SecurityHeaders;
  }>(
    '/product-api/frontend/ask/question-submissions/by-client-request/:clientRequestId',
    async (request, reply) => {
      const scope = await timed(() => buildScope(request.headers));
      const projection = await timed(() => {
        if (!options?.askCommandCoordinator) {
          throw new ShotgunError({
            code: 'NOT_FOUND',
            safeMessage: 'AskCommandCoordinator is not configured.',
            module: 'frontend-product-read',
            operation: 'get-question-submission',
          });
        }
        return options.askCommandCoordinator.getQuestionSubmissionByClientRequestId({
          ...scope.value,
          clientRequestId: request.params.clientRequestId,
        });
      });
      reply.header('server-timing', serverTiming(scope.durationMs, projection.durationMs));
      return { outcome: projection.value };
    },
  );
};
