import { describe, expect, it } from 'vitest';

import searchResultSchema from '../../packages/contracts/schemas/frontend-knowledge-search-result.v1.1.schema.json';

import {
  assertJsonSchema,
  decodeKnowledgeSearchResultView,
  decodeKnowledgeSearchResultViewVNext,
  sha256Text,
  type KnowledgeSearchResultViewVNext,
} from '../../packages/contracts/src/index.js';
import {
  compareKnowledgePages,
  knowledgeDifferenceId,
  knowledgeMatchId,
  knowledgePageId,
  knowledgeProductId,
} from '../../modules/frontend-product-read/src/knowledge-contract.js';
import type { KnowledgePageView } from '../../packages/contracts/src/index.js';

const canonicalReady = {
  projectionKind: 'CANONICAL_SEARCH' as const,
  status: 'READY' as const,
  canonicalVersion: 7,
  projectedCanonicalVersion: 7,
  lag: 0,
  canonicalSnapshotDigest: sha256Text('canonical'),
  projectedSnapshotDigest: sha256Text('canonical'),
  updatedAt: '2026-08-02T12:00:00.000Z',
};

const compiledStale = {
  projectionKind: 'COMPILED_TRUTH' as const,
  status: 'STALE' as const,
  canonicalVersion: 7,
  projectedCanonicalVersion: 6,
  lag: 1,
  sourceSnapshotDigest: sha256Text('source'),
  projectionLogicalDigest: sha256Text('projection'),
  reason: 'Compiled Truth is one Canonical revision behind.',
  updatedAt: '2026-08-02T12:00:00.000Z',
};

const canonicalItem = {
  productId: 'knowledge-item:v1:canonical',
  projectId: 'project-1',
  resourceId: 'source-1',
  revision: 'revision-1',
  authority: 'CANONICAL' as const,
  kind: 'CLAIM' as const,
  temporalState: 'CURRENT' as const,
  label: 'Canonical item',
  content: 'Canonical content',
  lineage: {
    projectId: 'project-1',
    productId: 'knowledge-item:v1:canonical',
    resourceRevision: 'revision-1',
    canonicalResourceId: 'claim-1',
    canonicalRevisionId: 'canonical-revision-7',
    canonicalVersion: 7,
    sourceId: 'source-1',
    sourceVersionId: 'source-version-1',
    evidenceIds: ['evidence-1'],
  },
  evidenceTargets: [
    {
      resourceId: 'source-1',
      resourceRevision: 'revision-1',
      focusId: '/items/0',
      sourceId: 'source-1',
      sourceVersionId: 'source-version-1',
      evidenceId: 'evidence-1',
    },
  ],
};

const vnext = (
  overrides: Partial<KnowledgeSearchResultViewVNext> = {},
): KnowledgeSearchResultViewVNext => ({
  schemaVersion: '1.1.0',
  projectId: 'project-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  query: 'canonical',
  matches: [
    {
      matchId: 'knowledge-match:v1:canonical',
      projectId: 'project-1',
      resourceId: 'source-1',
      item: canonicalItem,
      score: 1,
      matchAuthority: 'CANONICAL',
      matchType: 'FULL_TEXT',
    },
  ],
  projection: canonicalReady,
  readiness: {
    canonicalSearch: canonicalReady,
    sourceProjections: [compiledStale],
    partial: true,
  },
  fetchedAt: '2026-08-02T12:00:00.000Z',
  ...overrides,
});

describe('Knowledge Product Search 1.1.0 contract', () => {
  it('preserves QX readiness, optional digests, and an empty partial result', () => {
    const decoded = decodeKnowledgeSearchResultViewVNext(
      vnext({ matches: [], readiness: { ...vnext().readiness, partial: true } }),
    );
    expect(decoded.readiness.canonicalSearch.canonicalSnapshotDigest).toBe(
      canonicalReady.canonicalSnapshotDigest,
    );
    expect(decoded.readiness.sourceProjections[0]?.projectionLogicalDigest).toBe(
      compiledStale.projectionLogicalDigest,
    );
    expect(decoded.projection).toEqual(decoded.readiness.canonicalSearch);
  });

  it('rejects readiness drift, alias drift, and unknown fields without weakening 1.0.0', () => {
    expect(() =>
      decodeKnowledgeSearchResultViewVNext({
        ...vnext(),
        readiness: { ...vnext().readiness, partial: false },
      }),
    ).toThrow(/partial/);
    expect(() =>
      decodeKnowledgeSearchResultViewVNext({
        ...vnext(),
        projection: {
          ...canonicalReady,
          status: 'STALE',
          projectedCanonicalVersion: 6,
          lag: 1,
          reason: 'stale',
        },
      }),
    ).toThrow(/projection/);
    expect(() =>
      decodeKnowledgeSearchResultViewVNext({
        ...vnext(),
        readiness: { ...vnext().readiness, unexpected: true },
      }),
    ).toThrow(/unknown field/);
    expect(() => decodeKnowledgeSearchResultView({ ...vnext(), readiness: undefined })).toThrow(
      /unknown field/,
    );
  });

  it('validates the additive 1.1.0 JSON Schema and rejects unknown nested fields', () => {
    expect(() =>
      assertJsonSchema(searchResultSchema, vnext(), 'Knowledge Product Search 1.1.0'),
    ).not.toThrow();
    expect(() =>
      assertJsonSchema(
        searchResultSchema,
        {
          ...vnext(),
          matches: [
            {
              ...vnext().matches[0]!,
              item: { ...vnext().matches[0]!.item, unknownField: true },
            },
          ],
        },
        'invalid Knowledge Product Search 1.1.0',
      ),
    ).toThrow();
  });
});

