import { describe, expect, it } from 'vitest';

import {
  InMemoryKnowledgeWorkspaceProjection,
  knowledgeCompareSeedKey,
  type InMemoryKnowledgeWorkspaceSeed,
} from '../../adapters/frontend-product-read-in-memory/src/index.js';
import {
  FrontendContractError,
  KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  type KnowledgeCompareView,
  type KnowledgeDetailView,
  type KnowledgePageListView,
  type KnowledgePageSummaryView,
  type KnowledgePageView,
  type KnowledgeProjectionStatusView,
  type KnowledgeSearchResultView,
  type KnowledgeWorkspaceView,
} from '../../packages/contracts/src/index.js';
import { defineFrontendKnowledgeProjectionContract } from '../helpers/frontend-knowledge-projection-contract.js';

const now = '2026-08-02T09:00:00.000Z';

const scope = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Project One',
    isOwner: true,
    sensitivityClearance: 'private' as const,
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Project One',
      isOwner: true,
      sensitivityClearance: 'private' as const,
    },
  ],
  accessRevision: 'access-revision-1',
  policyContextRevision: 'policy-revision-1',
};

const canonicalSearchReady = {
  projectionKind: 'CANONICAL_SEARCH',
  status: 'READY',
  canonicalVersion: 7,
  projectedCanonicalVersion: 7,
  lag: 0,
  projectionRevision: 'canonical-search-revision-7',
  updatedAt: now,
} as const satisfies KnowledgeProjectionStatusView;

const canonicalSearchStale = {
  projectionKind: 'CANONICAL_SEARCH',
  status: 'STALE',
  canonicalVersion: 7,
  projectedCanonicalVersion: 6,
  lag: 1,
  reason: 'Canonical Search is one Canonical revision behind.',
  updatedAt: now,
} as const satisfies KnowledgeProjectionStatusView;

const compiledReady = {
  projectionKind: 'COMPILED_TRUTH',
  status: 'READY',
  canonicalVersion: 7,
  projectedCanonicalVersion: 7,
  lag: 0,
  projectionRevision: 'compiled-truth-revision-7',
  updatedAt: now,
} as const satisfies KnowledgeProjectionStatusView;

const compiledStale = {
  projectionKind: 'COMPILED_TRUTH',
  status: 'STALE',
  canonicalVersion: 7,
  projectedCanonicalVersion: 6,
  lag: 1,
  reason: 'Compiled Truth is one Canonical revision behind.',
  updatedAt: now,
} as const satisfies KnowledgeProjectionStatusView;

const compiledDegraded = {
  projectionKind: 'COMPILED_TRUTH',
  status: 'DEGRADED',
  canonicalVersion: 7,
  projectedCanonicalVersion: 6,
  lag: 1,
  reason: 'Compiled Truth contains a degraded projection segment.',
  updatedAt: now,
} as const satisfies KnowledgeProjectionStatusView;

const compiledNotBuilt = {
  projectionKind: 'COMPILED_TRUTH',
  status: 'NOT_BUILT',
  canonicalVersion: 7,
  projectedCanonicalVersion: 0,
  lag: 7,
  reason: 'Compiled Truth has not been built for this item.',
  updatedAt: now,
} as const satisfies KnowledgeProjectionStatusView;

const canonicalItem = {
  productId: 'item-canonical-1',
  projectId: 'project-1',
  resourceId: 'resource-1',
  revision: 'resource-revision-1',
  authority: 'CANONICAL',
  kind: 'CLAIM',
  temporalState: 'CURRENT',
  label: 'Canonical claim',
  content: 'The canonical claim remains the source of truth.',
  lineage: {
    projectId: 'project-1',
    productId: 'item-canonical-1',
    resourceRevision: 'resource-revision-1',
    canonicalResourceId: 'canonical-claim-1',
    canonicalRevisionId: 'canonical-revision-7',
    canonicalVersion: 7,
    sourceId: 'source-1',
    sourceVersionId: 'source-version-1',
    evidenceIds: ['evidence-1'],
  },
  evidenceTargets: [
    {
      resourceId: 'resource-1',
      resourceRevision: 'resource-revision-1',
      focusId: 'item-canonical-1',
      sourceId: 'source-1',
      sourceVersionId: 'source-version-1',
      evidenceId: 'evidence-1',
    },
  ],
} as const;

const approvedItem = {
  productId: 'item-approved-1',
  projectId: 'project-1',
  resourceId: 'resource-1',
  revision: 'resource-revision-1',
  authority: 'APPROVED_KNOWLEDGE',
  kind: 'ENTITY',
  temporalState: 'CURRENT',
  label: 'Approved entity',
  summary: 'An approved Knowledge Model entity.',
  lineage: {
    projectId: 'project-1',
    productId: 'item-approved-1',
    resourceRevision: 'resource-revision-1',
    sourceId: 'source-1',
    sourceVersionId: 'source-version-1',
    evidenceIds: ['evidence-1'],
  },
} as const;

