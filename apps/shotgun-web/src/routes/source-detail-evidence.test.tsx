import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import type {
  EvidenceListView,
  GlobalShellView,
  ShotgunApiClient,
  SourceDetailView,
} from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { createSessionCycleState } from '../session/session-query.js';
import { SourceDetailWorkspace } from './source-detail-workspace.js';

const now = '2026-08-17T09:00:00.000Z';

const baseShell: GlobalShellView = {
  schemaVersion: '1.0.0',
  principalId: 'principal-1',
  sessionId: 'session-1',
  activeProject: {
    id: 'project-1',
    label: 'Project One',
    sensitivityClearance: 'private',
  },
  accessibleProjects: [
    {
      id: 'project-1',
      label: 'Project One',
      isOwner: true,
      sensitivityClearance: 'private',
    },
  ],
  navigation: [],
  features: [],
  readiness: [],
  background: { activeCount: 0, failedCount: 0 },
  notifications: { unreadCount: 0, presentationRevision: '1' },
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  projectionRevision: 'projection-1',
  fetchedAt: now,
};

const detail: SourceDetailView = {
  schemaVersion: '1.0.0',
  sourceId: 'source-1',
  projectId: 'project-1',
  label: 'Test Note',
  lifecycle: 'ACTIVE',
  mediaType: 'text/markdown',
  sensitivity: 'internal',
  currentSourceVersionId: 'version-1',
  versionCount: 1,
  previewReadiness: 'READY',
  askUsageState: 'EVIDENCE_READY',
  askUsageExplanation: 'Evidence is ready.',
  capabilities: ['PREVIEW', 'SELECT_FOR_ASK'],
  sourceRevision: 'source-1',
  projectionRevision: 'sources-1',
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  createdAt: now,
  updatedAt: now,
};

const createMockRuntime = (evidenceItems: EvidenceListView['items']): AppRuntime => {
  const evidenceList: EvidenceListView = {
    schemaVersion: '1.0.0',
    projectId: 'project-1',
    sourceId: 'source-1',
    sourceVersionId: 'version-1',
    items: evidenceItems,
    projectionRevision: 'proj-1',
    accessRevision: 'acc-1',
    policyContextRevision: 'pol-1',
    fetchedAt: now,
  };

  const apiClient = {
    getSourceDetail: vi.fn(async () => detail),
    getSourceVersionHistory: vi.fn(async () => ({
      schemaVersion: '1.0.0',
      projectId: 'project-1',
      sourceId: 'source-1',
      selectedSourceVersionId: 'version-1',
      versions: [
        {
          sourceVersionId: 'version-1',
          versionNumber: 1,
          contentHash: 'hash-1',
          mediaType: 'text/markdown',
          sizeBytes: 128,
          createdAt: now,
          transformationState: 'READY',
          evidenceCount: evidenceItems.length,
        },
      ],
      projectionRevision: 'proj-1',
      accessRevision: 'acc-1',
      policyContextRevision: 'pol-1',
      fetchedAt: now,
    })),
    getSourcePreview: vi.fn(async () => ({
      schemaVersion: '1.0.0',
      sourceId: 'source-1',
      sourceVersionId: 'version-1',
      projectId: 'project-1',
      mediaType: 'text/markdown',
      contentHash: 'hash-1',
      mode: 'ORIGINAL',
      readiness: 'READY',
      text: 'Preview text',
      locators: [],
      capabilities: ['PREVIEW'],
      projectionRevision: 'proj-1',
      accessRevision: 'acc-1',
      policyContextRevision: 'pol-1',
      fetchedAt: now,
    })),
    getSourceEvidence: vi.fn(async () => evidenceList),
    getPrincipalPreferences: vi.fn(async () => ({ preferences: { locale: 'en-US' }, revision: 1 })),
  } as unknown as ShotgunApiClient;

  return {
    apiClient,
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  };
};

const ShellOutlet = () => <Outlet context={{ shell: baseShell }} />;

