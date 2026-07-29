import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SessionBoundaryScreen } from './session-boundary-screen.js';

const makeBoundary = () =>
  ({
    schemaVersion: '1.0.0' as const,
    authenticationAdapter: 'local_owner' as const,
    connectivityState: 'ONLINE' as const,
    authenticationState: 'authentication_unavailable' as const,
    sessionState: 'UNAVAILABLE' as const,
    backendReadiness: 'UNAVAILABLE' as const,
    reasonCode: 'LOCAL_SERVER_UNAVAILABLE' as const,
    recoveryActions: [
      {
        id: 'CHECK_LOCAL_SERVER' as const,
        label: 'Check local server status',
        enabled: true,
      },
    ],
    session: null,
  }) as const;

describe('Diagnostic Modal Accessibility', () => {
  it('traps Shift+Tab focus inside the modal', async () => {
    const user = userEvent.setup();
    render(<SessionBoundaryScreen boundary={makeBoundary()} />);

    const openButton = screen.getByRole('button', {
      name: 'Check local server status',
    });
    await user.click(openButton);

    const dialog = screen.getByRole('dialog');
    const closeButton = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(closeButton);

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(closeButton);
  });

  it('restores focus to the modal trigger', async () => {
    const user = userEvent.setup();
    render(<SessionBoundaryScreen boundary={makeBoundary()} />);

    const openButton = screen.getByRole('button', {
      name: 'Check local server status',
    });
    await user.click(openButton);
    expect(screen.getByRole('dialog')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(openButton);
  });
});
