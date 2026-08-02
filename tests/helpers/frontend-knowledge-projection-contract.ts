import { describe, expect, it } from 'vitest';

import type {
  FrontendReadScope,
  KnowledgeWorkspaceProjectionPort,
} from '../../modules/frontend-product-read/src/index.js';
import type {
  KnowledgeCompareRequest,
  KnowledgeCompareView,
  KnowledgeDetailRequest,
  KnowledgeDetailView,
  KnowledgePageListRequest,
  KnowledgePageListView,
  KnowledgeSearchRequest,
  KnowledgeSearchResultViewAny,
  KnowledgeWorkspaceRequest,
  KnowledgeWorkspaceView,
} from '../../packages/contracts/src/index.js';
import { FrontendContractError } from '../../packages/contracts/src/index.js';

type ActiveScope = FrontendReadScope & {
  readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
};

type ContractExpectedViews = {
  readonly workspace: KnowledgeWorkspaceView;
  readonly pageList: KnowledgePageListView;
  readonly search: KnowledgeSearchResultViewAny;
  readonly detail: KnowledgeDetailView;
  readonly compare: KnowledgeCompareView;
};

type ContractExpectations = {
  readonly pageCursor?: string | null;
  readonly searchCursor?: string | null;
  readonly resourceFilter?: {
    readonly resourceId: string;
    readonly matchIds: readonly string[];
  };
  readonly authorities?: readonly string[];
  readonly projectionStatuses?: readonly string[];
  readonly canonicalLineage?: {
    readonly canonicalResourceId: string;
    readonly evidenceTarget?: Readonly<Record<string, unknown>>;
  };
  readonly compareRightProjectionKind?: string;
};

export type FrontendKnowledgeProjectionContractFixture = {
  readonly name: string;
  readonly createPort: () => KnowledgeWorkspaceProjectionPort;
  readonly scope: ActiveScope;
  readonly requests: {
    readonly workspace: KnowledgeWorkspaceRequest;
    readonly pageList: KnowledgePageListRequest;
    readonly search: KnowledgeSearchRequest;
    readonly detail: KnowledgeDetailRequest;
    readonly compare: KnowledgeCompareRequest;
  };
  readonly expected?: ContractExpectedViews;
  readonly getExpected?: () => Promise<ContractExpectedViews>;
  readonly expectations?: ContractExpectations;
};

const notFoundScope = (scope: ActiveScope): ActiveScope => ({
  ...scope,
  activeProject: {
    ...scope.activeProject,
    id: 'project-outside-scope',
  },
  accessibleProjects: [
    {
      ...scope.activeProject,
      id: 'project-outside-scope',
    },
  ],
});

