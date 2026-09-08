import type { FastifyInstance } from 'fastify';
import type { SecurityHeaders } from '../server.js';
import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import type { AISettingsBackendPort } from '../../../../modules/ai-settings-backend/src/index.js';
import { AISettingsBackendError } from '../../../../modules/ai-settings-backend/src/index.js';
import { AIConfigurationError } from '../../../../modules/ai-configuration/src/index.js';
import { CredentialVaultError } from '../../../../modules/credential-vault/src/index.js';
import {
  ProviderExternalTransferPolicyError,
  type ProviderExternalTransferApprovalPort,
} from '../../../../modules/provider-privacy-policy/src/index.js';
import {
  SEMANTIC_REPRESENTATION_VERSION_V2,
  ShotgunError,
  semanticGenerationMatchesSourceWatermark,
} from '../../../../packages/contracts/src/index.js';
import type { SemanticEmbeddingProfilePort } from '../../../../packages/contracts/src/index.js';
import type {
  SemanticActiveGenerationReaderPort,
  SemanticCorpusSourceSnapshotReaderPort,
  SemanticEmbeddingRegistryPort,
  SemanticEmbeddingResolverPort,
  SemanticProjectionRefreshPort,
} from '../../../../packages/contracts/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';

type BrowserSession = (headers: Record<string, string | string[] | undefined>) => Promise<{
  context: {
    principalId: string;
    projectId: string;
    actor: { readonly type: 'user' | 'service' | 'system'; readonly id: string };
    security: {
      readonly accessScope: readonly string[];
      readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
      readonly dataClassification: string;
    };
  };
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

const requireProjectOwner = async (
  headers: SecurityHeaders,
  projectId: string,
  authRepo: AuthRepositoryPort,
  requireBrowserSession: BrowserSession,
): Promise<{ principalId: string; projectId: string }> => {
  const { context } = await requireBrowserSession(headers);
  const membership = await authRepo.findMembership(context.principalId, projectId);
  if (!membership || !membership.isOwner) {
    throw new ShotgunError({
      code: 'PROJECT_ACCESS_DENIED',
      safeMessage: 'Project Owner permission is required.',
      module: 'ai-settings-api',
      operation: 'authorize-project-owner',
    });
  }
  return context;
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

const requiredBoolean = (body: Record<string, unknown>, name: string): boolean => {
  const value = body[name];
  if (typeof value !== 'boolean') {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `${name} must be a boolean.`,
      module: 'ai-settings-api',
      operation: 'decode-request',
    });
  }
  return value;
};

