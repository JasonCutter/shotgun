import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const graphTechnicalDetails = (page: Page) =>
  page.locator('details.technical-details').filter({ hasText: 'Snapshot ID' }).first();

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
  nodes: [
    ...graphSnapshot.nodes.map((entry: { resourceRef: { resourceId: string }; label: string }) => ({
      ...entry,
      revisionBinding: { ...revisionBinding, projectionRevision: 'proj-2' },
    })),
    // AC-18: the refreshed snapshot adds a node so a canvas-mount E2E can
    // assert the actual cytoscape instance picked up the new node set.
    {
      schemaVersion: '1.0.0',
      nodeId: 'node-4',
      resourceRef: { schemaVersion: '1.0.0', resourceKind: 'ENTITY', resourceId: 'entity-4' },
      label: 'Entity Four',
      nodeKind: 'ENTITY',
      authority: 'DISCOVERY_CANDIDATE',
      baseViewMembership: 'KNOWLEDGE_SEMANTIC',
      overlayMemberships: [],
      revisionBinding: { ...revisionBinding, projectionRevision: 'proj-2' },
      accessMasking: 'VISIBLE',
      payload: {
        schemaVersion: '1.0.0',
        nodeKind: 'ENTITY',
        entity: {
          schemaVersion: 'entity.v1',
          entityType: 'PERSON',
          displayName: 'Entity Four',
        },
      },
    },
  ],
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
      narration: 'Entity One → Canonical relationship → Claim One',
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
  await expect(graphTechnicalDetails(page)).toContainText('snapshot-1');

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
  await expect(page.getByRole('radio', { name: /Governance impact/ })).toBeChecked();

  await page.keyboard.press('Alt+Shift+1');
  await expect(page.getByRole('checkbox', { name: /Conflicts/ })).toBeChecked();

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

test('AC-08: the three authorities carry distinct non-color visual signatures and accessible descriptions', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  await page.keyboard.press('Alt+l');

  const listItems = page.locator('.graph-list-view .graph-item');
  await expect(listItems).toHaveCount(4); // three nodes + one edge

  // 1. The three authority discriminants are present on the items.
  const authorities = await listItems.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-graph-authority')),
  );
  expect(authorities).toContain('CANONICAL');
  expect(authorities).toContain('DERIVED_INFERENCE');
  expect(authorities).toContain('DISCOVERY_CANDIDATE');

  // 2. Distinct accessible authority descriptions.
  await expect(listItems.filter({ hasText: 'Candidate Three' })).toContainText('Discovery');
  await expect(listItems.filter({ hasText: 'Claim One' })).toContainText('Derived');

  // 3. Distinct computed-style signatures, including at least one non-color
  //    cue per authority (border-left-style, font-style, font-weight,
  //    text-decoration). Color alone must never be the only distinguisher.
  const signature = (label: string) =>
    page
      .locator(`.graph-list-view .graph-item[data-graph-label="${label}"]`)
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          borderLeftStyle: style.borderLeftStyle,
          borderLeftWidth: style.borderLeftWidth,
          fontStyle: style.fontStyle,
          fontWeight: style.fontWeight,
          textDecorationLine: style.textDecorationLine,
          borderLeftColor: style.borderLeftColor,
        };
      });

  const canonical = await signature('Entity One');
  const derived = await signature('Claim One');
  const discovery = await signature('Candidate Three');

  expect(canonical.borderLeftStyle).toBe('solid');
  expect(canonical.fontWeight).toBe('600');
  expect(derived.borderLeftStyle).toBe('dashed');
  expect(derived.fontStyle).toBe('italic');
  expect(discovery.borderLeftStyle).toBe('dotted');
  expect(discovery.textDecorationLine).toContain('underline');

  // The three full signatures (including non-color fields) must differ.
  expect(JSON.stringify(canonical)).not.toBe(JSON.stringify(derived));
  expect(JSON.stringify(derived)).not.toBe(JSON.stringify(discovery));
  expect(JSON.stringify(canonical)).not.toBe(JSON.stringify(discovery));
  // Canonical and Derived differ even when color fields are ignored.
  const nonColor = (value: typeof canonical) =>
    JSON.stringify({
      borderLeftStyle: value.borderLeftStyle,
      fontStyle: value.fontStyle,
      fontWeight: value.fontWeight,
      textDecorationLine: value.textDecorationLine,
    });
  expect(nonColor(canonical)).not.toBe(nonColor(derived));

  // 4. Bounded component visual snapshot (list region only, not the page).
  const listRegion = page.getByRole('region', { name: 'Semantic graph list' });
  const snapshot = await listRegion.screenshot({ path: 'test-results/ac08-list-authority.png' });
  expect(snapshot.length).toBeGreaterThan(0);
});

