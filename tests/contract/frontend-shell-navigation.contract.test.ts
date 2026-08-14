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

describe('Frontend Shell HFM-S3 persistent navigation', () => {
  it('exposes exactly Home, Sources, and Ask when a Project is ready', async () => {
    const shell = await new InMemoryGlobalShellProjection().getShell(scope);
    expect(shell.navigation).toEqual([
      {
        id: 'home',
        label: 'Home',
        availability: 'AVAILABLE',
        targetRoute: { routeId: 'home', href: '/' },
      },
      {
        id: 'sources',
        label: 'Sources',
        availability: 'AVAILABLE',
        targetRoute: { routeId: 'sources', href: '/sources' },
      },
      {
        id: 'ask',
        label: 'Ask',
        availability: 'AVAILABLE',
        targetRoute: { routeId: 'ask', href: '/ask' },
      },
    ]);
  });

  it('does not advertise disabled workspace placeholders without a Project', async () => {
    const shell = await new InMemoryGlobalShellProjection().getShell({
      ...scope,
      activeProject: null,
      accessibleProjects: [],
    });
    expect(shell.navigation).toEqual([]);
    expect(shell.leadingWarning?.code).toBe('PROJECT_SETUP_REQUIRED');
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
