import {
  ASK_SCHEMA_VERSION,
  FrontendContractError,
  ShotgunError,
  decodeAskAnswerRunSnapshot,
  decodeAskBranchView,
  decodeAskConversationView,
  decodeAskWorkspaceView,
  decodeGlobalSearchResultView,
  decodeHomeActionCenterView,
  decodeKnowledgeCompareRequest,
  decodeKnowledgeCompareView,
  decodeKnowledgeDetailRequest,
  decodeKnowledgeDetailView,
  decodeKnowledgePageListRequest,
  decodeKnowledgePageListView,
  decodeKnowledgePageView,
  decodeKnowledgeSearchRequest,
  decodeKnowledgeSearchResultView,
  decodeKnowledgeWorkspaceRequest,
  decodeKnowledgeWorkspaceView,
  decodeRouteGuardDecisionView,
  type AskAnswerRunSnapshot,
  type AskBranchView,
  type AskConversationView,
  type AskMode,
  type AskWorkspaceView,
  type GlobalSearchResultView,
  type GlobalShellView,
  type HomeActionCenterView,
  type KnowledgeCompareRequest,
  type KnowledgeCompareView,
  type KnowledgeDetailRequest,
  type KnowledgeDetailView,
  type KnowledgeFilter,
  type KnowledgePageListRequest,
  type KnowledgePageListView,
  type KnowledgePageSummaryView,
  type KnowledgePageView,
  type KnowledgeSearchMatchView,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResultView,
  type KnowledgeWorkspaceRequest,
  type KnowledgeWorkspaceView,
  type TargetRouteView,
} from '../../../packages/contracts/src/index.js';
import type {
  ActionCenterProjectionPort,
  AskWorkspaceProjectionPort,
  BackgroundSummaryProjectionPort,
  FrontendReadScope,
  GlobalSearchPort,
  GlobalShellProjectionPort,
  KnowledgeWorkspaceProjectionPort,
  NotificationSummaryProjectionPort,
  RouteGuardProjectionPort,
} from '../../../modules/frontend-product-read/src/index.js';

const now = (): string => new Date().toISOString();

const routes = {
  home: { routeId: 'home', href: '/' },
  sources: { routeId: 'sources', href: '/sources' },
  ask: { routeId: 'ask', href: '/ask' },
  knowledge: { routeId: 'knowledge', href: '/knowledge' },
  review: { routeId: 'review', href: '/review' },
  externalAction: { routeId: 'external-action', href: '/external-action' },
  activity: { routeId: 'activity', href: '/activity' },
  history: { routeId: 'history', href: '/history' },
} as const satisfies Record<string, TargetRouteView>;

export class InMemoryGlobalShellProjection implements GlobalShellProjectionPort {
  async getShell(
    input: FrontendReadScope,
  ): Promise<Omit<GlobalShellView, 'background' | 'notifications'>> {
    const projectReady = input.activeProject !== null;
    return {
      schemaVersion: '1.0.0',
      principalId: input.principalId,
      sessionId: input.sessionId,
      activeProject: input.activeProject,
      accessibleProjects: input.accessibleProjects,
      navigation: projectReady
        ? [
            {
              id: 'home',
              label: 'Home',
              availability: 'AVAILABLE',
              targetRoute: routes.home,
            },
            {
              id: 'sources',
              label: 'Sources',
              availability: 'AVAILABLE',
              targetRoute: routes.sources,
            },
            {
              id: 'ask',
              label: 'Ask',
              availability: 'AVAILABLE',
              targetRoute: routes.ask,
            },
          ]
        : [],
      features: [
        {
          id: 'global-search',
          label: 'Global Search',
          availability: projectReady ? 'AVAILABLE' : 'TEMPORARILY_UNAVAILABLE',
          ...(projectReady ? {} : { reason: 'Create a Project to search.' }),
        },
        {
          id: 'command-palette',
          label: 'Command Palette',
          availability: 'AVAILABLE',
        },
        {
          id: 'cross-project-search',
          label: 'Cross-project Search',
          availability: input.accessibleProjects.length > 1 ? 'AVAILABLE' : 'HIDDEN',
          ...(input.accessibleProjects.length > 1
            ? {}
            : { reason: 'More than one accessible Project is required.' }),
        },
      ],
      readiness: [
        { kind: 'SESSION_READY', ready: true, required: true },
        {
          kind: 'PROJECT_READY',
          ready: projectReady,
          required: true,
          ...(projectReady ? {} : { message: 'Create your first Project.' }),
        },
        { kind: 'PRIVACY_READY', ready: projectReady, required: true },
        { kind: 'MODEL_READY', ready: projectReady, required: true },
        { kind: 'STORAGE_READY', ready: true, required: true },
        { kind: 'WORKER_READY', ready: true, required: false },
        { kind: 'OPTIONAL_CONNECTOR_READY', ready: false, required: false },
      ],
      ...(!projectReady
        ? {
            leadingWarning: {
              code: 'PROJECT_SETUP_REQUIRED',
              severity: 'INFO',
              message: 'Create your first Project to continue.',
              additionalCount: 0,
            },
          }
        : {}),
      accessRevision: input.accessRevision,
      policyContextRevision: input.policyContextRevision,
      projectionRevision: `shell-${input.accessRevision}-${input.policyContextRevision}`,
      fetchedAt: now(),
    } as Omit<GlobalShellView, 'background' | 'notifications'>;
  }
}

