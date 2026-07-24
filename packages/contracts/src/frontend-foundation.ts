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
    case 'RESOURCE_RETIRED':
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

  // Reject top-level traceId injection
  if ('traceId' in req) {
    throw new FrontendContractError('INVALID_REQUEST', 'Client cannot inject top-level traceId');
  }

  // Client cannot inject server-authoritative fields
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
// 7. Command Semantic Digest & Canonicalization Adapter Architecture
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

export type SemanticDigestProvider = (canonicalJson: string) => string;

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

export function computeCommandSemanticDigest<TPayload>(
  request: FrontendCommandRequest<TPayload>,
  provider: SemanticDigestProvider = sha256Sync,
): string {
  const input = buildCommandSemanticDigestInput(request);
  return provider(input);
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
  readonly code: string;
  readonly message: string;
  readonly category?: string;
  readonly retryable?: boolean;
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

export type CommandOutcomeResolution<TPayload = unknown> =
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

export function resolveOutcomeState<TPayload>(
  request: FrontendCommandRequest<TPayload>,
  principalId: string,
  ledgerEntries: readonly CommandLedgerEntry[],
  serverAcceptanceChecker?: {
    checkServerDurableAcceptance: () =>
      'ACCEPTANCE_CONFIRMED' | 'NO_ACCEPTANCE_CONFIRMED' | 'UNKNOWN';
  },
): CommandOutcomeResolution<TPayload> {
  const digest = computeCommandSemanticDigest(request);

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
    // Acceptance confirmed without outcome view is NOT_FOUND outcome -> return INDETERMINATE to block duplicate submission safely
    if (status === 'ACCEPTANCE_CONFIRMED') {
      return { resolution: 'INDETERMINATE' };
    }
  }

  // Default when lookup returns nothing: INDETERMINATE
  return { resolution: 'INDETERMINATE' };
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
  // Step 1: Authentication check & principal requirement
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

  // Step 5: Resource Project Access Check
  let projectCapList: readonly string[] = [];
  if (requirement.resourceProjectId) {
    const isAccessible =
      boundaryCtx.accessibleProjectIds?.includes(requirement.resourceProjectId) ||
      boundaryCtx.projectAccessContexts?.some((p) => p.projectId === requirement.resourceProjectId);

    if (!isAccessible) {
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
// 13. Operational Resource Kind Registry & Server Snapshot Authority
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

export class OperationalResourceKindRegistryInstance {
  readonly registryState: RegistryState;
  readonly registryRevision: string;
  private readonly concreteKinds: readonly OperationalResourceKindDescriptor[];
  private readonly aggregateKinds: readonly OperationalResourceKindDescriptor[];

  constructor(snapshot?: OperationalResourceKindRegistrySnapshot) {
    if (!snapshot) {
      this.registryState = 'NOT_LOADED';
      this.registryRevision = 'none';
      this.concreteKinds = [];
      this.aggregateKinds = [];
    } else {
      this.registryState = 'READY';
      this.registryRevision = snapshot.registryRevision;
      this.concreteKinds = snapshot.concreteKinds;
      this.aggregateKinds = snapshot.aggregateKinds;
    }
  }

  get(kind: string): OperationalResourceKindDescriptor {
    const foundConcrete = this.concreteKinds.find((k) => k.kind === kind);
    if (foundConcrete) return foundConcrete;

    const foundAggregate = this.aggregateKinds.find((k) => k.kind === kind);
    if (foundAggregate) return foundAggregate;

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
  snapshot?: OperationalResourceKindRegistrySnapshot,
): OperationalResourceKindRegistryInstance {
  return new OperationalResourceKindRegistryInstance(snapshot);
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
// 15. Cache Key Factory & Policy Revision Invalidation Policy
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
