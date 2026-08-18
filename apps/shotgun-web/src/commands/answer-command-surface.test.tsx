import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { AnswerCommandContext } from './answer-command-context.js';
import { AnswerCommandSurface } from './answer-command-surface.js';
import type { AnswerCommandId } from './owner-command-registry.js';

const context: AnswerCommandContext = {
  projectId: 'project-1',
  conversationId: 'conversation-1',
  branchId: 'branch-1',
  turnId: 'historical-turn',
  answerRunId: 'historical-run',
  answerRevision: 'answer-revision-1',
  state: 'SUCCEEDED',
  capabilities: [
    'EXPORT',
    'RETRY_SAME_CONTEXT',
    'RETRY_CURRENT_POLICY',
    'CREATE_INTAKE_DRAFT',
    'CREATE_DRAFT_CHANGE_SET',
    'PROPOSE_DIRECTIVE',
  ],
};

const renderSurface = (commandId: AnswerCommandId) => {
  const callbacks = {
    onClose: vi.fn(),
    onExport: vi.fn(async () => undefined),
    onRetry: vi.fn(async () => undefined),
    onPropose: vi.fn(async () => undefined),
  };
  render(
    <AnswerCommandSurface
      open
      commandId={commandId}
      context={context}
      pending={false}
      invoker={null}
      {...callbacks}
    />,
  );
  return callbacks;
};

describe('AnswerCommandSurface', () => {
  it('does not mutate during discovery and exports the exact mounted AnswerRun', async () => {
    const user = userEvent.setup();
    const callbacks = renderSurface('answer.export');

    expect(callbacks.onExport).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Export answer' }));
    await waitFor(() => expect(callbacks.onExport).toHaveBeenCalledWith('historical-run'));
  });

  it('offers only explicit retry modes and preserves their exact API mapping', async () => {
    const user = userEvent.setup();
    const callbacks = renderSurface('action.retry');

    expect(callbacks.onRetry).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry same context' }));
    await user.click(screen.getByRole('button', { name: 'Retry current policy' }));
    await waitFor(() =>
      expect(callbacks.onRetry.mock.calls).toEqual([
        ['historical-run', 'SAME_CONTEXT'],
        ['historical-run', 'CURRENT_POLICY'],
      ]),
    );
  });

  it.each([
    ['answer.propose_intake', 'Propose Intake Draft', 'INTAKE_DRAFT'],
    ['answer.propose_change', 'Propose Draft ChangeSet', 'DRAFT_CHANGE_SET'],
    ['answer.propose_directive', 'Propose Directive', 'USER_DIRECTIVE'],
  ] as const)('maps %s to the exact existing transition kind', async (commandId, label, kind) => {
    const user = userEvent.setup();
    const callbacks = renderSurface(commandId);

    expect(callbacks.onPropose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(callbacks.onPropose).toHaveBeenCalledWith('historical-run', kind));
  });
});
