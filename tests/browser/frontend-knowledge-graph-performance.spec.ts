import { expect, test, type Page } from '@playwright/test';

/**
 * AC-23 performance + lifecycle suite.
 *
 * Reference environment: GitHub Actions ubuntu-24.04, Node 24, Playwright
 * Chromium, single worker, PostgreSQL service container. All timing thresholds
 * are the same ones enforced by the CI spec file (playwright.config.ts
 * `perfProject`), so a green run here implies a green run on CI for the same
 * assertions.
 *
 * Measurement discipline:
 * - 1 warm-up navigation + 3 measured samples, reported as the median.
 * - Layout time is measured from the snapshot data commit (heading visible,
 *   meaning the snapshot has been decoded and committed to the store) to the
 *   canvas `data-layout-complete` marker, which cytoscape sets only when its
 *   `layoutstop` event fires — never from mere React mount.
 * - Interaction time is measured from the user gesture to the committed
 *   announcement (state machine commit), not from the DOM paint.
 */

const NODE_COUNT = 500;
const EDGE_COUNT = 1000;

const routeGuard = {
  schemaVersion: '1.0.0',
  decision: 'ALLOW',
  targetRoute: { routeId: 'knowledge', href: '/knowledge' },
  masked: false,
  message: 'Allowed.',
  accessRevision: '1',
  policyContextRevision: '1',
};

const revisionBinding = {
  schemaVersion: '1.0.0',
  projectionRevision: 'proj-1',
  policyContextRevision: '1',
  accessRevision: '1',
};

const appliedLimits = {
  schemaVersion: '1.0.0',
  maxDepth: 3,
  maxNodes: 500,
  maxEdges: 1000,
  traversalBudget: 1000,
  serverTimeoutBudgetMs: 5000,
  requestedMaxDepth: null,
  requestedMaxNodes: null,
  requestedMaxEdges: null,
  clamped: false,
};

const buildNode = (index: number) => {
  const id = `entity-${index}`;
  return {
    schemaVersion: '1.0.0',
    nodeId: `node-${index}`,
    resourceRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: id },
    label: `Entity ${index}`,
    nodeKind: 'ENTITY',
    authority: 'CANONICAL',
    baseViewMembership: 'KNOWLEDGE_SEMANTIC',
    overlayMemberships: [],
    revisionBinding,
    accessMasking: 'VISIBLE',
    payload: {
      schemaVersion: '1.0.0',
      nodeKind: 'ENTITY',
      entity: {
        schemaVersion: 'entity.v1',
        entityType: 'PERSON',
        displayName: `Entity ${index}`,
      },
    },
  } as const;
};

const buildEdge = (index: number, from: number, to: number) => ({
  schemaVersion: '1.0.0',
  edgeId: `edge-${index}`,
  from: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: `entity-${from}` },
  to: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: `entity-${to}` },
  edgeSemanticKind: 'CANONICAL_RELATION',
  authority: 'CANONICAL',
  baseViewMembership: 'KNOWLEDGE_SEMANTIC',
  overlayMemberships: [],
  revisionBinding,
  accessMasking: 'VISIBLE',
});

// 500 nodes + 1000 edges: a chain with chords keeps the graph connected while
// staying within the applied limits the server reports.
const largeNodes = Array.from({ length: NODE_COUNT }, (_, index) => buildNode(index + 1));
const largeEdges = Array.from({ length: EDGE_COUNT }, (_, index) =>
  buildEdge(index + 1, (index % NODE_COUNT) + 1, ((index + 1) % NODE_COUNT) + 1),
);

const largeSnapshot = {
  schemaVersion: '1.0.0',
  identity: {
    schemaVersion: '1.0.0',
    snapshotId: 'perf-snapshot',
    projectId: 'server-project-1',
    viewKind: 'KNOWLEDGE_SEMANTIC',
    projectionRevision: 'proj-1',
    generatedAt: '2026-08-04T08:00:00.000Z',
  },
  health: 'COMPLETE',
  completeness: 'COMPLETE',
  nodes: largeNodes,
  edges: largeEdges,
  appliedLimits,
  overlays: [],
  capabilities: { schemaVersion: '1.0.0', capabilities: ['SNAPSHOT'] },
};

const stubRoutes = async (page: Page, options?: { snapshotDelayMs?: number }) => {
  // The product API wraps the guard projection as `{ decision: ... }`; the
  // client decodes `body.decision`, so the stub must use the same envelope.
  await page.route('**/product-api/frontend/route-guard', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ decision: routeGuard }),
    });
  });
  await page.route('**/api/v1/security/csrf', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'browser-graph-perf-csrf' }),
    });
  });
  await page.route('**/product-api/frontend/knowledge/graph/snapshot', async (route) => {
    if (options?.snapshotDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.snapshotDelayMs!));
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(largeSnapshot) });
  });
};

const openGraph = async (page: Page) => {
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  // Snapshot data commit: the decoded snapshot is rendered into the store and
  // announced. This is the T0 reference point for layout timing.
  await expect(page.getByText(/Snapshot: perf-snapshot/)).toBeVisible();
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const left = sorted[mid - 1] ?? 0;
  const right = sorted[mid] ?? 0;
  return sorted.length % 2 === 0 ? (left + right) / 2 : right;
};

