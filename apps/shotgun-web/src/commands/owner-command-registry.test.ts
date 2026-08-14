import type { GlobalShellView, ProjectListItemView } from '@shotgun/api-client';
import { describe, expect, it } from 'vitest';

import { createOwnerCommandRegistry, filterOwnerCommands } from './owner-command-registry.js';

const shell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Current Project',
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Current Project',
      isOwner: true,
      sensitivityClearance: 'private',
    },
    {
      id: 'project-2',
      label: 'Research Project',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  navigation: [
    {
      id: 'sources',
      label: 'Sources',
      availability: 'AVAILABLE',
      targetRoute: { routeId: 'sources', href: '/sources' },
    },
    {
      id: 'settings',
      label: 'Settings',
      availability: 'AVAILABLE',
      targetRoute: { routeId: 'settings', href: '/settings' },
    },
    {
      id: 'prototype',
      label: 'Prototype',
      availability: 'HIDDEN',
    },
    {
      id: 'knowledge',
      label: 'Knowledge',
      availability: 'COMING_LATER',
    },
    {
      id: 'review',
      label: 'Review',
      availability: 'COMING_LATER',
    },
  ],
  features: [
    { id: 'global-search', label: 'Search', availability: 'AVAILABLE' },
    { id: 'cross-project-search', label: 'Cross-project Search', availability: 'AVAILABLE' },
  ],
  readiness: [],
  background: { activeCount: 0, failedCount: 0 },
  notifications: { unreadCount: 0, presentationRevision: 'notifications-1' },
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  projectionRevision: 'projection-1',
  fetchedAt: '2026-08-14T00:00:00.000Z',
};

const projects: readonly ProjectListItemView[] = [
  {
    id: 'project-1',
    name: 'Current Project',
    description: '',
    isOwner: true,
    status: 'ACTIVE',
    active: true,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    revision: 3,
    capability: {
      canRename: true,
      canArchive: true,
      canRestore: false,
      canDelete: true,
      canManagePolicies: true,
    },
  },
  {
    id: 'project-3',
    name: 'Archived Project',
    description: '',
    isOwner: true,
    status: 'ARCHIVED',
    active: false,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    revision: 4,
    capability: {
      canRename: false,
      canArchive: false,
      canRestore: true,
      canDelete: false,
      canManagePolicies: false,
    },
  },
];

