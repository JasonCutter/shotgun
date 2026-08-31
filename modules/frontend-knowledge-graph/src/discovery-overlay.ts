import type {
  DiscoveryProductFindingDetailV1,
  DiscoveryResourceRefV1,
  GraphAppliedLimitsV1,
  GraphDiscoveryOverlayRequestV1,
  GraphDiscoveryFindingPayloadV1,
  GraphEdgeV1,
  GraphNodeReferenceV1,
  GraphNodeV1,
  GraphOverlayResultV1,
  GraphSnapshotResultV1,
} from '../../../packages/contracts/src/index.js';
import type { GraphDiscoveryOverlayPort, GraphReadScopeV1 } from './graph-read-port.js';

const ACTIVE_LIFECYCLES = new Set(['NEW', 'VALIDATING', 'REVIEW_READY', 'REENTERED']);

const graphKindFor = (
  resource: DiscoveryResourceRefV1,
): GraphNodeReferenceV1['resourceKind'] | null => {
  switch (resource.resourceKind) {
    case 'CANONICAL_CLAIM':
      return 'CLAIM';
    case 'CANONICAL_ENTITY':
      return 'ENTITY';
    case 'CANONICAL_EVENT':
      return 'EVENT';
    case 'CANONICAL_RELATION':
      return 'RELATION';
    case 'CANONICAL_CONFLICT':
      return 'CONFLICT';
    case 'CANONICAL_DECISION':
      return 'DECISION';
    case 'SOURCE':
      return 'SOURCE';
    case 'SOURCE_VERSION':
    case 'COMPILED_TRUTH_ITEM':
      return null;
  }
};

const toGraphRef = (resource: DiscoveryResourceRefV1): GraphNodeReferenceV1 | null => {
  const resourceKind = graphKindFor(resource);
  return resourceKind === null
    ? null
    : { schemaVersion: '1.0.0', resourceKind, resourceId: resource.resourceId };
};

const refsFor = (finding: DiscoveryProductFindingDetailV1): readonly DiscoveryResourceRefV1[] => {
  switch (finding.payload.payloadType) {
    case 'RELATION_HYPOTHESIS':
      return [finding.payload.sourceEndpoint, finding.payload.targetEndpoint];
    case 'PATTERN_HYPOTHESIS':
      return finding.payload.memberResourceRefs;
    case 'CONFLICT_HYPOTHESIS':
      return finding.payload.participatingResourceRefs;
    default:
      return [];
  }
};

const graphRootsFor = (
  finding: DiscoveryProductFindingDetailV1,
  activeProjectId: string,
  expectedProjectionRevision?: string,
): readonly GraphNodeReferenceV1[] | undefined => {
  if (
    finding.projectId !== activeProjectId ||
    !ACTIVE_LIFECYCLES.has(finding.lifecycleState) ||
    !finding.capabilities.canOpenGraph
  ) {
    return undefined;
  }
  if (
    expectedProjectionRevision !== undefined &&
    finding.freshness.discoveryBase.projectionRevision !== expectedProjectionRevision
  ) {
    return undefined;
  }
  const refs = refsFor(finding);
  if (
    (finding.findingType === 'RELATION_HYPOTHESIS' && refs.length !== 2) ||
    ((finding.findingType === 'PATTERN_HYPOTHESIS' ||
      finding.findingType === 'CONFLICT_HYPOTHESIS') &&
      refs.length < 2) ||
    !refs.every((ref) => ref.projectId === activeProjectId)
  ) {
    return undefined;
  }
  const roots = refs.map(toGraphRef);
  if (roots.some((ref) => ref === null)) return undefined;
  return roots as readonly GraphNodeReferenceV1[];
};

