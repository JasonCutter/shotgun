import type { GlobalShellView, ProjectListItemView, TargetRouteView } from '@shotgun/api-client';
import type { ProductMessageKey } from '../localization/product-localization.js';

import type { AnswerCommandContext } from './answer-command-context.js';

export type OwnerCommandCategory =
  | 'HELP'
  | 'SEARCH'
  | 'PROJECT'
  | 'ANSWER'
  | 'AI'
  | 'PRIVACY'
  | 'PREFERENCES'
  | 'NAVIGATION'
  | 'INSPECTION';

export type OwnerCommandAvailability = 'AVAILABLE' | 'UNAVAILABLE_WITH_REASON' | 'HIDDEN';

export type OwnerCommandRisk = 'READ' | 'WRITE' | 'DESTRUCTIVE';

export type OwnerCommandPresentation = 'NAVIGATE' | 'DIALOG' | 'DRAWER' | 'INLINE' | 'EXECUTE';

export type ProjectCommandId =
  | 'project.manage'
  | 'project.create'
  | 'project.rename'
  | 'project.archive'
  | 'project.restore'
  | 'project.delete_request';

export type PreferenceCommandId =
  'preferences.locale' | 'preferences.timezone' | 'preferences.display';

export type AICommandId = 'ai.configure' | 'ai.test_connection';

export type PrivacyCommandId = 'privacy.open' | 'privacy.review';

export type AnswerCommandId =
  | 'answer.export'
  | 'action.retry'
  | 'answer.propose_intake'
  | 'answer.propose_change'
  | 'answer.propose_directive';

export type OwnerCommandAction =
  | { readonly kind: 'NAVIGATE'; readonly targetRoute: TargetRouteView }
  | { readonly kind: 'NAVIGATE_PATH'; readonly href: '/settings/ai' | '/settings/privacy' }
  | { readonly kind: 'OPEN_COMMANDS' }
  | { readonly kind: 'OPEN_SEARCH' }
  | { readonly kind: 'OPEN_PROJECT_FLOW'; readonly commandId: ProjectCommandId }
  | { readonly kind: 'OPEN_PREFERENCE_FLOW'; readonly commandId: PreferenceCommandId }
  | { readonly kind: 'OPEN_AI_FLOW'; readonly commandId: AICommandId }
  | { readonly kind: 'OPEN_PRIVACY_FLOW'; readonly commandId: PrivacyCommandId }
  | { readonly kind: 'OPEN_ANSWER_FLOW'; readonly commandId: AnswerCommandId }
  | { readonly kind: 'OPEN_TECHNICAL_FLOW'; readonly commandId: 'technical.current' }
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
  readonly reasonKey?: ProductMessageKey;
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
  readonly hasTechnicalInspection?: boolean;
  readonly answerContext?: AnswerCommandContext;
  readonly answerCommandPending?: boolean;
  readonly projects?: readonly ProjectListItemView[];
};

type OwnerCommandTemplate = Omit<
  OwnerCommandDefinition,
  'availability' | 'reason' | 'reasonKey' | 'context'
> & {
  readonly getAvailability: (
    shell: GlobalShellView,
    isOffline: boolean,
    projects: readonly ProjectListItemView[] | undefined,
    hasTechnicalInspection: boolean,
  ) => Pick<OwnerCommandDefinition, 'availability' | 'reason' | 'reasonKey'>;
};

const categoryOrder: Record<OwnerCommandCategory, number> = {
  HELP: 0,
  SEARCH: 1,
  PROJECT: 2,
  ANSWER: 3,
  AI: 4,
  PRIVACY: 5,
  PREFERENCES: 6,
  NAVIGATION: 7,
  INSPECTION: 8,
};

const ANSWER_COMMAND_TEMPLATES: readonly Omit<
  OwnerCommandDefinition,
  'availability' | 'reason' | 'reasonKey'
