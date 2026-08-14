import { expect, test } from '@playwright/test';

const sessionView = (created: boolean) => ({
  session: {
    apiVersion: '2.0.0',
    principal: {
      id: 'principal-zero',
      actor: { type: 'user', id: 'principal-zero' },
      authenticationMethod: 'session',
    },
    activeProject: created ? { id: 'server-project-1' } : null,
    accessibleProjects: created ? [{ id: 'server-project-1', isOwner: true }] : [],
    session: { expiresAt: null },
    sessionReady: true,
    projectReady: created,
    projectAccessRevision: created ? '1' : '0',
  },
});

const shellView = (created: boolean) => ({
  shell: {
    schemaVersion: '1.0.0',
    principalId: 'principal-zero',
    sessionId: 'session-zero',
    activeProject: created
      ? {
          id: 'server-project-1',
          label: 'Server Project',
          sensitivityClearance: 'private',
        }
      : null,
    accessibleProjects: created
      ? [
          {
            id: 'server-project-1',
            label: 'Server Project',
            isOwner: true,
            sensitivityClearance: 'private',
          },
        ]
      : [],
    navigation: [
      ...(created
        ? [
            {
              id: 'home',
              label: 'Home',
              availability: 'AVAILABLE',
              targetRoute: { routeId: 'home', href: '/' },
            },
          ]
        : [
            {
              id: 'home',
              label: 'Home',
              availability: 'TEMPORARILY_UNAVAILABLE',
              reason: 'Create a Project to open Home.',
            },
          ]),
      {
        id: 'settings',
        label: 'Settings',
        availability: 'AVAILABLE',
        targetRoute: {
          routeId: created ? 'settings' : 'settings-projects',
          href: created ? '/settings' : '/settings/projects',
        },
      },
    ],
    features: [
      {
        id: 'global-search',
        label: 'Global Search',
        availability: created ? 'AVAILABLE' : 'TEMPORARILY_UNAVAILABLE',
        ...(created ? {} : { reason: 'Create a Project to search.' }),
      },
      {
        id: 'command-palette',
        label: 'Command Palette',
        availability: 'AVAILABLE',
      },
    ],
    readiness: [
      { kind: 'SESSION_READY', ready: true, required: true },
      {
        kind: 'PROJECT_READY',
        ready: created,
        required: true,
        ...(created ? {} : { message: 'Create your first Project.' }),
      },
    ],
    ...(created
      ? {}
      : {
          leadingWarning: {
            code: 'PROJECT_SETUP_REQUIRED',
            severity: 'INFO',
            message: 'Create your first Project to continue.',
            additionalCount: 0,
          },
        }),
    background: { activeCount: 0, failedCount: 0 },
    notifications: { unreadCount: 0, presentationRevision: 'notifications-0' },
    accessRevision: created ? '1' : '0',
    policyContextRevision: created ? '1' : '0',
    projectionRevision: created ? 'shell-created' : 'shell-zero',
    fetchedAt: '2026-07-29T00:00:00.000Z',
  },
});

test('Section 3 renders responsive server-authoritative Shell and six-area Home', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  for (const heading of [
    'Project State',
    'Primary Actions',
    'Attention Queue',
    'Continue Working',
    'Recent and Pinned',
    'Operational Summary',
  ]) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await expect(page.getByText('No attention needed')).toBeVisible();
  await expect(page.getByText('No restorable server resources.')).toBeVisible();
  await expect(page.getByText('No validated browser drafts.')).toBeVisible();

  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await expect(page.getByText('More', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '200%';
  });
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
});

