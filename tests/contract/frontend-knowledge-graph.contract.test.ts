import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  decodeGraphConflictOverlayRequestV1,
  decodeGraphDiscoveryOverlayRequestV1,
  decodeGraphEdgeReferenceV1,
  decodeGraphEvidenceDetailResultV1,
  decodeGraphKnowledgeGapOverlayRequestV1,
  decodeGraphNeighborhoodResultV1,
  decodeGraphNodeReferenceV1,
  decodeGraphNodeV1,
  decodeGraphOverlayResultV1,
  decodeGraphPathDescriptionV1,
  decodeGraphPathResultV1,
  decodeGraphRecursiveImpactOverlayRequestV1,
  decodeGraphRestoreRequestV1,
  decodeGraphRestoreResultV1,
  decodeGraphSnapshotRefreshRequestV1,
  decodeGraphSnapshotRequestV1,
  decodeGraphSnapshotResultV1,
  graphFailureApiCode,
} from '../../packages/contracts/src/index.js';

/**
 * AC-28: one contract suite per Product API read operation. The ten read
 * operations (snapshot, neighborhood, path, path-describe, conflict overlay,
 * gap overlay, impact overlay, evidence detail, snapshot refresh, deep-link
 * restore) are each covered by an explicit `describe` with strict decoding
 * and typed failure assertions. Shared primitives (refs, node/edge decoders)
 * are covered once in the shared suite.
 */

const nodeRef = {
  schemaVersion: '1.0.0' as const,
  resourceKind: 'ENTITY' as const,
  resourceId: 'entity-1',
};

const edgeRef = {
  schemaVersion: '1.0.0' as const,
  edgeId: 'edge-1',
  from: nodeRef,
  to: {
    schemaVersion: '1.0.0' as const,
    resourceKind: 'CLAIM' as const,
    resourceId: 'claim-1',
  },
};

const revisionBinding = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'proj-1',
  policyContextRevision: 'policy-1',
  accessRevision: 'access-1',
};

const node = {
  schemaVersion: '1.0.0' as const,
  nodeId: 'node-1',
  resourceRef: nodeRef,
  label: 'Entity One',
  nodeKind: 'ENTITY' as const,
  authority: 'CANONICAL' as const,
  baseViewMembership: 'KNOWLEDGE_SEMANTIC' as const,
  overlayMemberships: [] as const,
  revisionBinding,
  accessMasking: 'VISIBLE' as const,
  payload: {
    schemaVersion: '1.0.0' as const,
    nodeKind: 'ENTITY' as const,
    entity: {
      schemaVersion: 'entity.v1' as const,
      entityType: 'PERSON',
      displayName: 'Entity One',
    },
  },
};

const edge = {
  schemaVersion: '1.0.0' as const,
  edgeId: 'edge-1',
  from: nodeRef,
  to: { ...nodeRef, resourceKind: 'CLAIM' as const, resourceId: 'claim-1' },
  edgeSemanticKind: 'CANONICAL_RELATION' as const,
  authority: 'CANONICAL' as const,
  baseViewMembership: 'KNOWLEDGE_SEMANTIC' as const,
  overlayMemberships: [] as const,
  revisionBinding,
  accessMasking: 'VISIBLE' as const,
};

const snapshotIdentity = {
  schemaVersion: '1.0.0' as const,
  snapshotId: 'snapshot-1',
  projectId: 'project-1',
  viewKind: 'KNOWLEDGE_SEMANTIC' as const,
  projectionRevision: 'proj-1',
  generatedAt: '2026-08-04T08:00:00.000Z',
};

const appliedLimits = {
  schemaVersion: '1.0.0' as const,
  maxDepth: 3,
  maxNodes: 100,
  maxEdges: 200,
  traversalBudget: 1000,
  serverTimeoutBudgetMs: 5000,
  requestedMaxDepth: 3,
  requestedMaxNodes: 100,
  requestedMaxEdges: 200,
  clamped: false,
};

