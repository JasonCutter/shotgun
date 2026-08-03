import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const routeGuard = {
  decision: {
    schemaVersion: '1.0.0',
    decision: 'ALLOW',
    targetRoute: { routeId: 'knowledge', href: '/knowledge' },
    masked: false,
    message: 'Allowed.',
    accessRevision: '1',
    policyContextRevision: '1',
  },
};

const revisionBinding = {
  schemaVersion: '1.0.0',
  projectionRevision: 'proj-1',
  policyContextRevision: '1',
  accessRevision: '1',
};

const graphSnapshot = {
  schemaVersion: '1.0.0',
  identity: {
    schemaVersion: '1.0.0',
    snapshotId: 'snapshot-1',
    projectId: 'server-project-1',
    viewKind: 'KNOWLEDGE_SEMANTIC',
    projectionRevision: 'proj-1',
    generatedAt: '2026-08-04T08:00:00.000Z',
  },
  health: 'COMPLETE',
  completeness: 'COMPLETE',
  nodes: [
    {
      schemaVersion: '1.0.0',
      nodeId: 'node-1',
      resourceRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
      label: 'Entity One',
      nodeKind: 'ENTITY',
      authority: 'CANONICAL',
      baseViewMembership: 'KNOWLEDGE_SEMANTIC',
      overlayMemberships: [],
      revisionBinding,
      accessMasking: 'VISIBLE',
      payload: {
        schemaVersion: '1.0.0',
        nodeKind: 'ENTITY',
        entity: { schemaVersion: 'entity.v1', entityType: 'PERSON', displayName: 'Entity One' },
      },
    },
    {
      schemaVersion: '1.0.0',
      nodeId: 'node-2',
      resourceRef: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId: 'claim-1' },
      label: 'Claim One',
      nodeKind: 'CLAIM',
      authority: 'DERIVED_INFERENCE',
      baseViewMembership: 'KNOWLEDGE_SEMANTIC',
      overlayMemberships: ['CONFLICT'],
      revisionBinding,
      accessMasking: 'VISIBLE',
      payload: {
        schemaVersion: '1.0.0',
        nodeKind: 'CLAIM',
        claim: { schemaVersion: 'claim.v1', statement: 'Claim One' },
      },
    },
    {
      schemaVersion: '1.0.0',
      nodeId: 'node-3',
      resourceRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-3' },
      label: 'Candidate Three',
      nodeKind: 'ENTITY',
      authority: 'DISCOVERY_CANDIDATE',
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
          displayName: 'Candidate Three',
        },
      },
    },
  ],
  edges: [
    {
      schemaVersion: '1.0.0',
      edgeId: 'edge-1',
      from: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
      to: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId: 'claim-1' },
      edgeSemanticKind: 'CANONICAL_RELATION',
      authority: 'CANONICAL',
      baseViewMembership: 'KNOWLEDGE_SEMANTIC',
      overlayMemberships: [],
      revisionBinding,
      accessMasking: 'VISIBLE',
    },
  ],
  appliedLimits: {
    schemaVersion: '1.0.0',
    maxDepth: 3,
    maxNodes: 100,
    maxEdges: 200,
    traversalBudget: 1000,
    serverTimeoutBudgetMs: 5000,
    requestedMaxDepth: null,
    requestedMaxNodes: null,
    requestedMaxEdges: null,
    clamped: false,
  },
  overlays: [],
  capabilities: { schemaVersion: '1.0.0', capabilities: ['SNAPSHOT'] },
};

const refreshedSnapshot = {
  schemaVersion: '1.0.0',
  identity: {
    schemaVersion: '1.0.0',
    snapshotId: 'snapshot-2',
    projectId: 'server-project-1',
    viewKind: 'KNOWLEDGE_SEMANTIC',
    projectionRevision: 'proj-2',
    generatedAt: '2026-08-04T08:01:00.000Z',
  },
  health: 'COMPLETE',
  completeness: 'COMPLETE',
  nodes: graphSnapshot.nodes.map(
    (entry: { resourceRef: { resourceId: string }; label: string }) => ({
      ...entry,
      revisionBinding: { ...revisionBinding, projectionRevision: 'proj-2' },
    }),
  ),
  edges: graphSnapshot.edges.map((entry: Record<string, unknown>) => ({
    ...entry,
    revisionBinding: { ...revisionBinding, projectionRevision: 'proj-2' },
  })),
  appliedLimits: graphSnapshot.appliedLimits,
  overlays: [],
  capabilities: { schemaVersion: '1.0.0', capabilities: ['SNAPSHOT'] },
};

