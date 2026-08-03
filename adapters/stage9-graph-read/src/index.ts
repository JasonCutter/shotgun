import {
  FrontendContractError,
  type GraphAppliedLimitsV1,
  type GraphBaseViewKindV1,
  type GraphEdgeV1,
  type GraphEvidenceDetailResultV1,
  type GraphFilterSetV1,
  type GraphNeighborhoodResultV1,
  type GraphNodeV1,
  type GraphOverlayResultV1,
  type GraphPathDescriptionV1,
  type GraphPathResultV1,
  type GraphPathSegmentV1,
  type GraphProjectionHealthV1,
  type GraphRecursiveImpactOverlayRequestV1,
  type GraphResultCompletenessV1,
  type GraphRestoreResultV1,
  type GraphSnapshotIdentityV1,
  type GraphSnapshotResultV1,
  type GraphTraversalLimitsV1,
  type GraphTruncationStateV1,
} from '../../../packages/contracts/src/index.js';
import type {
  GraphImpactPort,
  GraphReadPort,
  GraphReadScopeV1,
} from '../../../modules/frontend-knowledge-graph/src/index.js';

/**
 * FE-P3-S3 graph read adapter over the approved graph read sources (Canonical,
 * Stage 9 knowledge-model, Compiled Truth). In production the dataset is
 * projected from those read sources; this reference implementation computes
 * bounded snapshots/neighborhoods/paths/overlays over a provided typed graph
 * dataset and never exposes Stage 9 or NetworkX identifiers as FE-P3-S3
 * Canonical IDs.
 */

type SnapshotContextCache = {
  filters: GraphFilterSetV1;
  limits: GraphTraversalLimitsV1;
  viewKind: GraphBaseViewKindV1;
};

const freshId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const matchFilters = (node: GraphNodeV1, filters?: GraphFilterSetV1): boolean => {
  if (!filters) return true;
  if (filters.nodeKindFilters && !filters.nodeKindFilters.includes(node.nodeKind)) return false;
  if (filters.authorityFilters && !filters.authorityFilters.includes(node.authority)) return false;
  return true;
};

const matchEdgeFilters = (edge: GraphEdgeV1, filters?: GraphFilterSetV1): boolean => {
  if (!filters) return true;
  if (
    filters.edgeSemanticKindFilters &&
    !filters.edgeSemanticKindFilters.includes(edge.edgeSemanticKind)
  ) {
    return false;
  }
  if (filters.authorityFilters && !filters.authorityFilters.includes(edge.authority)) return false;
  return true;
};

export class Stage9GraphReadAdapter implements GraphReadPort, GraphImpactPort {
  private readonly contexts = new Map<string, SnapshotContextCache>();
  private readonly resourceMap = new Map<string, GraphNodeV1>();

  constructor(
    private readonly nodes: readonly GraphNodeV1[],
    private readonly edges: readonly GraphEdgeV1[],
    private readonly projectionRevision: () => string = () => 'proj-1',
  ) {
    for (const node of nodes) this.resourceMap.set(node.resourceRef.resourceId, node);
  }

  private truncationFor(
    maxNodes: number,
    maxEdges: number,
    visited: ReadonlySet<string>,
    edgeCount: number,
  ): GraphTruncationStateV1 | undefined {
    if (visited.size > maxNodes || edgeCount > maxEdges) {
      return {
        schemaVersion: '1.0.0',
        truncated: true,
        reason: visited.size > maxNodes ? 'MAX_NODES' : 'MAX_EDGES',
        omittedNodeCount: Math.max(0, visited.size - maxNodes),
        omittedEdgeCount: Math.max(0, edgeCount - maxEdges),
      };
    }
    return undefined;
  }

  private boundedSnapshot(
    scope: GraphReadScopeV1,
    request: {
      rootRefs?: readonly { resourceId: string }[];
      viewKind: GraphBaseViewKindV1;
      overlayKinds?: readonly ('CONFLICT' | 'KNOWLEDGE_GAP' | 'RECURSIVE_IMPACT')[];
      filters?: GraphFilterSetV1;
      limits: GraphTraversalLimitsV1;
    },
    projectionRevision: string,
    snapshotId: string,
    health: GraphProjectionHealthV1,
  ): GraphSnapshotResultV1 {
    const rootIds = (request.rootRefs ?? []).map((ref) => ref.resourceId);
    const allowed =
      rootIds.length === 0
        ? this.nodes
        : this.nodes.filter((node) => rootIds.includes(node.resourceRef.resourceId));
    const filtered = allowed.filter((node) => matchFilters(node, request.filters));
    const nodes = filtered.slice(0, request.limits.maxNodes);
    const nodeIds = new Set(nodes.map((node) => node.nodeId));
    const edges = this.edges
      .filter((edge) => nodeIds.has(edge.from.resourceId) && nodeIds.has(edge.to.resourceId))
      .filter((edge) => matchEdgeFilters(edge, request.filters))
      .slice(0, request.limits.maxEdges);
    const visited = new Set(nodes.map((node) => node.nodeId));
    const truncation = this.truncationFor(
      request.limits.maxNodes,
      request.limits.maxEdges,
      visited,
      edges.length,
    );
    const completeness: GraphResultCompletenessV1 = truncation ? 'TRUNCATED' : 'COMPLETE';
    const identity: GraphSnapshotIdentityV1 = {
      schemaVersion: '1.0.0',
      snapshotId,
      projectId: scope.activeProjectId,
      viewKind: request.viewKind,
      projectionRevision,
      generatedAt: new Date().toISOString(),
    };
    this.contexts.set(snapshotId, {
      filters: request.filters ?? { schemaVersion: '1.0.0' },
      limits: request.limits,
      viewKind: request.viewKind,
    });
    return {
      schemaVersion: '1.0.0',
      identity,
      health,
      completeness,
      nodes,
      edges,
      appliedLimits: this.applied(request.limits),
      truncation,
      overlays: [],
      capabilities: { schemaVersion: '1.0.0', capabilities: [] },
    };
  }

