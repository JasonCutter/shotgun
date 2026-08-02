import {
  decodeGlobalShellView,
  decodeKnowledgeCompareView,
  decodeKnowledgeDetailView,
  decodeKnowledgePageListView,
  decodeKnowledgeSearchResultView,
  decodeKnowledgeSearchResultViewVNext,
  decodeKnowledgeWorkspaceView,
} from '../../../packages/contracts/src/index.js';
import type {
  AskAnswerRunSnapshot,
  AskBranchView,
  AskConversationView,
  AskWorkspaceView,
  GlobalSearchRequest,
  GlobalSearchResultView,
  GlobalShellView,
  HomeActionCenterView,
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
  RouteGuardDecisionView,
  TargetRouteView,
} from '../../../packages/contracts/src/index.js';

export type AuthorizedProjectSummary = {
  readonly id: string;
  readonly label: string;
  readonly isOwner: boolean;
  readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
};

export type FrontendProjectAuthorityRevision = {
  readonly accessRevision: string;
  readonly policyContextRevision: string;
};

export type FrontendReadScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProject: AuthorizedProjectSummary | null;
  readonly accessibleProjects: readonly AuthorizedProjectSummary[];
  readonly accessRevision: string;
  readonly policyContextRevision: string;
  /** Server-resolved membership scopes; browser-supplied authority is never accepted. */
  readonly accessScope?: readonly string[];
  /** Resource-scoped revisions; never substitute the active Project revision. */
  readonly executionAuthorities?: Readonly<Record<string, FrontendProjectAuthorityRevision>>;
};

export type BackgroundSummaryView = GlobalShellView['background'];
export type NotificationSummaryView = GlobalShellView['notifications'];

export type GlobalShellProjectionPort = {
  getShell(
    input: FrontendReadScope,
  ): Promise<Omit<GlobalShellView, 'background' | 'notifications'>>;
};

export type ActionCenterProjectionPort = {
  getHome(
    input: FrontendReadScope & {
      readonly activeProject: AuthorizedProjectSummary;
    },
  ): Promise<HomeActionCenterView>;
};

export type BackgroundSummaryProjectionPort = {
  getSummary(input: FrontendReadScope): Promise<BackgroundSummaryView>;
};

export type NotificationSummaryProjectionPort = {
  getSummary(input: FrontendReadScope): Promise<NotificationSummaryView>;
};

export type GlobalSearchPort = {
  search(
    input: FrontendReadScope & {
      readonly activeProject: AuthorizedProjectSummary;
      readonly request: GlobalSearchRequest;
    },
  ): Promise<GlobalSearchResultView>;
};

export type RouteGuardProjectionPort = {
  decide(
    input: FrontendReadScope & {
      readonly requestedRoute: TargetRouteView;
      readonly resourceProjectId?: string;
    },
  ): Promise<RouteGuardDecisionView>;
};

export type AskWorkspaceProjectionPort = {
  getWorkspace(
    input: FrontendReadScope & { readonly conversationId?: string },
  ): Promise<AskWorkspaceView>;
  getConversation(
    input: FrontendReadScope & { readonly conversationId: string },
  ): Promise<AskConversationView>;
  getBranch(
    input: FrontendReadScope & { readonly conversationId: string; readonly branchId: string },
  ): Promise<AskBranchView>;
  getAnswerRun(
    input: FrontendReadScope & { readonly answerRunId: string },
  ): Promise<AskAnswerRunSnapshot>;
};

type KnowledgeActiveProjectScope = FrontendReadScope & {
  readonly activeProject: AuthorizedProjectSummary;
};

type KnowledgePortInput<Request> = KnowledgeActiveProjectScope & {
  readonly request: Request;
};

export type KnowledgeWorkspaceProjectionPort = {
  getWorkspace(
    input: KnowledgePortInput<KnowledgeWorkspaceRequest>,
  ): Promise<KnowledgeWorkspaceView>;
  listPages(input: KnowledgePortInput<KnowledgePageListRequest>): Promise<KnowledgePageListView>;
  search(input: KnowledgePortInput<KnowledgeSearchRequest>): Promise<KnowledgeSearchResultViewAny>;
  getDetail(input: KnowledgePortInput<KnowledgeDetailRequest>): Promise<KnowledgeDetailView>;
  compare(input: KnowledgePortInput<KnowledgeCompareRequest>): Promise<KnowledgeCompareView>;
};