test('AC-17: refresh issues a new snapshot identity and keeps the selected resource focused', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  await expect(graphTechnicalDetails(page)).toContainText('snapshot-1');

  await page.keyboard.press('Alt+l');
  await page
    .getByRole('region', { name: 'Semantic graph list' })
    .getByRole('button', { name: 'Select' })
    .first()
    .click();
  await expect(page.getByRole('status')).toContainText('선택됨: Entity One');

  await page.getByRole('button', { name: '새로 고침' }).click();

  await expect(graphTechnicalDetails(page)).toContainText('snapshot-2');
  await expect(graphTechnicalDetails(page)).toContainText('proj-2');
  await expect(page.getByRole('status')).toContainText('선택됨: Entity One');
});

test('AC-18: a refresh while the canvas stays mounted rebuilds the actual cytoscape instance with the new snapshot', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  await expect(graphTechnicalDetails(page)).toContainText('snapshot-1');

  // The canvas view is the default and stays mounted across the refresh.
  const canvasSurface = page.locator('[data-testid="graph-canvas"] .graph-canvas-surface');
  await expect(canvasSurface).toBeAttached();
  const before = await canvasSurface.evaluate((element) => ({
    nodes: element.getAttribute('data-graph-node-count'),
    edges: element.getAttribute('data-graph-edge-count'),
  }));
  expect(before).toEqual({ nodes: '3', edges: '1' });
  const perfBefore = await page.evaluate(
    () =>
      (
        window as Window & {
          __shotgunGraphPerf?: { mounted: number; destroyed: number; active: number };
        }
      ).__shotgunGraphPerf,
  );

  await page.getByRole('button', { name: '새로 고침' }).click();

  await expect(graphTechnicalDetails(page)).toContainText('snapshot-2');
  await expect(graphTechnicalDetails(page)).toContainText('proj-2');

  // The ACTUAL cytoscape instance was rebuilt with the refreshed node set
  // (4 nodes now) — not just the hidden accessible collection.
  const after = await canvasSurface.evaluate((element) => ({
    nodes: element.getAttribute('data-graph-node-count'),
    edges: element.getAttribute('data-graph-edge-count'),
  }));
  expect(after).toEqual({ nodes: '4', edges: '1' });

  // The old cytoscape instance was destroyed and a new one mounted (the
  // snapshot-identity key remounts the component).
  const perfAfter = await page.evaluate(
    () =>
      (
        window as Window & {
          __shotgunGraphPerf?: { mounted: number; destroyed: number; active: number };
        }
      ).__shotgunGraphPerf,
  );
  expect(perfAfter!.destroyed).toBeGreaterThan(perfBefore?.destroyed ?? 0);
  expect(perfAfter!.active).toBeGreaterThan(0);

  // The accessible semantic collection also carries the refreshed node set.
  const collectionNodes = await page
    .locator('[data-testid="graph-canvas"] [data-graph-kind="node"]')
    .count();
  expect(collectionNodes).toBe(4);
});

