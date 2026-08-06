import type { FastifyInstance } from 'fastify';

import type { SecurityHeaders } from '../server.js';
import { FrontendContractError, ShotgunError } from '../../../../packages/contracts/src/index.js';
import {
  decodeGetActivityDetailRequestV1,
  decodeListActivityContinuationRequestV1,
  decodeListActivityQueueRequestV1,
  decodeRefreshActivityProjectionRequestV1,
  type ActivityProductCoordinator,
  type ActivityProductScopeV1,
} from '../../../../modules/frontend-activity/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
type PrincipalSessionResolver = (
  headers: Record<string, string | string[] | undefined>,
) => Promise<{
  principalContext: { principalId: string };
  session: { sessionId: string; activeProjectId: string | null };
}>;

const toActivityError = (error: unknown, operation: string): never => {
  if (error instanceof ShotgunError) throw error;
  if (error instanceof FrontendContractError) {
    throw new ShotgunError({
      code: error.code,
      safeMessage: error.message,
      module: 'frontend-activity-api',
      operation,
    });
  }
  throw new ShotgunError({
    code: 'INTERNAL_UNCLASSIFIED',
    safeMessage: 'Activity request failed.',
    module: 'frontend-activity-api',
    operation,
    cause: error,
  });
};

/**
 * FE-P5-S1 WP3 — Activity Product API routes (Contract Snapshot §7).
 *
 * Every read/refresh route is a strict decoder gate over the Activity Product
 * Coordinator; the server derives Principal, Resource Project, access revision,
 * policy context and capability scopes. No browser-supplied authority reaches
 * the Activity read model. Retry and Cancel are NOT Activity commands: they
 * remain owning-Domain routes (WP5).
 */
export function registerActivityRoutes(
  server: FastifyInstance,
  coordinator: ActivityProductCoordinator,
  authRepository: AuthRepositoryPort,
  settingsRepository: SettingsRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
): void {
  const buildActivityScope = async (headers: SecurityHeaders): Promise<ActivityProductScopeV1> => {
    const current = await requirePrincipalBrowserSession(headers);
    const activeProjectId = current.session.activeProjectId;
    if (!activeProjectId) {
      throw new ShotgunError({
        code: 'PROJECT_CONTEXT_REQUIRED',
        safeMessage: 'Activity requires an active Project.',
        module: 'frontend-activity-api',
        operation: 'build-activity-scope',
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
        module: 'frontend-activity-api',
        operation: 'build-activity-scope',
      });
    }
    const settings = await settingsRepository.getSettingsSnapshot(activeProjectId);
    return {
      principalId: current.principalContext.principalId,
      activeProjectId,
      accessRevision: `${activeProjectId}:${membership.scopes.slice().sort().join(',')}`,
      policyContextRevision: String(settings.policyContextRevision),
      accessScope: [...membership.scopes].sort(),
    };
  };

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/activity/queue',
    async (request) => {
      const scope = await buildActivityScope(request.headers);
      try {
        return await coordinator.listActivityQueue(
          scope,
          decodeListActivityQueueRequestV1(request.body),
        );
      } catch (error) {
        throw toActivityError(error, 'list-activity-queue');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/activity/detail',
    async (request) => {
      const scope = await buildActivityScope(request.headers);
      try {
        return await coordinator.getActivityDetail(
          scope,
          decodeGetActivityDetailRequestV1(request.body),
        );
      } catch (error) {
        throw toActivityError(error, 'get-activity-detail');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/activity/stages',
    async (request) => {
      const scope = await buildActivityScope(request.headers);
      try {
        return await coordinator.listActivityStages(
          scope,
          decodeListActivityContinuationRequestV1(request.body),
        );
      } catch (error) {
        throw toActivityError(error, 'list-activity-stages');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/activity/events',
    async (request) => {
      const scope = await buildActivityScope(request.headers);
      try {
        return await coordinator.listActivityEvents(
          scope,
          decodeListActivityContinuationRequestV1(request.body),
        );
      } catch (error) {
        throw toActivityError(error, 'list-activity-events');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/activity/refresh',
    async (request) => {
      const scope = await buildActivityScope(request.headers);
      try {
        return await coordinator.refreshActivityProjection(
          scope,
          decodeRefreshActivityProjectionRequestV1(request.body),
        );
      } catch (error) {
        throw toActivityError(error, 'refresh-activity-projection');
      }
    },
  );
}
