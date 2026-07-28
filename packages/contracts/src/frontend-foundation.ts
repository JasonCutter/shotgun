import type { CommandEnvelope } from './types.js';
import type { ErrorCode } from './errors.js';
import { getFailureDescriptor } from './failure-contract.js';
import type { FailureCategory, FailureRecovery, FailureRetryability } from './failure-contract.js';

// ============================================================================
// 1. Typed Error Contract & Error Classification
// ============================================================================

export type FrontendErrorCode = ErrorCode;

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
  const descriptor = getFailureDescriptor(code);
  return {
    userFixRequired: descriptor.recovery === 'FIX_REQUEST',
    refetchNeeded:
      descriptor.recovery === 'REFRESH_AND_REAPPLY' ||
      descriptor.recovery === 'RESOLVE_EXISTING_OUTCOME',
    authRecoveryNeeded:
      descriptor.recovery === 'REAUTHENTICATE' || descriptor.recovery === 'REQUEST_ACCESS',
    explicitRetryAllowed:
      descriptor.retryability === 'SAFE' || descriptor.retryability === 'CONDITIONAL',
    autoRetryForbidden:
      descriptor.retryability !== 'SAFE' || descriptor.recovery === 'RESOLVE_EXISTING_OUTCOME',
    supportNeeded: descriptor.recovery === 'CONTACT_SUPPORT',
  };
}

// ============================================================================
// 2. Typed Preconditions & Atomic Validation
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
    if (!pc || typeof pc !== 'object') {
      errors.push(`Precondition[${i}]: Must be a non-null object`);
      continue;
    }
    if (!pc.purpose || !validPurposes.has(pc.purpose)) {
      errors.push(`Precondition[${i}]: Invalid purpose '${pc.purpose}'`);
    }
    if (!pc.subject || !pc.subject.resourceKind || !pc.subject.resourceId) {
      errors.push(`Precondition[${i}]: Subject must contain non-empty resourceKind and resourceId`);
    }
    const hasRevision =
      typeof pc.expectedRevision === 'string' && pc.expectedRevision.trim().length > 0;
    const hasDigest = typeof pc.expectedDigest === 'string' && pc.expectedDigest.trim().length > 0;
    if (!hasRevision && !hasDigest) {
      errors.push(`Precondition[${i}]: Must specify non-empty expectedRevision or expectedDigest`);
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
};

export function createFrontendProjectContext(
  input: FrontendProjectContextInput,
  options?: {
    readonly draftProjectId?: string;
    readonly isNewResource?: boolean;
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
  };
}

// ============================================================================
// 5. Policy Binding & Server-accepted Context Types
// ============================================================================

export type PolicyBindingMode = 'CURRENT' | 'PINNED_ACCEPTED_CONTEXT';

export type FrontendPolicyBinding = {
  readonly mode: PolicyBindingMode;
  readonly observedPolicyContextRevision?: string;
  readonly acceptedPolicyContextId?: string;
};

export type AcceptedPrincipalContext = {
  readonly principalId: string;
  readonly actor: { readonly type: 'user' | 'service'; readonly id: string };
};

export type AcceptedProjectContext = {
  readonly targetProjectId: string;
};

export type AcceptedPolicyContext = {
  readonly policyContextId: string;
  readonly policyContextRevision: string;
  readonly acceptedAt: string;
};

// ============================================================================
// 6. FrontendCommandRequest 1.0.0 & Runtime Request Validator
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

export const SECTION2_FRONTEND_COMMAND_TYPES = {
  updatePreference: 'settings.preference.update.v1',
  applyProjectPolicy: 'settings.project-policy.apply.v1',
  createProject: 'project.create.v1',
  updateProjectMetadata: 'project.metadata.update.v1',
  archiveProject: 'project.archive.v1',
  restoreProject: 'project.restore.v1',
  requestProjectDeletion: 'project.delete-request.v1',
} as const;

export type Section2FrontendCommandType =
  (typeof SECTION2_FRONTEND_COMMAND_TYPES)[keyof typeof SECTION2_FRONTEND_COMMAND_TYPES];

export type UpdatePreferenceCommandPayload = {
  readonly preferences: Record<string, unknown>;
};

export type ApplyProjectPolicyCommandPayload = {
  readonly settings: Record<string, unknown>;
};

export type CreateProjectCommandPayload = {
  readonly newProjectId: string;
  readonly name: string;
  readonly description?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly privacyProfile?: string;
  readonly modelProfile?: string;
  readonly costProfile?: string;
};

export type UpdateProjectMetadataCommandPayload = {
  readonly name?: string;
  readonly description?: string;
};

export type ProjectLifecycleCommandPayload = Record<string, never>;

export type Section2FrontendCommandPayload =
  | UpdatePreferenceCommandPayload
  | ApplyProjectPolicyCommandPayload
  | CreateProjectCommandPayload
  | UpdateProjectMetadataCommandPayload
  | ProjectLifecycleCommandPayload;

const assertRecordPayload = (value: unknown, commandType: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${commandType} payload must be a non-null object`,
    );
  }
  return value as Record<string, unknown>;
};

const assertOnlyPayloadKeys = (
  payload: Record<string, unknown>,
  commandType: string,
  allowedKeys: readonly string[],
): void => {
  const unexpected = Object.keys(payload).filter((key) => !allowedKeys.includes(key));
  if (unexpected.length > 0) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `${commandType} payload contains unsupported fields: ${unexpected.join(', ')}`,
    );
  }
};

export function decodeSection2CommandPayload(
  commandType: Section2FrontendCommandType,
  value: unknown,
): Section2FrontendCommandPayload {
  const payload = assertRecordPayload(value, commandType);

  switch (commandType) {
    case SECTION2_FRONTEND_COMMAND_TYPES.updatePreference:
      assertOnlyPayloadKeys(payload, commandType, ['preferences']);
      return {
        preferences: assertRecordPayload(payload['preferences'], `${commandType}.preferences`),
      };
    case SECTION2_FRONTEND_COMMAND_TYPES.applyProjectPolicy:
      assertOnlyPayloadKeys(payload, commandType, ['settings']);
      return {
        settings: assertRecordPayload(payload['settings'], `${commandType}.settings`),
      };
    case SECTION2_FRONTEND_COMMAND_TYPES.createProject: {
      assertOnlyPayloadKeys(payload, commandType, [
        'newProjectId',
        'name',
        'description',
        'locale',
        'timezone',
        'privacyProfile',
        'modelProfile',
        'costProfile',
      ]);
      if (typeof payload['newProjectId'] !== 'string' || !payload['newProjectId'].trim()) {
        throw new FrontendContractError('INVALID_REQUEST', 'payload.newProjectId is required');
      }
      if (typeof payload['name'] !== 'string' || !payload['name'].trim()) {
        throw new FrontendContractError('INVALID_REQUEST', 'payload.name is required');
      }
      for (const optionalKey of [
        'description',
        'locale',
        'timezone',
        'privacyProfile',
        'modelProfile',
        'costProfile',
      ]) {
        if (payload[optionalKey] !== undefined && typeof payload[optionalKey] !== 'string') {
          throw new FrontendContractError(
            'INVALID_REQUEST',
            `payload.${optionalKey} must be a string when provided`,
          );
        }
      }
      return payload as CreateProjectCommandPayload;
    }
    case SECTION2_FRONTEND_COMMAND_TYPES.updateProjectMetadata:
      assertOnlyPayloadKeys(payload, commandType, ['name', 'description']);
      if (payload['name'] === undefined && payload['description'] === undefined) {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          'Project metadata update requires name or description',
        );
      }
      if (payload['name'] !== undefined && typeof payload['name'] !== 'string') {
        throw new FrontendContractError('INVALID_REQUEST', 'payload.name must be a string');
      }
      if (payload['description'] !== undefined && typeof payload['description'] !== 'string') {
        throw new FrontendContractError('INVALID_REQUEST', 'payload.description must be a string');
      }
      return payload as UpdateProjectMetadataCommandPayload;
    case SECTION2_FRONTEND_COMMAND_TYPES.archiveProject:
    case SECTION2_FRONTEND_COMMAND_TYPES.restoreProject:
    case SECTION2_FRONTEND_COMMAND_TYPES.requestProjectDeletion:
      assertOnlyPayloadKeys(payload, commandType, []);
      return {};
  }
}

export function validateSection2FrontendCommandRequest(
  input: unknown,
  expectedCommandType: Section2FrontendCommandType,
): FrontendCommandRequest<Section2FrontendCommandPayload> {
  const isNewResource = expectedCommandType === SECTION2_FRONTEND_COMMAND_TYPES.createProject;
  const request = validateFrontendCommandRequest(input, { isNewResource });
  if (request.commandType !== expectedCommandType) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Route requires commandType '${expectedCommandType}', received '${request.commandType}'`,
    );
  }
  if (request.commandSchemaVersion !== '1.0.0') {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Unsupported commandSchemaVersion '${request.commandSchemaVersion}' for '${expectedCommandType}'`,
    );
  }
  return {
    ...request,
    payload: decodeSection2CommandPayload(expectedCommandType, request.payload),
  };
}

export function validateJSONValue(
  val: unknown,
  path = 'payload',
  seen = new WeakSet<object>(),
): void {
  if (val === null || typeof val === 'boolean' || typeof val === 'string') {
    return;
  }
  if (typeof val === 'number') {
    if (Number.isNaN(val) || !Number.isFinite(val)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `JSON-unsafe number (NaN/Infinity) at path '${path}'`,
      );
    }
    return;
  }
  if (
    typeof val === 'undefined' ||
    typeof val === 'symbol' ||
    typeof val === 'bigint' ||
    typeof val === 'function'
  ) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `JSON-unsafe type '${typeof val}' at path '${path}'`,
    );
  }
  if (val instanceof Date) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Date object at path '${path}' is not allowed; pass ISO 8601 string`,
    );
  }
  if (val instanceof Map || val instanceof Set) {
    throw new FrontendContractError('INVALID_REQUEST', `Map/Set at path '${path}' is not allowed`);
  }
  if (typeof val === 'object') {
    const obj = val as object;
    if (seen.has(obj)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `Circular reference detected at path '${path}'`,
      );
    }
    seen.add(obj);

    const proto = Object.getPrototypeOf(obj);
    if (proto !== null && proto !== Object.prototype && !Array.isArray(obj)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `Only plain JSON objects and arrays allowed at path '${path}'`,
      );
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        validateJSONValue(obj[i], `${path}[${i}]`, seen);
      }
    } else {
      for (const key of Object.keys(obj as Record<string, unknown>)) {
        validateJSONValue((obj as Record<string, unknown>)[key], `${path}.${key}`, seen);
      }
    }
    return;
  }
  throw new FrontendContractError('INVALID_REQUEST', `JSON-unsafe value at path '${path}'`);
}