const evidenceFor = (finding: DiscoveryProductFindingDetailV1) => {
  const evidenceIds = finding.lineage.evidence.map((evidence) => evidence.evidenceId);
  const sourceIds = finding.lineage.evidence.map((evidence) => evidence.sourceId);
  const sourceVersionIds = finding.lineage.evidence.map((evidence) => evidence.sourceVersionId);
  return {
    schemaVersion: '1.0.0' as const,
    evidenceCount: evidenceIds.length,
    sourceIds: [...new Set(sourceIds)],
    // Evidence revision IDs are deliberately not presented as fabricated
    // EvidenceSpan IDs. The summary keeps the legacy field empty and carries
    // the authorized Evidence/Source/SourceVersion identities explicitly.
    evidenceSpanIds: [],
    evidenceIds: [...new Set(evidenceIds)],
    sourceVersionIds: [...new Set(sourceVersionIds)],
  };
};

type DiscoveryFindingIdentity = Pick<
  DiscoveryProductFindingDetailV1,
  'projectId' | 'findingId' | 'findingRevision'
>;

const provenanceFor = (finding: DiscoveryFindingIdentity) => ({
  schemaVersion: '1.0.0' as const,
  sourceProjectId: finding.projectId,
  generatedBy: 'DISCOVERY' as const,
  discoveryFindingRef: {
    kind: 'DISCOVERY_FINDING' as const,
    findingId: finding.findingId,
    findingRevision: finding.findingRevision,
  },
});

const revisionBindingFor = (scope: GraphReadScopeV1, projectionRevision: string) => ({
  schemaVersion: '1.0.0' as const,
  projectionRevision,
  policyContextRevision: scope.policyContextRevision,
  accessRevision: scope.accessRevision,
});

const discoveryPayloadFor = (
  finding: DiscoveryProductFindingDetailV1,
): GraphDiscoveryFindingPayloadV1 => ({
  schemaVersion: '1.0.0',
  nodeKind: 'DISCOVERY_FINDING',
  findingId: finding.findingId,
  findingRevision: finding.findingRevision,
  findingType: finding.findingType as GraphDiscoveryFindingPayloadV1['findingType'],
  title: finding.title,
  summary: finding.summary,
  currentLifecycle: finding.lifecycleState,
  authority: 'DERIVED_INFERENCE',
  detailPath: `/knowledge/discoveries/${encodeURIComponent(finding.findingId)}`,
});

const overlayIdentityFor = (
  request: GraphDiscoveryOverlayRequestV1,
  scope: GraphReadScopeV1,
  generatedAt: string,
  unavailableReason?: GraphOverlayResultV1['identity']['unavailableReason'],
  includeSourceRef = true,
) => ({
  schemaVersion: '1.0.0' as const,
  overlayKind: 'DISCOVERY' as const,
  overlaySnapshotId: `overlay-discovery-${request.findingId}-${request.findingRevision}`,
  overlayRevision: `discovery-${request.findingId}-${request.findingRevision}`,
  ...(includeSourceRef
    ? {
        sourceRef: {
          kind: 'DISCOVERY_FINDING' as const,
          findingId: request.findingId,
          findingRevision: request.findingRevision,
        },
      }
    : {}),
  analyzerRevision: 'discovery-finding-read:v1',
  policyContextRevision: scope.policyContextRevision,
  generatedAt,
  completeness: 'COMPLETE' as const,
  ...(unavailableReason === undefined ? {} : { unavailableReason }),
});

const unavailable = (
  request: GraphDiscoveryOverlayRequestV1,
  scope: GraphReadScopeV1,
  appliedLimits: GraphAppliedLimitsV1,
  now: () => string,
): GraphOverlayResultV1 => ({
  schemaVersion: '1.0.0',
  baseSnapshotId: request.baseSnapshotId,
  projectionRevision: request.projectionRevision,
  identity: overlayIdentityFor(request, scope, now(), 'DEEP_LINK_TARGET_UNAVAILABLE', false),
  health: 'UNAVAILABLE',
  completeness: 'COMPLETE',
  nodes: [],
  edges: [],
  appliedLimits,
});

