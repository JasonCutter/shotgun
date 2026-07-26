import { FrontendContractError } from '../../../packages/contracts/src/index.js';
import type { FrontendCommandOutcomeView } from '../../../packages/contracts/src/index.js';
import {
  createAcceptedFrontendCommandOutcome,
  type AcceptFrontendCommandInput,
  type AcceptFrontendCommandResult,
  type CompleteFrontendCommandInput,
  type FrontendCommandGatewayPort,
  type RejectFrontendCommandInput,
} from '../../../modules/frontend-command-gateway/src/index.js';

type LedgerRecord = {
  readonly principalId: string;
  readonly outcome: FrontendCommandOutcomeView;
};

export class InMemoryFrontendCommandGateway implements FrontendCommandGatewayPort {
  private readonly byCommandId = new Map<string, LedgerRecord>();
  private readonly byClientRequestId = new Map<string, LedgerRecord>();
  private readonly byIdempotencyScope = new Map<string, LedgerRecord>();

  async accept(input: AcceptFrontendCommandInput): Promise<AcceptFrontendCommandResult> {
    const requestScope = `${input.principalId}:${input.request.clientRequestId}`;
    const idempotencyScope = [
      input.principalId,
      input.request.projectContext.targetProjectId,
      input.request.commandType,
      input.request.commandSchemaVersion,
      input.request.idempotencyKey,
    ].join(':');
    const existingByRequest = this.byClientRequestId.get(requestScope);
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
    const record = { principalId: input.principalId, outcome };
    this.byCommandId.set(outcome.commandId, record);
    this.byClientRequestId.set(requestScope, record);
    this.byIdempotencyScope.set(idempotencyScope, record);
    return { outcome, replayed: false };
  }

  async complete(input: CompleteFrontendCommandInput): Promise<FrontendCommandOutcomeView> {
    const existing = this.requireRecord(input.commandId);
    const outcome: FrontendCommandOutcomeView = {
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

  async reject(input: RejectFrontendCommandInput): Promise<FrontendCommandOutcomeView> {
    const existing = this.requireRecord(input.commandId);
    const outcome: FrontendCommandOutcomeView = {
      ...existing.outcome,
      commandRevision: String(Number(existing.outcome.commandRevision) + 1),
      outcomeState: 'REJECTED',
      completionDisposition: 'FAILED',
      rejection: {
        code: input.code,
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
  ): Promise<FrontendCommandOutcomeView | null> {
    return this.byClientRequestId.get(`${principalId}:${clientRequestId}`)?.outcome ?? null;
  }

  private requireRecord(commandId: string): LedgerRecord {
    const record = this.byCommandId.get(commandId);
    if (!record) {
      throw new FrontendContractError('RESOURCE_RETIRED', `Command '${commandId}' not found.`);
    }
    return record;
  }

  private replaceOutcome(record: LedgerRecord, outcome: FrontendCommandOutcomeView): void {
    const replacement = { principalId: record.principalId, outcome };
    this.byCommandId.set(outcome.commandId, replacement);
    this.byClientRequestId.set(`${record.principalId}:${outcome.clientRequestId}`, replacement);
    for (const [key, value] of this.byIdempotencyScope.entries()) {
      if (value.outcome.commandId === outcome.commandId) {
        this.byIdempotencyScope.set(key, replacement);
      }
    }
  }
}