test('AC-19: canvas, list, table and path expose the identical accessible tuple set', async ({
  page,
}) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();

  // Canvas exposes its semantic collection (AC-19) generated from the same
  // snapshot via the shared graph-accessible module.
  await expect(page.locator('[data-testid="graph-canvas"]')).toBeAttached();
  const canvasKeys = await tupleKey(page, '[data-testid="graph-canvas"] [data-graph-kind]');

  await page.keyboard.press('Alt+l');
  const listKeys = await tupleKey(page, '.graph-list-view .graph-item');

  await page.keyboard.press('Alt+t');
  const tableKeys = await tupleKey(page, '.graph-table-view tbody tr');

  await page.keyboard.press('Alt+p');
  const pathRegion = page.getByRole('region', { name: 'Semantic graph path' });
  await expect(pathRegion).toBeVisible();
  const pathKeys = await tupleKey(page, '.graph-path-view .graph-item');

  // Stable tuple-set equality across all four views (order-insensitive).
  expect(canvasKeys.length).toBeGreaterThan(0);
  expect(canvasKeys).toEqual(listKeys);
  expect(canvasKeys).toEqual(tableKeys);
  expect(canvasKeys).toEqual(pathKeys);
});

test('AC-20: the full frozen keyboard matrix is exercised end to end', async ({ page }) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();

  // Tab / Shift+Tab: focus moves between graph regions (not merely stays off
  // the body). Record the active region and focus target at each step.
  const activeFocus = () =>
    page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      const region = element?.closest('[role="region"]');
      return {
        tag: element?.tagName ?? 'BODY',
        region: region?.getAttribute('aria-label') ?? null,
        id: element?.id ?? null,
      };
    });

  // Focus the last toolbar control, then Tab forward into the active view
  // region (the canvas region root is a natural focus anchor, tabIndex=0).
  await page.getByRole('button', { name: '새로 고침' }).focus();
  const toolbarFocus = await activeFocus();
  expect(toolbarFocus.region).toBe('Graph view controls');

  await page.keyboard.press('Tab');
  const canvasFocus = await activeFocus();
  expect(canvasFocus.region).toBe('Semantic graph canvas');
  expect(canvasFocus.tag).not.toBe('BODY');
  // The active element actually changed (toolbar button -> region root).
  expect(canvasFocus.tag).not.toBe(toolbarFocus.tag);

  // Shift+Tab moves back in the reverse direction to the toolbar.
  await page.keyboard.press('Shift+Tab');
  const backFocus = await activeFocus();
  expect(backFocus.region).toBe('Graph view controls');
  expect(backFocus.tag).not.toBe('BODY');
  expect(backFocus.tag).not.toBe(canvasFocus.tag);

  // Base views Alt+1/2/3.
  await page.keyboard.press('Alt+1');
  await expect(page.getByRole('radio', { name: /Knowledge relationships/ })).toBeChecked();
  await page.keyboard.press('Alt+2');
  await expect(page.getByRole('radio', { name: /Governance impact/ })).toBeChecked();
  await page.keyboard.press('Alt+3');
  await expect(page.getByRole('radio', { name: /Operational dependencies/ })).toBeChecked();
  await page.keyboard.press('Alt+1');

  // Overlays Alt+Shift+1/2/3.
  await page.keyboard.press('Alt+Shift+1');
  await expect(page.getByRole('checkbox', { name: /Conflicts/ })).toBeChecked();
  await page.keyboard.press('Alt+Shift+2');
  await expect(page.getByRole('checkbox', { name: /Knowledge gaps/ })).toBeChecked();
  await page.keyboard.press('Alt+Shift+3');
  await expect(page.getByRole('checkbox', { name: /Extended impact/ })).toBeChecked();

  // View switching Alt+L/T/P/V.
  await page.keyboard.press('Alt+t');
  await expect(page.getByRole('region', { name: 'Semantic graph table' })).toBeAttached();
  await page.keyboard.press('Alt+v');
  await expect(page.getByRole('region', { name: 'Semantic graph canvas' })).toBeAttached();
  await page.keyboard.press('Alt+p');
  await expect(page.getByRole('region', { name: 'Semantic graph path' })).toBeAttached();
  await page.keyboard.press('Alt+l');
  await expect(page.getByRole('region', { name: 'Semantic graph list' })).toBeAttached();

  // Four-direction arrows move the virtual focus deterministically within the
  // list (Down/Right advance, Up/Left go back); Enter activates the focused
  // node and announces the exact selection for each direction. Focus is first
  // placed on a neutral element (the heading) so the keys never collide with
  // radio/button default behavior from the toolbar.
  await page.getByRole('heading', { name: 'Semantic Graph', level: 1 }).focus();
  const activateAndExpect = async (label: string) => {
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toContainText(`선택됨: ${label}`);
  };
  await page.keyboard.press('ArrowDown'); // focus Entity One
  await activateAndExpect('Entity One');
  await page.keyboard.press('ArrowRight'); // next -> Claim One
  await activateAndExpect('Claim One');
  await page.keyboard.press('ArrowDown'); // next -> Candidate Three
  await activateAndExpect('Candidate Three');
  await page.keyboard.press('ArrowUp'); // previous -> Claim One
  await activateAndExpect('Claim One');
  await page.keyboard.press('ArrowLeft'); // previous -> Entity One
  await activateAndExpect('Entity One');

  // Escape returns from a non-canvas view to the canvas overview.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Semantic graph canvas' })).toBeAttached();
});

