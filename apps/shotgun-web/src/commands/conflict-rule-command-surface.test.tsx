// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type { GlobalShellView, ShotgunApiClient } from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { ProductLocalizationProvider } from '../localization/product-localization.js';
import { createSessionCycleState } from '../session/session-query.js';
import { ConflictRuleCommandSurface } from './conflict-rule-command-surface.js';

const shell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: { id: 'project-1', label: 'Current Project', sensitivityClearance: 'private' },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Current Project',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  navigation: [],
  features: [],
  readiness: [],
  background: { activeCount: 0, failedCount: 0 },
  notifications: { unreadCount: 0, presentationRevision: 'notifications-1' },
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  projectionRevision: 'projection-1',
  fetchedAt: '2026-09-01T00:00:00.000Z',
};

const rule = {
  schemaVersion: '1.0.0' as const,
  ruleId: 'rule-1',
  ruleRevision: 1,
  leftRelationType: 'contradicts',
  rightRelationType: 'supports',
  directionSemantics: 'DIRECTED_SAME_ORIENTATION' as const,
  status: 'ACTIVE' as const,
  createdAt: '2026-09-01T00:00:00.000Z',
  lifecycle: { currentRevision: 1, activeRevision: 1 },
};

const runtime = (apiClient: Partial<ShotgunApiClient>): AppRuntime => ({
  apiClient: apiClient as ShotgunApiClient,
  queryClient: createFrontendQueryClient(),
  sessionCycleState: createSessionCycleState(),
});

const renderSurface = (apiClient: Partial<ShotgunApiClient>) =>
  render(
    <AppProviders
      runtime={runtime({
        getPrincipalPreferences: vi.fn(async () => ({
          preferences: { locale: 'en-US' },
          revision: 1,
        })),
        ...apiClient,
      })}
    >
      <ProductLocalizationProvider principalId="principal-1">
        <MemoryRouter>
          <ConflictRuleCommandSurface open shell={shell} invoker={null} onClose={vi.fn()} />
        </MemoryRouter>
      </ProductLocalizationProvider>
    </AppProviders>,
  );

describe('ConflictRuleCommandSurface', () => {
  it('keeps the surface focused on governed relation intent and requires confirmation', async () => {
    const submit = vi.fn(async () => ({ outcome: {} as never, resource: rule }));
    renderSurface({
      getTypedPropositionConflictRules: vi.fn(async () => [rule]),
      submitTypedPropositionConflictRuleCommand: submit,
    });

    const dialog = await screen.findByRole('dialog');
    expect(screen.getByRole('heading', { name: 'Typed proposition conflict rules' })).toBeTruthy();
    expect((screen.getByLabelText('Relation type A') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Relation type B') as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText('Direction')).toBeTruthy();
    expect(screen.queryByText(/assertion/i)).toBeNull();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Relation type A'), 'supports');
    await user.type(screen.getByLabelText('Relation type B'), 'contradicts');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Confirm' }),
    );
    await screen.findByText('Typed proposition conflict rules');
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'CREATE',
        leftRelationType: 'supports',
        rightRelationType: 'contradicts',
        directionSemantics: 'DIRECTED_SAME_ORIENTATION',
      }),
    );
    expect(dialog).toBeTruthy();
  });
});
