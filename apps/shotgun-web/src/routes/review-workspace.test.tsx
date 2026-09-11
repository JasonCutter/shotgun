import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  GetReviewContextRequestV1,
  GlobalShellView,
  ListReviewQueueRequestV1,
  ListReviewQueueResultV1,
  ReviewQueueItemV1,
} from '@shotgun/api-client';

import { AppProviders, type AppRuntime } from '../app/providers.js';
import { createFrontendQueryClient } from '../app/query-client.js';
import { createSessionCycleState } from '../session/session-query.js';
import { reviewContextIdForResource } from '../knowledge/review-route-identity.js';
import { ReviewWorkspace } from './review-workspace.js';

const now = '2026-08-31T12:00:00.000Z';
const targetResourceId = 'target-discovery-resource';
const targetContextId = reviewContextIdForResource('DISCOVERY_CANDIDATE', targetResourceId);

const shell: GlobalShellView = {
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

const responseJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const queueItem = (resourceId: string, contextRevision = 2): ReviewQueueItemV1 => ({
  schemaVersion: '1.0.0',
  reviewContextId: reviewContextIdForResource('DISCOVERY_CANDIDATE', resourceId),
  contextRevision,
  targetKind: 'DISCOVERY_CANDIDATE',
  targetId: resourceId,
  targetLabel:
    resourceId === targetResourceId ? 'Target discovery' : `Other discovery ${resourceId}`,
  aggregateState: 'PENDING',
  itemCount: 1,
  updatedAt: now,
  attentionReasons: ['REQUIRES_ACTION'],
  capabilities: ['LIST_QUEUE', 'READ_CONTEXT'],
});

const queuePage = (
  items: readonly ReviewQueueItemV1[],
  nextCursor?: string,
): ListReviewQueueResultV1 => ({
  schemaVersion: '1.0.0',
  acceptedContext: {
    schemaVersion: '1.0.0',
    resourceProjectId: 'project-1',
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
  },
  queueSnapshotRevision: 'queue-snapshot-1',
  items,
  ...(nextCursor ? { nextCursor } : {}),
  totalCountStatus: 'EXACT',
  capabilities: ['LIST_QUEUE', 'READ_CONTEXT'],
});

const contextResult = (reviewContextId: string, contextRevision: number) => ({
  schemaVersion: '1.0.0',
  context: {
    schemaVersion: '1.0.0',
    reviewContextId,
    contextRevision,
    reviewResourceId: targetResourceId,
    targetKind: 'DISCOVERY_CANDIDATE',
    targetId: targetResourceId,
    targetRevision: 'finding-revision-3',
    targetDigest: 'sha256:target',
    resourceProjectId: 'project-1',
    effectiveProjectId: 'project-1',
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
    artifactRefs: { schemaVersion: '1.0.0' },
    items: [],
    dependencies: [],
    aggregateState: 'PENDING',
    capabilities: ['READ_CONTEXT'],
    generatedAt: now,
  },
  decisions: [],
  comments: [],
});

const v2ReviewItem = (decisionState: 'PENDING' | 'APPROVED') => ({
  schemaVersion: '1.0.0',
  reviewItemId: 'comparison-v2:change-set-1',
  sourceItemKind: 'COMPARISON_V2_CHANGE_SET',
  sourceItemId: 'change-set-1',
  sourceItemRevision: '1',
  sourceItemDigest: 'sha256:change-set-1',
  targetRef: {
    schemaVersion: '1.0.0',
    targetKind: 'COMPARISON_V2_CHANGE_SET',
    targetId: 'change-set-1',
    targetRevision: '1',
  },
  label: 'V2 candidate · ADD_CLAIM',
  after: {
    schemaVersion: '1.0.0',
    representationKind: 'OPAQUE_TEXT',
    summary: 'NEW / ADD_CLAIM',
    detailText: 'authoritative V2 change set',
  },
  rationale: 'Comparison V2 recommends ADD_CLAIM.',
  expectedImpact: 'Canonical operation ADD_CLAIM.',
  artifactRefs: { schemaVersion: '1.0.0' },
  allowedDecisions: ['APPROVE', 'REJECT', 'HOLD'],
  decisionState,
  sensitivity: 'NORMAL',
  maskedFields: [],
  accessMasking: 'VISIBLE',
});

const v2ContextResult = (contextRevision: number, approved = false) => ({
  schemaVersion: '1.0.0',
  context: {
    schemaVersion: '1.0.0',
    reviewContextId: 'review:comparison-v2:change-set-1',
    contextRevision,
    reviewResourceId: 'change-set-1',
    targetKind: 'COMPARISON_V2_CHANGE_SET',
    targetId: 'change-set-1',
    targetRevision: '1',
    targetDigest: 'sha256:change-set-1',
    resourceProjectId: 'project-1',
    effectiveProjectId: 'project-1',
    accessRevision: 'access-1',
    policyContextRevision: 'policy-1',
    artifactRefs: { schemaVersion: '1.0.0' },
    items: [v2ReviewItem(approved ? 'APPROVED' : 'PENDING')],
    dependencies: [],
    aggregateState: approved ? 'APPROVED_READY' : 'PENDING',
    capabilities: [
      'LIST_QUEUE',
      'READ_CONTEXT',
      'READ_ITEM',
      'REVALIDATE',
      'RECORD_DECISIONS',
      'ADD_COMMENT',
    ],
    generatedAt: now,
  },
  decisions: [],
  comments: [],
});

const createV2DecisionFetchMock = () => {
  const queueRequests: ListReviewQueueRequestV1[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path = String(input);
      if (path === '/api/v1/security/csrf') return responseJson({ csrfToken: 'csrf-test-token' });
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path.endsWith('/review/queue')) {
        const request = body as unknown as ListReviewQueueRequestV1;
        queueRequests.push(request);
        return responseJson(
          queuePage(
            queueRequests.length === 1
              ? [
                  {
                    schemaVersion: '1.0.0',
                    reviewContextId: 'review:comparison-v2:change-set-1',
                    contextRevision: 1,
                    targetKind: 'COMPARISON_V2_CHANGE_SET',
                    targetId: 'change-set-1',
                    targetLabel: 'V2 candidate · ADD_CLAIM',
                    aggregateState: 'PENDING',
                    itemCount: 1,
                    updatedAt: now,
                    attentionReasons: ['REQUIRES_ACTION'],
                    capabilities: ['LIST_QUEUE', 'READ_CONTEXT', 'READ_ITEM', 'REVALIDATE'],
                  },
                ]
              : [],
          ),
        );
      }
      if (path.endsWith('/review/contexts/read')) {
        const revision = Number(body['contextRevision']);
        return responseJson(v2ContextResult(revision, revision > 1));
      }
      if (path.endsWith('/review/items/read')) {
        return responseJson({
          schemaVersion: '1.0.0',
          item: v2ReviewItem('PENDING'),
          dependencies: [],
          evidence: [],
          impact: [],
          decisions: [],
        });
      }
      if (path === '/reviews/v2/decision') {
        return responseJson({
          commandStatus: 'COMPLETED',
          decision: { decision: 'APPROVE', decisionId: 'review-decide-test' },
          changeSet: { status: 'APPROVED' },
        });
      }
      if (path.endsWith('/review/contexts/revalidate')) {
        return responseJson({
          schemaVersion: '1.0.0',
          outcome: 'COMPLETED',
          clientRequestId: body['clientRequestId'],
          idempotencyKey: body['idempotencyKey'],
          commandSemanticDigest: 'sha256:revalidate',
          context: v2ContextResult(2, true).context,
        });
      }
      throw new Error(`Unexpected fetch path: ${path}`);
    },
  );
  return { fetchMock, queueRequests };
};

