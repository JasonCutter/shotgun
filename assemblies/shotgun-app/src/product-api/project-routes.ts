import type { FastifyInstance } from 'fastify';

import type { FrontendCommandGatewayPort } from '../../../../modules/frontend-command-gateway/src/index.js';
import type { ProjectAdministrationRepositoryPort } from '../../../../modules/project-administration/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import {
  SECTION2_FRONTEND_COMMAND_TYPES,
  ShotgunError,
  validateSection2FrontendCommandRequest,
  type CreateProjectCommandPayload,
  type ProjectListItemView,
  type Section2FrontendCommandType,
  type UpdateProjectMetadataCommandPayload,
} from '../../../../packages/contracts/src/index.js';
import type { SecurityHeaders } from '../server.js';
import {
  acceptSection2Command,
  rejectAcceptedCommand,
  requireRevisionPrecondition,
  toProductApiCommandError,
} from './frontend-command-route.js';

type BrowserSessionResolver = (
  headers: Record<string, string | string[] | undefined>,
) => Promise<{ context: { principalId: string; projectId: string } }>;

const canAdminister = (membership: {
  readonly isOwner: boolean;
  readonly scopes: readonly string[];
}): boolean =>
  membership.isOwner || membership.scopes.includes('owner') || membership.scopes.includes('admin');

const requireProjectAdministration = async (
  authRepo: AuthRepositoryPort,
  principalId: string,
  projectId: string,
  operation: string,
) => {
  const membership = await authRepo.findMembership(principalId, projectId);
  if (!membership || !canAdminister(membership)) {
    throw new ShotgunError({
      code: 'PROJECT_ACCESS_DENIED',
      safeMessage: `You do not have permission to administer project '${projectId}'.`,
      module: 'shotgun-app',
      operation,
    });
  }
  return membership;
};

const enrichProject = (
  project: ProjectListItemView,
  membership: { readonly isOwner: boolean; readonly scopes: readonly string[] },
): ProjectListItemView => {
  const hasEdit = canAdminister(membership);
  const isActive = project.status === 'ACTIVE';
  const isArchived = project.status === 'ARCHIVED';
  return {
    ...project,
    isOwner: membership.isOwner,
    capability: {
      ...project.capability,
      canRename: hasEdit && isActive,
      canArchive: hasEdit && isActive,
      canRestore: hasEdit && isArchived,
      canDelete: hasEdit && (isActive || isArchived),
      canManagePolicies: hasEdit && isActive,
    },
  };
};