describe('Knowledge Product deterministic identities and Compare', () => {
  it('uses complete authority-specific tuples and fails closed when one is missing', () => {
    const input = {
      authority: 'CANONICAL' as const,
      projectId: 'project-1',
      resourceId: 'source-1',
      resourceRevision: 'revision-1',
      canonicalResourceId: 'claim-1',
      canonicalRevisionId: 'canonical-revision-7',
      sourceId: 'source-1',
      sourceVersionId: 'source-version-1',
    };
    expect(knowledgeProductId(input)).toBe(knowledgeProductId({ ...input }));
    expect(knowledgeProductId(input)).toContain('knowledge-item:v1:sha256:');
    expect(() => knowledgeProductId({ ...input, sourceVersionId: undefined })).toThrow(
      /sourceVersionId/,
    );
    expect(
      knowledgePageId({ projectId: 'project-1', resourceId: 'source-1', revision: 'revision-1' }),
    ).not.toBe(
      knowledgePageId({ projectId: 'project-1', resourceId: 'source-1', revision: 'revision-2' }),
    );
    expect(
      knowledgeMatchId({
        projectId: 'project-1',
        resourceId: 'source-1',
        revision: 'revision-1',
        normalizedQuery: 'canonical',
        productId: knowledgeProductId(input),
        authority: 'CANONICAL',
        matchType: 'FULL_TEXT',
      }),
    ).not.toBe(
      knowledgeMatchId({
        projectId: 'project-1',
        resourceId: 'source-1',
        revision: 'revision-1',
        normalizedQuery: 'canonical',
        productId: knowledgeProductId(input),
        authority: 'CANONICAL',
        matchType: 'TRIGRAM',
      }),
    );
  });

  it('compares ordered pages deterministically, including escaped item paths and reversed IDs', () => {
    const left = {
      schemaVersion: '1.0.0' as const,
      pageId: 'page-left',
      projectId: 'project-1',
      resourceId: 'source-1',
      revision: 'revision-1',
      title: 'Left',
      items: [
        {
          ...canonicalItem,
          productId: 'item~with/slash',
          lineage: { ...canonicalItem.lineage, productId: 'item~with/slash' },
        },
      ],
      lineage: { ...canonicalItem.lineage, productId: 'item~with/slash' },
      projection: canonicalReady,
      capabilities: ['READ', 'COMPARE'] as const,
      fetchedAt: '2026-08-02T12:00:00.000Z',
    } satisfies KnowledgePageView;
    const right = {
      ...left,
      pageId: 'page-right',
      revision: 'revision-2',
      title: 'Right',
      items: [{ ...left.items[0]!, label: 'Right item' }],
    };
    const differences = compareKnowledgePages(left, right);
    expect(differences.some((difference) => difference.path === '/title')).toBe(true);
    expect(differences.some((difference) => difference.path.includes('item~0with~1slash'))).toBe(
      true,
    );
    expect(differences).toEqual(compareKnowledgePages(left, right));
    expect(differences[0]?.differenceId).not.toBe(
      compareKnowledgePages(right, left)[0]?.differenceId,
    );
    expect(
      knowledgeDifferenceId({
        projectId: 'project-1',
        leftPageId: 'page-left',
        leftRevision: 'revision-1',
        rightPageId: 'page-right',
        rightRevision: 'revision-2',
        path: '/title',
        kind: 'CHANGED',
        leftValue: '"Left"',
        rightValue: '"Right"',
      }),
    ).toMatch(/^knowledge-difference:v1:sha256:/);
  });
});
