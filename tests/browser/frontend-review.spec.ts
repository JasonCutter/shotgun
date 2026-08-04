import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const routeGuard = {
  decision: {
    schemaVersion: '1.0.0',
    decision: 'ALLOW',
    targetRoute: { routeId: 'review', href: '/review' },
    masked: false,
    message: 'Allowed.',
    accessRevision: '1',
    policyContextRevision: '1',
  },
};

const queueResult = {
  schemaVersion: '1.0.0',
  acceptedContext: {
    schemaVersion: '1.0.0',
    resourceProjectId: 'server-project-1',
    accessRevision: '1',
    policyContextRevision: '1',
  },
  queueSnapshotRevision: 'queue-1',
  items: [
    {
      schemaVersion: '1.0.0',
      reviewContextId: 'context-1',
      contextRevision: 1,
      targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
      targetId: 'draft-1',
      targetLabel: 'Knowledge Draft draft-1 (revision 1)',
      aggregateState: 'PENDING',
      itemCount: 1,
      updatedAt: '2026-08-04T08:00:00.000Z',
      attentionReasons: ['REQUIRES_ACTION'],
      capabilities: ['READ_CONTEXT', 'READ_ITEM', 'RECORD_DECISIONS'],
    },
  ],
  totalCountStatus: 'EXACT',
  capabilities: ['READ_CONTEXT'],
};

const contextResult = {
  schemaVersion: '1.0.0',
  context: {
    schemaVersion: '1.0.0',
    reviewContextId: 'context-1',
    contextRevision: 1,
    reviewResourceId: 'review-resource-1',
    targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
    targetId: 'draft-1',
    targetRevision: '1',
    targetDigest: 'draft-digest',
    resourceProjectId: 'server-project-1',
    effectiveProjectId: 'server-project-1',
    accessRevision: '1',
    policyContextRevision: '1',
    canonicalBase: {
      schemaVersion: '1.0.0',
      snapshotId: 'snapshot-1',
      revision: '2',
      digest: 'base-digest',
    },
    artifactRefs: { schemaVersion: '1.0.0' },
    items: [
      {
        schemaVersion: '1.0.0',
        reviewItemId: 'item-1',
        sourceItemKind: 'KNOWLEDGE_OPERATION',
        sourceItemId: 'op-1',
        sourceItemRevision: '1',
        sourceItemDigest: 'op-digest',
        targetRef: {
          schemaVersion: '1.0.0',
          targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
          targetId: 'draft-1',
          targetRevision: '1',
        },
        label: 'Add fact X',
        before: {
          schemaVersion: '1.0.0',
          representationKind: 'OPAQUE_TEXT',
          summary: '변경 전 없음',
          detailText: '변경 전 내용이 없습니다.',
        },
        after: {
          schemaVersion: '1.0.0',
          representationKind: 'OPAQUE_TEXT',
          summary: 'After: ADD FACT on resource-1',
          detailText: '{"subjectRef":"resource-1","predicate":"foundedIn","value":2020}',
        },
        rationale: 'Add the founding fact.',
        artifactRefs: { schemaVersion: '1.0.0' },
        allowedDecisions: ['APPROVE', 'REJECT', 'REQUEST_REVISION', 'HOLD'],
        decisionState: 'PENDING',
        sensitivity: 'NORMAL',
        maskedFields: [],
        accessMasking: 'VISIBLE',
      },
    ],
    dependencies: [],
    aggregateState: 'PENDING',
    capabilities: ['READ_CONTEXT', 'READ_ITEM', 'RECORD_DECISIONS'],
    generatedAt: '2026-08-04T08:00:00.000Z',
  },
  decisions: [],
  comments: [],
};

const itemDetailResult = {
  schemaVersion: '1.0.0',
  item: contextResult.context.items[0],
  dependencies: [],
  evidence: [
    {
      schemaVersion: '1.0.0',
      sourceId: 'source-1',
      sourceVersionId: 'source-1-v2',
      evidenceSpanId: 'span-1',
      snippet: 'Evidence span span-1 in source source-1.',
    },
  ],
  decisions: [],
};

