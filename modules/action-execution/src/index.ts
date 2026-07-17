import { randomUUID } from 'node:crypto';

import type {
  ActionApprovalToken,
  ActionAuditCategory,
  ActionAuditEvent,
  ActionExecutionRecord,
  ActionFeedback,
  ActionPreview,
  ActionVerification,
  CommandEnvelope,
  ProviderActionResult,
  QueryEnvelope,
  ValidatedActionCandidate,
} from '../../../packages/contracts/src/index.js';
import {
  actionCandidateDigest,
  actionParameterDigest,
  actionPreviewDigest,
  actionTargetDigest,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type { ShotgunModule } from '../../../packages/module-sdk/src/index.js';
import {
  ACTION_RISK_POLICY_VERSION,
  decideActionRisk,
} from '../../../packages/policy/src/index.js';

export type ActionClockPort = { now(): string };
const systemClock: ActionClockPort = { now: () => new Date().toISOString() };

export type ActionConnectorIdentity = {
  readonly id: string;
  readonly version: string;
  readonly provider: string;
  readonly secretBoundary: 'ADAPTER_INTERNAL';
};

export type ActionPreflightResult =
  | { readonly status: 'READY' }
  | { readonly status: 'ALREADY_APPLIED'; readonly providerResult: ProviderActionResult }
  | { readonly status: 'DENIED'; readonly reason: string };

export type ActionConnectorPort = {
  readonly identity: ActionConnectorIdentity;
  preflight(preview: ActionPreview, idempotencyKey: string): Promise<ActionPreflightResult>;
  execute(preview: ActionPreview, idempotencyKey: string): Promise<ProviderActionResult>;
  verify(
    preview: ActionPreview,
    idempotencyKey: string,
    providerResult?: ProviderActionResult,
  ): Promise<Omit<ActionVerification, 'verifiedAt'>>;
};

export type ActionTransition = {
  readonly expectedStatus: ActionExecutionRecord['status'];
  readonly next: ActionExecutionRecord;
  readonly category: ActionAuditCategory;
  readonly actorId: string;
  readonly details: ActionAuditEvent['details'];
};

export type ActionExecutionRepositoryPort = {
  createPreview(
    record: ActionExecutionRecord,
    initialAudit: readonly Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>[],
  ): Promise<ActionExecutionRecord>;
  approve(
    projectId: string,
    actionId: string,
    expectedPreviewDigest: string,
    approval: ActionApprovalToken,
  ): Promise<ActionExecutionRecord>;
  claimForExecution(
    projectId: string,
    actionId: string,
    tokenId: string,
    now: string,
    actorId: string,
  ): Promise<{ readonly claimed: boolean; readonly record: ActionExecutionRecord }>;
  transition(
    projectId: string,
    actionId: string,
    transition: ActionTransition,
  ): Promise<ActionExecutionRecord>;
  find(projectId: string, actionId: string): Promise<ActionExecutionRecord | undefined>;
  listAudit(projectId: string, actionId: string): Promise<readonly ActionAuditEvent[]>;
};

const candidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'candidateId',
    'revisionNumber',
    'operation',
    'target',
    'parameters',
    'validation',
    'requestedAt',
  ],
  properties: {
    candidateId: { type: 'string', minLength: 1 },
    revisionNumber: { type: 'integer', minimum: 1 },
    operation: {
      enum: [
        'PREVIEW_ONLY',
        'CREATE_DRAFT',
        'UPDATE_REVERSIBLE',
        'PUBLISH_OR_DELETE',
        'FINANCIAL_OR_LEGAL',
      ],
    },
    target: {
      type: 'object',
      additionalProperties: false,
      required: ['connectorId', 'accountRef', 'destination'],
      properties: {
        connectorId: { type: 'string', minLength: 1 },
        accountRef: { type: 'string', minLength: 1 },
        destination: { type: 'string', minLength: 1 },
      },
    },
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'body'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 500 },
        body: { type: 'string', minLength: 1, maxLength: 100000 },
      },
    },
    validation: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'validationId', 'validatedAt', 'evidenceIds'],
      properties: {
        status: { const: 'VALIDATED' },
        validationId: { type: 'string', minLength: 1 },
        validatedAt: { type: 'string', minLength: 1 },
        evidenceIds: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { type: 'string', minLength: 1 },
        },
      },
    },
    requestedAt: { type: 'string', minLength: 1 },
    compensationForActionId: { type: 'string', minLength: 1 },
  },
};

const actionIdSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['actionId'],
  properties: { actionId: { type: 'string', minLength: 1 } },
};

const assertContext = (envelope: CommandEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'POLICY_DENIED',
      safeMessage: 'External Action requires complete security context.',
      module: 'stage11.action-execution',
      operation: envelope.messageType,
      correlationId: envelope.correlationId,
    });
  }
  return { projectId: envelope.projectId, actor: envelope.actor, security: envelope.security };
};

const audit = (
  record: ActionExecutionRecord,
  category: ActionAuditCategory,
  actorId: string,
  occurredAt: string,
  details: ActionAuditEvent['details'],
): Omit<ActionAuditEvent, 'auditEventId' | 'sequence'> => ({
  actionId: record.actionId,
  projectId: record.projectId,
  category,
  actorId,
  policyVersion: ACTION_RISK_POLICY_VERSION,
  details,
  occurredAt,
});

const addMilliseconds = (iso: string, milliseconds: number): string =>
  new Date(new Date(iso).getTime() + milliseconds).toISOString();

const executeIdempotencyKey = (record: ActionExecutionRecord): string =>
  `action:${record.actionId}:${record.preview.previewDigest}`;

export const createActionExecutionModule = (
  repository: ActionExecutionRepositoryPort,
  connector: ActionConnectorPort,
  clock: ActionClockPort = systemClock,
): ShotgunModule => ({
  manifest: {
    id: 'stage11.action-execution',
    version: '1.0.0',
    owner: 'Shotgun Risk-controlled External Action',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'PrepareActionPreview', range: '>=1.0.0 <2.0.0' },
        { name: 'ApproveActionPreview', range: '>=1.0.0 <2.0.0' },
        { name: 'ExecuteApprovedAction', range: '>=1.0.0 <2.0.0' },
        { name: 'VerifyActionOutcome', range: '>=1.0.0 <2.0.0' },
        { name: 'GetActionExecution', range: '>=1.0.0 <2.0.0' },
        { name: 'ListActionAudit', range: '>=1.0.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: ['action.executions', 'action.approvals', 'action.audit_events'],
      readsViaPorts: [connector.identity.id],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [
        { name: 'PrepareActionPreview', range: '>=1.0.0 <2.0.0' },
        { name: 'ApproveActionPreview', range: '>=1.0.0 <2.0.0' },
        { name: 'ExecuteApprovedAction', range: '>=1.0.0 <2.0.0' },
        { name: 'VerifyActionOutcome', range: '>=1.0.0 <2.0.0' },
      ],
      events: [],
    },
    produces: { events: [{ name: 'ActionFeedbackRecorded', range: '>=1.0.0 <2.0.0' }] },
    provides: {
      queries: [
        { name: 'GetActionExecution', range: '>=1.0.0 <2.0.0' },
        { name: 'ListActionAudit', range: '>=1.0.0 <2.0.0' },
      ],
      capabilities: [{ name: 'risk-controlled-external-action', priority: 100 }],
    },
    requires: { capabilities: [] },
    security: {
      requiredContext: ['actor', 'project', 'access_scope', 'sensitivity'],
      defaultOnMissingContext: 'deny',
    },
    approvalPolicy: { canWriteCanonical: false, canExecuteExternalAction: true },
  },
  contracts: [
    {
      name: 'PrepareActionPreview',
      version: '1.0.0',
      kind: 'command',
      inputSchema: candidateSchema,
    },
    {
      name: 'ApproveActionPreview',
      version: '1.0.0',
      kind: 'command',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['actionId', 'expectedPreviewDigest', 'expiresInMs'],
        properties: {
          actionId: { type: 'string', minLength: 1 },
          expectedPreviewDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
          expiresInMs: { type: 'integer', minimum: 1000, maximum: 86400000 },
        },
      },
    },
    {
      name: 'ExecuteApprovedAction',
      version: '1.0.0',
      kind: 'command',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['actionId', 'approvalTokenId'],
        properties: {
          actionId: { type: 'string', minLength: 1 },
          approvalTokenId: { type: 'string', minLength: 1 },
        },
      },
    },
    {
      name: 'VerifyActionOutcome',
      version: '1.0.0',
      kind: 'command',
      inputSchema: actionIdSchema,
    },
    { name: 'GetActionExecution', version: '1.0.0', kind: 'query', inputSchema: actionIdSchema },
    { name: 'ListActionAudit', version: '1.0.0', kind: 'query', inputSchema: actionIdSchema },
    {
      name: 'ActionFeedbackRecorded',
      version: '1.0.0',
      kind: 'event',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['actionId', 'status', 'reentryPhase', 'occurredAt'],
        properties: {
          actionId: { type: 'string', minLength: 1 },
          status: { enum: ['VERIFIED', 'OUTCOME_UNKNOWN', 'FAILED'] },
          reentryPhase: { const: 'ACTION_REVIEW' },
          occurredAt: { type: 'string', minLength: 1 },
        },
      },
    },
  ],
  handlers: {
    commands: [
      {
        messageType: 'PrepareActionPreview',
        version: '1.0.0',
        requiredAccessScopes: ['action:candidate:stage'],
        async handle(envelope) {
          const { projectId, actor, security } = assertContext(envelope);
          const candidate = envelope.payload as ValidatedActionCandidate;
          const createdAt = clock.now();
          const riskDecision = decideActionRisk({
            operation: candidate.operation,
            sensitivity: security.sensitivity,
            compensation: Boolean(candidate.compensationForActionId),
          });
          const preview: ActionPreview = {
            actionId: randomUUID(),
            projectId,
            candidate,
            candidateDigest: actionCandidateDigest(candidate),
            targetDigest: actionTargetDigest(candidate),
            parameterDigest: actionParameterDigest(candidate),
            previewDigest: actionPreviewDigest(candidate, riskDecision),
            riskDecision,
            createdAt,
          };
          const record: ActionExecutionRecord = {
            actionId: preview.actionId,
            projectId,
            status: 'PREVIEW_READY',
            preview,
            canonicalWrite: false,
            createdAt,
            updatedAt: createdAt,
          };
          return repository.createPreview(record, [
            audit(record, 'ACTION_CANDIDATE_VALIDATED', actor.id, createdAt, {
              candidateId: candidate.candidateId,
              candidateRevision: candidate.revisionNumber,
              validationId: candidate.validation.validationId,
              compensation: Boolean(candidate.compensationForActionId),
            }),
            audit(record, 'ACTION_RISK_DECIDED', actor.id, createdAt, {
              riskLevel: riskDecision.level,
              requiresUserApproval: riskDecision.requiresUserApproval,
            }),
            audit(record, 'ACTION_PREVIEW_READY', actor.id, createdAt, {
              previewDigest: preview.previewDigest,
              targetDigest: preview.targetDigest,
              parameterDigest: preview.parameterDigest,
            }),
          ]);
        },
      },
      {
        messageType: 'ApproveActionPreview',
        version: '1.0.0',
        requiredAccessScopes: ['action:approve'],
        async handle(envelope) {
          const { projectId, actor } = assertContext(envelope);
          if (actor.type !== 'user') {
            throw new ShotgunError({
              code: 'POLICY_DENIED',
              safeMessage: 'Only a user can approve an external Action.',
              module: 'stage11.action-execution',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          }
          const payload = envelope.payload as {
            actionId: string;
            expectedPreviewDigest: string;
            expiresInMs: number;
          };
          const approvedAt = clock.now();
          const current = await repository.find(projectId, payload.actionId);
          if (!current) throw notFound(payload.actionId, envelope.correlationId);
          const approval: ActionApprovalToken = {
            tokenId: randomUUID(),
            actionId: current.actionId,
            candidateRevision: current.preview.candidate.revisionNumber,
            targetDigest: current.preview.targetDigest,
            parameterDigest: current.preview.parameterDigest,
            previewDigest: payload.expectedPreviewDigest,
            approvedBy: actor,
            approvedAt,
            expiresAt: addMilliseconds(approvedAt, payload.expiresInMs),
          };
          return repository.approve(
            projectId,
            payload.actionId,
            payload.expectedPreviewDigest,
            approval,
          );
        },
      },
      {
        messageType: 'ExecuteApprovedAction',
        version: '1.0.0',
        requiredAccessScopes: ['action:execute'],
        async handle(envelope, context) {
          const { projectId, actor } = assertContext(envelope);
          const payload = envelope.payload as { actionId: string; approvalTokenId: string };
          const claimed = await repository.claimForExecution(
            projectId,
            payload.actionId,
            payload.approvalTokenId,
            clock.now(),
            actor.id,
          );
          if (!claimed.claimed) return claimed.record;

          const key = executeIdempotencyKey(claimed.record);
          const preflight = await connector.preflight(claimed.record.preview, key);
          if (preflight.status === 'DENIED') {
            return repository.transition(projectId, payload.actionId, {
              expectedStatus: 'EXECUTING',
              next: {
                ...claimed.record,
                status: 'PREFLIGHT_FAILED',
                failureReason: preflight.reason,
                updatedAt: clock.now(),
              },
              category: 'ACTION_PREFLIGHT_FAILED',
              actorId: actor.id,
              details: { reason: preflight.reason },
            });
          }

          const preflightAt = clock.now();
          let current = await repository.transition(projectId, payload.actionId, {
            expectedStatus: 'EXECUTING',
            next: { ...claimed.record, updatedAt: preflightAt },
            category: 'ACTION_PREFLIGHT_PASSED',
            actorId: actor.id,
            details: {
              connectorId: connector.identity.id,
              duplicate: preflight.status === 'ALREADY_APPLIED',
            },
          });

          try {
            const providerResult =
              preflight.status === 'ALREADY_APPLIED'
                ? preflight.providerResult
                : await connector.execute(current.preview, key);
            const executedAt = clock.now();
            current = await repository.transition(projectId, payload.actionId, {
              expectedStatus: 'EXECUTING',
              next: {
                ...current,
                status: 'EXECUTED',
                providerResult,
                updatedAt: executedAt,
              },
              category: 'ACTION_EXECUTED',
              actorId: actor.id,
              details: {
                provider: providerResult.provider,
                externalId: providerResult.externalId,
                observedDigest: providerResult.observedDigest,
              },
            });
          } catch (error) {
            const unknown = error instanceof ShotgunError && error.code === 'OUTCOME_UNKNOWN';
            const failedAt = clock.now();
            const failed = await repository.transition(projectId, payload.actionId, {
              expectedStatus: 'EXECUTING',
              next: {
                ...current,
                status: unknown ? 'OUTCOME_UNKNOWN' : 'FAILED',
                failureReason: unknown
                  ? 'Provider response was lost; automatic execution retry is forbidden.'
                  : 'Provider rejected the Action before a confirmed result.',
                updatedAt: failedAt,
              },
              category: unknown ? 'ACTION_OUTCOME_UNKNOWN' : 'ACTION_FAILED',
              actorId: actor.id,
              details: { automaticRetry: false },
            });
            await publishFeedback(context, failed, failedAt);
            return failed;
          }

          return verifyRecord(repository, connector, current, actor.id, clock, context);
        },
      },
      {
        messageType: 'VerifyActionOutcome',
        version: '1.0.0',
        requiredAccessScopes: ['action:verify'],
        async handle(envelope, context) {
          const { projectId, actor } = assertContext(envelope);
          const { actionId } = envelope.payload as { actionId: string };
          const current = await repository.find(projectId, actionId);
          if (!current) throw notFound(actionId, envelope.correlationId);
          if (
            !['EXECUTED', 'OUTCOME_UNKNOWN', 'VERIFICATION_FAILED', 'VERIFIED'].includes(
              current.status,
            )
          ) {
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: `Action '${actionId}' is not ready for provider verification.`,
              module: 'stage11.action-execution',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          }
          if (current.status === 'VERIFIED') return current;
          return verifyRecord(repository, connector, current, actor.id, clock, context);
        },
      },
    ],
    events: [],
    queries: [
      {
        messageType: 'GetActionExecution',
        version: '1.0.0',
        requiredAccessScopes: ['action:read'],
        async handle(envelope) {
          const { projectId } = assertContext(envelope);
          const { actionId } = envelope.payload as { actionId: string };
          const record = await repository.find(projectId, actionId);
          if (!record) throw notFound(actionId, envelope.correlationId);
          return record;
        },
      },
      {
        messageType: 'ListActionAudit',
        version: '1.0.0',
        requiredAccessScopes: ['action:audit:read'],
        async handle(envelope) {
          const { projectId } = assertContext(envelope);
          const { actionId } = envelope.payload as { actionId: string };
          return { items: await repository.listAudit(projectId, actionId) };
        },
      },
    ],
  },
});