export class InMemoryActionCenterProjection implements ActionCenterProjectionPort {
  async getHome(
    input: FrontendReadScope & {
      readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
    },
  ): Promise<HomeActionCenterView> {
    const unavailable = (
      id: 'add-source' | 'ask' | 'explore-knowledge' | 'review-changes',
      label: string,
      targetRoute: TargetRouteView,
    ) => ({
      id,
      label,
      availability: 'COMING_LATER' as const,
      disabledReason: 'The owning workspace is not implemented in this Section.',
      targetRoute,
    });
    return decodeHomeActionCenterView({
      schemaVersion: '1.0.0',
      principalId: input.principalId,
      sessionId: input.sessionId,
      activeProject: input.activeProject,
      projectState: { lifecycle: 'ACTIVE', message: 'Project is ready.' },
      primaryActions: [
        {
          id: 'add-source',
          label: 'Add source',
          availability: 'AVAILABLE',
          targetRoute: routes.sources,
        },
        {
          id: 'ask',
          label: 'Ask',
          availability: 'AVAILABLE',
          targetRoute: routes.ask,
        },
        // AC-18: high-risk External Actions are never executed from Home; the
        // entry navigates to the governance workspace only.
        {
          id: 'govern-external-action',
          label: 'External actions',
          availability: 'AVAILABLE',
          targetRoute: routes.externalAction,
        },
        unavailable('explore-knowledge', 'Explore knowledge', routes.knowledge),
        unavailable('review-changes', 'Review changes', routes.review),
      ],
      attention: [],
      continueWorking: [],
      recent: [],
      pinned: [],
      operationalSummary: {
        activeBackgroundCount: 0,
        failedBackgroundCount: 0,
        unreadNotificationCount: 0,
      },
      stale: false,
      accessRevision: input.accessRevision,
      policyContextRevision: input.policyContextRevision,
      projectionRevision: `home-${input.activeProject.id}-${input.accessRevision}`,
      fetchedAt: now(),
    });
  }
}

export class InMemoryBackgroundSummaryProjection implements BackgroundSummaryProjectionPort {
  async getSummary(): Promise<GlobalShellView['background']> {
    return { activeCount: 0, failedCount: 0 };
  }
}

export class InMemoryNotificationSummaryProjection implements NotificationSummaryProjectionPort {
  async getSummary(input: FrontendReadScope): Promise<GlobalShellView['notifications']> {
    return {
      unreadCount: 0,
      presentationRevision: `notifications-${input.principalId}-0`,
    };
  }
}

export class InMemoryGlobalSearch implements GlobalSearchPort {
  async search(input: Parameters<GlobalSearchPort['search']>[0]): Promise<GlobalSearchResultView> {
    return decodeGlobalSearchResultView({
      schemaVersion: '1.0.0',
      scope: input.request.scope.kind,
      results: [],
      projectionRevision: `search-${input.accessRevision}`,
      fetchedAt: now(),
    });
  }
}

