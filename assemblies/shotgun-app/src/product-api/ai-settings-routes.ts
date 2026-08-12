import type { FastifyInstance } from 'fastify';
import type { SecurityHeaders } from '../server.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import type { AISettingsBackendPort } from '../../../../modules/ai-settings-backend/src/index.js';
import { AISettingsBackendError } from '../../../../modules/ai-settings-backend/src/index.js';
import { AIConfigurationError } from '../../../../modules/ai-configuration/src/index.js';
import { CredentialVaultError } from '../../../../modules/credential-vault/src/index.js';
import { ShotgunError } from '../../../../packages/contracts/src/index.js';

type BrowserSession = (headers: Record<string, string | string[] | undefined>) => Promise<{
  context: { principalId: string; projectId: string };
}>;

type ProjectBody = { readonly targetProjectId?: unknown; readonly projectId?: unknown };

const objectBody = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'AI settings request body must be an object.',
      module: 'ai-settings-api',
      operation: 'decode-request',
    });
  }
  return body as Record<string, unknown>;
};

const requiredString = (body: Record<string, unknown>, name: string): string => {
  const value = body[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `${name} is required.`,
      module: 'ai-settings-api',
      operation: 'decode-request',
    });
  }
  return value;
};

const requiredInteger = (body: Record<string, unknown>, name: string): number => {
  const value = body[name];
  if (!Number.isSafeInteger(value)) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `${name} must be an integer.`,
      module: 'ai-settings-api',
      operation: 'decode-request',
    });
  }
  return value as number;
};

const projectFrom = (body: ProjectBody, fallback: string): string => {
  const candidate = body.targetProjectId ?? body.projectId ?? fallback;
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: 'Project ID is required.',
      module: 'ai-settings-api',
      operation: 'decode-project',
    });
  }
  return candidate;
};

const mapError = (error: unknown, operation: string): ShotgunError => {
  if (error instanceof ShotgunError) return error;
  if (error instanceof AISettingsBackendError) {
    const code =
      error.code === 'CREDENTIAL_NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'CREDENTIAL_REQUIRED'
          ? 'CONFIGURATION_REQUIRED'
          : 'VALIDATION_ERROR';
    return new ShotgunError({
      code,
      safeMessage: error.message,
      module: 'ai-settings-api',
      operation,
      cause: error,
    });
  }
  if (error instanceof AIConfigurationError) {
    const code =
      error.code === 'CONFLICT'
        ? 'CONFLICT'
        : error.code === 'CREDENTIAL_NOT_FOUND' || error.code === 'CREDENTIAL_UNAVAILABLE'
          ? 'CONFIGURATION_REQUIRED'
          : error.code === 'CREDENTIAL_OWNERSHIP_DENIED'
            ? 'PROJECT_ACCESS_DENIED'
            : 'VALIDATION_ERROR';
    return new ShotgunError({
      code,
      safeMessage: error.message,
      module: 'ai-settings-api',
      operation,
      cause: error,
    });
  }
  if (error instanceof CredentialVaultError) {
    const code =
      error.code === 'CONFIGURATION_REQUIRED' || error.code === 'AI_CAPABILITY_UNAVAILABLE'
        ? error.code
        : error.code === 'NOT_FOUND'
          ? 'NOT_FOUND'
          : error.code === 'CONFLICT'
            ? 'CONFLICT'
            : error.code === 'OWNERSHIP_DENIED'
              ? 'PROJECT_ACCESS_DENIED'
              : 'VALIDATION_ERROR';
    return new ShotgunError({
      code,
      safeMessage: error.message,
      module: 'ai-settings-api',
      operation,
      cause: error,
    });
  }
  return new ShotgunError({
    code: 'INTERNAL_UNCLASSIFIED',
    safeMessage: 'AI settings request failed.',
    module: 'ai-settings-api',
    operation,
    cause: error,
  });
};

