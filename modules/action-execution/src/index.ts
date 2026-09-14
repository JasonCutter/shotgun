import { randomUUID } from 'node:crypto';

import type {
  ActionApprovalRecord,
  ActionAuditCategory,
  ActionAuditEvent,
  ActionExecutionRecord,
  ActionExecutionStatus,
  ActionFeedback,
  ActionPreview,
  ActionVerification,
  CommandEnvelope,
  ProviderActionResult,
  QueryEnvelope,
  ServerActionCandidate,
  SecurityContext,
} from '../../../packages/contracts/src/index.js';
import {
  actionCandidateDigest,
  actionEvidenceSetDigest,
  actionParameterDigest,
  actionPayloadDigest,
  actionPreviewDigest,
  actionTargetDigest,
  createCommand,
  ShotgunError,
} from '../../../packages/contracts/src/index.js';
import type {
  HandlerContext,
  PublishEventInput,
  ShotgunModule,
} from '../../../packages/module-sdk/src/index.js';
import {
  ACTION_RISK_POLICY_VERSION,
  decideActionRisk,
} from '../../../packages/policy/src/index.js';

export type ActionClockPort = { now(): string };
const systemClock: ActionClockPort = { now: () => new Date().toISOString() };
const previewLifetimeMs = 15 * 60 * 1000;

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

export type ActionCandidateRepositoryPort = {
  find(projectId: string, candidateId: string): Promise<ServerActionCandidate | undefined>;
};

export type ActionBindingReference = {
  readonly projectId: string;
  readonly actionCandidateId: string;
  readonly validationId: string;
  readonly expectedCandidateRevision: number;
  readonly evidenceIds: readonly string[];
};

export type CurrentActionBinding = {
  readonly validation: {
    readonly validationId: string;
    readonly candidateId: string;
    readonly revisionNumber: number;
    readonly sourceVersionId: string;
    readonly status: string;
    readonly digest: string;
  };
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly sourceId: string;
    readonly sourceVersionId: string;
    readonly exactHash: string;
    readonly sensitivity: SecurityContext['sensitivity'];
    readonly digest: string;
  }[];
  readonly evidenceSetDigest: string;
  readonly sourceVersionId: string;
  readonly sourceSensitivity: SecurityContext['sensitivity'];
};

export type IndependentVerificationPort = {
  resolveCurrentBinding(
    reference: ActionBindingReference,
  ): Promise<CurrentActionBinding | undefined>;
};

export type ActionFeedbackStatus = ActionFeedback['status'];

export type ActionFeedbackIntent = {
  readonly projectId: string;
  readonly actionId: string;
  readonly semanticKey: string;
  readonly status: ActionFeedbackStatus;
  readonly reentryPhase: 'ACTION_REVIEW';
  readonly occurredAt: string;
  /** The exact Action.updatedAt value written by the transition. */
  readonly sourceUpdatedAt: string;
  readonly schemaVersion: '1.0.0';
  readonly payload: ActionFeedback;
};

export type ActionFeedbackOutboxRecord = {
  readonly outboxId: string;
  readonly projectId: string;
  readonly actionId: string;
  readonly semanticKey: string;
  readonly status: 'pending' | 'processing' | 'published';
  readonly feedbackStatus: ActionFeedbackStatus;
  readonly reentryPhase: 'ACTION_REVIEW';
  readonly schemaVersion: '1.0.0';
  readonly payload: ActionFeedback;
  readonly occurredAt: string;
  readonly sourceUpdatedAt: string;
  readonly attempts: number;
  readonly availableAt: string;
  readonly claimedAt?: string;
  readonly publishedAt?: string;
  readonly lastError?: string;
};

export type ActionFeedbackOutboxRepositoryPort = {
  listFeedbackOutboxProjectIds(): Promise<readonly string[]>;
  findFeedbackOutbox(
    projectId: string,
    semanticKey: string,
  ): Promise<ActionFeedbackOutboxRecord | undefined>;
  claimFeedbackOutbox(
    projectId: string,
    semanticKey: string | undefined,
    limit: number,
    claimedAt: string,
    staleBefore: string,
  ): Promise<readonly ActionFeedbackOutboxRecord[]>;
  markFeedbackOutboxPublished(
    projectId: string,
    outboxId: string,
    attempt: number,
    publishedAt: string,
    expected?: Pick<
      ActionFeedbackOutboxRecord,
      'actionId' | 'semanticKey' | 'payload' | 'sourceUpdatedAt'
    >,
  ): Promise<void>;
  releaseFeedbackOutbox(
    projectId: string,
    outboxId: string,
    attempt: number,
    error: string,
  ): Promise<void>;
  backfillFeedbackOutbox(limit: number, now: string): Promise<number>;
};