export class InMemoryRouteGuardProjection implements RouteGuardProjectionPort {
  async decide(
    input: Parameters<RouteGuardProjectionPort['decide']>[0],
  ): Promise<ReturnType<RouteGuardProjectionPort['decide']> extends Promise<infer T> ? T : never> {
    const resourceProject = input.resourceProjectId
      ? input.accessibleProjects.find((project) => project.id === input.resourceProjectId)
      : undefined;
    const workspaceAvailable = new Set([
      'home',
      'sources',
      'ask',
      'settings',
      'settings-projects',
      'external-action',
      'activity',
      'history',
    ]).has(input.requestedRoute.routeId);
    return decodeRouteGuardDecisionView({
      schemaVersion: '1.0.0',
      decision:
        input.resourceProjectId && !resourceProject
          ? 'NOT_FOUND'
          : !workspaceAvailable
            ? 'FEATURE_UNAVAILABLE'
            : input.requestedRoute.routeId === 'home' && !input.activeProject
              ? 'PROJECT_UNAVAILABLE'
              : 'ALLOW',
      ...(workspaceAvailable &&
      !(input.requestedRoute.routeId === 'home' && !input.activeProject) &&
      (!input.resourceProjectId || resourceProject)
        ? { targetRoute: input.requestedRoute }
        : {}),
      ...(resourceProject
        ? { resourceProject: { id: resourceProject.id, label: resourceProject.label } }
        : {}),
      ...(input.activeProject ? { activeProjectId: input.activeProject.id } : {}),
      masked: Boolean(input.resourceProjectId && !resourceProject),
      message:
        input.resourceProjectId && !resourceProject
          ? 'The resource was not found.'
          : workspaceAvailable
            ? 'Route decision completed.'
            : 'The requested workspace is not available in this Section.',
      accessRevision: input.accessRevision,
      policyContextRevision: input.policyContextRevision,
    });
  }
}

export class InMemoryAskWorkspaceProjection implements AskWorkspaceProjectionPort {
  private readonly conversations = new Map<string, AskConversationView>();
  private readonly answerRuns = new Map<string, AskAnswerRunSnapshot>();

  constructor(
    private readonly availableAskModes: readonly AskMode[] = ['CANONICAL_ONLY', 'HYBRID'],
  ) {}

  addConversation(conversation: AskConversationView): void {
    this.conversations.set(conversation.conversationId, conversation);
    for (const branch of conversation.branches) {
      for (const turn of branch.turns) {
        this.answerRuns.set(turn.answerRun.answerRunId, turn.answerRun);
      }
    }
  }

  addAnswerRun(answerRun: AskAnswerRunSnapshot): void {
    this.answerRuns.set(answerRun.answerRunId, answerRun);
  }