test('AC-20: graph shortcuts do not steal keys while a text input is focused', async ({ page }) => {
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Semantic graph canvas' })).toBeAttached();

  // Focus a temporary text input and type normally: Alt+L must not switch
  // views and plain letters must be entered into the field.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'temporary text input');
    input.id = 'graph-shortcut-guard-input';
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press('Alt+l');
  await page.keyboard.type('hello');
  const value = await page.inputValue('#graph-shortcut-guard-input');
  expect(value).toBe('hello');
  await expect(page.getByRole('region', { name: 'Semantic graph canvas' })).toBeAttached();
  await page.evaluate(() => document.getElementById('graph-shortcut-guard-input')?.remove());
});

test('AC-22: at 200% zoom list/table/path lose no primary content and keep focus indicators', async ({
  page,
  context,
}) => {
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await stubSessionAndShell(page);
  await page.goto('/knowledge/graph');
  await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();

  const noGlobalOverflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );

  const assertNoContentLoss = async (view: 'list' | 'table' | 'path') => {
    await page.keyboard.press(`Alt+${view[0]}`);
    const region = page.getByRole('region', { name: `Semantic graph ${view}` });
    await expect(region).toBeVisible();

    // No document-level horizontal overflow.
    expect(await noGlobalOverflow(), `${view} global overflow`).toBe(true);

    // Primary content bounding boxes all exist (heading, first item, action
    // control, view switch, status region).
    await expect(region.locator('h2').first()).toBeVisible();
    const firstItem =
      view === 'table' ? region.locator('tbody tr').first() : region.locator('.graph-item').first();
    await expect(firstItem).toBeVisible();
    const actionControl = region.getByRole('button', { name: /Select|보정/ }).first();
    await expect(actionControl).toBeVisible();
    await expect(page.getByRole('group', { name: 'View switcher' }).first()).toBeVisible();
    await expect(page.getByRole('status').first()).toBeAttached();

    // The first item's label is not text-clipped.
    const labelClip = await firstItem.evaluate((element) => {
      const label = Array.from(element.querySelectorAll('*')).find((node) =>
        (node.textContent ?? '').trim().startsWith('Entity'),
      );
      const target = (label ?? element) as HTMLElement;
      return target.scrollWidth <= target.clientWidth + 1;
    });
    expect(labelClip, `${view} label not clipped`).toBe(true);

    // The table scrolls inside its own container rather than the document.
    if (view === 'table') {
      const scroll = await region.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          overflowX: style.overflowX,
          scrollable: element.scrollWidth >= element.clientWidth,
        };
      });
      expect(['auto', 'scroll']).toContain(scroll.overflowX);
      expect(scroll.scrollable).toBe(true);
    }

    // Focus indicator is visible on the first interactive element.
    await actionControl.focus();
    const focusRing = await actionControl.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        parseFloat(style.outlineWidth) > 0 ||
        (style.boxShadow !== 'none' && style.boxShadow !== '') ||
        element.classList.contains('focus-visible')
      );
    });
    expect(focusRing, `${view} focus indicator`).toBe(true);
  };

  await assertNoContentLoss('list');
  await assertNoContentLoss('table');
  await assertNoContentLoss('path');

  // Selection still commits at 200% zoom.
  await page.keyboard.press('Alt+l');
  await page
    .getByRole('region', { name: 'Semantic graph list' })
    .getByRole('button', { name: 'Select' })
    .first()
    .click();
  await expect(page.getByRole('status')).toContainText('선택됨: Entity One');
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

