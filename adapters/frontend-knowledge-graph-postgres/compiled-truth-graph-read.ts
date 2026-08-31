import type {
  CompiledTruthItem,
  CompiledTruthProjection,
  GraphEdgeV1,
  GraphEdgeSemanticKindV1,
  GraphNodeReferenceV1,
  GraphNodeV1,
  GraphSnapshotRequestV1,
  GraphSnapshotResultV1,
} from '../../packages/contracts/src/index.js';
import { hasSensitivityClearance } from '../../packages/authentication/src/index.js';
import {
  assessCompiledTruthProjectionReadiness,
  type CompiledTruthRepositoryPort,
} from '../../modules/compiled-truth/src/index.js';
import type { SemanticCorpusSourceSnapshotReaderPort } from '../../packages/contracts/src/index.js';
import type {
  GraphImpactPort,
  GraphReadPort,
  GraphReadScopeV1,
} from '../../modules/frontend-knowledge-graph/src/index.js';
import { Stage9GraphReadAdapter } from '../stage9-graph-read/src/index.js';

type GraphProjectionState = {
  readonly projectionRevision: string;
  readonly health: 'COMPLETE' | 'STALE' | 'UNAVAILABLE';
  readonly projection?: CompiledTruthProjection;
};

type CachedAdapter = {
  readonly cacheKey: string;
  readonly state: GraphProjectionState;
  readonly adapter: Stage9GraphReadAdapter;
};

const graphKindFor = (
  type: CompiledTruthItem['type'],
): GraphNodeReferenceV1['resourceKind'] | null => {
  switch (type) {
    case 'CLAIM':
      return 'CLAIM';
    case 'ENTITY':
      return 'ENTITY';
    case 'EVENT':
      return 'EVENT';
    case 'DECISION':
      return 'DECISION';
    case 'CONFLICT':
      return 'CONFLICT';
    case 'KNOWLEDGE_GAP':
      return 'KNOWLEDGE_GAP';
    case 'RELATION':
    case 'ACTION':
      return null;
  }
};

const graphRevisionFor = (projection: CompiledTruthProjection | undefined, projectId: string) =>
  projection === undefined
    ? `compiled-truth:unavailable:${projectId}`
    : `compiled-truth:${projection.projectorVersion}:${projection.canonicalVersion}`;

const visibleToScope = (item: CompiledTruthItem, scope: GraphReadScopeV1): boolean => {
  const accessScope = scope.accessScope ?? [];
  // A Graph scope without the server-derived Project context is not allowed
  // to inherit the highest clearance. Public is the fail-closed baseline for
  // embedded callers and prevents restricted projection items from leaking.
  const clearance = scope.discoveryContext?.activeProject.sensitivityClearance ?? 'public';
  return (
    item.accessScope.length > 0 &&
    item.accessScope.every((required) => accessScope.includes(required)) &&
    hasSensitivityClearance(clearance, item.sensitivity)
  );
};

const evidenceFor = (item: CompiledTruthItem) => ({
  schemaVersion: '1.0.0' as const,
  evidenceCount: item.evidenceIds.length,
  sourceIds: [],
  evidenceSpanIds: [],
  evidenceIds: [...item.evidenceIds],
});

const nodeFor = (
  item: CompiledTruthItem,
  scope: GraphReadScopeV1,
  projectionRevision: string,
): GraphNodeV1 | undefined => {
  const nodeKind = graphKindFor(item.type);
  if (nodeKind === null) return undefined;
  return {
    schemaVersion: '1.0.0',
    nodeId: `compiled-truth-node-${item.type}-${item.id}`,
    resourceRef: { schemaVersion: '1.0.0', resourceKind: nodeKind, resourceId: item.id },
    label: item.label,
    nodeKind,
    authority: 'CANONICAL',
    baseViewMembership: 'KNOWLEDGE_SEMANTIC',
    overlayMemberships: [],
    provenance: {
      schemaVersion: '1.0.0',
      sourceProjectId: scope.activeProjectId,
      canonicalRevision: projectionRevision,
      generatedBy: 'COMPILED_TRUTH',
    },
    evidence: evidenceFor(item),
    temporalValidity: {
      schemaVersion: '1.0.0',
      status: item.state === 'CURRENT' ? 'KNOWN' : 'UNKNOWN',
    },
    revisionBinding: {
      schemaVersion: '1.0.0',
      projectionRevision,
      policyContextRevision: scope.policyContextRevision,
      accessRevision: scope.accessRevision,
    },
    accessMasking: 'VISIBLE',
  };
};

