import type { FastifyInstance } from 'fastify';
import type { SecurityHeaders } from '../server.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type { FrontendCommandGatewayPort } from '../../../../modules/frontend-command-gateway/src/index.js';
import {
  ShotgunError,
  SECTION2_FRONTEND_COMMAND_TYPES,
  validateSection2FrontendCommandRequest,
  type ApplyProjectPolicyCommandPayload,
  type UpdatePreferenceCommandPayload,
} from '../../../../packages/contracts/src/index.js';

import type { ProjectAdministrationRepositoryPort } from '../../../../modules/project-administration/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import {
  acceptSection2Command,
  rejectAcceptedCommand,
  requireRevisionPrecondition,
  toProductApiCommandError,
} from './frontend-command-route.js';

export function registerSettingsRoutes(
  server: FastifyInstance,
  settingsRepo: SettingsRepositoryPort,
  commandGateway: FrontendCommandGatewayPort,
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
    const preferenceRevision = await settingsRepo.getPrincipalPreferenceRevision(
      context.principalId,
    );
    return { preferences, preferenceRevision };
  });

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/api/v1/settings/preferences',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      try {
        const decoded = validateSection2FrontendCommandRequest(
          request.body,
          SECTION2_FRONTEND_COMMAND_TYPES.updatePreference,
        );
        const expectedPreferenceRevision = requireRevisionPrecondition(decoded, {
          purpose: 'TARGET',
          resourceKind: 'principal-preferences',
          resourceId: 'self',
        });
        const accepted = await acceptSection2Command({
          rawRequest: decoded,
          expectedCommandType: SECTION2_FRONTEND_COMMAND_TYPES.updatePreference,
          principalId: context.principalId,
          sessionActiveProjectId: context.projectId,
          settingsRepository: settingsRepo,
          commandGateway,
        });
        if (accepted.replayed) {
          const preferences = await settingsRepo.getPrincipalPreferences(context.principalId);
          const preferenceRevision = await settingsRepo.getPrincipalPreferenceRevision(
            context.principalId,
          );
          return { outcome: accepted.outcome, preferences, preferenceRevision };
        }
        try {
          const payload = accepted.request.payload as UpdatePreferenceCommandPayload;
          const preferences = await settingsRepo.updatePrincipalPreferences({
            commandId: accepted.outcome.commandId,
            clientRequestId: accepted.request.clientRequestId,
            idempotencyKey: accepted.request.idempotencyKey,
            principalId: context.principalId,
            expectedPreferenceRevision,
            preferences: payload.preferences,
          });
          const preferenceRevision = await settingsRepo.getPrincipalPreferenceRevision(
            context.principalId,
          );
          const outcome = await commandGateway.complete({
            commandId: accepted.outcome.commandId,
            producedResources: [
              {
                resourceKind: 'principal-preferences',
                resourceId: 'self',
                resourceRevision: String(preferenceRevision),
              },
            ],
            completedAt: new Date().toISOString(),
          });
          return { outcome, preferences, preferenceRevision };
        } catch (error) {
          await rejectAcceptedCommand(commandGateway, accepted.outcome.commandId, error);
          throw error;
        }
      } catch (error) {
        throw toProductApiCommandError(error, 'update-principal-preferences');
      }
    },
  );

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

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/api/v1/settings/commands',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      try {
        const decoded = validateSection2FrontendCommandRequest(
          request.body,
          SECTION2_FRONTEND_COMMAND_TYPES.applyProjectPolicy,
        );
        const targetProjectId = decoded.projectContext.targetProjectId;

        const membership = await authRepo.findMembership(context.principalId, targetProjectId);
        if (!membership) {
          throw new ShotgunError({
            code: 'PROJECT_ACCESS_DENIED',
            safeMessage: `You do not have access to project '${targetProjectId}'.`,
            module: 'shotgun-app',
            operation: 'apply-settings-command',
          });
        }
        const hasEdit =
          membership.isOwner ||
          membership.scopes.includes('owner') ||
          membership.scopes.includes('admin');
        if (!hasEdit) {
          throw new ShotgunError({
            code: 'PROJECT_ACCESS_DENIED',
            safeMessage: `You do not have permission to manage settings on project '${targetProjectId}'.`,
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
        const decodedPayload = decoded.payload as ApplyProjectPolicyCommandPayload;
        if (
          Object.prototype.hasOwnProperty.call(
            decodedPayload.settings,
            'privacy.externalTransferAllowed',
          ) &&
          !(membership.isOwner || membership.scopes.includes('owner'))
        ) {
          throw new ShotgunError({
            code: 'PROJECT_ACCESS_DENIED',
            safeMessage: 'Only a Project Owner can review external AI transfer approval.',
            module: 'shotgun-app',
            operation: 'apply-settings-command',
          });
        }

        const expectedSettingsRevision = requireRevisionPrecondition(decoded, {
          purpose: 'TARGET',
          resourceKind: 'project-settings',
          resourceId: targetProjectId,
        });
        const expectedPolicyContextRevision = requireRevisionPrecondition(decoded, {
          purpose: 'POLICY',
          resourceKind: 'project-policy-context',
          resourceId: targetProjectId,
        });
        const accepted = await acceptSection2Command({
          rawRequest: decoded,
          expectedCommandType: SECTION2_FRONTEND_COMMAND_TYPES.applyProjectPolicy,
          principalId: context.principalId,
          sessionActiveProjectId: context.projectId,
          settingsRepository: settingsRepo,
          commandGateway,
        });
        if (accepted.replayed) {
          const result = await settingsRepo.getCommandStatus(accepted.outcome.commandId);
          return { outcome: accepted.outcome, result };
        }
        try {
          const payload = accepted.request.payload as ApplyProjectPolicyCommandPayload;
          const result = await settingsRepo.applySettingsCommand({
            commandId: accepted.outcome.commandId,
            clientRequestId: accepted.request.clientRequestId,
            idempotencyKey: accepted.request.idempotencyKey,
            projectId: targetProjectId,
            expectedSettingsRevision,
            observedPolicyContextRevision: expectedPolicyContextRevision,
            settings: payload.settings,
            ...(payload.reviewProposalId === undefined
              ? {}
              : { reviewProposalId: payload.reviewProposalId }),
            actorId: context.principalId,
          });
          const outcome = await commandGateway.complete({
            commandId: accepted.outcome.commandId,
            producedResources: result.appliedRevision
              ? [
                  {
                    resourceKind: 'project-settings',
                    resourceId: targetProjectId,
                    resourceRevision: String(result.appliedRevision),
                  },
                ]
              : [],
            completedAt: new Date().toISOString(),
          });
          return { outcome, result };
        } catch (error) {
          await rejectAcceptedCommand(commandGateway, accepted.outcome.commandId, error);
          throw error;
        }
      } catch (error) {
        throw toProductApiCommandError(error, 'apply-settings-command');
      }
    },
  );

  server.get<{
    Params: { clientRequestId: string };
    Headers: SecurityHeaders;
  }>('/api/v1/frontend-commands/by-client-request/:clientRequestId', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const outcome = await commandGateway.findByClientRequestId(
      context.principalId,
      request.params.clientRequestId,
    );
    if (!outcome) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'Command outcome not found.',
        module: 'frontend-command-gateway',
        operation: 'resolve-command-outcome',
      });
    }
    const membership = await authRepo.findMembership(
      context.principalId,
      'targetProjectId' in outcome.acceptedProjectContext
        ? outcome.acceptedProjectContext.targetProjectId
        : (() => {
            throw new ShotgunError({
              code: 'PROJECT_CONTEXT_REQUIRED',
              safeMessage: 'Settings outcome requires Project scope.',
              module: 'shotgun-app',
              operation: 'settings-outcome-project',
            });
          })(),
    );
    if (!membership) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'Command outcome not found.',
        module: 'frontend-command-gateway',
        operation: 'resolve-command-outcome',
      });
    }
    return { outcome };
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
