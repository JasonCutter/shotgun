import { describe, expect, it } from 'vitest';

import {
  FrontendContractError,
  KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  decodeKnowledgeCompareRequest,
  decodeKnowledgeCompareView,
  decodeKnowledgeDetailRequest,
  decodeKnowledgeDetailView,
  decodeKnowledgeEvidenceReturnTarget,
  decodeKnowledgeItemView,
  decodeKnowledgePageListRequest,
  decodeKnowledgePageListView,
  decodeKnowledgePageView,
  decodeKnowledgeProjectionStatusView,
  decodeKnowledgeSearchRequest,
  decodeKnowledgeSearchResultView,
  decodeKnowledgeWorkspaceRequest,
  decodeKnowledgeWorkspaceView,
} from '../../packages/contracts/src/index.js';

const now = '2026-08-02T08:00:00.000Z';

const readyProjection = {
  status: 'READY' as const,
  canonicalVersion: 7,
  projectedCanonicalVersion: 7,
  lag: 0,
  projectionRevision: 'projection-revision-7',
  updatedAt: now,
};

const staleProjection = {
  status: 'STALE' as const,
  canonicalVersion: 7,
  projectedCanonicalVersion: 6,
  lag: 1,
  reason: 'Projection is one canonical revision behind.',
  updatedAt: now,
};

const canonicalItem = {
  productId: 'item-canonical-1',
  projectId: 'project-1',
  resourceId: 'resource-1',
  revision: 'resource-revision-1',
  authority: 'CANONICAL' as const,
  kind: 'CLAIM' as const,
  temporalState: 'CURRENT' as const,
  label: 'Canonical claim',
  content: 'The canonical claim is retained as authoritative knowledge.',
  lineage: {
    projectId: 'project-1',
    productId: 'item-canonical-1',
    resourceRevision: 'resource-revision-1',
    canonicalResourceId: 'canonical-claim-1',
    canonicalRevisionId: 'canonical-revision-7',
    canonicalVersion: 7,
    sourceVersionId: 'source-version-1',
    evidenceIds: ['evidence-1'],
  },
  evidenceTargets: [
    {
      resourceId: 'resource-1',
      resourceRevision: 'resource-revision-1',
      focusId: 'item-canonical-1',
      sourceVersionId: 'source-version-1',
      evidenceId: 'evidence-1',
      sourceId: 'source-1',
    },
  ],
};

const approvedItem = {
  productId: 'item-approved-1',
  projectId: 'project-1',
  resourceId: 'resource-1',
  revision: 'resource-revision-1',
  authority: 'APPROVED_KNOWLEDGE' as const,
  kind: 'ENTITY' as const,
  temporalState: 'CURRENT' as const,
  label: 'Approved entity',
  summary: 'An approved Knowledge Model entity.',
  lineage: {
    projectId: 'project-1',
    productId: 'item-approved-1',
    resourceRevision: 'resource-revision-1',
    sourceVersionId: 'source-version-1',
    evidenceIds: ['evidence-1'],
  },
};

const compiledItem = {
  productId: 'item-compiled-1',
  projectId: 'project-1',
  resourceId: 'resource-2',
  revision: 'resource-revision-2',
  authority: 'COMPILED_TRUTH' as const,
  kind: 'CLAIM' as const,
  temporalState: 'CURRENT' as const,
  label: 'Compiled Truth claim',
  lineage: {
    projectId: 'project-1',
    productId: 'item-compiled-1',
    resourceRevision: 'resource-revision-2',
    projectionId: 'projection-item-1',
    canonicalResourceId: 'canonical-claim-1',
    canonicalVersion: 7,
    projection: readyProjection,
  },
};

const derivedItem = {
  productId: 'item-derived-1',
  projectId: 'project-1',
  resourceId: 'resource-2',
  revision: 'resource-revision-2',
  authority: 'DERIVED_INFERENCE' as const,
  kind: 'KNOWLEDGE_GAP' as const,
  temporalState: 'FUTURE' as const,
  label: 'Derived knowledge gap',
  content: 'Which evidence should be collected next?',
  lineage: {
    projectId: 'project-1',
    productId: 'item-derived-1',
    resourceRevision: 'resource-revision-2',
    projectionId: 'projection-item-1',
  },
};

const pageOne = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  pageId: 'page-1',
  projectId: 'project-1',
  resourceId: 'resource-1',
  revision: 'resource-revision-1',
  focusId: 'item-canonical-1',
  title: 'Canonical Knowledge Page',
  items: [canonicalItem, approvedItem],
  lineage: {
    projectId: 'project-1',
    productId: 'page-1',
    resourceRevision: 'resource-revision-1',
    canonicalVersion: 7,
  },
  projection: readyProjection,
  capabilities: ['READ', 'EVIDENCE_NAVIGATION'] as const,
  fetchedAt: now,
};