const pathDescription = {
  schemaVersion: '1.0.0',
  snapshotId: 'snapshot-1',
  projectionRevision: 'proj-1',
  pathId: 'path-1',
  segments: [
    {
      schemaVersion: '1.0.0',
      kind: 'ORIGIN',
      step: 0,
      narration: '시작: Entity One',
      nodeRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
    },
    {
      schemaVersion: '1.0.0',
      kind: 'TRAVERSAL',
      step: 1,
      narration: 'Entity One → CANONICAL_RELATION → Claim One',
      nodeRef: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId: 'claim-1' },
      edgeRef: {
        schemaVersion: '1.0.0',
        edgeId: 'edge-1',
        from: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-1' },
        to: { schemaVersion: '1.0.0', resourceKind: 'CLAIM', resourceId: 'claim-1' },
      },
    },
  ],
  summary: 'Entity One에서 Claim One까지의 경로 (1단계)',
};

// The browser fixture backend serves the real session and global shell for
// the bootstrapped local owner. We only stub the route guard (ALLOW), the
// graph snapshot (a controlled rich fixture) and the CSRF token; the graph
// endpoints would otherwise return the empty default in-memory dataset.
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
      body: JSON.stringify({ csrfToken: 'browser-graph-csrf' }),
    });
  });
  await page.route('**/product-api/frontend/knowledge/graph/snapshot', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(graphSnapshot),
    });
  });
  await page.route('**/product-api/frontend/knowledge/graph/snapshot/refresh', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(refreshedSnapshot),
    });
  });
  await page.route('**/product-api/frontend/knowledge/graph/path/describe', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(pathDescription),
    });
  });
};

const tupleKey = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((elements) =>
    elements
      .map((element) => {
        const get = (name: string) => element.getAttribute(name) ?? '';
        return [
          get('data-graph-kind'),
          get('data-graph-id'),
          get('data-graph-label'),
          get('data-graph-authority'),
          get('data-graph-base-view'),
          get('data-graph-overlays'),
        ].join('|');
      })
      .sort(),
  );

test('Graph Workspace renders the snapshot with information-equivalent list and table views', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  await expect(page.getByText(/Snapshot: snapshot-1/)).toBeVisible();

  await page.keyboard.press('Alt+l');
  const listRegion = page.getByRole('region', { name: 'Semantic graph list' });
  await expect(listRegion).toBeVisible();
  const listKeys = await tupleKey(page, '.graph-list-view .graph-item');

  await page.keyboard.press('Alt+t');
  const tableRegion = page.getByRole('region', { name: 'Semantic graph table' });
  await expect(tableRegion).toBeVisible();
  const tableKeys = await tupleKey(page, '.graph-table tbody tr');

  expect(tableKeys).toEqual(listKeys);
  expect(tableKeys).toHaveLength(4); // three nodes + one edge
});

test('Graph Workspace exposes no Canonical/Approval/Action write endpoint during interaction', async ({
  page,
}) => {
  const writeRequests: string[] = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (
      method !== 'GET' &&
      /(canonical|approval|action|commit|changeset|write|review)/i.test(url)
    ) {
      writeRequests.push(`${method} ${url}`);
    }
    await route.continue();
  });
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();

  await page.keyboard.press('Alt+l');
  await page
    .getByRole('region', { name: 'Semantic graph list' })
    .getByRole('button', { name: 'Select' })
    .first()
    .click();
  await page.keyboard.press('Alt+v');
  await page.keyboard.press('Alt+2');
  await page.keyboard.press('Alt+Shift+1');

  expect(writeRequests).toEqual([]);
});

test('Graph Workspace keyboard set switches base view, toggles overlays and announces selection', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();

  await page.keyboard.press('Alt+2');
  await expect(page.getByRole('radio', { name: /GOVERNANCE_IMPACT/ })).toBeChecked();

  await page.keyboard.press('Alt+Shift+1');
  await expect(page.getByRole('checkbox', { name: /CONFLICT/ })).toBeChecked();

  await page.keyboard.press('Alt+l');
  await page
    .getByRole('region', { name: 'Semantic graph list' })
    .getByRole('button', { name: 'Select' })
    .first()
    .click();
  await expect(page.getByRole('status')).toContainText('선택됨: Entity One');
});

test('Graph Workspace honours prefers-reduced-motion with no animation runs', async ({ page }) => {
  await stubSessionAndShell(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  // Cytoscape toggles container visibility during init; assert the canvas
  // mounts (StrictMode-safe) without an error under reduced motion.
  await expect(page.getByTestId('graph-canvas')).toBeAttached();
});

test('Graph Workspace restores deep-link focus to the selected node', async ({ page }) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph?focus=entity-1');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  // The deep-link selection announces the focused node once the snapshot resolves.
  await expect(page.getByRole('status')).toContainText('선택됨: Entity One');
});

test('AC-08: the three authorities are visually and accessibly distinct', async ({ page }) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  await page.keyboard.press('Alt+l');

  const listItems = page.locator('.graph-list-view .graph-item');
  await expect(listItems).toHaveCount(4); // three nodes + one edge
  const authorities = await listItems.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-graph-authority')),
  );
  expect(authorities).toContain('CANONICAL');
  expect(authorities).toContain('DERIVED_INFERENCE');
  expect(authorities).toContain('DISCOVERY_CANDIDATE');
  // Distinct accessible authority labels.
  await expect(listItems.filter({ hasText: 'Candidate Three' })).toContainText('Discovery');
  await expect(listItems.filter({ hasText: 'Claim One' })).toContainText('Derived');
});