const decisionsResult = {
  schemaVersion: '1.0.0',
  outcome: 'COMPLETED',
  clientRequestId: 'client-1',
  idempotencyKey: 'idem-1',
  commandSemanticDigest: 'digest-1',
  reviewContextId: 'context-1',
  contextRevision: 1,
  decisions: [
    {
      schemaVersion: '1.0.0',
      decisionId: 'decision-1',
      reviewContextId: 'context-1',
      contextRevision: 1,
      reviewItemId: 'item-1',
      intent: 'APPROVE',
      reason: 'Matches evidence.',
      decidedBy: { schemaVersion: '1.0.0', principalId: 'p', actorId: 'p' },
      decidedAt: '2026-08-04T09:00:00.000Z',
      terminal: true,
    },
  ],
  aggregateState: 'APPROVED_READY',
  approvals: [
    {
      schemaVersion: '1.0.0',
      approvalId: 'approval-1',
      purpose: 'KNOWLEDGE_CANONICAL_CHANGE',
      reviewContextId: 'context-1',
      contextRevision: 1,
      targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
      targetId: 'draft-1',
      targetRevision: '1',
      targetDigest: 'draft-digest',
      approvedItemIds: ['item-1'],
      approvedManifestDigest: 'manifest-digest',
      actor: { schemaVersion: '1.0.0', principalId: 'p', actorId: 'p' },
      projectId: 'server-project-1',
      accessRevision: '1',
      policyContextRevision: '1',
      reason: 'Approved.',
      issuedAt: '2026-08-04T09:00:00.000Z',
      expiresAt: '2026-09-03T09:00:00.000Z',
      status: 'ACTIVE',
    },
  ],
};

// The browser fixture backend serves the real session and global shell. We
// stub the route guard (ALLOW for review), CSRF and the Review endpoints with
// controlled fixtures.
const stubSessionAndShell = async (page: Page) => {
  await page.route('**/product-api/frontend/route-guard', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(routeGuard),
    });
  });
  await page.route('**/api/v1/security/csrf', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'browser-review-csrf' }),
    });
  });
  await page.route('**/product-api/frontend/review/queue', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(queueResult),
    });
  });
  await page.route('**/product-api/frontend/review/contexts/read', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(contextResult),
    });
  });
  await page.route('**/product-api/frontend/review/items/read', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(itemDetailResult),
    });
  });
  await page.route('**/product-api/frontend/review/decisions', async (route) => {
    const body = route.request().postDataJSON() as {
      clientRequestId?: string;
      idempotencyKey?: string;
    };
    // Echo the original command identity so the client identity validation
    // matches the request (server-authoritative behaviour).
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...decisionsResult,
        clientRequestId: body.clientRequestId,
        idempotencyKey: body.idempotencyKey,
        decisions: decisionsResult.decisions.map((entry) => ({
          ...entry,
          decidedBy: { schemaVersion: '1.0.0', principalId: 'p', actorId: 'p' },
        })),
      }),
    });
  });
};

test('Review Workspace renders the queue, opens a context and records an Approval decision', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Review Center', level: 1 })).toBeVisible();
  await expect(page.getByText(/Knowledge Draft draft-1/)).toBeVisible();

  // Select the context from the queue.
  await page.getByRole('button', { name: /Knowledge Draft draft-1/ }).click();
  await expect(page.getByRole('heading', { name: 'Add fact X' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '검토 대상' })).toBeVisible();

  // Select the item and choose APPROVE.
  await page.getByRole('button', { name: /Add fact X/ }).click();
  await page.getByRole('button', { name: '승인' }).click();
  await page.getByLabel('Add fact X 사유').fill('Matches evidence.');
  await page.getByRole('button', { name: '승인 기록' }).click();

  // Frozen announcement + approval result appear in the live region.
  const liveRegion = page.locator('p.visually-hidden[role="status"]');
  await expect(liveRegion).toContainText('결정 기록됨: APPROVE');
  await expect(liveRegion).toContainText('승인이 발급되었습니다: KNOWLEDGE_CANONICAL_CHANGE');
});

test('Review Workspace has zero axe critical violations', async ({ page }) => {
  await stubSessionAndShell(page);
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Review Center', level: 1 })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter((violation) => violation.impact === 'critical');
  expect(critical).toHaveLength(0);
});

test('Review Workspace exposes no Canonical/Approval/External write endpoint', async ({ page }) => {
  const writes: string[] = [];
  // The catch-all is registered FIRST so the specific feature stubs added by
  // stubSessionAndShell later take priority for their URLs.
  await page.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method();
    const url = request.url();
    if (
      method !== 'GET' &&
      /(\/canonical|\/action\/(approve|preflight|execute|verify|compensation)|\/directives\/apply|\/review\/merge)/i.test(
        url,
      )
    ) {
      writes.push(`${method} ${url}`);
    }
    await route.continue();
  });
  await stubSessionAndShell(page);
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Review Center', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Knowledge Draft draft-1/ }).click();
  await expect(page.getByRole('heading', { name: 'Add fact X' })).toBeVisible();
  expect(writes).toHaveLength(0);
});

test('Review Workspace stays usable at 200% zoom', async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  await stubSessionAndShell(page);
  await client.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: 'Review Center', level: 1 })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
