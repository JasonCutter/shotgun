import { createHash } from 'node:crypto';
import type { CommandEnvelope } from './types.js';

// ============================================================================
// 1. Typed Error Contract & Error Classification
// ============================================================================

export type FrontendErrorCode =
  | 'REVISION_CONFLICT'
  | 'DIGEST_MISMATCH'
  | 'RESOURCE_RETIRED'
  | 'RESOURCE_PROJECT_MISMATCH'
  | 'PRECONDITION_ACCESS_DENIED'
  | 'POLICY_CONTEXT_CHANGED'
  | 'IDEMPOTENCY_KEY_REUSE_MISMATCH'
  | 'SESSION_EXPIRED'
  | 'CAPABILITY_DENIED'
  | 'OUTCOME_INDETERMINATE'
  | 'RESOURCE_ACCESS_REVOKED';

export type FrontendErrorCategoryFlags = {
  readonly userFixRequired: boolean;
  readonly refetchNeeded: boolean;
  readonly authRecoveryNeeded: boolean;
  readonly explicitRetryAllowed: boolean;
  readonly autoRetryForbidden: boolean;
  readonly supportNeeded: boolean;
};

export class FrontendContractError extends Error {
  readonly code: FrontendErrorCode;
  readonly correlationId?: string;

  constructor(code: FrontendErrorCode, message: string, correlationId?: string) {
    super(message);
    this.name = 'FrontendContractError';
    this.code = code;
    this.correlationId = correlationId;
  }
}

export function classifyFrontendErrorCode(code: FrontendErrorCode): FrontendErrorCategoryFlags {
  switch (code) {
    case 'REVISION_CONFLICT':
    case 'DIGEST_MISMATCH':
    case 'POLICY_CONTEXT_CHANGED':
      return {
        userFixRequired: false,
        refetchNeeded: true,
        authRecoveryNeeded: false,
        explicitRetryAllowed: true,
        autoRetryForbidden: true,
        supportNeeded: false,
      };
    case 'RESOURCE_PROJECT_MISMATCH':
    case 'PRECONDITION_ACCESS_DENIED':
    case 'IDEMPOTENCY_KEY_REUSE_MISMATCH':
      return {
        userFixRequired: true,
        refetchNeeded: false,
        authRecoveryNeeded: false,
        explicitRetryAllowed: true,
        autoRetryForbidden: true,
        supportNeeded: false,
      };
    case 'SESSION_EXPIRED':
    case 'RESOURCE_ACCESS_REVOKED':
      return {
        userFixRequired: false,
        refetchNeeded: false,
        authRecoveryNeeded: true,
        explicitRetryAllowed: false,
        autoRetryForbidden: true,
        supportNeeded: false,
      };
    case 'CAPABILITY_DENIED':
      return {
        userFixRequired: false,
        refetchNeeded: false,
        authRecoveryNeeded: true,
        explicitRetryAllowed: false,
        autoRetryForbidden: true,
        supportNeeded: false,
      };
    case 'OUTCOME_INDETERMINATE':
      return {
        userFixRequired: false,
        refetchNeeded: true,
        authRecoveryNeeded: false,
        explicitRetryAllowed: false,
        autoRetryForbidden: true,
        supportNeeded: true,
      };
    case 'RESOURCE_RETIRED':
      return {
        userFixRequired: true,
        refetchNeeded: true,
        authRecoveryNeeded: false,
        explicitRetryAllowed: false,
        autoRetryForbidden: true,
        supportNeeded: false,
      };
    default:
      return {
        userFixRequired: false,
        refetchNeeded: true,
        authRecoveryNeeded: false,
        explicitRetryAllowed: false,
        autoRetryForbidden: true,
        supportNeeded: true,
      };
  }
}

// ============================================================================
// 2. Typed Preconditions & Validation
// ============================================================================

export type TypedPreconditionPurpose =
  | 'TARGET'
  | 'DRAFT'
  | 'BASE_CANONICAL'
  | 'REVIEW'
  | 'EVIDENCE'
  | 'POLICY'
  | 'APPROVAL'
  | 'ACTION_MANIFEST'
  | 'PREFLIGHT'
  | 'EXTERNAL_TARGET'
  | 'DEPENDENCY';

