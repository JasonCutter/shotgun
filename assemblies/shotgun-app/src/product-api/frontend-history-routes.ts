import type { FastifyInstance } from 'fastify';

import type { SecurityHeaders } from '../server.js';
import { FrontendContractError, ShotgunError } from '../../../../packages/contracts/src/index.js';
import {
  decodeGetHistoryEntryRequestV1,
  decodeListHistoryWorkspaceRequestV1,
  type HistoryProductCoordinator,
  type HistoryProductScopeV1,
} from '../../../../modules/frontend-history/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';

type PrincipalSessionResolver = (
  headers: Record<string, string | string[] | undefined>,
) => Promise<{
  principalContext: { principalId: string };
  session: { sessionId: string; activeProjectId: string | null };
}>;

const toHistoryError = (error: unknown, operation: string): never => {
  if (error instanceof ShotgunError) throw error;
  if (error instanceof FrontendContractError) {
    throw new ShotgunError({
      code: error.code,
      safeMessage: error.message,
      module: 'frontend-history-api',
      operation,
    });
  }
  throw new ShotgunError({
    code: 'INTERNAL_UNCLASSIFIED',
    safeMessage: 'History request failed.',
    module: 'frontend-history-api',
    operation,
    cause: error,
  });
};

/**
 * FE-P5-S2 WP4 — History Workspace Product API routes (ADR-131 / IR r1 §5
 * WP4). Every read/refresh route is a strict decoder gate over the History
 * Product Coordinator; the server derives Principal, Resource Project, access
 * revision, policy context and capability scopes. No browser-supplied
 * authority reaches the federated History read model. Reversal creation is NOT
 * a History route: it stays on the change-set-review owning route (WP3).
 */
export function registerHistoryRoutes(
  server: FastifyInstance,
  coordinator: HistoryProductCoordinator,
  authRepository: AuthRepositoryPort,
  settingsRepository: SettingsRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
): void {
  const buildHistoryScope = async (headers: SecurityHeaders): Promise<HistoryProductScopeV1> => {
    const current = await requirePrincipalBrowserSession(headers);
    const activeProjectId = current.session.activeProjectId;
    if (!activeProjectId) {
      throw new ShotgunError({
        code: 'PROJECT_CONTEXT_REQUIRED',
        safeMessage: 'History requires an active Project.',
        module: 'frontend-history-api',
        operation: 'build-history-scope',
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
        module: 'frontend-history-api',
        operation: 'build-history-scope',
      });
    }
    const settings = await settingsRepository.getSettingsSnapshot(activeProjectId);
    return {
      principalId: current.principalContext.principalId,
      activeProjectId,
      accessRevision: `${activeProjectId}:${membership.scopes.slice().sort().join(',')}`,
      policyContextRevision: String(settings.policyContextRevision),
      accessScope: [...membership.scopes].sort(),
      sensitivityClearance: membership.sensitivityClearance,
    };
  };

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/history/workspace',
    async (request) => {
      const scope = await buildHistoryScope(request.headers);
      try {
        return await coordinator.listHistoryWorkspace(
          scope,
          decodeListHistoryWorkspaceRequestV1(request.body, 'listHistoryWorkspace'),
        );
      } catch (error) {
        throw toHistoryError(error, 'list-history-workspace');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/history/entry',
    async (request) => {
      const scope = await buildHistoryScope(request.headers);
      try {
        return await coordinator.getHistoryEntry(
          scope,
          decodeGetHistoryEntryRequestV1(request.body, 'getHistoryEntry'),
        );
      } catch (error) {
        throw toHistoryError(error, 'get-history-entry');
      }
    },
  );
}
