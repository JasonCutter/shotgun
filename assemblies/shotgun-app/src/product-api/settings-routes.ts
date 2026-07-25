import type { FastifyInstance } from 'fastify';
import type { SecurityHeaders } from '../server.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import { ShotgunError, FrontendContractError } from '../../../../packages/contracts/src/index.js';

import type { ProjectAdministrationRepositoryPort } from '../../../../modules/project-administration/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';

export function registerSettingsRoutes(
  server: FastifyInstance,
  settingsRepo: SettingsRepositoryPort,
  authRepo: AuthRepositoryPort,
  projectAdminRepo: ProjectAdministrationRepositoryPort,
  requireBrowserSession: (headers: Record<string, string | string[] | undefined>) => Promise<{
    context: { principalId: string; projectId: string };
  }>,
): void {
  server.get<{ Querystring: { targetProjectId?: string }; Headers: SecurityHeaders }>(
    '/api/v1/settings/snapshot',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const targetProjectId = request.query.targetProjectId ?? context.projectId;
      const membership = await authRepo.findMembership(context.principalId, targetProjectId);
      if (!membership) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: `You do not have access to project '${targetProjectId}'.`,
          module: 'shotgun-app',
          operation: 'get-settings-snapshot',
        });
      }
      const snapshot = await settingsRepo.getSettingsSnapshot(targetProjectId);
      return { snapshot };
    },
  );

  server.get<{ Querystring: { targetProjectId?: string }; Headers: SecurityHeaders }>(
    '/api/v1/settings/categories',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const targetProjectId = request.query.targetProjectId ?? context.projectId;
      const membership = await authRepo.findMembership(context.principalId, targetProjectId);
      if (!membership) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: `You do not have access to project '${targetProjectId}'.`,
          module: 'shotgun-app',
          operation: 'get-settings-categories',
        });
      }
      const snapshot = await settingsRepo.getSettingsSnapshot(targetProjectId);
      return { categories: snapshot.categories };
    },
  );

  server.get<{ Headers: SecurityHeaders }>('/api/v1/settings/preferences', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const preferences = await settingsRepo.getPrincipalPreferences(context.principalId);
    return { preferences };
  });

  server.post<{
    Body: {
      commandId: string;
      clientRequestId: string;
      idempotencyKey: string;
      expectedPreferenceRevision: number;
      preferences: Record<string, unknown>;
    };
    Headers: SecurityHeaders;
  }>('/api/v1/settings/preferences', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    if (!request.body.commandId || !request.body.clientRequestId || !request.body.idempotencyKey) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'commandId, clientRequestId, and idempotencyKey are required.',
        module: 'shotgun-app',
        operation: 'update-principal-preferences',
      });
    }

    const preferences = await settingsRepo.updatePrincipalPreferences({
      commandId: request.body.commandId,
      clientRequestId: request.body.clientRequestId,
      idempotencyKey: request.body.idempotencyKey,
      principalId: context.principalId,
      expectedPreferenceRevision: request.body.expectedPreferenceRevision ?? 0,
      preferences: request.body.preferences ?? {},
    });
    return { preferences };
  });

  server.post<{
    Body: { targetProjectId?: string; draft: Record<string, unknown> };
    Headers: SecurityHeaders;
  }>('/api/v1/settings/validate', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const targetProjectId = request.body.targetProjectId ?? context.projectId;
    const membership = await authRepo.findMembership(context.principalId, targetProjectId);
    if (!membership) {
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: `You do not have access to project '${targetProjectId}'.`,
        module: 'shotgun-app',
        operation: 'validate-settings-draft',
      });
    }
    const validation = await settingsRepo.validateSettingsDraft(
      targetProjectId,
      request.body.draft ?? {},
    );
    return { validation };
  });

  server.post<{
    Body: {
      targetProjectId?: string;
      expectedSettingsRevision: number;
      observedPolicyContextRevision: number;
      draft: Record<string, unknown>;
    };
    Headers: SecurityHeaders;
  }>('/api/v1/settings/impact', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const targetProjectId = request.body.targetProjectId ?? context.projectId;
    const membership = await authRepo.findMembership(context.principalId, targetProjectId);
    if (!membership) {
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: `You do not have access to project '${targetProjectId}'.`,
        module: 'shotgun-app',
        operation: 'preview-settings-impact',
      });
    }
    if (typeof request.body.expectedSettingsRevision !== 'number') {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'expectedSettingsRevision is required to preview settings impact.',
        module: 'shotgun-app',
        operation: 'preview-settings-impact',
      });
    }
    const impact = await settingsRepo.previewSettingsImpact(
      targetProjectId,
      request.body.expectedSettingsRevision,
      request.body.observedPolicyContextRevision ?? 0,
      request.body.draft ?? {},
    );
    return { impact };
  });

  server.post<{
    Body: {
      commandId: string;
      clientRequestId: string;
      idempotencyKey: string;
      targetProjectId?: string;
      expectedSettingsRevision: number;
      observedPolicyContextRevision: number;
      settings: Record<string, unknown>;
    };
    Headers: SecurityHeaders;
  }>('/api/v1/settings/commands', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const targetProjectId = request.body.targetProjectId ?? context.projectId;

    if (!request.body.commandId || !request.body.clientRequestId || !request.body.idempotencyKey) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'commandId, clientRequestId, and idempotencyKey are required.',
        module: 'shotgun-app',
        operation: 'apply-settings-command',
      });
    }

    const membership = await authRepo.findMembership(context.principalId, targetProjectId);
    if (!membership) {
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: `You do not have access to project '${targetProjectId}'.`,
        module: 'shotgun-app',
        operation: 'apply-settings-command',
      });
    }

    const projectDetail = await projectAdminRepo.getProjectDetails(targetProjectId);
    if (!projectDetail || !projectDetail.capability.canManagePolicies) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: `You do not have permission to manage policies on this project.`,
        module: 'shotgun-app',
        operation: 'apply-settings-command',
      });
    }

    try {
      const result = await settingsRepo.applySettingsCommand({
        commandId: request.body.commandId,
        clientRequestId: request.body.clientRequestId,
        idempotencyKey: request.body.idempotencyKey,
        projectId: targetProjectId,
        expectedSettingsRevision: request.body.expectedSettingsRevision,
        observedPolicyContextRevision: request.body.observedPolicyContextRevision ?? 0,
        settings: request.body.settings ?? {},
        actorId: context.principalId,
      });

      return { result };
    } catch (err: unknown) {
      if (err instanceof FrontendContractError && err.code === 'REVISION_CONFLICT') {
        throw new ShotgunError({
          code: 'CONFLICT',
          safeMessage: err.message,
          module: 'settings-policy',
          operation: 'apply-settings-command',
        });
      }
      throw err;
    }
  });

  server.get<{ Params: { commandId: string }; Headers: SecurityHeaders }>(
    '/api/v1/settings/commands/:commandId',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const result = await settingsRepo.getCommandStatus(request.params.commandId);
      if (!result) {
        // Return NOT_FOUND without revealing whether the command belongs to another project
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: `Command not found.`,
          module: 'shotgun-app',
          operation: 'get-settings-command-status',
        });
      }
      // Verify the caller has membership on the command's project
      const membership = await authRepo.findMembership(context.principalId, result.projectId ?? '');
      if (!membership) {
        // Treat as not found to avoid revealing command existence to unauthorized principals
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: `Command not found.`,
          module: 'shotgun-app',
          operation: 'get-settings-command-status',
        });
      }
      return { result };
    },
  );

  server.get<{ Querystring: { targetProjectId?: string }; Headers: SecurityHeaders }>(
    '/api/v1/settings/models',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const targetProjectId = request.query.targetProjectId ?? context.projectId;
      const membership = await authRepo.findMembership(context.principalId, targetProjectId);
      if (!membership) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: `You do not have access to project '${targetProjectId}'.`,
          module: 'shotgun-app',
          operation: 'get-settings-models',
        });
      }
      const models = await settingsRepo.getModelDescriptors(targetProjectId);
      return { models };
    },
  );

  server.get<{ Querystring: { targetProjectId?: string }; Headers: SecurityHeaders }>(
    '/api/v1/settings/costs',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const targetProjectId = request.query.targetProjectId ?? context.projectId;
      const membership = await authRepo.findMembership(context.principalId, targetProjectId);
      if (!membership) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: `You do not have access to project '${targetProjectId}'.`,
          module: 'shotgun-app',
          operation: 'get-settings-costs',
        });
      }
      const costs = await settingsRepo.getCostBudget(targetProjectId);
      return { costs };
    },
  );

  server.get<{ Querystring: { targetProjectId?: string }; Headers: SecurityHeaders }>(
    '/api/v1/settings/privacy',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const targetProjectId = request.query.targetProjectId ?? context.projectId;
      const membership = await authRepo.findMembership(context.principalId, targetProjectId);
      if (!membership) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: `You do not have access to project '${targetProjectId}'.`,
          module: 'shotgun-app',
          operation: 'get-settings-privacy',
        });
      }
      const privacy = await settingsRepo.getPrivacyRetention(targetProjectId);
      return { privacy };
    },
  );

  server.get<{ Querystring: { targetProjectId?: string }; Headers: SecurityHeaders }>(
    '/api/v1/settings/connectors',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const targetProjectId = request.query.targetProjectId ?? context.projectId;
      const membership = await authRepo.findMembership(context.principalId, targetProjectId);
      if (!membership) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: `You do not have access to project '${targetProjectId}'.`,
          module: 'shotgun-app',
          operation: 'get-settings-connectors',
        });
      }
      const connectors = await settingsRepo.getConnectorSettings(targetProjectId);
      return { connectors };
    },
  );

  server.get<{ Querystring: { targetProjectId?: string }; Headers: SecurityHeaders }>(
    '/api/v1/settings/directives',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const targetProjectId = request.query.targetProjectId ?? context.projectId;
      const membership = await authRepo.findMembership(context.principalId, targetProjectId);
      if (!membership) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: `You do not have access to project '${targetProjectId}'.`,
          module: 'shotgun-app',
          operation: 'get-settings-directives',
        });
      }
      const proposals = await settingsRepo.getDirectiveProposals(targetProjectId);
      return { proposals };
    },
  );

  server.get<{ Querystring: { targetProjectId?: string }; Headers: SecurityHeaders }>(
    '/api/v1/settings/schema',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const targetProjectId = request.query.targetProjectId ?? context.projectId;
      const membership = await authRepo.findMembership(context.principalId, targetProjectId);
      if (!membership) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: `You do not have access to project '${targetProjectId}'.`,
          module: 'shotgun-app',
          operation: 'get-settings-schema',
        });
      }
      const schemaPacks = await settingsRepo.getSchemaPacks(targetProjectId);
      return { schemaPacks };
    },
  );

  server.get<{ Querystring: { targetProjectId?: string }; Headers: SecurityHeaders }>(
    '/api/v1/settings/diagnostics',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const targetProjectId = request.query.targetProjectId ?? context.projectId;
      const membership = await authRepo.findMembership(context.principalId, targetProjectId);
      if (!membership) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: `You do not have access to project '${targetProjectId}'.`,
          module: 'shotgun-app',
          operation: 'get-settings-diagnostics',
        });
      }
      const diagnostics = await settingsRepo.getDiagnostics(targetProjectId);
      return { diagnostics };
    },
  );
}