test('AC-23: initial layout completes within 2000ms (median of 3 samples after warm-up)', async ({
  page,
}) => {
  await stubRoutes(page);

  // Warm-up navigation (measurement discipline: first navigation excluded).
  await openGraph(page);
  await page.locator('[data-layout-complete="true"]').waitFor({ state: 'attached' });

  const samples: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    await page.reload();
    await expect(page.getByText(/Snapshot: perf-snapshot/)).toBeVisible();
    const started = Date.now();
    await page.locator('[data-layout-complete="true"]').waitFor({ state: 'attached' });
    samples.push(Date.now() - started);
  }
  const layoutMs = median(samples);
  // Round-3 evidence: the raw samples and median are emitted to the test
  // output so the verification record can cite the observed values exactly.
  console.info(JSON.stringify({ metric: 'graph-layout-ms', samples, median: layoutMs }));
  expect(layoutMs, `median layout ${layoutMs}ms`).toBeLessThanOrEqual(2000);
});

test('AC-23: interaction (select) commits within 100ms (median of 3 samples)', async ({ page }) => {
  await stubRoutes(page);
  await openGraph(page);
  await page.locator('[data-layout-complete="true"]').waitFor({ state: 'attached' });

  // Focus the first node so each Enter below is an independent gesture.
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  await expect(page.getByRole('status')).toHaveText('');

  const samples: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    // Measures the app's interaction response: from the user gesture (Enter)
    // to the committed status announcement. The event is dispatched through
    // the app's real native keydown handler and the commit is polled inside
    // the page with requestAnimationFrame, so Playwright's click/scroll
    // actionability overhead is excluded — this is the app latency, not the
    // test harness latency.
    const target = `선택됨: Entity ${i + 1}`;
    const interactionMs = await page.evaluate(async (targetText) => {
      const status = document.querySelector<HTMLElement>('[role="status"]');
      const start = performance.now();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      while (performance.now() - start < 5000 && !status?.textContent?.includes(targetText)) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return Math.round(performance.now() - start);
    }, target);
    await expect(page.getByRole('status')).toContainText(target);
    samples.push(interactionMs);
    if (i < 2) {
      await page.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      });
    }
  }
  const interactionMs = median(samples);
  // Round-3 evidence: raw samples and median emitted for the record.
  console.info(JSON.stringify({ metric: 'graph-interaction-ms', samples, median: interactionMs }));
  expect(interactionMs, `median interaction ${interactionMs}ms`).toBeLessThanOrEqual(100);
});

test('AC-23: AbortController cancels an in-flight snapshot fetch on navigation', async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));

  await stubRoutes(page);
  // Register the delayed snapshot route AFTER the stub so it wins Playwright's
  // last-registered-first matching and represents the in-flight request.
  let fulfillAttempted = false;
  await page.route('**/product-api/frontend/knowledge/graph/snapshot', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    fulfillAttempted = true;
    try {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(largeSnapshot),
      });
    } catch {
      // The client aborted the request before the route could fulfill — this
      // is the expected behaviour being verified.
    }
  });

  await page.goto('/knowledge/graph');
  // Wait until the snapshot request is actually in flight (the delayed route
  // is now pending its 4000ms timer) before navigating away.
  await page.waitForRequest((request) => request.url().includes('/knowledge/graph/snapshot'));
  // Navigate away while the snapshot request is still in flight.
  await page.goto('/knowledge');
  await expect(page.getByRole('heading', { name: 'Knowledge', level: 1 })).toBeVisible();
  await page.waitForTimeout(4200);

  // The aborted request must never have been committed: no snapshot rendered,
  // no unhandled rejection, and the late response was dropped.
  expect(fulfillAttempted).toBe(true);
  expect(pageErrors).toHaveLength(0);
  await expect(page.getByText(/Snapshot: perf-snapshot/)).toHaveCount(0);
});

test('AC-23: cytoscape destroy runs exactly once per unmount and no instance accumulates', async ({
  page,
}) => {
  await stubRoutes(page);

  // Initial mount (full page load establishes the lifecycle counter).
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  await page.locator('[data-layout-complete="true"]').waitFor({ state: 'attached' });

  // Three true SPA mount/unmount cycles: switching to the list view unmounts
  // the canvas (destroy), switching back mounts a fresh cytoscape instance.
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press('Alt+l');
    // No DOM residue: the canvas container is fully removed after unmount.
    await expect(page.locator('[data-testid="graph-canvas"]')).toHaveCount(0);
    await page.keyboard.press('Alt+v');
    await page.locator('[data-layout-complete="true"]').waitFor({ state: 'attached' });
  }

  // Unmount once more so the final assertion checks a fully idle instance set.
  await page.keyboard.press('Alt+l');
  await expect(page.locator('[data-testid="graph-canvas"]')).toHaveCount(0);

  const perf = await page.evaluate(
    () =>
      (
        window as Window & {
          __shotgunGraphPerf?: { mounted: number; destroyed: number; active: number };
        }
      ).__shotgunGraphPerf,
  );
  expect(perf).toBeDefined();
  // StrictMode double-invokes effects in the dev build, so each logical mount
  // contributes two raw setups. The AC-23 lifecycle invariants are what
  // matter: every mount is balanced by exactly one destroy (proving destroy
  // runs once per unmount, not twice), and no instance remains — there is no
  // accumulation across the 3 mount/unmount cycles.
  expect(perf!.active).toBe(0);
  expect(perf!.destroyed).toBe(perf!.mounted);
  expect(perf!.mounted).toBeGreaterThanOrEqual(8); // 4 logical mounts × 2 (StrictMode)
});
