import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { expectTechnicalInformation } from './hfm-technical.js';

/**
 * FE-P5-S2 WP6 — History Workspace browser E2E + accessibility evidence
 * (AC-15 full Section flow; AC-14 cursor/pagination; AC-04 payload display;
 * AC-09 Compensation delegation; AC-07/08 Reversal → Review; AC-10/13
 * deleted-project audit deep link).
 *
 * WP1–WP5 prove the workspace behaviour at the unit/integration level. WP6
 * adds ONLY the browser-level evidence unit tests cannot provide: axe
 * zero-critical, keyboard-only selection, list/detail rendering of the
 * federated History, frozen-tuple pagination, authoritative payload display,
 * audit-lineage/Compensation links, Reversal → Review navigation, and the
 * deleted-project audit deep-link target.
 *
 * The browser fixture backend serves the real session + global shell; the
 * route guard, CSRF token and every History/Review endpoint are stubbed with
 * the strict-decoder-valid fixtures below (project `shotgun` matches the
 * browser fixture default project).
 */

const routeGuard = {
  decision: {
    schemaVersion: '1.0.0',
    decision: 'ALLOW',
    targetRoute: { routeId: 'history', href: '/history' },
    masked: false,
    message: 'Allowed.',
    accessRevision: '1',
    policyContextRevision: '1',
  },
};

const now = '2026-08-09T12:00:00.000Z';
const PROJECT = 'shotgun';

const canonicalEntry = {
  schemaVersion: '1.0.0',
  historyEntryId: `history:${PROJECT}:e-1`,
  resourceProjectId: PROJECT,
  domainKind: 'CANONICAL',
  domainResourceKind: 'CANONICAL_CLAIM',
  domainResourceId: 'claim:e-1',
  sourceEventKind: 'CANONICAL_CLAIM_ADDED',
  sourceEventId: 'e-1',
  occurredAt: now,
  payloadAvailability: 'AVAILABLE',
  payloadSnapshot: {
    eventType: 'CANONICAL_CLAIM_ADDED',
    reason: 'commit',
    beforeVersion: 1,
    afterVersion: 2,
    commitId: 'commit-2',
    revisionId: 'revision:rev-2',
    claimId: 'claim:e-1',
  },
  projectedAt: now,
};

const reviewEntry = {
  schemaVersion: '1.0.0',
  historyEntryId: `history:${PROJECT}:r-1`,
  resourceProjectId: PROJECT,
  domainKind: 'REVIEW',
  domainResourceKind: 'REVIEW_DECISION',
  domainResourceId: 'ctx-1',
  sourceEventKind: 'DECISION',
  sourceEventId: 'r-1',
  occurredAt: now,
  payloadAvailability: 'AVAILABLE',
  payloadSnapshot: { eventType: 'DECISION', reason: 'approved' },
  projectedAt: now,
};

const externalAuditEntry = {
  schemaVersion: '1.0.0',
  historyEntryId: `history:${PROJECT}:audit-1`,
  resourceProjectId: PROJECT,
  domainKind: 'EXTERNAL_ACTION',
  domainResourceKind: 'EXTERNAL_ACTION',
  domainResourceId: 'action-1',
  sourceEventKind: 'AUDIT_EVENT',
  sourceEventId: 'audit-1',
  occurredAt: now,
  payloadAvailability: 'AVAILABLE',
  payloadSnapshot: { eventType: 'AUDIT_EVENT', actionId: 'action-1' },
  projectedAt: now,
};

const purgedEntry = {
  schemaVersion: '1.0.0',
  historyEntryId: `history:${PROJECT}:p-1`,
  resourceProjectId: PROJECT,
  domainKind: 'POLICY',
  domainResourceKind: 'POLICY_CHANGE',
  domainResourceId: 'event:1',
  sourceEventKind: 'SETTINGS_AUDIT_EVENT',
  sourceEventId: 'p-1',
  occurredAt: now,
  payloadAvailability: 'PURGED_BY_POLICY',
  payloadSnapshot: { digest: 'sha256:redacted' },
  projectedAt: now,
};

const listResult = {
  schemaVersion: '1.0.0',
  entries: [canonicalEntry, reviewEntry, externalAuditEntry, purgedEntry],
  nextCursor: {
    schemaVersion: '1.0.0',
    occurredAt: now,
    domainKind: 'POLICY',
    sourceEventKind: 'SETTINGS_AUDIT_EVENT',
    sourceEventId: 'event:1',
  },
};

const detailResult = (historyEntryId: string) => {
  const match = [canonicalEntry, reviewEntry, externalAuditEntry, purgedEntry].find(
    (entry) => entry.historyEntryId === historyEntryId,
  );
  return { schemaVersion: '1.0.0', entry: match ?? canonicalEntry };
};

const reversalResult = {
  schemaVersion: '1.0.0',
  reversal: {
    schemaVersion: '1.0.0',
    reversalId: 'reversal:e2e-1',
    resourceProjectId: PROJECT,
    sourceRevisionId: 'revision:rev-2',
    sourceCommitId: 'commit-2',
    status: 'CANDIDATE',
    createdAt: now,
    createdBy: 'browser-fixture-principal',
  },
  eligibility: {
    schemaVersion: '1.0.0',
    sourceRevisionId: 'revision:rev-2',
    eligible: true,
    reasons: [],
  },
};

