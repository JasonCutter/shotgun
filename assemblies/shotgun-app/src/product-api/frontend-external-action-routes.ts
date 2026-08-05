import type { FastifyInstance } from 'fastify';

import type { SecurityHeaders } from '../server.js';
import {
  FrontendContractError,
  ShotgunError,
  decodeApproveExternalActionRequestV1,
  decodeCancelExternalActionRequestV1,
  decodeExecuteExternalActionRequestV1,
  decodeGetActionManifestRequestV1,
  decodeGetActionResultRequestV1,
  decodeGetExecutionAttemptsRequestV1,
  decodeGetExecutionRequestV1,
  decodeGetExternalActionApprovalRequestV1,
  decodeGetExternalActionDetailRequestV1,
  decodeGetExternalActionRequestV1,
  decodeGetPreflightRequestV1,
  decodeGetRiskDecisionRequestV1,
  decodeGetVerificationRequestV1,
  decodeListExternalActionAuditRequestV1,
  decodeListExternalActionsRequestV1,
  decodePreflightExternalActionRequestV1,
  decodePrepareActionManifestRequestV1,
  decodePrepareCompensatingActionRequestV1,
  decodeResolveExternalActionOutcomeRequestV1,
  decodeRetryExecutionAttemptRequestV1,
  decodeRollbackExternalActionRequestV1,
  decodeValidateActionCandidateRequestV1,
  decodeVerifyExternalActionRequestV1,
  type ErrorCode,
} from '../../../../packages/contracts/src/index.js';
import type { FrontendExternalActionProductCoordinator } from '../../../../modules/frontend-external-action/src/index.js';
import { ExternalActionCommandError } from '../../../../modules/frontend-external-action/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';

type PrincipalSessionResolver = (
  headers: Record<string, string | string[] | undefined>,
) => Promise<{
  principalContext: { principalId: string };
  session: { sessionId: string; activeProjectId: string | null };
}>;

const toExternalActionError = (error: unknown, operation: string): never => {
  if (error instanceof ExternalActionCommandError) {
    throw new ShotgunError({
      code: error.apiCode as ErrorCode,
      safeMessage: error.message,
      module: 'frontend-external-action-api',
      operation,
    });
  }
  if (error instanceof ShotgunError) throw error;
  if (error instanceof FrontendContractError) {
    throw new ShotgunError({
      code: error.code,
      safeMessage: error.message,
      module: 'frontend-external-action-api',
      operation,
    });
  }
  throw new ShotgunError({
    code: 'INTERNAL_UNCLASSIFIED',
    safeMessage: 'External Action request failed.',
    module: 'frontend-external-action-api',
    operation,
    cause: error,
  });
};

/**
 * FE-P4-S2 WP4 protected product API. Every read/write route is a strict
 * decoder gate over the Product Coordinator; the server derives Principal,
 * Resource Project, access revision, policy context, capability scopes,
 * credential and budget. No browser-supplied authority reaches the domain.
 */
