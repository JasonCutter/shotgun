import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';

import { useAccessibleDialog } from '../app/use-accessible-dialog.js';
import {
  filterOwnerCommands,
  type OwnerCommandCategory,
  type OwnerCommandDefinition,
} from './owner-command-registry.js';

export type OwnerCommandPaletteProps = {
  readonly open: boolean;
  readonly commands: readonly OwnerCommandDefinition[];
  readonly initialQuery?: string;
  readonly invoker: HTMLElement | null;
  readonly onClose: () => void;
  readonly onSelect: (command: OwnerCommandDefinition) => void;
};

export const OwnerCommandPalette = ({
  open,
  commands,
  initialQuery = '',
  invoker,
  onClose,
  onSelect,
}: OwnerCommandPaletteProps) => {
  const dialog = useAccessibleDialog({ open, onClose });
  const titleId = useId();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const filteredCommands = useMemo(() => filterOwnerCommands(commands, query), [commands, query]);
  const commandGroups = useMemo(() => {
    const categories: readonly OwnerCommandCategory[] = ['HELP', 'SEARCH', 'PROJECT', 'NAVIGATION'];
    const categoryLabels: Record<OwnerCommandCategory, string> = {
      HELP: 'Help',
      SEARCH: 'Search',
      PROJECT: 'Project',
      NAVIGATION: 'Navigation',
    };

    return categories
      .map((category) => ({
        category,
        label: categoryLabels[category],
        commands: filteredCommands
          .map((command, index) => ({ command, index }))
          .filter(({ command }) => command.category === category),
      }))
      .filter((group) => group.commands.length > 0);
  }, [filteredCommands]);

  useEffect(() => {
    if (!open) return;
    dialog.captureInvoker(invoker);
    setQuery(initialQuery);
    setSelectedIndex(0);
  }, [initialQuery, invoker, open]);

  useEffect(() => {
    setSelectedIndex((current) =>
      filteredCommands.length === 0 ? 0 : Math.min(current, filteredCommands.length - 1),
    );
  }, [filteredCommands.length]);

  if (!open) return null;

  const commandDomId = (command: OwnerCommandDefinition, index: number) =>
    `${listId}-${command.id}-${command.context?.projectId ?? index}`;

  const selectCommand = (command: OwnerCommandDefinition) => {
    if (command.availability !== 'AVAILABLE') return;
    onSelect(command);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    dialog.onDialogKeyDown(event);
    if (event.defaultPrevented) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((current) =>
        filteredCommands.length === 0 ? 0 : (current + 1) % filteredCommands.length,
      );
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((current) =>
        filteredCommands.length === 0
          ? 0
          : (current - 1 + filteredCommands.length) % filteredCommands.length,
      );
    } else if (event.key === 'Home') {
      event.preventDefault();
      setSelectedIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setSelectedIndex(Math.max(filteredCommands.length - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = filteredCommands[selectedIndex];
      if (selected) selectCommand(selected);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={dialog.dialogRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="modal-card owner-command-palette">
        <h2 id={titleId}>Commands</h2>
        <p>Find a command by name, alias, or keyword.</p>
        <label htmlFor={`${listId}-query`}>Command search</label>
        <input
          id={`${listId}-query`}
          value={query}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelectedIndex(0);
          }}
          aria-controls={listId}
          aria-activedescendant={
            filteredCommands[selectedIndex]
              ? commandDomId(filteredCommands[selectedIndex], selectedIndex)
              : undefined
          }
        />
        <div id={listId} className="command-list owner-command-list" role="listbox">
          {filteredCommands.length === 0 ? (
            <p className="owner-command-empty" role="status">
              No matching commands.
            </p>
          ) : (
            commandGroups.map((group) => (
              <section
                key={group.category}
                className="owner-command-group"
                aria-labelledby={`${listId}-${group.category}`}
              >
                <h3 id={`${listId}-${group.category}`}>{group.label}</h3>
                <ul className="owner-command-group-list">
                  {group.commands.map(({ command, index }) => {
                    const unavailable = command.availability !== 'AVAILABLE';
                    return (
                      <li
                        key={commandDomId(command, index)}
                        id={commandDomId(command, index)}
                        role="option"
                        aria-selected={index === selectedIndex}
                      >
                        <button
                          type="button"
                          className={
                            index === selectedIndex ? 'owner-command-option-selected' : undefined
                          }
                          disabled={unavailable}
                          onMouseEnter={() => setSelectedIndex(index)}
                          onClick={() => selectCommand(command)}
                        >
                          <span>
                            <strong>{command.label}</strong>
                            <small>{command.description}</small>
                          </span>
                          {unavailable && command.reason ? <small>{command.reason}</small> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
        <div className="dialog-actions">
          <span className="owner-command-hint">↑↓ Navigate · Enter Select · Esc Close</span>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