export function validateFrontendCommandRequest(
  input: unknown,
  options?: { readonly isNewResource?: boolean },
): FrontendCommandRequest {
  if (!input || typeof input !== 'object') {
    throw new FrontendContractError('INVALID_REQUEST', 'Command request must be a non-null object');
  }

  const req = input as Record<string, unknown>;

  if ('traceId' in req) {
    throw new FrontendContractError('INVALID_REQUEST', 'Client cannot inject top-level traceId');
  }

  // Client cannot inject server-authoritative fields
  const injectedAuthorityFields = [
    'commandId',
    'principal',
    'actor',
    'security',
    'securityContext',
    'capabilities',
    'internalTraceId',
    'acceptedPrincipalContext',
    'acceptedProjectContext',
    'acceptedPolicyContext',
    'commandSemanticDigest',
  ].filter((field) => field in req);
  if (injectedAuthorityFields.length > 0) {
    throw new FrontendContractError(
      'PRECONDITION_ACCESS_DENIED',
      `Client cannot inject server-authoritative fields: ${injectedAuthorityFields.join(', ')}`,
    );
  }

  if (req['envelopeVersion'] !== '1.0.0') {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Unsupported envelopeVersion: '${req['envelopeVersion']}'`,
    );
  }

  if (typeof req['commandType'] !== 'string' || !req['commandType'].trim()) {
    throw new FrontendContractError('INVALID_REQUEST', 'commandType must be a non-empty string');
  }

  if (typeof req['commandSchemaVersion'] !== 'string' || !req['commandSchemaVersion'].trim()) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'commandSchemaVersion must be a non-empty string',
    );
  }

  if (typeof req['clientRequestId'] !== 'string' || !req['clientRequestId'].trim()) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'clientRequestId must be a non-empty string',
    );
  }

  if (typeof req['idempotencyKey'] !== 'string' || !req['idempotencyKey'].trim()) {
    throw new FrontendContractError('INVALID_REQUEST', 'idempotencyKey must be a non-empty string');
  }

  // Validate Project Context
  if (!req['projectContext'] || typeof req['projectContext'] !== 'object') {
    throw new FrontendContractError('INVALID_REQUEST', 'projectContext must be a non-null object');
  }
  const pctx = req['projectContext'] as Record<string, unknown>;
  if (typeof pctx['activeProjectId'] !== 'string' || !pctx['activeProjectId'].trim()) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'projectContext.activeProjectId must be a non-empty string',
    );
  }
  if (typeof pctx['targetProjectId'] !== 'string' || !pctx['targetProjectId'].trim()) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'projectContext.targetProjectId must be a non-empty string',
    );
  }

  const isNew = options?.isNewResource ?? false;
  if (
    !isNew &&
    (typeof pctx['resourceProjectId'] !== 'string' || !pctx['resourceProjectId'].trim())
  ) {
    throw new FrontendContractError(
      'RESOURCE_PROJECT_MISMATCH',
      'Existing resource modification must specify resourceProjectId in projectContext',
    );
  }
  if (isNew && pctx['targetProjectId'] !== pctx['activeProjectId']) {
    throw new FrontendContractError(
      'RESOURCE_PROJECT_MISMATCH',
      'New resource creation must target the active project',
    );
  }
  if (
    !isNew &&
    pctx['resourceProjectId'] &&
    pctx['targetProjectId'] !== pctx['resourceProjectId']
  ) {
    throw new FrontendContractError(
      'RESOURCE_PROJECT_MISMATCH',
      'Existing resource modification must target the resource project',
    );
  }

  // Validate Policy Binding
  if (!req['policyBinding'] || typeof req['policyBinding'] !== 'object') {
    throw new FrontendContractError('INVALID_REQUEST', 'policyBinding must be a non-null object');
  }
  const pb = req['policyBinding'] as Record<string, unknown>;
  if (pb['mode'] !== 'CURRENT' && pb['mode'] !== 'PINNED_ACCEPTED_CONTEXT') {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Invalid policyBinding mode '${pb['mode']}'`,
    );
  }
  if (
    pb['mode'] === 'PINNED_ACCEPTED_CONTEXT' &&
    (!pb['acceptedPolicyContextId'] || typeof pb['acceptedPolicyContextId'] !== 'string')
  ) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'acceptedPolicyContextId must be provided when policyBinding mode is PINNED_ACCEPTED_CONTEXT',
    );
  }
  if (pb['mode'] === 'CURRENT' && pb['acceptedPolicyContextId']) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'acceptedPolicyContextId must not be provided when policyBinding mode is CURRENT',
    );
  }

  // Validate Preconditions
  if (!Array.isArray(req['preconditions'])) {
    throw new FrontendContractError('INVALID_REQUEST', 'preconditions must be an array');
  }
  const preconditions = req['preconditions'] as TypedPrecondition[];
  const precValidation = validateTypedPreconditions(preconditions);
  if (!precValidation.isValid) {
    throw new FrontendContractError(
      'PRECONDITION_ACCESS_DENIED',
      `Precondition validation failed: ${precValidation.errors.join('; ')}`,
    );
  }

  // Check Projection Kind direct write target
  for (const pc of preconditions) {
    if (pc.purpose === 'TARGET') {
      ProjectionKindRegistry.assertNotWriteableProjectionKind(pc.subject.resourceKind);
    }
  }

  // Validate clientIssuedAt ISO 8601 date string
  if (typeof req['clientIssuedAt'] !== 'string' || isNaN(Date.parse(req['clientIssuedAt']))) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'clientIssuedAt must be a valid ISO 8601 date string',
    );
  }

  // Validate Payload JSON safety
  validateJSONValue(req['payload'], 'payload');

  return req as unknown as FrontendCommandRequest;
}

// ============================================================================
// 7. Command Semantic Digest & Canonicalization Contract
// ============================================================================

export type SemanticDigestProvider = (canonicalJson: string) => Promise<string> | string;