export function registerProjectRoutes(
  server: FastifyInstance,
  projectAdminRepo: ProjectAdministrationRepositoryPort,
  settingsRepo: SettingsRepositoryPort,
  commandGateway: FrontendCommandGatewayPort,
  authRepo: AuthRepositoryPort,
  requireBrowserSession: BrowserSessionResolver,
): void {
  server.get<{ Headers: SecurityHeaders }>('/api/v1/projects', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const memberships = await authRepo.listMemberships(context.principalId);
    if (memberships.length === 0) return { projects: [] };
    const view = await projectAdminRepo.getProjects(memberships.map((item) => item.projectId));
    return {
      projects: view.projects
        .filter((project) => memberships.some((item) => item.projectId === project.id))
        .map((project) =>
          enrichProject(
            project,
            memberships.find((item) => item.projectId === project.id)!,
          ),
        ),
    };
  });

  server.get<{ Params: { projectId: string }; Headers: SecurityHeaders }>(
    '/api/v1/projects/:projectId',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const membership = await authRepo.findMembership(
        context.principalId,
        request.params.projectId,
      );
      if (!membership) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: `You do not have access to project '${request.params.projectId}'.`,
          module: 'shotgun-app',
          operation: 'get-project-details',
        });
      }
      const project = await projectAdminRepo.getProjectDetails(request.params.projectId);
      if (!project) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: `Project '${request.params.projectId}' not found.`,
          module: 'shotgun-app',
          operation: 'get-project-details',
        });
      }
      return { project: enrichProject(project, membership) };
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>('/api/v1/projects', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    try {
      const decoded = validateSection2FrontendCommandRequest(
        request.body,
        SECTION2_FRONTEND_COMMAND_TYPES.createProject,
      );
      await requireProjectAdministration(
        authRepo,
        context.principalId,
        context.projectId,
        'create-project',
      );
      const accepted = await acceptSection2Command({
        rawRequest: decoded,
        expectedCommandType: SECTION2_FRONTEND_COMMAND_TYPES.createProject,
        principalId: context.principalId,
        sessionActiveProjectId: context.projectId,
        settingsRepository: settingsRepo,
        commandGateway,
      });
      const payload = accepted.request.payload as CreateProjectCommandPayload;
      if (accepted.replayed) {
        const project = await projectAdminRepo.getProjectDetails(payload.newProjectId);
        return { outcome: accepted.outcome, project };
      }
      try {
        const project = await projectAdminRepo.createProject({
          commandId: accepted.outcome.commandId,
          clientRequestId: accepted.request.clientRequestId,
          idempotencyKey: accepted.request.idempotencyKey,
          projectId: payload.newProjectId,
          actorPrincipalId: context.principalId,
          expectedProjectRevision: 0,
          name: payload.name,
          description: payload.description,
          locale: payload.locale,
          timezone: payload.timezone,
          privacyProfile: payload.privacyProfile,
          modelProfile: payload.modelProfile,
          costProfile: payload.costProfile,
        });
        const outcome = await commandGateway.complete({
          commandId: accepted.outcome.commandId,
          producedResources: [
            {
              resourceKind: 'project',
              resourceId: project.id,
              resourceRevision: String(project.revision),
            },
          ],
          completedAt: new Date().toISOString(),
        });
        return { outcome, project };
      } catch (error) {
        await rejectAcceptedCommand(commandGateway, accepted.outcome.commandId, error);
        throw error;
      }
    } catch (error) {
      throw toProductApiCommandError(error, 'create-project');
    }
  });

  registerExistingProjectCommand({
    server,
    path: '/api/v1/projects/:projectId',
    method: 'PATCH',
    commandType: SECTION2_FRONTEND_COMMAND_TYPES.updateProjectMetadata,
    operation: 'update-project',
    requiredCapability: 'canRename',
    projectAdminRepo,
    settingsRepo,
    commandGateway,
    authRepo,
    requireBrowserSession,
    execute: async (projectId, principalId, revision, commandId, request) => {
      const payload = request.payload as UpdateProjectMetadataCommandPayload;
      return projectAdminRepo.updateProject({
        commandId,
        clientRequestId: request.clientRequestId,
        idempotencyKey: request.idempotencyKey,
        projectId,
        actorPrincipalId: principalId,
        expectedProjectRevision: revision,
        name: payload.name,
        description: payload.description,
      });
    },
  });

  for (const definition of [
    {
      path: '/api/v1/projects/:projectId/archive',
      commandType: SECTION2_FRONTEND_COMMAND_TYPES.archiveProject,
      operation: 'archive-project',
      requiredCapability: 'canArchive' as const,
    },
    {
      path: '/api/v1/projects/:projectId/restore',
      commandType: SECTION2_FRONTEND_COMMAND_TYPES.restoreProject,
      operation: 'restore-project',
      requiredCapability: 'canRestore' as const,
    },
    {
      path: '/api/v1/projects/:projectId/delete-request',
      commandType: SECTION2_FRONTEND_COMMAND_TYPES.requestProjectDeletion,
      operation: 'delete-project',
      requiredCapability: 'canDelete' as const,
    },
  ] as const) {
    const execute =
      definition.commandType === SECTION2_FRONTEND_COMMAND_TYPES.archiveProject
        ? projectAdminRepo.archiveProject.bind(projectAdminRepo)
        : definition.commandType === SECTION2_FRONTEND_COMMAND_TYPES.restoreProject
          ? projectAdminRepo.restoreProject.bind(projectAdminRepo)
          : projectAdminRepo.requestDeleteProject.bind(projectAdminRepo);
    registerExistingProjectCommand({
      server,
      path: definition.path,
      method: 'POST',
      commandType: definition.commandType,
      operation: definition.operation,
      requiredCapability: definition.requiredCapability,
      projectAdminRepo,
      settingsRepo,
      commandGateway,
      authRepo,
      requireBrowserSession,
      execute: (projectId, principalId, revision, commandId, request) =>
        execute({
          commandId,
          clientRequestId: request.clientRequestId,
          idempotencyKey: request.idempotencyKey,
          projectId,
          actorPrincipalId: principalId,
          expectedProjectRevision: revision,
        }),
    });
  }
}

