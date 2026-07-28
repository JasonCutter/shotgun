import type {
  AcceptedPolicyContext,
  ErrorCode,
  FrontendCommandOutcomeView,
  FrontendCommandRequest,
  ProducedResourceRef,
} from '../../../packages/contracts/src/index.js';

export type AcceptFrontendCommandInput = {
  readonly commandId: string;
  readonly commandRevision: string;
  readonly principalId: string;
  readonly request: FrontendCommandRequest;
  readonly commandSemanticDigest: string;
  readonly acceptedPolicyContext: AcceptedPolicyContext;
  readonly correlationId: string;
  readonly traceId: string;
  readonly receivedAt: string;
  readonly acceptedAt: string;
};

export type AcceptFrontendCommandResult = {
  readonly outcome: FrontendCommandOutcomeView;
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

export type FrontendCommandGatewayPort = {
  accept(input: AcceptFrontendCommandInput): Promise<AcceptFrontendCommandResult>;
  complete(input: CompleteFrontendCommandInput): Promise<FrontendCommandOutcomeView>;
  reject(input: RejectFrontendCommandInput): Promise<FrontendCommandOutcomeView>;
  findByClientRequestId(
    principalId: string,
    clientRequestId: string,
  ): Promise<FrontendCommandOutcomeView | null>;
};

export const createAcceptedFrontendCommandOutcome = (
  input: AcceptFrontendCommandInput,
): FrontendCommandOutcomeView => ({
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
  acceptedProjectContext: {
    targetProjectId: input.request.projectContext.targetProjectId,
  },
  acceptedPolicyContext: input.acceptedPolicyContext,
  correlationId: input.correlationId,
  traceId: input.traceId,
  producedResources: [],
  receivedAt: input.receivedAt,
  acceptedAt: input.acceptedAt,
  lastUpdatedAt: input.acceptedAt,
});