  async getWorkspace(
    input: FrontendReadScope & { readonly conversationId?: string },
  ): Promise<AskWorkspaceView> {
    let targetProjectId: string | undefined;
    let selectedConversation: AskConversationView | undefined;

    if (input.conversationId) {
      const candidate = this.conversations.get(input.conversationId);
      const isAccessible =
        candidate && input.accessibleProjects.some((project) => project.id === candidate.projectId);
      if (!candidate || !isAccessible) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'The requested conversation was not found.',
          module: 'frontend-product-read',
          operation: 'get-ask-workspace',
        });
      }
      selectedConversation = candidate;
      targetProjectId = candidate.projectId;
    } else {
      if (!input.activeProject) {
        throw new ShotgunError({
          code: 'NOT_FOUND',
          safeMessage: 'An active project is required to access Ask workspace.',
          module: 'frontend-product-read',
          operation: 'get-ask-workspace',
        });
      }
      targetProjectId = input.activeProject.id;
    }

    const resourceAuthority = input.conversationId
      ? input.executionAuthorities?.[targetProjectId]
      : undefined;
    if (input.conversationId && !resourceAuthority) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The requested conversation authority was not found.',
        module: 'frontend-product-read',
        operation: 'resolve-ask-workspace-authority',
      });
    }
    const accessRevision = resourceAuthority?.accessRevision ?? input.accessRevision;
    const policyContextRevision =
      resourceAuthority?.policyContextRevision ?? input.policyContextRevision;

    const projectConversations = Array.from(this.conversations.values()).filter(
      (conversation) => conversation.projectId === targetProjectId,
    );

    return decodeAskWorkspaceView({
      schemaVersion: ASK_SCHEMA_VERSION,
      principalId: input.principalId,
      sessionId: input.sessionId,
      projectId: targetProjectId,
      defaultAskMode: 'CANONICAL_ONLY',
      availableAskModes: this.availableAskModes,
      conversations: projectConversations.map((conversation) => {
        const activeBranch = conversation.branches.find(
          (branch) => branch.branchId === conversation.activeBranchId,
        );
        const turns = activeBranch?.turns ?? [];
        const latestTurn = turns[turns.length - 1];
        return {
          conversationId: conversation.conversationId,
          projectId: conversation.projectId,
          title: conversation.title,
          activeBranchId: conversation.activeBranchId,
          turnCount: turns.length,
          latestRunState: latestTurn?.answerRun.state ?? 'ACTION_REQUIRED',
          updatedAt: conversation.updatedAt,
        };
      }),
      ...(selectedConversation ? { selectedConversation } : {}),
      capabilities: ['SUBMIT_QUESTION'],
      projectionRevision: `ask-workspace-${targetProjectId}-${accessRevision}-${policyContextRevision}`,
      accessRevision,
      policyContextRevision,
      fetchedAt: now(),
      stale: false,
    });
  }

  async getConversation(
    input: FrontendReadScope & { readonly conversationId: string },
  ): Promise<AskConversationView> {
    const candidate = this.conversations.get(input.conversationId);
    const isAccessible =
      candidate && input.accessibleProjects.some((project) => project.id === candidate.projectId);
    if (!candidate || !isAccessible) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The requested conversation was not found.',
        module: 'frontend-product-read',
        operation: 'get-conversation',
      });
    }
    return decodeAskConversationView(candidate);
  }

  async getBranch(
    input: FrontendReadScope & { readonly conversationId: string; readonly branchId: string },
  ): Promise<AskBranchView> {
    const conversation = await this.getConversation(input);
    const branch = conversation.branches.find((candidate) => candidate.branchId === input.branchId);
    if (!branch) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The requested branch was not found.',
        module: 'frontend-product-read',
        operation: 'get-branch',
      });
    }
    return decodeAskBranchView(branch);
  }

  async getAnswerRun(
    input: FrontendReadScope & { readonly answerRunId: string },
  ): Promise<AskAnswerRunSnapshot> {
    const candidate = this.answerRuns.get(input.answerRunId);
    const isAccessible =
      candidate && input.accessibleProjects.some((project) => project.id === candidate.projectId);
    if (!candidate || !isAccessible) {
      throw new ShotgunError({
        code: 'NOT_FOUND',
        safeMessage: 'The requested answer run was not found.',
        module: 'frontend-product-read',
        operation: 'get-answer-run',
      });
    }
    return decodeAskAnswerRunSnapshot(candidate);
  }
}

export type KnowledgeCursorSeed = Readonly<Record<string, number>>;

export type InMemoryKnowledgeWorkspaceSeed = {
  readonly workspace: KnowledgeWorkspaceView;
  readonly pageList: KnowledgePageListView;
  readonly search: KnowledgeSearchResultView;
  readonly pages: readonly KnowledgePageView[];
  readonly details: Readonly<Record<string, KnowledgeDetailView>>;
  readonly compares: Readonly<Record<string, KnowledgeCompareView>>;
  /** Opaque seed-owned cursors keyed by their returned offset. */
  readonly pageListCursors?: KnowledgeCursorSeed;
  /** Opaque seed-owned cursors keyed by their returned offset. */
  readonly searchCursors?: KnowledgeCursorSeed;
};

export const knowledgeCompareSeedKey = (leftPageId: string, rightPageId: string): string =>
  `${leftPageId}::${rightPageId}`;

const knowledgeSeedObject = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
};

const knowledgeSeedArray = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    throw new FrontendContractError('UNSUPPORTED_SCHEMA', `${path} must be an array.`);
  }
  return value;
};