const pageTwo = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  pageId: 'page-2',
  projectId: 'project-1',
  resourceId: 'resource-2',
  revision: 'resource-revision-2',
  focusId: 'item-compiled-1',
  title: 'Compiled Knowledge Page',
  items: [compiledItem, derivedItem],
  lineage: {
    projectId: 'project-1',
    productId: 'page-2',
    resourceRevision: 'resource-revision-2',
    canonicalVersion: 7,
    projection: readyProjection,
  },
  projection: readyProjection,
  capabilities: ['READ', 'COMPARE'] as const,
  fetchedAt: now,
};

const pageOneSummary = {
  pageId: 'page-1',
  projectId: 'project-1',
  resourceId: 'resource-1',
  revision: 'resource-revision-1',
  title: 'Canonical Knowledge Page',
  primaryAuthority: 'CANONICAL' as const,
  primaryKind: 'CLAIM' as const,
  projection: readyProjection,
};

describe('Frontend Knowledge Product contracts', () => {
  it('decodes server-authorized read requests without accepting browser authority', () => {
    expect(
      decodeKnowledgeWorkspaceRequest({
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        resourceId: 'resource-1',
        pageSize: 25,
        requestedRevision: 'resource-revision-1',
        focusId: 'item-canonical-1',
      }),
    ).toMatchObject({ resourceId: 'resource-1', pageSize: 25 });

    expect(
      decodeKnowledgePageListRequest({
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        cursor: 'cursor-1',
      }),
    ).toEqual({
      schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
      cursor: 'cursor-1',
    });

    expect(
      decodeKnowledgeSearchRequest({
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        query: 'canonical',
        filters: { authorities: ['CANONICAL'], kinds: ['CLAIM'] },
        pageSize: 10,
      }),
    ).toMatchObject({ query: 'canonical', filters: { authorities: ['CANONICAL'] } });

    expect(
      decodeKnowledgeDetailRequest({
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        resourceId: 'resource-1',
        requestedRevision: 'resource-revision-1',
        focusId: 'item-canonical-1',
      }),
    ).toMatchObject({ resourceId: 'resource-1', focusId: 'item-canonical-1' });

    expect(
      decodeKnowledgeCompareRequest({
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        pageIds: ['page-1', 'page-2'],
      }),
    ).toEqual({
      schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
      pageIds: ['page-1', 'page-2'],
    });

    expect(() =>
      decodeKnowledgeSearchRequest({
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        query: 'authority boundary',
        principalId: 'browser-principal',
      }),
    ).toThrow(FrontendContractError);
  });

  it('preserves the four authority classes, typed kinds, lineage, and pinned Evidence return targets', () => {
    expect(decodeKnowledgeItemView(canonicalItem)).toMatchObject({
      authority: 'CANONICAL',
      kind: 'CLAIM',
      lineage: { canonicalResourceId: 'canonical-claim-1' },
    });
    expect(decodeKnowledgeItemView(approvedItem)).toMatchObject({
      authority: 'APPROVED_KNOWLEDGE',
      kind: 'ENTITY',
    });
    expect(decodeKnowledgeItemView(compiledItem)).toMatchObject({
      authority: 'COMPILED_TRUTH',
      lineage: { projection: { status: 'READY' } },
    });
    expect(decodeKnowledgeItemView(derivedItem)).toMatchObject({
      authority: 'DERIVED_INFERENCE',
      kind: 'KNOWLEDGE_GAP',
    });

    expect(decodeKnowledgeEvidenceReturnTarget(canonicalItem.evidenceTargets[0])).toMatchObject({
      sourceVersionId: 'source-version-1',
      resourceRevision: 'resource-revision-1',
      focusId: 'item-canonical-1',
    });
  });

  it('decodes workspace, list, search, detail, and read-only compare views', () => {
    const workspace = {
      schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
      principalId: 'principal-1',
      sessionId: 'session-1',
      projectId: 'project-1',
      pages: [pageOneSummary],
      projection: readyProjection,
      capabilities: ['READ', 'SEARCH', 'FILTER'] as const,
      fetchedAt: now,
    };
    const pageList = {
      schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
      projectId: 'project-1',
      pages: [pageOneSummary],
      nextCursor: 'cursor-2',
      projection: readyProjection,
      fetchedAt: now,
    };
    const searchResult = {
      schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
      projectId: 'project-1',
      query: 'canonical',
      matches: [
        {
          matchId: 'match-1',
          projectId: 'project-1',
          resourceId: 'resource-2',
          item: compiledItem,
          score: 0.9,
          matchAuthority: 'PROJECTION' as const,
          matchType: 'FULL_TEXT' as const,
          snippet: 'Compiled Truth claim',
        },
      ],
      projection: readyProjection,
      fetchedAt: now,
    };
    const detail = {
      schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
      resourceId: 'resource-2',
      revision: 'resource-revision-2',
      focusId: 'item-compiled-1',
      page: pageTwo,
      fetchedAt: now,
    };
    const compare = {
      schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
      projectId: 'project-1',
      left: pageOne,
      right: pageTwo,
      differences: [
        {
          differenceId: 'difference-1',
          path: 'items[0].authority',
          kind: 'CHANGED' as const,
          leftValue: 'CANONICAL',
          rightValue: 'COMPILED_TRUTH',
        },
      ],
      projection: readyProjection,
      capabilities: ['READ', 'COMPARE'] as const,
      fetchedAt: now,
    };

    expect(decodeKnowledgeWorkspaceView(workspace)).toEqual(workspace);
    expect(decodeKnowledgePageListView(pageList)).toEqual(pageList);
    expect(decodeKnowledgeSearchResultView(searchResult)).toEqual(searchResult);
    expect(decodeKnowledgePageView(pageTwo)).toEqual(pageTwo);
    expect(decodeKnowledgeDetailView(detail)).toEqual(detail);
    expect(decodeKnowledgeCompareView(compare)).toEqual(compare);
  });

  it('keeps projection readiness states authoritative and rejects contradictory READY metadata', () => {
    expect(decodeKnowledgeProjectionStatusView(readyProjection)).toEqual(readyProjection);
    expect(decodeKnowledgeProjectionStatusView(staleProjection)).toEqual(staleProjection);
    expect(
      decodeKnowledgeProjectionStatusView({
        status: 'DEGRADED',
        canonicalVersion: 7,
        projectedCanonicalVersion: 6,
        lag: 1,
        reason: 'Projection adapter degraded.',
      }),
    ).toMatchObject({ status: 'DEGRADED' });

    expect(() =>
      decodeKnowledgeProjectionStatusView({
        ...readyProjection,
        reason: 'stale projection',
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeKnowledgeProjectionStatusView({
        ...readyProjection,
        status: 'STALE',
      }),
    ).toThrow(FrontendContractError);
  });

  it('rejects unknown fields, authority confusion, identity mismatch, unsafe Evidence, and compare writes', () => {
    expect(() =>
      decodeKnowledgeItemView({
        ...canonicalItem,
        unexpected: true,
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeKnowledgeItemView({
        ...compiledItem,
        authority: 'CANONICAL',
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeKnowledgeItemView({
        ...derivedItem,
        authority: 'CANONICAL',
        kind: 'DERIVED_INFERENCE',
        lineage: {
          ...derivedItem.lineage,
          canonicalResourceId: 'fabricated-canonical-id',
        },
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeKnowledgeItemView({
        ...canonicalItem,
        lineage: {
          ...canonicalItem.lineage,
          evidenceIds: ['evidence-1'],
          sourceVersionId: undefined,
        },
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeKnowledgeEvidenceReturnTarget({
        ...canonicalItem.evidenceTargets[0],
        sourceVersionId: undefined,
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeKnowledgePageView({
        ...pageOne,
        items: [{ ...canonicalItem, projectId: 'project-2' }],
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeKnowledgeCompareView({
        ...{
          schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
          projectId: 'project-1',
          left: pageOne,
          right: pageTwo,
          differences: [],
          projection: readyProjection,
          capabilities: ['READ', 'COMPARE'],
          fetchedAt: now,
        },
        writeProposal: { operation: 'COMMIT' },
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeKnowledgeCompareRequest({
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        pageIds: ['page-1', 'page-2', 'page-3'],
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeKnowledgeCompareRequest({
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        pageIds: ['page-1', 'page-1'],
      }),
    ).toThrow(FrontendContractError);
    expect(() =>
      decodeKnowledgeCompareView({
        schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
        projectId: 'project-1',
        left: pageOne,
        right: pageOne,
        differences: [
          {
            differenceId: 'difference-unsafe',
            path: 'items',
            kind: 'CHANGED',
            leftValue: 'left',
            rightValue: 'right',
            writeProposal: { operation: 'COMMIT' },
          },
        ],
        projection: readyProjection,
        capabilities: ['READ', 'COMPARE'],
        fetchedAt: now,
      }),
    ).toThrow(FrontendContractError);
  });
});