const notFound = (actionId: string, correlationId?: string): ShotgunError =>
  new ShotgunError({
    code: 'NOT_FOUND',
    safeMessage: `Action '${actionId}' was not found in this project.`,
    module: 'stage11.action-execution',
    operation: 'find-action',
    correlationId,
  });

const publishFeedback = async (
  context: Parameters<NonNullable<ShotgunModule['handlers']['commands'][number]['handle']>>[1],
  record: ActionExecutionRecord,
  occurredAt: string,
): Promise<void> => {
  const status: ActionFeedback['status'] =
    record.status === 'VERIFIED'
      ? 'VERIFIED'
      : record.status === 'OUTCOME_UNKNOWN'
        ? 'OUTCOME_UNKNOWN'
        : 'FAILED';
  await context.publish<ActionFeedback>({
    messageType: 'ActionFeedbackRecorded',
    schemaVersion: '1.0.0',
    idempotencyKey: `action-feedback:${record.actionId}:${status}`,
    payload: { actionId: record.actionId, status, reentryPhase: 'ACTION_REVIEW', occurredAt },
  });
};

const verifyRecord = async (
  repository: ActionExecutionRepositoryPort,
  connector: ActionConnectorPort,
  current: ActionExecutionRecord,
  actorId: string,
  clock: ActionClockPort,
  context: Parameters<NonNullable<ShotgunModule['handlers']['commands'][number]['handle']>>[1],
): Promise<ActionExecutionRecord> => {
  const verifiedAt = clock.now();
  const verification = await connector.verify(
    current.preview,
    executeIdempotencyKey(current),
    current.providerResult,
  );
  const applied = verification.status === 'APPLIED';
  const next = await repository.transition(current.projectId, current.actionId, {
    expectedStatus: current.status,
    next: {
      ...current,
      status: applied ? 'VERIFIED' : 'VERIFICATION_FAILED',
      verification: { ...verification, verifiedAt },
      failureReason: applied ? undefined : `Provider verification returned ${verification.status}.`,
      updatedAt: verifiedAt,
    },
    category: applied ? 'ACTION_VERIFIED' : 'ACTION_VERIFICATION_FAILED',
    actorId,
    details: {
      provider: verification.provider,
      verificationStatus: verification.status,
      observedDigest: verification.observedDigest ?? 'none',
    },
  });
  await publishFeedback(context, next, verifiedAt);
  return next;
};