export function deterministicCanonicalizePayload(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => deterministicCanonicalizePayload(item)).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${deterministicCanonicalizePayload((obj as Record<string, unknown>)[k])}`,
  );
  return '{' + entries.join(',') + '}';
}

export function buildCommandSemanticDigestInput<TPayload>(
  request: FrontendCommandRequest<TPayload>,
): string {
  const sortedPreconditions = [...request.preconditions].sort((a, b) => {
    const keyA = `${a.purpose}:${a.subject.resourceKind}:${a.subject.resourceId}`;
    const keyB = `${b.purpose}:${b.subject.resourceKind}:${b.subject.resourceId}`;
    return keyA.localeCompare(keyB);
  });

  const digestPayload = {
    commandType: request.commandType,
    commandSchemaVersion: request.commandSchemaVersion,
    targetProjectId: request.projectContext.targetProjectId,
    resourceProjectId: request.projectContext.resourceProjectId ?? null,
    payload: request.payload,
    preconditions: sortedPreconditions.map((p) => ({
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

  return deterministicCanonicalizePayload(digestPayload);
}

export function buildPrincipalScopedCommandSemanticDigestInput<TPayload>(
  request: FrontendCommandRequest<TPayload>,
  principalId: string,
): string {
  return deterministicCanonicalizePayload({
    principalId,
    request: JSON.parse(buildCommandSemanticDigestInput(request)) as unknown,
  });
}

// ============================================================================
// 8. Outcome Views & Outcome Resolution (Discriminated Union)
// ============================================================================

export type OutcomeState = 'ACCEPTED' | 'COMPLETED' | 'REJECTED' | 'OUTCOME_UNKNOWN';

export type CompletionDisposition = 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'NO_OP';

export type ProducedResourceRef = {
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly resourceRevision?: string;
};

export type CommandRejectionDetail = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly category?: FailureCategory;
  readonly retryability?: FailureRetryability;
  readonly recovery?: FailureRecovery;
  readonly retryable?: boolean;
  readonly correlationId?: string;
};

export type FrontendCommandOutcomeView = {
  readonly commandId: string;
  readonly commandRevision: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly commandType: string;
  readonly commandSchemaVersion: string;
  readonly commandSemanticDigest: string;
  readonly outcomeState: OutcomeState;
  readonly completionDisposition?: CompletionDisposition;
  readonly acceptedPrincipalContext: AcceptedPrincipalContext;
  readonly acceptedProjectContext: AcceptedProjectContext;
  readonly acceptedPolicyContext: AcceptedPolicyContext;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly traceId?: string;
  readonly producedResources: readonly ProducedResourceRef[];
  readonly rejection?: CommandRejectionDetail;
  readonly receivedAt: string;
  readonly acceptedAt?: string;
  readonly completedAt?: string;
  readonly lastUpdatedAt: string;
  readonly eventCursor?: string;
};

export type CommandOutcomeResolution =
  | { readonly resolution: 'FOUND'; readonly outcome: FrontendCommandOutcomeView }
  | { readonly resolution: 'NOT_ACCEPTED_CONFIRMED' }
  | { readonly resolution: 'INDETERMINATE' }
  | {
      readonly resolution: 'RETENTION_EXPIRED';
      readonly lastKnownOutcome?: FrontendCommandOutcomeView;
    };

export type CommandLedgerEntry = {
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly principalId: string;
  readonly targetProjectId: string;
  readonly commandType: string;
  readonly commandSemanticDigest: string;
  readonly outcome: FrontendCommandOutcomeView;
  readonly isDurableAccepted: boolean;
  readonly isRetentionExpired: boolean;
};

export function resolveOutcomeState(
  request: FrontendCommandRequest,
  principalId: string,
  ledgerEntries: readonly CommandLedgerEntry[],
  digest: string,
  serverAcceptanceChecker?: {
    checkServerDurableAcceptance: () =>
      'ACCEPTANCE_CONFIRMED' | 'NO_ACCEPTANCE_CONFIRMED' | 'UNKNOWN';
  },
): CommandOutcomeResolution {
  // Step 1: Scope & ID lookup by clientRequestId
  const byRequestId = ledgerEntries.find((e) => e.clientRequestId === request.clientRequestId);
  if (byRequestId) {
    if (
      byRequestId.principalId !== principalId ||
      byRequestId.targetProjectId !== request.projectContext.targetProjectId ||
      byRequestId.commandType !== request.commandType
    ) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        `clientRequestId '${request.clientRequestId}' found but scope mismatch (principal/project/commandType)`,
      );
    }
    if (byRequestId.commandSemanticDigest !== digest) {
      throw new FrontendContractError(
        'DIGEST_MISMATCH',
        `clientRequestId '${request.clientRequestId}' found but semantic digest mismatch`,
      );
    }
    if (byRequestId.isRetentionExpired) {
      return { resolution: 'RETENTION_EXPIRED', lastKnownOutcome: byRequestId.outcome };
    }
    return { resolution: 'FOUND', outcome: byRequestId.outcome };
  }

  // Step 2: Scope & ID lookup by idempotencyKey
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
    if (byIdempotency.isRetentionExpired) {
      return { resolution: 'RETENTION_EXPIRED', lastKnownOutcome: byIdempotency.outcome };
    }
    return { resolution: 'FOUND', outcome: byIdempotency.outcome };
  }

  // Step 3: Explicit server durable acceptance check
  if (serverAcceptanceChecker) {
    const status = serverAcceptanceChecker.checkServerDurableAcceptance();
    if (status === 'NO_ACCEPTANCE_CONFIRMED') {
      return { resolution: 'NOT_ACCEPTED_CONFIRMED' };
    }
    if (status === 'ACCEPTANCE_CONFIRMED') {
      return { resolution: 'INDETERMINATE' };
    }
  }

  return { resolution: 'INDETERMINATE' };
}

// ============================================================================
// 9. Retry Boundary Classification
// ============================================================================

export type RetryClassification = 'TRANSPORT_RETRY' | 'DOMAIN_RETRY' | 'RETRY_FORBIDDEN';

export function classifyRetry(
  previousRequest: FrontendCommandRequest,
  newRequest: FrontendCommandRequest,
  prevDigest: string,
  newDigest: string,
): RetryClassification {
  const isSameClientReq = previousRequest.clientRequestId === newRequest.clientRequestId;
  const isSameIdempotency = previousRequest.idempotencyKey === newRequest.idempotencyKey;
  const sameDigest = prevDigest === newDigest;
  const hasCausation = Boolean(newRequest.correlationContext?.causationRef?.id);

  if (isSameClientReq && isSameIdempotency && sameDigest) {
    return 'TRANSPORT_RETRY';
  }

  if (!isSameClientReq && !isSameIdempotency && sameDigest && hasCausation) {
    return 'DOMAIN_RETRY';
  }

  return 'RETRY_FORBIDDEN';
}

// ============================================================================
// 10. Mapper: FrontendCommandRequest -> Internal CommandEnvelope
// ============================================================================

export type InternalCommandMappingOptions = {
  readonly frontendCommandId: string;
  readonly internalMessageId: string;
  readonly acceptedPrincipalContext: AcceptedPrincipalContext;
  readonly acceptedProjectContext: AcceptedProjectContext;
  readonly acceptedPolicyContext: AcceptedPolicyContext;
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
  if (options.frontendCommandId === options.internalMessageId) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'frontendCommandId must be decoupled from internalMessageId',
    );
  }

  if (options.acceptedPrincipalContext.principalId !== options.acceptedPrincipalContext.actor.id) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'acceptedPrincipalContext.principalId must match actor.id',
    );
  }

  const validation = validateTypedPreconditions(request.preconditions);
  if (!validation.isValid) {
    throw new FrontendContractError(
      'PRECONDITION_ACCESS_DENIED',
      `Command request mapping failed precondition validation: ${validation.errors.join('; ')}`,
    );
  }

  const causationId = request.correlationContext?.causationRef?.id;

  return {
    messageId: options.internalMessageId,
    messageType: request.commandType,
    messageKind: 'command',
    schemaVersion: request.commandSchemaVersion,
    producerModule: options.producerModule ?? 'shotgun-web-gateway',
    producerVersion: options.producerVersion ?? '1.0.0',
    correlationId: request.correlationContext?.correlationId ?? options.frontendCommandId,
    causationId,
    projectId: options.acceptedProjectContext.targetProjectId,
    idempotencyKey: request.idempotencyKey,
    actor: options.acceptedPrincipalContext.actor,
    security: {
      accessScope: options.accessScope,
      sensitivity: options.sensitivity,
      dataClassification: 'standard',
    },
    provenance: {
      sourceVersionIds: [],
      evidenceIds: [],
      policyVersion: options.acceptedPolicyContext.policyContextRevision,
    },
    payload: request.payload,
    createdAt: new Date().toISOString(),
    traceId: options.traceId,
    orderingKey: `${options.acceptedProjectContext.targetProjectId}:${request.commandType}`,
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
// 12. Session & Auth Boundary State & Sensitive Resource Masking Guard
// ============================================================================

export type AuthenticationState = 'UNAUTHENTICATED' | 'AUTHENTICATING' | 'AUTHENTICATED';

export type SessionState = 'EXPIRED' | 'VALID' | 'REVOKED';

export type ConnectivityState = 'UNKNOWN' | 'ONLINE' | 'OFFLINE' | 'DEGRADED';

export type BackendReadiness = 'UNKNOWN' | 'READY' | 'INITIALIZING' | 'DEGRADED' | 'UNAVAILABLE';

export type ProjectAccessContext = {
  readonly projectId: string;
  readonly capabilities: readonly string[];
};

export type SystemBoundaryContext = {
  readonly authState: AuthenticationState;
  readonly sessionState: SessionState;
  readonly connectivityState: ConnectivityState;
  readonly backendReadiness: BackendReadiness;
  readonly principalId?: string;
  readonly activeProjectId?: string;
  readonly accessibleProjectIds?: readonly string[];
  readonly projectAccessContexts?: readonly ProjectAccessContext[];
  readonly grantedCapabilities: readonly string[];
};

export type OperationRequirement = {
  readonly requiredCapability?: string;
  readonly requiresBackend?: boolean;
  readonly requiresConnectivity?: boolean;
  readonly isSensitiveResource?: boolean;
  readonly resourceProjectId?: string;
};

export type AccessGuardResult = {
  readonly allowed: boolean;
  readonly error?: FrontendContractError;
  readonly treatAsNotFound?: boolean;
};

export function evaluateCapabilityGuard(
  boundaryCtx: SystemBoundaryContext,
  requirement: OperationRequirement,
): AccessGuardResult {
  // Step 1: Auth & principal check
  if (boundaryCtx.authState !== 'AUTHENTICATED' || !boundaryCtx.principalId) {
    return {
      allowed: false,
      error: new FrontendContractError(
        'SESSION_EXPIRED',
        'Authentication required with valid principalId',
      ),
    };
  }

  // Step 2: Session state check
  if (boundaryCtx.sessionState === 'EXPIRED' || boundaryCtx.sessionState === 'REVOKED') {
    return {
      allowed: false,
      error: new FrontendContractError('SESSION_EXPIRED', 'Session expired or revoked'),
    };
  }
  if (boundaryCtx.sessionState !== 'VALID') {
    return {
      allowed: false,
      error: new FrontendContractError(
        'SESSION_EXPIRED',
        `Session non-ready: ${boundaryCtx.sessionState}`,
      ),
    };
  }

  // Step 3: Backend readiness check
  if (requirement.requiresBackend && boundaryCtx.backendReadiness !== 'READY') {
    return {
      allowed: false,
      error: new FrontendContractError('OUTCOME_INDETERMINATE', 'Backend unavailable'),
    };
  }

  // Step 4: Connectivity check
  if (requirement.requiresConnectivity && boundaryCtx.connectivityState === 'OFFLINE') {
    return {
      allowed: false,
      error: new FrontendContractError('OUTCOME_INDETERMINATE', 'Network offline'),
    };
  }

  // Step 5: Resource Project Access Check
  let projectCapList: readonly string[] = [];
  if (requirement.resourceProjectId) {
    const isAccessible =
      boundaryCtx.accessibleProjectIds?.includes(requirement.resourceProjectId) ||
      boundaryCtx.projectAccessContexts?.some((p) => p.projectId === requirement.resourceProjectId);

    if (!isAccessible) {
      if (requirement.isSensitiveResource) {
        return {
          allowed: false,
          treatAsNotFound: true,
          error: new FrontendContractError('RESOURCE_ACCESS_REVOKED', 'Resource not found'),
        };
      }
      return {
        allowed: false,
        error: new FrontendContractError(
          'RESOURCE_ACCESS_REVOKED',
          `Access revoked to project '${requirement.resourceProjectId}'`,
        ),
      };
    }

    const matchingProjectAccess = boundaryCtx.projectAccessContexts?.find(
      (p) => p.projectId === requirement.resourceProjectId,
    );
    if (matchingProjectAccess) {
      projectCapList = matchingProjectAccess.capabilities;
    }
  }

  // Step 6: Capability check
  if (requirement.requiredCapability) {
    const hasGlobalCap = boundaryCtx.grantedCapabilities.includes(requirement.requiredCapability);
    const hasProjectCap = projectCapList.includes(requirement.requiredCapability);

    if (!hasGlobalCap && !hasProjectCap) {
      if (requirement.isSensitiveResource) {
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
          `Capability '${requirement.requiredCapability}' denied`,
        ),
      };
    }
  }

  return { allowed: true };
}

// ============================================================================
// 13. Operational Resource Kind Registry & Server Snapshot Runtime Validation
// ============================================================================

export type SupportState = 'SUPPORTED' | 'EXPERIMENTAL' | 'UNKNOWN' | 'UNSUPPORTED';
export type RegistryState = 'UNAVAILABLE' | 'NOT_LOADED' | 'READY';

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
  readonly supportState?: SupportState;
  readonly originalKind?: string;
};

export type OperationalResourceKindRegistrySnapshot = {
  readonly registryRevision: string;
  readonly concreteKinds: readonly OperationalResourceKindDescriptor[];
  readonly aggregateKinds: readonly OperationalResourceKindDescriptor[];
  readonly stateOrStageSchema: Record<string, string>;
  readonly routeDescriptor: Record<string, string>;
  readonly eligibility: Record<string, boolean>;
  readonly sensitivityClass: Record<string, string>;
  readonly retentionClass: Record<string, string>;
  readonly requiredCapabilities: Record<string, readonly string[]>;
  readonly requiredFeatures: Record<string, readonly string[]>;
};

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function decodeOperationalResourceKindRegistrySnapshot(
  input: unknown,
): OperationalResourceKindRegistrySnapshot {
  if (!isPlainObject(input)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'Registry snapshot must be a non-null plain object',
    );
  }

  const s = input as Record<string, unknown>;

  if (typeof s['registryRevision'] !== 'string' || !s['registryRevision'].trim()) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'registryRevision must be a non-empty string',
    );
  }

  if (!Array.isArray(s['concreteKinds']) || !Array.isArray(s['aggregateKinds'])) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'concreteKinds and aggregateKinds must be arrays',
    );
  }

  const concreteKinds = s['concreteKinds'] as unknown[];
  const aggregateKinds = s['aggregateKinds'] as unknown[];

  const seenKinds = new Set<string>();

  const validateDescriptor = (
    d: unknown,
    expectedIsConcrete: boolean,
    indexName: string,
  ): OperationalResourceKindDescriptor => {
    if (!isPlainObject(d)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `${indexName} descriptor must be a plain object`,
      );
    }
    const desc = d as Record<string, unknown>;

    if (typeof desc['kind'] !== 'string' || !desc['kind'].trim()) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `${indexName}.kind must be a non-empty string`,
      );
    }
    if (seenKinds.has(desc['kind'])) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `Duplicate kind '${desc['kind']}' in registry snapshot`,
      );
    }
    seenKinds.add(desc['kind']);

    if (typeof desc['family'] !== 'string' || !desc['family'].trim()) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `${indexName}.family must be a non-empty string`,
      );
    }

    if (typeof desc['isConcrete'] !== 'boolean' || desc['isConcrete'] !== expectedIsConcrete) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `${indexName}.isConcrete flag mismatch: expected ${expectedIsConcrete}`,
      );
    }

    if (desc['projectScope'] !== 'PROJECT_SCOPED' && desc['projectScope'] !== 'GLOBAL_SCOPED') {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `${indexName}.projectScope must be 'PROJECT_SCOPED' or 'GLOBAL_SCOPED'`,
      );
    }

    if (
      typeof desc['snapshotSchemaVersion'] !== 'string' ||
      !desc['snapshotSchemaVersion'].trim()
    ) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `${indexName}.snapshotSchemaVersion must be a non-empty string`,
      );
    }

    if (typeof desc['deepLinkDescriptor'] !== 'string') {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `${indexName}.deepLinkDescriptor must be a string`,
      );
    }

    if (typeof desc['outcomeCapability'] !== 'boolean') {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `${indexName}.outcomeCapability must be a boolean`,
      );
    }

    const validSensitivities = new Set(['public', 'internal', 'private', 'restricted']);
    if (
      typeof desc['sensitivityClass'] !== 'string' ||
      !validSensitivities.has(desc['sensitivityClass'])
    ) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `${indexName}.sensitivityClass must be 'public', 'internal', 'private', or 'restricted'`,
      );
    }

    if (
      !Array.isArray(desc['supportedActions']) ||
      !desc['supportedActions'].every((a) => typeof a === 'string')
    ) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `${indexName}.supportedActions must be an array of strings`,
      );
    }

    if (desc['supportState'] !== undefined) {
      const validSupportStates = new Set(['SUPPORTED', 'EXPERIMENTAL', 'UNKNOWN', 'UNSUPPORTED']);
      if (
        typeof desc['supportState'] !== 'string' ||
        !validSupportStates.has(desc['supportState'])
      ) {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          `${indexName}.supportState must be 'SUPPORTED', 'EXPERIMENTAL', 'UNKNOWN', or 'UNSUPPORTED'`,
        );
      }
    }

    if (desc['originalKind'] !== undefined) {
      if (typeof desc['originalKind'] !== 'string' || !desc['originalKind'].trim()) {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          `${indexName}.originalKind must be a non-empty string`,
        );
      }
    }

    const frozenSupportedActions = Object.freeze([...(desc['supportedActions'] as string[])]);
    return Object.freeze({
      kind: desc['kind'] as string,
      family: desc['family'] as string,
      isConcrete: desc['isConcrete'] as boolean,
      projectScope: desc['projectScope'] as 'PROJECT_SCOPED' | 'GLOBAL_SCOPED',
      snapshotSchemaVersion: desc['snapshotSchemaVersion'] as string,
      deepLinkDescriptor: desc['deepLinkDescriptor'] as string,
      outcomeCapability: desc['outcomeCapability'] as boolean,
      sensitivityClass: desc['sensitivityClass'] as
        'public' | 'internal' | 'private' | 'restricted',
      supportedActions: frozenSupportedActions,
      ...(desc['supportState'] !== undefined
        ? { supportState: desc['supportState'] as SupportState }
        : {}),
      ...(desc['originalKind'] !== undefined
        ? { originalKind: desc['originalKind'] as string }
        : {}),
    });
  };

  const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  const validateRecordField = <T>(
    val: unknown,
    fieldName: string,
    valValidator: (v: unknown) => boolean,
  ): Record<string, T> => {
    if (!isPlainObject(val)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `Snapshot record field '${fieldName}' must be a plain object`,
      );
    }
    const rec = val as Record<string, unknown>;
    const res = Object.create(null) as Record<string, T>;
    for (const key of Object.keys(rec)) {
      if (!key.trim()) {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          `Snapshot record field '${fieldName}' contains an empty key`,
        );
      }
      if (FORBIDDEN_RECORD_KEYS.has(key)) {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          `Snapshot record field '${fieldName}' contains forbidden key '${key}'`,
        );
      }
      if (!valValidator(rec[key])) {
        throw new FrontendContractError(
          'INVALID_REQUEST',
          `Snapshot record field '${fieldName}[${key}]' has invalid runtime type`,
        );
      }
      res[key] = rec[key] as T;
    }
    return res;
  };

  const stateOrStageSchema = Object.freeze(
    validateRecordField<string>(
      s['stateOrStageSchema'],
      'stateOrStageSchema',
      (v) => typeof v === 'string',
    ),
  );
  const routeDescriptor = Object.freeze(
    validateRecordField<string>(
      s['routeDescriptor'],
      'routeDescriptor',
      (v) => typeof v === 'string',
    ),
  );
  const eligibility = Object.freeze(
    validateRecordField<boolean>(s['eligibility'], 'eligibility', (v) => typeof v === 'boolean'),
  );
  const sensitivityClass = Object.freeze(
    validateRecordField<string>(
      s['sensitivityClass'],
      'sensitivityClass',
      (v) => typeof v === 'string',
    ),
  );
  const retentionClass = Object.freeze(
    validateRecordField<string>(
      s['retentionClass'],
      'retentionClass',
      (v) => typeof v === 'string',
    ),
  );

  const rawReqCaps = validateRecordField<unknown>(
    s['requiredCapabilities'],
    'requiredCapabilities',
    (v) => Array.isArray(v) && v.every((item) => typeof item === 'string'),
  );
  const requiredCapabilities = Object.create(null) as Record<string, readonly string[]>;
  for (const [k, v] of Object.entries(rawReqCaps)) {
    requiredCapabilities[k] = Object.freeze([...(v as string[])]);
  }
  const frozenRequiredCapabilities = Object.freeze(requiredCapabilities);

  const rawReqFeats = validateRecordField<unknown>(
    s['requiredFeatures'],
    'requiredFeatures',
    (v) => Array.isArray(v) && v.every((item) => typeof item === 'string'),
  );
  const requiredFeatures = Object.create(null) as Record<string, readonly string[]>;
  for (const [k, v] of Object.entries(rawReqFeats)) {
    requiredFeatures[k] = Object.freeze([...(v as string[])]);
  }
  const frozenRequiredFeatures = Object.freeze(requiredFeatures);

  const validatedConcreteKinds = Object.freeze(
    concreteKinds.map((d, i) => validateDescriptor(d, true, `concreteKinds[${i}]`)),
  );
  const validatedAggregateKinds = Object.freeze(
    aggregateKinds.map((d, i) => validateDescriptor(d, false, `aggregateKinds[${i}]`)),
  );

  return Object.freeze({
    registryRevision: s['registryRevision'] as string,
    concreteKinds: validatedConcreteKinds,
    aggregateKinds: validatedAggregateKinds,
    stateOrStageSchema,
    routeDescriptor,
    eligibility,
    sensitivityClass,
    retentionClass,
    requiredCapabilities: frozenRequiredCapabilities,
    requiredFeatures: frozenRequiredFeatures,
  });
}

export class OperationalResourceKindRegistryInstance {
  readonly registryState: RegistryState;
  readonly registryRevision: string;
  private readonly concreteKinds: readonly OperationalResourceKindDescriptor[];
  private readonly aggregateKinds: readonly OperationalResourceKindDescriptor[];

  constructor(snapshotInput?: unknown) {
    if (!snapshotInput) {
      this.registryState = 'NOT_LOADED';
      this.registryRevision = 'none';
      this.concreteKinds = Object.freeze([]);
      this.aggregateKinds = Object.freeze([]);
    } else {
      const validated = decodeOperationalResourceKindRegistrySnapshot(snapshotInput);
      this.registryState = 'READY';
      this.registryRevision = validated.registryRevision;
      this.concreteKinds = validated.concreteKinds;
      this.aggregateKinds = validated.aggregateKinds;
    }
  }

  get(kind: string): OperationalResourceKindDescriptor {
    const foundConcrete = this.concreteKinds.find((k) => k.kind === kind);
    if (foundConcrete) return foundConcrete;

    const foundAggregate = this.aggregateKinds.find((k) => k.kind === kind);
    if (foundAggregate) return foundAggregate;

    return Object.freeze({
      kind: `UNKNOWN_${kind}`,
      originalKind: kind,
      family: 'UNKNOWN',
      isConcrete: false,
      projectScope: 'PROJECT_SCOPED',
      snapshotSchemaVersion: '0.0.0',
      deepLinkDescriptor: '',
      outcomeCapability: false,
      sensitivityClass: 'internal',
      supportedActions: Object.freeze([]) as readonly string[],
      supportState: 'UNKNOWN',
    });
  }

  isConcrete(kind: string): boolean {
    return this.concreteKinds.some((k) => k.kind === kind);
  }

  listConcrete(): readonly OperationalResourceKindDescriptor[] {
    return this.concreteKinds;
  }

  listAggregate(): readonly OperationalResourceKindDescriptor[] {
    return this.aggregateKinds;
  }
}

export function createOperationalResourceKindRegistry(
  snapshotInput?: unknown,
): OperationalResourceKindRegistryInstance {
  return new OperationalResourceKindRegistryInstance(snapshotInput);
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
// 15. Cache Key Factory & Project Cache Missing-ID Boundary
// ============================================================================

export type CacheKeyScope = 'project' | 'principal-global';

export type CacheKeyFactoryParams = {
  readonly scope: CacheKeyScope;
  readonly principalId: string;
  readonly sessionIdOrRevision: string;
  readonly accessScopeRevision: string;
  readonly sensitivityPolicyRevision: string;
  readonly policyContextRevision: string;
  readonly featurePolicyRevision: string;
  readonly retentionPolicyRevision: string;
  readonly resourceKind: string;
  readonly activeProjectId?: string;
  readonly resourceProjectId?: string;
  readonly resourceId?: string;
  readonly resourceRevision?: string;
};

export type CacheKeyQueryTuple = readonly (string | Record<string, string | undefined>)[];

export function buildCacheKey(params: CacheKeyFactoryParams): CacheKeyQueryTuple {
  const scopePrefix = params.scope === 'project' ? 'project-cache' : 'global-cache';
  let targetProject: string;

  if (params.scope === 'project') {
    const projId = params.resourceProjectId ?? params.activeProjectId;
    if (!projId || !projId.trim()) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        'Project-scoped cache key requires resourceProjectId or activeProjectId',
      );
    }
    targetProject = projId;
  } else {
    targetProject = 'global';
  }

  const revisions = {
    access: params.accessScopeRevision,
    sensitivity: params.sensitivityPolicyRevision,
    policy: params.policyContextRevision,
    feature: params.featurePolicyRevision,
    retention: params.retentionPolicyRevision,
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
  readonly retainedOtherProjectKeys: readonly CacheKeyQueryTuple[];
} {
  const validKeys: CacheKeyQueryTuple[] = [];
  const retainedOtherProjectKeys: CacheKeyQueryTuple[] = [];

  for (const key of keys) {
    const scopePrefix = key[0];
    const project = key[1];

    if (scopePrefix === 'global-cache') {
      validKeys.push(key);
    } else if (project === newActiveProjectId) {
      validKeys.push(key);
    } else {
      retainedOtherProjectKeys.push(key);
    }
  }

  return { validKeys, retainedOtherProjectKeys };
}

export function purgeInaccessibleCachesOnAccessChange(
  keys: readonly CacheKeyQueryTuple[],
  revokedProjectIds: readonly string[],
): {
  readonly validKeys: readonly CacheKeyQueryTuple[];
  readonly purgedKeys: readonly CacheKeyQueryTuple[];
} {
  const validKeys: CacheKeyQueryTuple[] = [];
  const purgedKeys: CacheKeyQueryTuple[] = [];
  const revokedSet = new Set(revokedProjectIds);

  for (const key of keys) {
    const project = key[1];
    if (typeof project === 'string' && revokedSet.has(project)) {
      purgedKeys.push(key);
    } else {
      validKeys.push(key);
    }
  }

  return { validKeys, purgedKeys };
}

export function calculateCacheInvalidationOnPolicyChange(
  keys: readonly CacheKeyQueryTuple[],
  previousPolicyRevisions: {
    readonly accessScopeRevision: string;
    readonly sensitivityPolicyRevision: string;
    readonly policyContextRevision: string;
    readonly featurePolicyRevision: string;
    readonly retentionPolicyRevision: string;
  },
  currentPolicyRevisions: {
    readonly accessScopeRevision: string;
    readonly sensitivityPolicyRevision: string;
    readonly policyContextRevision: string;
    readonly featurePolicyRevision: string;
    readonly retentionPolicyRevision: string;
  },
): {
  readonly validKeys: readonly CacheKeyQueryTuple[];
  readonly invalidatedKeys: readonly CacheKeyQueryTuple[];
} {
  const validKeys: CacheKeyQueryTuple[] = [];
  const invalidatedKeys: CacheKeyQueryTuple[] = [];

  const isAccessChanged =
    previousPolicyRevisions.accessScopeRevision !== currentPolicyRevisions.accessScopeRevision;
  const isSensitivityChanged =
    previousPolicyRevisions.sensitivityPolicyRevision !==
    currentPolicyRevisions.sensitivityPolicyRevision;
  const isPolicyChanged =
    previousPolicyRevisions.policyContextRevision !== currentPolicyRevisions.policyContextRevision;
  const isFeatureChanged =
    previousPolicyRevisions.featurePolicyRevision !== currentPolicyRevisions.featurePolicyRevision;
  const isRetentionChanged =
    previousPolicyRevisions.retentionPolicyRevision !==
    currentPolicyRevisions.retentionPolicyRevision;

  const hasAnyPolicyChange =
    isAccessChanged ||
    isSensitivityChanged ||
    isPolicyChanged ||
    isFeatureChanged ||
    isRetentionChanged;

  for (const key of keys) {
    if (hasAnyPolicyChange) {
      invalidatedKeys.push(key);
    } else {
      validKeys.push(key);
    }
  }

  return { validKeys, invalidatedKeys };
}

// ============================================================================
// 18. Session Boundary View, Leave Guard & Decoder
// ============================================================================

export type ProductSessionView = {
  readonly apiVersion: '1.0.0';
  readonly principal: {
    readonly id: string;
    readonly actor: {
      readonly type: 'user' | 'service';
      readonly id: string;
    };
    readonly authenticationMethod: 'session' | 'development';
  };
  readonly activeProject: { readonly id: string };
  readonly accessibleProjects: readonly {
    readonly id: string;
    readonly isOwner: boolean;
  }[];
  readonly session: { readonly expiresAt: string | null };
};

export type SessionBoundaryReasonCode =
  | 'LOCAL_SESSION_ESTABLISHING'
  | 'LOCAL_SESSION_READY'
  | 'LOCAL_SESSION_REESTABLISHING'
  | 'LOCAL_SERVER_UNAVAILABLE'
  | 'LOCAL_OWNER_DISABLED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'PROVISIONING_FAILED'
  | 'SESSION_REVOKED';

export type SessionBoundaryConnectivityState = 'UNKNOWN' | 'ONLINE' | 'OFFLINE';

export type SessionBoundaryAuthenticationState =
  'authenticated' | 'authentication_required' | 'authentication_unavailable';

export type SessionBoundarySessionState =
  'ESTABLISHING' | 'READY' | 'REESTABLISHING' | 'REVOKED' | 'UNAVAILABLE';

export type SessionBoundaryBackendReadiness = 'UNKNOWN' | 'READY' | 'DEGRADED' | 'UNAVAILABLE';

export type SessionRecoveryActionId = 'RECONNECT' | 'CHECK_LOCAL_SERVER' | 'CHECK_SETTINGS';

export type SessionRecoveryAction = {
  readonly id: SessionRecoveryActionId;
  readonly label: string;
  readonly enabled: boolean;
};

export type SessionBoundaryView = {
  readonly schemaVersion: '1.0.0';
  readonly authenticationAdapter: 'local_owner' | 'interactive';
  readonly connectivityState: SessionBoundaryConnectivityState;
  readonly authenticationState: SessionBoundaryAuthenticationState;
  readonly sessionState: SessionBoundarySessionState;
  readonly backendReadiness: SessionBoundaryBackendReadiness;
  readonly reasonCode?: SessionBoundaryReasonCode;
  readonly recoveryActions: readonly SessionRecoveryAction[];
  readonly session: ProductSessionView | null;
};

export type WorkspaceLeaveState = {
  readonly canLeaveCurrentContext: boolean;
  readonly hasUnsavedDraft: boolean;
  readonly hasBlockingDialog: boolean;
  readonly hasOutcomeUnknownCommand: boolean;
};

export type WorkspaceLeaveGuard = () => WorkspaceLeaveState;

export function decodeProductSessionView(input: unknown): ProductSessionView {
  if (!isPlainObject(input)) {
    throw new FrontendContractError('INVALID_REQUEST', 'ProductSessionView must be a plain object');
  }
  const s = input as Record<string, unknown>;
  if (s['apiVersion'] !== '1.0.0') {
    throw new FrontendContractError('INVALID_REQUEST', "apiVersion must be '1.0.0'");
  }
  if (!isPlainObject(s['principal'])) {
    throw new FrontendContractError('INVALID_REQUEST', 'principal must be a plain object');
  }
  const pr = s['principal'] as Record<string, unknown>;
  if (typeof pr['id'] !== 'string' || !pr['id'].trim()) {
    throw new FrontendContractError('INVALID_REQUEST', 'principal.id must be a non-empty string');
  }
  if (!isPlainObject(pr['actor'])) {
    throw new FrontendContractError('INVALID_REQUEST', 'principal.actor must be a plain object');
  }
  const act = pr['actor'] as Record<string, unknown>;
  if (act['type'] !== 'user' && act['type'] !== 'service') {
    throw new FrontendContractError('INVALID_REQUEST', "actor.type must be 'user' or 'service'");
  }
  if (typeof act['id'] !== 'string' || !act['id'].trim()) {
    throw new FrontendContractError('INVALID_REQUEST', 'actor.id must be a non-empty string');
  }
  if (pr['authenticationMethod'] !== 'session' && pr['authenticationMethod'] !== 'development') {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      "authenticationMethod must be 'session' or 'development'",
    );
  }

  if (!isPlainObject(s['activeProject'])) {
    throw new FrontendContractError('INVALID_REQUEST', 'activeProject must be a plain object');
  }
  const ap = s['activeProject'] as Record<string, unknown>;
  if (typeof ap['id'] !== 'string' || !ap['id'].trim()) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'activeProject.id must be a non-empty string',
    );
  }

  if (!Array.isArray(s['accessibleProjects'])) {
    throw new FrontendContractError('INVALID_REQUEST', 'accessibleProjects must be an array');
  }
  const accProjects = (s['accessibleProjects'] as unknown[]).map((p, idx) => {
    if (!isPlainObject(p)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `accessibleProjects[${idx}] must be a plain object`,
      );
    }
    const item = p as Record<string, unknown>;
    if (typeof item['id'] !== 'string' || !item['id'].trim()) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `accessibleProjects[${idx}].id must be a string`,
      );
    }
    if (typeof item['isOwner'] !== 'boolean') {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `accessibleProjects[${idx}].isOwner must be boolean`,
      );
    }
    return Object.freeze({ id: item['id'] as string, isOwner: item['isOwner'] as boolean });
  });
  if (!isPlainObject(s['session'])) {
    throw new FrontendContractError('INVALID_REQUEST', 'session must be a plain object');
  }
  const sess = s['session'] as Record<string, unknown>;
  if (sess['expiresAt'] !== null && typeof sess['expiresAt'] !== 'string') {
    throw new FrontendContractError('INVALID_REQUEST', 'session.expiresAt must be string or null');
  }

  if (!accProjects.some((p) => p.id === (ap['id'] as string))) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `activeProject '${ap['id']}' must be included in accessibleProjects`,
    );
  }

  return Object.freeze({
    apiVersion: '1.0.0',
    principal: Object.freeze({
      id: pr['id'] as string,
      actor: Object.freeze({
        type: act['type'] as 'user' | 'service',
        id: act['id'] as string,
      }),
      authenticationMethod: pr['authenticationMethod'] as 'session' | 'development',
    }),
    activeProject: Object.freeze({ id: ap['id'] as string }),
    accessibleProjects: Object.freeze(accProjects),
    session: Object.freeze({ expiresAt: (sess['expiresAt'] as string | null) ?? null }),
  });
}

export function decodeSessionBoundaryView(input: unknown): SessionBoundaryView {
  if (!isPlainObject(input)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SessionBoundaryView must be a plain object',
    );
  }
  const b = input as Record<string, unknown>;
  if (b['schemaVersion'] !== '1.0.0') {
    throw new FrontendContractError('INVALID_REQUEST', "schemaVersion must be '1.0.0'");
  }
  if (
    b['authenticationAdapter'] !== 'local_owner' &&
    b['authenticationAdapter'] !== 'interactive'
  ) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      "authenticationAdapter must be 'local_owner' or 'interactive'",
    );
  }

  const validConn = new Set(['UNKNOWN', 'ONLINE', 'OFFLINE']);
  if (typeof b['connectivityState'] !== 'string' || !validConn.has(b['connectivityState'])) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Invalid connectivityState '${b['connectivityState']}'`,
    );
  }

  const validAuth = new Set([
    'authenticated',
    'authentication_required',
    'authentication_unavailable',
  ]);
  if (typeof b['authenticationState'] !== 'string' || !validAuth.has(b['authenticationState'])) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Invalid authenticationState '${b['authenticationState']}'`,
    );
  }

  const validSessState = new Set([
    'ESTABLISHING',
    'READY',
    'REESTABLISHING',
    'REVOKED',
    'UNAVAILABLE',
  ]);
  if (typeof b['sessionState'] !== 'string' || !validSessState.has(b['sessionState'])) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Invalid sessionState '${b['sessionState']}'`,
    );
  }

  const validBackend = new Set(['UNKNOWN', 'READY', 'DEGRADED', 'UNAVAILABLE']);
  if (typeof b['backendReadiness'] !== 'string' || !validBackend.has(b['backendReadiness'])) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Invalid backendReadiness '${b['backendReadiness']}'`,
    );
  }

  if (b['reasonCode'] !== undefined) {
    const validReasons = new Set([
      'LOCAL_SESSION_ESTABLISHING',
      'LOCAL_SESSION_READY',
      'LOCAL_SESSION_REESTABLISHING',
      'LOCAL_SERVER_UNAVAILABLE',
      'LOCAL_OWNER_DISABLED',
      'ORIGIN_NOT_ALLOWED',
      'PROVISIONING_FAILED',
      'SESSION_REVOKED',
    ]);
    if (typeof b['reasonCode'] !== 'string' || !validReasons.has(b['reasonCode'])) {
      throw new FrontendContractError('INVALID_REQUEST', `Invalid reasonCode '${b['reasonCode']}'`);
    }
  }

  if (!Array.isArray(b['recoveryActions'])) {
    throw new FrontendContractError('INVALID_REQUEST', 'recoveryActions must be an array');
  }

  const validActionIds = new Set(['RECONNECT', 'CHECK_LOCAL_SERVER', 'CHECK_SETTINGS']);
  const seenActionIds = new Set<string>();
  const actions = (b['recoveryActions'] as unknown[]).map((act, idx) => {
    if (!isPlainObject(act)) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `recoveryActions[${idx}] must be a plain object`,
      );
    }
    const a = act as Record<string, unknown>;
    if (typeof a['id'] !== 'string' || !validActionIds.has(a['id'])) {
      throw new FrontendContractError('INVALID_REQUEST', `recoveryActions[${idx}].id is invalid`);
    }
    if (seenActionIds.has(a['id'])) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `Duplicate recoveryAction id '${a['id']}'`,
      );
    }
    seenActionIds.add(a['id']);

    if (typeof a['label'] !== 'string' || !a['label'].trim()) {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `recoveryActions[${idx}].label must be a non-empty string`,
      );
    }
    if (typeof a['enabled'] !== 'boolean') {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `recoveryActions[${idx}].enabled must be boolean`,
      );
    }
    return Object.freeze({
      id: a['id'] as SessionRecoveryActionId,
      label: a['label'] as string,
      enabled: a['enabled'] as boolean,
    });
  });

  let sessionObj: ProductSessionView | null = null;
  if (b['session'] !== null && b['session'] !== undefined) {
    sessionObj = decodeProductSessionView(b['session']);
  }

  const sessionStateStr = b['sessionState'] as string;
  const authStateStr = b['authenticationState'] as string;
  const reasonCodeStr = b['reasonCode'] as string | undefined;

  // Invariant 1: READY requires authenticated state and non-null session
  if (sessionStateStr === 'READY') {
    if (!sessionObj || authStateStr !== 'authenticated') {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        "Session state 'READY' requires authenticated state and valid session object",
      );
    }
    if (reasonCodeStr !== undefined && reasonCodeStr !== 'LOCAL_SESSION_READY') {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        "Session state 'READY' requires reasonCode 'LOCAL_SESSION_READY'",
      );
    }
  }

  // Invariant 2: ESTABLISHING requires reasonCode 'LOCAL_SESSION_ESTABLISHING'
  if (sessionStateStr === 'ESTABLISHING' && reasonCodeStr !== 'LOCAL_SESSION_ESTABLISHING') {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      "Session state 'ESTABLISHING' requires reasonCode 'LOCAL_SESSION_ESTABLISHING'",
    );
  }

  // Invariant 3: REESTABLISHING requires reasonCode 'LOCAL_SESSION_REESTABLISHING'
  if (sessionStateStr === 'REESTABLISHING' && reasonCodeStr !== 'LOCAL_SESSION_REESTABLISHING') {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      "Session state 'REESTABLISHING' requires reasonCode 'LOCAL_SESSION_REESTABLISHING'",
    );
  }

  // Invariant 4: REVOKED requires reasonCode 'SESSION_REVOKED'
  if (sessionStateStr === 'REVOKED' && reasonCodeStr !== 'SESSION_REVOKED') {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      "Session state 'REVOKED' requires reasonCode 'SESSION_REVOKED'",
    );
  }

  // Invariant 5: Unavailable reason codes require sessionState 'UNAVAILABLE'
  const unavailReasons = new Set([
    'LOCAL_SERVER_UNAVAILABLE',
    'LOCAL_OWNER_DISABLED',
    'ORIGIN_NOT_ALLOWED',
    'PROVISIONING_FAILED',
  ]);
  if (reasonCodeStr !== undefined && unavailReasons.has(reasonCodeStr)) {
    if (sessionStateStr !== 'UNAVAILABLE') {
      throw new FrontendContractError(
        'INVALID_REQUEST',
        `reasonCode '${reasonCodeStr}' requires sessionState 'UNAVAILABLE'`,
      );
    }
  }

  if (authStateStr === 'authenticated' && !sessionObj) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      "Authentication state 'authenticated' requires valid session object",
    );
  }

  if (authStateStr === 'authentication_unavailable' && !reasonCodeStr) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      "Authentication state 'authentication_unavailable' requires reasonCode",
    );
  }

  return Object.freeze({
    schemaVersion: '1.0.0',
    authenticationAdapter: b['authenticationAdapter'] as 'local_owner' | 'interactive',
    connectivityState: b['connectivityState'] as SessionBoundaryConnectivityState,
    authenticationState: authStateStr as SessionBoundaryAuthenticationState,
    sessionState: sessionStateStr as SessionBoundarySessionState,
    backendReadiness: b['backendReadiness'] as SessionBoundaryBackendReadiness,
    reasonCode: reasonCodeStr as SessionBoundaryReasonCode | undefined,
    recoveryActions: actions as readonly SessionRecoveryAction[],
    session: sessionObj,
  });
}

// ============================================================================
// 10. Frontend Phase 1 Section 2 — Settings & Project Administration Contracts
// ============================================================================

export type SettingsScope = 'PRINCIPAL' | 'PROJECT' | 'SYSTEM' | 'RESOURCE';

export type SettingsApplicationMode =
  | 'IMMEDIATE'
  | 'CONFIRM_REQUIRED'
  | 'REVIEW_REQUIRED'
  | 'RESTART_REQUIRED'
  | 'MIGRATION_REQUIRED'
  | 'READ_ONLY'
  | 'UNAVAILABLE';

export type SettingsRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type SettingsDraftState =
  | 'CLEAN'
  | 'DIRTY'
  | 'VALIDATING'
  | 'READY_TO_APPLY'
  | 'APPLYING'
  | 'APPLIED'
  | 'REVIEW_REQUIRED'
  | 'OUTCOME_UNKNOWN'
  | 'VALIDATION_FAILED'
  | 'APPLY_FAILED'
  | 'STALE';

export type ProjectLifecycleStatus =
  | 'ACTIVE'
  | 'ARCHIVING'
  | 'ARCHIVED'
  | 'RESTORING'
  | 'DELETE_REQUESTED'
  | 'DELETING'
  | 'DELETED'
  | 'RECOVERY_REQUIRED';

export type SettingCapability = {
  readonly canEdit: boolean;
  readonly canReset: boolean;
  readonly canProposeReview: boolean;
  readonly disabledReason?: string;
};

export type SettingValue =
  string | number | boolean | readonly string[] | Record<string, unknown> | null;

export type SettingDescriptor = {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly scope: SettingsScope;
  readonly category: string;
  readonly valueType: 'string' | 'number' | 'boolean' | 'string_array' | 'json';
  readonly currentValue: SettingValue;
  readonly defaultValue: SettingValue;
  readonly applicationMode: SettingsApplicationMode;
  readonly riskLevel: SettingsRiskLevel;
  readonly capability: SettingCapability;
  readonly options?: readonly { readonly label: string; readonly value: string }[];
  readonly isSecret?: boolean;
};

export type SettingsCategorySummary = {
  readonly categoryId: string;
  readonly label: string;
  readonly description: string;
  readonly scope: SettingsScope;
  readonly totalSettingsCount: number;
  readonly actionRequiredCount: number;
  readonly warningCount: number;
  readonly applicationMode: SettingsApplicationMode;
  readonly capability: SettingCapability;
  readonly lastModifiedAt: string | null;
};

export type SettingsSnapshot = {
  readonly schemaVersion: '1.0.0';
  readonly targetProjectId: string;
  readonly settingsRevision: number;
  readonly policyContextRevision: number;
  readonly categories: readonly SettingsCategorySummary[];
  readonly settings: readonly SettingDescriptor[];
  readonly fetchedAt: string;
};

export type SettingsValidationResult = {
  readonly isValid: boolean;
  readonly errors: readonly { readonly key: string; readonly message: string }[];
  readonly warnings: readonly { readonly key: string; readonly message: string }[];
};

export type SettingsImpactPreview = {
  readonly targetProjectId: string;
  readonly expectedRevision: number;
  readonly applicationMode: SettingsApplicationMode;
  readonly requiresConfirmation: boolean;
  readonly requiresReview: boolean;
  readonly requiresMigration: boolean;
  readonly requiresRestart: boolean;
  readonly riskLevel: SettingsRiskLevel;
  readonly affectedComponents: readonly string[];
  readonly affectedResources: readonly string[];
  readonly retrospectiveEffect: string;
  readonly summaryDescription: string;
};

export type SettingsCommandStatus =
  'PENDING' | 'APPLIED' | 'REVIEW_REQUIRED' | 'FAILED' | 'OUTCOME_UNKNOWN';

export type SettingsCommandResult = {
  readonly commandId: string;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly status: SettingsCommandStatus;
  readonly appliedRevision?: number;
  readonly reviewProposalId?: string;
  readonly errorMessage?: string;
  readonly completedAt?: string;
  /** Project binding — used server-side for authorization; not required in all views */
  readonly projectId?: string;
};

export type ProjectCapabilityView = {
  readonly canRename: boolean;
  readonly canArchive: boolean;
  readonly canRestore: boolean;
  readonly canDelete: boolean;
  readonly canManagePolicies: boolean;
  readonly disabledReason?: string;
};

export type ProjectListItemView = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly isOwner: boolean;
  readonly status: ProjectLifecycleStatus;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly capability: ProjectCapabilityView;
};

export type ProjectAdministrationView = {
  readonly schemaVersion: '1.0.0';
  readonly projects: readonly ProjectListItemView[];
};

export type ProductFeatureView<T> =
  | {
      readonly availability: 'AVAILABLE';
      readonly data: T;
    }
  | {
      readonly availability: 'UNAVAILABLE';
      readonly applicationMode: 'UNAVAILABLE';
      readonly disabledReason: string;
    };

export type ModelDescriptorView = {
  readonly modelId: string;
  readonly displayName: string;
  readonly provider: string;
  readonly available: boolean;
  readonly isDefault: boolean;
  readonly capabilities: readonly string[];
  readonly inputTypes: readonly string[];
  readonly costClass: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly privacyCharacteristics: string;
  readonly disabledReason?: string;
};

export type CostBudgetView = {
  readonly targetProjectId: string;
  readonly currentUsageTokens: number;
  readonly estimatedCostUsd: number;
  readonly confirmedCostUsd: number;
  readonly warningThresholdUsd: number;
  readonly softLimitUsd: number;
  readonly hardLimitUsd: number;
  readonly aggregationTimestamp: string;
  readonly status:
    'NORMAL' | 'WARNING_EXCEEDED' | 'SOFT_LIMIT_EXCEEDED' | 'HARD_LIMIT_EXCEEDED' | 'UNAVAILABLE';
};

export type PrivacyRetentionView = {
  readonly targetProjectId: string;
  readonly profileName: 'LOCAL_ONLY' | 'RESTRICTED_EXTERNAL' | 'CONTROLLED_EXTERNAL' | 'CUSTOM';
  readonly sensitivityLevel: 'NORMAL' | 'SENSITIVE' | 'HIGHLY_SENSITIVE';
  readonly externalTransferAllowed: boolean;
  readonly connectorAllowed: boolean;
  readonly telemetryAllowed: boolean;
  readonly exportAllowed: boolean;
  readonly retentionSummary: string;
};

export type ConnectorSettingsView = {
  readonly connectorId: string;
  readonly name: string;
  readonly status:
    | 'NOT_CONFIGURED'
    | 'CONNECTING'
    | 'CONNECTED'
    | 'DEGRADED'
    | 'REAUTH_REQUIRED'
    | 'REVOKING'
    | 'REVOKED'
    | 'FAILED';
  readonly maskedCredentials?: string;
  readonly canTest: boolean;
  readonly canRotate: boolean;
  readonly canRevoke: boolean;
};

export type DirectiveProposalView = {
  readonly proposalId: string;
  readonly resourceId: string;
  readonly directiveType: string;
  readonly description: string;
  readonly status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'COMMITTED';
  readonly createdAt: string;
};

export type SchemaPackView = {
  readonly packId: string;
  readonly name: string;
  readonly version: string;
  readonly compatibilityStatus: 'COMPATIBLE' | 'MIGRATION_REQUIRED' | 'INCOMPATIBLE';
  readonly canUpgrade: boolean;
  readonly canDisable: boolean;
};

export type DiagnosticsView = {
  readonly appVersion: string;
  readonly serverVersion: string;
  readonly activeProjectId: string;
  readonly targetProjectId: string;
  readonly databaseReadiness: 'READY' | 'DEGRADED' | 'UNAVAILABLE';
  readonly projectionReadiness: 'READY' | 'DEGRADED' | 'UNAVAILABLE';
  readonly recentFailures: readonly string[];
  readonly backupStatus: 'HEALTHY' | 'WARNING' | 'UNAVAILABLE';
};

// ----------------------------------------------------------------------------
// Runtime Decoders with Fail-Closed Invariant Validation
// ----------------------------------------------------------------------------

export function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function decodeProductFeatureView<T>(
  val: unknown,
  dataDecoder: (v: unknown) => T,
): ProductFeatureView<T> {
  if (!isRecord(val)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'ProductFeatureView must be a non-null object',
    );
  }
  if (val['availability'] === 'UNAVAILABLE') {
    return Object.freeze({
      availability: 'UNAVAILABLE',
      applicationMode: 'UNAVAILABLE',
      disabledReason:
        typeof val['disabledReason'] === 'string' ? val['disabledReason'] : 'Not available.',
    });
  }
  if (val['availability'] === 'AVAILABLE') {
    return Object.freeze({
      availability: 'AVAILABLE',
      data: dataDecoder(val['data']),
    });
  }
  throw new FrontendContractError('INVALID_REQUEST', 'Invalid ProductFeatureView availability');
}

export function decodeSettingsScope(val: unknown): SettingsScope {
  const allowed = new Set<SettingsScope>(['PRINCIPAL', 'PROJECT', 'SYSTEM', 'RESOURCE']);
  if (typeof val !== 'string' || !allowed.has(val as SettingsScope)) {
    throw new FrontendContractError('INVALID_REQUEST', `Invalid SettingsScope: ${String(val)}`);
  }
  return val as SettingsScope;
}

export function decodeSettingsApplicationMode(val: unknown): SettingsApplicationMode {
  const allowed = new Set<SettingsApplicationMode>([
    'IMMEDIATE',
    'CONFIRM_REQUIRED',
    'REVIEW_REQUIRED',
    'RESTART_REQUIRED',
    'MIGRATION_REQUIRED',
    'READ_ONLY',
    'UNAVAILABLE',
  ]);
  if (typeof val !== 'string' || !allowed.has(val as SettingsApplicationMode)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Invalid SettingsApplicationMode: ${String(val)}`,
    );
  }
  return val as SettingsApplicationMode;
}