export type TypedPreconditionSubject = {
  readonly resourceKind: string;
  readonly resourceId: string;
};

export type TypedPrecondition = {
  readonly purpose: TypedPreconditionPurpose;
  readonly subject: TypedPreconditionSubject;
  readonly expectedRevision?: string;
  readonly expectedDigest?: string;
  readonly digestKind?: string;
};

export function validateTypedPreconditions(preconditions: readonly TypedPrecondition[]): {
  readonly isValid: boolean;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];
  const validPurposes: Set<TypedPreconditionPurpose> = new Set([
    'TARGET',
    'DRAFT',
    'BASE_CANONICAL',
    'REVIEW',
    'EVIDENCE',
    'POLICY',
    'APPROVAL',
    'ACTION_MANIFEST',
    'PREFLIGHT',
    'EXTERNAL_TARGET',
    'DEPENDENCY',
  ]);

  for (let i = 0; i < preconditions.length; i++) {
    const pc = preconditions[i];
    if (!pc) continue;
    if (!pc.purpose || !validPurposes.has(pc.purpose)) {
      errors.push(`Precondition[${i}]: Invalid purpose '${pc.purpose}'`);
    }
    if (!pc.subject || !pc.subject.resourceKind || !pc.subject.resourceId) {
      errors.push(`Precondition[${i}]: Subject must contain non-empty resourceKind and resourceId`);
    }
    if (!pc.expectedRevision && !pc.expectedDigest) {
      errors.push(`Precondition[${i}]: Must specify either expectedRevision or expectedDigest`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// ============================================================================
// 3. Correlation & Causation Context
// ============================================================================

export type CausationRefKind = 'COMMAND' | 'RESOURCE' | 'EVENT';

export type CausationRef = {
  readonly kind: CausationRefKind;
  readonly id: string;
  readonly revision?: string;
};

export type CorrelationContext = {
  readonly correlationId?: string;
  readonly causationRef?: CausationRef;
};

// ============================================================================
// 4. Project Context & Binding Rules
// ============================================================================

export type FrontendProjectContextInput = {
  readonly activeProjectId: string;
  readonly targetProjectId: string;
  readonly resourceProjectId?: string;
  readonly observedProjectAccessRevision?: string;
};

export type FrontendProjectContextState = {
  readonly activeProject: { readonly id: string };
  readonly resourceProject?: { readonly id: string };
  readonly draftProject?: { readonly id: string };
  readonly effectiveProject: { readonly id: string };
  readonly mismatchState: {
    readonly isMismatch: boolean;
    readonly reason?: string;
  };
  readonly capabilities: readonly string[];
};

export function createFrontendProjectContext(
  input: FrontendProjectContextInput,
  options?: {
    readonly draftProjectId?: string;
    readonly isNewResource?: boolean;
    readonly capabilities?: readonly string[];
  },
): FrontendProjectContextState {
  const isNew = options?.isNewResource ?? false;
  const targetId = isNew
    ? input.activeProjectId
    : (input.resourceProjectId ?? input.targetProjectId);

  const isMismatch =
    !isNew && Boolean(input.resourceProjectId) && input.resourceProjectId !== input.activeProjectId;

  const mismatchReason = isMismatch
    ? `Target resource belongs to project '${input.resourceProjectId}', but UI presentation is scoped to active project '${input.activeProjectId}'`
    : undefined;

  return {
    activeProject: { id: input.activeProjectId },
    resourceProject: input.resourceProjectId ? { id: input.resourceProjectId } : undefined,
    draftProject: options?.draftProjectId ? { id: options.draftProjectId } : undefined,
    effectiveProject: { id: targetId },
    mismatchState: {
      isMismatch,
      reason: mismatchReason,
    },
    capabilities: options?.capabilities ?? [],
  };
}

// ============================================================================
// 5. Policy Binding
// ============================================================================

export type PolicyBindingMode = 'CURRENT' | 'PINNED_ACCEPTED_CONTEXT';

export type FrontendPolicyBinding = {
  readonly mode: PolicyBindingMode;
  readonly observedPolicyContextRevision?: string;
  readonly acceptedPolicyContextId?: string;
};

// ============================================================================
// 6. FrontendCommandRequest 1.0.0
// ============================================================================

export type FrontendCommandRequest<TPayload = unknown> = {
  readonly envelopeVersion: '1.0.0';
  readonly commandType: string;
  readonly commandSchemaVersion: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly projectContext: {
    readonly activeProjectId: string;
    readonly targetProjectId: string;
    readonly resourceProjectId?: string;
    readonly observedProjectAccessRevision?: string;
  };
  readonly policyBinding: FrontendPolicyBinding;
  readonly preconditions: readonly TypedPrecondition[];
  readonly correlationContext?: CorrelationContext;
  readonly clientIssuedAt: string;
  readonly payload: TPayload;
};

// ============================================================================
// 7. Command Semantic Digest Computation
// ============================================================================

function deterministicStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(deterministicStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}:${deterministicStringify((obj as Record<string, unknown>)[k])}`,
  );
  return '{' + entries.join(',') + '}';
}

export function computeCommandSemanticDigest<TPayload>(
  request: FrontendCommandRequest<TPayload>,
): string {
  const digestPayload = {
    commandType: request.commandType,
    commandSchemaVersion: request.commandSchemaVersion,
    targetProjectId: request.projectContext.targetProjectId,
    resourceProjectId: request.projectContext.resourceProjectId ?? null,
    payload: request.payload,
    preconditions: request.preconditions.map((p) => ({
      purpose: p.purpose,
      subject: p.subject,
      expectedRevision: p.expectedRevision ?? null,
      expectedDigest: p.expectedDigest ?? null,
      digestKind: p.digestKind ?? null,
    })),
    policyBinding: {
      mode: request.policyBinding.mode,
      observedPolicyContextRevision: request.policyBinding.observedPolicyContextRevision ?? null,
      acceptedPolicyContextId: request.policyBinding.acceptedPolicyContextId ?? null,
    },
  };

  const jsonString = deterministicStringify(digestPayload);
  return createHash('sha256').update(jsonString).digest('hex');
}

// ============================================================================
// 8. Outcome Views & Outcome Resolution
// ============================================================================

export type OutcomeState = 'ACCEPTED' | 'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN';

export type CompletionDisposition = 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'NO_OP';

export type OutcomeResolutionState =
  'FOUND' | 'NOT_ACCEPTED_CONFIRMED' | 'INDETERMINATE' | 'RETENTION_EXPIRED';

export type ProducedResourceRef = {
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly resourceRevision?: string;
};

export type CommandRejectionDetail = {
  readonly code: string;
  readonly message: string;
  readonly category?: string;
  readonly retryable?: boolean;
};

export type FrontendCommandOutcomeView<TPayload = unknown> = {
  readonly commandId: string;
  readonly commandRevision: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandType: string;
  readonly commandSchemaVersion: string;
  readonly commandSemanticDigest: string;
  readonly outcomeState: OutcomeState;
  readonly completionDisposition?: CompletionDisposition;
  readonly acceptedPrincipalContext: { readonly principalId: string };
  readonly acceptedProjectContext: { readonly targetProjectId: string };
  readonly acceptedPolicyContext: FrontendPolicyBinding;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly traceId?: string;
  readonly producedResources: readonly ProducedResourceRef[];
  readonly rejection?: CommandRejectionDetail;
  readonly resolution: OutcomeResolutionState;
  readonly receivedAt: string;
  readonly acceptedAt?: string;
  readonly completedAt?: string;
  readonly lastUpdatedAt: string;
  readonly eventCursor?: string;
  readonly payload?: TPayload;
};

export type CommandLedgerEntry<TPayload = unknown> = {
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly principalId: string;
  readonly targetProjectId: string;
  readonly commandType: string;
  readonly commandSemanticDigest: string;
  readonly outcome: FrontendCommandOutcomeView<TPayload>;
  readonly isDurableAccepted: boolean;
  readonly isRetentionExpired: boolean;
};

export function resolveOutcomeState<TPayload>(
  request: FrontendCommandRequest<TPayload>,
  principalId: string,
  ledgerEntries: readonly CommandLedgerEntry<TPayload>[],
  domainResourceStatusResolver?: () => { readonly exists: boolean; readonly stateMatches: boolean },
): OutcomeResolutionState {
  const digest = computeCommandSemanticDigest(request);

  // Step 1: Match by clientRequestId
  const byRequestId = ledgerEntries.find((e) => e.clientRequestId === request.clientRequestId);
  if (byRequestId) {
    if (byRequestId.isRetentionExpired) return 'RETENTION_EXPIRED';
    return 'FOUND';
  }

  // Step 2: Match by idempotencyKey + scope + digest ledger
  const byIdempotency = ledgerEntries.find(
    (e) =>
      e.idempotencyKey === request.idempotencyKey &&
      e.principalId === principalId &&
      e.targetProjectId === request.projectContext.targetProjectId &&
      e.commandType === request.commandType,
  );

  if (byIdempotency) {
    if (byIdempotency.commandSemanticDigest !== digest) {
      throw new FrontendContractError(
        'IDEMPOTENCY_KEY_REUSE_MISMATCH',
        `Idempotency key '${request.idempotencyKey}' reused with different semantic digest`,
      );
    }
    if (byIdempotency.isRetentionExpired) return 'RETENTION_EXPIRED';
    return 'FOUND';
  }

  // Step 3: Domain resource status check if provided
  if (domainResourceStatusResolver) {
    const status = domainResourceStatusResolver();
    if (status.exists && status.stateMatches) {
      return 'FOUND';
    }
    if (!status.exists) {
      return 'NOT_ACCEPTED_CONFIRMED';
    }
    return 'INDETERMINATE';
  }

  return 'NOT_ACCEPTED_CONFIRMED';
}

// ============================================================================
// 9. Retry Boundary Classification
// ============================================================================

export type RetryClassification = 'TRANSPORT_RETRY' | 'DOMAIN_RETRY' | 'RETRY_FORBIDDEN';

export function classifyRetry<TPayload>(
  previousRequest: FrontendCommandRequest<TPayload>,
  newRequest: FrontendCommandRequest<TPayload>,
): RetryClassification {
  const isSameClientReq = previousRequest.clientRequestId === newRequest.clientRequestId;
  const isSameIdempotency = previousRequest.idempotencyKey === newRequest.idempotencyKey;
  const sameDigest =
    computeCommandSemanticDigest(previousRequest) === computeCommandSemanticDigest(newRequest);

  if (isSameClientReq && isSameIdempotency && sameDigest) {
    return 'TRANSPORT_RETRY';
  }

  if (!isSameClientReq && !isSameIdempotency && sameDigest) {
    return 'DOMAIN_RETRY';
  }

  if (isSameIdempotency && !sameDigest) {
    return 'RETRY_FORBIDDEN';
  }

  return 'DOMAIN_RETRY';
}

// ============================================================================
// 10. Mapper: FrontendCommandRequest -> Internal CommandEnvelope
// ============================================================================

export type InternalCommandMappingOptions = {
  readonly serverCommandId: string;
  readonly actor: { readonly type: 'user' | 'service'; readonly id: string };
  readonly accessScope: readonly string[];
  readonly sensitivity: 'public' | 'internal' | 'private' | 'restricted';
  readonly producerModule?: string;
  readonly producerVersion?: string;
  readonly traceId: string;
};

export function mapFrontendRequestToInternalCommandEnvelope<TPayload>(
  request: FrontendCommandRequest<TPayload>,
  options: InternalCommandMappingOptions,
): CommandEnvelope<TPayload> {
  // Validate preconditions atomically before mapping

  const validation = validateTypedPreconditions(request.preconditions);
  if (!validation.isValid) {
    throw new FrontendContractError(
      'PRECONDITION_ACCESS_DENIED',
      `Command request mapping failed precondition validation: ${validation.errors.join('; ')}`,
    );
  }

  const causationId = request.correlationContext?.causationRef?.id;

  return {
    messageId: options.serverCommandId,
    messageType: request.commandType,
    messageKind: 'command',
    schemaVersion: request.commandSchemaVersion,
    producerModule: options.producerModule ?? 'shotgun-web-gateway',
    producerVersion: options.producerVersion ?? '1.0.0',
    correlationId: request.correlationContext?.correlationId ?? options.serverCommandId,
    causationId,
    projectId: request.projectContext.targetProjectId,
    idempotencyKey: request.idempotencyKey,
    actor: options.actor,
    security: {
      accessScope: options.accessScope,
      sensitivity: options.sensitivity,
      dataClassification: 'standard',
    },
    provenance: {
      sourceVersionIds: [],
      evidenceIds: [],
      policyVersion: request.policyBinding.observedPolicyContextRevision,
    },
    payload: request.payload,
    createdAt: new Date().toISOString(),
    traceId: options.traceId,
    orderingKey: `${request.projectContext.targetProjectId}:${request.commandType}`,
  };
}

// ============================================================================
// 11. ResourceSnapshot Base Contract
// ============================================================================

export type ResourceSnapshot<TState = unknown> = {
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly resourceRevision: string;
  readonly projectId: string;
  readonly snapshotId?: string;
  readonly snapshotRevision?: string;
  readonly state: TState;
  readonly lastUpdatedAt: string;
  readonly capabilities: readonly string[];
  readonly warnings?: readonly string[];
  readonly policyContextRef?: string;
};

// ============================================================================
// 12. Session & Auth Boundary State & Capability Guard
// ============================================================================

export type AuthenticationState = 'UNAUTHENTICATED' | 'AUTHENTICATING' | 'AUTHENTICATED';

export type SessionState =
  | 'LOCAL_SESSION_ESTABLISHING'
  | 'LOCAL_SESSION_READY'
  | 'LOCAL_SESSION_REESTABLISHING'
  | 'LOCAL_SERVER_UNAVAILABLE'
  | 'LOCAL_OWNER_DISABLED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'PROVISIONING_FAILED'
  | 'SESSION_REVOKED'
  | 'EXPIRED'
  | 'VALID';

export type ConnectivityState = 'ONLINE' | 'OFFLINE' | 'DEGRADED';

export type BackendReadiness = 'READY' | 'INITIALIZING' | 'UNAVAILABLE';

export type SystemBoundaryContext = {
  readonly authState: AuthenticationState;
  readonly sessionState: SessionState;
  readonly connectivityState: ConnectivityState;
  readonly backendReadiness: BackendReadiness;
  readonly principalId?: string;
  readonly activeProjectId?: string;
  readonly grantedCapabilities: readonly string[];
};

export type AccessGuardResult = {
  readonly allowed: boolean;
  readonly error?: FrontendContractError;
  readonly treatAsNotFound?: boolean;
};

export function evaluateCapabilityGuard(
  boundaryCtx: SystemBoundaryContext,
  requiredCapability: string,
  options?: {
    readonly isSensitiveResource?: boolean;
    readonly resourceProjectId?: string;
  },
): AccessGuardResult {
  if (boundaryCtx.sessionState === 'EXPIRED' || boundaryCtx.sessionState === 'SESSION_REVOKED') {
    return {
      allowed: false,
      error: new FrontendContractError('SESSION_EXPIRED', 'Session expired or revoked'),
    };
  }

  if (boundaryCtx.sessionState !== 'VALID' && boundaryCtx.sessionState !== 'LOCAL_SESSION_READY') {
    return {
      allowed: false,
      error: new FrontendContractError(
        'SESSION_EXPIRED',
        `Session is in non-ready state: ${boundaryCtx.sessionState}`,
      ),
    };
  }

  if (
    options?.resourceProjectId &&
    boundaryCtx.activeProjectId &&
    options.resourceProjectId !== boundaryCtx.activeProjectId
  ) {
    // Note: Project boundary check
  }

  const hasCap = boundaryCtx.grantedCapabilities.includes(requiredCapability);
  if (!hasCap) {
    if (options?.isSensitiveResource) {
      return {
        allowed: false,
        treatAsNotFound: true,
        error: new FrontendContractError('CAPABILITY_DENIED', 'Resource not found'),
      };
    }
    return {
      allowed: false,
      error: new FrontendContractError(
        'CAPABILITY_DENIED',
        `Capability '${requiredCapability}' denied`,
      ),
    };
  }

  return { allowed: true };
}

// ============================================================================
// 13. Operational Resource Kind Registry
// ============================================================================

export type OperationalResourceKindDescriptor = {
  readonly kind: string;
  readonly family: string;
  readonly isConcrete: boolean;
  readonly projectScope: 'PROJECT_SCOPED' | 'GLOBAL_SCOPED';
  readonly snapshotSchemaVersion: string;
  readonly deepLinkDescriptor: string;
  readonly outcomeCapability: boolean;
  readonly sensitivityClass: 'public' | 'internal' | 'private' | 'restricted';
  readonly supportedActions: readonly string[];
};

const OPERATIONAL_RESOURCE_KIND_MAP: Record<string, OperationalResourceKindDescriptor> = {
  INTAKE_SUBMISSION: {
    kind: 'INTAKE_SUBMISSION',
    family: 'INTAKE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/intake/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['submit', 'revalidate', 'cancel'],
  },
  ANSWER_RUN: {
    kind: 'ANSWER_RUN',
    family: 'KNOWLEDGE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/answers/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['execute', 'cancel', 'feedback'],
  },
  DELIVERY_PACKAGE: {
    kind: 'DELIVERY_PACKAGE',
    family: 'DELIVERY',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/deliveries/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'restricted',
    supportedActions: ['build', 'deploy', 'rollback'],
  },
  FEEDBACK_EVENT: {
    kind: 'FEEDBACK_EVENT',
    family: 'GOVERNANCE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/feedback/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['record', 'triage'],
  },
  EVIDENCE_REVALIDATION: {
    kind: 'EVIDENCE_REVALIDATION',
    family: 'EVIDENCE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/evidence/:resourceId/revalidate',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['verify', 'flag'],
  },
  KNOWLEDGE_TRANSITION: {
    kind: 'KNOWLEDGE_TRANSITION',
    family: 'KNOWLEDGE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/transitions/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['apply', 'revert'],
  },
  IMPACT_ANALYSIS: {
    kind: 'IMPACT_ANALYSIS',
    family: 'KNOWLEDGE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/impact/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['run', 'dismiss'],
  },
  REVIEW_PROCESS: {
    kind: 'REVIEW_PROCESS',
    family: 'REVIEW',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/reviews/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['approve', 'reject', 'request_changes'],
  },
  CANONICAL_COMMIT: {
    kind: 'CANONICAL_COMMIT',
    family: 'GOVERNANCE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/commits/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'restricted',
    supportedActions: ['commit', 'revert'],
  },
  ACTION_PREFLIGHT: {
    kind: 'ACTION_PREFLIGHT',
    family: 'ACTION',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/actions/preflight/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['simulate', 'validate'],
  },
  ACTION_EXECUTION: {
    kind: 'ACTION_EXECUTION',
    family: 'ACTION',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/actions/executions/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'restricted',
    supportedActions: ['execute', 'cancel'],
  },
  ACTION_VERIFICATION: {
    kind: 'ACTION_VERIFICATION',
    family: 'ACTION',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/actions/verifications/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['verify'],
  },
  ACTION_COMPENSATION: {
    kind: 'ACTION_COMPENSATION',
    family: 'ACTION',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/actions/compensations/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'restricted',
    supportedActions: ['compensate'],
  },
  EXTERNAL_ACTION: {
    kind: 'EXTERNAL_ACTION',
    family: 'ACTION',
    isConcrete: false,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/actions/external',
    outcomeCapability: false,
    sensitivityClass: 'internal',
    supportedActions: ['filter', 'summarize'],
  },
  KNOWLEDGE_GOVERNANCE: {
    kind: 'KNOWLEDGE_GOVERNANCE',
    family: 'GOVERNANCE',
    isConcrete: false,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/governance',
    outcomeCapability: false,
    sensitivityClass: 'internal',
    supportedActions: ['filter', 'overview'],
  },
};

export class OperationalResourceKindRegistry {
  static get(kind: string): OperationalResourceKindDescriptor | undefined {
    return OPERATIONAL_RESOURCE_KIND_MAP[kind];
  }

  static require(kind: string): OperationalResourceKindDescriptor {
    const desc = OPERATIONAL_RESOURCE_KIND_MAP[kind];
    if (!desc) {
      throw new Error(`OperationalResourceKindRegistry: Kind '${kind}' is not registered`);
    }
    return desc;
  }

  static isConcrete(kind: string): boolean {
    return OPERATIONAL_RESOURCE_KIND_MAP[kind]?.isConcrete ?? false;
  }

  static listConcrete(): readonly OperationalResourceKindDescriptor[] {
    return Object.values(OPERATIONAL_RESOURCE_KIND_MAP).filter((d) => d.isConcrete);
  }

  static listAggregate(): readonly OperationalResourceKindDescriptor[] {
    return Object.values(OPERATIONAL_RESOURCE_KIND_MAP).filter((d) => !d.isConcrete);
  }
}

// ============================================================================
// 14. Projection Kind Registry & Write Boundary Enforcement
// ============================================================================

export type ProjectionKind =
  | 'COMPILED_TRUTH'
  | 'SEARCH_INDEX'
  | 'TIMELINE'
  | 'RELATION_VIEW'
  | 'GRAPH'
  | 'RELATED_KNOWLEDGE'
  | 'HOME_VIEW'
  | 'ACTIVITY_VIEW'
  | 'HISTORY_VIEW';

export type ProjectionState =
  | 'READY'
  | 'UPDATING'
  | 'PARTIALLY_READY'
  | 'STALE'
  | 'FAILED'
  | 'UNAVAILABLE'
  | 'ACCESS_RESTRICTED';

const PROJECTION_KINDS: Set<string> = new Set([
  'COMPILED_TRUTH',
  'SEARCH_INDEX',
  'TIMELINE',
  'RELATION_VIEW',
  'GRAPH',
  'RELATED_KNOWLEDGE',
  'HOME_VIEW',
  'ACTIVITY_VIEW',
  'HISTORY_VIEW',
]);

export class ProjectionKindRegistry {
  static isProjectionKind(kind: string): boolean {
    return PROJECTION_KINDS.has(kind);
  }

  static assertNotWriteableProjectionKind(kind: string): void {
    if (this.isProjectionKind(kind)) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        `Projection kind '${kind}' (including COMPILED_TRUTH) cannot be used as a direct write, approval, or commit domain resource target`,
      );
    }
  }
}

// ============================================================================
// 15. Cache Key Factory & Project Switch Invalidation
// ============================================================================

export type CacheKeyScope = 'project' | 'principal-global';

export type CacheKeyFactoryParams = {
  readonly scope: CacheKeyScope;
  readonly principalId: string;
  readonly sessionIdOrRevision: string;
  readonly activeProjectId?: string;
  readonly resourceProjectId?: string;
  readonly resourceKind: string;
  readonly resourceId?: string;
  readonly resourceRevision?: string;
  readonly accessScopeRevision?: string;
  readonly sensitivityPolicyRevision?: string;
  readonly policyContextRevision?: string;
  readonly featurePolicyRevision?: string;
  readonly retentionPolicyRevision?: string;
};

export type CacheKeyQueryTuple = readonly (string | Record<string, string | undefined>)[];

export function buildCacheKey(params: CacheKeyFactoryParams): CacheKeyQueryTuple {
  const scopePrefix = params.scope === 'project' ? 'project-cache' : 'global-cache';
  const targetProject =
    params.scope === 'project'
      ? (params.resourceProjectId ?? params.activeProjectId ?? 'no-project')
      : 'global';

  const revisions = {
    access: params.accessScopeRevision ?? 'v1',
    sensitivity: params.sensitivityPolicyRevision ?? 'v1',
    policy: params.policyContextRevision ?? 'v1',
    feature: params.featurePolicyRevision ?? 'v1',
    retention: params.retentionPolicyRevision ?? 'v1',
  };

  const identity = {
    principalId: params.principalId,
    sessionIdOrRevision: params.sessionIdOrRevision,
  };

  const resource = {
    kind: params.resourceKind,
    id: params.resourceId,
    revision: params.resourceRevision,
  };

  return [scopePrefix, targetProject, identity, resource, revisions] as const;
}

export function filterCacheKeysForProjectSwitch(
  keys: readonly CacheKeyQueryTuple[],
  newActiveProjectId: string,
): {
  readonly validKeys: readonly CacheKeyQueryTuple[];
  readonly purgedOrMaskedKeys: readonly CacheKeyQueryTuple[];
} {
  const validKeys: CacheKeyQueryTuple[] = [];
  const purgedOrMaskedKeys: CacheKeyQueryTuple[] = [];

  for (const key of keys) {
    const scopePrefix = key[0];
    const project = key[1];

    if (scopePrefix === 'global-cache') {
      validKeys.push(key);
    } else if (project === newActiveProjectId) {
      validKeys.push(key);
    } else {
      purgedOrMaskedKeys.push(key);
    }
  }

  return { validKeys, purgedOrMaskedKeys };
}
