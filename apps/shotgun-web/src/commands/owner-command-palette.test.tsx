import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { OwnerCommandPalette } from './owner-command-palette.js';
import type { OwnerCommandDefinition } from './owner-command-registry.js';

const commands: readonly OwnerCommandDefinition[] = [
  {
    id: 'knowledge.open',
    category: 'NAVIGATION',
    label: 'Open Knowledge',
    description: 'Open Knowledge',
    aliases: ['knowledge'],
    keywords: ['facts'],
    availability: 'AVAILABLE',
    risk: 'READ',
    presentation: 'NAVIGATE',
    action: { kind: 'NAVIGATE', targetRoute: { routeId: 'knowledge', href: '/knowledge' } },
  },
  {
    id: 'activity.open',
    category: 'NAVIGATION',
    label: 'Open Activity',
    description: 'Open Activity',
    aliases: ['activity'],
    keywords: ['operations'],
    availability: 'AVAILABLE',
    risk: 'READ',
    presentation: 'NAVIGATE',
    action: { kind: 'NAVIGATE', targetRoute: { routeId: 'activity', href: '/activity' } },
  },
];

const Harness = () => {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open palette
      </button>
      <output>{selected}</output>
      <OwnerCommandPalette
        open={open}
        commands={commands}
        invoker={document.activeElement instanceof HTMLElement ? document.activeElement : null}
        onClose={() => setOpen(false)}
        onSelect={(command) => {
          setSelected(command.id);
          setOpen(false);
        }}
      />
    </>
  );
};

describe('OwnerCommandPalette', () => {
  it('supports filtering and Enter selection without submitting another form', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open palette' }));
    const search = screen.getByRole('textbox', { name: 'Command search' });
    await user.type(search, 'knowledge');
    await user.keyboard('{Enter}');

    expect(screen.getByText('knowledge.open')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders deterministic category groups while retaining one keyboard selection order', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open palette' }));

    expect(screen.getByRole('heading', { name: 'Navigation' })).toBeTruthy();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByText('activity.open')).toBeTruthy();
  });

  it('supports pointer selection and restores focus after Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open palette' });

    await user.click(opener);
    await user.click(screen.getByRole('button', { name: /Open Activity/ }));
    expect(screen.getByText('activity.open')).toBeTruthy();

    await user.click(opener);
    const search = screen.getByRole('textbox', { name: 'Command search' });
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(search.isConnected).toBe(false);
  });
});