const snapshotBase = {
  schemaVersion: '1.0.0' as const,
  identity: snapshotIdentity,
  health: 'COMPLETE' as const,
  completeness: 'COMPLETE' as const,
  nodes: [] as const,
  edges: [] as const,
  appliedLimits,
  overlays: [] as const,
  capabilities: { schemaVersion: '1.0.0' as const, capabilities: ['SNAPSHOT'] as const },
};

describe('shared primitives: refs and node/edge strict decoding', () => {
  it('decodes a node reference and rejects unknown fields', () => {
    expect(decodeGraphNodeReferenceV1(nodeRef)).toEqual(nodeRef);
    expect(() => decodeGraphNodeReferenceV1({ ...nodeRef, extra: true })).toThrow(
      FrontendContractError,
    );
    expect(() => decodeGraphNodeReferenceV1({ ...nodeRef, resourceId: '  ' })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects an unknown resource kind discriminant and an empty edge id', () => {
    expect(() =>
      decodeGraphNodeReferenceV1({ ...nodeRef, resourceKind: 'ACTION_CANDIDATE' }),
    ).toThrow(FrontendContractError);
    expect(() => decodeGraphEdgeReferenceV1({ ...edgeRef, edgeId: '' })).toThrow(
      FrontendContractError,
    );
  });

  it('enforces node kind and resource ref kind consistency', () => {
    const mismatched = { ...node, nodeKind: 'CLAIM' as const };
    expect(() => decodeGraphNodeV1(mismatched)).toThrow(FrontendContractError);
  });

  it('enforces masking payload binding: MASKED forbids payload', () => {
    const masked = {
      ...node,
      nodeId: 'node-masked',
      label: '[Masked]',
      accessMasking: 'MASKED' as const,
      payload: undefined,
    };
    expect(decodeGraphNodeV1(masked).accessMasking).toBe('MASKED');
    expect(() => decodeGraphNodeV1({ ...masked, payload: node.payload })).toThrow(
      FrontendContractError,
    );
  });

  it('rejects a HIDDEN item in any response', () => {
    expect(() => decodeGraphNodeV1({ ...node, accessMasking: 'HIDDEN' as const })).toThrow(
      FrontendContractError,
    );
  });
});

describe('operation 1: snapshot (request + result)', () => {
  it('enforces traversal limits numeric ranges on the request', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      viewKind: 'KNOWLEDGE_SEMANTIC' as const,
      overlayKinds: [] as const,
      limits: {
        schemaVersion: '1.0.0' as const,
        maxDepth: 11,
        maxNodes: 100,
        maxEdges: 200,
        traversalBudget: 100,
        serverTimeoutBudgetMs: 5000,
      },
    };
    expect(() => decodeGraphSnapshotRequestV1(request)).toThrow(FrontendContractError);
  });

  it('decodes a full snapshot result round-trip', () => {
    const result = {
      ...snapshotBase,
      nodes: [node],
      edges: [edge],
      capabilities: {
        schemaVersion: '1.0.0' as const,
        capabilities: ['SNAPSHOT', 'NEIGHBORHOOD'] as const,
      },
    };
    expect(decodeGraphSnapshotResultV1(result).nodes[0]?.nodeId).toBe('node-1');
  });

  it('enforces truncation/completeness binding on a snapshot result', () => {
    expect(decodeGraphSnapshotResultV1(snapshotBase).completeness).toBe('COMPLETE');
    const truncated = {
      ...snapshotBase,
      completeness: 'TRUNCATED' as const,
      truncation: {
        schemaVersion: '1.0.0' as const,
        truncated: true,
        reason: 'MAX_NODES' as const,
        omittedNodeCount: 5,
        omittedEdgeCount: 3,
      },
    };
    expect(decodeGraphSnapshotResultV1(truncated).truncation?.reason).toBe('MAX_NODES');
    expect(() =>
      decodeGraphSnapshotResultV1({ ...snapshotBase, completeness: 'TRUNCATED' as const }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeGraphSnapshotResultV1({ ...snapshotBase, truncation: truncated.truncation }),
    ).toThrow(FrontendContractError);
  });
});

