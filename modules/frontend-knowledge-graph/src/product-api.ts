import {
  FrontendContractError,
  GRAPH_AUTHORITY_CLASSIFICATIONS,
  GRAPH_RESOURCE_KINDS,
  sha256Text,
  stableJson,
  type GraphAppliedLimitsV1,
  type GraphBaseViewKindV1,
  type GraphCapabilitiesViewV1,
  type GraphConflictOverlayRequestV1,
  type GraphDiscoveryOverlayRequestV1,
  type GraphContinuationBindingV1,
  type GraphContinuationTokenV1,
  type GraphEvidenceDetailRequestV1,
  type GraphEvidenceDetailResultV1,
  type GraphFilterSetV1,
  type GraphKnowledgeGapOverlayRequestV1,
  type GraphNeighborhoodRequestV1,
  type GraphNeighborhoodResultV1,
  type GraphNodeReferenceV1,
  type GraphOverlayKindV1,
  type GraphOverlayResultV1,
  type GraphPathDescriptionV1,
  type GraphPathDescribeRequestV1,
  type GraphPathRequestV1,
  type GraphPathResultV1,
  type GraphProjectionHealthV1,
  type GraphRecursiveImpactOverlayRequestV1,
  type GraphRestoreRequestV1,
  type GraphRestoreResultV1,
  type GraphResultCompletenessV1,
  type GraphSnapshotIdentityV1,
  type GraphSnapshotRefreshRequestV1,
  type GraphSnapshotRequestV1,
  type GraphSnapshotResultV1,
  type GraphTraversalLimitsV1,
} from '../../../packages/contracts/src/index.js';
import type {
  GraphDiscoveryOverlayPort,
  GraphReadPort,
  GraphReadScopeV1,
  GraphImpactPort,
} from './graph-read-port.js';
import type { HealthStorePort, GraphOverlayHealthRecordV1 } from './health-store-port.js';
import type {
  GraphSnapshotContextDescriptorV1,
  SnapshotContextStorePort,
} from './snapshot-context-store-port.js';

export const GRAPH_DOMAIN_VERSION = '1.0.0';
export const GRAPH_SNAPSHOT_CONTEXT_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const GRAPH_CONTINUATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const graphFiltersDigest = (filters: GraphFilterSetV1 | undefined): string =>
  `sha256:${sha256Text(stableJson(filters ?? { schemaVersion: '1.0.0' }))}`;

export type GraphReadDomainInput = {
  readonly readPort: GraphReadPort;
  readonly impactPort: GraphImpactPort;
  readonly snapshotContextStore: SnapshotContextStorePort;
  readonly healthStore: HealthStorePort;
  readonly discoveryOverlayPort?: GraphDiscoveryOverlayPort;
  readonly now?: () => string;
};

const freshId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const clampLimits = (
  requested: GraphTraversalLimitsV1 | undefined,
  caps: GraphTraversalLimitsV1,
): { limits: GraphTraversalLimitsV1; applied: GraphAppliedLimitsV1 } => {
  const r = requested;
  const limits: GraphTraversalLimitsV1 = {
    schemaVersion: '1.0.0',
    maxDepth: Math.min(r?.maxDepth ?? caps.maxDepth, caps.maxDepth),
    maxNodes: Math.min(r?.maxNodes ?? caps.maxNodes, caps.maxNodes),
    maxEdges: Math.min(r?.maxEdges ?? caps.maxEdges, caps.maxEdges),
    traversalBudget: Math.min(r?.traversalBudget ?? caps.traversalBudget, caps.traversalBudget),
    serverTimeoutBudgetMs: Math.min(
      r?.serverTimeoutBudgetMs ?? caps.serverTimeoutBudgetMs,
      caps.serverTimeoutBudgetMs,
    ),
  };
  const clamped =
    (r !== undefined &&
      (r.maxDepth > caps.maxDepth ||
        r.maxNodes > caps.maxNodes ||
        r.maxEdges > caps.maxEdges ||
        r.traversalBudget > caps.traversalBudget ||
        r.serverTimeoutBudgetMs > caps.serverTimeoutBudgetMs)) ||
    false;
  const applied: GraphAppliedLimitsV1 = {
    ...limits,
    schemaVersion: '1.0.0',
    requestedMaxDepth: r?.maxDepth ?? null,
    requestedMaxNodes: r?.maxNodes ?? null,
    requestedMaxEdges: r?.maxEdges ?? null,
    clamped,
  };
  return { limits, applied };
};

