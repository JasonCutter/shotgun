import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TechnicalInspectionBlock } from '../components/technical-inspection-context.js';
import { TechnicalCommandSurface } from './technical-command-surface.js';

const blocks = [
  {
    id: 'first',
    title: 'Activity details',
    items: [{ label: 'Run ID', value: 'run-very-long-123' }],
  },
  {
    id: 'second',
    title: 'Projection details',
    items: [{ label: 'Revision', value: 'revision-7' }],
  },
] as const;

describe('TechnicalCommandSurface', () => {
  it('shows current read-only blocks and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TechnicalCommandSurface open blocks={blocks} invoker={null} onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'Technical information' })).toBeTruthy();
    expect(screen.getByText('run-very-long-123')).toBeTruthy();
    expect(screen.getByText('revision-7')).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Close']);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invalidates an open surface when the current blocks disappear and restores focus', async () => {
    const user = userEvent.setup();
    const Harness = () => {
      const [open, setOpen] = useState(false);
      const [currentBlocks, setCurrentBlocks] =
        useState<readonly TechnicalInspectionBlock[]>(blocks);
      const invokerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button type="button" ref={invokerRef} onClick={() => setOpen(true)}>
            Inspect
          </button>
          <button type="button" onClick={() => setCurrentBlocks([])}>
            Remove blocks
          </button>
          <TechnicalCommandSurface
            open={open}
            blocks={currentBlocks}
            invoker={invokerRef.current}
            onClose={() => setOpen(false)}
          />
        </>
      );
    };
    render(<Harness />);

    const inspect = screen.getByRole('button', { name: 'Inspect' });
    await user.click(inspect);
    await user.click(screen.getByRole('button', { name: 'Remove blocks' }));

    expect(screen.queryByRole('dialog', { name: 'Technical information' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(inspect));
  });
});