const assertKnowledgeSeedKeys = (
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void => {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey !== undefined) {
    throw new FrontendContractError(
      'UNSUPPORTED_SCHEMA',
      `${path} contains unknown field '${unknownKey}'.`,
    );
  }
};

const failKnowledgeSeed = (message: string): never => {
  throw new FrontendContractError('UNSUPPORTED_SCHEMA', message);
};

const decodeKnowledgeCursorSeed = (
  value: unknown,
  path: string,
  maxOffset: number,
): ReadonlyMap<string, number> => {
  if (value === undefined) return new Map();
  const input = knowledgeSeedObject(value, path);
  const entries = new Map<string, number>();
  const offsets = new Set<number>();
  for (const [cursor, offset] of Object.entries(input)) {
    if (cursor.length === 0 || cursor.length > 2048) {
      failKnowledgeSeed(`${path} cursor '${cursor}' is out of bounds.`);
    }
    if (
      typeof offset !== 'number' ||
      !Number.isSafeInteger(offset) ||
      offset <= 0 ||
      offset >= maxOffset
    ) {
      failKnowledgeSeed(`${path}.${cursor} must be an offset in [1, ${maxOffset - 1}].`);
    }
    const numericOffset = offset as number;
    if (offsets.has(numericOffset)) {
      failKnowledgeSeed(`${path} must not map multiple cursors to offset ${numericOffset}.`);
    }
    entries.set(cursor, numericOffset);
    offsets.add(numericOffset);
  }
  for (let offset = 1; offset < maxOffset; offset++) {
    if (!offsets.has(offset)) {
      failKnowledgeSeed(`${path} must provide an opaque cursor for offset ${offset}.`);
    }
  }
  return entries;
};

const samePageSummary = (
  left: KnowledgePageSummaryView,
  right: KnowledgePageSummaryView,
): boolean =>
  left.pageId === right.pageId &&
  left.projectId === right.projectId &&
  left.resourceId === right.resourceId &&
  left.revision === right.revision &&
  left.title === right.title &&
  left.primaryAuthority === right.primaryAuthority &&
  left.primaryKind === right.primaryKind &&
  JSON.stringify(left.projection) === JSON.stringify(right.projection);

