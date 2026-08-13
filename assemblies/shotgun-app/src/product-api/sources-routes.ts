import { createHash, randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import type { AuthRepositoryPort } from '../../../../packages/authentication/src/index.js';
import {
  FrontendContractError,
  SOURCES_FRONTEND_COMMAND_TYPES,
  ShotgunError,
  buildPrincipalScopedCommandSemanticDigestInput,
  decodeSourceLibraryQuery,
  validateSourcesFrontendCommandRequest,
  validateStagedSourcesFrontendCommandRequest,
  type FrontendCommandRequest,
  type SourcesFrontendCommandPayload,
  type SourcesFrontendCommandType,
  type SourcesSensitivity,
  type SubmitStagedSourcesIntakeCommandPayload,
} from '../../../../packages/contracts/src/index.js';
import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type {
  FrontendSourcesReadCoordinator,
  ServerAuthorizedProjectSourcesReadScope,
} from '../../../../modules/frontend-sources-product/src/index.js';
import type { SourcesProductWriteScope } from '../../../../modules/frontend-sources-write/src/product-service.js';
import type { SecurityHeaders } from '../server.js';
import { rejectAcceptedCommand, toProductApiCommandError } from './frontend-command-route.js';
import { getSourcesWriteRuntime } from './sources-write-runtime.js';

type PrincipalSessionResolver = (
  headers: Record<string, string | string[] | undefined>,
) => Promise<{
  principalContext: { principalId: string };
  context?: { principalId: string; projectId: string };
  session: { sessionId: string; activeProjectId: string | null };
}>;

const requireParameter = (value: unknown, name: string, maximum = 256): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
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

const writeUnavailable = (): ShotgunError =>
  new ShotgunError({
    code: 'CAPABILITY_DENIED',
    safeMessage: 'Sources write capability is not active in this runtime.',
    module: 'frontend-sources-product',
    operation: 'require-write-runtime',
  });

export const registerSourcesRoutes = (
  server: FastifyInstance,
  coordinator: FrontendSourcesReadCoordinator,
  authRepository: AuthRepositoryPort,
  settingsRepository: SettingsRepositoryPort,
  requirePrincipalBrowserSession: PrincipalSessionResolver,
): void => {
  if (!server.hasContentTypeParser('application/octet-stream')) {
    server.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: 1_048_576 },
      (_request, body, done) => done(null, body),
    );
  }

  const buildScope = async (
    headers: SecurityHeaders,
  ): Promise<{
    read: ServerAuthorizedProjectSourcesReadScope;
    write: SourcesProductWriteScope;
  }> => {
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
    const accessRevision = `${membership.projectId}:${membership.scopes.slice().sort().join(',')}`;
    const policyContextRevision = String(settings.policyContextRevision);
    return {
      read: {
        principalId: current.principalContext.principalId,
        sessionId: current.session.sessionId,
        authorizedProjectId: activeProjectId,
        accessScopes: membership.scopes,
        sensitivityClearance: membership.sensitivityClearance as SourcesSensitivity,
        accessRevision,
        policyContextRevision,
      },
      write: {
        principalId: current.principalContext.principalId,
        sessionId: current.session.sessionId,
        projectId: activeProjectId,
        principalAccessScopes: membership.scopes,
        sensitivityClearance: membership.sensitivityClearance as SourcesSensitivity,
        resourceSecurityPolicy: {
          // The current Product boundary is single-owner. This is a server-owned
          // Project policy, not a Browser authority or Principal metadata copy.
          allowedClassifications: membership.isOwner ? ['public', 'internal', 'private'] : [],
          resourceAccessScope: ['owner'],
        },
        accessRevision,
        policyContextRevision,
        acceptedPolicyContextId: `project-policy-context/${activeProjectId}`,
        acceptedPolicyBinding: { mode: 'CURRENT', policyContextRevision },
      },
    };
  };

  const acceptCommand = async <
    TPayload extends SourcesFrontendCommandPayload | SubmitStagedSourcesIntakeCommandPayload,
  >(
    rawRequest: unknown,
    expectedCommandType: SourcesFrontendCommandType,
    scope: SourcesProductWriteScope,
    stagedSubmit = false,
  ): Promise<{
    readonly request: FrontendCommandRequest<TPayload>;
    readonly outcome: Awaited<
      ReturnType<NonNullable<ReturnType<typeof getSourcesWriteRuntime>>['commandGateway']['accept']>
    >['outcome'];
    readonly replayed: boolean;
  }> => {
    const runtime = getSourcesWriteRuntime();
    if (!runtime) throw writeUnavailable();
    const request = (
      stagedSubmit
        ? validateStagedSourcesFrontendCommandRequest(rawRequest, expectedCommandType)
        : validateSourcesFrontendCommandRequest(rawRequest, expectedCommandType)
    ) as FrontendCommandRequest<TPayload>;
    if (
      request.projectContext.activeProjectId !== scope.projectId ||
      request.projectContext.targetProjectId !== scope.projectId
    ) {
      throw new FrontendContractError(
        'RESOURCE_PROJECT_MISMATCH',
        'Sources Command Project Context does not match the active Server Session.',
      );
    }
    const observed = request.policyBinding.observedPolicyContextRevision;
    if (observed !== undefined && observed !== scope.policyContextRevision) {
      throw new FrontendContractError(
        'POLICY_CONTEXT_CHANGED',
        'The Sources Command policy context is stale.',
      );
    }
    const receivedAt = new Date().toISOString();
    const acceptedAt = new Date().toISOString();
    const digest = createHash('sha256')
      .update(buildPrincipalScopedCommandSemanticDigestInput(request, scope.principalId))
      .digest('hex');
    const accepted = await runtime.commandGateway.accept({
      commandId: randomUUID(),
      commandRevision: '1',
      principalId: scope.principalId,
      request,
      commandSemanticDigest: digest,
      acceptedPolicyContext: {
        policyContextId: scope.acceptedPolicyContextId,
        policyContextRevision: scope.policyContextRevision,
        acceptedAt,
      },
      correlationId: request.correlationContext?.correlationId ?? randomUUID(),
      traceId: randomUUID(),
      receivedAt,
      acceptedAt,
    });
    return { ...accepted, request };
  };

  const completeSubmission = async (
    commandId: string,
    submission: { readonly submissionId: string; readonly submissionRevision: string },
  ) => {
    const runtime = getSourcesWriteRuntime();
    if (!runtime) throw writeUnavailable();
    try {
      return await runtime.commandGateway.complete({
        commandId,
        producedResources: [
          {
            resourceKind: 'source-intake-submission',
            resourceId: submission.submissionId,
            resourceRevision: submission.submissionRevision,
          },
        ],
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      throw new ShotgunError({
        code: 'OUTCOME_INDETERMINATE',
        safeMessage:
          'The Sources operation may have completed. Resolve the original clientRequestId before retrying.',
        module: 'frontend-sources-product',
        operation: 'complete-sources-command',
        retryable: true,
        cause: error,
      });
    }
  };

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/sources/query',
    async (request) => {
      const scope = await buildScope(request.headers);
      return {
        page: await coordinator.list(scope.read, decodeSourceLibraryQuery(request.body)),
      };
    },
  );

  server.post<{
    Body: Buffer;
    Querystring: {
      draftId?: string;
      itemId?: string;
      kind?: string;
      label?: string;
      mediaType?: string;
      fileName?: string;
    };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/sources/staging/bytes', async (request) => {
    const runtime = getSourcesWriteRuntime();
    if (!runtime) throw writeUnavailable();
    const scope = await buildScope(request.headers);
    const kind = request.query.kind;
    if (kind !== 'DIRECT_TEXT' && kind !== 'FILE') {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'Sources byte staging kind is invalid.',
        module: 'frontend-sources-product',
        operation: 'stage-bytes',
      });
    }
    const mediaType = request.query.mediaType;
    if (mediaType !== 'text/plain' && mediaType !== 'text/markdown') {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'Sources byte staging media type is unsupported.',
        module: 'frontend-sources-product',
        operation: 'stage-bytes',
      });
    }
    return {
      receipt: await runtime.staging.stageBytes({
        draftId: requireParameter(request.query.draftId, 'draftId', 512),
        itemId: requireParameter(request.query.itemId, 'itemId', 200),
        projectId: scope.write.projectId,
        principalId: scope.write.principalId,
        kind,
        label: requireParameter(request.query.label, 'label', 500),
        mediaType,
        ...(kind === 'FILE'
          ? { fileName: requireParameter(request.query.fileName, 'fileName', 255) }
          : {}),
        bytes: request.body,
      }),
    };
  });

  server.post<{
    Body: { draftId?: unknown; itemId?: unknown; label?: unknown; requestedUrl?: unknown };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/sources/staging/url', async (request) => {
    const runtime = getSourcesWriteRuntime();
    if (!runtime) throw writeUnavailable();
    const scope = await buildScope(request.headers);
    return {
      receipt: await runtime.staging.stageUrl({
        draftId: requireParameter(request.body?.draftId, 'draftId', 512),
        itemId: requireParameter(request.body?.itemId, 'itemId', 200),
        projectId: scope.write.projectId,
        principalId: scope.write.principalId,
        label: requireParameter(request.body?.label, 'label', 500),
        requestedUrl: requireParameter(request.body?.requestedUrl, 'requestedUrl', 8_192),
      }),
    };
  });

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/sources/submissions',
    async (request) => {
      const runtime = getSourcesWriteRuntime();
      if (!runtime) throw writeUnavailable();
      const scope = await buildScope(request.headers);
      try {
        const accepted = await acceptCommand<SubmitStagedSourcesIntakeCommandPayload>(
          request.body,
          SOURCES_FRONTEND_COMMAND_TYPES.submit,
          scope.write,
          true,
        );
        const submissionId = accepted.outcome.commandId;
        let submission = await runtime.productService.getSubmission(scope.write, submissionId);
        if (!submission) {
          const items = await Promise.all(
            accepted.request.payload.inputs.map(async (item) => {
              const artifact = await runtime.staging.resolve({
                stagingReference: item.stagingReference,
                draftId: accepted.request.payload.draftId,
                itemId: item.itemId,
                projectId: scope.write.projectId,
                principalId: scope.write.principalId,
                kind: item.kind,
              });
              return {
                ...artifact,
                stagingReference: item.stagingReference,
                ...(item.requestedClassification === undefined
                  ? {}
                  : { requestedClassification: item.requestedClassification }),
              };
            }),
          );
          try {
            submission = await runtime.productService.submit({
              submissionId,
              commandId: accepted.outcome.commandId,
              correlationId: accepted.outcome.correlationId,
              draftId: accepted.request.payload.draftId,
              scope: scope.write,
              items,
              createdAt: new Date().toISOString(),
            });
          } catch (error) {
            await rejectAcceptedCommand(runtime.commandGateway, accepted.outcome.commandId, error);
            throw error;
          }
        }
        const outcome = await completeSubmission(accepted.outcome.commandId, submission);
        return { outcome, submission };
      } catch (error) {
        throw toProductApiCommandError(error, 'submit-sources-intake');
      }
    },
  );

  server.get<{
    Params: { submissionId: string };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/sources/submissions/:submissionId', async (request) => {
    const runtime = getSourcesWriteRuntime();
    if (!runtime) throw writeUnavailable();
    const scope = await buildScope(request.headers);
    const submission = await runtime.productService.getSubmission(
      scope.write,
      requireParameter(request.params.submissionId, 'submissionId'),
    );
    if (!submission) throw maskedNotFound();
    return { submission };
  });

  server.get<{
    Params: { decisionId: string };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/sources/duplicate-decisions/:decisionId', async (request) => {
    const runtime = getSourcesWriteRuntime();
    if (!runtime) throw writeUnavailable();
    const scope = await buildScope(request.headers);
    const decision = await runtime.productService.getDuplicateDecision(
      scope.write,
      requireParameter(request.params.decisionId, 'decisionId'),
    );
    if (!decision) throw maskedNotFound();
    return { decision };
  });

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/sources/duplicate-decisions/resolve',
    async (request) => {
      const runtime = getSourcesWriteRuntime();
      if (!runtime) throw writeUnavailable();
      const scope = await buildScope(request.headers);
      try {
        const accepted = await acceptCommand(
          request.body,
          SOURCES_FRONTEND_COMMAND_TYPES.resolveDuplicate,
          scope.write,
        );
        const payload = accepted.request.payload as Extract<
          SourcesFrontendCommandPayload,
          { readonly decisionId: string }
        >;
        const decision = await runtime.productService.getDuplicateDecision(
          scope.write,
          payload.decisionId,
        );
        if (!decision) throw maskedNotFound();
        let submission = await runtime.productService.getSubmission(
          scope.write,
          decision.submissionId,
        );
        if (accepted.outcome.outcomeState !== 'COMPLETED') {
          try {
            submission = await runtime.productService.resolveDuplicate({
              commandId: accepted.outcome.commandId,
              correlationId: accepted.outcome.correlationId,
              decisionId: payload.decisionId,
              observedDecisionRevision: decision.decisionRevision,
              disposition: payload.disposition,
              ...(payload.targetSourceId === undefined
                ? {}
                : { targetSourceId: payload.targetSourceId }),
              scope: scope.write,
              createdAt: new Date().toISOString(),
            });
          } catch (error) {
            await rejectAcceptedCommand(runtime.commandGateway, accepted.outcome.commandId, error);
            throw error;
          }
        }
        if (!submission) throw maskedNotFound();
        const outcome = await completeSubmission(accepted.outcome.commandId, submission);
        return { outcome, submission };
      } catch (error) {
        throw toProductApiCommandError(error, 'resolve-sources-duplicate');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/sources/submissions/cancel',
    async (request) => {
      const runtime = getSourcesWriteRuntime();
      if (!runtime) throw writeUnavailable();
      const scope = await buildScope(request.headers);
      try {
        const accepted = await acceptCommand(
          request.body,
          SOURCES_FRONTEND_COMMAND_TYPES.cancel,
          scope.write,
        );
        const payload = accepted.request.payload as Extract<
          SourcesFrontendCommandPayload,
          { readonly submissionId: string }
        >;
        let submission = await runtime.productService.getSubmission(
          scope.write,
          payload.submissionId,
        );
        if (accepted.outcome.outcomeState !== 'COMPLETED') {
          try {
            submission = await runtime.productService.cancel({
              commandId: accepted.outcome.commandId,
              correlationId: accepted.outcome.correlationId,
              submissionId: payload.submissionId,
              scope: scope.write,
              createdAt: new Date().toISOString(),
            });
          } catch (error) {
            await rejectAcceptedCommand(runtime.commandGateway, accepted.outcome.commandId, error);
            throw error;
          }
        }
        if (!submission) throw maskedNotFound();
        const outcome = await completeSubmission(accepted.outcome.commandId, submission);
        return { outcome, submission };
      } catch (error) {
        throw toProductApiCommandError(error, 'cancel-sources-intake');
      }
    },
  );

  server.post<{ Body: unknown; Headers: SecurityHeaders }>(
    '/product-api/frontend/sources/submissions/retry',
    async (request) => {
      const runtime = getSourcesWriteRuntime();
      if (!runtime) throw writeUnavailable();
      const scope = await buildScope(request.headers);
      try {
        const accepted = await acceptCommand(
          request.body,
          SOURCES_FRONTEND_COMMAND_TYPES.retry,
          scope.write,
        );
        const payload = accepted.request.payload as Extract<
          SourcesFrontendCommandPayload,
          { readonly itemIds: readonly string[] }
        >;
        let submission = await runtime.productService.getSubmission(
          scope.write,
          payload.submissionId,
        );
        if (accepted.outcome.outcomeState !== 'COMPLETED') {
          try {
            submission = await runtime.productService.retry({
              commandId: accepted.outcome.commandId,
              correlationId: accepted.outcome.correlationId,
              submissionId: payload.submissionId,
              itemIds: payload.itemIds,
              mode: payload.mode,
              scope: scope.write,
              createdAt: new Date().toISOString(),
            });
          } catch (error) {
            await rejectAcceptedCommand(runtime.commandGateway, accepted.outcome.commandId, error);
            throw error;
          }
        }
        if (!submission) throw maskedNotFound();
        const outcome = await completeSubmission(accepted.outcome.commandId, submission);
        return { outcome, submission };
      } catch (error) {
        throw toProductApiCommandError(error, 'retry-sources-intake');
      }
    },
  );

  server.get<{
    Params: { sourceId: string };
    Headers: SecurityHeaders;
  }>('/product-api/frontend/sources/:sourceId', async (request) => {
    const scope = await buildScope(request.headers);
    const source = await coordinator.detail(
      scope.read,
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
    if (request.query.cursor !== undefined) requireParameter(request.query.cursor, 'cursor');
    const history = await coordinator.history(
      scope.read,
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
        scope.read,
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
      if (request.query.cursor !== undefined) requireParameter(request.query.cursor, 'cursor');
      const evidence = await coordinator.evidenceList(
        scope.read,
        requireParameter(request.params.sourceId, 'sourceId'),
        requireParameter(request.params.sourceVersionId, 'sourceVersionId'),
      );
      if (!evidence) throw maskedNotFound();
      return { evidence };
    },
  );
};
