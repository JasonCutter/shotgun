import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { LeaveGuardProvider, useLeaveGuard } from '../session/leave-guard-context.js';
import { useSourceIntakeDraftQueue } from './source-intake-drafts.js';

const DraftQueueGuardHarness = () => {
  const queue = useSourceIntakeDraftQueue('project-a');
  const { getLeaveState } = useLeaveGuard();

  const removeFirstAndInspect = () => {
    const first = queue.items[0];
    if (!first) return;
    queue.remove(first.draftItemId);
    document.body.setAttribute('data-leave-state', JSON.stringify(getLeaveState()));
  };

  return (
    <>
      <button type="button" onClick={() => queue.addDirectText('Draft A', 'A')}>
        Add draft A
      </button>
      <button type="button" onClick={() => queue.addDirectText('Draft B', 'B')}>
        Add draft B
      </button>
      <button type="button" onClick={removeFirstAndInspect}>
        Remove first and inspect
      </button>
      <p>Draft count: {queue.items.length}</p>
    </>
  );
};

const renderHarness = () =>
  render(
    <LeaveGuardProvider>
      <DraftQueueGuardHarness />
    </LeaveGuardProvider>,
  );

describe('useSourceIntakeDraftQueue Leave Guard', () => {
  it('releases the Guard synchronously when the only draft is removed', async () => {
    renderHarness();

    await userEvent.click(screen.getByRole('button', { name: 'Add draft A' }));
    expect(screen.getByText('Draft count: 1')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Remove first and inspect' }));

    expect(document.body.getAttribute('data-leave-state')).toBe(
      JSON.stringify({
        canLeaveCurrentContext: true,
        hasUnsavedDraft: false,
        hasBlockingDialog: false,
        hasOutcomeUnknownCommand: false,
      }),
    );
    expect(screen.getByText('Draft count: 0')).toBeTruthy();
  });

  it('keeps the Guard active after a partial delete and releases it after the last delete', async () => {
    renderHarness();

    await userEvent.click(screen.getByRole('button', { name: 'Add draft A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add draft B' }));
    expect(screen.getByText('Draft count: 2')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Remove first and inspect' }));
    expect(document.body.getAttribute('data-leave-state')).toContain('"hasUnsavedDraft":true');
    expect(screen.getByText('Draft count: 1')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Remove first and inspect' }));
    expect(document.body.getAttribute('data-leave-state')).toContain('"hasUnsavedDraft":false');
    expect(screen.getByText('Draft count: 0')).toBeTruthy();
  });
});