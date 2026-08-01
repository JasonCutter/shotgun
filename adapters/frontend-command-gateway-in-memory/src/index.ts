import {
  FrontendContractError,
  frontendCommandScopeBindingKey,
  getFailureDescriptor,
  isErrorCode,
  type AnyFrontendCommandOutcomeView,
} from '../../../packages/contracts/src/index.js';
import {
  createAcceptedFrontendCommandOutcome,
  type AcceptFrontendCommandInput,
  type AcceptFrontendCommandResult,
  type CompleteFrontendCommandInput,
  type FrontendCommandResourceBinding,
  type FrontendCommandGatewayPort,
  type RejectFrontendCommandInput,
  type ResolveFrontendCommandOutcomeUnknownInput,
} from '../../../modules/frontend-command-gateway/src/index.js';

type LedgerRecord = {
  readonly principalId: string;
  readonly envelopeVersion: '1.0.0' | '2.0.0';
  readonly scopeBindingKey: string;
  readonly resourceBindings: readonly { readonly resourceKind: string; readonly resourceId: string }[];
  readonly outcome: AnyFrontendCommandOutcomeView;
};

const matchesResourceBinding = (
  record: LedgerRecord,
  binding: FrontendCommandResourceBinding | undefined,
): boolean => {
  if (!binding) return true;
  if (binding.commandTypes && !binding.commandTypes.includes(record.outcome.commandType)) return false;
  return record.resourceBindings.some(
    (resource) =>
      resource.resourceKind === binding.resourceKind && resource.resourceId === binding.resourceId,
  );
};

export class InMemoryFrontendCommandGateway implements FrontendCommandGatewayPort {
  private readonly byCommandId = new Map<string, LedgerRecord>();
  private readonly byClientRequestId = new Map<string, LedgerRecord>();
  private readonly byIdempotencyScope = new Map<string, LedgerRecord>();

  async accept(input: AcceptFrontendCommandInput): Promise<AcceptFrontendCommandResult> {
    const requestScope = `${input.principalId}:${input.request.clientRequestId}`;
    const idempotencyScope = [
      input.principalId,
      input.request.envelopeVersion,
      input.request.envelopeVersion === '1.0.0' ? 'PROJECT' : input.request.projectContext.scope,
      frontendCommandScopeBindingKey(input.request),
      input.request.commandType,
      input.request.commandSchemaVersion,
      input.request.idempotencyKey,
    ].join(':');
    const existingByRequest = this.byClientRequestId.get(requestScope);
    if (
      existingByRequest &&
      (existingByRequest.envelopeVersion !== input.request.envelopeVersion ||
        existingByRequest.scopeBindingKey !== frontendCommandScopeBindingKey(input.request) ||
        existingByRequest.outcome.commandType !== input.request.commandType ||
        existingByRequest.outcome.commandSchemaVersion !== input.request.commandSchemaVersion ||
        existingByRequest.outcome.commandSemanticDigest !== input.commandSemanticDigest)
    ) {
      throw new FrontendContractError(
        input.request.envelopeVersion === '2.0.0'
          ? 'CLIENT_REQUEST_MEANING_MISMATCH'
          : 'IDEMPOTENCY_KEY_REUSE_MISMATCH',
        'clientRequestId cannot be rebound to different command meaning.',
      );
    }
    if (
      existingByRequest &&
      existingByRequest.outcome.idempotencyKey !== input.request.idempotencyKey
    ) {
      throw new FrontendContractError(
        'IDEMPOTENCY_KEY_REUSE_MISMATCH',
        'clientRequestId cannot be rebound to a different idempotency key.',
      );
    }
    const existing = existingByRequest ?? this.byIdempotencyScope.get(idempotencyScope);
    if (existing) {
      if (existing.outcome.commandSemanticDigest !== input.commandSemanticDigest) {
        throw new FrontendContractError(
          'IDEMPOTENCY_KEY_REUSE_MISMATCH',
          'Existing frontend command has a different semantic digest.',
        );
      }
      return { outcome: existing.outcome, replayed: true };
    }

    const outcome = createAcceptedFrontendCommandOutcome(input);
    const record = {
      principalId: input.principalId,
      envelopeVersion: input.request.envelopeVersion,
      scopeBindingKey: frontendCommandScopeBindingKey(input.request),
      resourceBindings: input.request.preconditions.map((precondition) => precondition.subject),
      outcome,
    };
    this.byCommandId.set(outcome.commandId, record);
    this.byClientRequestId.set(requestScope, record);
    this.byIdempotencyScope.set(idempotencyScope, record);
    return { outcome, replayed: false };
  }

