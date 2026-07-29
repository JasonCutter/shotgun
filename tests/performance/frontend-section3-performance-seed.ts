import { createHash } from 'node:crypto';

import {
  decodeGlobalSearchResultView,
  decodeGlobalShellView,
  decodeHomeActionCenterView,
  decodeRouteGuardDecisionView,
  type GlobalSearchResultView,
  type GlobalShellView,
  type HomeActionCenterView,
  type TargetRouteView,
} from '../../packages/contracts/src/index.js';
import {
  FrontendProductReadCoordinator,
  type ActionCenterProjectionPort,
  type BackgroundSummaryProjectionPort,
  type FrontendReadScope,
  type GlobalSearchPort,
  type GlobalShellProjectionPort,
  type NotificationSummaryProjectionPort,
  type RouteGuardProjectionPort,
} from '../../modules/frontend-product-read/src/index.js';

export const PERFORMANCE_SEED_REVISION = 'frontend-section3-performance-seed-v1';
export const PERFORMANCE_FIXED_TIME = '2026-07-29T00:00:00.000Z';

export type PerformanceDatasetKind = 'representative' | 'stress';

export type PerformanceDatasetManifest = {
  readonly seedRevision: typeof PERFORMANCE_SEED_REVISION;
  readonly kind: PerformanceDatasetKind;
  readonly principals: number;
  readonly sourceAccessibleProjects: number;
  readonly exposedProjectPage: number;
  readonly navigationItems: number;
  readonly primaryActions: number;
  readonly sourceAttentionItems: number;
  readonly exposedAttentionItems: number;
  readonly sourceContinueWorkingItems: number;
  readonly exposedContinueWorkingItems: number;
  readonly browserDrafts: number;
  readonly recentItems: number;
  readonly pinnedItems: number;
  readonly backgroundItems: number;
  readonly notifications: number;
  readonly searchCorpus: number;
  readonly returnedSearchResults: number;
  readonly routeGuardRequests: number;
  readonly concurrentOrUnknownCommands: number;
  readonly crossProjectRatio: number;
  readonly unavailableRetiredForbiddenRatio: number;
  readonly authorizationRule: 'SERVER_FILTER_BEFORE_PRODUCT_API';
};

const datasetManifests: Readonly<Record<PerformanceDatasetKind, PerformanceDatasetManifest>> = {
  representative: {
    seedRevision: PERFORMANCE_SEED_REVISION,
    kind: 'representative',
    principals: 2,
    sourceAccessibleProjects: 25,
    exposedProjectPage: 25,
    navigationItems: 8,
    primaryActions: 4,
    sourceAttentionItems: 25,
    exposedAttentionItems: 25,
    sourceContinueWorkingItems: 25,
    exposedContinueWorkingItems: 25,
    browserDrafts: 5,
    recentItems: 25,
    pinnedItems: 25,
    backgroundItems: 50,
    notifications: 100,
    searchCorpus: 10_000,
    returnedSearchResults: 20,
    routeGuardRequests: 50,
    concurrentOrUnknownCommands: 10,
    crossProjectRatio: 0.2,
    unavailableRetiredForbiddenRatio: 0.1,
    authorizationRule: 'SERVER_FILTER_BEFORE_PRODUCT_API',
  },
  stress: {
    seedRevision: PERFORMANCE_SEED_REVISION,
    kind: 'stress',
    principals: 5,
    sourceAccessibleProjects: 250,
    exposedProjectPage: 50,
    navigationItems: 8,
    primaryActions: 4,
    sourceAttentionItems: 100,
    exposedAttentionItems: 50,
    sourceContinueWorkingItems: 100,
    exposedContinueWorkingItems: 50,
    browserDrafts: 10,
    recentItems: 50,
    pinnedItems: 50,
    backgroundItems: 200,
    notifications: 500,
    searchCorpus: 100_000,
    returnedSearchResults: 20,
    routeGuardRequests: 200,
    concurrentOrUnknownCommands: 25,
    crossProjectRatio: 0.2,
    unavailableRetiredForbiddenRatio: 0.1,
    authorizationRule: 'SERVER_FILTER_BEFORE_PRODUCT_API',
  },
};