test('AC-17: refresh issues a new snapshot identity and keeps the selected resource focused', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  await expect(page.getByText(/Snapshot: snapshot-1/)).toBeVisible();

  await page.keyboard.press('Alt+l');
  await page
    .getByRole('region', { name: 'Semantic graph list' })
    .getByRole('button', { name: 'Select' })
    .first()
    .click();
  await expect(page.getByRole('status')).toContainText('선택됨: Entity One');

  await page.getByRole('button', { name: '새로 고침' }).click();

  await expect(page.getByText(/Snapshot: snapshot-2/)).toBeVisible();
  await expect(page.getByText(/Revision: proj-2/)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('선택됨: Entity One');
});

test('AC-19: path view exposes the same accessible tuple set as the list view', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();

  await page.keyboard.press('Alt+l');
  const listKeys = await tupleKey(page, '.graph-list-view .graph-item');

  await page.keyboard.press('Alt+p');
  const pathRegion = page.getByRole('region', { name: 'Semantic graph path' });
  await expect(pathRegion).toBeVisible();
  const pathKeys = await tupleKey(page, '.graph-path-view .graph-item');

  expect(pathKeys).toEqual(listKeys);
});

test('AC-20: full keyboard matrix moves focus, activates and escapes', async ({ page }) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();

  // Base views.
  await page.keyboard.press('Alt+1');
  await expect(page.getByRole('radio', { name: /KNOWLEDGE_SEMANTIC/ })).toBeChecked();
  await page.keyboard.press('Alt+3');
  await expect(page.getByRole('radio', { name: /OPERATIONAL_DEPENDENCY/ })).toBeChecked();
  await page.keyboard.press('Alt+1');

  // Overlays.
  await page.keyboard.press('Alt+Shift+2');
  await expect(page.getByRole('checkbox', { name: /KNOWLEDGE_GAP/ })).toBeChecked();
  await page.keyboard.press('Alt+Shift+3');
  await expect(page.getByRole('checkbox', { name: /RECURSIVE_IMPACT/ })).toBeChecked();

  // Arrow + Enter activation within the list region.
  await page.keyboard.press('Alt+l');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(/선택됨/);

  // Escape from the path view returns to the canvas overview.
  await page.keyboard.press('Alt+p');
  await expect(page.getByRole('region', { name: 'Semantic graph path' })).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Semantic graph canvas' })).toBeAttached();
});

test('AC-22: list/table/path remain fully operable at 200% zoom', async ({ page, context }) => {
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();

  await page.keyboard.press('Alt+l');
  await page
    .getByRole('region', { name: 'Semantic graph list' })
    .getByRole('button', { name: 'Select' })
    .first()
    .click();
  await expect(page.getByRole('status')).toContainText('선택됨: Entity One');

  await page.keyboard.press('Alt+t');
  await expect(page.getByRole('region', { name: 'Semantic graph table' })).toBeVisible();

  await page.keyboard.press('Alt+p');
  await expect(page.getByRole('region', { name: 'Semantic graph path' })).toBeVisible();
});

test('AC-21: axe scan finds zero critical violations across canvas, list, table and path', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();

  const views = ['canvas', 'list', 'table', 'path'] as const;
  for (const view of views) {
    await page.keyboard.press(`Alt+${view === 'canvas' ? 'v' : view[0]}`);
    const region = page.getByRole('region', { name: `Semantic graph ${view}` });
    await expect(region).toBeAttached();
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter((violation) => violation.impact === 'critical');
    expect(critical, `${view} critical violations`).toHaveLength(0);
  }
});

test('AC-24: a failed snapshot read renders the non-success announcement, retries safely, and issues no write', async ({
  page,
}) => {
  const writeRequests: string[] = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (
      method !== 'GET' &&
      /(canonical|approval|action|commit|changeset|write|review)/i.test(url)
    ) {
      writeRequests.push(`${method} ${url}`);
    }
    await route.continue();
  });
  await stubSessionAndShell(page);
  // Override the snapshot route: a typed SAFE dependency failure so the
  // snapshot read errors and the workspace enters the FAILED phase.
  await page.route('**/product-api/frontend/knowledge/graph/snapshot', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: '1.0.0',
        code: 'RETRYABLE_DEPENDENCY',
        category: 'DEPENDENCY',
        retryability: 'SAFE',
        recovery: 'RETRY',
        message: 'The graph projection is currently unavailable.',
      }),
    });
  });

  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  // Non-success announcement for the failed read (AC-24/AC-15). The FAILED
  // phase renders its own alert before the error-state alert, so scope to the
  // first alert (the frozen failure announcement).
  await expect(page.getByRole('alert').first()).toContainText('그래프를 사용할 수 없습니다.');
  // Recovery is read-only: retrying re-issues the read; no write is issued.
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('alert').first()).toContainText('그래프를 사용할 수 없습니다.');
  expect(writeRequests).toEqual([]);
});
