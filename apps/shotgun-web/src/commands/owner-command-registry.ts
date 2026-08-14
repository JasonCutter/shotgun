import type { GlobalShellView, TargetRouteView } from '@shotgun/api-client';

export type OwnerCommandCategory = 'HELP' | 'SEARCH' | 'PROJECT' | 'NAVIGATION';

export type OwnerCommandAvailability = 'AVAILABLE' | 'UNAVAILABLE_WITH_REASON' | 'HIDDEN';

export type OwnerCommandRisk = 'READ' | 'WRITE' | 'DESTRUCTIVE';

export type OwnerCommandPresentation = 'NAVIGATE' | 'DIALOG' | 'DRAWER' | 'INLINE' | 'EXECUTE';

export type OwnerCommandAction =
  | { readonly kind: 'NAVIGATE'; readonly targetRoute: TargetRouteView }
  | { readonly kind: 'NAVIGATE_PATH'; readonly href: '/settings/ai' | '/settings/privacy' }
  | { readonly kind: 'OPEN_COMMANDS' }
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
  readonly risk: OwnerCommandRisk;
  readonly presentation: OwnerCommandPresentation;
  readonly context?: { readonly projectId?: string };
  readonly action: OwnerCommandAction;
};

export type OwnerCommandRegistryOptions = {
  readonly shell: GlobalShellView;
  readonly isOffline?: boolean;
  readonly includeProjectSwitch?: boolean;
  readonly includeSearch?: boolean;
};

type OwnerCommandTemplate = Omit<OwnerCommandDefinition, 'availability' | 'reason' | 'context'> & {
  readonly getAvailability: (
    shell: GlobalShellView,
    isOffline: boolean,
  ) => Pick<OwnerCommandDefinition, 'availability' | 'reason'>;
};

const categoryOrder: Record<OwnerCommandCategory, number> = {
  HELP: 0,
  SEARCH: 1,
  PROJECT: 2,
  NAVIGATION: 3,
};

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const navigationAvailability = (
  item: GlobalShellView['navigation'][number],
): Pick<OwnerCommandDefinition, 'availability' | 'reason'> => {
  if (item.availability === 'AVAILABLE') return { availability: 'AVAILABLE' };
  if (item.availability === 'HIDDEN') return { availability: 'HIDDEN' };
  return {
    availability: 'UNAVAILABLE_WITH_REASON',
    ...(item.reason === undefined ? {} : { reason: item.reason }),
  };
};

const explicitRouteAvailability = (
  shell: GlobalShellView,
  routeId: TargetRouteView['routeId'],
): Pick<OwnerCommandDefinition, 'availability' | 'reason'> => {
  const navigationItem = shell.navigation.find((item) => item.targetRoute?.routeId === routeId);
  return navigationItem ? navigationAvailability(navigationItem) : { availability: 'AVAILABLE' };
};

const featureAvailability = (
  feature: GlobalShellView['features'][number] | undefined,
  isOffline: boolean,
): Pick<OwnerCommandDefinition, 'availability' | 'reason'> => {
  if (isOffline) {
    return {
      availability: 'UNAVAILABLE_WITH_REASON',
      reason: 'Search is unavailable while offline.',
    };
  }
  if (!feature || feature.availability === 'HIDDEN') return { availability: 'HIDDEN' };
  if (feature.availability === 'AVAILABLE') return { availability: 'AVAILABLE' };
  return {
    availability: 'UNAVAILABLE_WITH_REASON',
    ...(feature.reason === undefined ? {} : { reason: feature.reason }),
  };
};

const navigate = (
  routeId: TargetRouteView['routeId'],
  href: TargetRouteView['href'],
): OwnerCommandAction => ({ kind: 'NAVIGATE', targetRoute: { routeId, href } });