export const getPerformanceDatasetManifest = (
  kind: PerformanceDatasetKind,
): PerformanceDatasetManifest => datasetManifests[kind];

export const performanceDatasetDigest = (manifest: PerformanceDatasetManifest): string =>
  createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

const routes = {
  home: { routeId: 'home', href: '/' },
  sources: { routeId: 'sources', href: '/sources' },
  ask: { routeId: 'ask', href: '/ask' },
  knowledge: { routeId: 'knowledge', href: '/knowledge' },
  review: { routeId: 'review', href: '/review' },
  settings: { routeId: 'settings', href: '/settings' },
  projects: { routeId: 'settings-projects', href: '/settings/projects' },
} as const satisfies Record<string, TargetRouteView>;

const projectForIndex = (
  scope: FrontendReadScope,
  index: number,
): NonNullable<FrontendReadScope['activeProject']> =>
  scope.accessibleProjects[index % scope.accessibleProjects.length] ?? scope.activeProject!;

class PerformanceShellProjection implements GlobalShellProjectionPort {
  async getShell(
    input: FrontendReadScope,
  ): Promise<Omit<GlobalShellView, 'background' | 'notifications'>> {
    const projectReady = input.activeProject !== null;
    const shell = decodeGlobalShellView({
      schemaVersion: '1.0.0',
      principalId: input.principalId,
      sessionId: input.sessionId,
      activeProject: input.activeProject,
      accessibleProjects: input.accessibleProjects,
      navigation: [
        {
          id: 'home',
          label: 'Home',
          availability: projectReady ? 'AVAILABLE' : 'TEMPORARILY_UNAVAILABLE',
          ...(projectReady
            ? { targetRoute: routes.home }
            : { reason: 'Create a Project to open Home.' }),
        },
        {
          id: 'sources',
          label: 'Sources',
          availability: 'COMING_LATER',
          reason: 'Deferred workspace.',
        },
        {
          id: 'ask',
          label: 'Ask',
          availability: 'COMING_LATER',
          reason: 'Deferred workspace.',
        },
        {
          id: 'knowledge',
          label: 'Knowledge',
          availability: 'TEMPORARILY_UNAVAILABLE',
          reason: 'Projection unavailable in Section 3.',
        },
        {
          id: 'review',
          label: 'Review',
          availability: 'ACCESS_RESTRICTED',
          reason: 'Capability required.',
        },
        {
          id: 'settings',
          label: 'Settings',
          availability: 'AVAILABLE',
          targetRoute: projectReady ? routes.settings : routes.projects,
        },
        {
          id: 'retired-hidden',
          label: 'Hidden',
          availability: 'HIDDEN',
          reason: 'Existence is masked.',
        },
        {
          id: 'notifications',
          label: 'Notifications',
          availability: 'COMING_LATER',
          reason: 'Summary presentation only.',
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
        },
      ],
      readiness: [
        { kind: 'SESSION_READY', ready: true, required: true },
        { kind: 'PROJECT_READY', ready: projectReady, required: true },
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
      background: { activeCount: 0, failedCount: 0 },
      notifications: { unreadCount: 0, presentationRevision: 'placeholder' },
      accessRevision: input.accessRevision,
      policyContextRevision: input.policyContextRevision,
      projectionRevision: `perf-shell-${input.accessRevision}-${input.policyContextRevision}`,
      fetchedAt: PERFORMANCE_FIXED_TIME,
    });
    const { background, notifications, ...projection } = shell;
    void background;
    void notifications;
    return projection;
  }
}

class PerformanceHomeProjection implements ActionCenterProjectionPort {
  constructor(private readonly manifest: PerformanceDatasetManifest) {}