const requireKnowledgeActiveProject = <Request>(
  input: KnowledgePortInput<Request>,
): KnowledgePortInput<Request> => {
  if (!input.activeProject) {
    throw new Error('Knowledge operations require an active Project.');
  }
  return input;
};

const rejectKnowledgeResponse = (reason: string): never => {
  throw new Error(`Knowledge Product Read response violation: ${reason}`);
};

const assertKnowledgeScope = (
  view: {
    readonly projectId: string;
    readonly accessRevision: string;
    readonly policyContextRevision: string;
  },
  input: KnowledgeActiveProjectScope,
): void => {
  if (view.projectId !== input.activeProject.id) {
    rejectKnowledgeResponse('project does not match the active Project.');
  }
  if (view.accessRevision !== input.accessRevision) {
    rejectKnowledgeResponse('access revision does not match the read scope.');
  }
  if (view.policyContextRevision !== input.policyContextRevision) {
    rejectKnowledgeResponse('policy context revision does not match the read scope.');
  }
};

const assertKnowledgePageProject = (
  page: { readonly projectId: string },
  input: KnowledgeActiveProjectScope,
): void => {
  if (page.projectId !== input.activeProject.id) {
    rejectKnowledgeResponse('page project does not match the active Project.');
  }
};

export class FrontendProductReadCoordinator {
  constructor(
    private readonly shell: GlobalShellProjectionPort,
    private readonly actionCenter: ActionCenterProjectionPort,
    private readonly background: BackgroundSummaryProjectionPort,
    private readonly notifications: NotificationSummaryProjectionPort,
    private readonly searchPort: GlobalSearchPort,
    private readonly routeGuard: RouteGuardProjectionPort,
    private readonly askWorkspace?: AskWorkspaceProjectionPort,
    private readonly knowledgeWorkspace?: KnowledgeWorkspaceProjectionPort,
  ) {}

  async getGlobalShell(input: FrontendReadScope): Promise<GlobalShellView> {
    const [shell, background, notifications] = await Promise.all([
      this.shell.getShell(input),
      this.background.getSummary(input),
      this.notifications.getSummary(input),
    ]);
    return decodeGlobalShellView({ ...shell, background, notifications });
  }

  getHome(
    input: FrontendReadScope & { readonly activeProject: AuthorizedProjectSummary },
  ): Promise<HomeActionCenterView> {
    return this.actionCenter.getHome(input);
  }

  search(
    input: FrontendReadScope & {
      readonly activeProject: AuthorizedProjectSummary;
      readonly request: GlobalSearchRequest;
    },
  ): Promise<GlobalSearchResultView> {
    return this.searchPort.search(input);
  }

  async getKnowledgeWorkspace(
    input: KnowledgePortInput<KnowledgeWorkspaceRequest>,
  ): Promise<KnowledgeWorkspaceView> {
    const readInput = requireKnowledgeActiveProject(input);
    const view = decodeKnowledgeWorkspaceView(
      await this.getKnowledgePort().getWorkspace(readInput),
    );
    assertKnowledgeScope(view, readInput);
    if (view.principalId !== readInput.principalId) {
      rejectKnowledgeResponse('principal does not match the read scope.');
    }
    if (view.sessionId !== readInput.sessionId) {
      rejectKnowledgeResponse('session does not match the read scope.');
    }
    return view;
  }

  async listKnowledgePages(
    input: KnowledgePortInput<KnowledgePageListRequest>,
  ): Promise<KnowledgePageListView> {
    const readInput = requireKnowledgeActiveProject(input);
    const view = decodeKnowledgePageListView(await this.getKnowledgePort().listPages(readInput));
    assertKnowledgeScope(view, readInput);
    return view;
  }

  async searchKnowledge(
    input: KnowledgePortInput<KnowledgeSearchRequest>,
  ): Promise<KnowledgeSearchResultViewAny> {
    const readInput = requireKnowledgeActiveProject(input);
    const raw = await this.getKnowledgePort().search(readInput);
    const view =
      raw.schemaVersion === '1.1.0'
        ? decodeKnowledgeSearchResultViewVNext(raw)
        : decodeKnowledgeSearchResultView(raw);
    assertKnowledgeScope(view, readInput);
    if (view.query !== readInput.request.query) {
      rejectKnowledgeResponse('search query does not match the request.');
    }
    if (view.projection.projectionKind !== 'CANONICAL_SEARCH') {
      rejectKnowledgeResponse('search projection must be CANONICAL_SEARCH.');
    }
    return view;
  }

