import { describe, expect, it, vi } from 'vitest';

import { FrontendProductReadCoordinator } from '../../modules/frontend-product-read/src/index.js';

const scope = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Project One',
    isOwner: true,
    sensitivityClearance: 'private' as const,
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Project One',
      isOwner: true,
      sensitivityClearance: 'private' as const,
    },
  ],
  accessRevision: '1',
  policyContextRevision: '2',
};

describe('Frontend Product Read port replacement boundary', () => {
  it('composes independent Shell summary ports without creating domain writes', async () => {
    const shell = {
      getShell: vi.fn(async () => ({
        schemaVersion: '1.0.0' as const,
        principalId: scope.principalId,
        sessionId: scope.sessionId,
        activeProject: scope.activeProject,
        accessibleProjects: scope.accessibleProjects,
        navigation: [
          {
            id: 'home',
            label: 'Home',
            availability: 'AVAILABLE' as const,
            targetRoute: { routeId: 'home' as const, href: '/' as const },
          },
        ],
        features: [],
        readiness: [{ kind: 'SESSION_READY' as const, ready: true, required: true }],
        accessRevision: scope.accessRevision,
        policyContextRevision: scope.policyContextRevision,
        projectionRevision: 'shell-1',
        fetchedAt: '2026-07-29T00:00:00.000Z',
      })),
    };
    const background = {
      getSummary: vi.fn(async () => ({ activeCount: 1, failedCount: 0 })),
    };
    const notifications = {
      getSummary: vi.fn(async () => ({
        unreadCount: 2,
        presentationRevision: 'notifications-1',
      })),
    };
    const coordinator = new FrontendProductReadCoordinator(
      shell,
      { getHome: vi.fn() },
      background,
      notifications,
      { search: vi.fn() },
      { decide: vi.fn() },
    );

    await expect(coordinator.getGlobalShell(scope)).resolves.toMatchObject({
      background: { activeCount: 1, failedCount: 0 },
      notifications: { unreadCount: 2 },
    });
    expect(shell.getShell).toHaveBeenCalledOnce();
    expect(background.getSummary).toHaveBeenCalledOnce();
    expect(notifications.getSummary).toHaveBeenCalledOnce();
  });
});