describe('SourceDetailWorkspace Evidence Presentation HFM-S7-C8-D3', () => {
  it('A. WITHIN-CARD: renders the exact quote once without duplicate strong label when label is derived', async () => {
    const quoteText = '2026-08-11 Shotgun 로컬 실행을 처음 완료했다.';
    const runtime = createMockRuntime([
      {
        evidenceId: 'evi-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: quoteText,
        origin: 'ORIGINAL',
        exactText: quoteText,
        locators: [
          {
            type: 'TextPositionSelector',
            start: 0,
            end: 34,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
    ]);

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources/:sourceId', element: <SourceDetailWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources/source-1?version=version-1&view=evidence'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Evidence', level: 2 })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);

    const card = items[0]!;
    expect(card.querySelector('p')?.textContent).toBe(quoteText);
    expect(card.querySelector('strong')).toBeNull();
  });

  it('B. SAME TEXT + SAME POSITION: collapses structurally equivalent spans into a single visible card', async () => {
    const multiLineQuote =
      '2026-08-11 Shotgun 로컬 실행을 처음 완료했다.\n첫 프로젝트 이름은 JasonNote다.\n이번 실행에서는 Source → Ask 흐름을 단계별로 확인한다.';

    const runtime = createMockRuntime([
      {
        evidenceId: 'evi-paragraph',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: multiLineQuote.slice(0, 120),
        origin: 'ORIGINAL',
        exactText: multiLineQuote,
        locators: [
          {
            type: 'TextPositionSelector',
            start: 0,
            end: 94,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
      {
        evidenceId: 'evi-document',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: multiLineQuote.slice(0, 120),
        origin: 'ORIGINAL',
        exactText: multiLineQuote,
        locators: [
          {
            type: 'TextPositionSelector',
            start: 0,
            end: 94,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
    ]);

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources/:sourceId', element: <SourceDetailWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources/source-1?version=version-1&view=evidence'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Evidence', level: 2 })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]!.querySelector('p')?.textContent).toBe(multiLineQuote);
  });

  it('C. SAME TEXT + DIFFERENT POSITION: preserves separate cards for identical text at different positions', async () => {
    const repeatedWord = 'Approved.';

    const runtime = createMockRuntime([
      {
        evidenceId: 'evi-occurrence-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: repeatedWord,
        origin: 'ORIGINAL',
        exactText: repeatedWord,
        locators: [
          {
            type: 'TextPositionSelector',
            start: 10,
            end: 19,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
      {
        evidenceId: 'evi-occurrence-2',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: repeatedWord,
        origin: 'ORIGINAL',
        exactText: repeatedWord,
        locators: [
          {
            type: 'TextPositionSelector',
            start: 200,
            end: 209,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
    ]);

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources/:sourceId', element: <SourceDetailWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources/source-1?version=version-1&view=evidence'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Evidence', level: 2 })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.id).toBe('evidence-evi-occurrence-1');
    expect(items[1]!.id).toBe('evidence-evi-occurrence-2');
  });

  it('D. CITATION MEMBER IDENTITY: resolves and focuses grouped card when citation targets a non-primary member', async () => {
    const text = 'Shared sentence';
    const runtime = createMockRuntime([
      {
        evidenceId: 'evi-member-primary',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: text,
        origin: 'ORIGINAL',
        exactText: text,
        locators: [
          {
            type: 'TextPositionSelector',
            start: 0,
            end: 15,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
      {
        evidenceId: 'evi-member-secondary',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: text,
        origin: 'ORIGINAL',
        exactText: text,
        locators: [
          {
            type: 'TextPositionSelector',
            start: 0,
            end: 15,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
    ]);

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources/:sourceId', element: <SourceDetailWorkspace /> }],
        },
      ],
      {
        initialEntries: [
          {
            pathname: '/sources/source-1',
            search: '?version=version-1',
            state: {
              citationReturnTarget: {
                schemaVersion: '1.0.0',
                originRoute: '/ask/conversations/conv-1',
                resourceKind: 'conversation',
                resourceId: 'conv-1',
                conversationId: 'conv-1',
                resourceRevision: 'rev-1',
                citationId: 'cit-1',
                sourceId: 'source-1',
                sourceVersionId: 'version-1',
                evidenceId: 'evi-member-secondary',
              },
            },
          },
        ],
      },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Evidence', level: 2 })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe('evidence-evi-member-secondary');
    expect(document.activeElement).toBe(items[0]);
  });

  it('E. DISTINCT LABEL: preserves distinct semantic label when it is not a derived prefix of exactText', async () => {
    const runtime = createMockRuntime([
      {
        evidenceId: 'evi-distinct',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: 'Section 3.1 Architecture Overview',
        origin: 'ANNOTATION',
        exactText: 'The core architecture consists of Port and Adapter boundaries.',
        locators: [
          {
            type: 'TextPositionSelector',
            start: 50,
            end: 115,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
    ]);

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources/:sourceId', element: <SourceDetailWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources/source-1?version=version-1&view=evidence'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Evidence', level: 2 })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    const card = items[0]!;
    expect(card.querySelector('strong')?.textContent).toBe('Section 3.1 Architecture Overview');
    expect(card.querySelector('p')?.textContent).toBe(
      'The core architecture consists of Port and Adapter boundaries.',
    );
  });

  it('F. SAME TEXT + SAME POSITION + DISTINCT LABEL: renders separate cards when distinct labels differ', async () => {
    const sharedText = 'Critical system constraint.';
    const runtime = createMockRuntime([
      {
        evidenceId: 'evi-distinct-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: 'Architecture Decision A',
        origin: 'ORIGINAL',
        exactText: sharedText,
        locators: [
          {
            type: 'TextPositionSelector',
            start: 0,
            end: 27,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
      {
        evidenceId: 'evi-distinct-2',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: 'Security Constraint B',
        origin: 'ORIGINAL',
        exactText: sharedText,
        locators: [
          {
            type: 'TextPositionSelector',
            start: 0,
            end: 27,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
    ]);

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources/:sourceId', element: <SourceDetailWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources/source-1?version=version-1&view=evidence'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Evidence', level: 2 })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector('strong')?.textContent).toBe('Architecture Decision A');
    expect(items[1]!.querySelector('strong')?.textContent).toBe('Security Constraint B');
  });

  it('G. SAME TEXT + SAME POSITION + DIFFERENT ORIGIN: renders separate cards when origins differ', async () => {
    const sharedText = 'Summarized or original statement.';
    const runtime = createMockRuntime([
      {
        evidenceId: 'evi-origin-original',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: sharedText,
        origin: 'ORIGINAL',
        exactText: sharedText,
        locators: [
          {
            type: 'TextPositionSelector',
            start: 0,
            end: 33,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
      {
        evidenceId: 'evi-origin-summary',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: sharedText,
        origin: 'SUMMARY',
        exactText: sharedText,
        locators: [
          {
            type: 'TextPositionSelector',
            start: 0,
            end: 33,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
    ]);

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources/:sourceId', element: <SourceDetailWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources/source-1?version=version-1&view=evidence'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Evidence', level: 2 })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector('small')?.textContent).toBe('Original source');
    expect(items[1]!.querySelector('small')?.textContent).toBe('Summary');
  });

  it('H. GROUP KEY ENCODING COLLISION SAFETY: does not collapse items with delimiter-ambiguous labels and exact texts', async () => {
    const runtime = createMockRuntime([
      {
        evidenceId: 'evi-collision-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: 'A:B',
        origin: 'ORIGINAL',
        exactText: 'C',
        locators: [
          {
            type: 'TextPositionSelector',
            start: 0,
            end: 10,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
      {
        evidenceId: 'evi-collision-2',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        revisionId: 'rev-1',
        label: 'A',
        origin: 'ORIGINAL',
        exactText: 'B:C',
        locators: [
          {
            type: 'TextPositionSelector',
            start: 0,
            end: 10,
            unit: 'unicode-code-point',
          },
        ],
        createdAt: now,
      },
    ]);

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <ShellOutlet />,
          children: [{ path: 'sources/:sourceId', element: <SourceDetailWorkspace /> }],
        },
      ],
      { initialEntries: ['/sources/source-1?version=version-1&view=evidence'] },
    );

    render(
      <AppProviders runtime={runtime}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Evidence', level: 2 })).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.querySelector('strong')?.textContent).toBe('A:B');
    expect(items[0]!.querySelector('p')?.textContent).toBe('C');
    expect(items[1]!.querySelector('strong')?.textContent).toBe('A');
    expect(items[1]!.querySelector('p')?.textContent).toBe('B:C');
  });
});
