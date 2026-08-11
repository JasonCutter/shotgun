import { expect, test } from '@playwright/test';

const forbiddenAuthorityHeaders = [
  'x-project-id',
  'x-actor-id',
  'x-access-scope',
  'x-sensitivity',
  'authorization',
];

test('Frontend Section 2 Settings & Project Administration End-to-End Flow', async ({ page }) => {
  const forbiddenHeaderUses: string[] = [];
  page.on('request', (request) => {
    if (!request.url().includes('/api/v1/')) return;
    const headers = request.headers();
    for (const name of forbiddenAuthorityHeaders) {
      if (headers[name] !== undefined) forbiddenHeaderUses.push(name);
    }
  });

  // 1. Navigate to Settings page
  await page.goto('/settings');
  await expect(
    page.getByRole('heading', { name: 'Settings & Project Administration' }),
  ).toBeVisible();

  // 2. Check 5D project badges in header
  await expect(page.locator('.active-project')).toContainText('shotgun');
  await expect(page.locator('.target-project')).toContainText('shotgun');

  // 3. Navigate through category tabs
  await page.getByRole('link', { name: 'Category Index' }).click();
  await expect(page.getByRole('heading', { name: 'Settings Categories Index' })).toBeVisible();

  await page.getByRole('link', { name: 'Preferences' }).click();
  await expect(page.getByRole('heading', { name: 'User Preferences Workspace' })).toBeVisible();

  await page.getByRole('link', { name: 'Project Admin' }).click();
  await expect(
    page.getByRole('heading', { name: 'Project Administration', exact: true }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Models' }).click();
  await expect(page.getByRole('heading', { name: 'AI Model Profiles & Routing' })).toBeVisible();

  await page.getByRole('link', { name: 'Costs & Budgets' }).click();
  await expect(page.getByRole('heading', { name: 'Costs & Budget Management' })).toBeVisible();

  await page.getByRole('link', { name: 'Privacy & Sensitivity' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy & Sensitivity Controls' })).toBeVisible();

  await page.getByRole('link', { name: 'Connectors' }).click();
  await expect(page.getByRole('heading', { name: 'Connector Integrations' })).toBeVisible();

  await page.getByRole('link', { name: 'Directives & Priority' }).click();
  await expect(
    page.getByRole('heading', { name: 'User Directives & Fact Priority' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Schema Packs' }).click();
  await expect(
    page.getByRole('heading', { name: 'Schema Packs & Migration Requirements' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Diagnostics' }).click();
  await expect(
    page.getByRole('heading', { name: 'System Diagnostics & Real-Fact Telemetry' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Advanced' }).click();
  await expect(
    page.getByRole('heading', { name: 'Advanced Settings & Policy Overrides' }),
  ).toBeVisible();

  // 4. Security Negative Gate: No authority headers or raw secrets in storage/DOM
  expect(forbiddenHeaderUses).toEqual([]);
  const storage = await page.evaluate(() => ({
    localKeys: Object.keys(localStorage),
    sessionKeys: Object.keys(sessionStorage),
    bodyText: document.body.innerText,
  }));

  expect(storage.localKeys.some((k) => k.toLowerCase().includes('secret'))).toBe(false);
  expect(storage.sessionKeys.some((k) => k.toLowerCase().includes('secret'))).toBe(false);
  expect(storage.bodyText.includes('my_super_secret_raw_password')).toBe(false);
});

test('Section 2 executes Preference and Project lifecycle commands with server command IDs', async ({
  page,
}) => {
  await page.goto('/settings/preferences');
  await page.getByLabel('Locale & Language').selectOption('en-US');
  const preferenceResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/settings/preferences') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save Preferences' }).click();
  const preferenceResponse = await preferenceResponsePromise;
  const preferenceRequest = preferenceResponse.request().postDataJSON() as {
    clientRequestId: string;
    commandId?: string;
  };
  const preferenceBody = (await preferenceResponse.json()) as {
    outcome: { commandId: string; outcomeState: string };
  };
  expect(preferenceRequest.commandId).toBeUndefined();
  expect(preferenceBody.outcome.commandId).not.toBe(preferenceRequest.clientRequestId);
  expect(preferenceBody.outcome.outcomeState).toBe('COMPLETED');
  await expect(page.getByText('Preferences updated successfully.')).toBeVisible();

  await page.goto('/settings/projects');
  const createButton = page.getByRole('button', { name: '+ Create New Project' });
  await createButton.focus();
  await createButton.click();
  const createDialog = page.getByRole('dialog', { name: 'Create Project' });
  await expect(createDialog).toBeVisible();
  await expect(page.getByLabel('Project ID (Immutable)')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Create Project', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(createDialog).toBeHidden();
  await expect(createButton).toBeFocused();

  await createButton.click();
  const projectId = `e2e-project-${Date.now()}`;
  await page.getByLabel('Project ID (Immutable)').fill(projectId);
  await page.getByLabel('Project Name').fill('E2E Lifecycle Project');
  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/projects') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create Project', exact: true }).click();
  const createResponse = await createResponsePromise;
  const createRequest = createResponse.request().postDataJSON() as {
    commandId?: string;
    payload: { newProjectId: string };
  };
  const createBody = (await createResponse.json()) as {
    outcome: { commandId: string; producedResources: readonly { resourceId: string }[] };
  };
  expect(createRequest.commandId).toBeUndefined();
  expect(createBody.outcome.producedResources[0]?.resourceId).toBe(projectId);

  const projectRow = page.getByRole('row').filter({ hasText: projectId });
  await projectRow.getByRole('link', { name: 'Details / Policy' }).click();
  await expect(page.getByRole('heading', { name: /Project Details/ })).toBeVisible();

  await page.getByPlaceholder('New project name').fill('Renamed E2E Project');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByText('Project name updated.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Project Details: Renamed E2E Project' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Archive Project' }).click();
  await expect(page.getByText('Current Status: ARCHIVED')).toBeVisible();
  await page.getByRole('button', { name: 'Restore Project' }).click();
  await expect(page.getByText('Current Status: ACTIVE')).toBeVisible();
  await page.getByRole('button', { name: 'Request Deletion' }).click();
  await expect(page.getByText('Current Status: DELETE_REQUESTED')).toBeVisible();
});

test('Section 2 resolves a lost Settings response by clientRequestId without resubmission', async ({
  page,
}) => {
  await page.goto('/settings/advanced');
  const modelInput = page.getByLabel('Default Answer Model');
  await modelInput.fill('e2e-model-profile');
  await page.getByRole('button', { name: 'Validate & Preview' }).click();
  await expect(page.getByText('Draft status: Ready to apply')).toBeVisible();
  await expect(page.getByLabel('Settings impact preview')).toContainText('Confirmation required');

  const applyButton = page.getByRole('button', { name: 'Apply Settings' });
  await applyButton.click();
  const confirmDialog = page.getByRole('dialog', { name: 'Confirm Action' });
  await expect(confirmDialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmDialog).toBeHidden();
  await expect(applyButton).toBeFocused();

  let settingsCommandPosts = 0;
  let submittedClientRequestId = '';
  let acceptedCommandId = '';
  await page.route('**/api/v1/settings/commands', async (route) => {
    settingsCommandPosts += 1;
    submittedClientRequestId = (route.request().postDataJSON() as { clientRequestId: string })
      .clientRequestId;
    const response = await route.fetch();
    acceptedCommandId = ((await response.json()) as { outcome: { commandId: string } }).outcome
      .commandId;
    await route.abort('failed');
  });

  await applyButton.click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Draft status: Checking final outcome')).toBeVisible();
  expect(settingsCommandPosts).toBe(1);

  await page.unroute('**/api/v1/settings/commands');
  const recoveryEvidence = await page.evaluate(
    async ({ clientRequestId, commandId }) => {
      const outcomeResponse = await fetch(
        `/api/v1/frontend-commands/by-client-request/${encodeURIComponent(clientRequestId)}`,
      );
      const statusResponse = await fetch(
        `/api/v1/settings/commands/${encodeURIComponent(commandId)}`,
      );
      return {
        outcomeStatus: outcomeResponse.status,
        outcomeBody: await outcomeResponse.json(),
        commandStatus: statusResponse.status,
        commandBody: await statusResponse.json(),
      };
    },
    { clientRequestId: submittedClientRequestId, commandId: acceptedCommandId },
  );
  expect(recoveryEvidence.outcomeStatus).toBe(200);
  expect(recoveryEvidence.commandStatus).toBe(200);
  expect((recoveryEvidence.commandBody as { result: { status: string } }).result.status).toBe(
    'APPLIED',
  );
  await page.getByRole('button', { name: 'Resolve Existing Outcome' }).click();
  await expect(page.getByText('Draft status: Changes applied')).toBeVisible();
  expect(settingsCommandPosts).toBe(1);
});

test('Section 2 fails closed for stale, cross-project, and unavailable policy states', async ({
  page,
}) => {
  await page.goto('/settings/advanced');
  await page.getByLabel('Default Answer Model').fill('stale-browser-draft');
  await page.getByRole('button', { name: 'Validate & Preview' }).click();
  await expect(page.getByText('Draft status: Ready to apply')).toBeVisible();

  const externalApply = await page.evaluate(async () => {
    const snapshotResponse = await fetch('/api/v1/settings/snapshot?targetProjectId=shotgun');
    const snapshotBody = (await snapshotResponse.json()) as {
      snapshot: { settingsRevision: number; policyContextRevision: number };
    };
    const csrfResponse = await fetch('/api/v1/security/csrf');
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
    const id = crypto.randomUUID();
    const response = await fetch('/api/v1/settings/commands', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({
        envelopeVersion: '1.0.0',
        commandType: 'settings.project-policy.apply.v1',
        commandSchemaVersion: '1.0.0',
        clientRequestId: `external-${id}`,
        idempotencyKey: `external-${id}`,
        projectContext: {
          activeProjectId: 'shotgun',
          targetProjectId: 'shotgun',
          resourceProjectId: 'shotgun',
        },
        policyBinding: {
          mode: 'CURRENT',
          observedPolicyContextRevision: String(snapshotBody.snapshot.policyContextRevision),
        },
        preconditions: [
          {
            purpose: 'TARGET',
            subject: { resourceKind: 'project-settings', resourceId: 'shotgun' },
            expectedRevision: String(snapshotBody.snapshot.settingsRevision),
          },
          {
            purpose: 'POLICY',
            subject: { resourceKind: 'project-policy-context', resourceId: 'shotgun' },
            expectedRevision: String(snapshotBody.snapshot.policyContextRevision),
          },
        ],
        clientIssuedAt: new Date().toISOString(),
        payload: { settings: { 'models.defaultAnswerProfile': 'external-update' } },
      }),
    });
    return response.status;
  });
  expect(externalApply).toBe(200);

  await page.getByRole('button', { name: 'Apply Settings' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Draft status: Settings changed; refresh required')).toBeVisible();

  const crossProject = await page.evaluate(async () => {
    const csrfResponse = await fetch('/api/v1/security/csrf');
    const { csrfToken } = (await csrfResponse.json()) as { csrfToken: string };
    const id = crypto.randomUUID();
    const response = await fetch('/api/v1/projects/shotgun', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({
        envelopeVersion: '1.0.0',
        commandType: 'project.metadata.update.v1',
        commandSchemaVersion: '1.0.0',
        clientRequestId: `cross-${id}`,
        idempotencyKey: `cross-${id}`,
        projectContext: {
          activeProjectId: 'shotgun',
          targetProjectId: 'shotgun',
          resourceProjectId: 'project-b',
        },
        policyBinding: { mode: 'CURRENT' },
        preconditions: [
          {
            purpose: 'TARGET',
            subject: { resourceKind: 'project', resourceId: 'shotgun' },
            expectedRevision: '1',
          },
        ],
        clientIssuedAt: new Date().toISOString(),
        payload: { name: 'Must Not Apply' },
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(crossProject.status).toBe(400);
  expect((crossProject.body as { code: string }).code).toBe('RESOURCE_PROJECT_MISMATCH');

  await page.route('**/api/v1/settings/snapshot?targetProjectId=shotgun', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { snapshot: { settings: readonly unknown[] } };
    await route.fulfill({
      response,
      json: { snapshot: { ...body.snapshot, settings: [] } },
    });
  });
  await page.reload();
  await expect(
    page.getByText('Advanced policy editing is UNAVAILABLE for this Project.'),
  ).toBeVisible();
});