  async getHome(
    input: FrontendReadScope & {
      readonly activeProject: NonNullable<FrontendReadScope['activeProject']>;
    },
  ): Promise<HomeActionCenterView> {
    const attention = Array.from({ length: this.manifest.exposedAttentionItems }, (_, index) => {
      const project = input.activeProject;
      return {
        stableId: `attention-${String(index + 1).padStart(3, '0')}`,
        kind: index % 3 === 0 ? 'review' : 'source',
        label: `Authorized attention ${String(index + 1).padStart(3, '0')}`,
        priority: this.manifest.exposedAttentionItems - index,
        reason: index % 4 === 0 ? 'Recovery is available.' : 'Server-ranked action is pending.',
        projectId: project.id,
        resourceId: `attention-resource-${String(index + 1).padStart(3, '0')}`,
        targetRoute: routes.settings,
        createdAt: PERFORMANCE_FIXED_TIME,
      };
    });
    const continueWorking = Array.from(
      { length: this.manifest.exposedContinueWorkingItems },
      (_, index) => {
        const project = input.activeProject;
        return {
          stableId: `continue-${String(index + 1).padStart(3, '0')}`,
          origin: 'SERVER_RESOURCE' as const,
          kind: 'source',
          label: `Authorized work ${String(index + 1).padStart(3, '0')}`,
          projectId: project.id,
          resourceId: `continue-resource-${String(index + 1).padStart(3, '0')}`,
          targetRoute: routes.settings,
          updatedAt: PERFORMANCE_FIXED_TIME,
        };
      },
    );
    const resources = (prefix: 'recent' | 'pinned', count: number) =>
      Array.from({ length: count }, (_, index) => {
        const project = input.activeProject;
        return {
          stableId: `${prefix}-${String(index + 1).padStart(3, '0')}`,
          kind: index % 2 === 0 ? 'knowledge' : 'source',
          label: `${prefix === 'recent' ? 'Recent' : 'Pinned'} resource ${String(index + 1).padStart(3, '0')}`,
          projectId: project.id,
          resourceId: `${prefix}-resource-${String(index + 1).padStart(3, '0')}`,
          targetRoute: routes.settings,
          updatedAt: PERFORMANCE_FIXED_TIME,
        };
      });
    return decodeHomeActionCenterView({
      schemaVersion: '1.0.0',
      principalId: input.principalId,
      sessionId: input.sessionId,
      activeProject: {
        id: input.activeProject.id,
        label: input.activeProject.label,
      },
      projectState: { lifecycle: 'ACTIVE', message: 'Performance seed is ready.' },
      primaryActions: [
        {
          id: 'add-source',
          label: 'Add source',
          availability: 'COMING_LATER',
          disabledReason: 'Deferred workspace.',
          targetRoute: routes.sources,
        },
        {
          id: 'ask',
          label: 'Ask',
          availability: 'COMING_LATER',
          disabledReason: 'Deferred workspace.',
          targetRoute: routes.ask,
        },
        {
          id: 'explore-knowledge',
          label: 'Explore knowledge',
          availability: 'TEMPORARILY_UNAVAILABLE',
          disabledReason: 'Projection unavailable.',
          targetRoute: routes.knowledge,
        },
        {
          id: 'review-changes',
          label: 'Review changes',
          availability: 'ACCESS_RESTRICTED',
          disabledReason: 'Capability required.',
          targetRoute: routes.review,
        },
      ],
      attention,
      continueWorking,
      recent: resources('recent', this.manifest.recentItems),
      pinned: resources('pinned', this.manifest.pinnedItems),
      operationalSummary: {
        activeBackgroundCount: Math.min(this.manifest.backgroundItems, 20),
        failedBackgroundCount: Math.ceil(this.manifest.backgroundItems * 0.1),
        unreadNotificationCount: this.manifest.notifications,
      },
      stale: false,
      accessRevision: input.accessRevision,
      policyContextRevision: input.policyContextRevision,
      projectionRevision: `perf-home-${this.manifest.kind}-${input.activeProject.id}`,
      fetchedAt: PERFORMANCE_FIXED_TIME,
    });
  }
}

class PerformanceBackgroundProjection implements BackgroundSummaryProjectionPort {
  constructor(private readonly manifest: PerformanceDatasetManifest) {}