export type GraphReadDomain = {
  snapshot(
    scope: GraphReadScopeV1,
    request: GraphSnapshotRequestV1,
  ): Promise<GraphSnapshotResultV1>;
  neighborhood(
    scope: GraphReadScopeV1,
    request: GraphNeighborhoodRequestV1,
  ): Promise<GraphNeighborhoodResultV1>;
  path(scope: GraphReadScopeV1, request: GraphPathRequestV1): Promise<GraphPathResultV1>;
  pathDescription(
    scope: GraphReadScopeV1,
    request: GraphPathDescribeRequestV1,
  ): Promise<GraphPathDescriptionV1>;
  conflictOverlay(
    scope: GraphReadScopeV1,
    request: GraphConflictOverlayRequestV1,
  ): Promise<GraphOverlayResultV1>;
  discoveryOverlay(
    scope: GraphReadScopeV1,
    request: GraphDiscoveryOverlayRequestV1,
  ): Promise<GraphOverlayResultV1>;
  gapOverlay(
    scope: GraphReadScopeV1,
    request: GraphKnowledgeGapOverlayRequestV1,
  ): Promise<GraphOverlayResultV1>;
  impactOverlay(
    scope: GraphReadScopeV1,
    request: GraphRecursiveImpactOverlayRequestV1,
  ): Promise<GraphOverlayResultV1>;
  evidenceDetail(
    scope: GraphReadScopeV1,
    request: GraphEvidenceDetailRequestV1,
  ): Promise<GraphEvidenceDetailResultV1>;
  refresh(
    scope: GraphReadScopeV1,
    request: GraphSnapshotRefreshRequestV1,
  ): Promise<GraphSnapshotResultV1>;
  restore(scope: GraphReadScopeV1, request: GraphRestoreRequestV1): Promise<GraphRestoreResultV1>;
};