test('Section 3 Search and Command Palette keep query transient and keyboard-safe', async ({
  page,
}) => {
  const searchRequests: { readonly url: string; readonly body: unknown }[] = [];
  page.on('request', (request) => {
    if (!request.url().endsWith('/product-api/frontend/search/query')) return;
    searchRequests.push({
      url: request.url(),
      body: request.postDataJSON(),
    });
  });

  await page.goto('/');
  const searchButton = page.getByRole('button', { name: 'Search' });
  await searchButton.click();
  const searchDialog = page.getByRole('dialog', { name: 'Search' });
  await expect(searchDialog).toBeVisible();
  const queryInput = page.getByLabel('Search query');
  await expect(queryInput).toBeFocused();
  await queryInput.fill('private transient phrase');
  await page.getByLabel('Selected Projects').check();
  await page.getByLabel('Project B').check();
  await searchDialog.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('0 search results.')).toHaveText('0 search results.');
  expect(searchRequests).toHaveLength(1);
  expect(searchRequests[0]?.url).not.toContain('private transient phrase');
  expect(searchRequests[0]?.body).toMatchObject({
    query: 'private transient phrase',
    scope: { kind: 'CROSS_PROJECT', projectIds: ['project-b'] },
  });
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(searchButton).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`),
    )
    .not.toContain('private transient phrase');

  await searchButton.focus();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Commands' });
  await expect(palette).toBeVisible();
  await expect(palette.getByRole('textbox', { name: 'Command search' })).toBeVisible();
  await expect(palette.getByRole('heading', { name: 'Navigation' })).toBeVisible();
  await expect(palette.getByRole('button', { name: /Open Knowledge/ })).toBeVisible();
  await expect(palette.getByRole('button', { name: /approve|delete|revoke/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(searchButton).toBeFocused();
});

test('Section 3 route guard preserves Active and Resource Project context and masks denial', async ({
  page,
}) => {
  await page.goto(
    '/settings/projects/project-b?targetProjectId=shotgun&resourceProjectId=project-b',
  );
  await expect(
    page.getByRole('heading', { name: 'Settings & Project Administration' }),
  ).toBeVisible();
  await expect(page.locator('.active-project')).toContainText('shotgun');
  await expect(page.locator('.resource-project')).toContainText('Project B');
  await expect(page.getByRole('combobox', { name: 'Current project' })).toHaveValue('shotgun');

  await page.goto('/settings/projects/not-accessible');
  await expect(page.getByRole('heading', { name: 'Request error' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('not found');
  await page.goto('/');
  await expect(page.getByRole('combobox', { name: 'Current project' })).toHaveValue('shotgun');
});

test('Section 3 blocks unsafe leave state, warns on offline state, and restores online use', async ({
  page,
  context,
}) => {
  await page.goto('/settings/advanced');
  await page.getByLabel('Default Answer Model').fill('unsaved-model');
  await page.getByRole('button', { name: 'Validate & Preview' }).click();
  await expect(page.getByText('Draft status: Ready to apply')).toBeVisible();
  const selector = page.getByRole('combobox', { name: 'Current project' });
  await selector.selectOption('project-b');
  await expect(selector).toHaveValue('shotgun');
  await expect(page.getByRole('alert')).toContainText('current Workspace');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByRole('alert')).toContainText('Offline');
  await expect(page.getByRole('button', { name: 'Search' })).toBeDisabled();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('button', { name: 'Search' })).toBeEnabled();
});

test('Section 3 zero-project onboarding sends PRINCIPAL bootstrap without a browser Project ID', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  let created = false;
  let homeRequests = 0;
  let bootstrapBody: Record<string, unknown> | undefined;
  await page.route('**/api/v1/session', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(sessionView(created)),
    });
  });
  await page.route('**/product-api/frontend/global-shell', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(shellView(created)),
    });
  });
  await page.route('**/product-api/frontend/home', async (route) => {
    homeRequests += 1;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        home: {
          schemaVersion: '1.0.0',
          principalId: 'principal-zero',
          sessionId: 'session-zero',
          activeProject: {
            id: 'server-project-1',
            label: 'Server Project',
          },
          projectState: { lifecycle: 'ACTIVE', message: 'Project is ready.' },
          primaryActions: [],
          attention: [],
          continueWorking: [],
          recent: [],
          pinned: [],
          operationalSummary: {
            activeBackgroundCount: 0,
            failedBackgroundCount: 0,
            unreadNotificationCount: 0,
          },
          stale: false,
          accessRevision: '1',
          policyContextRevision: '1',
          projectionRevision: 'home-created',
          fetchedAt: '2026-07-29T00:00:00.000Z',
        },
      }),
    });
  });
  await page.route('**/product-api/frontend/route-guard', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        decision: {
          schemaVersion: '1.0.0',
          decision: 'ALLOW',
          targetRoute: {
            routeId: 'settings-projects',
            href: '/settings/projects',
          },
          masked: false,
          message: 'Allowed.',
          accessRevision: created ? '1' : '0',
          policyContextRevision: created ? '1' : '0',
        },
      }),
    });
  });
  await page.route('**/api/v1/projects', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ projects: [] }),
      });
      return;
    }
    bootstrapBody = route.request().postDataJSON() as Record<string, unknown>;
    created = true;
    const timestamp = '2026-07-29T00:00:01.000Z';
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        outcome: {
          commandId: 'server-command-1',
          commandRevision: '2',
          clientRequestId: bootstrapBody.clientRequestId,
          idempotencyKey: bootstrapBody.idempotencyKey,
          commandType: 'project.create.v1',
          commandSchemaVersion: '1.0.0',
          commandSemanticDigest: 'server-digest',
          outcomeState: 'COMPLETED',
          completionDisposition: 'SUCCEEDED',
          acceptedPrincipalContext: {
            principalId: 'principal-zero',
            actor: { type: 'user', id: 'principal-zero' },
          },
          acceptedProjectContext: {
            scope: 'PRINCIPAL',
            observedProjectAccessRevision: '0',
          },
          acceptedPolicyContext: {
            policyContextId: 'principal-project-bootstrap-policy',
            policyContextRevision: '1',
            acceptedAt: timestamp,
          },
          correlationId: 'server-command-1',
          producedResources: [
            {
              resourceKind: 'project',
              resourceId: 'server-project-1',
              resourceRevision: '1',
            },
          ],
          receivedAt: timestamp,
          acceptedAt: timestamp,
          completedAt: timestamp,
          lastUpdatedAt: timestamp,
        },
        project: {
          id: 'server-project-1',
          name: 'Server Project',
          isOwner: true,
          status: 'ACTIVE',
          active: true,
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
          capability: {
            canRename: true,
            canArchive: true,
            canRestore: false,
            canDelete: false,
            canManagePolicies: true,
          },
        },
      }),
    });
  });

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create your first Project' })).toBeVisible();
  expect(homeRequests).toBe(0);
  await page.getByRole('link', { name: 'Open Project onboarding' }).click();
  await page.getByRole('button', { name: '+ Create New Project' }).click();
  await expect(page.getByRole('dialog', { name: 'Create your first Project' })).toBeVisible();
  await expect(page.getByLabel('Project ID (Immutable)')).toHaveCount(0);
  await page.getByLabel('Project Name').fill('Server Project');
  await page.getByRole('button', { name: 'Create Project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
  expect(bootstrapBody).toMatchObject({
    envelopeVersion: '2.0.0',
    commandType: 'project.create.v1',
    projectContext: {
      scope: 'PRINCIPAL',
      observedProjectAccessRevision: '0',
    },
    payload: { name: 'Server Project' },
  });
  expect(JSON.stringify(bootstrapBody)).not.toContain('server-project-1');
});