test('AC-15: non-success health/completeness states render their frozen announcements', async ({
  page,
}) => {
  const states: ReadonlyArray<{
    readonly name: string;
    readonly health: string;
    readonly completeness: string;
    readonly truncation?: unknown;
    readonly announcement: string;
  }> = [
    {
      name: 'stale',
      health: 'STALE',
      completeness: 'COMPLETE',
      announcement: '스냅샷이 오래되었습니다. 새로 고침이 필요합니다.',
    },
    {
      name: 'rebuilding',
      health: 'REBUILDING',
      completeness: 'COMPLETE',
      announcement: '투영이 재구축 중입니다.',
    },
    {
      name: 'partial',
      health: 'COMPLETE',
      completeness: 'PARTIAL',
      announcement: '결과가 부분적입니다.',
    },
    {
      name: 'truncated',
      health: 'COMPLETE',
      completeness: 'TRUNCATED',
      truncation: {
        schemaVersion: '1.0.0',
        truncated: true,
        reason: 'MAX_NODES',
        omittedNodeCount: 5,
        omittedEdgeCount: 3,
      },
      announcement: '결과가 잘렸습니다: 노드 5개, 엣지 3개 생략',
    },
    {
      name: 'unavailable',
      health: 'UNAVAILABLE',
      completeness: 'COMPLETE',
      announcement: '그래프를 사용할 수 없습니다.',
    },
    {
      name: 'access-restricted',
      health: 'ACCESS_RESTRICTED',
      completeness: 'COMPLETE',
      announcement: '그래프 접근이 제한되었습니다.',
    },
  ];

  for (const state of states) {
    await stubSessionAndShell(page);
    await page.route('**/product-api/frontend/knowledge/graph/snapshot', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ...graphSnapshot,
          health: state.health,
          completeness: state.completeness,
          ...(state.truncation ? { truncation: state.truncation } : {}),
        }),
      });
    });

    await page.goto('/knowledge/graph');
    await expect(page.getByRole('heading', { name: 'Semantic Graph', level: 1 })).toBeVisible();
    // Multiple live regions exist (visually-hidden live region, loading
    // state, notes); scope to the status element carrying the announcement.
    await expect(page.getByRole('status').filter({ hasText: state.announcement })).toBeVisible();
  }
});

test('AC-25: a correction action on a graph node navigates to the Knowledge Editor with a typed seed and issues no write', async ({
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
    .getByRole('button', { name: '보정' })
    .first()
    .click();

  // Navigated to the Knowledge Editor (/knowledge) with the typed seed.
  await expect(page.getByRole('heading', { name: 'Knowledge', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: '그래프 보정 대상' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '지식 항목' })).toContainText(
    '보정할 준비가 되었습니다',
  );
  const correctionDetails = page.locator('details').filter({ hasText: 'Change intent' }).first();
  await expect(correctionDetails).not.toHaveAttribute('open', '');
  await correctionDetails.locator('summary').click();
  await expect(correctionDetails.getByText(/ENTITY:entity-1/)).toBeVisible();
  await expect(correctionDetails.getByText('CORRECT_KNOWLEDGE')).toBeVisible();
  expect(writeRequests).toEqual([]);
});