const edgeFor = (
  edge: CompiledTruthProjection['graph']['edges'][number],
  nodesById: ReadonlyMap<string, GraphNodeV1>,
  scope: GraphReadScopeV1,
  projectionRevision: string,
): GraphEdgeV1 | undefined => {
  const from = nodesById.get(edge.from);
  const to = nodesById.get(edge.to);
  if (!from || !to) return undefined;
  const edgeSemanticKind: GraphEdgeSemanticKindV1 = 'CANONICAL_RELATION';
  return {
    schemaVersion: '1.0.0',
    edgeId: `compiled-truth-edge-${edge.id}`,
    from: from.resourceRef,
    to: to.resourceRef,
    relationRef: {
      schemaVersion: '1.0.0',
      relationId: edge.id,
    },
    edgeSemanticKind,
    authority: 'CANONICAL',
    baseViewMembership: 'KNOWLEDGE_SEMANTIC',
    overlayMemberships: [],
    provenance: {
      schemaVersion: '1.0.0',
      sourceProjectId: scope.activeProjectId,
      generatedBy: 'COMPILED_TRUTH',
    },
    evidence: {
      schemaVersion: '1.0.0',
      evidenceCount: 0,
      sourceIds: [],
      evidenceSpanIds: [],
      evidenceIds: [],
    },
    revisionBinding: {
      schemaVersion: '1.0.0',
      projectionRevision,
      policyContextRevision: scope.policyContextRevision,
      accessRevision: scope.accessRevision,
    },
    accessMasking: 'VISIBLE',
    payload: {
      schemaVersion: '1.0.0',
      relationType: edge.relationType,
      qualifier: edge.direction,
    },
  };
};

const graphFor = (
  projection: CompiledTruthProjection | undefined,
  scope: GraphReadScopeV1,
  projectionRevision: string,
): { readonly nodes: readonly GraphNodeV1[]; readonly edges: readonly GraphEdgeV1[] } => {
  if (!projection || projection.projectId !== scope.activeProjectId) {
    return { nodes: [], edges: [] };
  }
  const items = projection.items.filter((item) => visibleToScope(item, scope));
  const nodes = items.flatMap((item) => {
    const node = nodeFor(item, scope, projectionRevision);
    return node ? [node] : [];
  });
  const nodesById = new Map<string, GraphNodeV1>();
  for (const item of items) {
    const node = nodeFor(item, scope, projectionRevision);
    if (node) nodesById.set(item.id, node);
  }
  const edges = projection.graph.edges.flatMap((edge) => {
    const mapped = edgeFor(edge, nodesById, scope, projectionRevision);
    return mapped ? [mapped] : [];
  });
  return { nodes, edges };
};

/**
 * Production GraphReadPort binding. The persisted graph source remains the
 * existing Compiled Truth projection; this adapter owns only the FE-P3-S3
 * translation and bounded read-session cache. It never writes Canonical or
 * creates a second graph database/table.
 */
export class PostgresCompiledTruthGraphReadAdapter implements GraphReadPort, GraphImpactPort {
  private readonly adapters = new Map<string, CachedAdapter>();

  public constructor(
    private readonly compiledTruth: CompiledTruthRepositoryPort,
    private readonly sourceWatermark: Pick<SemanticCorpusSourceSnapshotReaderPort, 'readWatermark'>,
    private readonly maxCachedScopes = 32,
  ) {}

