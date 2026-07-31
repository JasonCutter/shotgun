import {
  ASK_SCHEMA_VERSION,
  ShotgunError,
  decodeAskAnswerRunSnapshot,
  decodeAskBranchView,
  decodeAskConversationView,
  decodeAskWorkspaceView,
  decodeGlobalSearchResultView,
  decodeHomeActionCenterView,
  decodeRouteGuardDecisionView,
  type AskAnswerRunSnapshot,
  type AskBranchView,
  type AskConversationView,
  type AskWorkspaceView,
  type GlobalSearchResultView,
  type GlobalShellView,
  type HomeActionCenterView,
  type NavigationAvailability,
  type TargetRouteView,
} from '../../../packages/contracts/src/index.js';
import type {
  ActionCenterProjectionPort,
  AskWorkspaceProjectionPort,
  BackgroundSummaryProjectionPort,
  FrontendReadScope,
  GlobalSearchPort,
  GlobalShellProjectionPort,
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
  settings: { routeId: 'settings', href: '/settings' },
  projects: { routeId: 'settings-projects', href: '/settings/projects' },
} as const satisfies Record<string, TargetRouteView>;

const unavailableWorkspace = (
  id: string,
  label: string,
): {
  readonly id: string;
  readonly label: string;
  readonly availability: NavigationAvailability;
  readonly reason: string;
} => ({
  id,
  label,
  availability: 'COMING_LATER',
  reason: 'This workspace is outside Frontend Phase 1 Section 3.',
});

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
      navigation: [
        projectReady
          ? {
              id: 'home',
              label: 'Home',
              availability: 'AVAILABLE',
              targetRoute: routes.home,
            }
          : {
              id: 'home',
              label: 'Home',
              availability: 'TEMPORARILY_UNAVAILABLE',
              reason: 'Create a Project to open Home.',
            },
        projectReady
          ? {
              id: 'sources',
              label: 'Sources',
              availability: 'AVAILABLE',
              targetRoute: routes.sources,
            }
          : {
              id: 'sources',
              label: 'Sources',
              availability: 'TEMPORARILY_UNAVAILABLE',
              reason: 'Create a Project to open Sources.',
            },
        projectReady
          ? {
              id: 'ask',
              label: 'Ask',
              availability: 'AVAILABLE',
              targetRoute: routes.ask,
            }
          : {
              id: 'ask',
              label: 'Ask',
              availability: 'TEMPORARILY_UNAVAILABLE',
              reason: 'Create a Project to open Ask.',
            },
        unavailableWorkspace('knowledge', 'Knowledge'),
        unavailableWorkspace('review', 'Review'),
        {
          id: 'settings',
          label: 'Settings',
          availability: 'AVAILABLE',
          targetRoute: projectReady ? routes.settings : routes.projects,
        },
      ],
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

    const projectConversations = Array.from(this.conversations.values()).filter(
      (conversation) => conversation.projectId === targetProjectId,
    );

    return decodeAskWorkspaceView({
      schemaVersion: ASK_SCHEMA_VERSION,
      principalId: input.principalId,
      sessionId: input.sessionId,
      projectId: targetProjectId,
      defaultAskMode: 'CANONICAL_ONLY',
      availableAskModes: ['CANONICAL_ONLY', 'SOURCE_EXPLORATION', 'HYBRID'],
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
      projectionRevision: `ask-workspace-${targetProjectId}-${input.accessRevision}`,
      accessRevision: input.accessRevision,
      policyContextRevision: input.policyContextRevision,
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
