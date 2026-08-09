import { expect, test, type Page } from '@playwright/test';

/**
 * FE-P5-S2 WP6 — deterministic performance gate for the History Workspace
 * (AC-16).
 *
 * The Frozen AC-16 procedure requires a representative state, baseline
 * measurement, proposed numeric budget, explicit user approval, threshold
 * freeze, then performance verification. This spec follows the approved
 * Activity/Section-3 measurement discipline: deterministic three-sample
 * median gates for the History List display and List → Detail transition, with
 * the same frozen `median ≤ 2000 ms` bar used by the adjacent workspaces.
 *
 * - `history-list-display-ms`: from the `/history` navigation to the committed
 *   federated List (initial list display).
 * - `history-list-to-detail-ms`: from the list-row click to the committed
 *   Detail heading (List → Detail transition).
 *
 * Measurement discipline (mirrors the FE-P5-S1 / FE-P4-S2 performance specs):
 * 1 warm-up navigation + 3 measured samples, reported as the median. Time is
 * measured INSIDE the page from the user gesture to the committed state
 * (polled with requestAnimationFrame) so Playwright actionability overhead is
 * excluded. Local fake route fixtures, headless Chromium, single worker.
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
const GATE_MS = 2000;

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

const detailResult = {
  schemaVersion: '1.0.0',
  entry: canonicalEntry,
};

const stubSessionAndShell = async (page: Page) => {
  await page.route('**/product-api/frontend/route-guard', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(routeGuard) });
  });
  await page.route('**/api/v1/security/csrf', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'browser-history-perf-csrf' }),
    });
  });
  await page.route('**/product-api/frontend/history/workspace', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(listResult) });
  });
  await page.route('**/product-api/frontend/history/entry', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(detailResult) });
  });
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};

// Measures app latency from the /history navigation to the committed List.
const measureListDisplay = (page: Page) =>
  page.evaluate(async () => {
    const committed = () => document.querySelectorAll('ol.history-list li').length > 0;
    while (performance.now() < 10000 && !committed()) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return Math.round(performance.now());
  });

// Measures app latency from the List-row click to the committed Detail heading.
const measureListToDetail = (page: Page) =>
  page.evaluate(async () => {
    // Wait for the committed List first (async load after navigation), then
    // time from the user gesture (row click) to the committed Detail heading.
    const committedList = () => document.querySelectorAll('button.history-list-item').length > 0;
    while (performance.now() < 10000 && !committedList()) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const button = [...document.querySelectorAll('button.history-list-item')].find((element) =>
      element.textContent?.includes('Canonical'),
    ) as HTMLButtonElement | undefined;
    if (!button) return -1;
    const start = performance.now();
    button.click();
    const heading = () =>
      [...document.querySelectorAll('h2')].some(
        (element) => element.textContent?.trim() === 'History entry',
      );
    while (performance.now() - start < 10000 && !heading()) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return Math.round(performance.now() - start);
  });

test('history list display: three-sample median ≤ 2000 ms (AC-16)', async ({ page }) => {
  await stubSessionAndShell(page);
  await page.goto('/history');
  // Warm-up navigation (first navigation excluded per measurement discipline).
  await measureListDisplay(page);
  const samples: number[] = [];
  for (let iteration = 0; iteration < 3; iteration += 1) {
    await page.goto('/history');
    const sample = await measureListDisplay(page);
    console.info(JSON.stringify({ metric: 'history-list-display-sample', sample, iteration }));
    samples.push(sample);
  }
  const result = median(samples);
  console.info(
    JSON.stringify({
      metric: 'history-list-display-median',
      samples,
      median: result,
      gate: GATE_MS,
    }),
  );
  expect(
    result,
    `history list display median ${result} ms ≤ ${GATE_MS} ms (AC-16)`,
  ).toBeLessThanOrEqual(GATE_MS);
});

test('history list-to-detail: three-sample median ≤ 2000 ms (AC-16)', async ({ page }) => {
  await stubSessionAndShell(page);
  await page.goto('/history');
  // Warm-up (first List → Detail transition excluded).
  await measureListToDetail(page);
  const samples: number[] = [];
  for (let iteration = 0; iteration < 3; iteration += 1) {
    await page.goto('/history');
    const sample = await measureListToDetail(page);
    console.info(JSON.stringify({ metric: 'history-list-to-detail-sample', sample, iteration }));
    samples.push(sample);
  }
  const result = median(samples);
  console.info(
    JSON.stringify({
      metric: 'history-list-to-detail-median',
      samples,
      median: result,
      gate: GATE_MS,
    }),
  );
  expect(
    result,
    `history list-to-detail median ${result} ms ≤ ${GATE_MS} ms (AC-16)`,
  ).toBeLessThanOrEqual(GATE_MS);
});
