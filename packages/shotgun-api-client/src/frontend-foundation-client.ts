import type {
  FrontendCommandOutcomeView,
  FrontendCommandRequest,
  OutcomeResolutionState,
  SystemBoundaryContext,
} from '../../contracts/src/index.js';
import {
  computeCommandSemanticDigest,
  evaluateCapabilityGuard,
} from '../../contracts/src/index.js';

// ============================================================================
// 1. Cache Key Factory
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
      // Global background cache is NOT purged on project switch
      validKeys.push(key);
    } else if (project === newActiveProjectId) {
      validKeys.push(key);
    } else {
      purgedOrMaskedKeys.push(key);
    }
  }

  return { validKeys, purgedOrMaskedKeys };
}

// ============================================================================
// 2. Client Outcome Resolution Service
// ============================================================================

export type OutcomeLookupProvider<TPayload = unknown> = {
  getOutcomeByClientRequestId(
    clientRequestId: string,
  ): Promise<FrontendCommandOutcomeView<TPayload> | null>;
  getOutcomeByIdempotencyKey(
    idempotencyKey: string,
    principalId: string,
    targetProjectId: string,
    commandType: string,
  ): Promise<FrontendCommandOutcomeView<TPayload> | null>;
  checkDomainResourceStatus?: (
    resourceKind: string,
    resourceId: string,
  ) => Promise<{ exists: boolean; stateMatches: boolean }>;
};

export async function resolveCommandOutcomeClient<TPayload>(
  request: FrontendCommandRequest<TPayload>,
  principalId: string,
  provider: OutcomeLookupProvider<TPayload>,
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
      throw new Error(
        `Idempotency key reuse mismatch: ${request.idempotencyKey} has different digest`,
      );
    }
    if (byIdempotency.resolution === 'RETENTION_EXPIRED') {
      return { resolution: 'RETENTION_EXPIRED', outcome: byIdempotency };
    }
    return { resolution: 'FOUND', outcome: byIdempotency };
  }

  // Step 3: Domain resource status check
  if (provider.checkDomainResourceStatus) {
    const targetPrecondition = request.preconditions.find((p) => p.purpose === 'TARGET');
    if (targetPrecondition) {
      const status = await provider.checkDomainResourceStatus(
        targetPrecondition.subject.resourceKind,
        targetPrecondition.subject.resourceId,
      );
      if (status.exists && status.stateMatches) {
        return { resolution: 'FOUND' };
      }
      if (!status.exists) {
        return { resolution: 'NOT_ACCEPTED_CONFIRMED' };
      }
      return { resolution: 'INDETERMINATE' };
    }
  }

  return { resolution: 'NOT_ACCEPTED_CONFIRMED' };
}

// ============================================================================
// 3. Client Capability Guard Helper
// ============================================================================

export function checkClientCapability(
  boundaryCtx: SystemBoundaryContext,
  requiredCapability: string,
  options?: {
    readonly isSensitiveResource?: boolean;
    readonly resourceProjectId?: string;
  },
) {
  return evaluateCapabilityGuard(boundaryCtx, requiredCapability, options);
}