export const createGraphReadDomain = (input: GraphReadDomainInput): GraphReadDomain => {
  const { readPort, impactPort, snapshotContextStore, healthStore, discoveryOverlayPort } = input;
  const nowIso = input.now ?? (() => new Date().toISOString());
  const caps: GraphTraversalLimitsV1 = {
    schemaVersion: '1.0.0',
    maxDepth: 10,
    maxNodes: 500,
    maxEdges: 1000,
    traversalBudget: 100_000,
    serverTimeoutBudgetMs: 30_000,
  };

  const capabilities = (overlayKinds: readonly GraphOverlayKindV1[]): GraphCapabilitiesViewV1 => ({
    schemaVersion: '1.0.0',
    capabilities: [
      'SNAPSHOT',
      'NEIGHBORHOOD',
      'PATH',
      'PATH_DESCRIPTION',
      'EVIDENCE_DETAIL',
      'SNAPSHOT_REFRESH',
      'DEEP_LINK_RESTORE',
      ...(overlayKinds.includes('CONFLICT') ? (['CONFLICT_OVERLAY'] as const) : []),
      ...(overlayKinds.includes('KNOWLEDGE_GAP') ? (['GAP_OVERLAY'] as const) : []),
      ...(overlayKinds.includes('RECURSIVE_IMPACT') ? (['IMPACT_OVERLAY'] as const) : []),
      ...(overlayKinds.includes('DISCOVERY') ? (['DISCOVERY_OVERLAY'] as const) : []),
    ],
  });

  const assertScopeMatch = (
    scope: GraphReadScopeV1,
    revisionBinding: { accessRevision: string; policyContextRevision: string },
  ): void => {
    if (scope.accessRevision !== revisionBinding.accessRevision) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        'graph read access revision mismatch',
      );
    }
    if (scope.policyContextRevision !== revisionBinding.policyContextRevision) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        'graph read policy revision mismatch',
      );
    }
  };

  const descriptorFor = async (
    scope: GraphReadScopeV1,
    snapshotId: string,
    projectionRevision: string,
  ): Promise<GraphSnapshotContextDescriptorV1> => {
    const descriptor = await snapshotContextStore.resolve(scope.activeProjectId, snapshotId);
    if (!descriptor)
      throw new FrontendContractError('NOT_FOUND', `unknown snapshot context ${snapshotId}`);
    if (descriptor.projectionRevision !== projectionRevision) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        'snapshot projection revision mismatch',
      );
    }
    assertScopeMatch(scope, descriptor);
    return descriptor;
  };

  const writeSnapshotContext = async (
    scope: GraphReadScopeV1,
    identity: GraphSnapshotIdentityV1,
    request: GraphSnapshotRequestV1,
    limits: GraphTraversalLimitsV1,
  ): Promise<void> => {
    const descriptor: GraphSnapshotContextDescriptorV1 = {
      snapshotId: identity.snapshotId,
      projectId: identity.projectId,
      viewKind: identity.viewKind,
      overlayKinds: request.overlayKinds,
      rootRefs: request.rootRefs ?? [],
      normalizedFilters: request.filters ?? { schemaVersion: '1.0.0' },
      filtersDigest: graphFiltersDigest(request.filters),
      limits,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      projectionRevision: identity.projectionRevision,
      generatedAt: identity.generatedAt,
      expiresAt: new Date(
        Date.parse(identity.generatedAt) + GRAPH_SNAPSHOT_CONTEXT_TTL_MS,
      ).toISOString(),
    };
    await snapshotContextStore.write(descriptor);
  };

  const writeProjectionHealth = async (
    scope: GraphReadScopeV1,
    viewKind: GraphBaseViewKindV1,
    projectionRevision: string,
    status: GraphProjectionHealthV1,
    generatedAt: string,
  ): Promise<void> => {
    await healthStore.upsertProjectionHealth({
      projectId: scope.activeProjectId,
      viewKind,
      projectionRevision,
      status,
      generatedAt,
      lag: 0,
      rebuildState: 'IDLE',
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
    });
  };

  const nextContinuation = async (
    scope: GraphReadScopeV1,
    snapshotId: string,
    rootRef: GraphNodeReferenceV1 | undefined,
    filters: GraphFilterSetV1 | undefined,
    viewKind: GraphBaseViewKindV1,
    overlayKinds: readonly GraphOverlayKindV1[],
    limits: GraphTraversalLimitsV1,
  ): Promise<GraphContinuationTokenV1 | undefined> => {
    const binding: GraphContinuationBindingV1 = {
      schemaVersion: '1.0.0',
      principalId: scope.principalId,
      sessionId: scope.sessionId,
      projectId: scope.activeProjectId,
      accessRevision: scope.accessRevision,
      policyContextRevision: scope.policyContextRevision,
      snapshotId,
      rootRef,
      filtersDigest: graphFiltersDigest(filters),
      viewKind,
      overlayKinds,
      limits,
    };
    const token = freshId('graph-continuation');
    const expiresAt = new Date(Date.parse(nowIso()) + GRAPH_CONTINUATION_TTL_MS).toISOString();
    await healthStore.writeContinuation({
      token,
      expiresAt,
      principalId: binding.principalId,
      sessionId: binding.sessionId,
      projectId: binding.projectId,
      accessRevision: binding.accessRevision,
      policyContextRevision: binding.policyContextRevision,
      snapshotId: binding.snapshotId,
      rootRef: binding.rootRef,
      filtersDigest: binding.filtersDigest,
      viewKind: binding.viewKind,
      overlayKinds: binding.overlayKinds,
      limits: binding.limits,
    });
    return { schemaVersion: '1.0.0', token, expiresAt };
  };

  const assertContinuation = async (
    scope: GraphReadScopeV1,
    token: string,
    snapshotId: string,
    context: {
      filtersDigest: string;
      viewKind: GraphBaseViewKindV1;
      overlayKinds: readonly GraphOverlayKindV1[];
      limits: GraphTraversalLimitsV1;
    },
  ): Promise<void> => {
    const record = await healthStore.findContinuation(token);
    if (!record)
      throw new FrontendContractError('NOT_FOUND', 'continuation token is unknown or expired');
    if (Date.parse(record.expiresAt) <= Date.parse(nowIso())) {
      throw new FrontendContractError('NOT_FOUND', 'continuation token expired');
    }
    if (record.principalId !== scope.principalId || record.sessionId !== scope.sessionId) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        'continuation principal/session mismatch',
      );
    }
    if (record.projectId !== scope.activeProjectId || record.snapshotId !== snapshotId) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        'continuation project/snapshot mismatch',
      );
    }
    if (
      record.accessRevision !== scope.accessRevision ||
      record.policyContextRevision !== scope.policyContextRevision
    ) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        'continuation revision mismatch',
      );
    }
    if (record.filtersDigest !== context.filtersDigest) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        'continuation filters mismatch',
      );
    }
    if (record.viewKind !== context.viewKind) {
      throw new FrontendContractError('PRECONDITION_ACCESS_DENIED', 'continuation view mismatch');
    }
    if (
      record.overlayKinds.length !== context.overlayKinds.length ||
      [...record.overlayKinds].sort().join(',') !== [...context.overlayKinds].sort().join(',')
    ) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        'continuation overlay mismatch',
      );
    }
    if (
      record.limits.maxDepth !== context.limits.maxDepth ||
      record.limits.maxNodes !== context.limits.maxNodes ||
      record.limits.maxEdges !== context.limits.maxEdges ||
      record.limits.traversalBudget !== context.limits.traversalBudget ||
      record.limits.serverTimeoutBudgetMs !== context.limits.serverTimeoutBudgetMs
    ) {
      throw new FrontendContractError('PRECONDITION_ACCESS_DENIED', 'continuation limits mismatch');
    }
  };

  const overlayResult = async (
    scope: GraphReadScopeV1,
    baseSnapshotId: string,
    overlayKind: GraphOverlayKindV1,
    nodes: GraphSnapshotResultV1['nodes'],
    edges: GraphSnapshotResultV1['edges'],
    completeness: GraphResultCompletenessV1,
    appliedLimits: GraphAppliedLimitsV1,
    projectionRevision: string,
    filter: (kind: GraphOverlayKindV1) => boolean,
  ): Promise<GraphOverlayResultV1> => {
    const overlayNodes = nodes.filter((node) => node.overlayMemberships.includes(overlayKind));
    const overlayEdges = edges.filter((edge) => edge.overlayMemberships.includes(overlayKind));
    const generatedAt = nowIso();
    const identity = {
      schemaVersion: '1.0.0' as const,
      overlayKind,
      overlaySnapshotId: freshId(`overlay-${overlayKind.toLowerCase()}`),
      overlayRevision: freshId('overlay-rev'),
      analyzerRevision:
        overlayKind === 'RECURSIVE_IMPACT' ? freshId('analyzer') : freshId('registry'),
      policyContextRevision: scope.policyContextRevision,
      generatedAt,
      completeness,
      truncation: undefined,
      unavailableReason: undefined,
    };
    const record: GraphOverlayHealthRecordV1 = {
      projectId: scope.activeProjectId,
      baseSnapshotId,
      overlayKind,
      overlaySnapshotId: identity.overlaySnapshotId,
      overlayRevision: identity.overlayRevision,
      analyzerRevision: identity.analyzerRevision,
      policyContextRevision: scope.policyContextRevision,
      generatedAt,
      completeness,
    };
    await healthStore.upsertOverlayHealth(record);
    void filter;
    return {
      schemaVersion: '1.0.0',
      baseSnapshotId,
      projectionRevision,
      identity,
      health: 'COMPLETE',
      completeness,
      nodes: overlayNodes,
      edges: overlayEdges,
      appliedLimits,
    };
  };

  return {
    async snapshot(scope, request) {
      const { limits, applied } = clampLimits(request.limits, caps);
      const result = await readPort.snapshot(scope, { ...request, limits });
      const snapshotResult: GraphSnapshotResultV1 = {
        ...result,
        appliedLimits: applied,
        capabilities: capabilities(request.overlayKinds),
      };
      await writeSnapshotContext(scope, result.identity, request, limits);
      await writeProjectionHealth(
        scope,
        result.identity.viewKind,
        result.identity.projectionRevision,
        result.health,
        result.identity.generatedAt,
      );
      if (result.completeness === 'PARTIAL') {
        const rootRef = request.rootRefs?.[0];
        snapshotResult.continuation = await nextContinuation(
          scope,
          result.identity.snapshotId,
          rootRef,
          request.filters,
          request.viewKind,
          request.overlayKinds,
          limits,
        );
      }
      return snapshotResult;
    },

    async neighborhood(scope, request) {
      const descriptor = await descriptorFor(scope, request.snapshotId, request.projectionRevision);
      const { limits, applied } = clampLimits(request.limits ?? descriptor.limits, caps);
      if (request.continuationToken) {
        await assertContinuation(scope, request.continuationToken, request.snapshotId, {
          filtersDigest: graphFiltersDigest(request.filters ?? descriptor.normalizedFilters),
          viewKind: descriptor.viewKind,
          overlayKinds: descriptor.overlayKinds,
          limits,
        });
      }
      const result = await readPort.neighborhood(scope, { ...request, limits });
      const neighborhoodResult: GraphNeighborhoodResultV1 = { ...result, appliedLimits: applied };
      if (result.completeness === 'PARTIAL') {
        // AC-05: a PARTIAL neighborhood issues a fresh continuation bound to
        // the same snapshot context, center, filters, view, overlays and
        // limits so the next page can be requested.
        neighborhoodResult.continuation = await nextContinuation(
          scope,
          request.snapshotId,
          request.centerRef,
          request.filters ?? descriptor.normalizedFilters,
          descriptor.viewKind,
          descriptor.overlayKinds,
          limits,
        );
      }
      return neighborhoodResult;
    },

    async path(scope, request) {
      const descriptor = await descriptorFor(scope, request.snapshotId, request.projectionRevision);
      const { limits, applied } = clampLimits(request.limits ?? descriptor.limits, caps);
      const result = await readPort.path(scope, { ...request, limits });
      return { ...result, appliedLimits: applied };
    },

    async pathDescription(scope, request) {
      await descriptorFor(scope, request.snapshotId, request.projectionRevision);
      return readPort.pathDescription(scope, request);
    },

    async conflictOverlay(scope, request) {
      const descriptor = await descriptorFor(scope, request.snapshotId, request.projectionRevision);
      const { limits, applied } = clampLimits(request.limits ?? descriptor.limits, caps);
      const base = await readPort.snapshot(scope, {
        schemaVersion: '1.0.0',
        viewKind: descriptor.viewKind,
        overlayKinds: ['CONFLICT'],
        rootRefs: descriptor.rootRefs,
        filters: request.filters,
        limits,
      });
      return overlayResult(
        scope,
        request.snapshotId,
        'CONFLICT',
        base.nodes,
        base.edges,
        base.completeness,
        applied,
        request.projectionRevision,
        () => true,
      );
    },

    async gapOverlay(scope, request) {
      const descriptor = await descriptorFor(scope, request.snapshotId, request.projectionRevision);
      const { limits, applied } = clampLimits(request.limits ?? descriptor.limits, caps);
      const base = await readPort.snapshot(scope, {
        schemaVersion: '1.0.0',
        viewKind: descriptor.viewKind,
        overlayKinds: ['KNOWLEDGE_GAP'],
        rootRefs: descriptor.rootRefs,
        filters: request.filters,
        limits,
      });
      return overlayResult(
        scope,
        request.snapshotId,
        'KNOWLEDGE_GAP',
        base.nodes,
        base.edges,
        base.completeness,
        applied,
        request.projectionRevision,
        () => true,
      );
    },

    async impactOverlay(scope, request) {
      const descriptor = await descriptorFor(scope, request.snapshotId, request.projectionRevision);
      const { limits, applied } = clampLimits(request.limits ?? descriptor.limits, caps);
      if (request.continuationToken) {
        await assertContinuation(scope, request.continuationToken, request.snapshotId, {
          filtersDigest: graphFiltersDigest(request.filters ?? descriptor.normalizedFilters),
          viewKind: descriptor.viewKind,
          overlayKinds: descriptor.overlayKinds,
          limits,
        });
      }
      void (await readPort.snapshot(scope, {
        schemaVersion: '1.0.0',
        viewKind: descriptor.viewKind,
        overlayKinds: ['RECURSIVE_IMPACT'],
        rootRefs: descriptor.rootRefs,
        filters: request.filters,
        limits,
      }));
      const result = await impactPort.recursiveImpact(
        scope,
        { ...request, limits },
        request.snapshotId,
      );
      return { ...result, projectionRevision: request.projectionRevision, appliedLimits: applied };
    },

    async discoveryOverlay(scope, request) {
      const descriptor = await descriptorFor(
        scope,
        request.baseSnapshotId,
        request.projectionRevision,
      );
      const { limits, applied } = clampLimits(request.limits ?? descriptor.limits, caps);
      const base = readPort.getSnapshot
        ? await readPort.getSnapshot(scope, request.baseSnapshotId, request.projectionRevision)
        : await readPort.snapshot(scope, {
            schemaVersion: '1.0.0',
            viewKind: descriptor.viewKind,
            overlayKinds: descriptor.overlayKinds,
            rootRefs: descriptor.rootRefs,
            limits,
          });
      const unavailableResult = () => {
        const generatedAt = nowIso();
        return {
          schemaVersion: '1.0.0' as const,
          baseSnapshotId: request.baseSnapshotId,
          projectionRevision: request.projectionRevision,
          identity: {
            schemaVersion: '1.0.0' as const,
            overlayKind: 'DISCOVERY' as const,
            overlaySnapshotId: freshId('overlay-discovery'),
            overlayRevision: freshId('overlay-rev'),
            analyzerRevision: 'discovery-overlay-unavailable',
            policyContextRevision: scope.policyContextRevision,
            generatedAt,
            completeness: 'COMPLETE' as const,
            unavailableReason: 'OVERLAY_UNAVAILABLE' as const,
          },
          health: 'UNAVAILABLE' as const,
          completeness: 'COMPLETE' as const,
          nodes: [],
          edges: [],
          appliedLimits: applied,
        } satisfies GraphOverlayResultV1;
      };
      if (
        !base ||
        base.identity.snapshotId !== request.baseSnapshotId ||
        base.identity.projectionRevision !== request.projectionRevision
      ) {
        return unavailableResult();
      }
      if (!discoveryOverlayPort) {
        return unavailableResult();
      }
      const result = await discoveryOverlayPort.discoveryOverlay(
        scope,
        {
          ...request,
          limits,
        },
        base,
      );
      if (
        result.baseSnapshotId !== request.baseSnapshotId ||
        result.projectionRevision !== request.projectionRevision ||
        result.identity.overlayKind !== 'DISCOVERY' ||
        (result.health !== 'UNAVAILABLE' &&
          (result.identity.sourceRef?.kind !== 'DISCOVERY_FINDING' ||
            result.identity.sourceRef.findingId !== request.findingId ||
            result.identity.sourceRef.findingRevision !== request.findingRevision))
      ) {
        throw new FrontendContractError(
          'UNSUPPORTED_SCHEMA',
          'discovery overlay result identity does not match request',
        );
      }
      return { ...result, appliedLimits: applied };
    },

    async evidenceDetail(scope, request) {
      await descriptorFor(scope, request.snapshotId, request.projectionRevision);
      return readPort.evidenceDetail(scope, request);
    },

    async refresh(scope, request) {
      const descriptor = await descriptorFor(scope, request.snapshotId, request.projectionRevision);
      if (descriptor.projectionRevision !== request.expectedSnapshotRevision) {
        throw new FrontendContractError(
          'PRECONDITION_ACCESS_DENIED',
          'expected snapshot revision mismatch',
        );
      }
      const { limits, applied } = clampLimits(descriptor.limits, caps);
      const result = await readPort.refresh(scope, request);
      assertScopeMatch(scope, descriptor);
      const snapshotResult: GraphSnapshotResultV1 = {
        ...result,
        appliedLimits: applied,
        capabilities: capabilities(descriptor.overlayKinds),
      };
      await writeSnapshotContext(
        scope,
        result.identity,
        {
          schemaVersion: '1.0.0',
          rootRefs: descriptor.rootRefs,
          viewKind: descriptor.viewKind,
          overlayKinds: descriptor.overlayKinds,
          filters: descriptor.normalizedFilters,
          limits,
        },
        limits,
      );
      await writeProjectionHealth(
        scope,
        result.identity.viewKind,
        result.identity.projectionRevision,
        result.health,
        result.identity.generatedAt,
      );
      return snapshotResult;
    },

    async restore(scope, request) {
      await descriptorFor(scope, request.snapshotId, request.projectionRevision);
      return readPort.restore(scope, request);
    },
  };
};

export const GRAPH_RESOURCE_KINDS_ALL = GRAPH_RESOURCE_KINDS;
export const GRAPH_AUTHORITY_CLASSIFICATIONS_ALL = GRAPH_AUTHORITY_CLASSIFICATIONS;