const HFM_COMMAND_TEMPLATES: readonly OwnerCommandTemplate[] = [
  {
    id: 'help.commands',
    category: 'HELP',
    label: 'Commands',
    description: 'View available owner commands',
    aliases: ['help', 'commands', 'command palette', '명령어', '도움말'],
    keywords: ['discover', 'slash', 'keyboard', '명령어 보기'],
    risk: 'READ',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_COMMANDS' },
    getAvailability: () => ({ availability: 'AVAILABLE' }),
  },
  {
    id: 'search.global',
    category: 'SEARCH',
    label: 'Search',
    description: 'Search the active Project',
    aliases: ['search', 'find', '검색', '찾기'],
    keywords: ['global search', 'active project', 'project search', '전체 검색'],
    risk: 'READ',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_SEARCH' },
    getAvailability: (shell, isOffline) =>
      featureAvailability(
        shell.features.find((feature) => feature.id === 'global-search'),
        isOffline,
      ),
  },
  {
    id: 'project.manage',
    category: 'PROJECT',
    label: 'Manage Projects',
    description: 'Open Project management',
    aliases: ['project admin', 'projects', '프로젝트 관리'],
    keywords: ['project settings', 'project list', 'project details', '프로젝트'],
    risk: 'READ',
    presentation: 'NAVIGATE',
    action: navigate('settings-projects', '/settings/projects'),
    getAvailability: (shell) => explicitRouteAvailability(shell, 'settings-projects'),
  },
  {
    id: 'ai.configure',
    category: 'PROJECT',
    label: 'Configure AI',
    description: 'Open focused AI configuration',
    aliases: ['ai settings', 'provider settings', 'AI 설정'],
    keywords: ['model', 'provider', 'credential', '모델', '제공자'],
    risk: 'WRITE',
    presentation: 'DRAWER',
    action: { kind: 'NAVIGATE_PATH', href: '/settings/ai' },
    getAvailability: () => ({ availability: 'AVAILABLE' }),
  },
  {
    id: 'privacy.open',
    category: 'PROJECT',
    label: 'Open Privacy',
    description: 'Review privacy and external transfer settings',
    aliases: ['privacy', 'data transfer', '개인정보', '외부 전송'],
    keywords: ['retention', 'external ai', 'privacy settings', '개인정보 설정'],
    risk: 'READ',
    presentation: 'DRAWER',
    action: { kind: 'NAVIGATE_PATH', href: '/settings/privacy' },
    getAvailability: () => ({ availability: 'AVAILABLE' }),
  },
  {
    id: 'knowledge.open',
    category: 'NAVIGATION',
    label: 'Open Knowledge',
    description: 'Open the Knowledge workspace',
    aliases: ['knowledge', 'explore', '지식', '지식 보기'],
    keywords: ['knowledge projection', 'facts', 'graph', '지식'],
    risk: 'READ',
    presentation: 'NAVIGATE',
    action: navigate('knowledge', '/knowledge'),
    getAvailability: (shell) => explicitRouteAvailability(shell, 'knowledge'),
  },
  {
    id: 'review.open',
    category: 'NAVIGATION',
    label: 'Open Review',
    description: 'Open the Review workspace',
    aliases: ['review', 'decisions', '검토', '리뷰'],
    keywords: ['review queue', 'approval', 'changes', '검토'],
    risk: 'WRITE',
    presentation: 'NAVIGATE',
    action: navigate('review', '/review'),
    getAvailability: (shell) => explicitRouteAvailability(shell, 'review'),
  },
  {
    id: 'external_action.open',
    category: 'NAVIGATION',
    label: 'Open External Actions',
    description: 'Open governed external action work',
    aliases: ['external actions', 'actions', '외부 작업'],
    keywords: ['action approval', 'execution', 'external work', '외부 작업'],
    risk: 'WRITE',
    presentation: 'NAVIGATE',
    action: navigate('external-action', '/external-action'),
    getAvailability: (shell) => explicitRouteAvailability(shell, 'external-action'),
  },
  {
    id: 'activity.open',
    category: 'NAVIGATION',
    label: 'Open Activity',
    description: 'Open execution status',
    aliases: ['activity', 'runs', '활동'],
    keywords: ['execution status', 'operations', '실행 상태'],
    risk: 'READ',
    presentation: 'NAVIGATE',
    action: navigate('activity', '/activity'),
    getAvailability: (shell) => explicitRouteAvailability(shell, 'activity'),
  },
  {
    id: 'history.open',
    category: 'NAVIGATION',
    label: 'Open History',
    description: 'Open change history',
    aliases: ['history', 'audit', '이력'],
    keywords: ['change history', 'events', 'audit trail', '변경 이력'],
    risk: 'READ',
    presentation: 'NAVIGATE',
    action: navigate('history', '/history'),
    getAvailability: (shell) => explicitRouteAvailability(shell, 'history'),
  },
];

export const createOwnerCommandRegistry = ({
  shell,
  isOffline = false,
  includeProjectSwitch = true,
  includeSearch = true,
}: OwnerCommandRegistryOptions): readonly OwnerCommandDefinition[] => {
  const templateCommands = HFM_COMMAND_TEMPLATES.filter(
    (template) => includeSearch || template.id !== 'search.global',
  ).map((template): OwnerCommandDefinition => {
    const state = template.getAvailability(shell, isOffline);
    return {
      id: template.id,
      category: template.category,
      label: template.label,
      description: template.description,
      aliases: template.aliases,
      keywords: template.keywords,
      ...state,
      risk: template.risk,
      presentation: template.presentation,
      action: template.action,
    };
  });

  const projectCommands = includeProjectSwitch
    ? shell.accessibleProjects
        .filter((project) => project.id !== shell.activeProject?.id)
        .map((project): OwnerCommandDefinition => ({
          id: 'project.switch',
          category: 'PROJECT',
          label: `Switch to ${project.label}`,
          description: `Use ${project.label} as the active Project`,
          aliases: ['switch project', 'project', '프로젝트 전환', '프로젝트 변경'],
          keywords: [project.label, 'switch', 'active project', '프로젝트'],
          availability: isOffline ? 'UNAVAILABLE_WITH_REASON' : 'AVAILABLE',
          ...(isOffline ? { reason: 'Project switching is unavailable while offline.' } : {}),
          risk: 'WRITE',
          presentation: 'DIALOG',
          context: { projectId: project.id },
          action: { kind: 'SWITCH_PROJECT', projectId: project.id },
        }))
    : [];

  return [...templateCommands, ...projectCommands].sort(
    (left, right) =>
      categoryOrder[left.category] - categoryOrder[right.category] ||
      left.label.localeCompare(right.label) ||
      left.id.localeCompare(right.id) ||
      (left.context?.projectId ?? '').localeCompare(right.context?.projectId ?? ''),
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