export function registerAISettingsRoutes(
  server: FastifyInstance,
  backend: AISettingsBackendPort,
  authRepo: AuthRepositoryPort,
  requireBrowserSession: BrowserSession,
): void {
  const access = async (headers: SecurityHeaders, projectId: string, manage: boolean) => {
    const { context } = await requireBrowserSession(headers);
    const membership = await authRepo.findMembership(context.principalId, projectId);
    if (!membership) {
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: `You do not have access to project '${projectId}'.`,
        module: 'ai-settings-api',
        operation: 'authorize-project',
      });
    }
    if (
      manage &&
      !membership.isOwner &&
      !membership.scopes.includes('owner') &&
      !membership.scopes.includes('admin')
    ) {
      throw new ShotgunError({
        code: 'PROJECT_ACCESS_DENIED',
        safeMessage: 'Project Owner or administrator permission is required.',
        module: 'ai-settings-api',
        operation: 'authorize-project',
      });
    }
    return context;
  };

  server.get<{ Querystring: { targetProjectId?: string }; Headers: SecurityHeaders }>(
    '/api/v1/settings/ai',
    async (request) => {
      const { context } = await requireBrowserSession(request.headers);
      const projectId = request.query.targetProjectId ?? context.projectId;
      await access(request.headers, projectId, false);
      try {
        return { settings: await backend.getSettings(projectId) };
      } catch (error) {
        throw mapError(error, 'get-ai-settings');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/api/v1/settings/ai/credentials',
    async (request) => {
      const body = objectBody(request.body);
      const { context } = await requireBrowserSession(request.headers);
      const projectId = projectFrom(body, context.projectId);
      await access(request.headers, projectId, true);
      try {
        return {
          credential: await backend.createCredential({
            projectId,
            providerId: requiredString(body, 'providerId'),
            secret: requiredString(body, 'secret'),
          }),
        };
      } catch (error) {
        throw mapError(error, 'create-ai-credential');
      }
    },
  );

  server.post<{ Params: { credentialId: string }; Body: unknown; Headers: SecurityHeaders }>(
    '/api/v1/settings/ai/credentials/:credentialId/replace',
    async (request) => {
      const body = objectBody(request.body);
      const { context } = await requireBrowserSession(request.headers);
      const projectId = projectFrom(body, context.projectId);
      await access(request.headers, projectId, true);
      try {
        return {
          credential: await backend.replaceCredential({
            projectId,
            providerId: requiredString(body, 'providerId'),
            credentialId: request.params.credentialId,
            expectedRevision: requiredInteger(body, 'expectedRevision'),
            secret: requiredString(body, 'secret'),
          }),
        };
      } catch (error) {
        throw mapError(error, 'replace-ai-credential');
      }
    },
  );

  for (const action of ['revoke', 'remove'] as const) {
    server.post<{ Params: { credentialId: string }; Body: unknown; Headers: SecurityHeaders }>(
      `/api/v1/settings/ai/credentials/:credentialId/${action}`,
      async (request) => {
        const body = objectBody(request.body);
        const { context } = await requireBrowserSession(request.headers);
        const projectId = projectFrom(body, context.projectId);
        await access(request.headers, projectId, true);
        try {
          const input = {
            projectId,
            providerId: requiredString(body, 'providerId'),
            credentialId: request.params.credentialId,
            credentialRevision: requiredInteger(body, 'credentialRevision'),
          };
          const credential =
            action === 'revoke'
              ? await backend.revokeCredential(input)
              : await backend.removeCredential(input);
          return { credential };
        } catch (error) {
          throw mapError(error, `${action}-ai-credential`);
        }
      },
    );
  }

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/api/v1/settings/ai/configuration',
    async (request) => {
      const body = objectBody(request.body);
      const { context } = await requireBrowserSession(request.headers);
      const projectId = projectFrom(body, context.projectId);
      await access(request.headers, projectId, true);
      try {
        return {
          configuration: await backend.saveConfiguration({
            projectId,
            expectedRevision: requiredInteger(body, 'expectedRevision'),
            activeProviderId: requiredString(body, 'providerId'),
            activeModelId: requiredString(body, 'modelId'),
            credentialId: requiredString(body, 'credentialId'),
            credentialRevision: requiredInteger(body, 'credentialRevision'),
            updatedBy: context.principalId,
          }),
        };
      } catch (error) {
        throw mapError(error, 'save-ai-configuration');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/api/v1/settings/ai/test-connection',
    async (request) => {
      const body = objectBody(request.body);
      const { context } = await requireBrowserSession(request.headers);
      const projectId = projectFrom(body, context.projectId);
      await access(request.headers, projectId, true);
      try {
        return {
          result: await backend.testConnection({
            projectId,
            providerId: requiredString(body, 'providerId'),
            modelId: requiredString(body, 'modelId'),
            ...(typeof body.credentialId === 'string' ? { credentialId: body.credentialId } : {}),
            ...(Number.isSafeInteger(body.credentialRevision)
              ? { credentialRevision: body.credentialRevision as number }
              : {}),
            ...(typeof body.draftSecret === 'string' ? { draftSecret: body.draftSecret } : {}),
          }),
        };
      } catch (error) {
        throw mapError(error, 'test-ai-connection');
      }
    },
  );
}
