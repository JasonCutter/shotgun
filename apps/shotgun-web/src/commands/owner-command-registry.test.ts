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

    expect(commands.map((command) => command.id)).toEqual([
      'navigate.settings',
      'navigate.sources',
      'search.global',
      'project.switch.project-2',
    ]);
    expect(filterOwnerCommands(commands, 'SOURCES').map((command) => command.id)).toEqual([
      'navigate.sources',
    ]);
    expect(filterOwnerCommands(commands, '소스').map((command) => command.id)).toContain(
      'navigate.sources',
    );
    expect(filterOwnerCommands(commands, '프로젝트').map((command) => command.id)).toContain(
      'project.switch.project-2',
    );
    expect(commands.find((command) => command.id === 'navigate.sources')?.action).toEqual({
      kind: 'NAVIGATE',
      targetRoute: { routeId: 'sources', href: '/sources' },
    });
  });

  it('does not expose hidden or offline capabilities as selectable commands', () => {
    const commands = createOwnerCommandRegistry({ shell, isOffline: true });

    expect(commands.some((command) => command.label === 'Prototype')).toBe(false);
    expect(commands.find((command) => command.id === 'search.global')?.availability).toBe(
      'UNAVAILABLE_WITH_REASON',
    );
    expect(
      commands.find((command) => command.id === 'project.switch.project-2')?.availability,
    ).toBe('UNAVAILABLE_WITH_REASON');
    expect(filterOwnerCommands(commands, 'global search')).toHaveLength(1);
  });
});