const resourceNode = (
  base: GraphSnapshotResultV1,
  resource: DiscoveryResourceRefV1,
): GraphNodeV1 | undefined => {
  const ref = toGraphRef(resource);
  if (!ref) return undefined;
  return base.nodes.find(
    (node) =>
      node.accessMasking === 'VISIBLE' &&
      node.resourceRef.resourceKind === ref.resourceKind &&
      node.resourceRef.resourceId === ref.resourceId,
  );
};

const discoveryEdge = (
  edgeId: string,
  from: GraphNodeReferenceV1,
  to: GraphNodeReferenceV1,
  scope: GraphReadScopeV1,
  request: GraphDiscoveryOverlayRequestV1,
  evidence: ReturnType<typeof evidenceFor>,
  relationType: string,
  qualifier: string,
): GraphEdgeV1 => ({
  schemaVersion: '1.0.0',
  edgeId,
  from,
  to,
  edgeSemanticKind: 'DISCOVERY_CANDIDATE',
  authority: 'DISCOVERY_CANDIDATE',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships: ['DISCOVERY'],
  provenance: provenanceFor({
    projectId: scope.activeProjectId,
    findingId: request.findingId,
    findingRevision: request.findingRevision,
  }),
  evidence,
  revisionBinding: revisionBindingFor(scope, request.projectionRevision),
  accessMasking: 'VISIBLE',
  payload: {
    schemaVersion: '1.0.0',
    relationType,
    qualifier,
  },
});

export type GraphDiscoveryFindingReader = {
  readFinding(
    scope: GraphReadScopeV1,
    request: GraphDiscoveryOverlayRequestV1,
  ): Promise<DiscoveryProductFindingDetailV1 | undefined>;
};

