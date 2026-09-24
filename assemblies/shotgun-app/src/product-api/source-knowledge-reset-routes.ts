import type { FastifyInstance } from 'fastify';

import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import {
  KnowledgeResetContractError,
  type KnowledgeResetConfirmationV1,
  type KnowledgeResetCoordinatorPort,
} from '../../../../modules/source-knowledge-reset/src/index.js';
import { ShotgunError } from '../../../../packages/contracts/src/index.js';
import type { SecurityHeaders } from '../server.js';

type PrincipalSessionResolver = (
  headers: Record<string, string | string[] | undefined>,
) => Promise<{
  principalContext: { principalId: string };
  session: { sessionId: string; activeProjectId: string | null };
}>;

const routeId = (value: unknown, name: string, maximum = 256): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: `${name} is invalid.`,
      module: 'source-knowledge-reset',
      operation: 'decode-reset-route',
    });
  }
  return value;
};

const capabilityUnavailable = () =>
  new ShotgunError({
    code: 'CAPABILITY_DENIED',
    safeMessage: 'Project Source knowledge reset is not available in this runtime.',
    module: 'source-knowledge-reset',
    operation: 'require-reset-coordinator',
  });

const requireOwnerScope = async (
  headers: SecurityHeaders,
  projectId: string,
  authRepository: AuthRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
) => {
  const current = await requirePrincipalBrowserSession(headers);
  if (current.session.activeProjectId !== projectId) {
    throw new ShotgunError({
      code: 'PROJECT_ACCESS_DENIED',
      safeMessage: 'Select the target Project before managing its Source knowledge.',
      module: 'source-knowledge-reset',
      operation: 'authorize-reset-project',
    });
  }
  const membership = await authRepository.findMembership(
    current.principalContext.principalId,
    projectId,
  );
  if (!membership?.isOwner) {
    throw new ShotgunError({
      code: 'NOT_PROJECT_OWNER',
      safeMessage: 'Only the Project Owner can reset Project Source knowledge.',
      module: 'source-knowledge-reset',
      operation: 'authorize-reset-owner',
    });
  }
  return { actorPrincipalId: current.principalContext.principalId };
};

const mapResetError = (error: unknown): never => {
  if (error instanceof KnowledgeResetContractError) {
    const code = error.code === 'INVALID_CONFIRMATION' ? 'INVALID_REQUEST' : error.code;
    throw new ShotgunError({
      code,
      safeMessage: error.message,
      module: 'source-knowledge-reset',
      operation: 'coordinate-reset',
      cause: error,
    });
  }
  throw error;
};

const decodeConfirmation = (body: unknown): KnowledgeResetConfirmationV1 => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'Reset confirmation is invalid.',
      module: 'source-knowledge-reset',
      operation: 'decode-reset-confirmation',
    });
  }
  const value = body as Record<string, unknown>;
  if (
    typeof value.previewId !== 'string' ||
    typeof value.manifestDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.manifestDigest) ||
    !Number.isSafeInteger(value.expectedProjectRevision) ||
    !Number.isSafeInteger(value.expectedKnowledgeEpoch) ||
    typeof value.idempotencyKey !== 'string' ||
    value.idempotencyKey.length < 1 ||
    value.idempotencyKey.length > 200 ||
    value.confirmIrreversibleReset !== true
  ) {
    throw new ShotgunError({
      code: 'INVALID_REQUEST',
      safeMessage: 'Reset confirmation is invalid or missing explicit irreversible confirmation.',
      module: 'source-knowledge-reset',
      operation: 'decode-reset-confirmation',
    });
  }
  return {
    previewId: value.previewId,
    manifestDigest: value.manifestDigest as `sha256:${string}`,
    expectedProjectRevision: value.expectedProjectRevision as number,
    expectedKnowledgeEpoch: value.expectedKnowledgeEpoch as number,
    idempotencyKey: value.idempotencyKey,
    confirmIrreversibleReset: true,
  };
};

export const registerSourceKnowledgeResetRoutes = (
  server: FastifyInstance,
  coordinator: KnowledgeResetCoordinatorPort | undefined,
  authRepository: AuthRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
): void => {
  server.post<{
    Params: { projectId: string };
    Headers: SecurityHeaders;
  }>(
    '/product-api/frontend/projects/:projectId/source-knowledge-reset/preview',
    async (request) => {
      if (!coordinator) throw capabilityUnavailable();
      const projectId = routeId(request.params.projectId, 'projectId');
      const { actorPrincipalId } = await requireOwnerScope(
        request.headers,
        projectId,
        authRepository,
        requirePrincipalBrowserSession,
      );
      try {
        return { preview: await coordinator.preview({ projectId, actorPrincipalId }) };
      } catch (error) {
        return mapResetError(error);
      }
    },
  );

  server.post<{
    Params: { projectId: string };
    Body: unknown;
    Headers: SecurityHeaders;
  }>(
    '/product-api/frontend/projects/:projectId/source-knowledge-reset/confirm',
    async (request) => {
      if (!coordinator) throw capabilityUnavailable();
      const projectId = routeId(request.params.projectId, 'projectId');
      const { actorPrincipalId } = await requireOwnerScope(
        request.headers,
        projectId,
        authRepository,
        requirePrincipalBrowserSession,
      );
      const confirmation = decodeConfirmation(request.body);
      const requestIdempotencyHeader = request.headers['x-idempotency-key'];
      if (
        typeof requestIdempotencyHeader !== 'string' ||
        requestIdempotencyHeader !== confirmation.idempotencyKey
      ) {
        throw new ShotgunError({
          code: 'IDEMPOTENCY_KEY_REUSE_MISMATCH',
          safeMessage: 'The idempotency header does not match the confirmation.',
          module: 'source-knowledge-reset',
          operation: 'validate-reset-idempotency',
        });
      }
      try {
        return await coordinator.confirm({ projectId, actorPrincipalId, confirmation });
      } catch (error) {
        return mapResetError(error);
      }
    },
  );

  server.get<{
    Params: { projectId: string; requestId: string };
    Headers: SecurityHeaders;
  }>(
    '/product-api/frontend/projects/:projectId/source-knowledge-reset/:requestId',
    async (request) => {
      if (!coordinator) throw capabilityUnavailable();
      const projectId = routeId(request.params.projectId, 'projectId');
      await requireOwnerScope(
        request.headers,
        projectId,
        authRepository,
        requirePrincipalBrowserSession,
      );
      const resetRequest = await coordinator.getRequest({
        projectId,
        requestId: routeId(request.params.requestId, 'requestId'),
      });
      if (!resetRequest) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'The reset request was not found.',
          module: 'source-knowledge-reset',
          operation: 'read-reset-status',
        });
      }
      return { request: resetRequest };
    },
  );
};