  async lockAcceptedForExecution(
    _transaction: unknown,
    commandId: string,
  ): Promise<AnyFrontendCommandOutcomeView> {
    const outcome = this.requireRecord(commandId).outcome;
    if (outcome.outcomeState !== 'ACCEPTED' && outcome.outcomeState !== 'COMPLETED') {
      throw new FrontendContractError(
        'RESOURCE_RETIRED',
        `Command '${commandId}' is not executable from state '${outcome.outcomeState}'.`,
      );
    }
    return outcome;
  }

  async completeInTransaction(
    _transaction: unknown,
    input: CompleteFrontendCommandInput,
  ): Promise<AnyFrontendCommandOutcomeView> {
    return this.complete(input);
  }

  async complete(input: CompleteFrontendCommandInput): Promise<AnyFrontendCommandOutcomeView> {
    const existing = this.requireRecord(input.commandId);
    if (existing.outcome.outcomeState === 'COMPLETED') return existing.outcome;
    const outcome: AnyFrontendCommandOutcomeView = {
      ...existing.outcome,
      commandRevision: String(Number(existing.outcome.commandRevision) + 1),
      outcomeState: 'COMPLETED',
      completionDisposition: 'SUCCEEDED',
      producedResources: input.producedResources,
      completedAt: input.completedAt,
      lastUpdatedAt: input.completedAt,
    };
    this.replaceOutcome(existing, outcome);
    return outcome;
  }

  async reject(input: RejectFrontendCommandInput): Promise<AnyFrontendCommandOutcomeView> {
    if (!isErrorCode(input.code)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'Frontend Command Ledger rejection code must be registered.',
      );
    }
    const existing = this.requireRecord(input.commandId);
    const descriptor = getFailureDescriptor(input.code);
    if (existing.outcome.outcomeState === 'COMPLETED') return existing.outcome;
    const outcome: AnyFrontendCommandOutcomeView = {
      ...existing.outcome,
      commandRevision: String(Number(existing.outcome.commandRevision) + 1),
      outcomeState: 'REJECTED',
      completionDisposition: 'FAILED',
      rejection: {
        code: input.code,
        message: input.message,
        category: descriptor.category,
        retryability: descriptor.retryability,
        recovery: descriptor.recovery,
        retryable: descriptor.retryability === 'SAFE',
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      },
      completedAt: input.completedAt,
      lastUpdatedAt: input.completedAt,
    };
    this.replaceOutcome(existing, outcome);
    return outcome;
  }

  async markOutcomeUnknown(
    input: ResolveFrontendCommandOutcomeUnknownInput,
  ): Promise<AnyFrontendCommandOutcomeView> {
    const existing = this.requireRecord(input.commandId);
    if (existing.outcome.outcomeState !== 'ACCEPTED') return existing.outcome;
    const outcome: AnyFrontendCommandOutcomeView = {
      ...existing.outcome,
      commandRevision: String(Number(existing.outcome.commandRevision) + 1),
      outcomeState: 'OUTCOME_UNKNOWN',
      completionDisposition: 'PARTIAL',
      rejection: {
        code: 'OUTCOME_UNKNOWN',
        message: input.message,
        retryable: false,
      },
      completedAt: input.completedAt,
      lastUpdatedAt: input.completedAt,
    };
    this.replaceOutcome(existing, outcome);
    return outcome;
  }

  async findByClientRequestId(
    principalId: string,
    clientRequestId: string,
    binding?: FrontendCommandResourceBinding,
  ): Promise<AnyFrontendCommandOutcomeView | null> {
    const record = this.byClientRequestId.get(`${principalId}:${clientRequestId}`);
    return record && matchesResourceBinding(record, binding) ? record.outcome : null;
  }

  private requireRecord(commandId: string): LedgerRecord {
    const record = this.byCommandId.get(commandId);
    if (!record) {
      throw new FrontendContractError('RESOURCE_RETIRED', `Command '${commandId}' not found.`);
    }
    return record;
  }

  private replaceOutcome(record: LedgerRecord, outcome: AnyFrontendCommandOutcomeView): void {
    const replacement = { ...record, outcome };
    this.byCommandId.set(outcome.commandId, replacement);
    this.byClientRequestId.set(`${record.principalId}:${outcome.clientRequestId}`, replacement);
    for (const [key, value] of this.byIdempotencyScope.entries()) {
      if (value.outcome.commandId === outcome.commandId) {
        this.byIdempotencyScope.set(key, replacement);
      }
    }
  }
}
