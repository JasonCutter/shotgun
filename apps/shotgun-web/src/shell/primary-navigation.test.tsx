import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { GlobalShellView } from '@shotgun/api-client';

import type { OwnerCommandController } from '../section3/global-tools.js';
import { PrimaryNavigation } from './primary-navigation.js';

const navigation: GlobalShellView['navigation'] = [
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
];

const controller = (executeCommand = vi.fn()): OwnerCommandController => ({
  executeCommand,
  commands: [
    {
      id: 'search.global',
      category: 'SEARCH',
      label: 'Search',
      description: 'Search the active Project',
      aliases: [],
      keywords: [],
      availability: 'AVAILABLE',
      risk: 'READ',
      presentation: 'DIALOG',
      action: { kind: 'OPEN_SEARCH' },
    },
    {
      id: 'ai.configure',
      category: 'AI',
      label: 'Configure AI',
      description: 'Configure AI',
      aliases: [],
      keywords: [],
      availability: 'AVAILABLE',
      risk: 'WRITE',
      presentation: 'DRAWER',
      action: { kind: 'OPEN_AI_FLOW', commandId: 'ai.configure' },
    },
    {
      id: 'privacy.open',
      category: 'PRIVACY',
      label: 'Open Privacy',
      description: 'Open Privacy',
      aliases: [],
      keywords: [],
      availability: 'AVAILABLE',
      risk: 'READ',
      presentation: 'DRAWER',
      action: { kind: 'OPEN_PRIVACY_FLOW', commandId: 'privacy.open' },
    },
    {
      id: 'preferences.locale',
      category: 'PREFERENCES',
      label: 'Set Locale',
      description: 'Set Locale',
      aliases: [],
      keywords: [],
      availability: 'AVAILABLE',
      risk: 'WRITE',
      presentation: 'DIALOG',
      action: { kind: 'OPEN_PREFERENCE_FLOW', commandId: 'preferences.locale' },
    },
    {
      id: 'preferences.timezone',
      category: 'PREFERENCES',
      label: 'Set Timezone',
      description: 'Set Timezone',
      aliases: [],
      keywords: [],
      availability: 'AVAILABLE',
      risk: 'WRITE',
      presentation: 'DIALOG',
      action: { kind: 'OPEN_PREFERENCE_FLOW', commandId: 'preferences.timezone' },
    },
    {
      id: 'preferences.display',
      category: 'PREFERENCES',
      label: 'Display Preferences',
      description: 'Display Preferences',
      aliases: [],
      keywords: [],
      availability: 'AVAILABLE',
      risk: 'WRITE',
      presentation: 'DIALOG',
      action: { kind: 'OPEN_PREFERENCE_FLOW', commandId: 'preferences.display' },
    },
    {
      id: 'project.manage',
      category: 'PROJECT',
      label: 'Manage Projects',
      description: 'Manage Projects',
      aliases: [],
      keywords: [],
      availability: 'AVAILABLE',
      risk: 'READ',
      presentation: 'DRAWER',
      action: { kind: 'OPEN_PROJECT_FLOW', commandId: 'project.manage' },
    },
  ],
});