describe('operation 2: neighborhood (result)', () => {
  it('decodes a neighborhood result with center ref and applied limits', () => {
    const neighborhood = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      centerRef: nodeRef,
      addedNodes: [node],
      addedEdges: [edge],
      completeness: 'COMPLETE' as const,
      appliedLimits,
    };
    expect(decodeGraphNeighborhoodResultV1(neighborhood).centerRef.resourceId).toBe('entity-1');
    expect(decodeGraphNeighborhoodResultV1(neighborhood).appliedLimits.maxNodes).toBe(100);
  });
});

describe('operation 3: path (request + result)', () => {
  it('decodes path results with ORIGIN/TRAVERSAL union and rejects violations', () => {
    const origin = {
      schemaVersion: '1.0.0' as const,
      kind: 'ORIGIN' as const,
      step: 0,
      nodeRef,
      direction: 'OUTGOING_FROM_ROOT' as const,
    };
    const traversal = {
      schemaVersion: '1.0.0' as const,
      kind: 'TRAVERSAL' as const,
      step: 1,
      nodeRef,
      edgeRef,
      direction: 'OUTGOING_FROM_ROOT' as const,
    };
    const pathResult = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      fromRef: nodeRef,
      toRef: nodeRef,
      paths: [{ pathId: 'path-1', segments: [origin, traversal] }],
      completeness: 'COMPLETE' as const,
      appliedLimits,
    };
    expect(decodeGraphPathResultV1(pathResult).paths[0]?.segments[0]?.kind).toBe('ORIGIN');

    const originWithEdge = {
      schemaVersion: '1.0.0' as const,
      kind: 'ORIGIN' as const,
      step: 0,
      nodeRef,
      edgeRef,
      direction: 'OUTGOING_FROM_ROOT' as const,
    };
    expect(() =>
      decodeGraphPathResultV1({
        ...pathResult,
        paths: [{ pathId: 'path-1', segments: [originWithEdge] }],
      }),
    ).toThrow(FrontendContractError);

    const traversalZero = {
      schemaVersion: '1.0.0' as const,
      kind: 'TRAVERSAL' as const,
      step: 0,
      nodeRef,
      edgeRef,
      direction: 'OUTGOING_FROM_ROOT' as const,
    };
    expect(() =>
      decodeGraphPathResultV1({
        ...pathResult,
        paths: [{ pathId: 'path-1', segments: [traversalZero] }],
      }),
    ).toThrow(FrontendContractError);
  });
});

describe('operation 4: path describe (result)', () => {
  it('decodes a path description with the ORIGIN/TRAVERSAL union and revision binding', () => {
    const description = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      pathId: 'path-1',
      segments: [
        {
          schemaVersion: '1.0.0' as const,
          kind: 'ORIGIN' as const,
          step: 0,
          narration: 'Start at Entity One',
          nodeRef,
        },
        {
          schemaVersion: '1.0.0' as const,
          kind: 'TRAVERSAL' as const,
          step: 1,
          narration: 'Related to claim-1',
          nodeRef: { ...nodeRef, resourceKind: 'CLAIM' as const, resourceId: 'claim-1' },
          edgeRef,
        },
      ],
      summary: 'Path from entity-1 to claim-1',
    };
    expect(decodeGraphPathDescriptionV1(description).projectionRevision).toBe('proj-1');
  });
});

