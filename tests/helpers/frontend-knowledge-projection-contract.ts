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
  KnowledgeSearchResultView,
  KnowledgeWorkspaceRequest,
  KnowledgeWorkspaceView,
} from '../../packages/contracts/src/index.js';
import { FrontendContractError } from '../../packages/contracts/src/index.js';

type ActiveScope = FrontendReadScope & {
  readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
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
  readonly expected: {
    readonly workspace: KnowledgeWorkspaceView;
    readonly pageList: KnowledgePageListView;
    readonly search: KnowledgeSearchResultView;
    readonly detail: KnowledgeDetailView;
    readonly compare: KnowledgeCompareView;
  };
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
  describe(`${fixture.name} KnowledgeWorkspaceProjectionPort contract`, () => {
    it('serves all five read methods from one server-authorized Project scope', async () => {
      const port = fixture.createPort();
      await expect(
        port.getWorkspace({ ...fixture.scope, request: fixture.requests.workspace }),
      ).resolves.toEqual(fixture.expected.workspace);
      await expect(
        port.listPages({ ...fixture.scope, request: fixture.requests.pageList }),
      ).resolves.toEqual(fixture.expected.pageList);
      await expect(
        port.search({ ...fixture.scope, request: fixture.requests.search }),
      ).resolves.toEqual(fixture.expected.search);
      await expect(
        port.getDetail({ ...fixture.scope, request: fixture.requests.detail }),
      ).resolves.toEqual(fixture.expected.detail);
      await expect(
        port.compare({ ...fixture.scope, request: fixture.requests.compare }),
      ).resolves.toEqual(fixture.expected.compare);
    });

    it('keeps seed-owned identity, pre-ranked order, and opaque cursor pagination stable', async () => {
      const port = fixture.createPort();
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
      expect(firstPage.pages.map((page) => page.pageId)).toEqual(['page-1']);
      expect(firstPage.nextCursor).toBe('page-cursor-1');

      const secondPage = await port.listPages({
        ...fixture.scope,
        request: {
          ...firstPageRequest,
          cursor: firstPage.nextCursor,
        },
      });
      expect(secondPage.pages.map((page) => page.pageId)).toEqual(['page-2']);
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
      expect(firstSearch.matches.map((match) => match.matchId)).toEqual([
        'match-canonical',
        'match-approved',
      ]);
      expect(firstSearch.nextCursor).toBe('search-cursor-2');
      const secondSearch = await port.search({
        ...fixture.scope,
        request: {
          ...fixture.requests.search,
          pageSize: 2,
          cursor: firstSearch.nextCursor,
        },
      });
      expect(secondSearch.matches.map((match) => match.matchId)).toEqual([
        'match-compiled',
        'match-derived',
      ]);
      expect(secondSearch.nextCursor).toBeUndefined();
    });

    it('preserves all authorities, typed kinds, projection states, Evidence pins, and lineage', async () => {
      const pageOne = fixture.expected.detail.page;
      const pageTwo = fixture.expected.compare.right;
      const items = [...pageOne.items, ...pageTwo.items];
      expect(new Set(items.map((item) => item.authority))).toEqual(
        new Set(['CANONICAL', 'APPROVED_KNOWLEDGE', 'COMPILED_TRUTH', 'DERIVED_INFERENCE']),
      );
      const canonical = items.find((item) => item.authority === 'CANONICAL');
      expect(canonical?.lineage.canonicalResourceId).toBe('canonical-claim-1');
      expect(canonical?.evidenceTargets?.[0]).toMatchObject({
        resourceId: 'resource-1',
        resourceRevision: 'resource-revision-1',
        focusId: 'item-canonical-1',
        sourceId: 'source-1',
        sourceVersionId: 'source-version-1',
        evidenceId: 'evidence-1',
      });
      const projections = items
        .map((item) => item.lineage.projection?.status)
        .filter((status): status is NonNullable<typeof status> => status !== undefined);
      expect(new Set(projections)).toEqual(new Set(['READY', 'STALE', 'DEGRADED', 'NOT_BUILT']));
      expect(fixture.expected.workspace.projection.projectionKind).toBe('CANONICAL_SEARCH');
      expect(pageTwo.projection.projectionKind).toBe('COMPILED_TRUTH');
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
      const port = fixture.createPort();
      const canonical = await port.search({
        ...fixture.scope,
        request: {
          ...fixture.requests.search,
          filters: { authorities: ['CANONICAL'] },
        },
      });
      expect(canonical.matches.map((match) => match.matchId)).toEqual(['match-canonical']);

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
      expect(notBuilt.matches.map((match) => match.matchId)).toEqual(['match-derived']);

      const resource = await port.search({
        ...fixture.scope,
        request: { ...fixture.requests.search, resourceId: 'resource-2' },
      });
      expect(resource.matches.map((match) => match.resourceId)).toEqual([
        'resource-2',
        'resource-2',
      ]);
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
      const port = fixture.createPort();
      const compare = await port.compare({
        ...fixture.scope,
        request: fixture.requests.compare,
      });
      expect(compare.left.pageId).toBe('page-1');
      expect(compare.right.pageId).toBe('page-2');
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
      const compiled = fixture.expected.compare.right.items.find(
        (item) => item.authority === 'COMPILED_TRUTH',
      );
      expect(compiled?.authority).toBe('COMPILED_TRUTH');
      expect(compiled?.lineage.projectionId).toBeDefined();
      expect(compiled?.lineage.canonicalResourceId).toBeUndefined();
    });
  });
};
