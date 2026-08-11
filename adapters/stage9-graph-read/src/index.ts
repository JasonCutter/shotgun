import {
  FrontendContractError,
  type GraphAppliedLimitsV1,
  type GraphBaseViewKindV1,
  type GraphEdgeV1,
  type GraphEvidenceDetailResultV1,
  type GraphEvidenceEntryV1,
  type GraphFilterSetV1,
  type GraphNeighborhoodResultV1,
  type GraphNodeReferenceV1,
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

const edgeSemanticKindLabel = (kind: string): string => {
  const labels: Readonly<Record<string, string>> = {
    CANONICAL_RELATION: 'Canonical relationship',
    CANONICAL_STATEMENT_ASSOCIATION: 'Canonical statement association',
    DERIVED_INFERENCE: 'Derived inference',
    DISCOVERY_CANDIDATE: 'Discovery candidate',
    POSSIBLY_SAME: 'Possible match',
    EVIDENCE_LINKAGE: 'Evidence link',
    CONFLICT: 'Conflict',
    KNOWLEDGE_GAP: 'Knowledge gap',
    TEMPORAL_RELATIONSHIP: 'Time relationship',
    GOVERNANCE_IMPACT: 'Governance impact',
    OPERATIONAL_DEPENDENCY: 'Operational dependency',
  };
  return labels[kind] ?? 'Relationship';
};

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

type StoredPath = {
  readonly pathId: string;
  readonly fromRef: GraphNodeReferenceV1;
  readonly toRef: GraphNodeReferenceV1;
  readonly steps: readonly { nodeId: string; edgeId?: string }[];
};

export class Stage9GraphReadAdapter implements GraphReadPort, GraphImpactPort {
  private readonly contexts = new Map<string, SnapshotContextCache>();
  private readonly resourceMap = new Map<string, GraphNodeV1>();
  private readonly edgeMap = new Map<string, GraphEdgeV1>();
  private readonly paths = new Map<string, StoredPath>();

  constructor(
    private readonly nodes: readonly GraphNodeV1[],
    private readonly edges: readonly GraphEdgeV1[],
    private readonly projectionRevision: () => string = () => 'proj-1',
    private readonly evidenceEntries: readonly GraphEvidenceEntryV1[] = [],
  ) {
    for (const node of nodes) this.resourceMap.set(node.resourceRef.resourceId, node);
    for (const edge of edges) this.edgeMap.set(edge.edgeId, edge);
  }

  private accessibleLabel(node: GraphNodeV1): string {
    if (node.accessMasking === 'MASKED') return '마스킹된 자원';
    return node.label;
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
    // Cross-Project deep-link denial: a requested root that does not exist in
    // the active Project's dataset is never silently switched to another
    // Project; it returns a typed access failure instead.
    if (rootIds.length > 0 && allowed.length === 0) {
      throw new FrontendContractError(
        'PRECONDITION_ACCESS_DENIED',
        'root resource is outside the active project',
      );
    }
    // HIDDEN resources never appear in any graph read (contract masking rule).
    const filtered = allowed
      .filter((node) => node.accessMasking !== 'HIDDEN')
      .filter((node) => matchFilters(node, request.filters));
    const omittedNodeCount = Math.max(0, filtered.length - request.limits.maxNodes);
    const nodes = filtered.slice(0, request.limits.maxNodes);
    // Edges reference resourceIds, not nodeIds; build a resourceId set so
    // edges whose endpoints are both in the snapshot are included.
    const resourceIds = new Set(nodes.map((node) => node.resourceRef.resourceId));
    const matchingEdges = this.edges
      .filter((edge) => edge.accessMasking !== 'HIDDEN')
      .filter(
        (edge) => resourceIds.has(edge.from.resourceId) && resourceIds.has(edge.to.resourceId),
      )
      .filter((edge) => matchEdgeFilters(edge, request.filters));
    const omittedEdgeCount = Math.max(0, matchingEdges.length - request.limits.maxEdges);
    const edges = matchingEdges.slice(0, request.limits.maxEdges);
    const truncation: GraphTruncationStateV1 | undefined =
      omittedNodeCount > 0 || omittedEdgeCount > 0
        ? {
            schemaVersion: '1.0.0',
            truncated: true,
            reason: omittedNodeCount > 0 ? 'MAX_NODES' : 'MAX_EDGES',
            omittedNodeCount,
            omittedEdgeCount,
          }
        : undefined;
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
      .filter((edge) => edge.accessMasking !== 'HIDDEN')
      .filter(
        (edge) =>
          edge.from.resourceId === center.resourceRef.resourceId &&
          matchEdgeFilters(edge, context?.filters),
      )
      .slice(0, request.limits?.maxEdges ?? context?.limits.maxEdges ?? 100);
    const neighborNodes = neighbors
      .map((edge) => this.resourceMap.get(edge.to.resourceId))
      .filter((node): node is GraphNodeV1 => Boolean(node))
      .filter((node) => node.accessMasking !== 'HIDDEN')
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
      if (edge.accessMasking === 'HIDDEN') continue;
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
    const pathId = 'path-1';
    this.paths.set(`${request.snapshotId}:${pathId}`, {
      pathId,
      fromRef: request.fromRef,
      toRef: request.toRef,
      steps: found,
    });
    return {
      schemaVersion: '1.0.0',
      snapshotId: request.snapshotId,
      projectionRevision: request.projectionRevision,
      fromRef: request.fromRef,
      toRef: request.toRef,
      paths: [{ pathId, segments }],
      completeness: 'COMPLETE',
      appliedLimits: this.applied(request.limits ?? this.appliedLimitsDefault()),
    };
  }

  async pathDescription(
    scope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['pathDescription']>[1],
  ): Promise<GraphPathDescriptionV1> {
    void scope;
    const stored = this.paths.get(`${request.snapshotId}:${request.pathId}`);
    if (!stored) {
      throw new FrontendContractError('NOT_FOUND', `path ${request.pathId} is unknown`);
    }
    const fromNode = this.resourceMap.get(stored.fromRef.resourceId);
    const segments: GraphPathDescriptionV1['segments'] = stored.steps.map((step, index) => {
      if (index === 0) {
        return {
          schemaVersion: '1.0.0',
          kind: 'ORIGIN',
          step: 0,
          narration: `시작: ${fromNode ? this.accessibleLabel(fromNode) : stored.fromRef.resourceId}`,
          nodeRef: stored.fromRef,
        };
      }
      const edge = step.edgeId ? this.edgeMap.get(step.edgeId) : undefined;
      const toNode = this.resourceMap.get(step.nodeId);
      const startLabel = this.accessibleLabel(
        this.resourceMap.get(edge?.from.resourceId ?? '') ?? fromNode ?? this.nodes[0]!,
      );
      const endLabel = toNode ? this.accessibleLabel(toNode) : step.nodeId;
      return {
        schemaVersion: '1.0.0',
        kind: 'TRAVERSAL',
        step: index,
        narration: `${startLabel} → ${edge ? edgeSemanticKindLabel(edge.edgeSemanticKind) : 'Relationship'} → ${endLabel}`,
        nodeRef: { ...stored.toRef, resourceId: step.nodeId },
        edgeRef: {
          schemaVersion: '1.0.0',
          edgeId: step.edgeId ?? '',
          from: stored.fromRef,
          to: stored.toRef,
        },
      };
    });
    const toNode = this.resourceMap.get(stored.toRef.resourceId);
    return {
      schemaVersion: '1.0.0',
      snapshotId: request.snapshotId,
      projectionRevision: request.projectionRevision,
      pathId: request.pathId,
      segments,
      summary: `${fromNode ? this.accessibleLabel(fromNode) : stored.fromRef.resourceId}에서 ${
        toNode ? this.accessibleLabel(toNode) : stored.toRef.resourceId
      }까지의 경로 (${segments.length - 1}단계)`,
    };
  }

  async evidenceDetail(
    scope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['evidenceDetail']>[1],
  ): Promise<GraphEvidenceDetailResultV1> {
    void scope;
    const targetNode =
      request.target.kind === 'NODE'
        ? this.resourceMap.get(request.target.nodeRef.resourceId)
        : this.resourceMap.get(
            this.edgeMap.get(request.target.edgeRef.edgeId)?.to.resourceId ?? '',
          );
    const targetEdge =
      request.target.kind === 'EDGE' ? this.edgeMap.get(request.target.edgeRef.edgeId) : undefined;
    if (targetNode && targetNode.accessMasking === 'HIDDEN') {
      throw new FrontendContractError('NOT_FOUND', 'evidence target is not accessible');
    }
    // MASKED targets never leak evidence payloads or snippets (contract rule).
    const masked = targetNode?.accessMasking === 'MASKED';
    const summary = targetNode?.evidence;
    const requestedRef = request.evidenceRef;
    const resolved = masked
      ? []
      : this.evidenceEntries.filter((entry) => {
          if (requestedRef) {
            return (
              entry.sourceId === requestedRef.sourceId &&
              entry.evidenceSpanId === requestedRef.evidenceSpanId
            );
          }
          if (targetNode) {
            return (
              summary?.sourceIds.includes(entry.sourceId) &&
              summary?.evidenceSpanIds.includes(entry.evidenceSpanId)
            );
          }
          return targetEdge?.evidence?.sourceIds.includes(entry.sourceId) ?? false;
        });
    return {
      schemaVersion: '1.0.0',
      snapshotId: request.snapshotId,
      projectionRevision: request.projectionRevision,
      targetRef: request.target.kind === 'NODE' ? request.target.nodeRef : request.target.edgeRef,
      evidence: resolved,
      accessMasking: targetNode?.accessMasking ?? 'VISIBLE',
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