describe('operation 5: conflict overlay (request + result)', () => {
  it('enforces the CONFLICT literal and rejects continuation and unknown fields', () => {
    const base = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      filters: undefined,
      limits: undefined,
      expectedOverlayRevision: undefined,
    };
    expect(
      decodeGraphConflictOverlayRequestV1({ ...base, overlayKind: 'CONFLICT' as const })
        .overlayKind,
    ).toBe('CONFLICT');
    expect(() =>
      decodeGraphConflictOverlayRequestV1({ ...base, overlayKind: 'RECURSIVE_IMPACT' as const }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeGraphConflictOverlayRequestV1({
        ...base,
        overlayKind: 'CONFLICT' as const,
        continuationToken: 'tok',
      }),
    ).toThrow(FrontendContractError);
  });

  it('decodes a conflict overlay result with its own identity', () => {
    const overlayResult = {
      schemaVersion: '1.0.0' as const,
      baseSnapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      identity: {
        schemaVersion: '1.0.0' as const,
        overlayKind: 'CONFLICT' as const,
        overlaySnapshotId: 'overlay-1',
        overlayRevision: 'overlay-rev-1',
        analyzerRevision: 'analyzer-1',
        policyContextRevision: 'policy-1',
        generatedAt: '2026-08-04T08:00:00.000Z',
        completeness: 'COMPLETE' as const,
      },
      health: 'COMPLETE' as const,
      completeness: 'COMPLETE' as const,
      nodes: [] as const,
      edges: [] as const,
      appliedLimits,
    };
    expect(decodeGraphOverlayResultV1(overlayResult).identity.overlayKind).toBe('CONFLICT');
  });
});

describe('operation 6: gap overlay (request)', () => {
  it('enforces the KNOWLEDGE_GAP literal', () => {
    const base = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      filters: undefined,
      limits: undefined,
      expectedOverlayRevision: undefined,
    };
    expect(
      decodeGraphKnowledgeGapOverlayRequestV1({ ...base, overlayKind: 'KNOWLEDGE_GAP' as const })
        .overlayKind,
    ).toBe('KNOWLEDGE_GAP');
    expect(() =>
      decodeGraphKnowledgeGapOverlayRequestV1({ ...base, overlayKind: 'CONFLICT' as const }),
    ).toThrow(FrontendContractError);
  });
});

describe('operation 7: recursive-impact overlay (request)', () => {
  it('enforces the RECURSIVE_IMPACT literal and accepts a continuation token', () => {
    const base = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      filters: undefined,
      limits: undefined,
      expectedOverlayRevision: undefined,
    };
    const impact = decodeGraphRecursiveImpactOverlayRequestV1({
      ...base,
      overlayKind: 'RECURSIVE_IMPACT' as const,
      continuationToken: 'tok',
    });
    expect(impact.overlayKind).toBe('RECURSIVE_IMPACT');
    expect(impact.continuationToken).toBe('tok');
  });
});

describe('operation 8: Discovery overlay (exact Finding identity)', () => {
  it('requires the exact base snapshot, Finding revision and DISCOVERY overlay axis', () => {
    const request = decodeGraphDiscoveryOverlayRequestV1({
      schemaVersion: '1.0.0',
      baseSnapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      overlayKind: 'DISCOVERY',
      findingId: 'finding-1',
      findingRevision: 4,
    });
    expect(request).toMatchObject({
      baseSnapshotId: 'snapshot-1',
      findingId: 'finding-1',
      findingRevision: 4,
    });
    expect(() => decodeGraphDiscoveryOverlayRequestV1({ ...request, findingRevision: 0 })).toThrow(
      FrontendContractError,
    );
    expect(() => decodeGraphDiscoveryOverlayRequestV1({ ...request, latest: true })).toThrow(
      FrontendContractError,
    );
  });

  it('round-trips a typed Discovery Finding node without exposing model fields', () => {
    const discoveryNode = {
      schemaVersion: '1.0.0' as const,
      nodeId: 'discovery-finding-finding-1-4',
      resourceRef: {
        schemaVersion: '1.0.0' as const,
        resourceKind: 'DISCOVERY_FINDING' as const,
        resourceId: 'finding-1',
      },
      label: 'Relation hypothesis',
      nodeKind: 'DISCOVERY_FINDING' as const,
      authority: 'DERIVED_INFERENCE' as const,
      baseViewMembership: 'KNOWLEDGE_SEMANTIC' as const,
      overlayMemberships: ['DISCOVERY'] as const,
      provenance: {
        schemaVersion: '1.0.0' as const,
        sourceProjectId: 'project-1',
        generatedBy: 'DISCOVERY' as const,
        discoveryFindingRef: {
          kind: 'DISCOVERY_FINDING' as const,
          findingId: 'finding-1',
          findingRevision: 4,
        },
      },
      evidence: {
        schemaVersion: '1.0.0' as const,
        evidenceCount: 1,
        sourceIds: ['source-1'],
        evidenceSpanIds: [],
        evidenceIds: ['evidence-1'],
        sourceVersionIds: ['source-version-1'],
      },
      revisionBinding,
      accessMasking: 'VISIBLE' as const,
      payload: {
        schemaVersion: '1.0.0' as const,
        nodeKind: 'DISCOVERY_FINDING' as const,
        findingId: 'finding-1',
        findingRevision: 4,
        findingType: 'RELATION_HYPOTHESIS' as const,
        title: 'Relation hypothesis',
        summary: 'A candidate relation',
        currentLifecycle: 'REVIEW_READY' as const,
        authority: 'DERIVED_INFERENCE' as const,
        detailPath: '/knowledge/discoveries/finding-1',
      },
    };
    const decoded = decodeGraphNodeV1(discoveryNode);
    expect(decoded.resourceRef.resourceKind).toBe('DISCOVERY_FINDING');
    expect(decoded.payload?.nodeKind).toBe('DISCOVERY_FINDING');
    expect(decoded.provenance?.discoveryFindingRef?.findingRevision).toBe(4);
  });
});

