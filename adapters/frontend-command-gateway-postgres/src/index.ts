import type { Pool, PoolClient } from 'pg';

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
import { withSafePostgresTransaction } from '../../../packages/postgres-transaction/src/index.js';

type CommandLedgerRow = {
  command_id: string;
  command_revision: string;
  client_request_id: string;
  idempotency_key: string;
  principal_id: string;
  envelope_version: '1.0.0' | '2.0.0';
  scope_kind: 'PRINCIPAL' | 'PROJECT' | 'RESOURCE';
  active_project_id: string | null;
  target_project_id: string | null;
  scope_binding_key: string;
  command_type: string;
  command_schema_version: string;
  command_semantic_digest: string;
  outcome_state: AnyFrontendCommandOutcomeView['outcomeState'];
  completion_disposition: AnyFrontendCommandOutcomeView['completionDisposition'] | null;
  accepted_principal_context: AnyFrontendCommandOutcomeView['acceptedPrincipalContext'];
  accepted_project_context: AnyFrontendCommandOutcomeView['acceptedProjectContext'];
  accepted_policy_context: AnyFrontendCommandOutcomeView['acceptedPolicyContext'];
  preconditions: readonly {
    readonly subject: { readonly resourceKind: string; readonly resourceId: string };
  }[];
  produced_resources: AnyFrontendCommandOutcomeView['producedResources'];
  rejection: AnyFrontendCommandOutcomeView['rejection'] | null;
  correlation_id: string;
  trace_id: string;
  received_at: Date;
  accepted_at: Date | null;
  completed_at: Date | null;
  last_updated_at: Date;
};

const toOutcome = (row: CommandLedgerRow): AnyFrontendCommandOutcomeView =>
  ({
    commandId: row.command_id,
    commandRevision: String(row.command_revision),
    clientRequestId: row.client_request_id,
    idempotencyKey: row.idempotency_key,
    commandType: row.command_type,
    commandSchemaVersion: row.command_schema_version,
    commandSemanticDigest: row.command_semantic_digest,
    outcomeState: row.outcome_state,
    ...(row.completion_disposition ? { completionDisposition: row.completion_disposition } : {}),
    acceptedPrincipalContext: row.accepted_principal_context,
    acceptedProjectContext: row.accepted_project_context,
    acceptedPolicyContext: row.accepted_policy_context,
    correlationId: row.correlation_id,
    traceId: row.trace_id,
    producedResources: row.produced_resources,
    ...(row.rejection ? { rejection: row.rejection } : {}),
    receivedAt: row.received_at.toISOString(),
    ...(row.accepted_at ? { acceptedAt: row.accepted_at.toISOString() } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at.toISOString() } : {}),
    lastUpdatedAt: row.last_updated_at.toISOString(),
  }) as AnyFrontendCommandOutcomeView;

export class PostgresFrontendCommandGateway implements FrontendCommandGatewayPort {
  constructor(private readonly pool: Pool) {}