  private applied(limits: GraphTraversalLimitsV1): GraphAppliedLimitsV1 {
    return {
      ...limits,
      schemaVersion: '1.0.0',
      requestedMaxDepth: null,
      requestedMaxNodes: null,
      requestedMaxEdges: null,
      clamped: false,
    };
  }

  async snapshot(scope: GraphReadScopeV1, request: Parameters<GraphReadPort['snapshot']>[1]) {
    const snapshotId = freshId('snapshot');
    const projectionRevision = this.projectionRevision();
    return this.boundedSnapshot(
      scope,
      { ...request, limits: request.limits ?? this.appliedLimitsDefault() },
      projectionRevision,
      snapshotId,
      'COMPLETE',
    );
  }

  async neighborhood(
    scope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['neighborhood']>[1],
  ): Promise<GraphNeighborhoodResultV1> {
    const context = this.contexts.get(request.snapshotId);
    const center = this.resourceMap.get(request.centerRef.resourceId);
    if (!center) throw new FrontendContractError('NOT_FOUND', `neighborhood center not found`);
    const neighbors = this.edges
      .filter(
        (edge) =>
          edge.from.resourceId === center.resourceRef.resourceId &&
          matchEdgeFilters(edge, context?.filters),
      )
      .slice(0, request.limits?.maxEdges ?? context?.limits.maxEdges ?? 100);
    const neighborNodes = neighbors
      .map((edge) => this.resourceMap.get(edge.to.resourceId))
      .filter((node): node is GraphNodeV1 => Boolean(node))
      .slice(0, request.limits?.maxNodes ?? context?.limits.maxNodes ?? 100);
    return {
      schemaVersion: '1.0.0',
      snapshotId: request.snapshotId,
      projectionRevision: request.projectionRevision,
      centerRef: request.centerRef,
      addedNodes: neighborNodes,
      addedEdges: neighbors,
      completeness: 'COMPLETE',
      appliedLimits: this.applied(request.limits ?? context?.limits ?? this.appliedLimitsDefault()),
    };
  }

  private appliedLimitsDefault(): GraphTraversalLimitsV1 {
    return {
      schemaVersion: '1.0.0',
      maxDepth: 3,
      maxNodes: 100,
      maxEdges: 200,
      traversalBudget: 1000,
      serverTimeoutBudgetMs: 5000,
    };
  }

  async path(
    scope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['path']>[1],
  ): Promise<GraphPathResultV1> {
    const from = this.resourceMap.get(request.fromRef.resourceId);
    const to = this.resourceMap.get(request.toRef.resourceId);
    if (!from || !to) throw new FrontendContractError('NOT_FOUND', 'path endpoint not found');
    const adjacency = new Map<string, { edge: GraphEdgeV1 }[]>();
    for (const edge of this.edges) {
      const list = adjacency.get(edge.from.resourceId) ?? [];
      list.push({ edge });
      adjacency.set(edge.from.resourceId, list);
    }
    const fromResourceId = from.resourceRef.resourceId;
    const toResourceId = to.resourceRef.resourceId;
    const queue: { id: string; segments: { nodeId: string; edgeId?: string }[] }[] = [
      { id: fromResourceId, segments: [{ nodeId: fromResourceId }] },
    ];
    const visited = new Set<string>([fromResourceId]);
    let found: { nodeId: string; edgeId?: string }[] | undefined;
    while (queue.length > 0 && found === undefined) {
      const current = queue.shift()!;
      if (current.id === toResourceId) {
        found = current.segments;
        break;
      }
      for (const { edge } of adjacency.get(current.id) ?? []) {
        if (!visited.has(edge.to.resourceId)) {
          visited.add(edge.to.resourceId);
          queue.push({
            id: edge.to.resourceId,
            segments: [...current.segments, { nodeId: edge.to.resourceId, edgeId: edge.edgeId }],
          });
        }
      }
    }
    if (!found) {
      return {
        schemaVersion: '1.0.0',
        snapshotId: request.snapshotId,
        projectionRevision: request.projectionRevision,
        fromRef: request.fromRef,
        toRef: request.toRef,
        paths: [],
        completeness: 'COMPLETE',
        appliedLimits: this.applied(request.limits ?? this.appliedLimitsDefault()),
      };
    }
    const segments: GraphPathSegmentV1[] = found.map((segment, index) => {
      if (index === 0) {
        const origin: GraphPathSegmentV1 = {
          schemaVersion: '1.0.0',
          kind: 'ORIGIN',
          step: 0,
          nodeRef: request.fromRef,
          direction: 'OUTGOING_FROM_ROOT',
        };
        return origin;
      }
      const traversal: GraphPathSegmentV1 = {
        schemaVersion: '1.0.0',
        kind: 'TRAVERSAL',
        step: index,
        nodeRef: { ...request.toRef, resourceId: segment.nodeId },
        edgeRef: {
          schemaVersion: '1.0.0',
          edgeId: segment.edgeId ?? '',
          from: request.fromRef,
          to: request.toRef,
        },
        direction: 'OUTGOING_FROM_ROOT',
      };
      return traversal;
    });
    return {
      schemaVersion: '1.0.0',
      snapshotId: request.snapshotId,
      projectionRevision: request.projectionRevision,
      fromRef: request.fromRef,
      toRef: request.toRef,
      paths: [{ pathId: 'path-1', segments }],
      completeness: 'COMPLETE',
      appliedLimits: this.applied(request.limits ?? this.appliedLimitsDefault()),
    };
  }

