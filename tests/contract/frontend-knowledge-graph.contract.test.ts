import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  decodeGraphConflictOverlayRequestV1,
  decodeGraphEdgeReferenceV1,
  decodeGraphEvidenceDetailRequestV1,
  decodeGraphEvidenceDetailResultV1,
  decodeGraphKnowledgeGapOverlayRequestV1,
  decodeGraphNeighborhoodRequestV1,
  decodeGraphNeighborhoodResultV1,
  decodeGraphNodeReferenceV1,
  decodeGraphNodeV1,
  decodeGraphOverlayResultV1,
  decodeGraphPathDescriptionV1,
  decodeGraphPathRequestV1,
  decodeGraphPathResultV1,
  decodeGraphRecursiveImpactOverlayRequestV1,
  decodeGraphRestoreRequestV1,
  decodeGraphSnapshotRefreshRequestV1,
  decodeGraphSnapshotRequestV1,
  decodeGraphSnapshotResultV1,
  graphFailureApiCode,
} from '../../packages/contracts/src/index.js';

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

describe('FE-P3-S3 frontend-knowledge-graph contracts', () => {
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
    expect(() => decodeGraphNodeReferenceV1({ ...nodeRef, resourceKind: 'ACTION_CANDIDATE' })).toThrow(
      FrontendContractError,
    );
    expect(() => decodeGraphEdgeReferenceV1({ ...edgeRef, edgeId: '' })).toThrow(FrontendContractError);
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

  it('enforces truncation/completeness binding on a snapshot result', () => {
    const base = {
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
    expect(decodeGraphSnapshotResultV1(base).completeness).toBe('COMPLETE');
    const truncated = {
      ...base,
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
    expect(() => decodeGraphSnapshotResultV1({ ...base, completeness: 'TRUNCATED' as const })).toThrow(
      FrontendContractError,
    );
    expect(() =>
      decodeGraphSnapshotResultV1({
        ...base,
        truncation: truncated.truncation,
      }),
    ).toThrow(FrontendContractError);
  });

  it('enforces traversal limits numeric ranges', () => {
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
      schemaVersion: '1.0.0' as const,
      identity: snapshotIdentity,
      health: 'COMPLETE' as const,
      completeness: 'COMPLETE' as const,
      nodes: [node],
      edges: [edge],
      appliedLimits,
      overlays: [] as const,
      capabilities: {
        schemaVersion: '1.0.0' as const,
        capabilities: ['SNAPSHOT', 'NEIGHBORHOOD'] as const,
      },
    };
    expect(decodeGraphSnapshotResultV1(result).nodes[0]?.nodeId).toBe('node-1');
  });

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

  it('decodes a path description with the ORIGIN/TRAVERSAL union and revision binding', () => {
    const description = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      pathId: 'path-1',
      segments: [
        { schemaVersion: '1.0.0' as const, kind: 'ORIGIN' as const, step: 0, narration: 'Start at Entity One', nodeRef },
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

  it('enforces route-specific overlay literals and continuation rules', () => {
    const base = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      filters: undefined,
      limits: undefined,
      expectedOverlayRevision: undefined,
    };
    expect(decodeGraphConflictOverlayRequestV1({ ...base, overlayKind: 'CONFLICT' as const }).overlayKind).toBe('CONFLICT');
    expect(() => decodeGraphConflictOverlayRequestV1({ ...base, overlayKind: 'RECURSIVE_IMPACT' as const })).toThrow(
      FrontendContractError,
    );
    expect(
      decodeGraphKnowledgeGapOverlayRequestV1({ ...base, overlayKind: 'KNOWLEDGE_GAP' as const }).overlayKind,
    ).toBe('KNOWLEDGE_GAP');
    const impact = decodeGraphRecursiveImpactOverlayRequestV1({
      ...base,
      overlayKind: 'RECURSIVE_IMPACT' as const,
      continuationToken: 'tok',
    });
    expect(impact.continuationToken).toBe('tok');
    // conflict request rejects unknown continuationToken field
    expect(() =>
      decodeGraphConflictOverlayRequestV1({ ...base, overlayKind: 'CONFLICT' as const, continuationToken: 'tok' }),
    ).toThrow(FrontendContractError);
  });

  it('enforces snapshot refresh descriptor-based shape (no full request resend)', () => {
    const refresh = {
      schemaVersion: '1.0.0' as const,
      snapshotId: 'snapshot-1',
      projectionRevision: 'proj-1',
      expectedSnapshotRevision: 'proj-2',
    };
    expect(decodeGraphSnapshotRefreshRequestV1(refresh).snapshotId).toBe('snapshot-1');
    // full resend fields are rejected as unknown
    expect(() => decodeGraphSnapshotRefreshRequestV1({ ...refresh, viewKind: 'KNOWLEDGE_SEMANTIC' as const })).toThrow(
      FrontendContractError,
    );
  });

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

  it('decodes neighborhood, restore and overlay results with applied limits', () => {
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

  it('maps graph failures to typed normalized codes', () => {
    expect(graphFailureApiCode('CONTINUATION_EXPIRED')).toBe('GRAPH_CONTINUATION_EXPIRED');
    expect(graphFailureApiCode('SNAPSHOT_STALE')).toBe('GRAPH_SNAPSHOT_STALE');
  });
});
