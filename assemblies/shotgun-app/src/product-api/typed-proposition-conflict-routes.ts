import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type {
  FrontendCommandGatewayPort,
  AcceptFrontendCommandResult,
} from '../../../../modules/frontend-command-gateway/src/index.js';
import {
  buildPrincipalScopedCommandSemanticDigestInput,
  ShotgunError,
  TYPED_PROPOSITION_CONFLICT_RULE_COMMAND_TYPE,
  validateTypedPropositionConflictRuleCommandRequest,
  type FrontendCommandRequest,
  type TypedPropositionConflictRuleCommandPayloadV1,
} from '../../../../packages/contracts/src/index.js';
import type { SecurityHeaders } from '../server.js';
import {
  TypedPropositionConflictRuleService,
  type TypedPropositionConflictRuleRepositoryPort,
  type TypedPropositionConflictRuleTransactionHandleV1,
} from '../../../../modules/knowledge-model/src/typed-proposition-conflict.js';
import { rejectAcceptedCommand, toProductApiCommandError } from './frontend-command-route.js';

type SessionRequirement = (headers: Record<string, string | string[] | undefined>) => Promise<{
  context: { principalId: string; projectId: string };
}>;

const ownerOrAdmin = (membership: {
  readonly isOwner: boolean;
  readonly scopes: readonly string[];
}) =>
  membership.isOwner || membership.scopes.includes('owner') || membership.scopes.includes('admin');

const forbidden = (): never => {
  throw new ShotgunError({
    code: 'AUTHORIZATION_DENIED',
    safeMessage: 'Conflict rule management is restricted to Project owners and administrators.',
    module: 'frontend-discovery-conflict-rules',
    operation: 'authorize',
  });
};

const isOutcomeUnknown = (error: unknown): boolean =>
  error instanceof ShotgunError && error.code === 'OUTCOME_UNKNOWN';

const acceptRuleCommand = async (input: {
  readonly rawRequest: unknown;
  readonly principalId: string;
  readonly sessionProjectId: string;
  readonly settings: SettingsRepositoryPort;
  readonly gateway: FrontendCommandGatewayPort;
}): Promise<
  AcceptFrontendCommandResult & {
    readonly request: FrontendCommandRequest<TypedPropositionConflictRuleCommandPayloadV1>;
  }
> => {
  const request = validateTypedPropositionConflictRuleCommandRequest(input.rawRequest);
  if (
    request.projectContext.activeProjectId !== input.sessionProjectId ||
    request.projectContext.targetProjectId !== input.sessionProjectId
  ) {
    throw new ShotgunError({
      code: 'RESOURCE_PROJECT_MISMATCH',
      safeMessage: 'Conflict rule commands must target the active Project.',
      module: 'frontend-discovery-conflict-rules',
      operation: 'validate-project-context',
    });
  }
  const snapshot = await input.settings.getSettingsSnapshot(input.sessionProjectId);
  const observed = request.policyBinding.observedPolicyContextRevision;
  if (observed !== undefined && observed !== String(snapshot.policyContextRevision)) {
    throw new ShotgunError({
      code: 'POLICY_CONTEXT_CHANGED',
      safeMessage: 'Project policy changed. Reload the Project and try again.',
      module: 'frontend-discovery-conflict-rules',
      operation: 'validate-policy-context',
    });
  }
  const acceptedAt = new Date().toISOString();
  const commandSemanticDigest = createHash('sha256')
    .update(buildPrincipalScopedCommandSemanticDigestInput(request, input.principalId))
    .digest('hex');
  const accepted = await input.gateway.accept({
    commandId: randomUUID(),
    commandRevision: '1',
    principalId: input.principalId,
    request,
    commandSemanticDigest,
    acceptedPolicyContext: {
      policyContextId: `project-policy-context/${input.sessionProjectId}`,
      policyContextRevision: String(snapshot.policyContextRevision),
      acceptedAt,
    },
    correlationId: request.correlationContext?.correlationId ?? randomUUID(),
    traceId: randomUUID(),
    receivedAt: acceptedAt,
    acceptedAt,
  });
  return { ...accepted, request };
};