  async accept(input: AcceptFrontendCommandInput): Promise<AcceptFrontendCommandResult> {
    const scope =
      input.request.envelopeVersion === '1.0.0'
        ? {
            envelopeVersion: '1.0.0' as const,
            scopeKind: 'PROJECT' as const,
            activeProjectId: input.request.projectContext.activeProjectId,
            targetProjectId: input.request.projectContext.targetProjectId,
            resourceProjectId: input.request.projectContext.resourceProjectId ?? null,
          }
        : {
            envelopeVersion: '2.0.0' as const,
            scopeKind: input.request.projectContext.scope,
            activeProjectId:
              input.request.projectContext.scope === 'PRINCIPAL'
                ? null
                : input.request.projectContext.activeProjectId,
            targetProjectId:
              input.request.projectContext.scope === 'PRINCIPAL'
                ? null
                : input.request.projectContext.targetProjectId,
            resourceProjectId:
              input.request.projectContext.scope === 'RESOURCE'
                ? input.request.projectContext.resourceProjectId
                : null,
          };
    const scopeBindingKey = frontendCommandScopeBindingKey(input.request);
    return withSafePostgresTransaction(
      this.pool,
      async (client) => {
        const existing = await client.query<CommandLedgerRow>(
          `SELECT *
         FROM frontend_command.command_ledger
         WHERE (principal_id = $1 AND client_request_id = $2)
            OR (
              principal_id = $1
              AND envelope_version = $3
              AND scope_kind = $4
              AND scope_binding_key = $5
              AND command_type = $6
              AND command_schema_version = $7
              AND idempotency_key = $8
            )
         FOR UPDATE`,
          [
            input.principalId,
            input.request.clientRequestId,
            scope.envelopeVersion,
            scope.scopeKind,
            scopeBindingKey,
            input.request.commandType,
            input.request.commandSchemaVersion,
            input.request.idempotencyKey,
          ],
        );
        if (existing.rows[0]) {
          const outcome = toOutcome(existing.rows[0]);
          if (outcome.clientRequestId === input.request.clientRequestId) {
            if (
              existing.rows[0].envelope_version !== scope.envelopeVersion ||
              existing.rows[0].scope_kind !== scope.scopeKind ||
              existing.rows[0].scope_binding_key !== scopeBindingKey ||
              outcome.commandType !== input.request.commandType ||
              outcome.commandSchemaVersion !== input.request.commandSchemaVersion ||
              outcome.commandSemanticDigest !== input.commandSemanticDigest
            ) {
              throw new FrontendContractError(
                input.request.envelopeVersion === '2.0.0'
                  ? 'CLIENT_REQUEST_MEANING_MISMATCH'
                  : 'IDEMPOTENCY_KEY_REUSE_MISMATCH',
                'clientRequestId cannot be rebound to different command meaning.',
              );
            }
          }
          if (outcome.idempotencyKey !== input.request.idempotencyKey) {
            throw new FrontendContractError(
              'IDEMPOTENCY_KEY_REUSE_MISMATCH',
              'clientRequestId cannot be rebound to a different idempotency key.',
            );
          }
          if (outcome.commandSemanticDigest !== input.commandSemanticDigest) {
            throw new FrontendContractError(
              'IDEMPOTENCY_KEY_REUSE_MISMATCH',
              'Existing frontend command has a different semantic digest.',
            );
          }
          return { outcome, replayed: true };
        }

        const outcome = createAcceptedFrontendCommandOutcome(input);
        await client.query(
          `INSERT INTO frontend_command.command_ledger (
          command_id, command_revision, client_request_id, idempotency_key,
          principal_id, envelope_version, scope_kind, active_project_id,
          target_project_id, resource_project_id, scope_binding_key, command_type,
          command_schema_version, command_semantic_digest, policy_binding,
          accepted_principal_context, accepted_project_context, accepted_policy_context,
          preconditions, command_payload, outcome_state, completion_disposition,
          produced_resources, rejection, correlation_id, trace_id, received_at,
          accepted_at, completed_at, last_updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15::jsonb, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb,
          $21, $22, $23::jsonb, $24::jsonb, $25, $26, $27, $28, $29, $30
        )`,
          [
            outcome.commandId,
            Number(outcome.commandRevision),
            outcome.clientRequestId,
            outcome.idempotencyKey,
            input.principalId,
            scope.envelopeVersion,
            scope.scopeKind,
            scope.activeProjectId,
            scope.targetProjectId,
            scope.resourceProjectId,
            scopeBindingKey,
            outcome.commandType,
            outcome.commandSchemaVersion,
            outcome.commandSemanticDigest,
            JSON.stringify(input.request.policyBinding),
            JSON.stringify(outcome.acceptedPrincipalContext),
            JSON.stringify(outcome.acceptedProjectContext),
            JSON.stringify(outcome.acceptedPolicyContext),
            JSON.stringify(input.request.preconditions),
            JSON.stringify(input.request.payload),
            outcome.outcomeState,
            outcome.completionDisposition ?? null,
            JSON.stringify(outcome.producedResources),
            outcome.rejection ? JSON.stringify(outcome.rejection) : null,
            outcome.correlationId,
            outcome.traceId,
            outcome.receivedAt,
            outcome.acceptedAt ?? null,
            outcome.completedAt ?? null,
            outcome.lastUpdatedAt,
          ],
        );
        return { outcome, replayed: false };
      },
      {
        module: 'frontend-command-gateway-postgres',
        operation: 'accept-command',
      },
    );
  }