export function registerFrontendExternalActionRoutes(
  server: FastifyInstance,
  coordinator: FrontendExternalActionProductCoordinator,
  authRepository: AuthRepositoryPort,
  settingsRepository: SettingsRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
): void {
  const buildExternalActionScope = async (headers: SecurityHeaders) => {
    const current = await requirePrincipalBrowserSession(headers);
    const activeProjectId = current.session.activeProjectId;
    if (!activeProjectId) {
      throw new ShotgunError({
        code: 'PROJECT_CONTEXT_REQUIRED',
        safeMessage: 'External Action requires an active Project.',
        module: 'frontend-external-action-api',
        operation: 'build-external-action-scope',
      });
    }
    const membership = await authRepository.findMembership(
      current.principalContext.principalId,
      activeProjectId,
    );
    if (!membership) {
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: `You do not have access to project '${activeProjectId}'.`,
        module: 'frontend-external-action-api',
        operation: 'build-external-action-scope',
      });
    }
    const settings = await settingsRepository.getSettingsSnapshot(activeProjectId);
    // Server-derived Principal, Resource Project, access/policy/capability
    // authority. The actor is the authenticated principal — never browser input.
    return {
      principalId: current.principalContext.principalId,
      actor: {
        schemaVersion: '1.0.0' as const,
        principalId: current.principalContext.principalId,
        actorId: current.principalContext.principalId,
      },
      activeProjectId,
      accessRevision: `${activeProjectId}:${membership.scopes.slice().sort().join(',')}`,
      policyContextRevision: String(settings.policyContextRevision),
      accessScope: [...membership.scopes].sort(),
    };
  };

  // -------------------------------------------------------------------------
  // Protected reads
  // -------------------------------------------------------------------------

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/queue',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeListExternalActionsRequestV1(request.body);
        return await coordinator.listExternalActions(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'list-external-actions');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/actions/read',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeGetExternalActionRequestV1(request.body);
        return await coordinator.getExternalAction(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'get-external-action');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/actions/detail',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeGetExternalActionDetailRequestV1(request.body);
        return await coordinator.getExternalActionDetail(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'get-external-action-detail');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/manifests/read',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeGetActionManifestRequestV1(request.body);
        return await coordinator.getActionManifest(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'get-action-manifest');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/risk-decisions/read',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeGetRiskDecisionRequestV1(request.body);
        return await coordinator.getRiskDecision(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'get-risk-decision');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/preflights/read',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeGetPreflightRequestV1(request.body);
        return await coordinator.getPreflight(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'get-preflight');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/approvals/read',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeGetExternalActionApprovalRequestV1(request.body);
        return await coordinator.getExternalActionApproval(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'get-external-action-approval');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/executions/read',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeGetExecutionRequestV1(request.body);
        return await coordinator.getExecution(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'get-execution');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/executions/attempts',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeGetExecutionAttemptsRequestV1(request.body);
        return await coordinator.getExecutionAttempts(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'get-execution-attempts');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/verifications/read',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeGetVerificationRequestV1(request.body);
        return await coordinator.getVerification(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'get-verification');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/results/read',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeGetActionResultRequestV1(request.body);
        return await coordinator.getActionResult(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'get-action-result');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/audit',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeListExternalActionAuditRequestV1(request.body);
        return await coordinator.listExternalActionAudit(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'list-external-action-audit');
      }
    },
  );

  // -------------------------------------------------------------------------
  // Governed writes (Frontend Command Ledger)
  // -------------------------------------------------------------------------

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/validate',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeValidateActionCandidateRequestV1(request.body);
        return await coordinator.validateActionCandidate(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'validate-action-candidate');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/prepare',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodePrepareActionManifestRequestV1(request.body);
        return await coordinator.prepareActionManifest(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'prepare-action-manifest');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/approve',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeApproveExternalActionRequestV1(request.body);
        return await coordinator.approveExternalAction(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'approve-external-action');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/preflight',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodePreflightExternalActionRequestV1(request.body);
        return await coordinator.preflightExternalAction(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'preflight-external-action');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/execute',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeExecuteExternalActionRequestV1(request.body);
        return await coordinator.executeExternalAction(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'execute-external-action');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/retry',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeRetryExecutionAttemptRequestV1(request.body);
        return await coordinator.retryExecutionAttempt(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'retry-execution-attempt');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/verify',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeVerifyExternalActionRequestV1(request.body);
        return await coordinator.verifyExternalAction(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'verify-external-action');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/cancel',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeCancelExternalActionRequestV1(request.body);
        return await coordinator.cancelExternalAction(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'cancel-external-action');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/rollback',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeRollbackExternalActionRequestV1(request.body);
        return await coordinator.rollbackExternalAction(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'rollback-external-action');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/external-action/compensations/prepare',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodePrepareCompensatingActionRequestV1(request.body);
        return await coordinator.prepareCompensatingAction(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'prepare-compensating-action');
      }
    },
  );

  // -------------------------------------------------------------------------
  // Outcome resolution (resolve by the ORIGINAL command identity; never a
  // re-execute)
  // -------------------------------------------------------------------------

  server.get<{
    Params: { clientRequestId: string };
    Querystring: { idempotencyKey?: string; semanticDigest?: string };
    Headers: SecurityHeaders;
  }>(
    '/product-api/frontend/external-action/command-outcomes/by-client-request/:clientRequestId',
    async (request) => {
      const scope = await buildExternalActionScope(request.headers);
      try {
        const decoded = decodeResolveExternalActionOutcomeRequestV1({
          schemaVersion: '1.0.0',
          clientRequestId: request.params.clientRequestId,
          idempotencyKey: request.query.idempotencyKey,
          semanticDigest: request.query.semanticDigest,
        });
        return await coordinator.resolveExternalActionOutcome(scope, decoded);
      } catch (error) {
        throw toExternalActionError(error, 'resolve-external-action-outcome');
      }
    },
  );
}
