import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { RouteFocus } from './route-focus.js';

const renderRoute = (content: ReactNode) =>
  render(
    <MemoryRouter initialEntries={['/sources']}>
      <main id="main-content">
        <RouteFocus />
        {content}
      </main>
    </MemoryRouter>,
  );

const routeWithSearchDialog = (content: ReactNode) => (
  <MemoryRouter initialEntries={['/sources']}>
    <div>
      <div role="dialog" aria-modal="true" aria-label="Search">
        <input aria-label="Search query" />
      </div>
      <main id="main-content">
        <RouteFocus />
        {content}
      </main>
    </div>
  </MemoryRouter>
);

const renderRouteWithSearchDialog = (content: ReactNode) =>
  render(routeWithSearchDialog(content));

describe('RouteFocus', () => {
  it('focuses the route heading when no specific focus target owns the route', async () => {
    const { rerender } = renderRoute(null);

    rerender(
      <MemoryRouter initialEntries={['/sources']}>
        <main id="main-content">
          <RouteFocus />
          <h1 tabIndex={-1}>Sources</h1>
        </main>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Sources' })),
    );
  });

  it('preserves a route-specific focus target across later route mutations', async () => {
    renderRoute(
      <>
        <h1 tabIndex={-1}>Source detail</h1>
        <li data-testid="evidence-target" tabIndex={-1} />
      </>,
    );

    const target = screen.getByTestId('evidence-target');
    target.focus();
    document.getElementById('main-content')?.append(document.createElement('p'));

    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Source detail' }));
  });

  it('does not take focus from a user-controlled main content element', async () => {
    renderRoute(
      <>
        <h1 tabIndex={-1}>Settings</h1>
        <button type="button">User control</button>
      </>,
    );

    const control = screen.getByRole('button', { name: 'User control' });
    control.focus();
    document.getElementById('main-content')?.append(document.createElement('p'));

    await waitFor(() => expect(document.activeElement).toBe(control));
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Settings' }));
  });

  it('preserves modal focus outside main across delayed route mutations', async () => {
    const { rerender } = renderRouteWithSearchDialog(null);
    const queryInput = screen.getByRole('textbox', { name: 'Search query' });
    queryInput.focus();

    rerender(routeWithSearchDialog(<h1 tabIndex={-1}>Sources</h1>));

    await waitFor(() => expect(document.activeElement).toBe(queryInput));
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Sources' }));
  });
});
