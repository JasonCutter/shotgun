import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  DiscoveryFeedbackProductStateV1,
  DiscoveryProductFindingDetailV1,
} from '@shotgun/api-client';

import { DiscoveryFeedbackCommandSurface } from './discovery-feedback-command-surface.js';
import type { DiscoveryFeedbackCommandId } from './discovery-command-context.js';
import type {
  DiscoveryFeedbackMutationResult,
  DiscoveryFeedbackSubmission,
} from './discovery-feedback.js';

const finding = { title: 'A discovery needing owner feedback' } as DiscoveryProductFindingDetailV1;

const renderSurface = (
  commandId: DiscoveryFeedbackCommandId,
  onSubmit: (input: DiscoveryFeedbackSubmission) => Promise<DiscoveryFeedbackMutationResult>,
  state?: DiscoveryFeedbackProductStateV1,
) =>
  render(
    <DiscoveryFeedbackCommandSurface
      open
      commandId={commandId}
      finding={finding}
      state={state}
      statePending={false}
      stateError={false}
      pending={false}
      invoker={null}
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  );

describe('Discovery feedback command surface', () => {
  it('submits all six epistemic issue kinds with bounded text and no correction-success claim', async () => {
    const submitted: DiscoveryFeedbackSubmission[] = [];
    const onSubmit = vi.fn(async (input: DiscoveryFeedbackSubmission) => {
      submitted.push(input);
      return { status: 'COMPLETED' as const };
    });
    renderSurface('discovery.report_issue', onSubmit);
    const user = userEvent.setup();
    const issueKinds = [
      'INCORRECT_RELATION',
      'INSUFFICIENT_EVIDENCE',
      'WRONG_ENTITY',
      'TEMPORAL_ERROR',
      'MISLEADING_PATTERN',
      'MISIDENTIFIED_CONFLICT',
    ];

    for (const issueKind of issueKinds) {
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'What should Shotgun re-check?' }),
        issueKind,
      );
      await user.click(screen.getByRole('button', { name: 'Request re-check' }));
    }

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(issueKinds.length));
    expect(submitted.map((input) => input.feedbackKind)).toEqual(issueKinds);
    expect(submitted.every((input) => input.feedbackClass === 'EPISTEMIC')).toBe(true);
    expect(screen.queryByText('INCORRECT_RELATION')).toBeNull();
    expect(screen.queryByText(/Correction accepted|Finding corrected|Knowledge fixed/)).toBeNull();
  });

  it('bounds optional reason text and sends only the selected suppression scope intent', async () => {
    const onSubmit = vi.fn(async (input: DiscoveryFeedbackSubmission) => ({
      status: 'COMPLETED' as const,
      input,
    }));
    renderSurface('discovery.suppress_exact', onSubmit);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: 'This Project' }));
    await user.click(screen.getByRole('button', { name: 'Confirm hiding' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const input = onSubmit.mock.calls[0]?.[0];
    expect(input).toEqual({
      feedbackClass: 'UTILITY',
      feedbackKind: 'SUPPRESS_EXACT',
      scope: 'PROJECT',
    });
    expect(input).not.toHaveProperty('fingerprint');
    expect(input).not.toHaveProperty('matcherVersion');
  });

  it('renders principal-scoped history in owner language without infrastructure identifiers', () => {
    renderSurface('discovery.feedback_history', vi.fn(), {
      schemaVersion: '1.0.0',
      projectId: 'project-hidden',
      findingId: 'finding-hidden',
      findingRevision: 4,
      feedbackHistory: [
        {
          schemaVersion: '1.0.0',
          feedbackId: 'feedback-hidden',
          projectId: 'project-hidden',
          findingId: 'finding-hidden',
          findingRevision: 4,
          actor: { type: 'user', id: 'principal-hidden' },
          principalId: 'principal-hidden',
          feedbackClass: 'EPISTEMIC',
          feedbackKind: 'TEMPORAL_ERROR',
          reason: 'The date needs another look.',
          scope: 'FINDING',
          createdAt: '2026-08-31T12:00:00.000Z',
        },
      ],
      suppressionHistory: [],
    });

    expect(screen.getByText('The timing is wrong')).toBeTruthy();
    expect(screen.getByText('Re-check requested')).toBeTruthy();
    expect(screen.getByText('The date needs another look.')).toBeTruthy();
    expect(screen.queryByText('feedback-hidden')).toBeNull();
    expect(screen.queryByText('principal-hidden')).toBeNull();
    expect(screen.queryByText('project-hidden')).toBeNull();
  });
});