const assertAllowedFields = (
  body: Record<string, unknown>,
  allowed: readonly string[],
  operation: string,
): void => {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(body).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new ShotgunError({
      code: 'VALIDATION_ERROR',
      safeMessage: `Unknown request field '${unknown[0]}'.`,
      module: 'ai-settings-api',
      operation,
    });
  }
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
  if (error instanceof ProviderExternalTransferPolicyError) {
    const code =
      error.code === 'PROJECT_OWNER_REQUIRED'
        ? 'PROJECT_ACCESS_DENIED'
        : error.code === 'REVISION_CONFLICT' || error.code === 'PROPOSAL_STALE'
          ? 'CONFLICT'
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
  providerApprovals?: ProviderExternalTransferApprovalPort,
  semanticEmbeddingProfile?: SemanticEmbeddingProfilePort,
  semanticEmbeddingRegistry?: SemanticEmbeddingRegistryPort,
  semanticActiveGenerationReader?: SemanticActiveGenerationReaderPort,
  semanticProjectionRefresh?: SemanticProjectionRefreshPort,
  settingsRepository?: SettingsRepositoryPort,
  semanticCorpusSourceSnapshotReader?: Pick<
    SemanticCorpusSourceSnapshotReaderPort,
    'readWatermark' | 'readSnapshot'
  >,
  semanticEmbeddingResolver?: SemanticEmbeddingResolverPort,
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

  if (semanticEmbeddingProfile) {
    server.get<{ Headers: SecurityHeaders }>(
      '/api/v1/settings/ai/semantic-embedding-profile',
      async (request) => {
        const { context } = await requireBrowserSession(request.headers);
        await access(request.headers, context.projectId, false);
        try {
          return {
            profile: (await semanticEmbeddingProfile.getCurrent(context.projectId)) ?? null,
          };
        } catch (error) {
          throw mapError(error, 'get-semantic-embedding-profile');
        }
      },
    );

    server.post<{ Body: unknown; Headers: SecurityHeaders }>(
      '/api/v1/settings/ai/semantic-embedding-profile',
      async (request) => {
        const body = objectBody(request.body);
        assertAllowedFields(
          body,
          [
            'expectedRevision',
            'providerId',
            'embeddingModelId',
            'credentialId',
            'credentialRevision',
            'dimension',
          ],
          'decode-semantic-embedding-profile-request',
        );
        const { context } = await requireBrowserSession(request.headers);
        await access(request.headers, context.projectId, true);
        try {
          const dimension = body.dimension;
          if (dimension !== undefined && !Number.isSafeInteger(dimension)) {
            throw new ShotgunError({
              code: 'VALIDATION_ERROR',
              safeMessage: 'dimension must be an integer.',
              module: 'ai-settings-api',
              operation: 'decode-semantic-embedding-profile-request',
            });
          }
          return {
            profile: await semanticEmbeddingProfile.createProfile({
              projectId: context.projectId,
              expectedRevision: requiredInteger(body, 'expectedRevision'),
              providerId: requiredString(body, 'providerId'),
              embeddingModelId: requiredString(body, 'embeddingModelId'),
              credentialId: requiredString(body, 'credentialId'),
              credentialRevision: requiredInteger(body, 'credentialRevision'),
              representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
              ...(dimension === undefined ? {} : { dimension: dimension as number }),
              updatedBy: context.principalId,
              status: 'PREPARED',
            }),
          };
        } catch (error) {
          throw mapError(error, 'create-semantic-embedding-profile');
        }
      },
    );

    if (semanticEmbeddingRegistry && semanticActiveGenerationReader) {
      const generationMatchesSource = async (
        projectId: string,
        generation: Awaited<ReturnType<SemanticActiveGenerationReaderPort['getActiveGeneration']>>,
      ): Promise<boolean> => {
        if (!generation || !semanticCorpusSourceSnapshotReader) return false;
        const watermark = await semanticCorpusSourceSnapshotReader.readWatermark(projectId);
        return semanticGenerationMatchesSourceWatermark(generation, watermark, projectId);
      };

      const sourceSensitivity = async (
        projectId: string,
      ): Promise<'public' | 'internal' | 'private' | 'restricted'> => {
        if (!semanticCorpusSourceSnapshotReader) {
          return 'restricted';
        }
        const snapshot = await semanticCorpusSourceSnapshotReader.readSnapshot(projectId);
        const rank: Record<'public' | 'internal' | 'private' | 'restricted', number> = {
          public: 0,
          internal: 1,
          private: 2,
          restricted: 3,
        };
        return snapshot.resources.reduce<'public' | 'internal' | 'private' | 'restricted'>(
          (highest, resource) =>
            rank[resource.provenance.sensitivity] > rank[highest]
              ? resource.provenance.sensitivity
              : highest,
          'public',
        );
      };

      const generationMatchesCurrentExecution = async (
        projectId: string,
        profile: Awaited<ReturnType<SemanticEmbeddingProfilePort['getCurrent']>>,
        generation: Awaited<ReturnType<SemanticActiveGenerationReaderPort['getActiveGeneration']>>,
      ): Promise<boolean> => {
        if (!profile || !generation || !semanticEmbeddingResolver) return false;
        try {
          const resolved = await semanticEmbeddingResolver.resolveExecution({
            projectId,
            sensitivity: await sourceSensitivity(projectId),
            profileRevision: profile.profileRevision,
            credentialId: generation.credentialId,
            credentialRevision: generation.credentialRevision,
          });
          return (
            resolved.profile.profileId === profile.profileId &&
            resolved.profile.profileRevision === profile.profileRevision &&
            resolved.profile.providerId === generation.providerId &&
            resolved.profile.embeddingModelId === generation.embeddingModelId &&
            resolved.profile.dimension === generation.dimension &&
            resolved.pin.providerId === generation.providerId &&
            resolved.pin.embeddingModelId === generation.embeddingModelId &&
            resolved.pin.embeddingProfileId === generation.embeddingProfileId &&
            resolved.pin.embeddingProfileRevision === generation.embeddingProfileRevision &&
            resolved.pin.credentialId === generation.credentialId &&
            resolved.pin.credentialRevision === generation.credentialRevision &&
            resolved.pin.providerRegistryRevision === generation.providerRegistryRevision &&
            resolved.pin.capabilityCatalogRevision === generation.capabilityCatalogRevision &&
            resolved.pin.providerPolicyFingerprint === generation.providerPolicyFingerprint &&
            resolved.pin.representationVersion === generation.representationVersion &&
            resolved.pin.dimension === generation.dimension
          );
        } catch {
          return false;
        }
      };

      const orderedEmbeddingModels = () =>
        [...semanticEmbeddingRegistry.listModels()].sort((left, right) => {
          const rank = (model: { providerId: string; modelId: string }): string =>
            model.providerId === 'openai' && model.modelId === 'text-embedding-3-small'
              ? '0'
              : `1:${model.providerId}:${model.modelId}`;
          const leftRank = rank(left);
          const rightRank = rank(right);
          return leftRank < rightRank ? -1 : leftRank > rightRank ? 1 : 0;
        });

      const selectEmbeddingBinding = (
        aiSettings: Awaited<ReturnType<AISettingsBackendPort['getSettings']>>,
      ) => {
        for (const model of orderedEmbeddingModels()) {
          const credentials = aiSettings.credentialStatuses.filter(
            (credential) =>
              credential.providerId === model.providerId && credential.lifecycleState === 'active',
          );
          if (credentials.length > 1) {
            throw new ShotgunError({
              code: 'CONFIGURATION_REQUIRED',
              safeMessage: `Choose one active ${model.providerId} embedding credential before enabling semantic comparison.`,
              module: 'ai-settings-api',
              operation: 'prepare-semantic-comparison-credential',
            });
          }
          const credential = credentials[0];
          if (credential) return { model, credential };
        }
        return undefined;
      };

      const projectStatus = async (projectId: string) => {
        const [profile, generation, settings, aiSettings] = await Promise.all([
          semanticEmbeddingProfile.getCurrent(projectId),
          semanticActiveGenerationReader.getActiveGeneration(projectId),
          settingsRepository?.getSettingsSnapshot(projectId),
          backend.getSettings(projectId),
        ]);
        const configuredRollout = settingsRepository?.getProjectSettingValue
          ? await settingsRepository.getProjectSettingValue(projectId, 'comparison.stage5.rollout')
          : undefined;
        const rollout =
          configuredRollout === 'V2_SHADOW' || configuredRollout === 'V2_ACTIVE'
            ? configuredRollout
            : 'V1_ONLY';
        const generationMatchesProfile =
          Boolean(
            profile &&
            aiSettings.credentialStatuses.some(
              (credential) =>
                credential.credentialId === profile.credentialId &&
                credential.providerId === profile.providerId &&
                credential.credentialRevision === profile.credentialRevision &&
                credential.lifecycleState === 'active',
            ) &&
            semanticEmbeddingRegistry.getModel(profile.providerId, profile.embeddingModelId) &&
            generation &&
            generation.buildStatus === 'READY' &&
            generation.embeddingProfileId === profile.profileId &&
            generation.embeddingProfileRevision === profile.profileRevision,
          ) &&
          (await generationMatchesSource(projectId, generation)) &&
          (await generationMatchesCurrentExecution(projectId, profile, generation));
        const profileBindingMissing = Boolean(
          profile &&
          (!aiSettings.credentialStatuses.some(
            (credential) =>
              credential.credentialId === profile.credentialId &&
              credential.providerId === profile.providerId &&
              credential.credentialRevision === profile.credentialRevision &&
              credential.lifecycleState === 'active',
          ) ||
            !semanticEmbeddingRegistry.getModel(profile.providerId, profile.embeddingModelId)),
        );
        const status = !profile
          ? 'NOT_CONFIGURED'
          : profileBindingMissing
            ? 'NEEDS_ATTENTION'
            : generationMatchesProfile
              ? 'READY'
              : generation?.buildStatus === 'READY'
                ? 'NEEDS_ATTENTION'
                : profile.status === 'BUILDING'
                  ? 'PREPARING'
                  : profile.status === 'FAILED' || profile.status === 'RETIRED'
                    ? 'NEEDS_ATTENTION'
                    : 'PREPARING';
        return {
          projectId,
          status,
          rollout,
          settingsRevision: settings?.settingsRevision ?? 0,
          ...(profile
            ? {
                profile: {
                  profileId: profile.profileId,
                  profileRevision: profile.profileRevision,
                  providerId: profile.providerId,
                  embeddingModelId: profile.embeddingModelId,
                  credentialRevision: profile.credentialRevision,
                  representationVersion: profile.representationVersion,
                  dimension: profile.dimension,
                  status: profile.status,
                },
              }
            : {}),
          ...(generation
            ? {
                generation: {
                  generationId: generation.generationId,
                  embeddingProfileId: generation.embeddingProfileId,
                  embeddingProfileRevision: generation.embeddingProfileRevision,
                  providerId: generation.providerId,
                  embeddingModelId: generation.embeddingModelId,
                  representationVersion: generation.representationVersion,
                  dimension: generation.dimension,
                  buildStatus: generation.buildStatus,
                  createdAt: generation.createdAt,
                },
              }
            : {}),
        } as const;
      };

      server.get<{ Querystring: { targetProjectId?: string }; Headers: SecurityHeaders }>(
        '/api/v1/settings/ai/semantic-comparison-status',
        async (request) => {
          const { context } = await requireBrowserSession(request.headers);
          const projectId = request.query.targetProjectId ?? context.projectId;
          await access(request.headers, projectId, false);
          try {
            return { status: await projectStatus(projectId) };
          } catch (error) {
            throw mapError(error, 'get-semantic-comparison-status');
          }
        },
      );

      if (semanticProjectionRefresh) {
        server.post<{ Body: unknown; Headers: SecurityHeaders }>(
          '/api/v1/settings/ai/semantic-comparison/prepare',
          async (request) => {
            const body = objectBody(request.body ?? {});
            assertAllowedFields(body, ['targetProjectId'], 'decode-semantic-comparison-prepare');
            const { context } = await requireBrowserSession(request.headers);
            const projectId = projectFrom(body, context.projectId);
            await access(request.headers, projectId, true);
            try {
              let profile = await semanticEmbeddingProfile.getCurrent(projectId);
              const aiSettings = await backend.getSettings(projectId);
              const currentCredential = profile
                ? aiSettings.credentialStatuses.find(
                    (credential) =>
                      credential.credentialId === profile?.credentialId &&
                      credential.providerId === profile?.providerId &&
                      credential.credentialRevision === profile?.credentialRevision &&
                      credential.lifecycleState === 'active',
                  )
                : undefined;
              const currentModel = profile
                ? semanticEmbeddingRegistry.getModel(profile.providerId, profile.embeddingModelId)
                : undefined;
              const currentEligible = Boolean(
                profile &&
                currentCredential &&
                currentModel &&
                ['PREPARED', 'ACTIVE'].includes(profile.status),
              );
              if (!currentEligible) {
                const selected = selectEmbeddingBinding(aiSettings);
                if (!selected) {
                  throw new ShotgunError({
                    code: 'CONFIGURATION_REQUIRED',
                    safeMessage:
                      'Add one active credential for a registered semantic embedding provider first.',
                    module: 'ai-settings-api',
                    operation: 'prepare-semantic-comparison-credential',
                  });
                }
                const { model, credential } = selected;
                profile = await semanticEmbeddingProfile.createProfile({
                  projectId,
                  expectedRevision: profile?.profileRevision ?? 0,
                  providerId: model.providerId,
                  embeddingModelId: model.modelId,
                  credentialId: credential.credentialId,
                  credentialRevision: credential.credentialRevision,
                  representationVersion: SEMANTIC_REPRESENTATION_VERSION_V2,
                  dimension: model.shotgunDefaultDimension,
                  updatedBy: context.principalId,
                  status: 'PREPARED',
                });
              }
              const selectedProfile = profile;
              if (!selectedProfile) {
                throw new ShotgunError({
                  code: 'INTERNAL_UNCLASSIFIED',
                  safeMessage: 'Semantic comparison profile could not be prepared.',
                  module: 'ai-settings-api',
                  operation: 'prepare-semantic-comparison',
                });
              }
              const readyGeneration =
                await semanticActiveGenerationReader.getActiveGeneration(projectId);
              const generationMatchesProfile =
                Boolean(
                  readyGeneration &&
                  readyGeneration.buildStatus === 'READY' &&
                  readyGeneration.embeddingProfileId === selectedProfile.profileId &&
                  readyGeneration.embeddingProfileRevision === selectedProfile.profileRevision,
                ) &&
                (await generationMatchesSource(projectId, readyGeneration)) &&
                (await generationMatchesCurrentExecution(
                  projectId,
                  selectedProfile,
                  readyGeneration,
                ));
              if (!generationMatchesProfile) {
                const refreshResult = await semanticProjectionRefresh.refresh({
                  projectId,
                  actor: context.actor,
                  security: context.security,
                });
                const status = await projectStatus(projectId);
                if (refreshResult.status !== 'ACTIVATED') {
                  return {
                    status: {
                      ...status,
                      status: 'NEEDS_ATTENTION' as const,
                    },
                  };
                }
                return { status };
              }
              return { status: await projectStatus(projectId) };
            } catch (error) {
              throw mapError(error, 'prepare-semantic-comparison');
            }
          },
        );
      }
    }
  }

  server.get<{
    Querystring: {
      targetProjectId?: string;
      clientRequestId?: string;
      providerId?: string;
      operation?: string;
      credentialId?: string;
      expectedRevision?: string;
    };
    Headers: SecurityHeaders;
  }>('/api/v1/settings/ai/credential-write-outcomes/by-client-request', async (request) => {
    const { context } = await requireBrowserSession(request.headers);
    const projectId = request.query.targetProjectId ?? context.projectId;
    const clientRequestId = request.query.clientRequestId;
    await access(request.headers, projectId, true);
    if (typeof clientRequestId !== 'string' || !clientRequestId.trim()) {
      throw new ShotgunError({
        code: 'VALIDATION_ERROR',
        safeMessage: 'clientRequestId is required.',
        module: 'ai-settings-api',
        operation: 'get-credential-write-outcome',
      });
    }
    try {
      const providerId = request.query.providerId;
      const operation = request.query.operation;
      if (typeof providerId !== 'string' || !providerId.trim()) {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'providerId is required.',
          module: 'ai-settings-api',
          operation: 'get-credential-write-outcome',
        });
      }
      if (operation !== 'CREATE' && operation !== 'REPLACE') {
        throw new ShotgunError({
          code: 'VALIDATION_ERROR',
          safeMessage: 'operation must be CREATE or REPLACE.',
          module: 'ai-settings-api',
          operation: 'get-credential-write-outcome',
        });
      }
      const binding =
        operation === 'CREATE'
          ? { operation: 'CREATE' as const, providerId }
          : {
              operation: 'REPLACE' as const,
              providerId,
              credentialId: request.query.credentialId ?? '',
              expectedRevision: Number(request.query.expectedRevision),
            };
      const credential = await backend.getCredentialWriteOutcome({
        projectId,
        clientRequestId,
        binding,
      });
      if (!credential) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'Credential write outcome was not found.',
          module: 'ai-settings-api',
          operation: 'get-credential-write-outcome',
        });
      }
      return { credential };
    } catch (error) {
      throw mapError(error, 'get-credential-write-outcome');
    }
  });

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
            ...(typeof body.clientRequestId === 'string'
              ? { clientRequestId: requiredString(body, 'clientRequestId') }
              : {}),
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
            ...(typeof body.clientRequestId === 'string'
              ? { clientRequestId: requiredString(body, 'clientRequestId') }
              : {}),
          }),
        };
      } catch (error) {
        throw mapError(error, 'replace-ai-credential');
      }
    },
  );

  if (providerApprovals) {
    server.post<{ Body: unknown; Headers: SecurityHeaders }>(
      '/api/v1/settings/ai/provider-privacy/proposals',
      async (request) => {
        const body = objectBody(request.body);
        const { context } = await requireBrowserSession(request.headers);
        const projectId = projectFrom(body, context.projectId);
        await access(request.headers, projectId, true);
        try {
          return {
            proposal: await providerApprovals.propose({
              projectId,
              providerId: requiredString(body, 'providerId'),
              approved: requiredBoolean(body, 'approved'),
              expectedApprovalRevision: requiredInteger(body, 'expectedApprovalRevision'),
              proposedBy: context.principalId,
            }),
          };
        } catch (error) {
          throw mapError(error, 'propose-provider-privacy-approval');
        }
      },
    );

    server.post<{ Params: { proposalId: string }; Body: unknown; Headers: SecurityHeaders }>(
      '/api/v1/settings/ai/provider-privacy/proposals/:proposalId/approve',
      async (request) => {
        const body = objectBody(request.body);
        const { context } = await requireBrowserSession(request.headers);
        const projectId = projectFrom(body, context.projectId);
        await access(request.headers, projectId, true);
        try {
          return {
            approval: await providerApprovals.approve({
              proposalId: request.params.proposalId,
              projectId,
              providerId: requiredString(body, 'providerId'),
              reviewedBy: context.principalId,
              expectedApprovalRevision: requiredInteger(body, 'expectedApprovalRevision'),
            }),
          };
        } catch (error) {
          throw mapError(error, 'approve-provider-privacy-approval');
        }
      },
    );
  }

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
    '/api/v1/settings/ai/standing-policy',
    async (request) => {
      const body = objectBody(request.body);
      const { context } = await requireBrowserSession(request.headers);
      const projectId = projectFrom(body, context.projectId);
      await requireProjectOwner(request.headers, projectId, authRepo, requireBrowserSession);
      try {
        return {
          standingPolicy: await backend.saveStandingPolicy({
            projectId,
            expectedRevision: requiredInteger(body, 'expectedRevision'),
            enabled: requiredBoolean(body, 'enabled'),
            providerId: requiredString(body, 'providerId'),
            aiConfigurationRevision: requiredInteger(body, 'aiConfigurationRevision'),
            changedBy: context.principalId,
          }),
        };
      } catch (error) {
        throw mapError(error, 'save-standing-ai-processing-policy');
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