export const registerTypedPropositionConflictRuleRoutes = (
  server: FastifyInstance,
  repository: TypedPropositionConflictRuleRepositoryPort,
  settingsRepository: SettingsRepositoryPort,
  commandGateway: FrontendCommandGatewayPort,
  authRepository: AuthRepositoryPort,
  requireBrowserSession: SessionRequirement,
): void => {
  const service = new TypedPropositionConflictRuleService(repository);

  server.get<{ Headers: SecurityHeaders }>('/api/v1/discovery/conflict-rules', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const membership = await authRepository.findMembership(context.principalId, context.projectId);
    if (!membership || !ownerOrAdmin(membership)) return forbidden();
    return { rules: await service.listViews(context.projectId) };
  });

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/api/v1/discovery/conflict-rules/commands',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const membership = await authRepository.findMembership(
        context.principalId,
        context.projectId,
      );
      if (!membership || !ownerOrAdmin(membership)) return forbidden();
      let accepted: Awaited<ReturnType<typeof acceptRuleCommand>>;
      try {
        accepted = await acceptRuleCommand({
          rawRequest: request.body,
          principalId: context.principalId,
          sessionProjectId: context.projectId,
          settings: settingsRepository,
          gateway: commandGateway,
        });
      } catch (error) {
        throw toProductApiCommandError(error, 'accept-conflict-rule-command');
      }
      if (accepted.replayed) {
        if (accepted.outcome.outcomeState === 'REJECTED') {
          throw new ShotgunError({
            code: accepted.outcome.rejection?.code ?? 'CONFLICT',
            safeMessage:
              accepted.outcome.rejection?.message ?? 'The previous command was rejected.',
            module: 'frontend-discovery-conflict-rules',
            operation: 'replay-conflict-rule-command',
          });
        }
        const views = await service.listViews(context.projectId);
        const ruleId = accepted.outcome.producedResources.find(
          (resource) => resource.resourceKind === 'DISCOVERY_CONFLICT_RULE',
        )?.resourceId;
        return {
          rule: views.find((rule) => rule.ruleId === ruleId),
          outcome: accepted.outcome,
          replayed: true,
        };
      }
      try {
        const execute = async (handle: TypedPropositionConflictRuleTransactionHandleV1) => {
          const locked = await commandGateway.lockAcceptedForExecution(
            handle.rawTransaction,
            accepted.outcome.commandId,
          );
          if (locked.outcomeState === 'COMPLETED') return { outcome: locked };
          if (locked.outcomeState !== 'ACCEPTED') {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: 'The conflict rule command is not executable.',
              module: 'frontend-discovery-conflict-rules',
              operation: 'lock-conflict-rule-command',
            });
          }
          const rule = await service.execute(
            {
              projectId: context.projectId,
              actorId: context.principalId,
              payload: accepted.request.payload,
              now: new Date().toISOString(),
            },
            handle.repository,
          );
          const outcome = await commandGateway.completeInTransaction(handle.rawTransaction, {
            commandId: accepted.outcome.commandId,
            producedResources: [
              {
                resourceKind: 'DISCOVERY_CONFLICT_RULE',
                resourceId: rule.ruleId,
                resourceRevision: String(rule.ruleRevision),
              },
            ],
            completedAt: new Date().toISOString(),
          });
          return { rule, outcome };
        };
        const executed = repository.transaction
          ? await repository.transaction(execute)
          : await execute({
              repository,
              rawTransaction: undefined,
              afterCommit: () => undefined,
            });
        if (executed.rule === undefined) {
          const views = await service.listViews(context.projectId);
          const ruleId = executed.outcome.producedResources.find(
            (resource) => resource.resourceKind === 'DISCOVERY_CONFLICT_RULE',
          )?.resourceId;
          return {
            rule: views.find((rule) => rule.ruleId === ruleId),
            outcome: executed.outcome,
            replayed: false,
          };
        }
        const [view] = (await service.listViews(context.projectId)).filter(
          (candidate) => candidate.ruleId === executed.rule.ruleId,
        );
        return { rule: view, outcome: executed.outcome, replayed: false };
      } catch (error) {
        if (isOutcomeUnknown(error)) {
          try {
            await commandGateway.markOutcomeUnknown({
              commandId: accepted.outcome.commandId,
              message: error instanceof Error ? error.message : 'Command outcome is unresolved.',
              completedAt: new Date().toISOString(),
            });
          } catch {
            // Preserve the unresolved failure; the original clientRequestId
            // remains the recovery authority.
          }
          throw error;
        }
        try {
          await rejectAcceptedCommand(commandGateway, accepted.outcome.commandId, error);
        } catch {
          // Preserve the original command failure if ledger rejection fails.
        }
        throw toProductApiCommandError(error, 'execute-conflict-rule-command');
      }
    },
  );

  server.get<{ Params: { clientRequestId: string }; Headers: SecurityHeaders }>(
    '/api/v1/discovery/conflict-rules/commands/:clientRequestId',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const membership = await authRepository.findMembership(
        context.principalId,
        context.projectId,
      );
      if (!membership || !ownerOrAdmin(membership)) return forbidden();
      const outcome = await commandGateway.findByClientRequestId(
        context.principalId,
        request.params.clientRequestId,
      );
      if (!outcome) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'Conflict rule command outcome not found.',
          module: 'frontend-discovery-conflict-rules',
          operation: 'resolve-outcome',
        });
      }
      if (outcome.commandType !== TYPED_PROPOSITION_CONFLICT_RULE_COMMAND_TYPE) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'Conflict rule command outcome not found.',
          module: 'frontend-discovery-conflict-rules',
          operation: 'resolve-outcome',
        });
      }
      return { outcome };
    },
  );
};