  async getKnowledgeDetail(
    input: KnowledgePortInput<KnowledgeDetailRequest>,
  ): Promise<KnowledgeDetailView> {
    const readInput = requireKnowledgeActiveProject(input);
    const view = decodeKnowledgeDetailView(await this.getKnowledgePort().getDetail(readInput));
    assertKnowledgePageProject(view.page, readInput);
    if (view.resourceId !== readInput.request.resourceId) {
      rejectKnowledgeResponse('detail resource does not match the request.');
    }
    if (
      readInput.request.requestedRevision !== undefined &&
      view.revision !== readInput.request.requestedRevision
    ) {
      rejectKnowledgeResponse('detail revision does not match the request.');
    }
    if (readInput.request.focusId !== undefined && view.focusId !== readInput.request.focusId) {
      rejectKnowledgeResponse('detail focus does not match the request.');
    }
    if (view.page.projectId !== readInput.activeProject.id) {
      rejectKnowledgeResponse('detail page project does not match the active Project.');
    }
    if (view.page.resourceId !== view.resourceId || view.page.revision !== view.revision) {
      rejectKnowledgeResponse('detail page identity does not match the detail resource.');
    }
    assertKnowledgeScope(
      {
        projectId: view.page.projectId,
        accessRevision: view.accessRevision,
        policyContextRevision: view.policyContextRevision,
      },
      readInput,
    );
    return view;
  }

  async compareKnowledgePages(
    input: KnowledgePortInput<KnowledgeCompareRequest>,
  ): Promise<KnowledgeCompareView> {
    const readInput = requireKnowledgeActiveProject(input);
    const view = decodeKnowledgeCompareView(await this.getKnowledgePort().compare(readInput));
    assertKnowledgeScope(view, readInput);
    if (view.left.pageId !== readInput.request.pageIds[0]) {
      rejectKnowledgeResponse('left compare page does not match the request order.');
    }
    if (view.right.pageId !== readInput.request.pageIds[1]) {
      rejectKnowledgeResponse('right compare page does not match the request order.');
    }
    assertKnowledgePageProject(view.left, readInput);
    assertKnowledgePageProject(view.right, readInput);
    return view;
  }

  guard(
    input: FrontendReadScope & {
      readonly requestedRoute: TargetRouteView;
      readonly resourceProjectId?: string;
    },
  ): Promise<RouteGuardDecisionView> {
    return this.routeGuard.decide(input);
  }

  getAskWorkspace(
    input: FrontendReadScope & { readonly conversationId?: string },
  ): Promise<AskWorkspaceView> {
    if (!this.askWorkspace) {
      throw new Error('AskWorkspaceProjectionPort is not configured.');
    }
    return this.askWorkspace.getWorkspace(input);
  }

  getAskConversation(
    input: FrontendReadScope & { readonly conversationId: string },
  ): Promise<AskConversationView> {
    if (!this.askWorkspace) {
      throw new Error('AskWorkspaceProjectionPort is not configured.');
    }
    return this.askWorkspace.getConversation(input);
  }

  getAskBranch(
    input: FrontendReadScope & { readonly conversationId: string; readonly branchId: string },
  ): Promise<AskBranchView> {
    if (!this.askWorkspace) {
      throw new Error('AskWorkspaceProjectionPort is not configured.');
    }
    return this.askWorkspace.getBranch(input);
  }

  getAskAnswerRun(
    input: FrontendReadScope & { readonly answerRunId: string },
  ): Promise<AskAnswerRunSnapshot> {
    if (!this.askWorkspace) {
      throw new Error('AskWorkspaceProjectionPort is not configured.');
    }
    return this.askWorkspace.getAnswerRun(input);
  }

  private getKnowledgePort(): KnowledgeWorkspaceProjectionPort {
    if (!this.knowledgeWorkspace) {
      throw new Error('KnowledgeWorkspaceProjectionPort is not configured.');
    }
    return this.knowledgeWorkspace;
  }
}