  async pathDescription(
    scope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['pathDescription']>[1],
  ): Promise<GraphPathDescriptionV1> {
    return {
      schemaVersion: '1.0.0',
      snapshotId: request.snapshotId,
      projectionRevision: request.projectionRevision,
      pathId: request.pathId,
      segments: [],
      summary: 'Path description requires a computed path in this adapter.',
    };
  }

  async evidenceDetail(
    scope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['evidenceDetail']>[1],
  ): Promise<GraphEvidenceDetailResultV1> {
    const target = this.resourceMap.get(
      request.target.kind === 'NODE' ? request.target.nodeRef.resourceId : request.target.edgeRef.edgeId,
    );
    void target;
    return {
      schemaVersion: '1.0.0',
      snapshotId: request.snapshotId,
      projectionRevision: request.projectionRevision,
      targetRef: request.target.kind === 'NODE' ? request.target.nodeRef : request.target.edgeRef,
      evidence: [],
      accessMasking: 'VISIBLE',
    };
  }

  async refresh(
    scope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['refresh']>[1],
  ): Promise<GraphSnapshotResultV1> {
    const context = this.contexts.get(request.snapshotId);
    if (!context)
      throw new FrontendContractError('NOT_FOUND', `unknown snapshot ${request.snapshotId}`);
    const snapshotId = freshId('snapshot');
    const projectionRevision = `${request.expectedSnapshotRevision}-refreshed`;
    return this.boundedSnapshot(
      scope,
      {
        viewKind: context.viewKind,
        filters: context.filters,
        limits: context.limits,
      },
      projectionRevision,
      snapshotId,
      'COMPLETE',
    );
  }

  async restore(
    scope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['restore']>[1],
  ): Promise<GraphRestoreResultV1> {
    const context = this.contexts.get(request.snapshotId);
    if (!context)
      throw new FrontendContractError('NOT_FOUND', `unknown snapshot ${request.snapshotId}`);
    const snapshot = this.boundedSnapshot(
      scope,
      { viewKind: request.viewKind, filters: context.filters, limits: context.limits },
      request.projectionRevision,
      request.snapshotId,
      'COMPLETE',
    );
    return {
      schemaVersion: '1.0.0',
      snapshot,
      focusRefs: request.selectedNodeRefs,
    };
  }

  async recursiveImpact(
    scope: GraphReadScopeV1,
    request: GraphRecursiveImpactOverlayRequestV1,
    baseSnapshotId: string,
  ): Promise<GraphOverlayResultV1> {
    void request;
    const context = this.contexts.get(baseSnapshotId);
    const impactNodes = this.nodes.filter(
      (node) =>
        node.authority === 'DERIVED_INFERENCE' ||
        node.overlayMemberships.includes('RECURSIVE_IMPACT'),
    );
    const impactEdges = this.edges.filter((edge) =>
      edge.overlayMemberships.includes('RECURSIVE_IMPACT'),
    );
    return {
      schemaVersion: '1.0.0',
      baseSnapshotId,
      projectionRevision: context?.limits ? 'proj-1' : 'proj-1',
      identity: {
        schemaVersion: '1.0.0',
        overlayKind: 'RECURSIVE_IMPACT',
        overlaySnapshotId: freshId('overlay-impact'),
        overlayRevision: freshId('overlay-rev'),
        analyzerRevision: 'networkx-oracle-v1',
        policyContextRevision: scope.policyContextRevision,
        generatedAt: new Date().toISOString(),
        completeness: 'COMPLETE',
      },
      health: 'COMPLETE',
      completeness: 'COMPLETE',
      nodes: impactNodes.slice(0, 100),
      edges: impactEdges.slice(0, 200),
      appliedLimits: this.applied(this.appliedLimitsDefault()),
    };
  }
}