export type ActionTransition = {
  readonly expectedStatus: ActionExecutionRecord['status'];
  /** Optional exact optimistic-concurrency value checked after the repository locks the row. */
  readonly expectedUpdatedAt?: string;
  readonly next: ActionExecutionRecord;
  readonly category: ActionAuditCategory;
  readonly actorId: string;
  readonly details: ActionAuditEvent['details'];
  readonly feedbackIntent?: ActionFeedbackIntent;
};

export type ActionExecutionRepositoryPort = ActionFeedbackOutboxRepositoryPort & {
  createPreview(
    record: ActionExecutionRecord,
    initialAudit: readonly Omit<ActionAuditEvent, 'auditEventId' | 'sequence'>[],
  ): Promise<ActionExecutionRecord>;
  approve(
    projectId: string,
    actionId: string,
    expectedPreviewDigest: string,
    approval: ActionApprovalRecord,
  ): Promise<ActionExecutionRecord>;
  claimForExecution(
    projectId: string,
    approvalId: string,
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

const previewRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['candidateId', 'expectedRevision', 'operationKey'],
  properties: {
    candidateId: { type: 'string', minLength: 1 },
    expectedRevision: { type: 'integer', minimum: 1 },
    operationKey: {
      enum: [
        'PREVIEW_ONLY',
        'CREATE_DRAFT',
        'UPDATE_REVERSIBLE',
        'PUBLISH_OR_DELETE',
        'FINANCIAL_OR_LEGAL',
      ],
    },
  },
};
const approvalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['actionId', 'expectedPreviewDigest'],
  properties: {
    actionId: { type: 'string', minLength: 1 },
    expectedPreviewDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  },
};
const executeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['approvalId'],
  properties: { approvalId: { type: 'string', minLength: 1 } },
};
const reconcileExecutingSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['actionId', 'expectedUpdatedAt'],
  properties: {
    actionId: { type: 'string', minLength: 1 },
    expectedUpdatedAt: { type: 'string', minLength: 1 },
  },
};
const actionIdSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['actionId'],
  properties: { actionId: { type: 'string', minLength: 1 } },
};
const dispatchFeedbackOutboxSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['limit'],
  properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
};

