import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode } from 'react';
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

const wrapper = ({ children }: { readonly children: ReactNode }) => (
  <LeaveGuardProvider>{children}</LeaveGuardProvider>
);

const renderHarness = () => render(<DraftQueueGuardHarness />, { wrapper });

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

  it('keeps the native File out of React draft state while preserving exact lazy bytes', async () => {
    const { result } = renderHook(() => useSourceIntakeDraftQueue('project-a'), { wrapper });
    const payload = '# renderer-safe file draft\n';
    const payloadBuffer = new TextEncoder().encode(payload).buffer as ArrayBuffer;
    const nativeFile = new File([payload], 'renderer-safe.md', { type: 'text/markdown' });
    Object.defineProperty(nativeFile, 'arrayBuffer', {
      configurable: true,
      value: () => Promise.resolve(payloadBuffer.slice(0)),
    });

    act(() => result.current.addFile('', nativeFile));

    const item = result.current.items[0];
    expect(item?.kind).toBe('FILE');
    if (!item || item.kind !== 'FILE') throw new Error('Expected a FILE draft.');

    expect(item.file).not.toBe(nativeFile);
    expect(item.file).not.toBeInstanceOf(File);
    expect(Object.keys(item.file)).toEqual(['name', 'type', 'size']);
    expect(item.file.name).toBe(nativeFile.name);
    expect(item.file.type).toBe(nativeFile.type);
    expect(item.file.size).toBe(nativeFile.size);
    expect(new TextDecoder().decode(await item.file.arrayBuffer())).toBe(payload);
  });
});