  async lockAcceptedForExecution(
    transaction: unknown,
    commandId: string,
  ): Promise<AnyFrontendCommandOutcomeView> {
    const client = transaction as PoolClient;
    const result = await client.query<CommandLedgerRow>(
      'SELECT * FROM frontend_command.command_ledger WHERE command_id = $1 FOR UPDATE',
      [commandId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new FrontendContractError('RESOURCE_RETIRED', `Command '${commandId}' not found.`);
    }
    const outcome = toOutcome(row);
    if (outcome.outcomeState !== 'ACCEPTED' && outcome.outcomeState !== 'COMPLETED') {
      throw new FrontendContractError(
        'RESOURCE_RETIRED',
        `Command '${commandId}' is not executable from state '${outcome.outcomeState}'.`,
      );
    }
    return outcome;
  }

  async completeInTransaction(
    transaction: unknown,
    input: CompleteFrontendCommandInput,
  ): Promise<AnyFrontendCommandOutcomeView> {
    return this.completeWithClient(transaction as PoolClient, input);
  }

  async complete(input: CompleteFrontendCommandInput): Promise<AnyFrontendCommandOutcomeView> {
    return withSafePostgresTransaction(
      this.pool,
      (client) => this.completeWithClient(client, input),
      {
        module: 'frontend-command-gateway-postgres',
        operation: 'complete-command',
      },
    );
  }

  async reject(input: RejectFrontendCommandInput): Promise<AnyFrontendCommandOutcomeView> {
    if (!isErrorCode(input.code)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'Frontend Command Ledger rejection code must be registered.',
      );
    }
    const descriptor = getFailureDescriptor(input.code);
    const result = await this.pool.query<CommandLedgerRow>(
      `UPDATE frontend_command.command_ledger
       SET command_revision = command_revision + 1,
           outcome_state = 'REJECTED',
           completion_disposition = 'FAILED',
           rejection = $2::jsonb,
           completed_at = $3,
           last_updated_at = $3
       WHERE command_id = $1
         AND outcome_state = 'ACCEPTED'
       RETURNING *`,
      [
        input.commandId,
        JSON.stringify({
          code: input.code,
          message: input.message,
          category: descriptor.category,
          retryability: descriptor.retryability,
          recovery: descriptor.recovery,
          retryable: descriptor.retryability === 'SAFE',
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        }),
        input.completedAt,
      ],
    );
    if (result.rows[0]) return toOutcome(result.rows[0]);
    return this.findByCommandId(input.commandId);
  }

  async markOutcomeUnknown(
    input: ResolveFrontendCommandOutcomeUnknownInput,
  ): Promise<AnyFrontendCommandOutcomeView> {
    const descriptor = getFailureDescriptor('OUTCOME_UNKNOWN');
    const result = await this.pool.query<CommandLedgerRow>(
      `UPDATE frontend_command.command_ledger
       SET command_revision = command_revision + 1,
           outcome_state = 'OUTCOME_UNKNOWN',
           completion_disposition = 'PARTIAL',
           rejection = $2::jsonb,
           completed_at = $3,
           last_updated_at = $3
       WHERE command_id = $1
         AND outcome_state = 'ACCEPTED'
       RETURNING *`,
      [
        input.commandId,
        JSON.stringify({
          code: 'OUTCOME_UNKNOWN',
          message: input.message,
          category: descriptor.category,
          retryability: descriptor.retryability,
          recovery: descriptor.recovery,
          retryable: false,
        }),
        input.completedAt,
      ],
    );
    if (result.rows[0]) return toOutcome(result.rows[0]);
    return this.findByCommandId(input.commandId);
  }

  async findByClientRequestId(
    principalId: string,
    clientRequestId: string,
    binding?: FrontendCommandResourceBinding,
  ): Promise<AnyFrontendCommandOutcomeView | null> {
    const result = await this.pool.query<CommandLedgerRow>(
      `SELECT *
       FROM frontend_command.command_ledger
       WHERE principal_id = $1 AND client_request_id = $2`,
      [principalId, clientRequestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (
      binding &&
      ((binding.commandTypes && !binding.commandTypes.includes(row.command_type)) ||
        !row.preconditions.some(
          (precondition) =>
            precondition.subject.resourceKind === binding.resourceKind &&
            precondition.subject.resourceId === binding.resourceId,
        ))
    ) {
      return null;
    }
    return toOutcome(row);
  }

  private async completeWithClient(
    client: PoolClient,
    input: CompleteFrontendCommandInput,
  ): Promise<AnyFrontendCommandOutcomeView> {
    const result = await client.query<CommandLedgerRow>(
      `UPDATE frontend_command.command_ledger
       SET command_revision = command_revision + 1,
           outcome_state = 'COMPLETED',
           completion_disposition = 'SUCCEEDED',
           produced_resources = $2::jsonb,
           completed_at = $3,
           last_updated_at = $3
       WHERE command_id = $1
         AND outcome_state = 'ACCEPTED'
       RETURNING *`,
      [input.commandId, JSON.stringify(input.producedResources), input.completedAt],
    );
    if (result.rows[0]) return toOutcome(result.rows[0]);

    const existing = await client.query<CommandLedgerRow>(
      'SELECT * FROM frontend_command.command_ledger WHERE command_id = $1',
      [input.commandId],
    );
    if (!existing.rows[0]) {
      throw new FrontendContractError(
        'RESOURCE_RETIRED',
        `Command '${input.commandId}' not found.`,
      );
    }
    return toOutcome(existing.rows[0]);
  }

  private async findByCommandId(commandId: string): Promise<AnyFrontendCommandOutcomeView> {
    const result = await this.pool.query<CommandLedgerRow>(
      'SELECT * FROM frontend_command.command_ledger WHERE command_id = $1',
      [commandId],
    );
    if (!result.rows[0]) {
      throw new FrontendContractError('RESOURCE_RETIRED', `Command '${commandId}' not found.`);
    }
    return toOutcome(result.rows[0]);
  }
}