export function decodeSettingsRiskLevel(val: unknown): SettingsRiskLevel {
  const allowed = new Set<SettingsRiskLevel>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  if (typeof val !== 'string' || !allowed.has(val as SettingsRiskLevel)) {
    throw new FrontendContractError('INVALID_REQUEST', `Invalid SettingsRiskLevel: ${String(val)}`);
  }
  return val as SettingsRiskLevel;
}

export function decodeProjectLifecycleStatus(val: unknown): ProjectLifecycleStatus {
  const allowed = new Set<ProjectLifecycleStatus>([
    'ACTIVE',
    'ARCHIVING',
    'ARCHIVED',
    'RESTORING',
    'DELETE_REQUESTED',
    'DELETING',
    'DELETED',
    'RECOVERY_REQUIRED',
  ]);
  if (typeof val !== 'string' || !allowed.has(val as ProjectLifecycleStatus)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Invalid ProjectLifecycleStatus: ${String(val)}`,
    );
  }
  return val as ProjectLifecycleStatus;
}

export function decodeSettingDescriptor(val: unknown): SettingDescriptor {
  if (!isRecord(val)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingDescriptor must be a non-null object',
    );
  }
  const obj = val;

  if (typeof obj['key'] !== 'string' || !obj['key']) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingDescriptor requires non-empty string key',
    );
  }

  const scope = decodeSettingsScope(obj['scope']);
  const applicationMode = decodeSettingsApplicationMode(obj['applicationMode']);
  const riskLevel = decodeSettingsRiskLevel(obj['riskLevel']);

  const cap = obj['capability'];
  if (!isRecord(cap)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingDescriptor requires capability object',
    );
  }

  // Security Negative Gate: Check if raw secret values are present
  if (
    obj['isSecret'] === true &&
    typeof obj['currentValue'] === 'string' &&
    obj['currentValue'].length > 0 &&
    !obj['currentValue'].includes('*')
  ) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingDescriptor must not expose unmasked secret values',
    );
  }

  return Object.freeze({
    key: obj['key'] as string,
    label: (obj['label'] as string) ?? obj['key'],
    description: (obj['description'] as string) ?? '',
    scope,
    category: (obj['category'] as string) ?? 'general',
    valueType: (obj['valueType'] as SettingDescriptor['valueType']) ?? 'string',
    currentValue: (obj['currentValue'] as SettingValue) ?? null,
    defaultValue: (obj['defaultValue'] as SettingValue) ?? null,
    applicationMode,
    riskLevel,
    capability: Object.freeze({
      canEdit: Boolean(cap['canEdit']),
      canReset: Boolean(cap['canReset']),
      canProposeReview: Boolean(cap['canProposeReview']),
      disabledReason: typeof cap['disabledReason'] === 'string' ? cap['disabledReason'] : undefined,
    }),
    options: Array.isArray(obj['options'])
      ? Object.freeze(
          obj['options'].map((opt) =>
            Object.freeze({ label: String(opt.label), value: String(opt.value) }),
          ),
        )
      : undefined,
    isSecret: Boolean(obj['isSecret']),
  });
}

export function decodeSettingsCategorySummary(val: unknown): SettingsCategorySummary {
  if (!isRecord(val)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingsCategorySummary must be a non-null object',
    );
  }
  const obj = val;

  if (typeof obj['categoryId'] !== 'string' || !obj['categoryId']) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingsCategorySummary requires categoryId',
    );
  }

  const scope = decodeSettingsScope(obj['scope']);
  const applicationMode = decodeSettingsApplicationMode(obj['applicationMode']);

  const cap = obj['capability'];
  if (!isRecord(cap)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingsCategorySummary requires capability object',
    );
  }

  return Object.freeze({
    categoryId: obj['categoryId'],
    label: String(obj['label'] ?? obj['categoryId']),
    description: typeof obj['description'] === 'string' ? obj['description'] : '',
    scope,
    totalSettingsCount: Number(obj['totalSettingsCount'] ?? 0),
    actionRequiredCount: Number(obj['actionRequiredCount'] ?? 0),
    warningCount: Number(obj['warningCount'] ?? 0),
    applicationMode,
    capability: Object.freeze({
      canEdit: Boolean(cap['canEdit']),
      canReset: Boolean(cap['canReset']),
      canProposeReview: Boolean(cap['canProposeReview']),
      disabledReason: typeof cap['disabledReason'] === 'string' ? cap['disabledReason'] : undefined,
    }),
    lastModifiedAt: typeof obj['lastModifiedAt'] === 'string' ? obj['lastModifiedAt'] : null,
  });
}

export function decodeSettingsSnapshot(val: unknown): SettingsSnapshot {
  if (!isRecord(val)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingsSnapshot must be a non-null object',
    );
  }
  const obj = val;

  if (obj['schemaVersion'] !== '1.0.0') {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Unsupported SettingsSnapshot schemaVersion: ${String(obj['schemaVersion'])}`,
    );
  }
  if (typeof obj['targetProjectId'] !== 'string' || !obj['targetProjectId']) {
    throw new FrontendContractError('INVALID_REQUEST', 'SettingsSnapshot requires targetProjectId');
  }
  if (typeof obj['settingsRevision'] !== 'number' || obj['settingsRevision'] < 0) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingsSnapshot requires valid non-negative settingsRevision',
    );
  }

  const categories = Array.isArray(obj['categories'])
    ? obj['categories'].map(decodeSettingsCategorySummary)
    : [];
  const settings = Array.isArray(obj['settings'])
    ? obj['settings'].map(decodeSettingDescriptor)
    : [];

  return Object.freeze({
    schemaVersion: '1.0.0',
    targetProjectId: obj['targetProjectId'],
    settingsRevision: obj['settingsRevision'],
    policyContextRevision: Number(obj['policyContextRevision'] ?? obj['settingsRevision']),
    categories: Object.freeze(categories),
    settings: Object.freeze(settings),
    fetchedAt: String(obj['fetchedAt'] ?? new Date().toISOString()),
  });
}