const createFetchMock = (options?: { readonly includeTarget: boolean }) => {
  const queueRequests: ListReviewQueueRequestV1[] = [];
  const contextRequests: Array<{ reviewContextId: string; contextRevision: number }> = [];
  const nonTargetItems = Array.from({ length: 50 }, (_, index) => queueItem(`other-${index}`));
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const path = String(input);
      if (path === '/api/v1/security/csrf') return responseJson({ csrfToken: 'csrf-test-token' });

      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (path.endsWith('/review/queue')) {
        const request = body as unknown as ListReviewQueueRequestV1;
        queueRequests.push(request);
        if (request.cursor === 'page-2') {
          return responseJson(
            queuePage(options?.includeTarget ? [queueItem(targetResourceId, 12)] : []),
          );
        }
        return responseJson(queuePage(nonTargetItems, 'page-2'));
      }
      if (path.endsWith('/review/contexts/read')) {
        const request = body as unknown as GetReviewContextRequestV1;
        contextRequests.push({
          reviewContextId: request.reviewContextId,
          contextRevision: request.contextRevision,
        });
        return responseJson(contextResult(request.reviewContextId, request.contextRevision));
      }
      throw new Error(`Unexpected fetch path: ${path}`);
    },
  );
  return { fetchMock, queueRequests, contextRequests };
};

