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
      { id: 'CHECK_LOCAL_SERVER' as const, label: '로컬 서버 상태 확인', enabled: true },
    ],
    session: null,
  }) as const;

describe('Diagnostic Modal Accessibility', () => {
  it('Modal Shift+Tab Focus Trap', async () => {
    const user = userEvent.setup();
    render(<SessionBoundaryScreen boundary={makeBoundary()} />);

    const openBtn = screen.getByRole('button', { name: '로컬 서버 상태 확인' });
    await user.click(openBtn);

    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: '닫기' });
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab from the only interactive element wraps back to itself
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(closeBtn);
  });

  it('Modal Trigger Focus Restore', async () => {
    const user = userEvent.setup();
    render(<SessionBoundaryScreen boundary={makeBoundary()} />);

    const openBtn = screen.getByRole('button', { name: '로컬 서버 상태 확인' });
    await user.click(openBtn);
    expect(screen.getByRole('dialog')).toBeTruthy();

    const closeBtn = screen.getByRole('button', { name: '닫기' });
    await user.click(closeBtn);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(openBtn);
  });
});