export function decodeProjectListItemView(val: unknown): ProjectListItemView {
  if (!isRecord(val)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'ProjectListItemView must be a non-null object',
    );
  }
  const obj = val;
  if (typeof obj['id'] !== 'string' || !obj['id']) {
    throw new FrontendContractError('INVALID_REQUEST', 'ProjectListItemView requires valid id');
  }
  const cap = isRecord(obj['capability']) ? obj['capability'] : {};

  return Object.freeze({
    id: String(obj['id']),
    name: String(obj['name'] ?? obj['id']),
    description: typeof obj['description'] === 'string' ? obj['description'] : '',
    isOwner: Boolean(obj['isOwner']),
    status: decodeProjectLifecycleStatus(obj['status']),
    active: Boolean(obj['active']),
    createdAt: String(obj['createdAt'] ?? new Date().toISOString()),
    updatedAt: String(obj['updatedAt'] ?? new Date().toISOString()),
    revision: Number(obj['revision'] ?? 1),
    capability: Object.freeze({
      canRename: Boolean(cap['canRename']),
      canArchive: Boolean(cap['canArchive']),
      canRestore: Boolean(cap['canRestore']),
      canDelete: Boolean(cap['canDelete']),
      canManagePolicies: Boolean(cap['canManagePolicies']),
      disabledReason: typeof cap['disabledReason'] === 'string' ? cap['disabledReason'] : undefined,
    }),
  });
}