describe('owner command registry', () => {
  it('keeps stable IDs separate from localized discovery terms', () => {
    const commands = createOwnerCommandRegistry({ shell, projects });

    expect(commands.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        'help.commands',
        'search.global',
        'project.manage',
        'project.switch',
        'preferences.locale',
        'preferences.timezone',
        'preferences.display',
        'ai.configure',
        'privacy.open',
        'knowledge.open',
        'review.open',
        'external_action.open',
        'activity.open',
        'history.open',
      ]),
    );
    expect(commands.some((command) => command.id.startsWith('navigate.'))).toBe(false);
    expect(filterOwnerCommands(commands, 'SOURCES')).toHaveLength(0);
    expect(filterOwnerCommands(commands, 'Research Project').map((command) => command.id)).toEqual([
      'project.switch',
    ]);
    expect(filterOwnerCommands(commands, '검색').map((command) => command.id)).toContain(
      'search.global',
    );
    expect(filterOwnerCommands(commands, '프로젝트').map((command) => command.id)).toEqual(
      expect.arrayContaining(['project.manage', 'project.switch']),
    );
    expect(filterOwnerCommands(commands, '지식').map((command) => command.id)).toContain(
      'knowledge.open',
    );
    expect(filterOwnerCommands(commands, '검토').map((command) => command.id)).toContain(
      'review.open',
    );
    expect(filterOwnerCommands(commands, '이력').map((command) => command.id)).toContain(
      'history.open',
    );
    expect(commands.find((command) => command.id === 'knowledge.open')?.action).toEqual({
      kind: 'NAVIGATE',
      targetRoute: { routeId: 'knowledge', href: '/knowledge' },
    });
    expect(commands.find((command) => command.id === 'project.switch')).toMatchObject({
      id: 'project.switch',
      context: { projectId: 'project-2' },
      action: { kind: 'SWITCH_PROJECT', projectId: 'project-2' },
    });
    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'preferences.locale',
          category: 'PREFERENCES',
          risk: 'WRITE',
          action: { kind: 'OPEN_PREFERENCE_FLOW', commandId: 'preferences.locale' },
        }),
        expect.objectContaining({
          id: 'preferences.timezone',
          category: 'PREFERENCES',
          risk: 'WRITE',
          action: { kind: 'OPEN_PREFERENCE_FLOW', commandId: 'preferences.timezone' },
        }),
        expect.objectContaining({
          id: 'preferences.display',
          category: 'PREFERENCES',
          risk: 'WRITE',
          action: { kind: 'OPEN_PREFERENCE_FLOW', commandId: 'preferences.display' },
        }),
      ]),
    );
  });

  it('does not expose generic Settings or unsupported placeholders and preserves offline state', () => {
    const commands = createOwnerCommandRegistry({ shell, isOffline: true, projects });

    expect(commands.some((command) => command.label === 'Prototype')).toBe(false);
    expect(commands.some((command) => command.id === 'navigate.settings')).toBe(false);
    expect(commands.some((command) => command.id === 'settings')).toBe(false);
    expect(commands.some((command) => command.id === 'diagnostics.open')).toBe(false);
    expect(commands.find((command) => command.id === 'search.global')?.availability).toBe(
      'UNAVAILABLE_WITH_REASON',
    );
    expect(commands.find((command) => command.id === 'project.switch')?.availability).toBe(
      'UNAVAILABLE_WITH_REASON',
    );
    expect(commands.find((command) => command.id === 'preferences.locale')).toMatchObject({
      availability: 'UNAVAILABLE_WITH_REASON',
      reason: 'Preferences are unavailable while offline.',
    });
    expect(commands.find((command) => command.id === 'preferences.timezone')).toMatchObject({
      availability: 'UNAVAILABLE_WITH_REASON',
      reason: 'Preferences are unavailable while offline.',
    });
    expect(commands.find((command) => command.id === 'preferences.display')).toMatchObject({
      availability: 'UNAVAILABLE_WITH_REASON',
      reason: 'Preferences are unavailable while offline.',
    });
    expect(filterOwnerCommands(commands, 'global search')).toHaveLength(1);
  });

  it('keeps historical placeholders from suppressing confirmed capabilities', () => {
    const commands = createOwnerCommandRegistry({ shell, projects });

    expect(commands.find((command) => command.id === 'knowledge.open')?.availability).toBe(
      'AVAILABLE',
    );
    expect(commands.find((command) => command.id === 'review.open')?.availability).toBe(
      'AVAILABLE',
    );
  });

  it('preserves hidden and temporarily unavailable route states', () => {
    const hiddenShell: GlobalShellView = {
      ...shell,
      navigation: [
        ...shell.navigation,
        {
          id: 'activity-hidden',
          label: 'Activity',
          availability: 'HIDDEN',
          targetRoute: { routeId: 'activity', href: '/activity' },
        },
      ],
    };
    const temporarilyUnavailableShell: GlobalShellView = {
      ...shell,
      navigation: [
        ...shell.navigation,
        {
          id: 'activity-unavailable',
          label: 'Activity',
          availability: 'TEMPORARILY_UNAVAILABLE',
          reason: 'Create a Project to open Activity.',
          targetRoute: { routeId: 'activity', href: '/activity' },
        },
      ],
    };

    expect(
      createOwnerCommandRegistry({ shell: hiddenShell, projects }).find(
        (command) => command.id === 'activity.open',
      )?.availability,
    ).toBe('HIDDEN');
    expect(
      createOwnerCommandRegistry({ shell: temporarilyUnavailableShell, projects }).find(
        (command) => command.id === 'activity.open',
      ),
    ).toMatchObject({
      availability: 'UNAVAILABLE_WITH_REASON',
      reason: 'Create a Project to open Activity.',
    });
  });

  it('carries frozen risk and presentation metadata without turning the registry into policy', () => {
    const commands = createOwnerCommandRegistry({ shell, projects });

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'help.commands', risk: 'READ', presentation: 'DIALOG' }),
        expect.objectContaining({ id: 'search.global', risk: 'READ', presentation: 'DIALOG' }),
        expect.objectContaining({ id: 'project.switch', risk: 'WRITE', presentation: 'DIALOG' }),
        expect.objectContaining({ id: 'ai.configure', risk: 'WRITE', presentation: 'DRAWER' }),
        expect.objectContaining({ id: 'knowledge.open', risk: 'READ', presentation: 'NAVIGATE' }),
      ]),
    );
  });

  it('exposes Project controls through focused flows and hides invalid lifecycle actions', () => {
    const commands = createOwnerCommandRegistry({ shell, projects });

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'project.manage',
          risk: 'READ',
          presentation: 'DRAWER',
          action: { kind: 'OPEN_PROJECT_FLOW', commandId: 'project.manage' },
        }),
        expect.objectContaining({
          id: 'project.create',
          risk: 'WRITE',
          action: { kind: 'OPEN_PROJECT_FLOW', commandId: 'project.create' },
        }),
        expect.objectContaining({ id: 'project.rename', risk: 'WRITE' }),
        expect.objectContaining({ id: 'project.archive', risk: 'WRITE' }),
        expect.objectContaining({ id: 'project.restore', risk: 'WRITE' }),
        expect.objectContaining({ id: 'project.delete_request', risk: 'DESTRUCTIVE' }),
      ]),
    );

    const noRestoreProjects = projects.map((project) => ({
      ...project,
      capability: { ...project.capability, canRestore: false },
    }));
    expect(
      createOwnerCommandRegistry({ shell, projects: noRestoreProjects }).find(
        (command) => command.id === 'project.restore',
      )?.availability,
    ).toBe('HIDDEN');
    expect(commands.some((command) => command.id === 'navigate.settings')).toBe(false);
  });
});
