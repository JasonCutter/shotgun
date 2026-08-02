import { describe, expect, it, vi } from 'vitest';

import {
  FrontendProductReadCoordinator,
  type FrontendReadScope,
  type KnowledgeWorkspaceProjectionPort,
} from '../../modules/frontend-product-read/src/index.js';
import {
  FrontendContractError,
  KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  type KnowledgeCompareRequest,
  type KnowledgeCompareView,
  type KnowledgeDetailRequest,
  type KnowledgeDetailView,
  type KnowledgePageListRequest,
  type KnowledgePageListView,
  type KnowledgePageView,
  type KnowledgeProjectionStatusView,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResultView,
  type KnowledgeWorkspaceRequest,
  type KnowledgeWorkspaceView,
} from '../../packages/contracts/src/index.js';

const now = '2026-08-02T08:00:00.000Z';

type ActiveScope = FrontendReadScope & {
  readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
};

const scope: ActiveScope = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Project One',
    isOwner: true,
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Project One',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  accessRevision: 'access-revision-1',
  policyContextRevision: 'policy-revision-1',
};

const searchProjection: KnowledgeProjectionStatusView = {
  projectionKind: 'CANONICAL_SEARCH',
  status: 'READY',
  canonicalVersion: 7,
  projectedCanonicalVersion: 7,
  lag: 0,
  projectionRevision: 'search-revision-7',
  updatedAt: now,
};

const makePage = (pageId: string, resourceId: string, revision: string): KnowledgePageView => ({
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  pageId,
  projectId: 'project-1',
  resourceId,
  revision,
  focusId: `focus-${pageId}`,
  title: `Knowledge page ${pageId}`,
  items: [],
  lineage: {
    projectId: 'project-1',
    productId: pageId,
    resourceRevision: revision,
    canonicalVersion: 7,
  },
  projection: searchProjection,
  capabilities: ['READ', 'COMPARE'],
  fetchedAt: now,
});

const pageOne = makePage('page-1', 'resource-1', 'resource-revision-1');
const pageTwo = makePage('page-2', 'resource-2', 'resource-revision-2');

const workspace: KnowledgeWorkspaceView = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  principalId: scope.principalId,
  sessionId: scope.sessionId,
  projectId: 'project-1',
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  pages: [
    {
      pageId: pageOne.pageId,
      projectId: pageOne.projectId,
      resourceId: pageOne.resourceId,
      revision: pageOne.revision,
      title: pageOne.title,
      primaryAuthority: 'CANONICAL',
      primaryKind: 'CLAIM',
      projection: searchProjection,
    },
  ],
  projection: searchProjection,
  capabilities: ['READ', 'SEARCH', 'FILTER'],
  fetchedAt: now,
};

const pageList: KnowledgePageListView = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  projectId: 'project-1',
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  pages: workspace.pages,
  nextCursor: 'cursor-2',
  projection: searchProjection,
  fetchedAt: now,
};

const searchResult: KnowledgeSearchResultView = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  projectId: 'project-1',
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  query: 'canonical',
  matches: [],
  projection: searchProjection,
  fetchedAt: now,
};

const detail: KnowledgeDetailView = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  resourceId: pageOne.resourceId,
  revision: pageOne.revision,
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  focusId: pageOne.focusId,
  page: pageOne,
  fetchedAt: now,
};

const compare: KnowledgeCompareView = {
  schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
  projectId: 'project-1',
  accessRevision: scope.accessRevision,
  policyContextRevision: scope.policyContextRevision,
  left: pageOne,
  right: pageTwo,
  differences: [],
  projection: searchProjection,
  capabilities: ['READ', 'COMPARE'],
  fetchedAt: now,
};

const requests = {
  workspace: {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    resourceId: pageOne.resourceId,
    focusId: pageOne.focusId,
  } satisfies KnowledgeWorkspaceRequest,
  list: {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    cursor: 'cursor-1',
  } satisfies KnowledgePageListRequest,
  search: {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    query: 'canonical',
  } satisfies KnowledgeSearchRequest,
  detail: {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    resourceId: pageOne.resourceId,
    requestedRevision: pageOne.revision,
    focusId: pageOne.focusId,
  } satisfies KnowledgeDetailRequest,
  compare: {
    schemaVersion: KNOWLEDGE_WORKSPACE_SCHEMA_VERSION,
    pageIds: [pageOne.pageId, pageTwo.pageId],
  } satisfies KnowledgeCompareRequest,
};

const createPort = (
  responses: {
    readonly workspace?: unknown;
    readonly pageList?: unknown;
    readonly search?: unknown;
    readonly detail?: unknown;
    readonly compare?: unknown;
  } = {},
): KnowledgeWorkspaceProjectionPort => ({
  getWorkspace: vi.fn(async () => (responses.workspace ?? workspace) as KnowledgeWorkspaceView),
  listPages: vi.fn(async () => (responses.pageList ?? pageList) as KnowledgePageListView),
  search: vi.fn(async () => (responses.search ?? searchResult) as KnowledgeSearchResultView),
  getDetail: vi.fn(async () => (responses.detail ?? detail) as KnowledgeDetailView),
  compare: vi.fn(async () => (responses.compare ?? compare) as KnowledgeCompareView),
});

const createCoordinator = (knowledgePort?: KnowledgeWorkspaceProjectionPort) =>
  new FrontendProductReadCoordinator(
    { getShell: vi.fn() },
    { getHome: vi.fn() },
    { getSummary: vi.fn() },
    { getSummary: vi.fn() },
    { search: vi.fn() },
    { decide: vi.fn() },
    undefined,
    knowledgePort,
  );

