import type { FastifyInstance } from 'fastify';
import type { SecurityHeaders } from '../server.js';
import type { ProjectAdministrationRepositoryPort } from '../../../../modules/project-administration/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import { ShotgunError } from '../../../../packages/contracts/src/index.js';

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
    const view = await projectAdminRepo.getProjects(context.principalId);
    return { projects: view.projects };
  });

  server.get<{ Params: { projectId: string }; Headers: SecurityHeaders }>(
    '/api/v1/projects/:projectId',
    async (request) => {
      await requireBrowserSession(request.headers);
      const project = await projectAdminRepo.getProjectDetails(request.params.projectId);
      if (!project) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: `Project '${request.params.projectId}' not found.`,
          module: 'shotgun-app',
          operation: 'get-project-details',
        });
      }
      return { project };
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
      id: request.body.id,
      name: request.body.name,
      description: request.body.description,
      ownerId: context.principalId,
    });

    // Ensure owner membership in authRepo
    await authRepo.bootstrapOwner({
      accountId: context.principalId,
      projectId: request.body.id,
      scopes: ['owner'],
      sensitivityClearance: 'private',
    });

    return { project };
  });

  server.patch<{
    Params: { projectId: string };
    Body: {
      name?: string;
      description?: string;
      expectedRevision: number;
    };
    Headers: SecurityHeaders;
  }>('/api/v1/projects/:projectId', async (request) => {
    await requireBrowserSession(request.headers);
    if (typeof request.body.expectedRevision !== 'number') {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'expectedRevision is required for project updates.',
        module: 'shotgun-app',
        operation: 'update-project',
      });
    }
    const project = await projectAdminRepo.updateProject({
      projectId: request.params.projectId,
      name: request.body.name,
      description: request.body.description,
      expectedRevision: request.body.expectedRevision,
    });
    return { project };
  });

  server.post<{
    Params: { projectId: string };
    Body: { expectedRevision: number };
    Headers: SecurityHeaders;
  }>('/api/v1/projects/:projectId/archive', async (request) => {
    await requireBrowserSession(request.headers);
    const project = await projectAdminRepo.archiveProject(
      request.params.projectId,
      request.body.expectedRevision,
    );
    return { project };
  });

  server.post<{
    Params: { projectId: string };
    Body: { expectedRevision: number };
    Headers: SecurityHeaders;
  }>('/api/v1/projects/:projectId/restore', async (request) => {
    await requireBrowserSession(request.headers);
    const project = await projectAdminRepo.restoreProject(
      request.params.projectId,
      request.body.expectedRevision,
    );
    return { project };
  });

  server.post<{
    Params: { projectId: string };
    Body: { expectedRevision: number };
    Headers: SecurityHeaders;
  }>('/api/v1/projects/:projectId/delete-request', async (request) => {
    await requireBrowserSession(request.headers);
    const project = await projectAdminRepo.requestDeleteProject(
      request.params.projectId,
      request.body.expectedRevision,
    );
    return { project };
  });
}