const decodeKnowledgeWorkspaceSeed = (
  value: unknown,
): {
  readonly state: InMemoryKnowledgeWorkspaceSeed;
  readonly pageListCursors: ReadonlyMap<string, number>;
  readonly searchCursors: ReadonlyMap<string, number>;
} => {
  const input = knowledgeSeedObject(value, 'knowledgeWorkspaceSeed');
  assertKnowledgeSeedKeys(
    input,
    [
      'workspace',
      'pageList',
      'search',
      'pages',
      'details',
      'compares',
      'pageListCursors',
      'searchCursors',
    ],
    'knowledgeWorkspaceSeed',
  );

  const workspace = decodeKnowledgeWorkspaceView(input.workspace);
  const pageList = decodeKnowledgePageListView(input.pageList);
  const search = decodeKnowledgeSearchResultView(input.search);
  const pages = knowledgeSeedArray(input.pages, 'knowledgeWorkspaceSeed.pages').map((page, index) =>
    decodeKnowledgePageView(page, `knowledgeWorkspaceSeed.pages[${index}]`),
  );
  const detailsInput = knowledgeSeedObject(input.details, 'knowledgeWorkspaceSeed.details');
  const details: Record<string, KnowledgeDetailView> = {};
  for (const [resourceId, detail] of Object.entries(detailsInput)) {
    const decoded = decodeKnowledgeDetailView(
      detail,
      `knowledgeWorkspaceSeed.details.${resourceId}`,
    );
    if (decoded.resourceId !== resourceId) {
      failKnowledgeSeed(
        `knowledgeWorkspaceSeed.details.${resourceId} must use its resourceId as the key.`,
      );
    }
    details[resourceId] = decoded;
  }
  const comparesInput = knowledgeSeedObject(input.compares, 'knowledgeWorkspaceSeed.compares');
  const compares: Record<string, KnowledgeCompareView> = {};
  for (const [key, compare] of Object.entries(comparesInput)) {
    const decoded = decodeKnowledgeCompareView(compare, `knowledgeWorkspaceSeed.compares.${key}`);
    if (key !== knowledgeCompareSeedKey(decoded.left.pageId, decoded.right.pageId)) {
      failKnowledgeSeed(
        `knowledgeWorkspaceSeed.compares.${key} must preserve the requested page order.`,
      );
    }
    compares[key] = decoded;
  }

  const projectId = workspace.projectId;
  if (
    pageList.projectId !== projectId ||
    search.projectId !== projectId ||
    pageList.accessRevision !== workspace.accessRevision ||
    pageList.policyContextRevision !== workspace.policyContextRevision ||
    search.accessRevision !== workspace.accessRevision ||
    search.policyContextRevision !== workspace.policyContextRevision
  ) {
    failKnowledgeSeed('Knowledge seed views must share one project and one authority scope.');
  }
  if (workspace.pages.length !== pageList.pages.length) {
    failKnowledgeSeed('Workspace and page-list seeds must expose the same page set.');
  }
  for (const workspacePage of workspace.pages) {
    const pageListPage = pageList.pages.find(
      (candidate) => candidate.pageId === workspacePage.pageId,
    );
    if (!pageListPage || !samePageSummary(workspacePage, pageListPage)) {
      failKnowledgeSeed(
        'Workspace and page-list page summaries must be identical and ordered by ID.',
      );
    }
  }

  const pageIds = new Set<string>();
  const resourceIds = new Set<string>();
  for (const page of pages) {
    if (page.projectId !== projectId)
      failKnowledgeSeed('Every seeded page must belong to the seed Project.');
    if (pageIds.has(page.pageId) || resourceIds.has(page.resourceId)) {
      failKnowledgeSeed('Seeded page IDs and resource IDs must be unique.');
    }
    pageIds.add(page.pageId);
    resourceIds.add(page.resourceId);
    const summary = pageList.pages.find((candidate) => candidate.pageId === page.pageId);
    if (
      !summary ||
      summary.projectId !== page.projectId ||
      summary.resourceId !== page.resourceId ||
      summary.revision !== page.revision
    ) {
      failKnowledgeSeed('Every seeded page must have a matching page summary.');
    }
  }
  for (const pageListPage of pageList.pages) {
    if (!pageIds.has(pageListPage.pageId)) {
      failKnowledgeSeed('Every page summary must have an explicit full page seed.');
    }
  }
  for (const detail of Object.values(details)) {
    if (
      detail.page.projectId !== projectId ||
      !pageIds.has(detail.page.pageId) ||
      detail.page.resourceId !== detail.resourceId ||
      detail.page.revision !== detail.revision
    ) {
      failKnowledgeSeed(
        'Every seeded detail must preserve its explicit page identity and Project.',
      );
    }
  }
  for (const compare of Object.values(compares)) {
    if (
      compare.projectId !== projectId ||
      !pageIds.has(compare.left.pageId) ||
      !pageIds.has(compare.right.pageId)
    ) {
      failKnowledgeSeed('Every seeded compare must preserve two pages from the seed Project.');
    }
  }

  const pageListCursors = decodeKnowledgeCursorSeed(
    input.pageListCursors,
    'knowledgeWorkspaceSeed.pageListCursors',
    pageList.pages.length,
  );
  const searchCursors = decodeKnowledgeCursorSeed(
    input.searchCursors,
    'knowledgeWorkspaceSeed.searchCursors',
    search.matches.length,
  );
  return {
    state: {
      workspace,
      pageList,
      search,
      pages,
      details,
      compares,
      ...(input.pageListCursors === undefined
        ? {}
        : { pageListCursors: input.pageListCursors as KnowledgeCursorSeed }),
      ...(input.searchCursors === undefined
        ? {}
        : { searchCursors: input.searchCursors as KnowledgeCursorSeed }),
    },
    pageListCursors,
    searchCursors,
  };
};

const cloneKnowledgeView = <T>(value: T): T => structuredClone(value);

export class InMemoryKnowledgeWorkspaceProjection implements KnowledgeWorkspaceProjectionPort {
  private readonly state: InMemoryKnowledgeWorkspaceSeed;
  private readonly pageListCursors: ReadonlyMap<string, number>;
  private readonly searchCursors: ReadonlyMap<string, number>;

