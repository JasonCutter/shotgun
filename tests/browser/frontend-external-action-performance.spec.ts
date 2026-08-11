import { expect, test, type Page } from '@playwright/test';

/**
 * FE-P4-S2 WP6 remediation (Review 4868951109 blocker 2) — deterministic
 * performance / lifecycle baseline for the External Action workspace.
 *
 * The Frozen Implementation Request requires a "Deterministic
 * performance/lifecycle baseline + Approved numeric Gate". This spec measures
 * two lifecycle segments deterministically and emits the raw samples + median
 * so the WP6 Evidence document can cite the exact observed values:
 *
 * - `external-action-queue-to-detail-ms`: from the queue selection gesture to
 *   the committed detail heading (the Queue → Detail lifecycle segment).
 * - `external-action-command-ms`: from the governed Cancel gesture to the
 *   committed frozen announcement (command wiring round-trip).
 *
 * Measurement discipline (mirrors the knowledge-graph performance spec):
 * - 1 warm-up navigation + 3 measured samples, reported as the median.
 * - Time is measured INSIDE the page from the user gesture to the committed
 *   state (polled with requestAnimationFrame), so Playwright actionability
 *   overhead is excluded — this is the app latency, not the test harness.
 * - Environment and fixtures are pinned: local fake route fixtures, the browser
 *   fixture backend session/shell, headless Chromium, single worker.
 *
 * GATE: Review 4869347580 APPROVED the numeric gate (external-action-
 * queue-to-detail-ms median ≤ 2000ms; external-action-command-ms median ≤
 * 2000ms) and explicitly required this spec to assert the approved gate. The
 * measurement method (headless Chromium, single worker, local fake fixture,
 * warm-up 1회 제외, 3회 측정, median, in-page performance.now + rAF) was also
 * approved. Measured medians are far below the gate (79ms / 204ms).
 */

const routeGuard = {
  decision: {
    schemaVersion: '1.0.0',
    decision: 'ALLOW',
    targetRoute: { routeId: 'external-action', href: '/external-action' },
    masked: false,
    message: 'Allowed.',
    accessRevision: '1',
    policyContextRevision: '1',
  },
};

const now = '2026-08-05T12:00:00.000Z';
const PROJECT = 'shotgun';
const DIGEST = `sha256:${'f'.repeat(64)}`;

const action = {
  schemaVersion: '1.0.0',
  actionId: 'action-1',
  actionRevision: 4,
  operation: 'UPDATE_REVERSIBLE',
  resourceProjectId: PROJECT,
  effectiveProjectId: PROJECT,
  accessRevision: 'access-1',
  policyContextRevision: 'policy-1',
  status: 'READY_TO_EXECUTE',
  aggregateState: 'AVAILABLE',
  accessMasking: 'VISIBLE',
  maskedFields: [],
  capabilities: [],
  updatedAt: now,
  createdAt: now,
  targetRef: {
    schemaVersion: '1.0.0',
    targetKind: 'KNOWN_TARGET',
    targetId: 'target-1',
    targetRevision: 'rev-3',
    externalRevision: 'ext-7',
  },
  manifestRef: { schemaVersion: '1.0.0', resourceKind: 'manifest', resourceId: 'manifest-1' },
  riskDecisionRef: { schemaVersion: '1.0.0', resourceKind: 'riskDecision', resourceId: 'risk-1' },
  latestExecutionRef: {
    schemaVersion: '1.0.0',
    resourceKind: 'execution',
    resourceId: 'execution-1',
  },
};

const queueResult = {
  schemaVersion: '1.0.0',
  items: [
    {
      schemaVersion: '1.0.0',
      actionId: 'action-1',
      actionRevision: 4,
      operation: 'UPDATE_REVERSIBLE',
      resourceProjectId: PROJECT,
      effectiveProjectId: PROJECT,
      status: 'READY_TO_EXECUTE',
      aggregateState: 'AVAILABLE',
      capabilities: [],
      riskLevel: 'R4',
      updatedAt: now,
    },
  ],
  nextCursor: undefined,
  capabilities: [],
};

const detailResult = {
  schemaVersion: '1.0.0',
  action,
  attempts: [],
};

const stubPerfRoutes = async (page: Page) => {
  await page.route('**/product-api/frontend/route-guard', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(routeGuard) });
  });
  await page.route('**/api/v1/security/csrf', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'browser-external-action-perf-csrf' }),
    });
  });
  await page.route('**/product-api/frontend/external-action/queue', async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(queueResult) });
  });
  await page.route('**/product-api/frontend/external-action/actions/read', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: '1.0.0', action }),
    });
  });
  await page.route('**/product-api/frontend/external-action/actions/detail', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(detailResult),
    });
  });
  await page.route('**/product-api/frontend/external-action/cancel', async (route) => {
    const body = route.request().postDataJSON() as Record<string, string>;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        outcome: 'COMPLETED',
        clientRequestId: body.clientRequestId,
        idempotencyKey: body.idempotencyKey,
        commandSemanticDigest: DIGEST,
        actionId: body.actionId,
        status: 'CANCELLING',
      }),
    });
  });
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const left = sorted[mid - 1] ?? 0;
  const right = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? (left + right) / 2 : right;
};