  async getSummary(): Promise<GlobalShellView['background']> {
    return {
      activeCount: Math.min(this.manifest.backgroundItems, 20),
      failedCount: Math.ceil(this.manifest.backgroundItems * 0.1),
    };
  }
}

class PerformanceNotificationProjection implements NotificationSummaryProjectionPort {
  constructor(private readonly manifest: PerformanceDatasetManifest) {}

  async getSummary(): Promise<GlobalShellView['notifications']> {
    return {
      unreadCount: this.manifest.notifications,
      presentationRevision: `perf-notifications-${this.manifest.kind}`,
    };
  }
}

class PerformanceSearchProjection implements GlobalSearchPort {
  constructor(private readonly manifest: PerformanceDatasetManifest) {}

  async search(input: Parameters<GlobalSearchPort['search']>[0]): Promise<GlobalSearchResultView> {
    const count = Math.min(input.request.limit, this.manifest.returnedSearchResults);
    return decodeGlobalSearchResultView({
      schemaVersion: '1.0.0',
      scope: input.request.scope.kind,
      results: Array.from({ length: count }, (_, index) => {
        const project = projectForIndex(input, index);
        return {
          stableId: `search-result-${String(index + 1).padStart(3, '0')}`,
          kind: index % 2 === 0 ? 'knowledge' : 'source',
          label: `Authorized result ${String(index + 1).padStart(3, '0')}`,
          safeHighlight: 'Authorized non-query highlight.',
          projectId: project.id,
          projectLabel: project.label,
          targetRoute: routes.settings,
        };
      }),
      projectionRevision: `perf-search-${this.manifest.kind}-${input.accessRevision}`,
      fetchedAt: PERFORMANCE_FIXED_TIME,
    });
  }
}

class PerformanceRouteGuardProjection implements RouteGuardProjectionPort {
  async decide(
    input: Parameters<RouteGuardProjectionPort['decide']>[0],
  ): Promise<ReturnType<RouteGuardProjectionPort['decide']> extends Promise<infer T> ? T : never> {
    const resourceProject = input.resourceProjectId
      ? input.accessibleProjects.find((project) => project.id === input.resourceProjectId)
      : undefined;
    const masked = Boolean(input.resourceProjectId && !resourceProject);
    const allowed =
      !masked && ['home', 'settings', 'settings-projects'].includes(input.requestedRoute.routeId);
    return decodeRouteGuardDecisionView({
      schemaVersion: '1.0.0',
      decision: masked ? 'NOT_FOUND' : allowed ? 'ALLOW' : 'FEATURE_UNAVAILABLE',
      ...(allowed ? { targetRoute: input.requestedRoute } : {}),
      ...(input.activeProject ? { activeProjectId: input.activeProject.id } : {}),
      ...(resourceProject
        ? { resourceProject: { id: resourceProject.id, label: resourceProject.label } }
        : {}),
      masked,
      message: masked
        ? 'The resource was not found.'
        : allowed
          ? 'Route decision completed.'
          : 'The requested workspace is unavailable.',
      accessRevision: input.accessRevision,
      policyContextRevision: input.policyContextRevision,
    });
  }
}

export const createPerformanceReadCoordinator = (
  manifest: PerformanceDatasetManifest,
): FrontendProductReadCoordinator =>
  new FrontendProductReadCoordinator(
    new PerformanceShellProjection(),
    new PerformanceHomeProjection(manifest),
    new PerformanceBackgroundProjection(manifest),
    new PerformanceNotificationProjection(manifest),
    new PerformanceSearchProjection(manifest),
    new PerformanceRouteGuardProjection(),
  );
