import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { GlobalShellView } from '@shotgun/api-client';

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

describe('PrimaryNavigation HFM-S3 compression', () => {
  it('renders the same exact three destinations on desktop and mobile', () => {
    render(
      <MemoryRouter>
        <PrimaryNavigation navigation={navigation} />
      </MemoryRouter>,
    );

    for (const name of ['Primary navigation', 'Mobile navigation']) {
      expect(
        within(screen.getByRole('navigation', { name }))
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Home', 'Sources', 'Ask']);
    }
    expect(screen.queryByText('More', { exact: true })).toBeNull();
    for (const removed of [
      'Knowledge',
      'Review',
      'External actions',
      'Activity',
      'History',
      'Settings',
    ]) {
      expect(screen.queryByText(removed, { exact: true })).toBeNull();
    }
  });

  it('does not invent disabled destinations for an empty zero-Project shell', () => {
    render(
      <MemoryRouter>
        <PrimaryNavigation navigation={[]} />
      </MemoryRouter>,
    );
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.queryAllByText(/unavailable|coming later/i)).toHaveLength(0);
  });
});