const assertContext = (envelope: CommandEnvelope | QueryEnvelope) => {
  if (!envelope.projectId || !envelope.actor || !envelope.security) {
    throw new ShotgunError({
      code: 'ACTION_AUTHORIZATION_DENIED',
      safeMessage: 'External Action requires authenticated security context.',
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
const sensitivityRank = { public: 0, internal: 1, private: 2, restricted: 3 } as const;

export const actionFeedbackStatusForExecution = (
  status: ActionExecutionStatus,
): ActionFeedbackStatus | undefined => {
  switch (status) {
    case 'VERIFIED':
      return 'VERIFIED';
    case 'OUTCOME_UNKNOWN':
      return 'OUTCOME_UNKNOWN';
    case 'FAILED':
    case 'VERIFICATION_FAILED':
      return 'FAILED';
    default:
      return undefined;
  }
};

export const createActionFeedbackIntent = (
  record: ActionExecutionRecord,
): ActionFeedbackIntent | undefined => {
  const status = actionFeedbackStatusForExecution(record.status);
  if (status === undefined) return undefined;
  const semanticKey = `action-feedback:${record.actionId}:${status}`;
  return {
    projectId: record.projectId,
    actionId: record.actionId,
    semanticKey,
    status,
    reentryPhase: 'ACTION_REVIEW',
    occurredAt: record.updatedAt,
    sourceUpdatedAt: record.updatedAt,
    schemaVersion: '1.0.0',
    payload: {
      actionId: record.actionId,
      status,
      reentryPhase: 'ACTION_REVIEW',
      occurredAt: record.updatedAt,
    },
  };
};

const requireCandidate = async (
  repository: ActionCandidateRepositoryPort,
  projectId: string,
  candidateId: string,
  correlationId?: string,
): Promise<ServerActionCandidate> => {
  const candidate = await repository.find(projectId, candidateId);
  if (!candidate)
    throw new ShotgunError({
      code: 'ACTION_REFERENCE_NOT_FOUND',
      safeMessage: 'Action Candidate was not found in this project.',
      module: 'stage11.action-execution',
      operation: 'find-action-candidate',
      correlationId,
    });
  return candidate;
};

const assertCandidateMatchesSnapshot = (
  candidate: ServerActionCandidate,
  independent: {
    readonly validationDigest: string;
    readonly evidenceSetDigest: string;
    readonly sourceSensitivity: ServerActionCandidate['sourceSensitivity'];
  },
  preview: ActionPreview,
  clearance: keyof typeof sensitivityRank,
  correlationId?: string,
): void => {
  const currentDigest = actionCandidateDigest(candidate.candidate);
  if (
    candidate.candidate.revisionNumber !== preview.candidate.revisionNumber ||
    currentDigest !== preview.candidateDigest ||
    independent.validationDigest !== preview.validationDigest ||
    independent.evidenceSetDigest !== preview.evidenceSetDigest ||
    independent.sourceSensitivity !== preview.sourceSensitivity ||
    sensitivityRank[clearance] < sensitivityRank[independent.sourceSensitivity]
  ) {
    throw new ShotgunError({
      code: 'STALE_ACTION_SNAPSHOT',
      safeMessage: 'Action Candidate, evidence, validation, or sensitivity changed after Preview.',
      module: 'stage11.action-execution',
      operation: 'validate-action-snapshot',
      correlationId,
    });
  }
};

export const createActionExecutionModule = (
  repository: ActionExecutionRepositoryPort,
  candidateRepository: ActionCandidateRepositoryPort,
  independentVerification: IndependentVerificationPort,
  connector: ActionConnectorPort,
  clock: ActionClockPort = systemClock,
): ShotgunModule => ({
  manifest: {
    id: 'stage11.action-execution',
    version: '1.1.0',
    owner: 'Shotgun Risk-controlled External Action',
    compatibility: {
      runtime: '>=1.0.0 <2.0.0',
      contracts: [
        { name: 'PrepareActionPreview', range: '>=1.1.0 <2.0.0' },
        { name: 'ApproveActionPreview', range: '>=1.1.0 <2.0.0' },
        { name: 'ExecuteApprovedAction', range: '>=1.1.0 <2.0.0' },
        { name: 'VerifyActionOutcome', range: '>=1.1.0 <2.0.0' },
        { name: 'ReconcileExecutingAction', range: '>=1.1.0 <2.0.0' },
        { name: 'DispatchActionFeedbackOutbox', range: '>=1.1.0 <2.0.0' },
        { name: 'GetActionExecution', range: '>=1.1.0 <2.0.0' },
        { name: 'ListActionAudit', range: '>=1.1.0 <2.0.0' },
      ],
    },
    deployment: { modes: ['in_process', 'worker'] },
    dataOwnership: {
      owns: [
        'action.executions',
        'action.preview_snapshots',
        'action.approval_records',
        'action.audit_events',
        'action.action_feedback_outbox',
      ],
      readsViaPorts: [connector.identity.id, 'action-candidate-repository'],
      directSchemaAccess: false,
    },
    consumes: {
      commands: [
        { name: 'PrepareActionPreview', range: '>=1.1.0 <2.0.0' },
        { name: 'ApproveActionPreview', range: '>=1.1.0 <2.0.0' },
        { name: 'ExecuteApprovedAction', range: '>=1.1.0 <2.0.0' },
        { name: 'VerifyActionOutcome', range: '>=1.1.0 <2.0.0' },
        { name: 'ReconcileExecutingAction', range: '>=1.1.0 <2.0.0' },
        { name: 'DispatchActionFeedbackOutbox', range: '>=1.1.0 <2.0.0' },
      ],
      events: [],
    },
    produces: {
      events: [{ name: 'ActionFeedbackRecorded', range: '>=1.0.0 <2.0.0' }],
      handoffs: [
        {
          event: { name: 'ActionFeedbackRecorded', range: '>=1.0.0 <2.0.0' },
          target: { kind: 'consumer', moduleId: 'stage11.action-feedback-review' },
          tags: ['DURABLE_OUTBOX', 'RECONSTRUCTABLE', 'REQUIRED_ACK'],
          authority: 'stage11.action-execution.feedback-outbox',
          replayEvidence: {
            replaySource: 'action.action_feedback_outbox',
            deterministicIdentity: 'projectId:semanticKey',
            idempotencyEvidence: 'ActionFeedbackRecorded.idempotencyKey=semanticKey',
          },
        },
      ],
    },
    provides: {
      queries: [
        { name: 'GetActionExecution', range: '>=1.1.0 <2.0.0' },
        { name: 'ListActionAudit', range: '>=1.1.0 <2.0.0' },
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
      version: '1.1.0',
      kind: 'command',
      inputSchema: previewRequestSchema,
    },
    {
      name: 'ApproveActionPreview',
      version: '1.1.0',
      kind: 'command',
      inputSchema: approvalSchema,
    },
    {
      name: 'ExecuteApprovedAction',
      version: '1.1.0',
      kind: 'command',
      inputSchema: executeSchema,
    },
    { name: 'VerifyActionOutcome', version: '1.1.0', kind: 'command', inputSchema: actionIdSchema },
    {
      name: 'ReconcileExecutingAction',
      version: '1.1.0',
      kind: 'command',
      inputSchema: reconcileExecutingSchema,
    },
    {
      name: 'DispatchActionFeedbackOutbox',
      version: '1.1.0',
      kind: 'command',
      inputSchema: dispatchFeedbackOutboxSchema,
    },
    { name: 'GetActionExecution', version: '1.1.0', kind: 'query', inputSchema: actionIdSchema },
    { name: 'ListActionAudit', version: '1.1.0', kind: 'query', inputSchema: actionIdSchema },
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
        messageType: 'DispatchActionFeedbackOutbox',
        version: '1.1.0',
        requiredAccessScopes: ['owner'],
        async handle(envelope, context) {
          const { projectId } = assertContext(envelope);
          const payload = envelope.payload as { readonly limit: number };
          return {
            published: await dispatchActionFeedbackOutbox(
              repository,
              context,
              projectId,
              payload.limit,
              clock.now(),
            ),
          };
        },
      },
      {
        messageType: 'PrepareActionPreview',
        version: '1.1.0',
        requiredAccessScopes: ['action:candidate:stage'],
        async handle(envelope) {
          const { projectId, actor, security } = assertContext(envelope);
          const request = envelope.payload as {
            candidateId: string;
            expectedRevision: number;
            operationKey: ActionPreview['operationKey'];
          };
          const staged = await requireCandidate(
            candidateRepository,
            projectId,
            request.candidateId,
            envelope.correlationId,
          );
          if (
            staged.candidate.revisionNumber !== request.expectedRevision ||
            !staged.allowedOperationKeys.includes(request.operationKey) ||
            staged.candidate.operation !== request.operationKey ||
            staged.candidate.target.connectorId !== connector.identity.id
          ) {
            throw new ShotgunError({
              code: 'STALE_ACTION_SNAPSHOT',
              safeMessage: 'Action Candidate revision or allowed operation is no longer current.',
              module: 'stage11.action-execution',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          }
          if (sensitivityRank[security.sensitivity] < sensitivityRank[staged.sourceSensitivity]) {
            throw new ShotgunError({
              code: 'ACTION_AUTHORIZATION_DENIED',
              safeMessage: 'Source sensitivity exceeds the authenticated clearance.',
              module: 'stage11.action-execution',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          }
          const createdAt = clock.now();
          const candidateDigest = actionCandidateDigest(staged.candidate);
          const evidence = [...staged.evidence].sort((left, right) =>
            left.evidenceId.localeCompare(right.evidenceId),
          );
          const riskDecision = decideActionRisk({
            operation: request.operationKey,
            sensitivity: staged.sourceSensitivity,
            compensation: Boolean(staged.candidate.compensationForActionId),
          });
          const independent = await independentVerification.resolveCurrentBinding({
            projectId,
            actionCandidateId: request.candidateId,
            validationId: staged.candidate.validation.validationId,
            expectedCandidateRevision: request.expectedRevision,
            evidenceIds: evidence.map((e) => e.evidenceId),
          });
          if (!independent) {
            throw new ShotgunError({
              code: 'STALE_ACTION_SNAPSHOT',
              safeMessage:
                'Candidate data no longer matches the authoritative Validation, Evidence, Source, or Transformation records.',
              module: 'stage11.action-execution',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          }
          if (
            staged.validationDigest !== independent.validation.digest ||
            actionEvidenceSetDigest(evidence) !== independent.evidenceSetDigest ||
            staged.sourceSensitivity !== independent.sourceSensitivity
          ) {
            throw new ShotgunError({
              code: 'STALE_ACTION_SNAPSHOT',
              safeMessage:
                'Candidate data no longer matches the authoritative Validation, Evidence, Source, or Transformation records.',
              module: 'stage11.action-execution',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          }
          const snapshotBase = {
            actionId: randomUUID(),
            snapshotId: randomUUID(),
            snapshotSchemaVersion: 'action-preview-snapshot-v1' as const,
            canonicalSerializer: 'action-preview-canonical-v1' as const,
            hashAlgorithm: 'SHA-256' as const,
            projectId,
            candidate: staged.candidate,
            candidateDigest,
            validationDigest: independent.validation.digest,
            evidence,
            evidenceSetDigest: independent.evidenceSetDigest,
            sourceSensitivity: independent.sourceSensitivity,
            targetDigest: actionTargetDigest(staged.candidate),
            parameterDigest: actionParameterDigest(staged.candidate),
            renderedPayload: { ...staged.candidate.parameters },
            payloadDigest: actionPayloadDigest(staged.candidate.parameters),
            connectorId: connector.identity.id,
            operationKey: request.operationKey,
            riskDecision,
            approvalPolicy: {
              approvalPolicyVersion: 'stage11.action-approval.v1',
              requiredApproverRule: 'authenticated-user-with-action:approve',
              selfApprovalAllowed: true,
              requiredApprovalCount: 1 as const,
              requiredScope: 'action:approve' as const,
            },
            requesterPrincipalId: actor.id,
            expiryPolicyVersion: 'action-preview-expiry-v1' as const,
            createdAt,
            expiresAt: addMilliseconds(createdAt, previewLifetimeMs),
          };
          const preview: ActionPreview = {
            ...snapshotBase,
            previewDigest: actionPreviewDigest(snapshotBase),
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
              candidateId: staged.candidate.candidateId,
              candidateRevision: staged.candidate.revisionNumber,
              validationDigest: staged.validationDigest,
            }),
            audit(record, 'ACTION_RISK_DECIDED', actor.id, createdAt, {
              riskLevel: riskDecision.level,
              policyVersion: riskDecision.policyVersion,
            }),
            audit(record, 'ACTION_PREVIEW_READY', actor.id, createdAt, {
              snapshotId: preview.snapshotId,
              snapshotDigest: preview.previewDigest,
              expiresAt: preview.expiresAt,
            }),
          ]);
        },
      },
      {
        messageType: 'ApproveActionPreview',
        version: '1.1.0',
        requiredAccessScopes: ['action:approve'],
        async handle(envelope) {
          const { projectId, actor } = assertContext(envelope);
          if (actor.type !== 'user')
            throw new ShotgunError({
              code: 'ACTION_AUTHORIZATION_DENIED',
              safeMessage: 'Only a user principal can approve an Action.',
              module: 'stage11.action-execution',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          const payload = envelope.payload as { actionId: string; expectedPreviewDigest: string };
          const current = await repository.find(projectId, payload.actionId);
          if (!current) throw notFound(payload.actionId, envelope.correlationId);
          const approvedAt = clock.now();
          if (
            current.preview.previewDigest !== payload.expectedPreviewDigest ||
            new Date(current.preview.expiresAt).getTime() <= new Date(approvedAt).getTime()
          )
            throw stale('Preview Snapshot is stale or expired.', envelope.correlationId);
          if (current.status === 'APPROVED' && current.approval) return current;
          const approval: ActionApprovalRecord = {
            approvalId: randomUUID(),
            actionId: current.actionId,
            snapshotId: current.preview.snapshotId,
            snapshotDigest: current.preview.previewDigest,
            candidateRevision: current.preview.candidate.revisionNumber,
            approvedBy: actor,
            approvalPolicy: current.preview.approvalPolicy,
            approvedAt,
            expiresAt: current.preview.expiresAt,
          };
          return repository.approve(
            projectId,
            current.actionId,
            payload.expectedPreviewDigest,
            approval,
          );
        },
      },
      {
        messageType: 'ExecuteApprovedAction',
        version: '1.1.0',
        requiredAccessScopes: ['action:execute'],
        async handle(envelope, context) {
          const { projectId, actor, security } = assertContext(envelope);
          const { approvalId } = envelope.payload as { approvalId: string };
          const claimed = await repository.claimForExecution(
            projectId,
            approvalId,
            clock.now(),
            actor.id,
          );
          if (!claimed.claimed) return claimed.record;
          let current = claimed.record;
          try {
            const candidate = await requireCandidate(
              candidateRepository,
              projectId,
              current.preview.candidate.candidateId,
              envelope.correlationId,
            );
            const independentBinding = await independentVerification.resolveCurrentBinding({
              projectId,
              actionCandidateId: candidate.candidate.candidateId,
              validationId: candidate.candidate.validation.validationId,
              expectedCandidateRevision: candidate.candidate.revisionNumber,
              evidenceIds: candidate.evidence.map((e) => e.evidenceId),
            });
            if (!independentBinding) {
              throw stale(
                'Candidate data no longer matches the authoritative Validation, Evidence, Source, or Transformation records.',
                envelope.correlationId,
              );
            }
            assertCandidateMatchesSnapshot(
              candidate,
              {
                validationDigest: independentBinding.validation.digest,
                evidenceSetDigest: independentBinding.evidenceSetDigest,
                sourceSensitivity: independentBinding.sourceSensitivity,
              },
              current.preview,
              security.sensitivity,
              envelope.correlationId,
            );
          } catch (error) {
            await repository.transition(projectId, current.actionId, {
              expectedStatus: 'EXECUTING',
              next: {
                ...current,
                status: 'PREFLIGHT_FAILED',
                failureReason: 'Preview Snapshot became stale before execution.',
                updatedAt: clock.now(),
              },
              category: 'ACTION_PREFLIGHT_FAILED',
              actorId: actor.id,
              details: { reason: 'stale-action-snapshot' },
            });
            throw error;
          }
          const key = executeIdempotencyKey(current);
          const preflight = await connector.preflight(current.preview, key);
          if (preflight.status === 'DENIED')
            return repository.transition(projectId, current.actionId, {
              expectedStatus: 'EXECUTING',
              next: {
                ...current,
                status: 'PREFLIGHT_FAILED',
                failureReason: preflight.reason,
                updatedAt: clock.now(),
              },
              category: 'ACTION_PREFLIGHT_FAILED',
              actorId: actor.id,
              details: { reason: preflight.reason },
            });
          current = await repository.transition(projectId, current.actionId, {
            expectedStatus: 'EXECUTING',
            next: { ...current, updatedAt: clock.now() },
            category: 'ACTION_PREFLIGHT_PASSED',
            actorId: actor.id,
            details: {
              connectorId: connector.identity.id,
              duplicate: preflight.status === 'ALREADY_APPLIED',
            },
          });
          let providerResult: ProviderActionResult;
          try {
            providerResult =
              preflight.status === 'ALREADY_APPLIED'
                ? preflight.providerResult
                : await connector.execute(current.preview, key);
          } catch (error) {
            const unknown = error instanceof ShotgunError && error.code === 'OUTCOME_UNKNOWN';
            const next: ActionExecutionRecord = {
              ...current,
              status: unknown ? 'OUTCOME_UNKNOWN' : 'FAILED',
              failureReason: unknown
                ? 'Provider response was lost; automatic execution retry is forbidden.'
                : 'Provider rejected the Action before a confirmed result.',
              updatedAt: clock.now(),
            };
            const failed = await repository.transition(projectId, current.actionId, {
              expectedStatus: 'EXECUTING',
              next,
              category: unknown ? 'ACTION_OUTCOME_UNKNOWN' : 'ACTION_FAILED',
              actorId: actor.id,
              details: { automaticRetry: false },
              feedbackIntent: createActionFeedbackIntent(next),
            });
            await publishFeedback(repository, context, failed, failed.updatedAt);
            return failed;
          }
          current = await repository.transition(projectId, current.actionId, {
            expectedStatus: 'EXECUTING',
            next: { ...current, status: 'EXECUTED', providerResult, updatedAt: clock.now() },
            category: 'ACTION_EXECUTED',
            actorId: actor.id,
            details: {
              provider: providerResult.provider,
              externalId: providerResult.externalId,
              observedDigest: providerResult.observedDigest,
            },
          });
          return verifyRecord(repository, connector, current, 'system:worker', clock, context);
        },
      },
      {
        messageType: 'VerifyActionOutcome',
        version: '1.1.0',
        requiredAccessScopes: ['action:verify'],
        async handle(envelope, context) {
          const { projectId, actor } = assertContext(envelope);
          if (actor.type !== 'service')
            throw new ShotgunError({
              code: 'ACTION_AUTHORIZATION_DENIED',
              safeMessage: 'Only an internal Worker or Service Principal can verify an Action.',
              module: 'stage11.action-execution',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          const { actionId } = envelope.payload as { actionId: string };
          const current = await repository.find(projectId, actionId);
          if (!current) throw notFound(actionId, envelope.correlationId);
          if (
            !['EXECUTED', 'OUTCOME_UNKNOWN', 'VERIFICATION_FAILED', 'VERIFIED'].includes(
              current.status,
            )
          )
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: `Action '${actionId}' is not ready for provider verification.`,
              module: 'stage11.action-execution',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          if (current.status === 'VERIFIED') return current;
          return verifyRecord(repository, connector, current, actor.id, clock, context);
        },
      },
      {
        messageType: 'ReconcileExecutingAction',
        version: '1.1.0',
        requiredAccessScopes: ['action:execute'],
        async handle(envelope, context) {
          const { projectId, actor, security } = assertContext(envelope);
          if (
            actor.type !== 'service' &&
            (actor.type !== 'user' || !security.accessScope.includes('owner'))
          )
            throw new ShotgunError({
              code: 'ACTION_AUTHORIZATION_DENIED',
              safeMessage: 'Only an owner or service principal can reconcile an Action.',
              module: 'stage11.action-execution',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          const { actionId, expectedUpdatedAt } = envelope.payload as {
            actionId: string;
            expectedUpdatedAt: string;
          };
          const current = await repository.find(projectId, actionId);
          if (!current) throw notFound(actionId, envelope.correlationId);
          if (current.status === 'OUTCOME_UNKNOWN') return current;
          if (current.status !== 'EXECUTING')
            throw new ShotgunError({
              code: 'CONFLICT',
              safeMessage: `Action '${actionId}' is not executing and cannot be reconciled.`,
              module: 'stage11.action-execution',
              operation: envelope.messageType,
              correlationId: envelope.correlationId,
            });
          const next: ActionExecutionRecord = {
            ...current,
            status: 'OUTCOME_UNKNOWN',
            failureReason:
              'Execution was interrupted before a durable provider outcome was established. Automatic execution retry is forbidden.',
            updatedAt: clock.now(),
          };
          const reconciled = await repository.transition(projectId, actionId, {
            expectedStatus: 'EXECUTING',
            expectedUpdatedAt,
            next,
            category: 'ACTION_OUTCOME_UNKNOWN',
            actorId: actor.id,
            details: {
              automaticRetry: false,
              reconciliation: 'orphaned-executing',
              expectedUpdatedAt,
            },
            feedbackIntent: createActionFeedbackIntent(next),
          });
          await publishFeedback(repository, context, reconciled, reconciled.updatedAt);
          return reconciled;
        },
      },
    ],
    events: [],
    queries: [
      {
        messageType: 'GetActionExecution',
        version: '1.1.0',
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
        version: '1.1.0',
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
    code: 'ACTION_REFERENCE_NOT_FOUND',
    safeMessage: `Action '${actionId}' was not found in this project.`,
    module: 'stage11.action-execution',
    operation: 'find-action',
    correlationId,
  });
const stale = (message: string, correlationId?: string): ShotgunError =>
  new ShotgunError({
    code: 'STALE_ACTION_SNAPSHOT',
    safeMessage: message,
    module: 'stage11.action-execution',
    operation: 'validate-action-snapshot',
    correlationId,
  });

export const dispatchActionFeedbackOutbox = async (
  repository: ActionFeedbackOutboxRepositoryPort,
  context: Pick<HandlerContext, 'publish' | 'publishWithOutcome'>,
  projectId: string,
  limit: number,
  now: string,
  semanticKey?: string,
  options: { readonly failOnRequiredConsumerDeadLetter?: boolean } = {},
): Promise<number> => {
  const staleBefore = new Date(Date.parse(now) - 5 * 60 * 1000).toISOString();
  const records = [
    ...(await repository.claimFeedbackOutbox(
      projectId,
      semanticKey,
      Math.max(1, Math.min(100, limit)),
      now,
      staleBefore,
    )),
  ].sort(
    (left, right) =>
      left.availableAt.localeCompare(right.availableAt) ||
      left.outboxId.localeCompare(right.outboxId),
  );
  let published = 0;
  let firstError: unknown;
  let requiredConsumerDeadLetter = false;
  for (const record of records) {
    let handoffAccepted = false;
    try {
      const input: PublishEventInput<ActionFeedback> = {
        messageType: 'ActionFeedbackRecorded',
        schemaVersion: record.schemaVersion,
        idempotencyKey: record.semanticKey,
        payload: record.payload,
      };
      const outcome = context.publishWithOutcome
        ? await context.publishWithOutcome(input)
        : (await context.publish(input), { requiredConsumerDeadLetter: false });
      handoffAccepted = true;
      await repository.markFeedbackOutboxPublished(
        projectId,
        record.outboxId,
        record.attempts,
        now,
        record,
      );
      published += 1;
      requiredConsumerDeadLetter ||= outcome.requiredConsumerDeadLetter;
    } catch (error) {
      // Once publishEvent returned, the Connector Runtime owns any required
      // consumer dead-letter and governed replay.  Never release that row
      // back to this producer outbox, including marker ACK ambiguity.
      if (!handoffAccepted) {
        await repository.releaseFeedbackOutbox(
          projectId,
          record.outboxId,
          record.attempts,
          error instanceof ShotgunError && error.code === 'OUTCOME_UNKNOWN'
            ? 'OUTCOME_UNKNOWN'
            : 'OUTBOX_PUBLICATION_FAILED',
        );
      }
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
  if (requiredConsumerDeadLetter && options.failOnRequiredConsumerDeadLetter) {
    throw new ShotgunError({
      code: 'TERMINAL_FAILURE',
      safeMessage:
        'The feedback handoff was accepted but a required consumer is governed by dead-letter replay.',
      module: 'stage11.action-execution',
      operation: 'dispatch-action-feedback-outbox',
    });
  }
  return published;
};

export type ActionFeedbackOutboxRecoveryConnector = {
  sendCommand<TPayload>(
    command: ReturnType<typeof createCommand>,
  ): Promise<{ readonly result: TPayload }>;
};

export const runActionFeedbackOutboxRecovery = async (
  repository: ActionFeedbackOutboxRepositoryPort,
  connector: ActionFeedbackOutboxRecoveryConnector,
  options: { readonly batchSize?: number } = {},
): Promise<number> => {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
    throw new RangeError('Action feedback outbox batchSize must be an integer between 1 and 100.');
  let published = 0;
  let firstError: unknown;
  for (const projectId of await repository.listFeedbackOutboxProjectIds()) {
    try {
      const result = await connector.sendCommand<{ readonly published: number }>(
        createCommand({
          messageType: 'DispatchActionFeedbackOutbox',
          schemaVersion: '1.1.0',
          producerModule: 'stage11.action-execution',
          producerVersion: '1.1.0',
          projectId,
          actor: { type: 'service', id: 'stage11-action-feedback-outbox' },
          security: {
            accessScope: ['owner'],
            sensitivity: 'restricted',
            dataClassification: 'action-feedback-recovery',
          },
          idempotencyKey: `action-feedback-recovery:${projectId}:${randomUUID()}`,
          payload: { limit: batchSize },
        }),
      );
      published += result.result.published;
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
  return published;
};

export const startActionFeedbackOutboxWorker = (
  repository: ActionFeedbackOutboxRepositoryPort,
  connector: ActionFeedbackOutboxRecoveryConnector,
  intervalMs: number,
  batchSize = 100,
) => {
  if (!Number.isFinite(intervalMs) || intervalMs < 1)
    throw new RangeError('Action feedback outbox interval must be at least one millisecond.');
  let active: Promise<void> | undefined;
  let stopped = false;
  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (active) return active;
    const execution = runActionFeedbackOutboxRecovery(repository, connector, { batchSize })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        if (active === execution) active = undefined;
      });
    active = execution;
    return execution;
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return {
    tick,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await active;
    },
  };
};

const publishFeedback = async (
  repository: ActionExecutionRepositoryPort,
  context: Pick<HandlerContext, 'publish' | 'publishWithOutcome'>,
  record: ActionExecutionRecord,
  now: string,
): Promise<void> => {
  const intent = createActionFeedbackIntent(record);
  if (!intent) return;
  const published = await dispatchActionFeedbackOutbox(
    repository,
    context,
    record.projectId,
    1,
    now,
    intent.semanticKey,
    { failOnRequiredConsumerDeadLetter: true },
  );
  if (published > 0) return;
  const persisted = await repository.findFeedbackOutbox(record.projectId, intent.semanticKey);
  if (persisted?.status === 'published') return;
  throw new ShotgunError({
    code: 'OUTCOME_UNKNOWN',
    safeMessage: 'Action feedback publication could not be proven.',
    module: 'stage11.action-execution',
    operation: 'publish-action-feedback',
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
  const nextRecord: ActionExecutionRecord = {
    ...current,
    status: applied ? 'VERIFIED' : 'VERIFICATION_FAILED',
    verification: { ...verification, verifiedAt },
    failureReason: applied ? undefined : `Provider verification returned ${verification.status}.`,
    updatedAt: verifiedAt,
  };
  const next = await repository.transition(current.projectId, current.actionId, {
    expectedStatus: current.status,
    next: nextRecord,
    category: applied ? 'ACTION_VERIFIED' : 'ACTION_VERIFICATION_FAILED',
    actorId,
    details: {
      provider: verification.provider,
      verificationStatus: verification.status,
      observedDigest: verification.observedDigest ?? 'none',
    },
    feedbackIntent: createActionFeedbackIntent(nextRecord),
  });
  await publishFeedback(repository, context, next, verifiedAt);
  return next;
};