export const createGraphDiscoveryOverlayPort = (
  reader: GraphDiscoveryFindingReader,
  options: { readonly now?: () => string } = {},
): GraphDiscoveryOverlayPort => {
  const now = options.now ?? (() => new Date().toISOString());
  return {
    async discoveryOverlay(scope, request, baseSnapshot) {
      const unavailableResult = () => unavailable(request, scope, baseSnapshot.appliedLimits, now);
      if (baseSnapshot.identity.snapshotId !== request.baseSnapshotId) return unavailableResult();
      if (baseSnapshot.identity.projectionRevision !== request.projectionRevision) {
        return unavailableResult();
      }
      if (baseSnapshot.health !== 'COMPLETE') return unavailableResult();
      const finding = await reader.readFinding(scope, request);
      if (
        !finding ||
        finding.projectId !== scope.activeProjectId ||
        finding.findingId !== request.findingId ||
        finding.findingRevision !== request.findingRevision ||
        !ACTIVE_LIFECYCLES.has(finding.lifecycleState) ||
        !finding.capabilities.canOpenGraph
      ) {
        return unavailableResult();
      }
      const refs = refsFor(finding);
      if (!graphRootsFor(finding, scope.activeProjectId, request.projectionRevision)) {
        return unavailableResult();
      }
      const resources = refs.map((ref) => resourceNode(baseSnapshot, ref));
      if (resources.some((resource) => resource === undefined)) return unavailableResult();
      const evidence = evidenceFor(finding);
      const provenance = provenanceFor(finding);
      const revisionBinding = revisionBindingFor(scope, request.projectionRevision);
      const generatedAt = now();
      const nodes: GraphNodeV1[] = [];
      const edges: GraphEdgeV1[] = [];
      if (finding.findingType === 'RELATION_HYPOTHESIS') {
        const payload = finding.payload;
        if (payload.payloadType !== 'RELATION_HYPOTHESIS') return unavailableResult();
        const from = resources[0]!.resourceRef;
        const to = resources[1]!.resourceRef;
        edges.push({
          schemaVersion: '1.0.0',
          edgeId: `discovery-edge-${finding.findingId}-${finding.findingRevision}`,
          from,
          to,
          edgeSemanticKind: 'DISCOVERY_CANDIDATE',
          authority: 'DISCOVERY_CANDIDATE',
          baseViewMembership: 'KNOWLEDGE_SEMANTIC',
          overlayMemberships: ['DISCOVERY'],
          provenance,
          evidence,
          revisionBinding,
          accessMasking: 'VISIBLE',
          payload: {
            schemaVersion: '1.0.0',
            relationType: payload.proposedRelationType,
            qualifier: payload.direction,
          },
        });
      } else {
        const findingRef: GraphNodeReferenceV1 = {
          schemaVersion: '1.0.0',
          resourceKind: 'DISCOVERY_FINDING',
          resourceId: finding.findingId,
        };
        nodes.push({
          schemaVersion: '1.0.0',
          nodeId: `discovery-finding-${finding.findingId}-${finding.findingRevision}`,
          resourceRef: findingRef,
          label: finding.title,
          nodeKind: 'DISCOVERY_FINDING',
          authority: 'DERIVED_INFERENCE',
          baseViewMembership: 'KNOWLEDGE_SEMANTIC',
          overlayMemberships: ['DISCOVERY'],
          provenance,
          evidence,
          revisionBinding,
          accessMasking: 'VISIBLE',
          payload: discoveryPayloadFor(finding),
        });
        const relationType =
          finding.findingType === 'PATTERN_HYPOTHESIS' ? 'PATTERN_MEMBER' : 'CONFLICT_PARTICIPANT';
        const qualifier =
          finding.payload.payloadType === 'PATTERN_HYPOTHESIS'
            ? finding.payload.patternKind
            : finding.payload.payloadType === 'CONFLICT_HYPOTHESIS'
              ? finding.payload.contradictionKind
              : finding.findingType;
        for (const resource of resources) {
          edges.push(
            discoveryEdge(
              `discovery-edge-${finding.findingId}-${finding.findingRevision}-${resource!.nodeId}`,
              findingRef,
              resource!.resourceRef,
              scope,
              request,
              evidence,
              relationType,
              qualifier,
            ),
          );
        }
      }
      const maxNodes = request.limits?.maxNodes ?? baseSnapshot.appliedLimits.maxNodes;
      const maxEdges = request.limits?.maxEdges ?? baseSnapshot.appliedLimits.maxEdges;
      const truncatedNodes = nodes.slice(0, maxNodes);
      const truncatedEdges = edges.slice(0, maxEdges);
      const truncated =
        truncatedNodes.length !== nodes.length || truncatedEdges.length !== edges.length;
      return {
        schemaVersion: '1.0.0',
        baseSnapshotId: request.baseSnapshotId,
        projectionRevision: request.projectionRevision,
        identity: {
          ...overlayIdentityFor(request, scope, generatedAt),
          ...(truncated
            ? {
                completeness: 'TRUNCATED' as const,
                truncation: {
                  schemaVersion: '1.0.0' as const,
                  truncated: true as const,
                  reason:
                    truncatedNodes.length !== nodes.length
                      ? ('MAX_NODES' as const)
                      : ('MAX_EDGES' as const),
                  omittedNodeCount: nodes.length - truncatedNodes.length,
                  omittedEdgeCount: edges.length - truncatedEdges.length,
                },
              }
            : {}),
        },
        health: truncated ? 'TRUNCATED' : 'COMPLETE',
        completeness: truncated ? 'TRUNCATED' : 'COMPLETE',
        nodes: truncatedNodes,
        edges: truncatedEdges,
        appliedLimits: baseSnapshot.appliedLimits,
      };
    },
    async resolveDiscoveryRoots(scope, request) {
      const context = await reader.readFinding(scope, {
        schemaVersion: '1.0.0',
        baseSnapshotId: 'discovery-root-resolution',
        projectionRevision: 'discovery-root-resolution',
        overlayKind: 'DISCOVERY',
        findingId: request.findingId,
        findingRevision: request.findingRevision,
      });
      return context ? graphRootsFor(context, scope.activeProjectId) : undefined;
    },
  };
};
