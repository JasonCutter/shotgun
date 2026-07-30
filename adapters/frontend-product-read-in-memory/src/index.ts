import {
  decodeGlobalSearchResultView,
  decodeHomeActionCenterView,
  decodeRouteGuardDecisionView,
  type GlobalSearchResultView,
  type GlobalShellView,
  type HomeActionCenterView,
  type NavigationAvailability,
  type TargetRouteView,
} from '../../../packages/contracts/src/index.js';
import type {
  ActionCenterProjectionPort,
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
        unavailableWorkspace('ask', 'Ask'),
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
        unavailable('ask', 'Ask', routes.ask),
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
    const workspaceAvailable = new Set(['home', 'sources', 'settings', 'settings-projects']).has(
      input.requestedRoute.routeId,
    );
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