export function decodeProjectAdministrationView(val: unknown): ProjectAdministrationView {
  if (!isRecord(val)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'ProjectAdministrationView must be a non-null object',
    );
  }
  const obj = val;
  if (obj['schemaVersion'] !== '1.0.0') {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      `Unsupported ProjectAdministrationView schemaVersion: ${String(obj['schemaVersion'])}`,
    );
  }
  const projects = Array.isArray(obj['projects'])
    ? obj['projects'].map(decodeProjectListItemView)
    : [];
  return Object.freeze({
    schemaVersion: '1.0.0',
    projects: Object.freeze(projects),
  });
}

export function decodeSettingsValidationResult(val: unknown): SettingsValidationResult {
  if (!isRecord(val)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingsValidationResult must be a non-null object',
    );
  }
  const obj = val;
  const errors = Array.isArray(obj['errors'])
    ? obj['errors'].map((e) => {
        const item = isRecord(e) ? e : {};
        return { key: String(item['key'] ?? ''), message: String(item['message'] ?? '') };
      })
    : [];
  const warnings = Array.isArray(obj['warnings'])
    ? obj['warnings'].map((w) => {
        const item = isRecord(w) ? w : {};
        return { key: String(item['key'] ?? ''), message: String(item['message'] ?? '') };
      })
    : [];

  return Object.freeze({
    isValid: Boolean(obj['isValid']),
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
  });
}

