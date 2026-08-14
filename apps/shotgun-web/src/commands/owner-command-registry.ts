import type { GlobalShellView, TargetRouteView } from '@shotgun/api-client';

export type OwnerCommandCategory = 'NAVIGATION' | 'SEARCH' | 'PROJECT';

export type OwnerCommandAvailability = 'AVAILABLE' | 'UNAVAILABLE_WITH_REASON' | 'HIDDEN';

export type OwnerCommandAction =
  | { readonly kind: 'NAVIGATE'; readonly targetRoute: TargetRouteView }
  | { readonly kind: 'OPEN_SEARCH' }
  | { readonly kind: 'SWITCH_PROJECT'; readonly projectId: string };

export type OwnerCommandDefinition = {
  readonly id: string;
  readonly category: OwnerCommandCategory;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly keywords: readonly string[];
  readonly availability: OwnerCommandAvailability;
  readonly reason?: string;
  readonly action: OwnerCommandAction;
};

export type OwnerCommandRegistryOptions = {
  readonly shell: GlobalShellView;
  readonly isOffline?: boolean;
  readonly includeProjectSwitch?: boolean;
  readonly includeSearch?: boolean;
};

const ROUTE_DISCOVERY_TERMS: Partial<Record<TargetRouteView['routeId'], readonly string[]>> = {
  home: ['home', 'start', '홈', '시작'],
  sources: ['sources', 'source', '소스', '자료'],
  ask: ['ask', 'question', 'questions', '질문'],
  knowledge: ['knowledge', 'explore', '지식', '탐색'],
  review: ['review', 'changes', '검토', '변경'],
  'external-action': ['external action', 'action', '외부 작업', '액션'],
  activity: ['activity', '활동', '작업 활동'],
  history: ['history', '기록', '이력'],
  settings: ['settings', 'preferences', '설정', '환경설정'],
  'settings-projects': ['project settings', 'projects', '프로젝트', '프로젝트 설정'],
};

const categoryOrder: Record<OwnerCommandCategory, number> = {
  NAVIGATION: 0,
  SEARCH: 1,
  PROJECT: 2,
};

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const navigationAvailability = (
  availability: GlobalShellView['navigation'][number]['availability'],
): OwnerCommandAvailability => {
  if (availability === 'AVAILABLE') return 'AVAILABLE';
  if (availability === 'HIDDEN') return 'HIDDEN';
  return 'UNAVAILABLE_WITH_REASON';
};

const featureAvailability = (
  feature: GlobalShellView['features'][number] | undefined,
  isOffline: boolean,
): OwnerCommandAvailability => {
  if (isOffline) return 'UNAVAILABLE_WITH_REASON';
  if (!feature || feature.availability === 'HIDDEN') return 'HIDDEN';
  return feature.availability === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE_WITH_REASON';
};

export const createOwnerCommandRegistry = ({
  shell,
  isOffline = false,
  includeProjectSwitch = true,
  includeSearch = true,
}: OwnerCommandRegistryOptions): readonly OwnerCommandDefinition[] => {
  const navigationCommands = shell.navigation
    .filter((item) => item.targetRoute !== undefined && item.availability !== 'HIDDEN')
    .map((item): OwnerCommandDefinition => {
      const targetRoute = item.targetRoute!;
      const routeTerms = ROUTE_DISCOVERY_TERMS[targetRoute.routeId] ?? [];
      return {
        id: `navigate.${targetRoute.routeId}`,
        category: 'NAVIGATION',
        label: item.label,
        description: `Open ${item.label}`,
        aliases: [item.id, targetRoute.routeId, ...routeTerms],
        keywords: [item.label, ...routeTerms],
        availability: navigationAvailability(item.availability),
        ...(item.reason === undefined ? {} : { reason: item.reason }),
        action: { kind: 'NAVIGATE', targetRoute },
      };
    });

  const searchFeature = shell.features.find((feature) => feature.id === 'global-search');
  const searchAvailability = featureAvailability(searchFeature, isOffline);
  const searchCommand: OwnerCommandDefinition | undefined = includeSearch
    ? {
        id: 'search.global',
        category: 'SEARCH',
        label: searchFeature?.label ?? 'Search',
        description: 'Search the active Project',
        aliases: ['search', 'find', '검색', '찾기'],
        keywords: ['global search', 'active project', '소스 검색', '프로젝트 검색'],
        availability: searchAvailability,
        ...(searchAvailability === 'UNAVAILABLE_WITH_REASON'
          ? { reason: isOffline ? 'Search is unavailable while offline.' : searchFeature?.reason }
          : {}),
        action: { kind: 'OPEN_SEARCH' },
      }
    : undefined;

  const projectCommands = includeProjectSwitch
    ? shell.accessibleProjects
        .filter((project) => project.id !== shell.activeProject?.id)
        .map((project): OwnerCommandDefinition => ({
          id: `project.switch.${project.id}`,
          category: 'PROJECT',
          label: `Switch to ${project.label}`,
          description: `Use ${project.label} as the active Project`,
          aliases: ['switch project', 'project', '프로젝트 전환', '프로젝트 변경'],
          keywords: [project.label, 'switch', 'active project', '프로젝트'],
          availability: isOffline ? 'UNAVAILABLE_WITH_REASON' : 'AVAILABLE',
          ...(isOffline ? { reason: 'Project switching is unavailable while offline.' } : {}),
          action: { kind: 'SWITCH_PROJECT', projectId: project.id },
        }))
    : [];

  return [
    ...navigationCommands,
    ...(searchCommand ? [searchCommand] : []),
    ...projectCommands,
  ].sort(
    (left, right) =>
      categoryOrder[left.category] - categoryOrder[right.category] ||
      left.label.localeCompare(right.label),
  );
};

export const filterOwnerCommands = (
  commands: readonly OwnerCommandDefinition[],
  query: string,
): readonly OwnerCommandDefinition[] => {
  const normalizedQuery = normalize(query);
  return commands.filter((command) => {
    if (command.availability === 'HIDDEN') return false;
    if (!normalizedQuery) return true;
    return [command.label, command.description, ...command.aliases, ...command.keywords]
      .map(normalize)
      .some((candidate) => candidate.includes(normalizedQuery));
  });
};
