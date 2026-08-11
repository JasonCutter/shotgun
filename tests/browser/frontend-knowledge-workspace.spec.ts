import { expect, test } from '@playwright/test';

const projection = {
  projectionKind: 'CANONICAL_SEARCH',
  status: 'STALE',
  canonicalVersion: 4,
  projectedCanonicalVersion: 3,
  lag: 1,
  reason: 'The browser fixture keeps this projection visibly stale.',
};

const pageSummary = {
  pageId: 'page-1',
  projectId: 'project-1',
  resourceId: 'resource-1',
  revision: 'resource-revision-1',
  title: 'Fixture Knowledge Page',
  primaryAuthority: 'CANONICAL',
  primaryKind: 'CLAIM',
  projection,
};

const lineage = {
  projectId: 'project-1',
  productId: 'item-1',
  resourceRevision: 'resource-revision-1',
  canonicalResourceId: 'resource-1',
  sourceId: 'source-1',
  sourceVersionId: 'source-version-1',
  evidenceIds: ['evidence-1'],
};

const pageLineage = {
  projectId: 'project-1',
  productId: 'page-1',
  resourceRevision: 'resource-revision-1',
};

const item = {
  productId: 'item-1',
  projectId: 'project-1',
  resourceId: 'resource-1',
  revision: 'resource-revision-1',
  authority: 'CANONICAL',
  kind: 'CLAIM',
  temporalState: 'CURRENT',
  label: 'Fixture claim',
  summary: 'Server-provided Knowledge content.',
  lineage,
  evidenceTargets: [
    {
      resourceId: 'resource-1',
      resourceRevision: 'resource-revision-1',
      focusId: 'item-1',
      sourceId: 'source-1',
      sourceVersionId: 'source-version-1',
      evidenceId: 'evidence-1',
    },
  ],
};

const page = {
  schemaVersion: '1.0.0',
  pageId: 'page-1',
  projectId: 'project-1',
  resourceId: 'resource-1',
  revision: 'resource-revision-1',
  focusId: 'item-1',
  title: 'Fixture Knowledge Page',
  items: [item],
  lineage: pageLineage,
  projection: { ...projection, projectionKind: 'COMPILED_TRUTH' },
  capabilities: ['READ', 'SEARCH', 'FILTER', 'COMPARE', 'EVIDENCE_NAVIGATION'],
  fetchedAt: '2026-08-02T12:00:00.000Z',
};

test('Knowledge Workspace renders server pages, stable detail, and non-ready state', async ({
  page: browserPage,
}) => {
  await browserPage.route('**/product-api/frontend/route-guard', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        decision: {
          schemaVersion: '1.0.0',
          decision: 'ALLOW',
          targetRoute: { routeId: 'knowledge', href: '/knowledge' },
          masked: false,
          message: 'Allowed.',
          accessRevision: '1',
          policyContextRevision: '1',
        },
      }),
    });
  });

  await browserPage.route('**/product-api/frontend/knowledge/workspace', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        workspace: {
          schemaVersion: '1.0.0',
          principalId: 'principal-1',
          sessionId: 'session-1',
          projectId: 'project-1',
          accessRevision: '1',
          policyContextRevision: '1',
          pages: [pageSummary],
          projection,
          capabilities: ['READ', 'SEARCH', 'FILTER', 'COMPARE', 'EVIDENCE_NAVIGATION'],
          fetchedAt: '2026-08-02T12:00:00.000Z',
        },
      }),
    });
  });
  await browserPage.route('**/product-api/frontend/knowledge/pages', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        pages: {
          schemaVersion: '1.0.0',
          projectId: 'project-1',
          accessRevision: '1',
          policyContextRevision: '1',
          pages: [pageSummary],
          projection,
          fetchedAt: '2026-08-02T12:00:00.000Z',
        },
      }),
    });
  });
  await browserPage.route('**/product-api/frontend/knowledge/detail', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        detail: {
          schemaVersion: '1.0.0',
          resourceId: 'resource-1',
          revision: 'resource-revision-1',
          accessRevision: '1',
          policyContextRevision: '1',
          focusId: 'item-1',
          page,
          fetchedAt: '2026-08-02T12:00:00.000Z',
        },
      }),
    });
  });

  await browserPage.goto('/knowledge');
  await expect(browserPage.getByRole('heading', { name: 'Knowledge', level: 1 })).toBeVisible();
  await expect(browserPage.getByRole('link', { name: 'Fixture Knowledge Page' })).toBeVisible();
  await expect(
    browserPage.locator('.knowledge-projection').getByText('Stale; not current').first(),
  ).toBeVisible();
  await browserPage.getByRole('link', { name: 'Fixture Knowledge Page' }).click();
  await expect(
    browserPage.getByRole('heading', { name: 'Fixture Knowledge Page', level: 1 }),
  ).toBeVisible();
  await expect(browserPage.getByText('Server-provided Knowledge content.')).toBeVisible();
  await expect(browserPage.getByRole('link', { name: 'Open source evidence' })).toBeVisible();
});
