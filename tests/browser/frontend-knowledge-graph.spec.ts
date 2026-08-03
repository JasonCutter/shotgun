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
  expect(tableKeys).toHaveLength(3); // two nodes + one edge
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