export function decodeSettingsImpactPreview(val: unknown): SettingsImpactPreview {
  if (!isRecord(val)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingsImpactPreview must be a non-null object',
    );
  }
  const obj = val;
  const affectedComponents = Array.isArray(obj['affectedComponents'])
    ? obj['affectedComponents'].map(String)
    : [];
  const affectedResources = Array.isArray(obj['affectedResources'])
    ? obj['affectedResources'].map(String)
    : [];

  return Object.freeze({
    targetProjectId: String(obj['targetProjectId'] ?? ''),
    expectedRevision: Number(obj['expectedRevision'] ?? 0),
    applicationMode: decodeSettingsApplicationMode(obj['applicationMode']),
    requiresConfirmation: Boolean(obj['requiresConfirmation']),
    requiresReview: Boolean(obj['requiresReview']),
    requiresMigration: Boolean(obj['requiresMigration']),
    requiresRestart: Boolean(obj['requiresRestart']),
    riskLevel: decodeSettingsRiskLevel(obj['riskLevel']),
    affectedComponents: Object.freeze(affectedComponents),
    affectedResources: Object.freeze(affectedResources),
    retrospectiveEffect: String(obj['retrospectiveEffect'] ?? 'NONE'),
    summaryDescription: String(obj['summaryDescription'] ?? ''),
  });
}

export function decodeSettingsCommandResult(val: unknown): SettingsCommandResult {
  if (!isRecord(val)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'SettingsCommandResult must be a non-null object',
    );
  }
  const obj = val;
  const rawStatus = String(obj['status'] ?? 'FAILED');
  const validStatuses: SettingsCommandStatus[] = [
    'PENDING',
    'APPLIED',
    'REVIEW_REQUIRED',
    'FAILED',
    'OUTCOME_UNKNOWN',
  ];
  const status: SettingsCommandStatus = validStatuses.includes(rawStatus as SettingsCommandStatus)
    ? (rawStatus as SettingsCommandStatus)
    : 'FAILED';

  return Object.freeze({
    commandId: String(obj['commandId'] ?? ''),
    clientRequestId: String(obj['clientRequestId'] ?? ''),
    idempotencyKey: String(obj['idempotencyKey'] ?? ''),
    status,
    appliedRevision:
      typeof obj['appliedRevision'] === 'number' ? obj['appliedRevision'] : undefined,
    reviewProposalId:
      typeof obj['reviewProposalId'] === 'string' ? obj['reviewProposalId'] : undefined,
    errorMessage: typeof obj['errorMessage'] === 'string' ? obj['errorMessage'] : undefined,
    completedAt: typeof obj['completedAt'] === 'string' ? obj['completedAt'] : undefined,
    projectId: typeof obj['projectId'] === 'string' ? obj['projectId'] : undefined,
  });
}

export function decodePrincipalPreferences(val: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(val)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'Principal preferences must be a non-null object',
    );
  }
  validateJSONValue(val, 'preferences');
  return Object.freeze({ ...val });
}

const requireStringField = (
  value: Record<string, unknown>,
  field: string,
  viewName: string,
): string => {
  if (typeof value[field] !== 'string') {
    throw new FrontendContractError('INVALID_REQUEST', `${viewName}.${field} must be a string`);
  }
  return value[field];
};

const requireNumberField = (
  value: Record<string, unknown>,
  field: string,
  viewName: string,
): number => {
  if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
    throw new FrontendContractError('INVALID_REQUEST', `${viewName}.${field} must be a number`);
  }
  return value[field];
};

