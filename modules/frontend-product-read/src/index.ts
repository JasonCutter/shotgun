import type {
  AskAnswerRunSnapshot,
  AskBranchView,
  AskConversationView,
  AskWorkspaceView,
  AskQuestionSubmissionOutcomeView,
  AskQuestionSubmissionView,
  SubmitAskQuestionRequest,
  GlobalSearchRequest,
  GlobalSearchResultView,
  GlobalShellView,
  HomeActionCenterView,
  RouteGuardDecisionView,
  TargetRouteView,
} from '../../../packages/contracts/src/index.js';
import { decodeGlobalShellView } from '../../../packages/contracts/src/index.js';

export type AuthorizedProjectSummary = {
  readonly id: string;
  readonly label: string;
  readonly isOwner: boolean;
  readonly sensitivityClearance: 'public' | 'internal' | 'private' | 'restricted';
};

export type FrontendReadScope = {
  readonly principalId: string;
  readonly sessionId: string;
  readonly activeProject: AuthorizedProjectSummary | null;
  readonly accessibleProjects: readonly AuthorizedProjectSummary[];
  readonly accessRevision: string;
  readonly policyContextRevision: string;
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

export class FrontendProductReadCoordinator {
  constructor(
    private readonly shell: GlobalShellProjectionPort,
    private readonly actionCenter: ActionCenterProjectionPort,
    private readonly background: BackgroundSummaryProjectionPort,
    private readonly notifications: NotificationSummaryProjectionPort,
    private readonly searchPort: GlobalSearchPort,
    private readonly routeGuard: RouteGuardProjectionPort,
    private readonly askWorkspace?: AskWorkspaceProjectionPort,
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
}