describe('Frontend Knowledge Product Read coordinator boundary', () => {
  it('passes scope and request to all five methods and re-decodes every response', async () => {
    const port = createPort();
    const coordinator = createCoordinator(port);

    await expect(
      coordinator.getKnowledgeWorkspace({ ...scope, request: requests.workspace }),
    ).resolves.toEqual(workspace);
    await expect(
      coordinator.listKnowledgePages({ ...scope, request: requests.list }),
    ).resolves.toEqual(pageList);
    await expect(
      coordinator.searchKnowledge({ ...scope, request: requests.search }),
    ).resolves.toEqual(searchResult);
    await expect(
      coordinator.getKnowledgeDetail({ ...scope, request: requests.detail }),
    ).resolves.toEqual(detail);
    await expect(
      coordinator.compareKnowledgePages({ ...scope, request: requests.compare }),
    ).resolves.toEqual(compare);

    expect(port.getWorkspace).toHaveBeenCalledWith({ ...scope, request: requests.workspace });
    expect(port.listPages).toHaveBeenCalledWith({ ...scope, request: requests.list });
    expect(port.search).toHaveBeenCalledWith({ ...scope, request: requests.search });
    expect(port.getDetail).toHaveBeenCalledWith({ ...scope, request: requests.detail });
    expect(port.compare).toHaveBeenCalledWith({ ...scope, request: requests.compare });
  });

  it('fails explicitly when the Knowledge Port is not configured', async () => {
    const coordinator = createCoordinator();

    await expect(
      coordinator.getKnowledgeWorkspace({ ...scope, request: requests.workspace }),
    ).rejects.toThrow('KnowledgeWorkspaceProjectionPort is not configured.');
  });

  it('rejects a missing active Project before invoking the Port', async () => {
    const port = createPort();
    const coordinator = createCoordinator(port);
    const input = { ...scope, activeProject: null, request: requests.workspace } as never;

    await expect(coordinator.getKnowledgeWorkspace(input)).rejects.toThrow(
      'Knowledge operations require an active Project.',
    );
    expect(port.getWorkspace).not.toHaveBeenCalled();
  });

  it('rejects malformed and forbidden-capability responses through strict decoders', async () => {
    const malformedPort = createPort({ workspace: { ...workspace, unexpected: true } });
    await expect(
      createCoordinator(malformedPort).getKnowledgeWorkspace({
        ...scope,
        request: requests.workspace,
      }),
    ).rejects.toBeInstanceOf(FrontendContractError);

    const forbiddenPort = createPort({
      workspace: { ...workspace, capabilities: ['READ', 'COMMIT'] },
    });
    await expect(
      createCoordinator(forbiddenPort).getKnowledgeWorkspace({
        ...scope,
        request: requests.workspace,
      }),
    ).rejects.toBeInstanceOf(FrontendContractError);
  });

  it('rejects workspace principal, session, Project, access, and policy mismatches', async () => {
    const cases = [
      ['principal', { ...workspace, principalId: 'other-principal' }, 'principal'],
      ['session', { ...workspace, sessionId: 'other-session' }, 'session'],
      ['Project', { ...workspace, projectId: 'project-2' }, 'project'],
      ['access revision', { ...workspace, accessRevision: 'access-2' }, 'access revision'],
      ['policy revision', { ...workspace, policyContextRevision: 'policy-2' }, 'policy context'],
    ] as const;

    for (const [, response, reason] of cases) {
      const port = createPort({ workspace: response });
      await expect(
        createCoordinator(port).getKnowledgeWorkspace({
          ...scope,
          request: requests.workspace,
        }),
      ).rejects.toThrow(reason);
    }
  });

  it('rejects search query mismatches and preserves the Search readiness boundary', async () => {
    const queryMismatchPort = createPort({ search: { ...searchResult, query: 'other query' } });
    await expect(
      createCoordinator(queryMismatchPort).searchKnowledge({
        ...scope,
        request: requests.search,
      }),
    ).rejects.toThrow('search query');

    const compiledProjectionPort = createPort({
      search: {
        ...searchResult,
        projection: { ...searchProjection, projectionKind: 'COMPILED_TRUTH' },
      },
    });
    await expect(
      createCoordinator(compiledProjectionPort).searchKnowledge({
        ...scope,
        request: requests.search,
      }),
    ).rejects.toBeInstanceOf(FrontendContractError);
  });

  it('rejects detail resource, revision, focus, and page identity mismatches', async () => {
    const cases = [
      ['resource', { ...detail, resourceId: 'resource-2' }, 'detail resource'],
      [
        'revision',
        { ...detail, revision: 'revision-2', page: makePage('page-1', 'resource-1', 'revision-2') },
        'detail revision',
      ],
      [
        'focus',
        { ...detail, focusId: 'focus-other', page: { ...pageOne, focusId: 'focus-other' } },
        'detail focus',
      ],
      ['page identity', { ...detail, page: pageTwo }, 'detail resource'],
    ] as const;

    for (const [, response, reason] of cases) {
      const port = createPort({ detail: response });
      await expect(
        createCoordinator(port).getKnowledgeDetail({
          ...scope,
          request: requests.detail,
        }),
      ).rejects.toThrow(reason);
    }
  });

  it('rejects compare page order and Project identity mismatches', async () => {
    const orderPort = createPort({ compare: { ...compare, left: pageTwo, right: pageOne } });
    await expect(
      createCoordinator(orderPort).compareKnowledgePages({
        ...scope,
        request: requests.compare,
      }),
    ).rejects.toThrow('left compare page');

    const projectPage = { ...pageTwo, projectId: 'project-2' };
    const projectPort = createPort({ compare: { ...compare, right: projectPage } });
    await expect(
      createCoordinator(projectPort).compareKnowledgePages({
        ...scope,
        request: requests.compare,
      }),
    ).rejects.toBeInstanceOf(FrontendContractError);
  });
});