// Measures app latency from the queue selection gesture to the committed
// detail heading (Queue → Detail lifecycle segment), in-page with rAF polling.
const measureQueueToDetail = (page: Page, actionId: string) =>
  page.evaluate(async (target) => {
    const button = Array.from(document.querySelectorAll('button')).find((entry) =>
      (entry.textContent ?? '').includes(target),
    );
    if (!button) return -1;
    const start = performance.now();
    (button as HTMLButtonElement).click();
    const heading = () => document.getElementById('external-action-detail-heading');
    while (performance.now() - start < 10000 && heading()?.textContent?.trim() !== target) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return Math.round(performance.now() - start);
  }, actionId);

// Measures app latency from the governed Cancel gesture to the committed
// frozen announcement (command wiring round-trip).
const measureCommand = (page: Page, buttonText: string, targetAnnouncement: string) =>
  page.evaluate(
    async ({ buttonText, targetAnnouncement }) => {
      const button = Array.from(document.querySelectorAll('button')).find((entry) =>
        (entry.textContent ?? '').includes(buttonText),
      );
      if (!button) return -1;
      const live = document.querySelector('p.visually-hidden[aria-live="polite"]');
      const start = performance.now();
      (button as HTMLButtonElement).click();
      while (
        performance.now() - start < 10000 &&
        !live?.textContent?.includes(targetAnnouncement)
      ) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return Math.round(performance.now() - start);
    },
    { buttonText, targetAnnouncement },
  );

test('external-action lifecycle baseline: queue → detail render (median of 3 samples after warm-up)', async ({
  page,
}) => {
  await stubPerfRoutes(page);

  // Warm-up navigation (first navigation excluded per measurement discipline).
  await page.goto('/external-action');
  await expect(page.getByRole('heading', { name: 'External Actions', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: /Update an external resource/ })).toBeVisible();
  await measureQueueToDetail(page, 'Update an external resource');
  await expect(page.getByRole('heading', { name: 'Update an external resource' })).toBeVisible();

  const samples: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    // Fresh navigation to the bare route each sample: a clean Queue → Detail
    // lifecycle segment (a reload at a deep-link URL would re-enter the
    // already-selected action, which is a separate interaction, not the
    // queue→detail segment being measured here).
    await page.goto('/external-action');
    await expect(page.getByRole('heading', { name: 'External Actions', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /Update an external resource/ })).toBeVisible();
    const sample = await measureQueueToDetail(page, 'Update an external resource');
    console.info(JSON.stringify({ metric: 'queue-to-detail-sample', sample, iteration: i }));
    samples.push(sample);
    await expect(page.getByRole('heading', { name: 'Update an external resource' })).toBeVisible();
  }
  const queueToDetailMs = median(samples);
  console.info(
    JSON.stringify({
      metric: 'external-action-queue-to-detail-ms',
      samples,
      median: queueToDetailMs,
    }),
  );
  // Approved numeric gate (Review 4869347580): median ≤ 2000ms.
  expect(queueToDetailMs, `median queue→detail ${queueToDetailMs}ms`).toBeLessThanOrEqual(2000);
});

test('external-action lifecycle baseline: governed command round-trip (median of 3 samples after warm-up)', async ({
  page,
}) => {
  await stubPerfRoutes(page);

  // Warm-up: open the workspace, select the action and complete one Cancel.
  await page.goto('/external-action');
  await expect(page.getByRole('heading', { name: 'External Actions', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Update an external resource/ }).click();
  await expect(page.getByRole('button', { name: '취소 요청' })).toBeVisible();
  await measureCommand(page, '취소 요청', '취소 요청이 기록되었습니다');
  await expect(page.locator('p.visually-hidden[aria-live="polite"]')).toContainText(
    '취소 요청이 기록되었습니다',
  );

  const samples: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    // After a completed Cancel the announcement persists; reset it so each
    // sample measures a fresh command round-trip from an idle state.
    await page.evaluate(() => {
      const live = document.querySelector('p.visually-hidden[aria-live="polite"]');
      if (live) live.textContent = '';
    });
    samples.push(await measureCommand(page, '취소 요청', '취소 요청이 기록되었습니다'));
    await expect(page.locator('p.visually-hidden[aria-live="polite"]')).toContainText(
      '취소 요청이 기록되었습니다',
    );
  }
  const commandMs = median(samples);
  console.info(
    JSON.stringify({ metric: 'external-action-command-ms', samples, median: commandMs }),
  );
  // Approved numeric gate (Review 4869347580): median ≤ 2000ms.
  expect(commandMs, `median command ${commandMs}ms`).toBeLessThanOrEqual(2000);
});
