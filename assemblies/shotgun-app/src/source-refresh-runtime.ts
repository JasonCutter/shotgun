import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { AuthRepositoryPort } from '../../../packages/authentication/src/index.js';
import type { AIProviderExecutionResolverPort } from '../../../modules/ai-provider/src/index.js';
import type { SettingsRepositoryPort } from '../../../modules/settings-policy/src/index.js';
import type { FrontendCommandGatewayPort } from '../../../modules/frontend-command-gateway/src/index.js';
import type {
  SourcesProductWriteServicePort,
  SourcesStagingServicePort,
} from '../../../modules/frontend-sources-write/src/product-service.js';
import {
  SourceRefreshCoordinator,
  type SourceRefreshAuthorizationPort,
} from '../../../modules/frontend-sources-write/src/source-refresh.js';
import { PostgresSourceRefreshStore } from '../../../adapters/source-refresh-postgres/src/index.js';
import {
  buildPrincipalScopedCommandSemanticDigestInput,
  validateStagedSourcesFrontendCommandRequest,
  type SourcesSensitivity,
} from '../../../packages/contracts/src/index.js';

/** Reuses the normal Product owner/membership, settings and AI resolver authorities.
 * The original intake session is an audit FK, never a fresh login/token. */
export type SourceRefreshRuntimeOptions = {
  pool: Pool;
  auth: AuthRepositoryPort;
  settings: SettingsRepositoryPort;
  ownerAccountId?: string;
  executionResolver: AIProviderExecutionResolverPort;
  commandGateway: FrontendCommandGatewayPort;
  staging: SourcesStagingServicePort;
  product: SourcesProductWriteServicePort;
};
export const createSourceRefreshAuthorization = (
  options: SourceRefreshRuntimeOptions,
): SourceRefreshAuthorizationPort => ({
  authorize: async (job) => {
    if (!options.ownerAccountId) return undefined;
    const principal = await options.auth.findPrincipalByAccountId(options.ownerAccountId);
    if (!principal || principal.principalId !== job.principalId) return undefined;
    const membership = await options.auth.findMembership(job.principalId, job.projectId);
    if (
      !membership?.isOwner ||
      !job.accessScope.every((scope) => membership.scopes.includes(scope))
    )
      return undefined;
    const visible = await options.pool.query<{ source_version_id: string }>(
      `SELECT version.source_version_id::text FROM asset.sources source
         JOIN project_admin.projects project ON project.id=source.project_id
         JOIN LATERAL (SELECT candidate.source_version_id FROM asset.source_versions candidate
           WHERE candidate.source_id=source.source_id ORDER BY candidate.version_number DESC LIMIT 1) version ON true
         LEFT JOIN project_admin.project_knowledge_epoch reset ON reset.project_id=source.project_id
         WHERE source.source_id=$1 AND source.project_id=$2 AND project.active AND project.status='ACTIVE'
           AND (reset.state IS NULL OR reset.state='READY')`,
      [job.sourceId, job.projectId],
    );
    if (
      !visible.rows[0] ||
      (job.phase !== 'SUBMITTING' && visible.rows[0].source_version_id !== job.sourceVersionId)
    )
      return undefined;
    // Completed submission readback is not permission to repeat acquisition or AI.
    if (job.phase !== 'SUBMITTING') {
      const execution = await options.executionResolver.resolve({
        projectId: job.projectId,
        requestId: `source-refresh:${job.jobId}:authorization`,
        sourceVersionId: job.sourceVersionId,
        dataClassification: 'source-content',
        accessScope: job.accessScope,
        sensitivity: job.sensitivity,
      });
      if (execution.adapter.identity.provider !== 'deepseek') return undefined;
    }
    const settings = await options.settings.getSettingsSnapshot(job.projectId);
    const revision = String(settings.policyContextRevision);
    return {
      principalId: job.principalId,
      sessionId: job.sessionId,
      projectId: job.projectId,
      principalAccessScopes: membership.scopes,
      sensitivityClearance: membership.sensitivityClearance as SourcesSensitivity,
      resourceSecurityPolicy: {
        allowedClassifications: ['public', 'internal', 'private'] as const,
        resourceAccessScope: ['owner'],
      },
      accessRevision: `${membership.projectId}:${membership.scopes.slice().sort().join(',')}`,
      policyContextRevision: revision,
      acceptedPolicyContextId: `project-policy-context/${job.projectId}`,
      acceptedPolicyBinding: { mode: 'CURRENT', policyContextRevision: revision },
    };
  },
  prepareSubmission: async (job, scope) => {
    const now = new Date().toISOString();
    const request = validateStagedSourcesFrontendCommandRequest(
      {
        envelopeVersion: '1.0.0',
        commandType: 'sources.intake.submit.v1',
        commandSchemaVersion: '1.0.0',
        clientRequestId: job.submissionId,
        idempotencyKey: `url-refresh:${job.jobId}`,
        projectContext: {
          activeProjectId: job.projectId,
          targetProjectId: job.projectId,
          resourceProjectId: job.projectId,
        },
        policyBinding: { mode: 'CURRENT' },
        preconditions: [],
        clientIssuedAt: now,
        payload: {
          draftId: job.jobId,
          duplicateHandling: 'AUTOMATIC',
          inputs: [
            {
              itemId: job.itemId,
              kind: 'URL',
              label: job.label,
              stagingReference: job.stagingReference,
              requestedSourceId: job.sourceId,
              requestedClassification: job.sensitivity,
            },
          ],
        },
      },
      'sources.intake.submit.v1',
    );
    const accepted = await options.commandGateway.accept({
      commandId: job.commandId,
      commandRevision: '1',
      principalId: job.principalId,
      request,
      commandSemanticDigest: createHash('sha256')
        .update(buildPrincipalScopedCommandSemanticDigestInput(request, scope.principalId))
        .digest('hex'),
      acceptedPolicyContext: {
        policyContextId: scope.acceptedPolicyContextId,
        policyContextRevision: scope.policyContextRevision,
        acceptedAt: now,
      },
      correlationId: job.jobId,
      traceId: job.jobId,
      receivedAt: now,
      acceptedAt: now,
    });
    if (
      accepted.outcome.commandId !== job.commandId ||
      accepted.outcome.outcomeState !== 'ACCEPTED'
    )
      throw new Error('URL_REFRESH_COMMAND_BINDING_REJECTED');
  },
  recordSubmission: async (job, result) => {
    const outcome = await options.commandGateway.complete({
      commandId: job.commandId,
      producedResources: [
        {
          resourceKind: 'source-intake-submission',
          resourceId: result.submissionId,
          resourceRevision: result.submissionRevision,
        },
      ],
      completedAt: new Date().toISOString(),
    });
    if (
      outcome.commandId !== job.commandId ||
      outcome.outcomeState !== 'COMPLETED' ||
      outcome.completionDisposition !== 'SUCCEEDED' ||
      !outcome.producedResources.some(
        (resource) =>
          resource.resourceKind === 'source-intake-submission' &&
          resource.resourceId === job.submissionId,
      )
    ) {
      throw new Error('URL_REFRESH_COMMAND_COMPLETION_READBACK_REQUIRED');
    }
  },
});

export const createSourceRefreshRuntime = (options: SourceRefreshRuntimeOptions) =>
  new SourceRefreshCoordinator(
    new PostgresSourceRefreshStore(options.pool, 900_000),
    createSourceRefreshAuthorization(options),
    options.staging,
    options.product,
  );

export const startSourceRefreshWorker = async (
  coordinator: SourceRefreshCoordinator,
  intervalMs = 60_000,
): Promise<() => Promise<void>> => {
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 300_000)
    throw new Error('Invalid source refresh worker interval.');
  let stopped = false;
  let active: Promise<unknown> | undefined;
  const tick = () => {
    if (stopped || active) return;
    active = coordinator
      .drainOnce('shotgun-app-url-refresh')
      .catch(() => console.warn('[source-refresh] REFRESH_PAUSED: durable state retained'))
      .finally(() => {
        active = undefined;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await active;
  };
};
