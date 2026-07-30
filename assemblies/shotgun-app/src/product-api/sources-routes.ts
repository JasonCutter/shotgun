import type { FastifyInstance } from 'fastify';

import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import {
  ShotgunError,
  decodeSourceLibraryQuery,
  type SourcesSensitivity,
} from '../../../../packages/contracts/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type { FrontendSourcesReadCoordinator } from '../../../../modules/frontend-sources-product/src/index.js';
import type { SecurityHeaders } from '../server.js';

type PrincipalSessionResolver = (
  headers: Record<string, string | string[] | undefined>,
) => Promise<{
  principalContext: { principalId: string };
  context?: { principalId: string; projectId: string };
  session: { sessionId: string; activeProjectId: string | null };
}>;

const requireParameter = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: `${name} is invalid.`,
      module: 'frontend-sources-product',
      operation: 'decode-route-parameter',
    });
  }
  return value;
};

const maskedNotFound = (): ShotgunError =>
  new ShotgunError({
    code: 'NOT_FOUND',
    safeMessage: 'The requested Source resource was not found.',
    module: 'frontend-sources-product',
    operation: 'read-source',
  });

export const registerSourcesRoutes = (
  server: FastifyInstance,
  coordinator: FrontendSourcesReadCoordinator,
  authRepository: AuthRepositoryPort,
  settingsRepository: SettingsRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
): void => {
  const buildScope = async (headers: SecurityHeaders) => {
    const current = await requirePrincipalBrowserSession(headers);
    const activeProjectId = current.session.activeProjectId;
    if (!activeProjectId || !current.context) {
      throw new ShotgunError({
        code: 'PROJECT_CONTEXT_REQUIRED',
        safeMessage: 'Sources requires an active Project.',
        module: 'frontend-sources-product',
        operation: 'build-sources-scope',
      });
    }
    const membership = await authRepository.findMembership(
      current.principalContext.principalId,
      activeProjectId,
    );
    if (!membership) throw maskedNotFound();
    const settings = await settingsRepository.getSettingsSnapshot(activeProjectId);
    return {
      principalId: current.principalContext.principalId,
      sessionId: current.session.sessionId,
      activeProjectId,
      accessScopes: membership.scopes,
      sensitivityClearance: membership.sensitivityClearance as SourcesSensitivity,
      accessRevision: `${membership.projectId}:${membership.scopes.slice().sort().join(',')}`,
      policyContextRevision: String(settings.policyContextRevision),
    };
  };

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/sources/query',
    async (request) => {
      const scope = await buildScope(request.headers);
      return {
        page: await coordinator.list(scope, decodeSourceLibraryQuery(request.body)),
      };
    },
  );

  server.get<{
    Params: { sourceId: string };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/sources/:sourceId', async (request) => {
    const scope = await buildScope(request.headers);
    const source = await coordinator.detail(
      scope,
      requireParameter(request.params.sourceId, 'sourceId'),
    );
    if (!source) throw maskedNotFound();
    return { source };
  });

  server.get<{
    Params: { sourceId: string };
    Querystring: { selectedSourceVersionId?: string; cursor?: string };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/sources/:sourceId/versions', async (request) => {
    const scope = await buildScope(request.headers);
    if (request.query.cursor !== undefined) {
      requireParameter(request.query.cursor, 'cursor');
    }
    const history = await coordinator.history(
      scope,
      requireParameter(request.params.sourceId, 'sourceId'),
      requireParameter(request.query.selectedSourceVersionId, 'selectedSourceVersionId'),
    );
    if (!history) throw maskedNotFound();
    return { history };
  });

  server.get<{
    Params: { sourceId: string; sourceVersionId: string };
    Querystring: { mode?: string };
    Headers: SecurityHeaders;
  }>(
    '/product-api/frontend/sources/:sourceId/versions/:sourceVersionId/preview',
    async (request) => {
      const scope = await buildScope(request.headers);
      if (request.query.mode !== 'ORIGINAL' && request.query.mode !== 'TRANSFORMED') {
        throw new ShotgunError({
          code: 'INVALID_REQUEST',
          safeMessage: 'Preview mode is invalid.',
          module: 'frontend-sources-product',
          operation: 'read-preview',
        });
      }
      const preview = await coordinator.preview(
        scope,
        requireParameter(request.params.sourceId, 'sourceId'),
        requireParameter(request.params.sourceVersionId, 'sourceVersionId'),
        request.query.mode,
      );
      if (!preview) throw maskedNotFound();
      return { preview };
    },
  );

  server.get<{
    Params: { sourceId: string; sourceVersionId: string };
    Querystring: { cursor?: string };
    Headers: SecurityHeaders;
  }>(
    '/product-api/frontend/sources/:sourceId/versions/:sourceVersionId/evidence',
    async (request) => {
      const scope = await buildScope(request.headers);
      if (request.query.cursor !== undefined) {
        requireParameter(request.query.cursor, 'cursor');
      }
      const evidence = await coordinator.evidenceList(
        scope,
        requireParameter(request.params.sourceId, 'sourceId'),
        requireParameter(request.params.sourceVersionId, 'sourceVersionId'),
      );
      if (!evidence) throw maskedNotFound();
      return { evidence };
    },
  );
};
