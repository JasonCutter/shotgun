import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import type { FrontendProductReadCoordinator } from '../../../../modules/frontend-product-read/src/index.js';
import type {
  AskCommandCoordinator,
  AskProjectExecutionAuthority,
} from '../../../../modules/frontend-ask-write/src/index.js';
import {
  ASK_EXECUTION_COMMAND_TYPES,
  type AskAnswerExecutionService,
  type AskExecutionScope,
  type AskExecutionTransactionPort,
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
  buildCommandSemanticDigestInput,
  type AnyFrontendCommandRequest,
  type ErrorCode,
  type ProducedResourceRef,
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
    const executionAuthorities = Object.fromEntries(
      await Promise.all(
        accessibleProjects.map(async (project) => {
          const membership = memberships.find((candidate) => candidate.projectId === project.id);
          if (!membership) return [] as const;
          const settings = await settingsRepository.getSettingsSnapshot(project.id);
          const authority: AskProjectExecutionAuthority = {
            projectId: project.id,
            accessRevision: `${project.id}:${membership.scopes.slice().sort().join(',')}`,
            policyContextRevision: String(settings.policyContextRevision),
            accessScope: [...membership.scopes].sort(),
            sensitivityClearance: membership.sensitivityClearance,
          };
          return [project.id, authority] as const;
        }),
      ),
    ) as Readonly<Record<string, AskProjectExecutionAuthority>>;
    const activeAuthority = activeProject ? executionAuthorities[activeProject.id] : undefined;
    return {
      principalId: current.principalContext.principalId,
      sessionId: current.session.sessionId,
      activeProject,
      accessibleProjects,
      accessRevision: activeAuthority?.accessRevision ?? 'no-active-project',
      policyContextRevision: activeAuthority?.policyContextRevision ?? 'no-active-project',
      accessScope: activeAuthority?.accessScope ?? [],
      executionAuthorities,
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
    const membership = await authRepository.findMembership(scope.principalId, project.id);
    if (!membership) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The requested AnswerRun was not found.',
        module: 'frontend-product-read',
        operation: 'resolve-answer-run-membership',
      });
    }
    const resourceSettings = await settingsRepository.getSettingsSnapshot(project.id);
    return {
      principalId: scope.principalId,
      projectId: project.id,
      accessRevision: `${project.id}:${membership.scopes.slice().sort().join(',')}`,
      policyContextRevision: String(resourceSettings.policyContextRevision),
      sensitivityClearance: project.sensitivityClearance,
      accessScope: membership.scopes.slice().sort(),
    };
  };

  const runAnswerCommand = async <T>(input: {
    readonly scope: Awaited<ReturnType<typeof buildScope>>;
    readonly executionScope: AskExecutionScope;
    readonly answerRunId: string;
    readonly commandType: string;
    readonly request: Record<string, unknown>;
    readonly action: (transaction?: AskExecutionTransactionPort) => Promise<T>;
    readonly onReplay?: () => Promise<T>;
    readonly producedResources?: (result: T) => readonly ProducedResourceRef[];
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
        observedProjectAccessRevision: input.executionScope.accessRevision,
      },
      policyBinding: {
        mode: 'CURRENT',
        observedPolicyContextRevision: input.executionScope.policyContextRevision,
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
      commandSemanticDigest: buildCommandSemanticDigestInput(commandRequest),
      acceptedPolicyContext: {
        policyContextId: 'frontend-ask-answer-current-policy',
        policyContextRevision: input.executionScope.policyContextRevision,
        acceptedAt: now,
      },
      correlationId: `corr-${randomUUID()}`,
      traceId: `trace-${randomUUID()}`,
      receivedAt: now,
      acceptedAt: now,
    });
    if (accepted.replayed) {
      if (accepted.outcome.outcomeState === 'COMPLETED') {
        if (input.onReplay) return input.onReplay();
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: 'The completed command has no read-only replay resolver.',
          module: 'frontend-product-command',
          operation: 'replay-answer-command',
        });
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
      if (accepted.outcome.outcomeState === 'OUTCOME_UNKNOWN') {
        throw new ShotgunError({
          code: 'OUTCOME_UNKNOWN',
          safeMessage: 'The AnswerRun command outcome must be resolved before retrying.',
          module: 'frontend-product-command',
          operation: 'replay-answer-command',
          retryable: false,
        });
      }
      // An ACCEPTED replay is a recovery signal. Reuse the original commandId and
      // continue through the transaction path so the command can finish after an
      // lost acknowledgement or process interruption. The transactional lock below
      // serializes concurrent replays and lets the loser resolve the completed result.
    }
    try {
      const execution = options?.askAnswerExecution;
      if (!execution) {
        const result = await input.action();
        await gateway.complete({
          commandId: accepted.outcome.commandId,
          producedResources: [{ resourceKind: 'ASK_ANSWER_RUN', resourceId: input.answerRunId }],
          completedAt: new Date().toISOString(),
        });
        return result;
      }
      return await execution.withCommandTransaction(async (transaction) => {
        const locked = await gateway.lockAcceptedForExecution(
          transaction.rawTransaction,
          accepted.outcome.commandId,
        );
        if (locked.outcomeState === 'COMPLETED') {
          if (input.onReplay) return input.onReplay();
          throw new ShotgunError({
            code: 'CONFLICT',
            safeMessage: 'The command completed concurrently without a replay resolver.',
            module: 'frontend-product-command',
            operation: 'concurrent-answer-command',
          });
        }
        const result = await input.action(transaction);
        await gateway.completeInTransaction(transaction.rawTransaction, {
          commandId: accepted.outcome.commandId,
          producedResources: input.producedResources?.(result) ?? [
            { resourceKind: 'ASK_ANSWER_RUN', resourceId: input.answerRunId },
          ],
          completedAt: new Date().toISOString(),
        });
        return result;
      });
    } catch (error) {
      if (error instanceof ShotgunError && error.code === 'OUTCOME_UNKNOWN') {
        try {
          await gateway.markOutcomeUnknown({
            commandId: accepted.outcome.commandId,
            message: error.message,
            completedAt: new Date().toISOString(),
          });
        } catch {
          // Preserve the unknown outcome when the resolution write is unavailable.
        }
        throw error;
      }
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

  server.get<{
    Params: { answerRunId: string; clientRequestId: string };
    Headers: SecurityHeaders;
  }>(
    '/product-api/frontend/ask/answer-runs/:answerRunId/commands/by-client-request/:clientRequestId',
    async (request) => {
      const scope = await buildScope(request.headers);
      const gateway = options?.frontendCommandGateway;
      if (!gateway) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'AnswerRun command outcome resolution is not configured.',
          module: 'frontend-product-read',
          operation: 'get-answer-run-command-outcome',
        });
      }
      const executionScope = await executionScopeFor(scope, request.params.answerRunId);
      const outcome = await gateway.findByClientRequestId(
        scope.principalId,
        request.params.clientRequestId,
        {
          resourceKind: 'ASK_ANSWER_RUN',
          resourceId: request.params.answerRunId,
          commandTypes: Object.values(ASK_EXECUTION_COMMAND_TYPES),
        },
      );
      const targetProjectId =
        outcome && 'targetProjectId' in outcome.acceptedProjectContext
          ? outcome.acceptedProjectContext.targetProjectId
          : undefined;
      if (
        !outcome ||
        outcome.clientRequestId !== request.params.clientRequestId ||
        targetProjectId !== executionScope.projectId ||
        !(Object.values(ASK_EXECUTION_COMMAND_TYPES) as readonly string[]).includes(
          outcome.commandType,
        )
      ) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'AnswerRun command outcome not found.',
          module: 'frontend-product-read',
          operation: 'get-answer-run-command-outcome',
        });
      }
      return {
        outcome,
        targetResource: {
          resourceKind: 'ASK_ANSWER_RUN',
          resourceId: request.params.answerRunId,
        },
      };
    },
  );

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
        action: (transaction) =>
          options.askAnswerExecution!.cancel(
            executionScope,
            request.params.answerRunId,
            transaction,
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
        action: (transaction) =>
          options.askAnswerExecution!.retry(
            executionScope,
            request.params.answerRunId,
            decoded.mode,
            transaction,
          ),
        producedResources: (result) => [
          { resourceKind: 'ASK_ANSWER_RUN', resourceId: result.answerRunId },
          ...(result.attemptId
            ? [{ resourceKind: 'ASK_ANSWER_ATTEMPT', resourceId: result.attemptId }]
            : []),
        ],
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
        action: (transaction) =>
          options.askAnswerExecution!.export(
            executionScope,
            request.params.answerRunId,
            decoded.format,
            decoded.clientRequestId,
            transaction,
          ),
        onReplay: async () => {
          const replay = await options.askAnswerExecution!.findExportByRequestId(
            executionScope,
            request.params.answerRunId,
            decoded.clientRequestId,
          );
          if (!replay)
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The completed export command result is unavailable.',
              module: 'frontend-product-command',
              operation: 'replay-export-answer-run',
            });
          return replay;
        },
        producedResources: (result) => [
          { resourceKind: 'ASK_ANSWER_RUN', resourceId: result.answerRunId },
          { resourceKind: 'ASK_ANSWER_EXPORT', resourceId: result.exportId },
        ],
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
        action: (transaction) =>
          options.askAnswerExecution!.feedback(
            executionScope,
            request.params.answerRunId,
            decoded.kind,
            decoded.comment,
            decoded.clientRequestId,
            transaction,
          ),
        onReplay: async () => {
          const replay = await options.askAnswerExecution!.findFeedbackByRequestId(
            executionScope,
            request.params.answerRunId,
            decoded.clientRequestId,
          );
          if (!replay)
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The completed feedback command result is unavailable.',
              module: 'frontend-product-command',
              operation: 'replay-feedback-answer-run',
            });
          return replay;
        },
        producedResources: (result) => [
          { resourceKind: 'ASK_ANSWER_RUN', resourceId: result.answerRunId },
          { resourceKind: 'ASK_ANSWER_FEEDBACK', resourceId: result.feedbackId },
        ],
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
        action: (transaction) =>
          options.askAnswerExecution!.transitionSeed(
            executionScope,
            request.params.answerRunId,
            decoded.kind,
            decoded.clientRequestId,
            transaction,
          ),
        onReplay: async () => {
          const replay = await options.askAnswerExecution!.findTransitionSeedByRequestId(
            executionScope,
            request.params.answerRunId,
            decoded.kind,
            decoded.clientRequestId,
          );
          if (!replay)
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The completed transition-seed command result is unavailable.',
              module: 'frontend-product-command',
              operation: 'replay-transition-seed',
            });
          return replay;
        },
        producedResources: (result) => [
          { resourceKind: 'ASK_ANSWER_RUN', resourceId: result.answerRunId },
          { resourceKind: 'ASK_TRANSITION_SEED', resourceId: result.seedId },
        ],
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