  constructor(seed: unknown) {
    const decoded = decodeKnowledgeWorkspaceSeed(seed);
    this.state = decoded.state;
    this.pageListCursors = decoded.pageListCursors;
    this.searchCursors = decoded.searchCursors;
  }

  async getWorkspace(
    input: FrontendReadScope & { readonly request: KnowledgeWorkspaceRequest },
  ): Promise<KnowledgeWorkspaceView> {
    const request = decodeKnowledgeWorkspaceRequest(input.request);
    this.assertScope(input, 'get-knowledge-workspace');
    const pages = this.selectPageSummaries(request, this.state.workspace.pages);
    return decodeKnowledgeWorkspaceView(cloneKnowledgeView({ ...this.state.workspace, pages }));
  }

  async listPages(
    input: FrontendReadScope & { readonly request: KnowledgePageListRequest },
  ): Promise<KnowledgePageListView> {
    const request = decodeKnowledgePageListRequest(input.request);
    this.assertScope(input, 'list-knowledge-pages');
    const pages = this.selectPageSummaries(request, this.state.pageList.pages);
    const paged = this.page(
      pages,
      request.cursor,
      request.pageSize,
      this.pageListCursors,
      'list-knowledge-pages',
    );
    return decodeKnowledgePageListView(
      cloneKnowledgeView({
        ...this.state.pageList,
        pages: paged.items,
        nextCursor: paged.nextCursor,
      }),
    );
  }

  async search(
    input: FrontendReadScope & { readonly request: KnowledgeSearchRequest },
  ): Promise<KnowledgeSearchResultView> {
    const request = decodeKnowledgeSearchRequest(input.request);
    this.assertScope(input, 'search-knowledge');
    const matches =
      request.query === this.state.search.query
        ? this.filterSearchMatches(this.state.search.matches, request.filters, request.resourceId)
        : [];
    const paged = this.page(
      matches,
      request.cursor,
      request.pageSize,
      this.searchCursors,
      'search-knowledge',
    );
    return decodeKnowledgeSearchResultView(
      cloneKnowledgeView({
        ...this.state.search,
        query: request.query,
        matches: paged.items,
        nextCursor: paged.nextCursor,
      }),
    );
  }

  async getDetail(
    input: FrontendReadScope & { readonly request: KnowledgeDetailRequest },
  ): Promise<KnowledgeDetailView> {
    const request = decodeKnowledgeDetailRequest(input.request);
    this.assertScope(input, 'get-knowledge-detail');
    const detail = this.state.details[request.resourceId];
    if (!detail || detail.page.projectId !== input.activeProject.id) {
      throw this.notFound(
        'get-knowledge-detail',
        'The requested Knowledge resource was not found.',
      );
    }
    if (
      (request.requestedRevision !== undefined && detail.revision !== request.requestedRevision) ||
      (request.focusId !== undefined && detail.focusId !== request.focusId)
    ) {
      throw this.notFound(
        'get-knowledge-detail',
        'The requested Knowledge resource was not found.',
      );
    }
    return decodeKnowledgeDetailView(cloneKnowledgeView(detail));
  }

  async compare(
    input: FrontendReadScope & { readonly request: KnowledgeCompareRequest },
  ): Promise<KnowledgeCompareView> {
    const request = decodeKnowledgeCompareRequest(input.request);
    this.assertScope(input, 'compare-knowledge-pages');
    const compare =
      this.state.compares[knowledgeCompareSeedKey(request.pageIds[0], request.pageIds[1])];
    if (!compare || compare.projectId !== input.activeProject.id) {
      throw this.notFound(
        'compare-knowledge-pages',
        'The requested Knowledge pages were not found.',
      );
    }
    if (
      (request.requestedRevision !== undefined &&
        (compare.left.revision !== request.requestedRevision ||
          compare.right.revision !== request.requestedRevision)) ||
      (request.focusId !== undefined &&
        (compare.left.focusId !== request.focusId || compare.right.focusId !== request.focusId))
    ) {
      throw this.notFound(
        'compare-knowledge-pages',
        'The requested Knowledge pages were not found.',
      );
    }
    return decodeKnowledgeCompareView(cloneKnowledgeView(compare));
  }

