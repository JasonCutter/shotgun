import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { GraphEdgeV1, GraphNodeV1 } from '@shotgun/api-client';

import { GraphListView } from './graph-list-view.js';
import { GraphTableView } from './graph-table-view.js';

const nodes: readonly GraphNodeV1[] = [
  {
    schemaVersion: '1.0.0',
    nodeId: 'entity-1',
    resourceRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
    label: 'Entity One',
    nodeKind: 'ENTITY',
    authority: 'CANONICAL',
    baseViewMembership: 'KNOWLEDGE_SEMANTIC',
    overlayMemberships: [],
    revisionBinding: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-1',
      policyContextRevision: 'policy-1',
      accessRevision: 'access-1',
    },
    accessMasking: 'VISIBLE',
  },
  {
    schemaVersion: '1.0.0',
    nodeId: 'entity-2',
    resourceRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-2' },
    label: 'Entity Two',
    nodeKind: 'ENTITY',
    authority: 'CANONICAL',
    baseViewMembership: 'KNOWLEDGE_SEMANTIC',
    overlayMemberships: [],
    revisionBinding: {
      schemaVersion: '1.0.0',
      projectionRevision: 'projection-1',
      policyContextRevision: 'policy-1',
      accessRevision: 'access-1',
    },
    accessMasking: 'VISIBLE',
  },
];

const edges: readonly GraphEdgeV1[] = [
  {
    schemaVersion: '1.0.0',
    edgeId: 'discovery-edge-1',
    from: nodes[0]!.resourceRef,
    to: nodes[1]!.resourceRef,
    edgeSemanticKind: 'DISCOVERY_CANDIDATE',
    authority: 'DISCOVERY_CANDIDATE',
    baseViewMembership: 'KNOWLEDGE_SEMANTIC',
    overlayMemberships: ['DISCOVERY'],
    provenance: {
      schemaVersion: '1.0.0',
      sourceProjectId: 'project-1',
      generatedBy: 'DISCOVERY',
      discoveryFindingRef: {
        kind: 'DISCOVERY_FINDING',
        findingId: 'finding-1',
        findingRevision: 7,
      },
    },
    evidence: {
      schemaVersion: '1.0.0',
      evidenceCount: 2,
      sourceIds: ['source-1'],
      sourceVersionIds: ['source-version-1'],
      evidenceSpanIds: [],
      evidenceIds: ['evidence-1', 'evidence-2'],
    },
    revisionBinding: nodes[0]!.revisionBinding,
    accessMasking: 'VISIBLE',
    payload: { schemaVersion: '1.0.0', relationType: 'RELATED_TO' },
  },
];

const props = {
  nodes,
  edges,
  selectedRef: null,
  onSelect: vi.fn(),
  onCorrect: vi.fn(),
  ariaLabel: 'Graph fallback',
};

describe('Discovery candidate relation fallback views', () => {
  it('keeps the candidate authority, exact revision detail link, and evidence count visible in List', () => {
    render(<GraphListView {...props} />);
    expect(screen.getByText('Discovery candidate')).toBeTruthy();
    expect(screen.getByText('Evidence: 2')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Discovery candidate detail' }).getAttribute('href'),
    ).toBe('/knowledge/discoveries/finding-1?revision=7');
  });

  it('keeps the same exact revision detail link and evidence count visible in Table', () => {
    render(<GraphTableView {...props} />);
    expect(screen.getByText('Discovery candidate')).toBeTruthy();
    expect(screen.getByText(/Evidence: 2/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Discovery candidate detail' }).getAttribute('href'),
    ).toBe('/knowledge/discoveries/finding-1?revision=7');
  });
});
