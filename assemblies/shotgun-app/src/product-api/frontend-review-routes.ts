import type { FastifyInstance } from 'fastify';

import type { SecurityHeaders } from '../server.js';
import {
  FrontendContractError,
  ShotgunError,
  decodeAddReviewCommentRequestV1,
  decodeCreateReversalDraftChangeSetRequestV1,
  decodeGetReviewApprovalRequestV1,
  decodeGetReviewContextRequestV1,
  decodeGetReviewItemDetailRequestV1,
  decodeListReviewQueueRequestV1,
  decodeRecordReviewDecisionsRequestV1,
  decodeResolveReviewCommandOutcomeRequestV1,
  decodeRevalidateReviewContextRequestV1,
  type ErrorCode,
} from '../../../../packages/contracts/src/index.js';
import type { FrontendReviewProductCoordinator } from '../../../../modules/frontend-review/src/product-api.js';
import { ReviewCommandError } from '../../../../modules/frontend-review/src/index.js';
import type { ReversalEligibilityPort } from '../../../../modules/change-set-review/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';

type PrincipalSessionResolver = (
  headers: Record<string, string | string[] | undefined>,
) => Promise<{
  principalContext: { principalId: string };
  session: { sessionId: string; activeProjectId: string | null };
}>;

const toReviewError = (error: unknown, operation: string): never => {
  if (error instanceof ReviewCommandError) {
    throw new ShotgunError({
      code: error.apiCode as ErrorCode,
      safeMessage: error.message,
      module: 'frontend-review-api',
      operation,
    });
  }
  if (error instanceof ShotgunError) throw error;
  if (error instanceof FrontendContractError) {
    throw new ShotgunError({
      code: error.code,
      safeMessage: error.message,
      module: 'frontend-review-api',
      operation,
    });
  }
  throw new ShotgunError({
    code: 'INTERNAL_UNCLASSIFIED',
    safeMessage: 'Review request failed.',
    module: 'frontend-review-api',
    operation,
    cause: error,
  });
};

export function registerFrontendReviewRoutes(
  server: FastifyInstance,
  coordinator: FrontendReviewProductCoordinator,
  reversalEligibilityPort: ReversalEligibilityPort,
  authRepository: AuthRepositoryPort,
  settingsRepository: SettingsRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
): void {
  const buildReviewScope = async (headers: SecurityHeaders) => {
    const current = await requirePrincipalBrowserSession(headers);
    const activeProjectId = current.session.activeProjectId;
    if (!activeProjectId) {
      throw new ShotgunError({
        code: 'PROJECT_CONTEXT_REQUIRED',
        safeMessage: 'Review requires an active Project.',
        module: 'frontend-review-api',
        operation: 'build-review-scope',
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
        module: 'frontend-review-api',
        operation: 'build-review-scope',
      });
    }
    const settings = await settingsRepository.getSettingsSnapshot(activeProjectId);
    return {
      principalId: current.principalContext.principalId,
      sessionId: current.session.sessionId,
      activeProjectId,
      accessRevision: `${activeProjectId}:${membership.scopes.slice().sort().join(',')}`,
      policyContextRevision: String(settings.policyContextRevision),
      sensitivityClearance: membership.sensitivityClearance,
      accessScope: [...membership.scopes].sort(),
    };
  };

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/queue',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeListReviewQueueRequestV1(request.body);
        return await coordinator.listReviewQueue(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'list-review-queue');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/contexts/read',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeGetReviewContextRequestV1(request.body);
        return await coordinator.getReviewContext(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'get-review-context');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/items/read',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeGetReviewItemDetailRequestV1(request.body);
        return await coordinator.getReviewItemDetail(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'get-review-item-detail');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/contexts/revalidate',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeRevalidateReviewContextRequestV1(request.body);
        return await coordinator.revalidateReviewContext(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'revalidate-review-context');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/decisions',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeRecordReviewDecisionsRequestV1(request.body);
        return await coordinator.recordReviewDecisions(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'record-review-decisions');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/comments',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeAddReviewCommentRequestV1(request.body);
        return await coordinator.addReviewComment(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'add-review-comment');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/approvals/read',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeGetReviewApprovalRequestV1(request.body);
        return await coordinator.getReviewApproval(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'get-review-approval');
      }
    },
  );

  server.get<{
    Params: { clientRequestId: string };
    Querystring: { idempotencyKey?: string; semanticDigest?: string };
    Headers: SecurityHeaders;
  }>(
    '/product-api/frontend/review/command-outcomes/by-client-request/:clientRequestId',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeResolveReviewCommandOutcomeRequestV1({
          schemaVersion: '1.0.0',
          clientRequestId: request.params.clientRequestId,
          idempotencyKey: request.query.idempotencyKey,
          semanticDigest: request.query.semanticDigest,
        });
        return await coordinator.resolveCommandOutcome(scope, decoded);
      } catch (error) {
        throw toReviewError(error, 'resolve-review-command-outcome');
      }
    },
  );

  // FE-P5-S2 WP3/WP5 — Reversal initiation (change-set-review owning route).
  // The browser only names the historical source revision; the server derives
  // the current capability (REVERSAL_CURRENT_CAPABILITY) and the principal, and
  // creates a CANDIDATE Reversal draft for the current Review flow.
  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/review/reversal-draft',
    async (request) => {
      const scope = await buildReviewScope(request.headers);
      try {
        const decoded = decodeCreateReversalDraftChangeSetRequestV1(
          request.body,
          'createReversalDraftChangeSet',
        );
        if (decoded.resourceProjectId !== scope.activeProjectId) {
          throw new ShotgunError({
            code: 'PROJECT_ACCESS_DENIED',
            safeMessage: 'Reversal requires the active Project.',
            module: 'frontend-review-api',
            operation: 'create-reversal-draft',
          });
        }
        const result = await reversalEligibilityPort.createReversalDraftChangeSet({
          resourceProjectId: decoded.resourceProjectId,
          sourceRevisionId: decoded.sourceRevisionId,
          reason: decoded.reason,
          createdBy: scope.principalId,
          createdAt: new Date().toISOString(),
        });
        return result;
      } catch (error) {
        throw toReviewError(error, 'create-reversal-draft');
      }
    },
  );
}
