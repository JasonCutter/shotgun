import { describe, expect, it } from 'vitest';

import type {
  GraphEdgeV1,
  GraphNodeV1,
  GraphSnapshotResultV1,
} from '../../packages/contracts/src/index.js';
import {
  buildGraphEdgeCorrectionSeed,
  buildGraphNodeCorrectionSeed,
  decodeGraphCorrectionSeed,
  encodeGraphCorrectionSeed,
  graphCorrectionEditorHref,
} from '../../apps/shotgun-web/src/knowledge/graph-correction.js';

/**
 * AC-25: a correction action on a graph node/edge extracts the stable
 * resource ref, builds a typed DraftChangeSet-style seed carrying
 * `sourceWorkspace: KNOWLEDGE_GRAPH`, `targetKind`, `stableResourceRef`,
 * `snapshotId`, `projectionRevision` and `suggestedChangeIntent:
 * CORRECT_KNOWLEDGE`, then navigates to the Knowledge Editor. Masked items
 * yield a minimal ref-only seed; hidden items yield no seed and no action.
 * The seed never writes Canonical data.
 */

const binding = {
  schemaVersion: '1.0.0' as const,
  projectionRevision: 'proj-1',
  policyContextRevision: 'policy-1',
  accessRevision: 'access-1',
};

const node = (overrides: Partial<GraphNodeV1> = {}): GraphNodeV1 => ({
  schemaVersion: '1.0.0',
  nodeId: 'node-1',
  resourceRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
  label: 'Entity One',
  nodeKind: 'ENTITY',
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships: [],
  revisionBinding: binding,
  accessMasking: 'VISIBLE',
  payload: {
    schemaVersion: '1.0.0',
    nodeKind: 'ENTITY',
    entity: { schemaVersion: 'entity.v1', entityType: 'PERSON', displayName: 'Entity One' },
  },
  ...overrides,
});

const edge = (overrides: Partial<GraphEdgeV1> = {}): GraphEdgeV1 => ({
  schemaVersion: '1.0.0',
  edgeId: 'edge-1',
  from: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
  to: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId: 'claim-1' },
  edgeSemanticKind: 'CANONICAL_RELATION',
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships: [],
  revisionBinding: binding,
  accessMasking: 'VISIBLE',
  ...overrides,
});

const snapshot: GraphSnapshotResultV1 = {
  schemaVersion: '1.0.0',
  identity: {
    schemaVersion: '1.0.0',
    snapshotId: 'snapshot-1',
    projectId: 'project-1',
    viewKind: 'KNOWLEDGE_SEMANTIC',
    projectionRevision: 'proj-1',
    generatedAt: '2026-08-04T08:00:00.000Z',
  },
  health: 'COMPLETE',
  completeness: 'COMPLETE',
  nodes: [node()],
  edges: [edge()],
  appliedLimits: {
    schemaVersion: '1.0.0',
    maxDepth: 3,
    maxNodes: 100,
    maxEdges: 200,
    traversalBudget: 1000,
    serverTimeoutBudgetMs: 5000,
    requestedMaxDepth: null,
    requestedMaxNodes: null,
    requestedMaxEdges: null,
    clamped: false,
  },
  overlays: [],
  capabilities: { schemaVersion: '1.0.0', capabilities: ['SNAPSHOT'] },
};

describe('AC-25: graph correction seed construction', () => {
  it('builds a NODE seed carrying the stable resource ref and correction intent', () => {
    const seed = buildGraphNodeCorrectionSeed(snapshot, node());
    expect(seed).not.toBeNull();
    expect(seed!.sourceWorkspace).toBe('KNOWLEDGE_GRAPH');
    expect(seed!.targetKind).toBe('NODE');
    expect(seed!.stableResourceRef).toEqual({
      schemaVersion: '1.0.0',
      resourceKind: 'ENTITY',
      resourceId: 'entity-1',
    });
    expect(seed!.snapshotId).toBe('snapshot-1');
    expect(seed!.projectionRevision).toBe('proj-1');
    expect(seed!.suggestedChangeIntent).toBe('CORRECT_KNOWLEDGE');
    expect(seed!.masked).toBe(false);
  });

  it('yields a minimal ref-only seed for a masked node', () => {
    const masked = node({ accessMasking: 'MASKED', payload: undefined });
    const seed = buildGraphNodeCorrectionSeed(snapshot, masked);
    expect(seed).not.toBeNull();
    expect(seed!.masked).toBe(true);
    expect(seed!.stableResourceRef.resourceId).toBe('entity-1');
  });

  it('yields no seed for a hidden node (no correction surface)', () => {
    const hidden = node({ accessMasking: 'HIDDEN' });
    expect(buildGraphNodeCorrectionSeed(snapshot, hidden)).toBeNull();
  });

  it('builds an EDGE seed with from/to stable refs', () => {
    const seed = buildGraphEdgeCorrectionSeed(snapshot, edge());
    expect(seed).not.toBeNull();
    expect(seed!.targetKind).toBe('EDGE');
    expect(seed!.stableResourceRef.resourceId).toBe('entity-1');
    expect(seed!.relatedResourceRefs.map((ref) => ref.resourceId)).toEqual(['claim-1']);
    expect(seed!.masked).toBe(false);
  });

  it('yields a masked EDGE seed and no seed for a hidden edge', () => {
    const masked = edge({ accessMasking: 'MASKED' });
    expect(buildGraphEdgeCorrectionSeed(snapshot, masked)!.masked).toBe(true);
    const hidden = edge({ accessMasking: 'HIDDEN' });
    expect(buildGraphEdgeCorrectionSeed(snapshot, hidden)).toBeNull();
  });
});

describe('AC-25: correction seed encode/decode and editor href', () => {
  it('round-trips a seed through encode/decode', () => {
    const seed = buildGraphNodeCorrectionSeed(snapshot, node())!;
    const decoded = decodeGraphCorrectionSeed(encodeGraphCorrectionSeed(seed));
    expect(decoded).toEqual(seed);
  });

  it('builds a Knowledge Editor href carrying the seed query', () => {
    const seed = buildGraphNodeCorrectionSeed(snapshot, node())!;
    const href = graphCorrectionEditorHref(seed);
    expect(href.startsWith('/knowledge?correction=')).toBe(true);
    const raw = new URLSearchParams(href.split('?')[1] ?? '').get('correction');
    expect(decodeGraphCorrectionSeed(raw)).toEqual(seed);
  });

  it('rejects malformed seeds (no write can be triggered)', () => {
    expect(decodeGraphCorrectionSeed(null)).toBeNull();
    expect(decodeGraphCorrectionSeed('')).toBeNull();
    expect(decodeGraphCorrectionSeed('not-json')).toBeNull();
    expect(
      decodeGraphCorrectionSeed(
        JSON.stringify({
          ...buildGraphNodeCorrectionSeed(snapshot, node()),
          schemaVersion: '2.0.0',
        }),
      ),
    ).toBeNull();
    expect(
      decodeGraphCorrectionSeed(
        JSON.stringify({
          ...buildGraphNodeCorrectionSeed(snapshot, node()),
          suggestedChangeIntent: 'MERGE',
        }),
      ),
    ).toBeNull();
    expect(
      decodeGraphCorrectionSeed(
        JSON.stringify({
          ...buildGraphNodeCorrectionSeed(snapshot, node()),
          stableResourceRef: { resourceId: 'x' },
        }),
      ),
    ).toBeNull();
  });
});
