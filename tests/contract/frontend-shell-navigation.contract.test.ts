import { describe, expect, it } from 'vitest';

import {
  InMemoryActionCenterProjection,
  InMemoryGlobalShellProjection,
} from '../../adapters/frontend-product-read-in-memory/src/index.js';
import type { FrontendReadScope } from '../../modules/frontend-product-read/src/index.js';

/**
 * Review 4865177355 item 1 — the External Action Governance Workspace is
 * reachable from BOTH Home and Command Palette navigation, and those entries
 * only navigate (never direct execution; AC-18).
 */

const project = {
  id: 'project-1',
  label: 'Project One',
  isOwner: true,
  sensitivityClearance: 'private' as const,
};

const scope: FrontendReadScope = {
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: project,
  accessibleProjects: [project],
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
};

describe('Frontend Shell navigation — External Action Workspace entry (FE-P4-S2 WP5)', () => {
  it('exposes the external-action Command Palette navigation entry when a Project is ready', async () => {
    const shell = await new InMemoryGlobalShellProjection().getShell(scope);
    const item = shell.navigation.find((entry) => entry.id === 'external-action');
    expect(item).toBeDefined();
    expect(item?.label).toBe('External actions');
    expect(item?.availability).toBe('AVAILABLE');
    expect(item?.targetRoute).toEqual({ routeId: 'external-action', href: '/external-action' });
  });

  it('marks the external-action entry temporarily unavailable without a Project', async () => {
    const shell = await new InMemoryGlobalShellProjection().getShell({
      ...scope,
      activeProject: null,
      accessibleProjects: [],
    });
    const item = shell.navigation.find((entry) => entry.id === 'external-action');
    expect(item?.availability).toBe('TEMPORARILY_UNAVAILABLE');
    expect(item?.reason).toContain('Project');
  });

  it('Home primary action navigates to the governance workspace and never executes (AC-18)', async () => {
    const home = await new InMemoryActionCenterProjection().getHome({
      ...scope,
      activeProject: project,
    });
    const action = home.primaryActions.find((entry) => entry.id === 'govern-external-action');
    expect(action).toBeDefined();
    expect(action?.availability).toBe('AVAILABLE');
    expect(action?.targetRoute).toEqual({ routeId: 'external-action', href: '/external-action' });
    // Navigation-only: the primary action carries no command/execution surface.
    expect('command' in (action ?? {})).toBe(false);
    expect('capabilities' in (action ?? {})).toBe(false);
  });
});