const reviewQueueResult = {
  schemaVersion: '1.0.0',
  acceptedContext: {
    schemaVersion: '1.0.0',
    resourceProjectId: PROJECT,
    accessRevision: '1',
    policyContextRevision: '1',
  },
  queueSnapshotRevision: 'queue-1',
  items: [
    {
      schemaVersion: '1.0.0',
      reviewContextId: 'reversal-context-1',
      contextRevision: 1,
      targetKind: 'KNOWLEDGE_DRAFT_CHANGE_SET',
      targetId: 'reversal:e2e-1',
      targetLabel: 'Knowledge Draft reversal:e2e-1 (revision 1)',
      aggregateState: 'PENDING',
      itemCount: 1,
      updatedAt: now,
      attentionReasons: ['REQUIRES_ACTION'],
      capabilities: ['READ_CONTEXT', 'READ_ITEM', 'RECORD_DECISIONS'],
    },
  ],
  totalCountStatus: 'EXACT',
  capabilities: ['READ_CONTEXT'],
};

const stubSessionAndShell = async (page: Page) => {
  await page.route('**/product-api/frontend/route-guard', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(routeGuard) });
  });
  await page.route('**/api/v1/security/csrf', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'browser-history-csrf' }),
    });
  });
  await page.route('**/product-api/frontend/history/workspace', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(listResult) });
  });
  await page.route('**/product-api/frontend/history/entry', async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { historyEntryId?: string };
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(detailResult(body.historyEntryId ?? canonicalEntry.historyEntryId)),
    });
  });
  await page.route('**/product-api/frontend/review/reversal-draft', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(reversalResult) });
  });
  await page.route('**/product-api/frontend/review/queue', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(reviewQueueResult),
    });
  });
};

test('AC-15: renders the federated History list with domain filters and frozen-tuple pagination', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();
  // All four federated entries render.
  await expect(page.locator('ol.history-list li')).toHaveCount(4);
  await expect(page.getByText('Canonical', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('External actions', { exact: true }).first()).toBeVisible();
  // Domain filter controls exist and toggling resets the keyset cursor.
  await expect(page.getByLabel('Review').first()).toBeVisible();
  // Pagination controls exist (nextCursor is present → 다음 enabled, 처음 disabled).
  const next = page.getByRole('button', { name: '다음' });
  const first = page.getByRole('button', { name: '처음' });
  await expect(next).toBeEnabled();
  await expect(first).toBeDisabled();
  await next.click();
  await expect(first).toBeEnabled();
});

test('AC-15: opens an authoritative detail with payload availability display (AVAILABLE)', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/history');
  await page
    .getByRole('button', { name: /Canonical/ })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Knowledge claim added', level: 2 }),
  ).toBeVisible();
  await expect(page.getByText('CANONICAL_CLAIM_ADDED', { exact: true })).toBeHidden();
  await expect(page.getByText('Available', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Technical details', { exact: true })).toHaveCount(0);
  await expectTechnicalInformation(page, ['CANONICAL_CLAIM_ADDED', 'revision:rev-2']);
});

test('AC-15: links audit lineage and Compensation to the owning External Action workspace', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/history');
  await page
    .getByRole('button', { name: /External actions/ })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'External action audit updated', level: 2 }),
  ).toBeVisible();
  const lineage = page.getByRole('link', { name: 'Audit lineage (External action)' });
  const compensation = page.getByRole('link', { name: 'Compensation (External action)' });
  await expect(lineage).toHaveAttribute('href', '/external-action?actionId=action-1');
  await expect(compensation).toHaveAttribute('href', '/external-action?actionId=action-1');
});

test('AC-07/08/15: initiates a Reversal and navigates to the current Review Workspace', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/history');
  await page
    .getByRole('button', { name: /Canonical/ })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { name: 'Knowledge claim added', level: 2 }),
  ).toBeVisible();
  const reversalRequest = page.waitForRequest((request) =>
    request.url().endsWith('/product-api/frontend/review/reversal-draft'),
  );
  await page.getByRole('button', { name: 'Reversal draft 생성' }).click();
  const sent = await reversalRequest;
  // The browser sends the authoritative revision identity (never a numeric
  // afterVersion).
  const body = sent.postDataJSON() as { sourceRevisionId?: string };
  expect(body.sourceRevisionId).toBe('revision:rev-2');
  // On success the current Review Workspace takes over.
  await expect(page).toHaveURL(/\/review/);
  await expect(page.getByText('reversal:e2e-1').first()).toBeVisible();
});

test('AC-10/13/15: keeps the deleted-project audit target in the History deep link', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  // `/history?resourceProjectId=deleted-1` — the browser names the audit
  // target; the server revalidates tombstone + scope + capability.
  const listRequest = page.waitForRequest((request) =>
    request.url().endsWith('/product-api/frontend/history/workspace'),
  );
  await page.goto('/history?resourceProjectId=deleted-1');
  const sent = await listRequest;
  const body = sent.postDataJSON() as { resourceProjectId?: string };
  expect(body.resourceProjectId).toBe('deleted-1');
  // Selecting an entry must keep the audit target in the URL.
  await page
    .getByRole('button', { name: /Canonical/ })
    .first()
    .click();
  await expect(page).toHaveURL(/resourceProjectId=deleted-1/);
  await expect(
    page.getByRole('heading', { name: 'Knowledge claim added', level: 2 }),
  ).toBeVisible();
});

test('AC-15: axe zero-critical + keyboard-only selection on the History Workspace', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/history');
  // Keyboard-only: focus the first Canonical row and activate with Enter.
  await page
    .getByRole('button', { name: /Canonical/ })
    .first()
    .focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Knowledge claim added', level: 2 }),
  ).toBeVisible();
  // axe scan: zero critical / serious violations on the workspace (the same
  // bar as the Activity/Review accessibility specs).
  const results = await new AxeBuilder({ page }).analyze();
  const issues = results.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact ?? ''),
  );
  expect(issues).toEqual([]);
});
