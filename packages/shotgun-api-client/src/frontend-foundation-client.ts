import type {
  CommandOutcomeResolution,
  FrontendCommandOutcomeView,
  FrontendCommandRequest,
  OperationRequirement,
  SystemBoundaryContext,
} from '../../contracts/src/frontend-entry.js';
import {
  evaluateCapabilityGuard,
  FrontendContractError,
} from '../../contracts/src/frontend-entry.js';
import { computeCommandSemanticDigestAsync } from './frontend-digest-adapter.js';

export type {
  AuthenticationState,
  BackendReadiness,
  ConnectivityState,
  ProductSessionView,
  SessionBoundaryAuthenticationState,
  SessionBoundaryBackendReadiness,
  SessionBoundaryConnectivityState,
  SessionBoundaryReasonCode,
  SessionBoundarySessionState,
  SessionBoundaryView,
  SessionRecoveryAction,
  SessionRecoveryActionId,
  SessionState,
  WorkspaceLeaveGuard,
  WorkspaceLeaveState,
} from '../../contracts/src/frontend-entry.js';

export {
  computeCommandSemanticDigestAsync,
  webCryptoDigestProvider,
} from './frontend-digest-adapter.js';

export { FrontendContractError };

export {
  buildCacheKey,
  calculateCacheInvalidationOnPolicyChange,
  createOperationalResourceKindRegistry,
  decodeOperationalResourceKindRegistrySnapshot,
  decodeSessionBoundaryView,
  decodeProductFeatureView,
  filterCacheKeysForProjectSwitch,
  purgeInaccessibleCachesOnAccessChange,
  type CacheKeyFactoryParams,
  type CacheKeyQueryTuple,
  type CacheKeyScope,
} from '../../contracts/src/frontend-entry.js';

// ============================================================================
// 1. Client Outcome Resolution Service
// ============================================================================

export type ServerResolutionProvider<TPayload = unknown> = {
  getOutcomeByClientRequestId(clientRequestId: string): Promise<FrontendCommandOutcomeView | null>;
  getOutcomeByIdempotencyKey(
    idempotencyKey: string,
    principalId: string,
    targetProjectId: string,
    commandType: string,
  ): Promise<FrontendCommandOutcomeView | null>;
  getServerOutcomeResolution?: (
    request: FrontendCommandRequest<TPayload>,
  ) => Promise<CommandOutcomeResolution>;
};

export async function resolveCommandOutcomeClient<TPayload>(
  request: FrontendCommandRequest<TPayload>,
  principalId: string,
  provider: ServerResolutionProvider<TPayload>,
): Promise<CommandOutcomeResolution> {
  const digest = await computeCommandSemanticDigestAsync(request);

  // Step 1: Scope & ID lookup by clientRequestId
  const byReqId = await provider.getOutcomeByClientRequestId(request.clientRequestId);
  if (byReqId) {
    if (
      byReqId.acceptedPrincipalContext.principalId !== principalId ||
      byReqId.acceptedProjectContext.targetProjectId !== request.projectContext.targetProjectId ||
      byReqId.commandType !== request.commandType
    ) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        `clientRequestId '${request.clientRequestId}' found but scope mismatch (principal/project/commandType)`,
      );
    }
    if (byReqId.commandSemanticDigest !== digest) {
      throw new FrontendContractError(
        'DIGEST_MISMATCH',
        `clientRequestId '${request.clientRequestId}' found but semantic digest mismatch`,
      );
    }
    if (byReqId.outcomeState === 'REJECTED' && byReqId.rejection?.code === 'RETENTION_EXPIRED') {
      return { resolution: 'RETENTION_EXPIRED', lastKnownOutcome: byReqId };
    }
    return { resolution: 'FOUND', outcome: byReqId };
  }

  // Step 2: Scope & ID lookup by idempotencyKey
  const byIdempotency = await provider.getOutcomeByIdempotencyKey(
    request.idempotencyKey,
    principalId,
    request.projectContext.targetProjectId,
    request.commandType,
  );

  if (byIdempotency) {
    if (byIdempotency.commandSemanticDigest !== digest) {
      throw new FrontendContractError(
        'IDEMPOTENCY_KEY_REUSE_MISMATCH',
        `Idempotency key '${request.idempotencyKey}' reused with different semantic digest`,
      );
    }
    if (
      byIdempotency.outcomeState === 'REJECTED' &&
      byIdempotency.rejection?.code === 'RETENTION_EXPIRED'
    ) {
      return { resolution: 'RETENTION_EXPIRED', lastKnownOutcome: byIdempotency };
    }
    return { resolution: 'FOUND', outcome: byIdempotency };
  }

  // Step 3: Server explicit resolution check
  if (provider.getServerOutcomeResolution) {
    return provider.getServerOutcomeResolution(request);
  }

  // Default when lookup returns nothing: INDETERMINATE
  return { resolution: 'INDETERMINATE' };
}

// ============================================================================
// 2. Client Capability Guard Helper
// ============================================================================

export function checkClientCapability(
  boundaryCtx: SystemBoundaryContext,
  requirement: OperationRequirement,
) {
  return evaluateCapabilityGuard(boundaryCtx, requirement);
}