const compiledItem = {
  productId: 'item-compiled-1',
  projectId: 'project-1',
  resourceId: 'resource-2',
  revision: 'resource-revision-2',
  authority: 'COMPILED_TRUTH',
  kind: 'CLAIM',
  temporalState: 'CURRENT',
  label: 'Compiled Truth claim',
  lineage: {
    projectId: 'project-1',
    productId: 'item-compiled-1',
    resourceRevision: 'resource-revision-2',
    projectionId: 'compiled-item-projection-1',
    canonicalVersion: 7,
    projection: compiledReady,
  },
} as const;

const compiledStaleItem = {
  productId: 'item-compiled-stale-1',
  projectId: 'project-1',
  resourceId: 'resource-2',
  revision: 'resource-revision-2',
  authority: 'COMPILED_TRUTH',
  kind: 'FACT',
  temporalState: 'PAST',
  label: 'Stale Compiled Truth fact',
  lineage: {
    projectId: 'project-1',
    productId: 'item-compiled-stale-1',
    resourceRevision: 'resource-revision-2',
    projectionId: 'compiled-item-projection-stale-1',
    canonicalVersion: 7,
    projection: compiledStale,
  },
} as const;

const derivedDegradedItem = {
  productId: 'item-derived-degraded-1',
  projectId: 'project-1',
  resourceId: 'resource-2',
  revision: 'resource-revision-2',
  authority: 'DERIVED_INFERENCE',
  kind: 'KNOWLEDGE_GAP',
  temporalState: 'FUTURE',
  label: 'Degraded derived knowledge gap',
  content: 'A projection segment needs repair before this gap is resolved.',
  lineage: {
    projectId: 'project-1',
    productId: 'item-derived-degraded-1',
    resourceRevision: 'resource-revision-2',
    projectionId: 'compiled-item-projection-degraded-1',
    projection: compiledDegraded,
  },
} as const;

const derivedNotBuiltItem = {
  productId: 'item-derived-1',
  projectId: 'project-1',
  resourceId: 'resource-2',
  revision: 'resource-revision-2',
  authority: 'DERIVED_INFERENCE',
  kind: 'KNOWLEDGE_GAP',
  temporalState: 'FUTURE',
  label: 'Derived knowledge gap',
  content: 'Which evidence should be collected next?',
  lineage: {
    projectId: 'project-1',
    productId: 'item-derived-1',
    resourceRevision: 'resource-revision-2',
    projectionId: 'compiled-item-projection-not-built-1',
    projection: compiledNotBuilt,
  },
} as const;

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
  projection: canonicalSearchReady,
  capabilities: ['READ', 'EVIDENCE_NAVIGATION'] as const,
  fetchedAt: now,
} as const satisfies KnowledgePageView;

const pageTwo = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  pageId: 'page-2',
  projectId: 'project-1',
  resourceId: 'resource-2',
  revision: 'resource-revision-2',
  focusId: 'item-compiled-1',
  title: 'Compiled Knowledge Page',
  items: [compiledItem, compiledStaleItem, derivedDegradedItem, derivedNotBuiltItem],
  lineage: {
    projectId: 'project-1',
    productId: 'page-2',
    resourceRevision: 'resource-revision-2',
    canonicalVersion: 7,
    projection: compiledStale,
  },
  projection: compiledStale,
  capabilities: ['READ', 'COMPARE'] as const,
  fetchedAt: now,
} as const satisfies KnowledgePageView;

const pageOneSummary = {
  pageId: 'page-1',
  projectId: 'project-1',
  resourceId: 'resource-1',
  revision: 'resource-revision-1',
  title: 'Canonical Knowledge Page',
  primaryAuthority: 'CANONICAL',
  primaryKind: 'CLAIM',
  projection: canonicalSearchStale,
} as const satisfies KnowledgePageSummaryView;

const pageTwoSummary = {
  pageId: 'page-2',
  projectId: 'project-1',
  resourceId: 'resource-2',
  revision: 'resource-revision-2',
  title: 'Compiled Knowledge Page',
  primaryAuthority: 'COMPILED_TRUTH',
  primaryKind: 'CLAIM',
  projection: compiledStale,
} as const satisfies KnowledgePageSummaryView;

const workspace = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  principalId: scope.principalId,
  sessionId: scope.sessionId,
  projectId: 'project-1',
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  pages: [pageOneSummary, pageTwoSummary],
  projection: canonicalSearchReady,
  capabilities: ['READ', 'SEARCH', 'FILTER', 'COMPARE', 'EVIDENCE_NAVIGATION'] as const,
  fetchedAt: now,
} as const satisfies KnowledgeWorkspaceView;

const pageList = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  projectId: 'project-1',
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  pages: [pageOneSummary, pageTwoSummary],
  projection: canonicalSearchReady,
  fetchedAt: now,
} as const satisfies KnowledgePageListView;

