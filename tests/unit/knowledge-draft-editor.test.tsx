/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';

import { LeaveGuardProvider } from '../../apps/shotgun-web/src/session/leave-guard-context.js';
import { KnowledgeDraftEditor } from '../../apps/shotgun-web/src/knowledge/knowledge-draft-editor.js';
import { pDraft, pOperation } from '../helpers/frontend-knowledge-draft-parity.js';
import type { FrontendKnowledgeDraftChangeSetV1 } from '../../packages/shotgun-api-client/src/index.js';

const wrapper = ({ children }: { readonly children: ReactNode }) =>
  createElement(LeaveGuardProvider, null, children);

const draft = (): FrontendKnowledgeDraftChangeSetV1 => pDraft('seed-editor');

describe('KnowledgeDraftEditor', () => {
  it('lets the user edit a draft and save it through a provided client', async () => {
    const saveDraft = vi.fn().mockResolvedValue({
      schemaVersion: '1.0.0',
      outcome: 'COMPLETED',
      clientRequestId: 'req-editor',
      idempotencyKey: 'idem-editor',
      draft: {
        ...draft(),
        revision: 2,
        operations: [pOperation(2)],
        contentDigest: 'sha256:saved-editor',
      },
    });

    const user = userEvent.setup();
    render(
      createElement(KnowledgeDraftEditor, {
        draft: draft(),
        activeProjectId: 'project-1',
        sessionId: 'session-1',
        client: { saveDraft },
      }),
      { wrapper },
    );

    const textarea = screen.getByLabelText(/draft content/i);
    await act(async () => {
      await user.clear(textarea);
      await user.type(textarea, 'A new editor draft');
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /save draft/i }));
    });

    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/saved/i)).toBeTruthy();
  });
});
