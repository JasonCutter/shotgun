import type { FastifyInstance } from 'fastify';
import type { SecurityHeaders } from '../server.js';
import type { ProjectAdministrationRepositoryPort } from '../../../../modules/project-administration/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import { ShotgunError } from '../../../../packages/contracts/src/index.js';
import { randomUUID } from 'crypto';

export function registerProjectRoutes(
  server: FastifyInstance,
  projectAdminRepo: ProjectAdministrationRepositoryPort,
  authRepo: AuthRepositoryPort,
  requireBrowserSession: (headers: Record<string, string | string[] | undefined>) => Promise<{
    context: { principalId: string; projectId: string };
  }>,
): void {
  server.get<{ Headers: SecurityHeaders }>('/api/v1/projects', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const memberships = await authRepo.listMemberships(context.principalId);
    if (memberships.length === 0) {
      return { projects: [] };
    }
    const projectIds = memberships.map((m) => m.projectId);
    const view = await projectAdminRepo.getProjects(projectIds);

    // Merge membership data into the view
    const projectsWithAccess = view.projects.map((p) => {
      const mem = memberships.find((m) => m.projectId === p.id);
      if (!mem) return p;
      const hasEdit = mem.isOwner || mem.scopes.includes('owner') || mem.scopes.includes('admin');
      const isActive = p.status === 'ACTIVE';
      const isArchived = p.status === 'ARCHIVED';
      return {
        ...p,
        isOwner: mem.isOwner,
        capability: {
          ...p.capability,
          canRename: hasEdit && isActive,
          canArchive: hasEdit && isActive,
          canRestore: hasEdit && isArchived,
          canDelete: hasEdit && (isActive || isArchived),
          canManagePolicies: hasEdit && isActive,
        },
      };
    });

    return { projects: projectsWithAccess };
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
      const hasEdit =
        membership.isOwner ||
        membership.scopes.includes('owner') ||
        membership.scopes.includes('admin');
      const isActive = project.status === 'ACTIVE';
      const isArchived = project.status === 'ARCHIVED';
      const enrichedProject = {
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
      return { project: enrichedProject };
    },
  );

  server.post<{
    Body: {
      id: string;
      name: string;
      description?: string;
      clientRequestId: string;
      idempotencyKey: string;
    };
    Headers: SecurityHeaders;
  }>('/api/v1/projects', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    if (!request.body.id || !request.body.name) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'Project ID and name are required.',
        module: 'shotgun-app',
        operation: 'create-project',
      });
    }

    // Atomic Project Creation Coordinator
    const project = await projectAdminRepo.createProject({
      commandId: randomUUID(),
      clientRequestId: request.body.clientRequestId,
      idempotencyKey: request.body.idempotencyKey,
      projectId: request.body.id,
      actorPrincipalId: context.principalId,
      expectedProjectRevision: 0,
      name: request.body.name,
      description: request.body.description,
    });

    // Ensure owner membership in authRepo (handled atomically by projectAdminRepo)

    return { project };
  });

  server.patch<{
    Params: { projectId: string };
    Body: {
      name?: string;
      description?: string;
      expectedRevision: number;
      clientRequestId: string;
      idempotencyKey: string;
    };
    Headers: SecurityHeaders;
  }>('/api/v1/projects/:projectId', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    if (typeof request.body.expectedRevision !== 'number') {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'expectedRevision is required for project updates.',
        module: 'shotgun-app',
        operation: 'update-project',
      });
    }
    const membership = await authRepo.findMembership(context.principalId, request.params.projectId);
    if (!membership) {
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: `You do not have access to project '${request.params.projectId}'.`,
        module: 'shotgun-app',
        operation: 'update-project',
      });
    }
    const projectDetail = await projectAdminRepo.getProjectDetails(request.params.projectId);
    if (!projectDetail || !projectDetail.capability.canRename) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: `Project cannot be renamed or updated at this time.`,
        module: 'shotgun-app',
        operation: 'update-project',
      });
    }
    const project = await projectAdminRepo.updateProject({
      commandId: randomUUID(),
      clientRequestId: request.body.clientRequestId,
      idempotencyKey: request.body.idempotencyKey,
      projectId: request.params.projectId,
      actorPrincipalId: context.principalId,
      expectedProjectRevision: request.body.expectedRevision,
      name: request.body.name,
      description: request.body.description,
    });
    return { project };
  });

  server.post<{
    Params: { projectId: string };
    Body: { expectedRevision: number; clientRequestId: string; idempotencyKey: string };
    Headers: SecurityHeaders;
  }>('/api/v1/projects/:projectId/archive', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const membership = await authRepo.findMembership(context.principalId, request.params.projectId);
    if (!membership) {
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: `You do not have access to project '${request.params.projectId}'.`,
        module: 'shotgun-app',
        operation: 'archive-project',
      });
    }
    const projectDetail = await projectAdminRepo.getProjectDetails(request.params.projectId);
    if (!projectDetail || !projectDetail.capability.canArchive) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: `Project cannot be archived at this time.`,
        module: 'shotgun-app',
        operation: 'archive-project',
      });
    }
    const project = await projectAdminRepo.archiveProject({
      commandId: randomUUID(),
      clientRequestId: request.body.clientRequestId,
      idempotencyKey: request.body.idempotencyKey,
      projectId: request.params.projectId,
      actorPrincipalId: context.principalId,
      expectedProjectRevision: request.body.expectedRevision,
    });
    return { project };
  });

  server.post<{
    Params: { projectId: string };
    Body: { expectedRevision: number; clientRequestId: string; idempotencyKey: string };
    Headers: SecurityHeaders;
  }>('/api/v1/projects/:projectId/restore', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const membership = await authRepo.findMembership(context.principalId, request.params.projectId);
    if (!membership) {
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: `You do not have access to project '${request.params.projectId}'.`,
        module: 'shotgun-app',
        operation: 'restore-project',
      });
    }
    const projectDetail = await projectAdminRepo.getProjectDetails(request.params.projectId);
    if (!projectDetail || !projectDetail.capability.canRestore) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: `Project cannot be restored at this time.`,
        module: 'shotgun-app',
        operation: 'restore-project',
      });
    }
    const project = await projectAdminRepo.restoreProject({
      commandId: randomUUID(),
      clientRequestId: request.body.clientRequestId,
      idempotencyKey: request.body.idempotencyKey,
      projectId: request.params.projectId,
      actorPrincipalId: context.principalId,
      expectedProjectRevision: request.body.expectedRevision,
    });
    return { project };
  });

  server.post<{
    Params: { projectId: string };
    Body: { expectedRevision: number; clientRequestId: string; idempotencyKey: string };
    Headers: SecurityHeaders;
  }>('/api/v1/projects/:projectId/delete-request', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const membership = await authRepo.findMembership(context.principalId, request.params.projectId);
    if (!membership) {
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: `You do not have access to project '${request.params.projectId}'.`,
        module: 'shotgun-app',
        operation: 'delete-project',
      });
    }
    const projectDetail = await projectAdminRepo.getProjectDetails(request.params.projectId);
    if (!projectDetail || !projectDetail.capability.canDelete) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: `Project cannot be deleted at this time.`,
        module: 'shotgun-app',
        operation: 'delete-project',
      });
    }
    const project = await projectAdminRepo.requestDeleteProject({
      commandId: randomUUID(),
      clientRequestId: request.body.clientRequestId,
      idempotencyKey: request.body.idempotencyKey,
      projectId: request.params.projectId,
      actorPrincipalId: context.principalId,
      expectedProjectRevision: request.body.expectedRevision,
    });
    return { project };
  });
}