>[] = [
  {
    id: 'answer.export',
    category: 'ANSWER',
    label: 'Export answer',
    description: 'Export the selected answer as Markdown',
    aliases: ['answer export', 'export answer'],
    keywords: ['answer', 'markdown', 'download'],
    risk: 'READ',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_ANSWER_FLOW', commandId: 'answer.export' },
  },
  {
    id: 'action.retry',
    category: 'ANSWER',
    label: 'Retry answer',
    description: 'Retry the selected answer with an available mode',
    aliases: ['answer retry', 'retry answer'],
    keywords: ['answer', 'same context', 'current policy', 'recovery'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_ANSWER_FLOW', commandId: 'action.retry' },
  },
  {
    id: 'answer.propose_intake',
    category: 'ANSWER',
    label: 'Propose Intake Draft',
    description: 'Create an Intake Draft proposal from the selected answer',
    aliases: ['answer intake', 'propose intake'],
    keywords: ['answer', 'draft', 'intake'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_ANSWER_FLOW', commandId: 'answer.propose_intake' },
  },
  {
    id: 'answer.propose_change',
    category: 'ANSWER',
    label: 'Propose Draft ChangeSet',
    description: 'Create a Draft ChangeSet proposal from the selected answer',
    aliases: ['answer change', 'propose change'],
    keywords: ['answer', 'draft', 'change set', 'review'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_ANSWER_FLOW', commandId: 'answer.propose_change' },
  },
  {
    id: 'answer.propose_directive',
    category: 'ANSWER',
    label: 'Propose Directive',
    description: 'Create a User Directive proposal from the selected answer',
    aliases: ['answer directive', 'propose directive'],
    keywords: ['answer', 'directive', 'proposal'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_ANSWER_FLOW', commandId: 'answer.propose_directive' },
  },
];

const answerCommandAvailability = (
  commandId: AnswerCommandId,
  context: AnswerCommandContext | undefined,
  isOffline: boolean,
  commandPending: boolean,
): Pick<OwnerCommandDefinition, 'availability' | 'reason' | 'reasonKey'> => {
  if (!context) return { availability: 'HIDDEN' };
  if (isOffline) {
    return {
      availability: 'UNAVAILABLE_WITH_REASON',
      reasonKey: 'commands.unavailable.answer_offline',
    };
  }
  if (commandPending) {
    return {
      availability: 'UNAVAILABLE_WITH_REASON',
      reasonKey: 'commands.unavailable.answer_pending',
    };
  }
  const available =
    commandId === 'answer.export'
      ? context.capabilities.includes('EXPORT')
      : commandId === 'action.retry'
        ? context.capabilities.includes('RETRY_SAME_CONTEXT') ||
          context.capabilities.includes('RETRY_CURRENT_POLICY')
        : commandId === 'answer.propose_intake'
          ? context.capabilities.includes('CREATE_INTAKE_DRAFT')
          : commandId === 'answer.propose_change'
            ? context.capabilities.includes('CREATE_DRAFT_CHANGE_SET')
            : context.capabilities.includes('PROPOSE_DIRECTIVE');
  return { availability: available ? 'AVAILABLE' : 'HIDDEN' };
};

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const navigationAvailability = (
  item: GlobalShellView['navigation'][number],
): Pick<OwnerCommandDefinition, 'availability' | 'reason' | 'reasonKey'> => {
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
): Pick<OwnerCommandDefinition, 'availability' | 'reason' | 'reasonKey'> => {
  const navigationItem = shell.navigation.find((item) => item.targetRoute?.routeId === routeId);
  return navigationItem ? navigationAvailability(navigationItem) : { availability: 'AVAILABLE' };
};

const establishedWorkspaceAvailability = (
  shell: GlobalShellView,
  routeId: TargetRouteView['routeId'],
): Pick<OwnerCommandDefinition, 'availability' | 'reason' | 'reasonKey'> => {
  const navigationItem = shell.navigation.find((item) => item.targetRoute?.routeId === routeId);
  if (!navigationItem || navigationItem.availability !== 'AVAILABLE') {
    return { availability: 'HIDDEN' };
  }
  return { availability: 'AVAILABLE' };
};

const featureAvailability = (
  feature: GlobalShellView['features'][number] | undefined,
  isOffline: boolean,
): Pick<OwnerCommandDefinition, 'availability' | 'reason' | 'reasonKey'> => {
  if (isOffline) {
    return {
      availability: 'UNAVAILABLE_WITH_REASON',
      reasonKey: 'commands.unavailable.search_offline',
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

const projectCommandAvailability = (
  commandId: ProjectCommandId,
  shell: GlobalShellView,
  isOffline: boolean,
  projects: readonly ProjectListItemView[] | undefined,
): Pick<OwnerCommandDefinition, 'availability' | 'reason' | 'reasonKey'> => {
  if (isOffline) {
    return {
      availability: 'UNAVAILABLE_WITH_REASON',
      reasonKey: 'commands.unavailable.project_offline',
    };
  }
  if (!projects) return { availability: 'HIDDEN' };
  if (commandId === 'project.manage') return { availability: 'AVAILABLE' };
  if (commandId === 'project.create') {
    return shell.activeProject ? { availability: 'AVAILABLE' } : { availability: 'HIDDEN' };
  }
  if (!shell.activeProject) return { availability: 'HIDDEN' };

  const capability = {
    'project.rename': 'canRename',
    'project.archive': 'canArchive',
    'project.restore': 'canRestore',
    'project.delete_request': 'canDelete',
  } as const;
  const capabilityKey =
    capability[commandId as Exclude<ProjectCommandId, 'project.manage' | 'project.create'>];
  const hasEligibleProject = projects.some((project) => project.capability[capabilityKey]);
  return hasEligibleProject ? { availability: 'AVAILABLE' } : { availability: 'HIDDEN' };
};

const preferenceCommandAvailability = (
  shell: GlobalShellView,
  isOffline: boolean,
): Pick<OwnerCommandDefinition, 'availability' | 'reason' | 'reasonKey'> => {
  if (isOffline) {
    return {
      availability: 'UNAVAILABLE_WITH_REASON',
      reasonKey: 'commands.unavailable.preferences_offline',
    };
  }
  if (!shell.activeProject) {
    return {
      availability: 'UNAVAILABLE_WITH_REASON',
      reasonKey: 'commands.unavailable.preferences_project_required',
    };
  }
  return { availability: 'AVAILABLE' };
};

const focusedCommandAvailability = (
  shell: GlobalShellView,
  isOffline: boolean,
  label: string,
  reasonKey: ProductMessageKey,
): Pick<OwnerCommandDefinition, 'availability' | 'reason' | 'reasonKey'> => {
  if (isOffline) {
    return {
      availability: 'UNAVAILABLE_WITH_REASON',
      reasonKey,
    };
  }
  if (!shell.activeProject) {
    return {
      availability: 'HIDDEN',
    };
  }
  return { availability: 'AVAILABLE' };
};

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
    presentation: 'DRAWER',
    action: { kind: 'OPEN_PROJECT_FLOW', commandId: 'project.manage' },
    getAvailability: (shell, isOffline, projects) =>
      projectCommandAvailability('project.manage', shell, isOffline, projects),
  },
  {
    id: 'project.create',
    category: 'PROJECT',
    label: 'Create Project',
    description: 'Create an additional Project',
    aliases: ['new project', 'add project', '프로젝트 만들기'],
    keywords: ['project administration', 'project setup', '프로젝트 생성'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_PROJECT_FLOW', commandId: 'project.create' },
    getAvailability: (shell, isOffline, projects) =>
      projectCommandAvailability('project.create', shell, isOffline, projects),
  },
  {
    id: 'project.rename',
    category: 'PROJECT',
    label: 'Rename Project',
    description: 'Change a Project name',
    aliases: ['rename project', '프로젝트 이름 변경'],
    keywords: ['project identity', '프로젝트'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_PROJECT_FLOW', commandId: 'project.rename' },
    getAvailability: (shell, isOffline, projects) =>
      projectCommandAvailability('project.rename', shell, isOffline, projects),
  },
  {
    id: 'project.archive',
    category: 'PROJECT',
    label: 'Archive Project',
    description: 'Archive a Project after confirmation',
    aliases: ['archive project', '프로젝트 보관'],
    keywords: ['project lifecycle', '프로젝트'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_PROJECT_FLOW', commandId: 'project.archive' },
    getAvailability: (shell, isOffline, projects) =>
      projectCommandAvailability('project.archive', shell, isOffline, projects),
  },
  {
    id: 'project.restore',
    category: 'PROJECT',
    label: 'Restore Project',
    description: 'Restore a Project when valid',
    aliases: ['restore project', '프로젝트 복원'],
    keywords: ['project lifecycle', '프로젝트'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_PROJECT_FLOW', commandId: 'project.restore' },
    getAvailability: (shell, isOffline, projects) =>
      projectCommandAvailability('project.restore', shell, isOffline, projects),
  },
  {
    id: 'project.delete_request',
    category: 'PROJECT',
    label: 'Request Project Deletion',
    description: 'Request deletion after explicit confirmation',
    aliases: ['delete project', 'remove project', '프로젝트 삭제 요청'],
    keywords: ['project lifecycle', 'destructive', '프로젝트'],
    risk: 'DESTRUCTIVE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_PROJECT_FLOW', commandId: 'project.delete_request' },
    getAvailability: (shell, isOffline, projects) =>
      projectCommandAvailability('project.delete_request', shell, isOffline, projects),
  },
  {
    id: 'preferences.locale',
    category: 'PREFERENCES',
    label: 'Set Locale',
    description: 'Change the owner locale and language preference',
    aliases: ['locale', 'language', 'preferences locale'],
    keywords: ['preferences', 'language', 'regional'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_PREFERENCE_FLOW', commandId: 'preferences.locale' },
    getAvailability: (shell, isOffline) => preferenceCommandAvailability(shell, isOffline),
  },
  {
    id: 'preferences.timezone',
    category: 'PREFERENCES',
    label: 'Set Timezone',
    description: 'Change the owner timezone preference',
    aliases: ['timezone', 'time zone', 'preferences timezone'],
    keywords: ['preferences', 'regional', 'time'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_PREFERENCE_FLOW', commandId: 'preferences.timezone' },
    getAvailability: (shell, isOffline) => preferenceCommandAvailability(shell, isOffline),
  },
  {
    id: 'preferences.display',
    category: 'PREFERENCES',
    label: 'Display Preferences',
    description: 'Change date, density, and motion preferences',
    aliases: ['display', 'appearance', 'preferences display'],
    keywords: ['preferences', 'date format', 'screen density', 'reduced motion'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_PREFERENCE_FLOW', commandId: 'preferences.display' },
    getAvailability: (shell, isOffline) => preferenceCommandAvailability(shell, isOffline),
  },
  {
    id: 'ai.configure',
    category: 'AI',
    label: 'Configure AI',
    description: 'Open focused AI configuration',
    aliases: ['ai settings', 'provider settings', 'AI 설정'],
    keywords: ['model', 'provider', 'credential', '모델', '제공자'],
    risk: 'WRITE',
    presentation: 'DRAWER',
    action: { kind: 'OPEN_AI_FLOW', commandId: 'ai.configure' },
    getAvailability: (shell, isOffline) =>
      focusedCommandAvailability(
        shell,
        isOffline,
        'AI configuration',
        'commands.unavailable.ai_configuration_offline',
      ),
  },
  {
    id: 'ai.test_connection',
    category: 'AI',
    label: 'Test AI Connection',
    description: 'Check the selected AI provider connection',
    aliases: ['test ai', 'ai connection', 'connection test'],
    keywords: ['ai', 'provider', 'model', 'connection'],
    risk: 'READ',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_AI_FLOW', commandId: 'ai.test_connection' },
    getAvailability: (shell, isOffline) =>
      focusedCommandAvailability(
        shell,
        isOffline,
        'AI connection test',
        'commands.unavailable.ai_test_offline',
      ),
  },
  {
    id: 'privacy.open',
    category: 'PRIVACY',
    label: 'Open Privacy',
    description: 'Review privacy and external transfer settings',
    aliases: ['privacy', 'data transfer', '개인정보', '외부 전송'],
    keywords: ['retention', 'external ai', 'privacy settings', '개인정보 설정'],
    risk: 'READ',
    presentation: 'DRAWER',
    action: { kind: 'OPEN_PRIVACY_FLOW', commandId: 'privacy.open' },
    getAvailability: (shell, isOffline) =>
      focusedCommandAvailability(
        shell,
        isOffline,
        'Privacy',
        'commands.unavailable.privacy_open_offline',
      ),
  },
  {
    id: 'privacy.review',
    category: 'PRIVACY',
    label: 'Review Privacy',
    description: 'Request or approve external AI transfer review',
    aliases: ['privacy review', 'external transfer review'],
    keywords: ['privacy', 'external transfer', 'approval', 'review'],
    risk: 'WRITE',
    presentation: 'DIALOG',
    action: { kind: 'OPEN_PRIVACY_FLOW', commandId: 'privacy.review' },
    getAvailability: (shell, isOffline) =>
      focusedCommandAvailability(
        shell,
        isOffline,
        'Privacy review',
        'commands.unavailable.privacy_review_offline',
      ),
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
    getAvailability: (shell) => establishedWorkspaceAvailability(shell, 'knowledge'),
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
    getAvailability: (shell) => establishedWorkspaceAvailability(shell, 'review'),
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
    category: 'INSPECTION',
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
    category: 'INSPECTION',
    label: 'Open History',
    description: 'Open change history',
    aliases: ['history', 'audit', '이력'],
    keywords: ['change history', 'events', 'audit trail', '변경 이력'],
    risk: 'READ',
    presentation: 'NAVIGATE',
    action: navigate('history', '/history'),
    getAvailability: (shell) => explicitRouteAvailability(shell, 'history'),
  },
  {
    id: 'technical.current',
    category: 'INSPECTION',
    label: 'Technical information',
    description: 'Inspect technical information registered by the current view',
    aliases: ['technical', 'technical details', 'inspect', 'debug info', '기술 정보', '상세 정보'],
    keywords: ['current view', 'identifiers', 'revisions', 'technical inspection', '디버그 정보'],
    risk: 'READ',
    presentation: 'DRAWER',
    action: { kind: 'OPEN_TECHNICAL_FLOW', commandId: 'technical.current' },
    getAvailability: (_shell, _isOffline, _projects, hasTechnicalInspection) => ({
      availability: hasTechnicalInspection ? 'AVAILABLE' : 'HIDDEN',
    }),
  },
];

export const createOwnerCommandRegistry = ({
  shell,
  isOffline = false,
  includeProjectSwitch = true,
  includeSearch = true,
  hasTechnicalInspection = false,
  answerContext,
  answerCommandPending = false,
  projects,
}: OwnerCommandRegistryOptions): readonly OwnerCommandDefinition[] => {
  const templateCommands = HFM_COMMAND_TEMPLATES.filter(
    (template) => includeSearch || template.id !== 'search.global',
  ).map((template): OwnerCommandDefinition => {
    const state = template.getAvailability(shell, isOffline, projects, hasTechnicalInspection);
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
          ...(isOffline ? { reasonKey: 'commands.unavailable.project_switch_offline' } : {}),
          risk: 'WRITE',
          presentation: 'DIALOG',
          context: { projectId: project.id },
          action: { kind: 'SWITCH_PROJECT', projectId: project.id },
        }))
    : [];

  const answerCommands = ANSWER_COMMAND_TEMPLATES.map((template) => ({
    ...template,
    ...answerCommandAvailability(
      template.id as AnswerCommandId,
      answerContext,
      isOffline,
      answerCommandPending,
    ),
  }));

  return [...templateCommands, ...answerCommands, ...projectCommands].sort(
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
