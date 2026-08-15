import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
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
    ).toBe('/sources#source-library-heading');
    expect(
      within(primaryNavigation).getByRole('link', { name: 'Add Source' }).getAttribute('href'),
    ).toBe('/sources#source-intake-heading');
    expect(within(primaryNavigation).getByText('Ask', { selector: 'summary' })).toBeTruthy();
    expect(within(primaryNavigation).getByRole('link', { name: 'Conversations' })).toBeTruthy();
    expect(within(primaryNavigation).getByText('Settings', { selector: 'summary' })).toBeTruthy();
    expect(
      within(primaryNavigation).getByText('Preferences', { selector: 'summary' }),
    ).toBeTruthy();
    expect(within(primaryNavigation).queryByText('Knowledge', { exact: true })).toBeNull();
    expect(within(primaryNavigation).queryByText('Review', { exact: true })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Mobile navigation' })).toBeNull();

    await user.click(within(primaryNavigation).getByRole('button', { name: 'Search' }));
    await user.click(within(primaryNavigation).getByRole('button', { name: 'Configure AI' }));
    expect(executeCommand.mock.calls.map(([command]) => command.id)).toEqual([
      'search.global',
      'ai.configure',
    ]);
  });

  it('shows selected Source anchors only on the existing Source detail route without exposing an ID', () => {
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
      within(primaryNavigation).getByText('Selected Source', { selector: 'summary' }),
    ).toBeTruthy();
    expect(
      within(primaryNavigation).getByRole('link', { name: 'Preview' }).getAttribute('href'),
    ).toBe('#source-preview-heading');
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
});
