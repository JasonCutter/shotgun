import type { GlobalShellView } from '@shotgun/api-client';
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

describe('owner command registry', () => {
  it('keeps stable IDs separate from localized discovery terms', () => {
    const commands = createOwnerCommandRegistry({ shell });

    expect(commands.map((command) => command.id)).toEqual(
      expect.arrayContaining([
        'help.commands',
        'search.global',
        'project.manage',
        'project.switch',
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
    expect(commands.find((command) => command.id === 'knowledge.open')?.availability).toBe(
      'AVAILABLE',
    );
    expect(commands.find((command) => command.id === 'review.open')?.availability).toBe(
      'AVAILABLE',
    );
  });

  it('does not expose generic Settings or unsupported placeholders and preserves offline state', () => {
    const commands = createOwnerCommandRegistry({ shell, isOffline: true });

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
    expect(filterOwnerCommands(commands, 'global search')).toHaveLength(1);
  });

  it('carries frozen risk and presentation metadata without turning the registry into policy', () => {
    const commands = createOwnerCommandRegistry({ shell });

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
});