type ProjectCapabilityKey = 'canRename' | 'canArchive' | 'canRestore' | 'canDelete';

const registerExistingProjectCommand = (input: {
  readonly server: FastifyInstance;
  readonly path: string;
  readonly method: 'PATCH' | 'POST';
  readonly commandType: Section2FrontendCommandType;
  readonly operation: string;
  readonly requiredCapability: ProjectCapabilityKey;
  readonly projectAdminRepo: ProjectAdministrationRepositoryPort;
  readonly settingsRepo: SettingsRepositoryPort;
  readonly commandGateway: FrontendCommandGatewayPort;
  readonly authRepo: AuthRepositoryPort;
  readonly requireBrowserSession: BrowserSessionResolver;
  readonly execute: (
    projectId: string,
    principalId: string,
    revision: number,
    commandId: string,
    request: ReturnType<typeof validateSection2FrontendCommandRequest>,
  ) => Promise<ProjectListItemView>;
}): void => {
  input.server.route<{
    Params: { projectId: string };
    Body: unknown;
    Headers: SecurityHeaders;
  }>({
    method: input.method,
    url: input.path,
    handler: async (request) => {
      const { context } = await input.requireBrowserSession(request.headers);
      try {
        const decoded = validateSection2FrontendCommandRequest(request.body, input.commandType);
        if (
          decoded.projectContext.targetProjectId !== request.params.projectId ||
          decoded.projectContext.resourceProjectId !== request.params.projectId
        ) {
          throw new ShotgunError({
            code: 'VALIDATION_ERROR',
            safeMessage: 'Route project does not match the command project binding.',
            module: 'frontend-command-gateway',
            operation: input.operation,
          });
        }
        await requireProjectAdministration(
          input.authRepo,
          context.principalId,
          request.params.projectId,
          input.operation,
        );
        const detail = await input.projectAdminRepo.getProjectDetails(request.params.projectId);
        if (!detail || !detail.capability[input.requiredCapability]) {
          throw new ShotgunError({
            code: 'VALIDATION_ERROR',
            safeMessage: `Project cannot perform '${input.commandType}' in its current state.`,
            module: 'shotgun-app',
            operation: input.operation,
          });
        }
        const revision = requireRevisionPrecondition(decoded, {
          purpose: 'TARGET',
          resourceKind: 'project',
          resourceId: request.params.projectId,
        });
        const accepted = await acceptSection2Command({
          rawRequest: decoded,
          expectedCommandType: input.commandType,
          principalId: context.principalId,
          sessionActiveProjectId: context.projectId,
          settingsRepository: input.settingsRepo,
          commandGateway: input.commandGateway,
        });
        if (accepted.replayed) {
          const project = await input.projectAdminRepo.getProjectDetails(request.params.projectId);
          return { outcome: accepted.outcome, project };
        }
        try {
          const project = await input.execute(
            request.params.projectId,
            context.principalId,
            revision,
            accepted.outcome.commandId,
            decoded,
          );
          const outcome = await input.commandGateway.complete({
            commandId: accepted.outcome.commandId,
            producedResources: [
              {
                resourceKind: 'project',
                resourceId: project.id,
                resourceRevision: String(project.revision),
              },
            ],
            completedAt: new Date().toISOString(),
          });
          return { outcome, project };
        } catch (error) {
          await rejectAcceptedCommand(input.commandGateway, accepted.outcome.commandId, error);
          throw error;
        }
      } catch (error) {
        throw toProductApiCommandError(error, input.operation);
      }
    },
  });
};
