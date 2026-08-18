import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { expectTechnicalInformation } from './hfm-technical.js';

/**
 * FE-P5-S1 WP6 — Activity Workspace browser accessibility + E2E evidence
 * (AC-15).
 *
 * WP4/WP5 already prove the workspace behaviour (queue filters, deterministic
 * focus, deep-link restore, lineage tables, available-action delegation) at the
 * unit level. WP6 adds ONLY the browser-level AC-15 evidence the frozen
 * criterion requires and that unit tests cannot provide: axe zero-critical,
 * keyboard-only queue selection with Enter, deterministic focus movement to the
 * Detail heading, frozen live-region announcements, and the list/table
 * accessibility representations.
 *
 * The browser fixture backend serves the real session + global shell; the
 * route guard, CSRF token and every Activity read (queue/detail/stages/events/
 * refresh) are stubbed with the strict-decoder-valid fixtures below (project
 * `shotgun` matches the browser fixture default project). No governed write is
 * exercised here — the AC-06/AC-07/AC-13 write-boundary proofs already exist at
 * the contract/integration level.
 */

const routeGuard = {
  decision: {
    schemaVersion: '1.0.0',
    decision: 'ALLOW',
    targetRoute: { routeId: 'activity', href: '/activity' },
    masked: false,
    message: 'Allowed.',
    accessRevision: '1',
    policyContextRevision: '1',
  },
};

const now = '2026-08-06T12:00:00.000Z';
const PROJECT = 'shotgun';

const sourcesRoot = {
  schemaVersion: '1.0.0',
  rootKind: 'JOB',
  activityId: 'submission-1',
  domainKind: 'SOURCES',
  domainResourceKind: 'IntakeSubmission',
  domainResourceId: 'submission-1',
  resourceProjectId: PROJECT,
  resourceHref: `/product-api/frontend/sources/read?submissionId=submission-1`,
  jobId: 'submission-1',
  runId: 'submission-1',
};

const metadata = {
  schemaVersion: '1.0.0',
  snapshotRevision: 3,
  generatedAt: now,
  sourceUpdatedAt: now,
  freshness: 'CURRENT',
  lagMilliseconds: 120,
  adapterStatus: 'AVAILABLE',
  partial: false,
};

const dimensions = {
  schemaVersion: '1.0.0',
  attention: 'NEEDS_ATTENTION',
  retryability: 'UNKNOWN',
  freshness: 'CURRENT',
  adapterStatus: 'AVAILABLE',
};

const queueResult = {
  schemaVersion: '1.0.0',
  items: [
    {
      root: sourcesRoot,
      summary: 'Sources intake submission submission-1',
      state: 'RUNNING',
      dimensions,
      updatedAt: now,
    },
  ],
  metadata,
  nextCursor: undefined,
};

const detailResult = {
  schemaVersion: '1.0.0',
  root: sourcesRoot,
  run: {
    schemaVersion: '1.0.0',
    runId: 'submission-1',
    jobId: 'submission-1',
    sequence: 1,
    state: 'RUNNING',
    startedAt: now,
    updatedAt: now,
    domainAttemptRefs: [],
    correlationRefs: [],
    causationRefs: [],
  },
  attempts: [
    {
      schemaVersion: '1.0.0',
      attemptId: 'attempt-1',
      runId: 'submission-1',
      attemptNumber: 1,
      attemptKind: 'SOURCES_INTAKE',
      state: 'RUNNING',
      retryability: 'NOT_RETRYABLE',
      startedAt: now,
      updatedAt: now,
      stageRefs: [],
    },
  ],
  stages: [
    {
      schemaVersion: '1.0.0',
      stageId: 'item-1',
      stageKey: 'intake-item-1',
      label: 'Item 1',
      sequence: 1,
      state: 'RUNNING',
      startedAt: now,
      updatedAt: now,
    },
  ],
  events: [
    {
      schemaVersion: '1.0.0',
      eventId: 'attempt-1',
      relatedRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'IntakeSubmissionItem',
        resourceId: 'item-1',
      },
      category: 'STARTED',
      sequence: 1,
      occurredAt: now,
      summary: 'Sources intake attempt 1 RUNNING',
      domainResourceRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'IntakeSubmission',
        resourceId: 'submission-1',
      },
    },
  ],
  transportAttempts: [
    {
      schemaVersion: '1.0.0',
      transportAttemptId: 'transport-1',
      transportKind: 'sources-command',
      commandOrMessageRef: {
        schemaVersion: '1.0.0',
        resourceKind: 'IntakeSubmissionItem',
        resourceId: 'item-1',
      },
      deliverySequence: 1,
      deliveryResult: 'DELIVERED',
      deliveredAt: now,
    },
  ],
  metadata,
  dimensions,
  availableActions: [],
};

