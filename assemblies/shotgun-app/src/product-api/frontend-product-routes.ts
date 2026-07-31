import type { FastifyInstance } from 'fastify';

import type { FrontendProductReadCoordinator } from '../../../../modules/frontend-product-read/src/index.js';
import type { ProjectAdministrationRepositoryPort } from '../../../../modules/project-administration/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import {
  ShotgunError,
  decodeGlobalSearchRequest,
  decodeTargetRouteView,
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
};
