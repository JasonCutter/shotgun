import type { FastifyInstance } from 'fastify';

import type { SecurityHeaders } from '../server.js';
import {
  FrontendContractError,
  FrontendKnowledgeDraftCommandError,
  ShotgunError,
  decodeAbandonKnowledgeDraftRequestV1,
  decodeGenerateKnowledgeDraftImpactRequestV1,
  decodeMaterializeDraftRequestV1,
  decodeReadKnowledgeDraftRequestV1,
  decodeResolveKnowledgeDraftCommandOutcomeRequestV1,
  decodeSaveKnowledgeDraftRequestV1,
  decodeStartSeedlessDraftRequestV1,
  decodeSubmitKnowledgeDraftForReviewRequestV1,
  decodeValidateKnowledgeDraftRequestV1,
  type ErrorCode,
} from '../../../../packages/contracts/src/index.js';
import type { FrontendKnowledgeDraftProductCoordinator } from '../../../../modules/frontend-knowledge-draft/src/product-api.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';

type PrincipalSessionResolver = (
  headers: Record<string, string | string[] | undefined>,
) => Promise<{
  principalContext: { principalId: string };
  session: { sessionId: string; activeProjectId: string | null };
}>;

const toDraftError = (error: unknown, operation: string): never => {
  if (error instanceof FrontendKnowledgeDraftCommandError) {
    throw new ShotgunError({
      code: error.apiCode as ErrorCode,
      safeMessage: error.message,
      module: 'frontend-knowledge-draft-api',
      operation,
    });
  }
  if (error instanceof ShotgunError) throw error;
  if (error instanceof FrontendContractError) {
    throw new ShotgunError({
      code: error.code,
      safeMessage: error.message,
      module: 'frontend-knowledge-draft-api',
      operation,
    });
  }
  throw new ShotgunError({
    code: 'INTERNAL_UNCLASSIFIED',
    safeMessage: 'Draft command failed.',
    module: 'frontend-knowledge-draft-api',
    operation,
    cause: error,
  });
};

export function registerFrontendKnowledgeDraftRoutes(
  server: FastifyInstance,
  coordinator: FrontendKnowledgeDraftProductCoordinator,
  authRepository: AuthRepositoryPort,
  settingsRepository: SettingsRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
): void {
  const buildDraftScope = async (headers: SecurityHeaders) => {
    const current = await requirePrincipalBrowserSession(headers);
    const activeProjectId = current.session.activeProjectId;
    if (!activeProjectId) {
      throw new ShotgunError({
        code: 'PROJECT_CONTEXT_REQUIRED',
        safeMessage: 'Draft authoring requires an active Project.',
        module: 'frontend-knowledge-draft-api',
        operation: 'build-draft-scope',
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
        module: 'frontend-knowledge-draft-api',
        operation: 'build-draft-scope',
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
    '/product-api/frontend/knowledge/drafts/materialize',
    async (request) => {
      const scope = await buildDraftScope(request.headers);
      try {
        const decoded = decodeMaterializeDraftRequestV1(request.body);
        return await coordinator.materializeDraft(scope, decoded);
      } catch (error) {
        throw toDraftError(error, 'materialize-draft');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/drafts/start-seedless',
    async (request) => {
      const scope = await buildDraftScope(request.headers);
      try {
        const decoded = decodeStartSeedlessDraftRequestV1(request.body);
        return await coordinator.startSeedlessDraft(scope, decoded);
      } catch (error) {
        throw toDraftError(error, 'start-seedless-draft');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/drafts/save',
    async (request) => {
      const scope = await buildDraftScope(request.headers);
      try {
        const decoded = decodeSaveKnowledgeDraftRequestV1(request.body);
        return await coordinator.saveDraft(scope, decoded);
      } catch (error) {
        throw toDraftError(error, 'save-draft');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/drafts/abandon',
    async (request) => {
      const scope = await buildDraftScope(request.headers);
      try {
        const decoded = decodeAbandonKnowledgeDraftRequestV1(request.body);
        return await coordinator.abandonDraft(scope, decoded);
      } catch (error) {
        throw toDraftError(error, 'abandon-draft');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/drafts/read',
    async (request) => {
      const scope = await buildDraftScope(request.headers);
      try {
        const decoded = decodeReadKnowledgeDraftRequestV1(request.body);
        return await coordinator.readDraft(scope, decoded);
      } catch (error) {
        throw toDraftError(error, 'read-draft');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/drafts/validate',
    async (request) => {
      const scope = await buildDraftScope(request.headers);
      try {
        const decoded = decodeValidateKnowledgeDraftRequestV1(request.body);
        return await coordinator.validateDraft(scope, decoded);
      } catch (error) {
        throw toDraftError(error, 'validate-draft');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/drafts/impact-preview',
    async (request) => {
      const scope = await buildDraftScope(request.headers);
      try {
        const decoded = decodeGenerateKnowledgeDraftImpactRequestV1(request.body);
        return await coordinator.generateImpactPreview(scope, decoded);
      } catch (error) {
        throw toDraftError(error, 'impact-preview');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/drafts/submit-review',
    async (request) => {
      const scope = await buildDraftScope(request.headers);
      try {
        const decoded = decodeSubmitKnowledgeDraftForReviewRequestV1(request.body);
        return await coordinator.submitDraftForReview(scope, decoded);
      } catch (error) {
        throw toDraftError(error, 'submit-review');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/knowledge/drafts/resolve-outcome',
    async (request) => {
      const scope = await buildDraftScope(request.headers);
      try {
        const decoded = decodeResolveKnowledgeDraftCommandOutcomeRequestV1(request.body);
        return await coordinator.resolveCommandOutcome(scope, decoded);
      } catch (error) {
        throw toDraftError(error, 'resolve-command-outcome');
      }
    },
  );
}
