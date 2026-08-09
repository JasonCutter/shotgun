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
import type { ProjectTombstoneStorePort } from '../../../../modules/project-administration/src/index.js';
import { isDeletedProjectAuditReadPermitted } from '../../../../modules/project-administration/src/index.js';

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
 * Deleted-project audit reads (WP2-C / WP5 C) require a valid ProjectTombstone
 * + an active DeletedProjectAuditScope bound to the current principal + the
 * CURRENT `project:deleted-audit:read` capability (fail-closed).
 */
export function registerHistoryRoutes(
  server: FastifyInstance,
  coordinator: HistoryProductCoordinator,
  projectTombstoneStore: ProjectTombstoneStorePort,
  authRepository: AuthRepositoryPort,
  settingsRepository: SettingsRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
): void {
  const buildHistoryScope = async (
    headers: SecurityHeaders,
    requestedProjectId?: string,
  ): Promise<HistoryProductScopeV1> => {
    const current = await requirePrincipalBrowserSession(headers);
    const principalId = current.principalContext.principalId;
    const activeProjectId = current.session.activeProjectId;

    // Deleted-project audit read (WP2-C / WP5 C): the request names a project
    // that is NOT the active project. This is permitted ONLY when a valid
    // ProjectTombstone exists, an active DeletedProjectAuditScope is bound to
    // the current principal, and the CURRENT capability set includes
    // `project:deleted-audit:read` (past membership alone never grants it).
    // Every denial is the same non-disclosing PROJECT_ACCESS_DENIED.
    if (requestedProjectId !== undefined && requestedProjectId !== activeProjectId) {
      const tombstone = await projectTombstoneStore.getTombstone(requestedProjectId);
      if (!tombstone) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: 'History access denied.',
          module: 'frontend-history-api',
          operation: 'build-history-scope',
        });
      }
      const scopes = await projectTombstoneStore.listAuditScopes(requestedProjectId);
      const activeAuditScope = scopes.find(
        (scope) => scope.grantedPrincipalIds.includes(principalId) && !scope.revokedAt,
      );
      // Current capability set: derived from the principal's CURRENT active
      // project membership (which must hold project:deleted-audit:read).
      const currentCapabilities = activeProjectId
        ? ((await authRepository.findMembership(principalId, activeProjectId))?.scopes ?? [])
        : [];
      const permitted = isDeletedProjectAuditReadPermitted(activeAuditScope ?? null, {
        projectId: requestedProjectId,
        principalId,
        currentCapabilities,
      });
      if (!permitted) {
        throw new ShotgunError({
          code: 'PROJECT_ACCESS_DENIED',
          safeMessage: 'History access denied.',
          module: 'frontend-history-api',
          operation: 'build-history-scope',
        });
      }
      return {
        principalId,
        activeProjectId: activeProjectId ?? '',
        accessRevision: `deleted-audit:${requestedProjectId}:${activeAuditScope!.scopeId}`,
        policyContextRevision: `deleted-audit:${requestedProjectId}`,
        accessScope: [...currentCapabilities].sort(),
        sensitivityClearance: 'restricted',
        deletedProjectAudit: {
          projectId: requestedProjectId,
          auditScopeId: activeAuditScope!.scopeId,
        },
      };
    }

    if (!activeProjectId) {
      throw new ShotgunError({
        code: 'PROJECT_CONTEXT_REQUIRED',
        safeMessage: 'History requires an active Project.',
        module: 'frontend-history-api',
        operation: 'build-history-scope',
      });
    }
    const membership = await authRepository.findMembership(principalId, activeProjectId);
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
      principalId,
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
      const decoded = decodeListHistoryWorkspaceRequestV1(request.body, 'listHistoryWorkspace');
      const scope = await buildHistoryScope(request.headers, decoded.resourceProjectId);
      try {
        return await coordinator.listHistoryWorkspace(scope, decoded);
      } catch (error) {
        throw toHistoryError(error, 'list-history-workspace');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/history/entry',
    async (request) => {
      const decoded = decodeGetHistoryEntryRequestV1(request.body, 'getHistoryEntry');
      const scope = await buildHistoryScope(request.headers, decoded.resourceProjectId);
      try {
        return await coordinator.getHistoryEntry(scope, decoded);
      } catch (error) {
        throw toHistoryError(error, 'get-history-entry');
      }
    },
  );
}