export const defineFrontendKnowledgeProjectionContract = (
  fixture: FrontendKnowledgeProjectionContractFixture,
): void => {
  const resolveExpected = async (): Promise<ContractExpectedViews> => {
    if (fixture.getExpected) return fixture.getExpected();
    if (fixture.expected) return fixture.expected;
    throw new Error(`${fixture.name} must provide expected views or getExpected.`);
  };

  describe(`${fixture.name} KnowledgeWorkspaceProjectionPort contract`, () => {
    it('serves all five read methods from one server-authorized Project scope', async () => {
      const expected = await resolveExpected();
      const port = fixture.createPort();
      await expect(
        port.getWorkspace({ ...fixture.scope, request: fixture.requests.workspace }),
      ).resolves.toEqual(expected.workspace);
      await expect(
        port.listPages({ ...fixture.scope, request: fixture.requests.pageList }),
      ).resolves.toEqual(expected.pageList);
      await expect(
        port.search({ ...fixture.scope, request: fixture.requests.search }),
      ).resolves.toEqual(expected.search);
      await expect(
        port.getDetail({ ...fixture.scope, request: fixture.requests.detail }),
      ).resolves.toEqual(expected.detail);
      await expect(
        port.compare({ ...fixture.scope, request: fixture.requests.compare }),
      ).resolves.toEqual(expected.compare);
    });

    it('keeps seed-owned identity, pre-ranked order, and opaque cursor pagination stable', async () => {
      const expected = await resolveExpected();
      const port = fixture.createPort();
      const expectedPageIds = [expected.detail.page.pageId, expected.compare.right.pageId];
      const expectedSearchMatchIds = expected.search.matches.map((match) => match.matchId);
      const firstPageRequest = {
        ...fixture.requests.pageList,
        pageSize: 1,
      } satisfies KnowledgePageListRequest;
      const firstPage = await port.listPages({ ...fixture.scope, request: firstPageRequest });
      const repeatedFirstPage = await port.listPages({
        ...fixture.scope,
        request: firstPageRequest,
      });
      expect(repeatedFirstPage).toEqual(firstPage);
      expect(firstPage.pages.map((page) => page.pageId)).toEqual([expectedPageIds[0]]);
      if (fixture.expectations?.pageCursor === null) {
        expect(firstPage.nextCursor).toEqual(expect.any(String));
      } else {
        expect(firstPage.nextCursor).toBe(fixture.expectations?.pageCursor ?? 'page-cursor-1');
      }

      const secondPage = await port.listPages({
        ...fixture.scope,
        request: {
          ...firstPageRequest,
          cursor: firstPage.nextCursor,
        },
      });
      expect(secondPage.pages.map((page) => page.pageId)).toEqual([expectedPageIds[1]]);
      expect(secondPage.nextCursor).toBeUndefined();

      const firstSearch = await port.search({
        ...fixture.scope,
        request: { ...fixture.requests.search, pageSize: 2 },
      });
      const repeatedSearch = await port.search({
        ...fixture.scope,
        request: { ...fixture.requests.search, pageSize: 2 },
      });
      expect(repeatedSearch).toEqual(firstSearch);
      expect(firstSearch.matches.map((match) => match.matchId)).toEqual(
        expectedSearchMatchIds.slice(0, 2),
      );
      if (fixture.expectations?.searchCursor === null) {
        expect(firstSearch.nextCursor).toEqual(expect.any(String));
      } else {
        expect(firstSearch.nextCursor).toBe(
          fixture.expectations?.searchCursor ?? 'search-cursor-2',
        );
      }
      const secondSearch = await port.search({
        ...fixture.scope,
        request: {
          ...fixture.requests.search,
          pageSize: 2,
          cursor: firstSearch.nextCursor,
        },
      });
      expect(secondSearch.matches.map((match) => match.matchId)).toEqual(
        expectedSearchMatchIds.slice(2, 4),
      );
      expect(secondSearch.nextCursor).toBeUndefined();
    });

    it('preserves all authorities, typed kinds, projection states, Evidence pins, and lineage', async () => {
      const expected = await resolveExpected();
      const pageOne = expected.detail.page;
      const pageTwo = expected.compare.right;
      const items = [...pageOne.items, ...pageTwo.items];
      expect(new Set(items.map((item) => item.authority))).toEqual(
        new Set(
          fixture.expectations?.authorities ?? [
            'CANONICAL',
            'APPROVED_KNOWLEDGE',
            'COMPILED_TRUTH',
            'DERIVED_INFERENCE',
          ],
        ),
      );
      const canonical = items.find((item) => item.authority === 'CANONICAL');
      expect(canonical?.lineage.canonicalResourceId).toBe(
        fixture.expectations?.canonicalLineage?.canonicalResourceId ?? 'canonical-claim-1',
      );
      const expectedEvidenceTarget = fixture.expectations?.canonicalLineage?.evidenceTarget;
      if (expectedEvidenceTarget) {
        expect(canonical?.evidenceTargets?.[0]).toMatchObject(expectedEvidenceTarget);
      } else {
        expect(canonical?.evidenceTargets?.[0]).toMatchObject({
          resourceId: 'resource-1',
          resourceRevision: 'resource-revision-1',
          focusId: 'item-canonical-1',
          sourceId: 'source-1',
          sourceVersionId: 'source-version-1',
          evidenceId: 'evidence-1',
        });
      }
      const projections = items
        .map((item) => item.lineage.projection?.status)
        .filter((status): status is NonNullable<typeof status> => status !== undefined);
      expect(new Set(projections)).toEqual(
        new Set(
          fixture.expectations?.projectionStatuses ?? ['READY', 'STALE', 'DEGRADED', 'NOT_BUILT'],
        ),
      );
      expect(expected.workspace.projection.projectionKind).toBe('CANONICAL_SEARCH');
      expect(pageTwo.projection.projectionKind).toBe(
        fixture.expectations?.compareRightProjectionKind ?? 'COMPILED_TRUTH',
      );
      expect(
        items.some(
          (item) =>
            item.authority === 'COMPILED_TRUTH' && item.lineage.canonicalResourceId === undefined,
        ),
      ).toBe(true);
      expect(
        items.some(
          (item) =>
            item.authority === 'DERIVED_INFERENCE' && item.lineage.projectionId !== undefined,
        ),
      ).toBe(true);
    });

    it('applies only the server-defined authority, kind, temporal, projection, and resource filters', async () => {
      const expected = await resolveExpected();
      const port = fixture.createPort();
      const canonical = await port.search({
        ...fixture.scope,
        request: {
          ...fixture.requests.search,
          filters: { authorities: ['CANONICAL'] },
        },
      });
      expect(canonical.matches.map((match) => match.matchId)).toEqual(
        expected.search.matches
          .filter((match) => match.item.authority === 'CANONICAL')
          .map((match) => match.matchId),
      );

      const expectedNotBuiltMatchIds = expected.search.matches
        .filter(
          (match) =>
            match.item.lineage.projection?.status === 'NOT_BUILT' &&
            match.item.kind === 'KNOWLEDGE_GAP' &&
            match.item.temporalState === 'FUTURE',
        )
        .map((match) => match.matchId);
      if (expectedNotBuiltMatchIds.length > 0) {
        const notBuilt = await port.search({
          ...fixture.scope,
          request: {
            ...fixture.requests.search,
            filters: {
              projectionStatuses: ['NOT_BUILT'],
              kinds: ['KNOWLEDGE_GAP'],
              temporalStates: ['FUTURE'],
            },
          },
        });
        expect(notBuilt.matches.map((match) => match.matchId)).toEqual(expectedNotBuiltMatchIds);
      }

      const resourceFilter =
        fixture.expectations?.resourceFilter ??
        (() => {
          const grouped = new Map<string, string[]>();
          for (const match of expected.search.matches) {
            const ids = grouped.get(match.resourceId) ?? [];
            ids.push(match.matchId);
            grouped.set(match.resourceId, ids);
          }
          const entry = [...grouped.entries()].find(([, ids]) => ids.length >= 2);
          return entry ? { resourceId: entry[0], matchIds: entry[1] } : undefined;
        })();
      if (resourceFilter) {
        const resource = await port.search({
          ...fixture.scope,
          request: { ...fixture.requests.search, resourceId: resourceFilter.resourceId },
        });
        expect(resource.matches.map((match) => match.matchId)).toEqual(resourceFilter.matchIds);
      }
    });

    it('masks cross-Project and inaccessible reads as NOT_FOUND and rejects stale pins', async () => {
      const port = fixture.createPort();
      await expect(
        port.getDetail({ ...notFoundScope(fixture.scope), request: fixture.requests.detail }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        port.getDetail({
          ...fixture.scope,
          accessibleProjects: [],
          request: fixture.requests.detail,
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        port.getDetail({
          ...fixture.scope,
          request: {
            ...fixture.requests.detail,
            requestedRevision: 'resource-revision-revoked',
          },
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        port.getDetail({
          ...fixture.scope,
          request: { ...fixture.requests.detail, focusId: 'focus-revoked' },
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('keeps compare read-only, ordered, exactly two-page, and free of write capabilities', async () => {
      const expected = await resolveExpected();
      const port = fixture.createPort();
      const compare = await port.compare({
        ...fixture.scope,
        request: fixture.requests.compare,
      });
      expect(compare.left.pageId).toBe(expected.compare.left.pageId);
      expect(compare.right.pageId).toBe(expected.compare.right.pageId);
      expect(compare.left.pageId).not.toBe(compare.right.pageId);
      expect(compare.projectId).toBe(fixture.scope.activeProject.id);
      const publicNames = Object.getOwnPropertyNames(Object.getPrototypeOf(port)).filter(
        (name) => name !== 'constructor',
      );
      expect(publicNames.some((name) => /write|approve|commit|action/i.test(name))).toBe(false);
      expect(
        Object.values(port).some(
          (value) => typeof value === 'function' && /write|approve|commit/i.test(value.name),
        ),
      ).toBe(false);
    });

    it('rejects malformed requests without promoting a projection into Canonical authority', async () => {
      const expected = await resolveExpected();
      const port = fixture.createPort();
      await expect(
        port.listPages({
          ...fixture.scope,
          request: {
            ...fixture.requests.pageList,
            pageSize: 101,
          } as KnowledgePageListRequest,
        }),
      ).rejects.toBeInstanceOf(FrontendContractError);
      await expect(
        port.listPages({
          ...fixture.scope,
          request: { ...fixture.requests.pageList, cursor: 'unknown-cursor' },
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      const compiled = expected.compare.right.items.find(
        (item) => item.authority === 'COMPILED_TRUTH',
      );
      expect(compiled?.authority).toBe('COMPILED_TRUTH');
      expect(compiled?.lineage.projectionId).toBeDefined();
      expect(compiled?.lineage.canonicalResourceId).toBeUndefined();
    });
  });
};