describe('PrimaryNavigation HFM-S7-C2 Tree', () => {
  it('renders the frozen PC Tree and invokes Search and Settings through the shared controller', async () => {
    const user = userEvent.setup();
    const executeCommand = vi.fn();
    const sharedController = controller(executeCommand);
    render(
      <MemoryRouter>
        <PrimaryNavigation navigation={navigation} controller={sharedController} />
      </MemoryRouter>,
    );

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(primaryNavigation).getByRole('link', { name: 'Home' })).toBeTruthy();
    expect(within(primaryNavigation).getByText('Sources', { selector: 'summary' })).toBeTruthy();
    expect(
      within(primaryNavigation).getByRole('link', { name: 'Library' }).getAttribute('href'),
    ).toBe('/sources');
    expect(
      within(primaryNavigation).getByRole('link', { name: 'Add Source' }).getAttribute('href'),
    ).toBe('/sources?view=add');
    expect(within(primaryNavigation).getByText('Ask', { selector: 'summary' })).toBeTruthy();
    expect(within(primaryNavigation).getByRole('link', { name: 'Conversations' })).toBeTruthy();
    expect(within(primaryNavigation).getByText('Settings', { selector: 'summary' })).toBeTruthy();
    expect(
      within(primaryNavigation).queryByText('Preferences', { selector: 'summary' }),
    ).toBeNull();
    expect(within(primaryNavigation).queryByText('Knowledge', { exact: true })).toBeNull();
    expect(within(primaryNavigation).queryByText('Review', { exact: true })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).toBeNull();

    expect(within(primaryNavigation).getByRole('button', { name: 'AI' })).toBeTruthy();
    expect(within(primaryNavigation).getByRole('button', { name: 'Privacy' })).toBeTruthy();
    expect(
      within(primaryNavigation).getByRole('link', { name: 'Preferences' }).getAttribute('href'),
    ).toBe('/settings/preferences');
    expect(within(primaryNavigation).queryByRole('button', { name: 'Preferences' })).toBeNull();
    expect(within(primaryNavigation).getByRole('button', { name: 'Project' })).toBeTruthy();
    expect(within(primaryNavigation).queryByRole('button', { name: 'Configure AI' })).toBeNull();
    expect(within(primaryNavigation).queryByRole('button', { name: 'Manage Projects' })).toBeNull();
    expect(within(primaryNavigation).queryByRole('button', { name: 'Set Locale' })).toBeNull();
    expect(within(primaryNavigation).queryByRole('button', { name: 'Set Timezone' })).toBeNull();
    expect(
      within(primaryNavigation).queryByRole('button', { name: 'Display Preferences' }),
    ).toBeNull();

    await user.click(within(primaryNavigation).getByRole('button', { name: 'Search' }));
    await user.click(within(primaryNavigation).getByRole('button', { name: 'AI' }));
    await user.click(within(primaryNavigation).getByRole('button', { name: 'Privacy' }));
    await user.click(within(primaryNavigation).getByRole('button', { name: 'Project' }));
    expect(executeCommand.mock.calls.map(([command]) => command.id)).toEqual([
      'search.global',
      'ai.configure',
      'privacy.open',
      'project.manage',
    ]);
  });

  it('hides Knowledge and Review when a route exists but their shared commands are not usable', () => {
    const navigationWithUnavailableWorkspaces: GlobalShellView['navigation'] = [
      ...navigation,
      {
        id: 'knowledge',
        label: 'Knowledge',
        availability: 'AVAILABLE',
        targetRoute: { routeId: 'knowledge', href: '/knowledge' },
      },
      {
        id: 'review',
        label: 'Review',
        availability: 'AVAILABLE',
        targetRoute: { routeId: 'review', href: '/review' },
      },
    ];
    const unavailableWorkspaceController: OwnerCommandController = {
      executeCommand: vi.fn(),
      commands: [
        {
          id: 'knowledge.open',
          category: 'NAVIGATION',
          label: 'Open Knowledge',
          description: 'Open Knowledge',
          aliases: [],
          keywords: [],
          availability: 'HIDDEN',
          risk: 'READ',
          presentation: 'NAVIGATE',
          action: { kind: 'NAVIGATE', targetRoute: { routeId: 'knowledge', href: '/knowledge' } },
        },
        {
          id: 'review.open',
          category: 'NAVIGATION',
          label: 'Open Review',
          description: 'Open Review',
          aliases: [],
          keywords: [],
          availability: 'UNAVAILABLE_WITH_REASON',
          reason: 'Review is not established.',
          risk: 'WRITE',
          presentation: 'NAVIGATE',
          action: { kind: 'NAVIGATE', targetRoute: { routeId: 'review', href: '/review' } },
        },
      ],
    };

    render(
      <MemoryRouter>
        <PrimaryNavigation
          navigation={navigationWithUnavailableWorkspaces}
          controller={unavailableWorkspaceController}
        />
      </MemoryRouter>,
    );

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(primaryNavigation).queryByText('Knowledge', { exact: true })).toBeNull();
    expect(within(primaryNavigation).queryByText('Review', { exact: true })).toBeNull();
    expect(within(primaryNavigation).queryAllByText(/coming soon|unavailable/i)).toHaveLength(0);
  });

  it('shows only the Selected Source object link on the existing detail route without exposing an ID', () => {
    render(
      <MemoryRouter initialEntries={['/sources/source-private-id']}>
        <Routes>
          <Route
            path="/sources/:sourceId"
            element={<PrimaryNavigation navigation={navigation} controller={controller()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(
      within(primaryNavigation).getByRole('link', { name: 'Selected Source' }).getAttribute('href'),
    ).toBe('/sources/source-private-id');
    expect(within(primaryNavigation).queryByRole('link', { name: 'Preview' })).toBeNull();
    expect(within(primaryNavigation).queryByText('source-private-id')).toBeNull();
  });

  it('does not invent a Tree for an empty zero-Project shell without available commands', () => {
    render(
      <MemoryRouter>
        <PrimaryNavigation navigation={[]} controller={{ commands: [], executeCommand: vi.fn() }} />
      </MemoryRouter>,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByText(/unavailable|coming later/i)).toHaveLength(0);
  });

  it('marks Library as the single current Sources leaf when at /sources', () => {
    render(
      <MemoryRouter initialEntries={['/sources']}>
        <Routes>
          <Route
            path="/sources"
            element={<PrimaryNavigation navigation={navigation} controller={controller()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    const libraryLink = within(primaryNavigation).getByRole('link', { name: 'Library' });
    const addSourceLink = within(primaryNavigation).getByRole('link', { name: 'Add Source' });

    expect(libraryLink.getAttribute('aria-current')).toBe('page');
    expect(within(libraryLink).getByText('Library').getAttribute('aria-current')).toBe('page');
    expect(addSourceLink.getAttribute('aria-current')).toBe('false');
    expect(within(addSourceLink).getByText('Add Source').getAttribute('aria-current')).toBeNull();
    expect(within(primaryNavigation).queryAllByText('Selected Source')).toHaveLength(0);

    const sourcesGroup = within(primaryNavigation).getByText('Sources', {
      selector: 'summary',
    }).parentElement!;
    expect(sourcesGroup.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(sourcesGroup.querySelectorAll('a:has([aria-current="page"])')).toHaveLength(1);
    expect(sourcesGroup.querySelectorAll('span[aria-current="page"]')).toHaveLength(1);
  });

  it('marks Add Source as the single current Sources leaf when at /sources?view=add', () => {
    render(
      <MemoryRouter initialEntries={['/sources?view=add']}>
        <Routes>
          <Route
            path="/sources"
            element={<PrimaryNavigation navigation={navigation} controller={controller()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    const libraryLink = within(primaryNavigation).getByRole('link', { name: 'Library' });
    const addSourceLink = within(primaryNavigation).getByRole('link', { name: 'Add Source' });

    expect(addSourceLink.getAttribute('aria-current')).toBe('page');
    expect(within(addSourceLink).getByText('Add Source').getAttribute('aria-current')).toBe('page');
    expect(libraryLink.getAttribute('aria-current')).toBe('false');
    expect(within(libraryLink).getByText('Library').getAttribute('aria-current')).toBeNull();
    expect(within(primaryNavigation).queryAllByText('Selected Source')).toHaveLength(0);

    const sourcesGroup = within(primaryNavigation).getByText('Sources', {
      selector: 'summary',
    }).parentElement!;
    expect(sourcesGroup.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(sourcesGroup.querySelectorAll('a:has([aria-current="page"])')).toHaveLength(1);
    expect(sourcesGroup.querySelectorAll('span[aria-current="page"]')).toHaveLength(1);
  });

  it('falls back to marking Library current when query view is unexpected', () => {
    render(
      <MemoryRouter initialEntries={['/sources?view=unexpected']}>
        <Routes>
          <Route
            path="/sources"
            element={<PrimaryNavigation navigation={navigation} controller={controller()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    const libraryLink = within(primaryNavigation).getByRole('link', { name: 'Library' });
    const addSourceLink = within(primaryNavigation).getByRole('link', { name: 'Add Source' });

    expect(libraryLink.getAttribute('aria-current')).toBe('page');
    expect(within(libraryLink).getByText('Library').getAttribute('aria-current')).toBe('page');
    expect(addSourceLink.getAttribute('aria-current')).toBe('false');
    expect(within(addSourceLink).getByText('Add Source').getAttribute('aria-current')).toBeNull();

    const sourcesGroup = within(primaryNavigation).getByText('Sources', {
      selector: 'summary',
    }).parentElement!;
    expect(sourcesGroup.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(sourcesGroup.querySelectorAll('a:has([aria-current="page"])')).toHaveLength(1);
    expect(sourcesGroup.querySelectorAll('span[aria-current="page"]')).toHaveLength(1);
  });

  it('preserves location.state when navigating via Selected Source tree link', async () => {
    const user = userEvent.setup();
    let currentLocation: { pathname: string; search: string; state: unknown } | undefined;

    const LocationWatcher = () => {
      const location = useLocation();
      currentLocation = {
        pathname: location.pathname,
        search: location.search,
        state: location.state,
      };
      return null;
    };

    const stateFixture = {
      returnTarget: {
        returnTo: '/ask/conversations/conv-123',
        sourceId: 'source-1',
        versionId: 'ver-1',
        evidenceId: 'evi-1',
        citationId: 'cit-1',
      },
    };

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/sources/source-1',
            search: '?version=ver-1',
            state: stateFixture,
          },
        ]}
      >
        <LocationWatcher />
        <Routes>
          <Route
            path="/sources/:sourceId"
            element={<PrimaryNavigation navigation={navigation} controller={controller()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const primaryNavigation = screen.getByRole('navigation', { name: 'Primary navigation' });
    const selectedSourceLink = within(primaryNavigation).getByRole('link', {
      name: 'Selected Source',
    });
    expect(
      within(selectedSourceLink).getByText('Selected Source').getAttribute('aria-current'),
    ).toBe('page');

    await user.click(selectedSourceLink);

    expect(currentLocation).toEqual({
      pathname: '/sources/source-1',
      search: '?version=ver-1',
      state: stateFixture,
    });
  });
});