  private assertScope(
    input: FrontendReadScope,
    operation: string,
  ): asserts input is FrontendReadScope & {
    readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
  } {
    const projectId = this.state.workspace.projectId;
    const activeProject = input.activeProject;
    const accessible =
      activeProject && input.accessibleProjects.some((project) => project.id === projectId);
    if (
      !activeProject ||
      activeProject.id !== projectId ||
      !accessible ||
      this.state.workspace.principalId !== input.principalId ||
      this.state.workspace.sessionId !== input.sessionId ||
      this.state.workspace.accessRevision !== input.accessRevision ||
      this.state.workspace.policyContextRevision !== input.policyContextRevision
    ) {
      throw this.notFound(operation, 'The requested Knowledge workspace was not found.');
    }
  }

  private selectPageSummaries(
    request: KnowledgeWorkspaceRequest,
    pages: readonly KnowledgePageSummaryView[],
  ): readonly KnowledgePageSummaryView[] {
    let selected = pages;
    if (request.resourceId !== undefined) {
      selected = selected.filter((page) => page.resourceId === request.resourceId);
    }
    if (request.requestedRevision !== undefined) {
      selected = selected.filter((page) => page.revision === request.requestedRevision);
    }
    if (request.focusId !== undefined) {
      selected = selected.filter(
        (page) => this.state.details[page.resourceId]?.focusId === request.focusId,
      );
    }
    if (
      (request.resourceId !== undefined ||
        request.requestedRevision !== undefined ||
        request.focusId !== undefined) &&
      selected.length === 0
    ) {
      throw this.notFound(
        'select-knowledge-pages',
        'The requested Knowledge pages were not found.',
      );
    }
    return selected;
  }

  private filterSearchMatches(
    matches: readonly KnowledgeSearchMatchView[],
    filters: KnowledgeFilter | undefined,
    resourceId: string | undefined,
  ): readonly KnowledgeSearchMatchView[] {
    return matches.filter((match) => {
      if (resourceId !== undefined && match.resourceId !== resourceId) return false;
      if (
        filters?.authorities !== undefined &&
        !filters.authorities.includes(match.item.authority)
      ) {
        return false;
      }
      if (filters?.kinds !== undefined && !filters.kinds.includes(match.item.kind)) return false;
      if (
        filters?.temporalStates !== undefined &&
        !filters.temporalStates.includes(match.item.temporalState)
      ) {
        return false;
      }
      if (filters?.projectionStatuses !== undefined) {
        const status = match.item.lineage.projection?.status ?? this.state.search.projection.status;
        if (!filters.projectionStatuses.includes(status)) return false;
      }
      return true;
    });
  }

  private page<T>(
    items: readonly T[],
    cursor: string | undefined,
    pageSize: number | undefined,
    cursors: ReadonlyMap<string, number>,
    operation: string,
  ): { readonly items: readonly T[]; readonly nextCursor?: string } {
    const start = cursor === undefined ? 0 : cursors.get(cursor);
    if (start === undefined || start > items.length) {
      throw new ShotgunError({
        code: 'INVALID_REQUEST',
        safeMessage: 'The requested pagination cursor is invalid.',
        module: 'frontend-product-read',
        operation,
      });
    }
    const end = Math.min(items.length, start + (pageSize ?? items.length));
    const nextCursor =
      end < items.length ? this.cursorAtOffset(cursors, end, operation) : undefined;
    return { items: items.slice(start, end), ...(nextCursor === undefined ? {} : { nextCursor }) };
  }

  private cursorAtOffset(
    cursors: ReadonlyMap<string, number>,
    offset: number,
    operation: string,
  ): string {
    for (const [cursor, cursorOffset] of cursors.entries()) {
      if (cursorOffset === offset) return cursor;
    }
    throw new ShotgunError({
      code: 'INTERNAL_UNCLASSIFIED',
      safeMessage: 'The Knowledge pagination seed is incomplete.',
      module: 'frontend-product-read',
      operation,
    });
  }

  private notFound(operation: string, safeMessage: string): ShotgunError {
    return new ShotgunError({
      code: 'NOT_FOUND',
      safeMessage,
      module: 'frontend-product-read',
      operation,
    });
  }
}
