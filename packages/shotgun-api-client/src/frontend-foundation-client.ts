import type {
  FrontendCommandOutcomeView,
  FrontendCommandRequest,
  OutcomeResolutionState,
  SystemBoundaryContext,
  OperationRequirement,
} from '../../contracts/src/index.js';
import {
  computeCommandSemanticDigest,
  evaluateCapabilityGuard,
  FrontendContractError,
} from '../../contracts/src/index.js';

export {
  buildCacheKey,
  filterCacheKeysForProjectSwitch,
  purgeInaccessibleCachesOnAccessChange,
  type CacheKeyScope,
  type CacheKeyFactoryParams,
  type CacheKeyQueryTuple,
} from '../../contracts/src/index.js';

// ============================================================================
// 1. Client Outcome Resolution Service
// ============================================================================

export type ServerResolutionProvider<TPayload = unknown> = {
  getOutcomeByClientRequestId(
    clientRequestId: string,
  ): Promise<FrontendCommandOutcomeView<TPayload> | null>;
  getOutcomeByIdempotencyKey(
    idempotencyKey: string,
    principalId: string,
    targetProjectId: string,
    commandType: string,
  ): Promise<FrontendCommandOutcomeView<TPayload> | null>;
  getServerOutcomeResolution?: (
    request: FrontendCommandRequest<TPayload>,
  ) => Promise<OutcomeResolutionState>;
};

export async function resolveCommandOutcomeClient<TPayload>(
  request: FrontendCommandRequest<TPayload>,
  principalId: string,
  provider: ServerResolutionProvider<TPayload>,
): Promise<{
  readonly resolution: OutcomeResolutionState;
  readonly outcome?: FrontendCommandOutcomeView<TPayload>;
}> {
  const digest = computeCommandSemanticDigest(request);

  // Step 1: Lookup by clientRequestId
  const byReqId = await provider.getOutcomeByClientRequestId(request.clientRequestId);
  if (byReqId) {
    if (byReqId.resolution === 'RETENTION_EXPIRED') {
      return { resolution: 'RETENTION_EXPIRED', outcome: byReqId };
    }
    return { resolution: 'FOUND', outcome: byReqId };
  }

  // Step 2: Lookup by idempotencyKey
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
    if (byIdempotency.resolution === 'RETENTION_EXPIRED') {
      return { resolution: 'RETENTION_EXPIRED', outcome: byIdempotency };
    }
    return { resolution: 'FOUND', outcome: byIdempotency };
  }

  // Step 3: Server explicit resolution check
  if (provider.getServerOutcomeResolution) {
    const res = await provider.getServerOutcomeResolution(request);
    return { resolution: res };
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
