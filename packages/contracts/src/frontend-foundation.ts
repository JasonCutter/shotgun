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
  | 'RESOURCE_ACCESS_REVOKED'
  | 'INVALID_REQUEST';

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
    case 'INVALID_REQUEST':
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

export function validateJSONValue(val: unknown, path = 'payload'): void {
  if (
    val === null ||
    typeof val === 'boolean' ||
    typeof val === 'number' ||
    typeof val === 'string'
  ) {
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
  if (Array.isArray(val)) {
    for (let i = 0; i < val.length; i++) {
      validateJSONValue(val[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof val === 'object') {
    for (const key of Object.keys(val as Record<string, unknown>)) {
      validateJSONValue((val as Record<string, unknown>)[key], `${path}.${key}`);
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

  // Client cannot inject server-authoritative fields in payload or top-level
  if (
    'principal' in req ||
    'security' in req ||
    'capabilities' in req ||
    'internalTraceId' in req
  ) {
    throw new FrontendContractError(
      'PRECONDITION_ACCESS_DENIED',
      'Client cannot inject server-authoritative fields (principal, security, capabilities, internalTraceId)',
    );
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

  // Validate clientIssuedAt ISO 8601 string
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
// 7. Command Semantic Digest & Pure TS SHA-256 Canonicalization
// ============================================================================

function sha256Sync(str: string): string {
  const utf8 = new TextEncoder().encode(str);
  const K: readonly number[] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let H0 = 0x6a09e667,
    H1 = 0xbb67ae85,
    H2 = 0x3c6ef372,
    H3 = 0xa54ff53a,
    H4 = 0x510e527f,
    H5 = 0x9b05688c,
    H6 = 0x1f83d9ab,
    H7 = 0x5be0cd19;

  const l = utf8.length;
  const bitLen = l * 8;
  const k = (448 - ((l * 8 + 8) % 512) + 512) % 512;
  const padding = new Uint8Array(l + 1 + k / 8 + 8);
  padding.set(utf8);
  padding[l] = 0x80;

  const view = new DataView(padding.buffer);
  view.setBigUint64(padding.length - 8, BigInt(bitLen), false);

  const w = new Int32Array(64);
  for (let i = 0; i < padding.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = view.getInt32(i + t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const wt15 = w[t - 15]!;
      const wt2 = w[t - 2]!;
      const wt16 = w[t - 16]!;
      const wt7 = w[t - 7]!;
      const s0 = ((wt15 >>> 7) | (wt15 << 25)) ^ ((wt15 >>> 18) | (wt15 << 14)) ^ (wt15 >>> 3);
      const s1 = ((wt2 >>> 17) | (wt2 << 15)) ^ ((wt2 >>> 19) | (wt2 << 13)) ^ (wt2 >>> 10);
      w[t] = (wt16 + s0 + wt7 + s1) | 0;
    }
    let a = H0,
      b = H1,
      c = H2,
      d = H3,
      e = H4,
      f = H5,
      g = H6,
      h = H7;
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const kt = K[t]!;
      const wt = w[t]!;
      const temp1 = (h + S1 + ch + kt + wt) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    H0 = (H0 + a) | 0;
    H1 = (H1 + b) | 0;
    H2 = (H2 + c) | 0;
    H3 = (H3 + d) | 0;
    H4 = (H4 + e) | 0;
    H5 = (H5 + f) | 0;
    H6 = (H6 + g) | 0;
    H7 = (H7 + h) | 0;
  }
  return [H0, H1, H2, H3, H4, H5, H6, H7]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export function deterministicCanonicalizePayload(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(deterministicCanonicalizePayload).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${deterministicCanonicalizePayload((obj as Record<string, unknown>)[k])}`,
  );
  return '{' + entries.join(',') + '}';
}

export function computeCommandSemanticDigest<TPayload>(
  request: FrontendCommandRequest<TPayload>,
): string {
  // Sort preconditions deterministically before canonicalization
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

  const jsonString = deterministicCanonicalizePayload(digestPayload);
  return sha256Sync(jsonString);
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
  serverAcceptanceChecker?: {
    checkServerDurableAcceptance: () =>
      'ACCEPTANCE_CONFIRMED' | 'NO_ACCEPTANCE_CONFIRMED' | 'UNKNOWN';
  },
): OutcomeResolutionState {
  const digest = computeCommandSemanticDigest(request);

  // Step 1: Match by clientRequestId
  const byRequestId = ledgerEntries.find((e) => e.clientRequestId === request.clientRequestId);
  if (byRequestId) {
    if (byRequestId.isRetentionExpired) return 'RETENTION_EXPIRED';
    return 'FOUND';
  }

  // Step 2: Match by idempotencyKey + scope
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

  // Step 3: Explicit server durable acceptance check
  if (serverAcceptanceChecker) {
    const status = serverAcceptanceChecker.checkServerDurableAcceptance();
    if (status === 'NO_ACCEPTANCE_CONFIRMED') {
      return 'NOT_ACCEPTED_CONFIRMED';
    }
    if (status === 'ACCEPTANCE_CONFIRMED') {
      return 'FOUND';
    }
  }

  // Default fallback when no resolution is found or confirmed: INDETERMINATE
  return 'INDETERMINATE';
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
  const hasCausation = Boolean(newRequest.correlationContext?.causationRef?.id);

  // Transport Retry: same clientRequestId, same idempotencyKey, same digest
  if (isSameClientReq && isSameIdempotency && sameDigest) {
    return 'TRANSPORT_RETRY';
  }

  // Domain Retry: different clientRequestId, different idempotencyKey, same digest, AND valid causationRef
  if (!isSameClientReq && !isSameIdempotency && sameDigest && hasCausation) {
    return 'DOMAIN_RETRY';
  }

  // Any other mixed or invalid combination is RETRY_FORBIDDEN
  return 'RETRY_FORBIDDEN';
}

// ============================================================================
// 10. Mapper: FrontendCommandRequest -> Internal CommandEnvelope
// ============================================================================

export type InternalCommandMappingOptions = {
  readonly frontendCommandId: string;
  readonly internalMessageId: string;
  readonly acceptedPrincipalContext: {
    readonly principalId: string;
    readonly actor: { readonly type: 'user' | 'service'; readonly id: string };
  };
  readonly acceptedProjectContext: { readonly targetProjectId: string };
  readonly acceptedPolicyContext: FrontendPolicyBinding;
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
  // Disallow frontendCommandId === internalMessageId
  if (options.frontendCommandId === options.internalMessageId) {
    throw new FrontendContractError(
      'INVALID_REQUEST',
      'frontendCommandId must be decoupled from internalMessageId',
    );
  }

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
      policyVersion: options.acceptedPolicyContext.observedPolicyContextRevision,
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
  // Step 1: Authentication check
  if (boundaryCtx.authState !== 'AUTHENTICATED') {
    return {
      allowed: false,
      error: new FrontendContractError('SESSION_EXPIRED', 'Authentication required'),
    };
  }

  // Step 2: Session state check
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
        `Session non-ready: ${boundaryCtx.sessionState}`,
      ),
    };
  }

  // Step 3: Backend readiness check if required
  if (requirement.requiresBackend && boundaryCtx.backendReadiness !== 'READY') {
    return {
      allowed: false,
      error: new FrontendContractError('OUTCOME_INDETERMINATE', 'Backend unavailable'),
    };
  }

  // Step 4: Connectivity check if required
  if (requirement.requiresConnectivity && boundaryCtx.connectivityState === 'OFFLINE') {
    return {
      allowed: false,
      error: new FrontendContractError('OUTCOME_INDETERMINATE', 'Network offline'),
    };
  }

  // Step 5: Capability check
  if (requirement.requiredCapability) {
    const hasCap = boundaryCtx.grantedCapabilities.includes(requirement.requiredCapability);
    if (!hasCap) {
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
// 13. Operational Resource Kind Registry & Server Snapshot
// ============================================================================

export type SupportState = 'SUPPORTED' | 'EXPERIMENTAL' | 'UNKNOWN' | 'UNSUPPORTED';

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

const DEFAULT_CONCRETE_KINDS: readonly OperationalResourceKindDescriptor[] = [
  {
    kind: 'INTAKE_SUBMISSION',
    family: 'INTAKE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/intake/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['submit', 'revalidate', 'cancel'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'ANSWER_RUN',
    family: 'KNOWLEDGE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/answers/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['execute', 'cancel', 'feedback'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'DELIVERY_PACKAGE',
    family: 'DELIVERY',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/deliveries/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'restricted',
    supportedActions: ['build', 'deploy', 'rollback'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'FEEDBACK_EVENT',
    family: 'GOVERNANCE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/feedback/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['record', 'triage'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'EVIDENCE_REVALIDATION',
    family: 'EVIDENCE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/evidence/:resourceId/revalidate',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['verify', 'flag'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'KNOWLEDGE_TRANSITION',
    family: 'KNOWLEDGE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/transitions/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['apply', 'create_reversal_change_set'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'IMPACT_ANALYSIS',
    family: 'KNOWLEDGE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/impact/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['run', 'dismiss'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'REVIEW_PROCESS',
    family: 'REVIEW',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/reviews/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['approve', 'reject', 'request_changes'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'CANONICAL_COMMIT',
    family: 'GOVERNANCE',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/commits/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'restricted',
    supportedActions: ['commit', 'create_reversal_change_set'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'ACTION_PREFLIGHT',
    family: 'ACTION',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/actions/preflight/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['simulate', 'validate'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'ACTION_EXECUTION',
    family: 'ACTION',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/actions/executions/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'restricted',
    supportedActions: ['execute', 'cancel'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'ACTION_VERIFICATION',
    family: 'ACTION',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/actions/verifications/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'internal',
    supportedActions: ['verify'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'ACTION_COMPENSATION',
    family: 'ACTION',
    isConcrete: true,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/actions/compensations/:resourceId',
    outcomeCapability: true,
    sensitivityClass: 'restricted',
    supportedActions: ['compensate'],
    supportState: 'SUPPORTED',
  },
];

const DEFAULT_AGGREGATE_KINDS: readonly OperationalResourceKindDescriptor[] = [
  {
    kind: 'EXTERNAL_ACTION',
    family: 'ACTION',
    isConcrete: false,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/actions/external',
    outcomeCapability: false,
    sensitivityClass: 'internal',
    supportedActions: ['filter', 'summarize'],
    supportState: 'SUPPORTED',
  },
  {
    kind: 'KNOWLEDGE_GOVERNANCE',
    family: 'GOVERNANCE',
    isConcrete: false,
    projectScope: 'PROJECT_SCOPED',
    snapshotSchemaVersion: '1.0.0',
    deepLinkDescriptor: '/projects/:projectId/governance',
    outcomeCapability: false,
    sensitivityClass: 'internal',
    supportedActions: ['filter', 'overview'],
    supportState: 'SUPPORTED',
  },
];

export class OperationalResourceKindRegistry {
  private static snapshot: OperationalResourceKindRegistrySnapshot = {
    registryRevision: 'rev-1.0.0',
    concreteKinds: DEFAULT_CONCRETE_KINDS,
    aggregateKinds: DEFAULT_AGGREGATE_KINDS,
    stateOrStageSchema: {},
    routeDescriptor: {},
    eligibility: {},
    sensitivityClass: {},
    retentionClass: {},
    requiredCapabilities: {},
    requiredFeatures: {},
  };

  static updateServerSnapshot(newSnapshot: OperationalResourceKindRegistrySnapshot): void {
    this.snapshot = newSnapshot;
  }

  static get(kind: string): OperationalResourceKindDescriptor {
    const foundConcrete = this.snapshot.concreteKinds.find((k) => k.kind === kind);
    if (foundConcrete) return foundConcrete;

    const foundAggregate = this.snapshot.aggregateKinds.find((k) => k.kind === kind);
    if (foundAggregate) return foundAggregate;

    // Unknown Kind preservation rule: keep originalKind, set supportState UNKNOWN
    return {
      kind: `UNKNOWN_${kind}`,
      originalKind: kind,
      family: 'UNKNOWN',
      isConcrete: false,
      projectScope: 'PROJECT_SCOPED',
      snapshotSchemaVersion: '0.0.0',
      deepLinkDescriptor: '',
      outcomeCapability: false,
      sensitivityClass: 'internal',
      supportedActions: [],
      supportState: 'UNKNOWN',
    };
  }

  static isConcrete(kind: string): boolean {
    return this.snapshot.concreteKinds.some((k) => k.kind === kind);
  }

  static listConcrete(): readonly OperationalResourceKindDescriptor[] {
    return this.snapshot.concreteKinds;
  }

  static listAggregate(): readonly OperationalResourceKindDescriptor[] {
    return this.snapshot.aggregateKinds;
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
// 15. Cache Key Factory & Access Invalidation
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
  const targetProject =
    params.scope === 'project'
      ? (params.resourceProjectId ?? params.activeProjectId ?? 'no-project')
      : 'global';

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
      // Active Project switch does NOT auto-delete other accessible project caches
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