  private async projectionState(projectId: string): Promise<GraphProjectionState> {
    try {
      const source = await this.sourceWatermark.readWatermark(projectId);
      if (source.projectId !== projectId) {
        return {
          projectionRevision: graphRevisionFor(undefined, projectId),
          health: 'UNAVAILABLE',
        };
      }
      const readiness = await assessCompiledTruthProjectionReadiness(
        this.compiledTruth,
        projectId,
        source,
      );
      const projection = readiness.projection;
      if (projection !== undefined && projection.projectId !== projectId) {
        return {
          projectionRevision: graphRevisionFor(undefined, projectId),
          health: 'UNAVAILABLE',
        };
      }
      const projectionRevision = graphRevisionFor(projection, projectId);
      return {
        projectionRevision,
        health:
          readiness.status.status === 'READY'
            ? 'COMPLETE'
            : readiness.status.status === 'STALE'
              ? 'STALE'
              : 'UNAVAILABLE',
        ...(projection === undefined ? {} : { projection }),
      };
    } catch {
      // Readiness is a server authority. If the source watermark cannot be
      // read, the Graph must not fall back to a weaker Canonical-only check.
      return {
        projectionRevision: graphRevisionFor(undefined, projectId),
        health: 'UNAVAILABLE',
      };
    }
  }

  public async canReadGraph(projectId: string): Promise<boolean> {
    return (await this.projectionState(projectId)).health === 'COMPLETE';
  }

  private async forScope(scope: GraphReadScopeV1): Promise<Stage9GraphReadAdapter> {
    const state = await this.projectionState(scope.activeProjectId);
    const accessScope = [...(scope.accessScope ?? [])].sort().join(',');
    const cacheKey = [
      scope.principalId,
      scope.sessionId,
      scope.activeProjectId,
      scope.accessRevision,
      scope.policyContextRevision,
      accessScope,
      scope.discoveryContext?.activeProject.sensitivityClearance ?? 'public',
      state.projectionRevision,
      state.projection?.logicalDigest ?? state.projection?.sourceSnapshotDigest ?? 'none',
      state.health,
    ].join(':');
    const cached = this.adapters.get(cacheKey);
    if (cached) return cached.adapter;
    const graph = graphFor(state.projection, scope, state.projectionRevision);
    const adapter = new Stage9GraphReadAdapter(
      graph.nodes,
      graph.edges,
      () => state.projectionRevision,
      [],
      { health: state.health, maxSnapshots: 128 },
    );
    this.adapters.set(cacheKey, { cacheKey, state, adapter });
    while (this.adapters.size > this.maxCachedScopes) {
      const first = this.adapters.keys().next().value;
      if (first === undefined) break;
      this.adapters.delete(first);
    }
    return adapter;
  }

  public async snapshot(
    scope: GraphReadScopeV1,
    request: GraphSnapshotRequestV1,
  ): Promise<GraphSnapshotResultV1> {
    return (await this.forScope(scope)).snapshot(scope, request);
  }

  public async getSnapshot(
    scope: GraphReadScopeV1,
    snapshotId: string,
    projectionRevision: string,
  ): Promise<GraphSnapshotResultV1 | undefined> {
    return (await this.forScope(scope)).getSnapshot?.(scope, snapshotId, projectionRevision);
  }

  public async neighborhood(
    scope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['neighborhood']>[1],
  ) {
    return (await this.forScope(scope)).neighborhood(scope, request);
  }

  public async path(scope: GraphReadScopeV1, request: Parameters<GraphReadPort['path']>[1]) {
    return (await this.forScope(scope)).path(scope, request);
  }

  public async pathDescription(
    scope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['pathDescription']>[1],
  ) {
    return (await this.forScope(scope)).pathDescription(scope, request);
  }

  public async evidenceDetail(
    scope: GraphReadScopeV1,
    request: Parameters<GraphReadPort['evidenceDetail']>[1],
  ) {
    return (await this.forScope(scope)).evidenceDetail(scope, request);
  }

  public async refresh(scope: GraphReadScopeV1, request: Parameters<GraphReadPort['refresh']>[1]) {
    return (await this.forScope(scope)).refresh(scope, request);
  }

  public async restore(scope: GraphReadScopeV1, request: Parameters<GraphReadPort['restore']>[1]) {
    return (await this.forScope(scope)).restore(scope, request);
  }

  public async recursiveImpact(
    scope: GraphReadScopeV1,
    request: Parameters<GraphImpactPort['recursiveImpact']>[1],
    baseSnapshotId: string,
  ) {
    return (await this.forScope(scope)).recursiveImpact(scope, request, baseSnapshotId);
  }
}
