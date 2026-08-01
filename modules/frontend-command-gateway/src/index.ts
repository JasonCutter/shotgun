import type {
  AcceptedPolicyContext,
  AnyFrontendCommandOutcomeView,
  AnyFrontendCommandRequest,
  ErrorCode,
  ProducedResourceRef,
} from '../../../packages/contracts/src/index.js';

export type AcceptFrontendCommandInput = {
  readonly commandId: string;
  readonly commandRevision: string;
  readonly principalId: string;
  readonly request: AnyFrontendCommandRequest;
  readonly commandSemanticDigest: string;
  readonly acceptedPolicyContext: AcceptedPolicyContext;
  readonly correlationId: string;
  readonly traceId: string;
  readonly receivedAt: string;
  readonly acceptedAt: string;
};

export type AcceptFrontendCommandResult = {
  readonly outcome: AnyFrontendCommandOutcomeView;
  readonly replayed: boolean;
};

export type CompleteFrontendCommandInput = {
  readonly commandId: string;
  readonly producedResources: readonly ProducedResourceRef[];
  readonly completedAt: string;
};

export type RejectFrontendCommandInput = {
  readonly commandId: string;
  readonly code: ErrorCode;
  readonly message: string;
  readonly correlationId?: string;
  readonly completedAt: string;
};

export type ResolveFrontendCommandOutcomeUnknownInput = {
  readonly commandId: string;
  readonly message: string;
  readonly completedAt: string;
};

export type FrontendCommandGatewayPort = {
  accept(input: AcceptFrontendCommandInput): Promise<AcceptFrontendCommandResult>;
  lockAcceptedForExecution(
    transaction: unknown,
    commandId: string,
  ): Promise<AnyFrontendCommandOutcomeView>;
  completeInTransaction(
    transaction: unknown,
    input: CompleteFrontendCommandInput,
  ): Promise<AnyFrontendCommandOutcomeView>;
  complete(input: CompleteFrontendCommandInput): Promise<AnyFrontendCommandOutcomeView>;
  reject(input: RejectFrontendCommandInput): Promise<AnyFrontendCommandOutcomeView>;
  markOutcomeUnknown(
    input: ResolveFrontendCommandOutcomeUnknownInput,
  ): Promise<AnyFrontendCommandOutcomeView>;
  findByClientRequestId(
    principalId: string,
    clientRequestId: string,
  ): Promise<AnyFrontendCommandOutcomeView | null>;
};

export const createAcceptedFrontendCommandOutcome = (
  input: AcceptFrontendCommandInput,
): AnyFrontendCommandOutcomeView =>
  ({
    commandId: input.commandId,
    commandRevision: input.commandRevision,
    clientRequestId: input.request.clientRequestId,
    idempotencyKey: input.request.idempotencyKey,
    commandType: input.request.commandType,
    commandSchemaVersion: input.request.commandSchemaVersion,
    commandSemanticDigest: input.commandSemanticDigest,
    outcomeState: 'ACCEPTED',
    acceptedPrincipalContext: {
      principalId: input.principalId,
      actor: { type: 'user', id: input.principalId },
    },
    acceptedProjectContext:
      input.request.envelopeVersion === '1.0.0'
        ? { targetProjectId: input.request.projectContext.targetProjectId }
        : input.request.projectContext,
    acceptedPolicyContext: input.acceptedPolicyContext,
    correlationId: input.correlationId,
    traceId: input.traceId,
    producedResources: [],
    receivedAt: input.receivedAt,
    acceptedAt: input.acceptedAt,
    lastUpdatedAt: input.acceptedAt,
  }) as AnyFrontendCommandOutcomeView;