const createRuntime = (): AppRuntime =>
  ({
    apiClient: {},
    queryClient: createFrontendQueryClient(),
    sessionCycleState: createSessionCycleState(),
  }) as AppRuntime;

const ShellOutlet = () => <Outlet context={{ shell }} />;

const renderRoute = (initialEntry: string) => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <ShellOutlet />,
        children: [{ path: 'review', element: <ReviewWorkspace /> }],
      },
    ],
    { initialEntries: [initialEntry] },
  );
  render(
    <AppProviders runtime={createRuntime()}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Review Workspace deep links', () => {
  it('follows page 2 and opens the target with its server-issued context revision', async () => {
    const { fetchMock, queueRequests, contextRequests } = createFetchMock({
      includeTarget: true,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute(`/review?reviewResourceId=${targetResourceId}`);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '대상 유형' }),
      'KNOWLEDGE_DRAFT_CHANGE_SET',
    );

    expect(await screen.findByRole('heading', { name: '검토 대상', level: 2 })).toBeTruthy();
    expect(contextRequests).toEqual([{ reviewContextId: targetContextId, contextRevision: 12 }]);
    expect(queueRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schemaVersion: '1.0.0',
          pageSize: 50,
          targetKinds: ['DISCOVERY_CANDIDATE'],
        }),
        expect.objectContaining({
          schemaVersion: '1.0.0',
          pageSize: 50,
          targetKinds: ['DISCOVERY_CANDIDATE'],
          cursor: 'page-2',
        }),
      ]),
    );
    const deepLinkQueueRequests = queueRequests.filter(
      (request) => request.targetKinds?.[0] === 'DISCOVERY_CANDIDATE',
    );
    await waitFor(() =>
      expect(deepLinkQueueRequests.map((request) => request.cursor)).toEqual([undefined, 'page-2']),
    );
    expect(queueRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetKinds: ['KNOWLEDGE_DRAFT_CHANGE_SET'] }),
      ]),
    );
  });

  it('keeps the workspace unavailable when the paginated target is exhausted', async () => {
    const { fetchMock, queueRequests, contextRequests } = createFetchMock({
      includeTarget: false,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/review?reviewResourceId=missing-resource');

    expect(
      await screen.findByText(
        '요청한 검토 연결 대상을 찾지 못했습니다. 대기열에서 직접 선택해 주세요.',
      ),
    ).toBeTruthy();
    expect(contextRequests).toHaveLength(0);
    expect(
      queueRequests.filter((request) => request.targetKinds?.[0] === 'DISCOVERY_CANDIDATE'),
    ).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: '검토 대상', level: 2 })).toBeNull();
    expect(screen.queryByText('missing-resource')).toBeNull();
  });

  it('preserves explicit context and revision deep links without queue identity substitution', async () => {
    const { fetchMock, queueRequests, contextRequests } = createFetchMock({
      includeTarget: false,
    });
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/review?context=explicit-context&revision=4');

    expect(await screen.findByRole('heading', { name: '검토 대상', level: 2 })).toBeTruthy();
    await waitFor(() => expect(contextRequests).toHaveLength(1));
    expect(contextRequests).toEqual([{ reviewContextId: 'explicit-context', contextRevision: 4 }]);
    expect(queueRequests.filter((request) => request.targetKinds !== undefined)).toHaveLength(0);
  });

  it('refreshes the queue after adopting an authoritative V2 decision', async () => {
    const { fetchMock, queueRequests } = createV2DecisionFetchMock();
    vi.stubGlobal('fetch', fetchMock);
    renderRoute('/review');

    await userEvent.click(await screen.findByRole('button', { name: /V2 candidate · ADD_CLAIM/ }));
    await screen.findByRole('heading', { name: '검토 대상', level: 2 });
    await userEvent.selectOptions(
      screen.getByLabelText('항목 선택 및 결정 버튼'),
      'comparison-v2:change-set-1',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: /V2 candidate · ADD_CLAIM 사유/ }),
      'Approved in the same session.',
    );
    await userEvent.click(screen.getByRole('button', { name: /^승인$/ }));
    await userEvent.click(screen.getByRole('button', { name: '승인 기록' }));

    await waitFor(() => expect(queueRequests).toHaveLength(2));
    expect(await screen.findByText('검토 대기열이 비어 있습니다.')).toBeTruthy();
  });
});
