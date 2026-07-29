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
    async (request) => ({
      shell: await coordinator.getGlobalShell(await buildScope(request.headers)),
    }),
  );

  server.get<{ Headers: SecurityHeaders }>('/product-api/frontend/home', async (request) => {
    const scope = await buildScope(request.headers);
    if (!scope.activeProject) {
      throw new ShotgunError({
        code: 'PROJECT_CONTEXT_REQUIRED',
        safeMessage: 'Home requires an active Project.',
        module: 'frontend-product-read',
        operation: 'get-home',
      });
    }
    return { home: await coordinator.getHome({ ...scope, activeProject: scope.activeProject }) };
  });

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/search/query',
    async (request) => {
      const scope = await buildScope(request.headers);
      if (!scope.activeProject) {
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
          (projectId) => !scope.accessibleProjects.some((project) => project.id === projectId),
        )
      ) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: 'Cross-project Search scope is not accessible.',
          module: 'frontend-product-read',
          operation: 'global-search',
        });
      }
      return {
        result: await coordinator.search({
          ...scope,
          activeProject: scope.activeProject,
          request: decoded,
        }),
      };
    },
  );

  server.post<{
    Body: { targetRoute?: unknown; resourceProjectId?: unknown };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/route-guard', async (request) => {
    const scope = await buildScope(request.headers);
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
    return {
      decision: await coordinator.guard({
        ...scope,
        requestedRoute,
        ...(resourceProjectId === undefined ? {} : { resourceProjectId }),
      }),
    };
  });
};