const search = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  projectId: 'project-1',
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  query: 'canonical',
  matches: [
    {
      matchId: 'match-canonical',
      projectId: 'project-1',
      resourceId: 'resource-1',
      item: canonicalItem,
      score: 0.99,
      matchAuthority: 'CANONICAL',
      matchType: 'FULL_TEXT',
      snippet: 'The canonical claim remains the source of truth.',
    },
    {
      matchId: 'match-approved',
      projectId: 'project-1',
      resourceId: 'resource-1',
      item: approvedItem,
      score: 0.9,
      matchAuthority: 'CANONICAL',
      matchType: 'TRIGRAM',
      snippet: 'An approved Knowledge Model entity.',
    },
    {
      matchId: 'match-compiled',
      projectId: 'project-1',
      resourceId: 'resource-2',
      item: compiledItem,
      score: 0.8,
      matchAuthority: 'PROJECTION',
      matchType: 'FULL_TEXT',
      snippet: 'Compiled Truth claim',
    },
    {
      matchId: 'match-derived',
      projectId: 'project-1',
      resourceId: 'resource-2',
      item: derivedNotBuiltItem,
      score: 0.7,
      matchAuthority: 'PROJECTION',
      matchType: 'SUBSTRING',
      snippet: 'Which evidence should be collected next?',
    },
  ],
  projection: canonicalSearchReady,
  fetchedAt: now,
} as const satisfies KnowledgeSearchResultView;

const detailOne = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  resourceId: pageOne.resourceId,
  revision: pageOne.revision,
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  focusId: pageOne.focusId,
  page: pageOne,
  fetchedAt: now,
} as const satisfies KnowledgeDetailView;

const detailTwo = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  resourceId: pageTwo.resourceId,
  revision: pageTwo.revision,
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  focusId: pageTwo.focusId,
  page: pageTwo,
  fetchedAt: now,
} as const satisfies KnowledgeDetailView;

const compare = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  projectId: 'project-1',
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  left: pageOne,
  right: pageTwo,
  differences: [
    {
      differenceId: 'difference-authority-1',
      path: 'items[0].authority',
      kind: 'CHANGED',
      leftValue: 'CANONICAL',
      rightValue: 'COMPILED_TRUTH',
    },
  ],
  projection: compiledStale,
  capabilities: ['READ', 'COMPARE'] as const,
  fetchedAt: now,
} as const satisfies KnowledgeCompareView;

const seed = {
  workspace,
  pageList,
  search,
  pages: [pageOne, pageTwo],
  details: {
    [detailOne.resourceId]: detailOne,
    [detailTwo.resourceId]: detailTwo,
  },
  compares: {
    [knowledgeCompareSeedKey(pageOne.pageId, pageTwo.pageId)]: compare,
  },
  pageListCursors: { 'page-cursor-1': 1 },
  searchCursors: {
    'search-cursor-1': 1,
    'search-cursor-2': 2,
    'search-cursor-3': 3,
  },
} as const satisfies InMemoryKnowledgeWorkspaceSeed;

const requests = {
  workspace: {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  },
  pageList: {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  },
  search: {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    query: 'canonical',
  },
  detail: {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    resourceId: 'resource-1',
    requestedRevision: 'resource-revision-1',
    focusId: 'item-canonical-1',
  },
  compare: {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    pageIds: ['page-1', 'page-2'],
  },
} as const;

defineFrontendKnowledgeProjectionContract({
  name: 'InMemory',
  createPort: () => new InMemoryKnowledgeWorkspaceProjection(structuredClone(seed)),
  scope,
  requests,
  expected: {
    workspace,
    pageList,
    search,
    detail: detailOne,
    compare,
  },
});

describe('InMemory Knowledge Workspace seed boundary', () => {
  it('rejects unknown seed fields and malformed lineage instead of fabricating IDs', () => {
    expect(
      () =>
        new InMemoryKnowledgeWorkspaceProjection({
          ...seed,
          unknownSeedField: true,
        }),
    ).toThrow(FrontendContractError);

    const malformedSearch = {
      ...seed.search,
      unknownResponseField: true,
    };
    expect(
      () =>
        new InMemoryKnowledgeWorkspaceProjection({
          ...seed,
          search: malformedSearch,
        }),
    ).toThrow(FrontendContractError);

    const fabricatedLineage = {
      ...compiledItem,
      lineage: {
        ...compiledItem.lineage,
        projectionId: undefined,
      },
    };
    const malformedPage = {
      ...pageTwo,
      items: [fabricatedLineage, compiledStaleItem, derivedDegradedItem, derivedNotBuiltItem],
    };
    expect(
      () =>
        new InMemoryKnowledgeWorkspaceProjection({
          ...seed,
          pages: [pageOne, malformedPage],
          details: {
            ...seed.details,
            [detailTwo.resourceId]: { ...detailTwo, page: malformedPage },
          },
          compares: {
            [knowledgeCompareSeedKey(pageOne.pageId, pageTwo.pageId)]: {
              ...compare,
              right: malformedPage,
            },
          },
        }),
    ).toThrow(FrontendContractError);
  });

  it('returns fixed seed timestamps and does not mutate state through a returned view', async () => {
    const port = new InMemoryKnowledgeWorkspaceProjection(structuredClone(seed));
    const first = await port.getDetail({ ...scope, request: requests.detail });
    (first.page.items as Array<unknown>).length = 0;
    const second = await port.getDetail({ ...scope, request: requests.detail });
    expect(second.fetchedAt).toBe(now);
    expect(second.page.items).toHaveLength(2);
  });
});
