import { createHash, randomUUID } from 'node:crypto';

import type { SettingsRepositoryPort } from '../../../../modules/settings-policy/src/index.js';
import type {
  FrontendCommandGatewayPort,
  AcceptFrontendCommandResult,
} from '../../../../modules/frontend-command-gateway/src/index.js';
import {
  buildFrontendCommandV2SemanticDigestInput,
  buildPrincipalScopedCommandSemanticDigestInput,
  FrontendContractError,
  ShotgunError,
  validatePrincipalProjectCreateRequest,
  validateSection2FrontendCommandRequest,
  type CreateProjectCommandPayloadV2,
  type FrontendCommandRequest,
  type FrontendCommandRequestV2,
  type Section2FrontendCommandPayload,
  type Section2FrontendCommandType,
  type TypedPreconditionPurpose,
} from '../../../../packages/contracts/src/index.js';

export type AcceptedSection2Command = AcceptFrontendCommandResult & {
  readonly request: FrontendCommandRequest<Section2FrontendCommandPayload>;
};

export type AcceptedPrincipalProjectCreateCommand = AcceptFrontendCommandResult & {
  readonly request: FrontendCommandRequestV2<CreateProjectCommandPayloadV2>;
};

export const acceptPrincipalProjectCreateCommand = async (input: {
  readonly rawRequest: unknown;
  readonly principalId: string;
  readonly sessionActiveProjectId: string | null;
  readonly commandGateway: FrontendCommandGatewayPort;
}): Promise<AcceptedPrincipalProjectCreateCommand> => {
  const request = validatePrincipalProjectCreateRequest(input.rawRequest);
  if (input.sessionActiveProjectId !== null) {
    throw new FrontendContractError(
      'ZERO_PROJECT_PRECONDITION_FAILED',
      'PRINCIPAL project.create.v1 requires a zero-project Session.',
    );
  }
  const receivedAt = new Date().toISOString();
  const acceptedAt = new Date().toISOString();
  const acceptedPolicyContext = {
    policyContextId: 'principal-project-bootstrap-policy',
    policyContextRevision: '1',
    acceptedAt,
  };
  const commandSemanticDigest = createHash('sha256')
    .update(
      buildFrontendCommandV2SemanticDigestInput(request, input.principalId, acceptedPolicyContext),
    )
    .digest('hex');
  const accepted = await input.commandGateway.accept({
    commandId: randomUUID(),
    commandRevision: '1',
    principalId: input.principalId,
    request,
    commandSemanticDigest,
    acceptedPolicyContext,
    correlationId: request.correlationContext?.correlationId ?? randomUUID(),
    traceId: randomUUID(),
    receivedAt,
    acceptedAt,
  });
  return { ...accepted, request };
};

export const acceptSection2Command = async (input: {
  readonly rawRequest: unknown;
  readonly expectedCommandType: Section2FrontendCommandType;
  readonly principalId: string;
  readonly sessionActiveProjectId: string;
  readonly settingsRepository: SettingsRepositoryPort;
  readonly commandGateway: FrontendCommandGatewayPort;
}): Promise<AcceptedSection2Command> => {
  const request = validateSection2FrontendCommandRequest(
    input.rawRequest,
    input.expectedCommandType,
  );
  if (request.projectContext.activeProjectId !== input.sessionActiveProjectId) {
    throw new FrontendContractError(
      'RESOURCE_PROJECT_MISMATCH',
      'projectContext.activeProjectId does not match the server session active project.',
    );
  }

  const receivedAt = new Date().toISOString();
  const targetSnapshot = await input.settingsRepository.getSettingsSnapshot(
    request.projectContext.targetProjectId,
  );
  const observedPolicyRevision = request.policyBinding.observedPolicyContextRevision;
  if (
    observedPolicyRevision !== undefined &&
    observedPolicyRevision !== String(targetSnapshot.policyContextRevision)
  ) {
    throw new FrontendContractError(
      'POLICY_CONTEXT_CHANGED',
      `Observed policy context revision ${observedPolicyRevision} does not match current revision ${targetSnapshot.policyContextRevision}.`,
    );
  }

  const acceptedAt = new Date().toISOString();
  const semanticInput = buildPrincipalScopedCommandSemanticDigestInput(request, input.principalId);
  const commandSemanticDigest = createHash('sha256').update(semanticInput).digest('hex');
  const accepted = await input.commandGateway.accept({
    commandId: randomUUID(),
    commandRevision: '1',
    principalId: input.principalId,
    request,
    commandSemanticDigest,
    acceptedPolicyContext: {
      policyContextId: `project-policy-context/${request.projectContext.targetProjectId}`,
      policyContextRevision: String(targetSnapshot.policyContextRevision),
      acceptedAt,
    },
    correlationId: request.correlationContext?.correlationId ?? randomUUID(),
    traceId: randomUUID(),
    receivedAt,
    acceptedAt,
  });
  return { ...accepted, request };
};

export const requireRevisionPrecondition = (
  request: FrontendCommandRequest,
  expected: {
    readonly purpose: TypedPreconditionPurpose;
    readonly resourceKind: string;
    readonly resourceId: string;
  },
): number => {
  const precondition = request.preconditions.find(
    (candidate) =>
      candidate.purpose === expected.purpose &&
      candidate.subject.resourceKind === expected.resourceKind &&
      candidate.subject.resourceId === expected.resourceId,
  );
  if (!precondition?.expectedRevision || !/^\d+$/.test(precondition.expectedRevision)) {
    throw new FrontendContractError(
      'PRECONDITION_ACCESS_DENIED',
      `Missing numeric ${expected.purpose} precondition for ${expected.resourceKind}/${expected.resourceId}.`,
    );
  }
  return Number(precondition.expectedRevision);
};

export const rejectAcceptedCommand = async (
  gateway: FrontendCommandGatewayPort,
  commandId: string,
  error: unknown,
): Promise<void> => {
  const normalized = toProductApiCommandError(error, 'reject-command');
  await gateway.reject({
    commandId,
    code: normalized.code,
    message: normalized.safeMessage,
    ...(normalized.correlationId === undefined ? {} : { correlationId: normalized.correlationId }),
    completedAt: new Date().toISOString(),
  });
};

export const toProductApiCommandError = (error: unknown, operation: string): ShotgunError => {
  if (error instanceof ShotgunError) return error;
  if (error instanceof FrontendContractError) {
    return new ShotgunError({
      code: error.code,
      safeMessage: error.message,
      module: 'frontend-command-gateway',
      operation,
      ...(error.correlationId === undefined ? {} : { correlationId: error.correlationId }),
    });
  }
  return new ShotgunError({
    code: 'INTERNAL_UNCLASSIFIED',
    safeMessage: 'Command execution failed.',
    module: 'frontend-command-gateway',
    operation,
    cause: error,
  });
};