const requireBooleanField = (
  value: Record<string, unknown>,
  field: string,
  viewName: string,
): boolean => {
  if (typeof value[field] !== 'boolean') {
    throw new FrontendContractError('INVALID_REQUEST', `${viewName}.${field} must be a boolean`);
  }
  return value[field];
};

export function decodeFrontendCommandOutcomeView(val: unknown): FrontendCommandOutcomeView {
  if (!isRecord(val)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'FrontendCommandOutcomeView must be an object',
    );
  }
  const principal = val['acceptedPrincipalContext'];
  const actor = isRecord(principal) ? principal['actor'] : undefined;
  const project = val['acceptedProjectContext'];
  const policy = val['acceptedPolicyContext'];
  if (!isRecord(principal) || !isRecord(actor) || !isRecord(project) || !isRecord(policy)) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'FrontendCommandOutcomeView requires accepted context objects',
    );
  }
  const outcomeState = val['outcomeState'];
  if (!['ACCEPTED', 'COMPLETED', 'REJECTED', 'OUTCOME_UNKNOWN'].includes(String(outcomeState))) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'FrontendCommandOutcomeView has invalid outcomeState',
    );
  }
  const producedResources = Array.isArray(val['producedResources'])
    ? val['producedResources'].map((item) => {
        if (!isRecord(item)) {
          throw new FrontendContractError('INVALID_REQUEST', 'Produced resource must be an object');
        }
        return Object.freeze({
          resourceKind: requireStringField(item, 'resourceKind', 'ProducedResourceRef'),
          resourceId: requireStringField(item, 'resourceId', 'ProducedResourceRef'),
          ...(typeof item['resourceRevision'] === 'string'
            ? { resourceRevision: item['resourceRevision'] }
            : {}),
        });
      })
    : [];
  return Object.freeze({
    commandId: requireStringField(val, 'commandId', 'FrontendCommandOutcomeView'),
    commandRevision: requireStringField(val, 'commandRevision', 'FrontendCommandOutcomeView'),
    clientRequestId: requireStringField(val, 'clientRequestId', 'FrontendCommandOutcomeView'),
    idempotencyKey: requireStringField(val, 'idempotencyKey', 'FrontendCommandOutcomeView'),
    commandType: requireStringField(val, 'commandType', 'FrontendCommandOutcomeView'),
    commandSchemaVersion: requireStringField(
      val,
      'commandSchemaVersion',
      'FrontendCommandOutcomeView',
    ),
    commandSemanticDigest: requireStringField(
      val,
      'commandSemanticDigest',
      'FrontendCommandOutcomeView',
    ),
    outcomeState: outcomeState as OutcomeState,
    ...(typeof val['completionDisposition'] === 'string'
      ? { completionDisposition: val['completionDisposition'] as CompletionDisposition }
      : {}),
    acceptedPrincipalContext: Object.freeze({
      principalId: requireStringField(principal, 'principalId', 'AcceptedPrincipalContext'),
      actor: Object.freeze({
        type: actor['type'] === 'service' ? 'service' : 'user',
        id: requireStringField(actor, 'id', 'AcceptedPrincipalContext.actor'),
      }),
    }),
    acceptedProjectContext: Object.freeze({
      targetProjectId: requireStringField(project, 'targetProjectId', 'AcceptedProjectContext'),
    }),
    acceptedPolicyContext: Object.freeze({
      policyContextId: requireStringField(policy, 'policyContextId', 'AcceptedPolicyContext'),
      policyContextRevision: requireStringField(
        policy,
        'policyContextRevision',
        'AcceptedPolicyContext',
      ),
      acceptedAt: requireStringField(policy, 'acceptedAt', 'AcceptedPolicyContext'),
    }),
    correlationId: requireStringField(val, 'correlationId', 'FrontendCommandOutcomeView'),
    ...(typeof val['traceId'] === 'string' ? { traceId: val['traceId'] } : {}),
    producedResources: Object.freeze(producedResources),
    receivedAt: requireStringField(val, 'receivedAt', 'FrontendCommandOutcomeView'),
    ...(typeof val['acceptedAt'] === 'string' ? { acceptedAt: val['acceptedAt'] } : {}),
    ...(typeof val['completedAt'] === 'string' ? { completedAt: val['completedAt'] } : {}),
    lastUpdatedAt: requireStringField(val, 'lastUpdatedAt', 'FrontendCommandOutcomeView'),
  });
}

export function decodeModelDescriptorView(val: unknown): ModelDescriptorView {
  if (!isRecord(val)) {
    throw new FrontendContractError('INVALID_REQUEST', 'ModelDescriptorView must be an object');
  }
  const costClass = requireStringField(val, 'costClass', 'ModelDescriptorView');
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(costClass)) {
    throw new FrontendContractError('INVALID_REQUEST', 'ModelDescriptorView.costClass is invalid');
  }
  return Object.freeze({
    modelId: requireStringField(val, 'modelId', 'ModelDescriptorView'),
    displayName: requireStringField(val, 'displayName', 'ModelDescriptorView'),
    provider: requireStringField(val, 'provider', 'ModelDescriptorView'),
    available: requireBooleanField(val, 'available', 'ModelDescriptorView'),
    isDefault: requireBooleanField(val, 'isDefault', 'ModelDescriptorView'),
    capabilities: Object.freeze(
      Array.isArray(val['capabilities']) ? val['capabilities'].map(String) : [],
    ),
    inputTypes: Object.freeze(
      Array.isArray(val['inputTypes']) ? val['inputTypes'].map(String) : [],
    ),
    costClass: costClass as ModelDescriptorView['costClass'],
    privacyCharacteristics: requireStringField(
      val,
      'privacyCharacteristics',
      'ModelDescriptorView',
    ),
    ...(typeof val['disabledReason'] === 'string' ? { disabledReason: val['disabledReason'] } : {}),
  });
}

export function decodeCostBudgetView(val: unknown): CostBudgetView {
  if (!isRecord(val)) {
    throw new FrontendContractError('INVALID_REQUEST', 'CostBudgetView must be an object');
  }
  return Object.freeze({
    targetProjectId: requireStringField(val, 'targetProjectId', 'CostBudgetView'),
    currentUsageTokens: requireNumberField(val, 'currentUsageTokens', 'CostBudgetView'),
    estimatedCostUsd: requireNumberField(val, 'estimatedCostUsd', 'CostBudgetView'),
    confirmedCostUsd: requireNumberField(val, 'confirmedCostUsd', 'CostBudgetView'),
    warningThresholdUsd: requireNumberField(val, 'warningThresholdUsd', 'CostBudgetView'),
    softLimitUsd: requireNumberField(val, 'softLimitUsd', 'CostBudgetView'),
    hardLimitUsd: requireNumberField(val, 'hardLimitUsd', 'CostBudgetView'),
    aggregationTimestamp: requireStringField(val, 'aggregationTimestamp', 'CostBudgetView'),
    status: requireStringField(val, 'status', 'CostBudgetView') as CostBudgetView['status'],
  });
}

export function decodePrivacyRetentionView(val: unknown): PrivacyRetentionView {
  if (!isRecord(val)) {
    throw new FrontendContractError('INVALID_REQUEST', 'PrivacyRetentionView must be an object');
  }
  return Object.freeze({
    targetProjectId: requireStringField(val, 'targetProjectId', 'PrivacyRetentionView'),
    profileName: requireStringField(
      val,
      'profileName',
      'PrivacyRetentionView',
    ) as PrivacyRetentionView['profileName'],
    sensitivityLevel: requireStringField(
      val,
      'sensitivityLevel',
      'PrivacyRetentionView',
    ) as PrivacyRetentionView['sensitivityLevel'],
    externalTransferAllowed: requireBooleanField(
      val,
      'externalTransferAllowed',
      'PrivacyRetentionView',
    ),
    connectorAllowed: requireBooleanField(val, 'connectorAllowed', 'PrivacyRetentionView'),
    telemetryAllowed: requireBooleanField(val, 'telemetryAllowed', 'PrivacyRetentionView'),
    exportAllowed: requireBooleanField(val, 'exportAllowed', 'PrivacyRetentionView'),
    retentionSummary: requireStringField(val, 'retentionSummary', 'PrivacyRetentionView'),
  });
}

export function decodeConnectorSettingsView(val: unknown): ConnectorSettingsView {
  if (!isRecord(val)) {
    throw new FrontendContractError('INVALID_REQUEST', 'ConnectorSettingsView must be an object');
  }
  return Object.freeze({
    connectorId: requireStringField(val, 'connectorId', 'ConnectorSettingsView'),
    name: requireStringField(val, 'name', 'ConnectorSettingsView'),
    status: requireStringField(
      val,
      'status',
      'ConnectorSettingsView',
    ) as ConnectorSettingsView['status'],
    ...(typeof val['maskedCredentials'] === 'string'
      ? { maskedCredentials: val['maskedCredentials'] }
      : {}),
    canTest: requireBooleanField(val, 'canTest', 'ConnectorSettingsView'),
    canRotate: requireBooleanField(val, 'canRotate', 'ConnectorSettingsView'),
    canRevoke: requireBooleanField(val, 'canRevoke', 'ConnectorSettingsView'),
  });
}

export function decodeDirectiveProposalView(val: unknown): DirectiveProposalView {
  if (!isRecord(val)) {
    throw new FrontendContractError('INVALID_REQUEST', 'DirectiveProposalView must be an object');
  }
  return Object.freeze({
    proposalId: requireStringField(val, 'proposalId', 'DirectiveProposalView'),
    resourceId: requireStringField(val, 'resourceId', 'DirectiveProposalView'),
    directiveType: requireStringField(val, 'directiveType', 'DirectiveProposalView'),
    description: requireStringField(val, 'description', 'DirectiveProposalView'),
    status: requireStringField(
      val,
      'status',
      'DirectiveProposalView',
    ) as DirectiveProposalView['status'],
    createdAt: requireStringField(val, 'createdAt', 'DirectiveProposalView'),
  });
}

export function decodeSchemaPackView(val: unknown): SchemaPackView {
  if (!isRecord(val)) {
    throw new FrontendContractError('INVALID_REQUEST', 'SchemaPackView must be an object');
  }
  return Object.freeze({
    packId: requireStringField(val, 'packId', 'SchemaPackView'),
    name: requireStringField(val, 'name', 'SchemaPackView'),
    version: requireStringField(val, 'version', 'SchemaPackView'),
    compatibilityStatus: requireStringField(
      val,
      'compatibilityStatus',
      'SchemaPackView',
    ) as SchemaPackView['compatibilityStatus'],
    canUpgrade: requireBooleanField(val, 'canUpgrade', 'SchemaPackView'),
    canDisable: requireBooleanField(val, 'canDisable', 'SchemaPackView'),
  });
}

export function decodeDiagnosticsView(val: unknown): DiagnosticsView {
  if (!isRecord(val)) {
    throw new FrontendContractError('INVALID_REQUEST', 'DiagnosticsView must be an object');
  }
  return Object.freeze({
    appVersion: requireStringField(val, 'appVersion', 'DiagnosticsView'),
    serverVersion: requireStringField(val, 'serverVersion', 'DiagnosticsView'),
    activeProjectId: requireStringField(val, 'activeProjectId', 'DiagnosticsView'),
    targetProjectId: requireStringField(val, 'targetProjectId', 'DiagnosticsView'),
    databaseReadiness: requireStringField(
      val,
      'databaseReadiness',
      'DiagnosticsView',
    ) as DiagnosticsView['databaseReadiness'],
    projectionReadiness: requireStringField(
      val,
      'projectionReadiness',
      'DiagnosticsView',
    ) as DiagnosticsView['projectionReadiness'],
    recentFailures: Object.freeze(
      Array.isArray(val['recentFailures']) ? val['recentFailures'].map(String) : [],
    ),
    backupStatus: requireStringField(
      val,
      'backupStatus',
      'DiagnosticsView',
    ) as DiagnosticsView['backupStatus'],
  });
}