const stagesResult = { schemaVersion: '1.0.0', stages: [] };
const eventsResult = { schemaVersion: '1.0.0', events: [] };

const refreshResult = {
  schemaVersion: '1.0.0',
  resourceProjectId: PROJECT,
  snapshotRevision: 4,
  indexCount: 1,
  watermarks: [
    {
      resourceProjectId: PROJECT,
      adapterId: 'sources',
      domainKind: 'SOURCES',
      snapshotRevision: 4,
      adapterStatus: 'AVAILABLE',
      projectedAt: now,
      lagMilliseconds: 0,
    },
  ],
};

// Stub the route guard (ALLOW for /activity), CSRF token and every Activity
// READ. The real shell from the browser fixture backend already exposes the
// activity navigation entry.
const stubActivityReads = async (page: Page) => {
  await page.route('**/product-api/frontend/route-guard', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(routeGuard),
    });
  });
  await page.route('**/api/v1/security/csrf', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'browser-activity-csrf' }),
    });
  });
  await page.route('**/product-api/frontend/activity/queue', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(queueResult),
    });
  });
  await page.route('**/product-api/frontend/activity/detail', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(detailResult),
    });
  });
  await page.route('**/product-api/frontend/activity/stages', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(stagesResult),
    });
  });
  await page.route('**/product-api/frontend/activity/events', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(eventsResult),
    });
  });
  await page.route('**/product-api/frontend/activity/refresh', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(refreshResult),
    });
  });
};

// Open the workspace and wait for the committed Queue.
const openQueue = async (page: Page) => {
  await page.goto('/activity');
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Source processing/ })).toBeVisible();
};

test('Activity Workspace has zero critical accessibility violations (axe, AC-15)', async ({
  page,
}) => {
  await stubActivityReads(page);
  await openQueue(page);

  // Select an item, verify technical lineage remains explicitly available,
  // then scan the normal workspace.
  await page.getByRole('button', { name: /Source processing/ }).click();
  await expect(page.getByRole('heading', { name: 'Sources activity' })).toBeVisible();
  await expect(page.locator('details.technical-details')).toHaveCount(0);
  await expectTechnicalInformation(page, ['Domain Attempts', 'Transport Attempts']);

  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(
    critical.map((violation) => `${violation.id}: ${violation.help}`),
    `critical/serious violations: ${JSON.stringify(critical, null, 2)}`,
  ).toEqual([]);
});

test('Activity Workspace queue items are keyboard-navigable and activatable with Enter (AC-15)', async ({
  page,
}) => {
  await stubActivityReads(page);
  await openQueue(page);

  // Tab until the queue item is focused (keyboard-only), then activate with
  // Enter — no pointer required.
  const queueButton = page.getByRole('button', { name: /Source processing/ });
  let focused = false;
  for (let i = 0; i < 40 && !focused; i += 1) {
    await page.keyboard.press('Tab');
    focused = await queueButton.evaluate((element) => element === document.activeElement);
  }
  expect(focused, 'queue item reached by Tab').toBe(true);
  await page.keyboard.press('Enter');

  // Detail heading becomes visible and receives focus (deterministic focus,
  // AC-15).
  const detailHeading = page.getByRole('heading', { name: 'Sources activity' });
  await expect(detailHeading).toBeVisible();
  await expect
    .poll(async () => detailHeading.evaluate((element) => element === document.activeElement))
    .toBe(true);

  // The queue item is announced as selected (`aria-current`) — the selection
  // is conveyed by state, not color alone.
  await expect(queueButton).toHaveAttribute('aria-current', 'true');
});

test('Activity Workspace delivers the frozen selection announcement to the live region (AC-15)', async ({
  page,
}) => {
  await stubActivityReads(page);
  await openQueue(page);

  const liveRegion = page.locator('p.visually-hidden[aria-live="polite"]');
  await page.getByRole('button', { name: /Source processing/ }).click();
  await expect(page.getByRole('heading', { name: 'Sources activity' })).toBeVisible();
  await expect(liveRegion).toContainText('활동 세부 정보를 표시합니다.');
});

test('Activity Workspace keeps queue semantics and exposes lineage through technical.current', async ({
  page,
}) => {
  await stubActivityReads(page);
  await openQueue(page);

  // The Queue is a list representation (aria-label), not a bare div soup.
  await expect(page.getByRole('list', { name: '활동 큐' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Source processing/ })).toBeVisible();

  // Selecting keeps the human summary in the page while bounded lineage is
  // available only through the explicit read-only command.
  await page.getByRole('button', { name: /Source processing/ }).click();
  await expect(page.getByRole('heading', { name: 'Sources activity' })).toBeVisible();
  await expect(page.getByText('Technical details', { exact: true })).toHaveCount(0);
  await expectTechnicalInformation(page, [
    'Domain Attempts',
    'Transport Attempts',
    'Stages',
    'Events',
  ]);
});