describe('operation 8: evidence detail (result)', () => {
  it('decodes evidence detail and enforces masked empty-evidence rule', () => {
    const detail = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      targetRef: nodeRef,
      evidence: [
        {
          schemaVersion: '1.0.0' as const,
          sourceId: 'source-1',
          sourceVersionId: 'source-version-1',
          evidenceSpanId: 'span-1',
          snippet: '...',
        },
      ],
      accessMasking: 'VISIBLE' as const,
    };
    expect(decodeGraphEvidenceDetailResultV1(detail).evidence.length).toBe(1);
    expect(() =>
      decodeGraphEvidenceDetailResultV1({ ...detail, accessMasking: 'MASKED' as const }),
    ).toThrow(FrontendContractError);
  });
});

describe('operation 9: snapshot refresh (request)', () => {
  it('enforces descriptor-based shape (no full request resend)', () => {
    const refresh = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      expectedSnapshotRevision: 'proj-2',
    };
    expect(decodeGraphSnapshotRefreshRequestV1(refresh).snapshotId).toBe('snapshot-1');
    expect(() =>
      decodeGraphSnapshotRefreshRequestV1({ ...refresh, viewKind: 'KNOWLEDGE_SEMANTIC' as const }),
    ).toThrow(FrontendContractError);
  });
});

describe('operation 10: deep-link restore (request + result)', () => {
  it('decodes a restore request with selected node refs and strict unknown rejection', () => {
    const request = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      viewKind: 'KNOWLEDGE_SEMANTIC' as const,
      overlayKinds: [] as const,
      selectedNodeRefs: [nodeRef],
      expectedSnapshotRevision: 'proj-2',
    };
    expect(decodeGraphRestoreRequestV1(request).selectedNodeRefs[0]?.resourceId).toBe('entity-1');
    expect(() => decodeGraphRestoreRequestV1({ ...request, extraField: true })).toThrow(
      FrontendContractError,
    );
  });

  it('decodes a restore result carrying the snapshot and focus refs', () => {
    const result = {
      schemaVersion: '1.0.0' as const,
      snapshot: { ...snapshotBase, nodes: [node] },
      focusRefs: [nodeRef],
    };
    const decoded = decodeGraphRestoreResultV1(result);
    expect(decoded.focusRefs[0]?.resourceId).toBe('entity-1');
    expect(decoded.snapshot.nodes[0]?.nodeId).toBe('node-1');
  });
});

describe('typed failure mapping across all operations', () => {
  it('maps graph failures to typed normalized codes', () => {
    expect(graphFailureApiCode('CONTINUATION_EXPIRED')).toBe('GRAPH_CONTINUATION_EXPIRED');
    expect(graphFailureApiCode('SNAPSHOT_STALE')).toBe('GRAPH_SNAPSHOT_STALE');
  });
});
