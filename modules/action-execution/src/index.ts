import { randomUUID } from 'node:crypto';

import type {
  ActionApprovalRecord,
  ActionAuditCategory,
  ActionAuditEvent,
  ActionExecutionRecord,
  ActionFeedback,
  ActionPreview,
  ActionVerification,
  CommandEnvelope,
  ProviderActionResult,
  QueryEnvelope,
  ServerActionCandidate,
} from '../../../packages/contracts/src/index.js';
import {
  actionCandidateDigest,
  actionEvidenceSetDigest,
  actionParameterDigest,
  actionPayloadDigest,
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

/** Trusted staging port. It is intentionally not exposed as an HTTP endpoint. */
export type ActionCandidateRepositoryPort = {
  find(projectId: string, candidateId: string): Promise<ServerActionCandidate | undefined>;
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
const actionIdSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['actionId'],
  properties: { actionId: { type: 'string', minLength: 1 } },
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
  preview: ActionPreview,
  clearance: keyof typeof sensitivityRank,
  correlationId?: string,
): void => {
  const evidence = [...candidate.evidence].sort((left, right) =>
    left.evidenceId.localeCompare(right.evidenceId),
  );
  const expectedEvidence = [...preview.evidence].sort((left, right) =>
    left.evidenceId.localeCompare(right.evidenceId),
  );
  const currentDigest = actionCandidateDigest(candidate.candidate);
  if (
    candidate.candidate.revisionNumber !== preview.candidate.revisionNumber ||
    currentDigest !== preview.candidateDigest ||
    candidate.validationDigest !== preview.validationDigest ||
    actionEvidenceSetDigest(evidence) !== preview.evidenceSetDigest ||
    JSON.stringify(evidence) !== JSON.stringify(expectedEvidence) ||
    candidate.sourceSensitivity !== preview.sourceSensitivity ||
    sensitivityRank[clearance] < sensitivityRank[candidate.sourceSensitivity]
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
      ],
      events: [],
    },
    produces: { events: [{ name: 'ActionFeedbackRecorded', range: '>=1.0.0 <2.0.0' }] },
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
          const snapshotBase = {
            actionId: randomUUID(),
            snapshotId: randomUUID(),
            snapshotSchemaVersion: 'action-preview-snapshot-v1' as const,
            canonicalSerializer: 'action-preview-canonical-v1' as const,
            hashAlgorithm: 'SHA-256' as const,
            projectId,
            candidate: staged.candidate,
            candidateDigest,
            validationDigest: staged.validationDigest,
            evidence,
            evidenceSetDigest: actionEvidenceSetDigest(evidence),
            sourceSensitivity: staged.sourceSensitivity,
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
            assertCandidateMatchesSnapshot(
              candidate,
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
          try {
            const providerResult =
              preflight.status === 'ALREADY_APPLIED'
                ? preflight.providerResult
                : await connector.execute(current.preview, key);
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
          } catch (error) {
            const unknown = error instanceof ShotgunError && error.code === 'OUTCOME_UNKNOWN';
            const failed = await repository.transition(projectId, current.actionId, {
              expectedStatus: 'EXECUTING',
              next: {
                ...current,
                status: unknown ? 'OUTCOME_UNKNOWN' : 'FAILED',
                failureReason: unknown
                  ? 'Provider response was lost; automatic execution retry is forbidden.'
                  : 'Provider rejected the Action before a confirmed result.',
                updatedAt: clock.now(),
              },
              category: unknown ? 'ACTION_OUTCOME_UNKNOWN' : 'ACTION_FAILED',
              actorId: actor.id,
              details: { automaticRetry: false },
            });
            await publishFeedback(context, failed, failed.updatedAt);
            return failed;
          }
          return verifyRecord(repository, connector, current, actor.id, clock, context);
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
