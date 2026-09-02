import { expect, test } from '@playwright/test';

test('HFM-S7-C6 Settings privacy flow: AI review required -> Privacy proposal -> Approval', async ({
  page,
}) => {
  const aiSettings = {
    projectId: 'shotgun',
    mode: 'PROJECT_MANAGED',
    defaultProviderId: 'deepseek',
    providers: [
      {
        providerId: 'deepseek',
        displayName: 'DeepSeek',
        status: 'active',
        models: [
          {
            providerId: 'deepseek',
            modelId: 'deepseek-chat',
            displayName: 'DeepSeek-V3',
            shotgunUsableCapabilities: ['general_reasoning'],
            capabilityRevision: '2026-08-01',
          },
        ],
      },
      {
        providerId: 'openai',
        displayName: 'OpenAI',
        status: 'active',
        models: [
          {
            providerId: 'openai',
            modelId: 'gpt-4o',
            displayName: 'GPT-4o',
            shotgunUsableCapabilities: ['general_reasoning'],
            capabilityRevision: '2026-08-01',
          },
        ],
      },
    ],
    credentialStatuses: [],
    privacy: [
      {
        providerId: 'openai',
        deploymentAllowed: false,
        legacyGeminiCompatibility: false,
      },
    ],
    vaultAvailability: {
      state: 'AVAILABLE',
      keyVersion: 'v1',
    },
    legacyGeminiCredentialConfigured: false,
  };

  await page.route('**/api/v1/settings/ai?*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ settings: aiSettings }),
      });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/v1/settings/ai', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ settings: aiSettings }),
      });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/v1/settings/ai/provider-privacy/proposals', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          proposal: {
            proposalId: 'prop-openai-1',
            projectId: 'shotgun',
            providerId: 'openai',
            approved: true,
            expectedApprovalRevision: 0,
            proposedBy: 'local-owner',
            status: 'PROPOSED',
            createdAt: new Date().toISOString(),
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.route('**/api/v1/settings/ai/provider-privacy/proposals/*/approve', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          approval: {
            projectId: 'shotgun',
            providerId: 'openai',
            approved: true,
            approvalRevision: 1,
            reviewedBy: 'local-owner',
            reviewedAt: new Date().toISOString(),
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  // 1. Establish session at Home, then navigate to Settings
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings & Preferences' })).toBeVisible();

  // Verify primary Settings navigation exposes ONLY the 4 primary categories
  const settingsNav = page.getByRole('navigation', { name: /Settings Categories/i });
  await expect(settingsNav.getByRole('link', { name: 'AI' })).toBeVisible();
  await expect(settingsNav.getByRole('link', { name: 'Privacy' })).toBeVisible();
  await expect(settingsNav.getByRole('link', { name: 'Preferences' })).toBeVisible();
  await expect(settingsNav.getByRole('link', { name: 'Project' })).toBeVisible();

  // Verify absence of legacy tabs
  await expect(settingsNav.getByRole('link', { name: 'Audit' })).toHaveCount(0);
  await expect(settingsNav.getByRole('link', { name: 'Secrets' })).toHaveCount(0);
  await expect(settingsNav.getByRole('link', { name: 'Backup' })).toHaveCount(0);
  await expect(settingsNav.getByRole('link', { name: 'Connectors' })).toHaveCount(0);

  // 2. Navigate to Settings > AI
  await settingsNav.getByRole('link', { name: 'AI' }).click();
  await expect(page.getByRole('heading', { name: 'AI', level: 2 })).toBeVisible({
    timeout: 15_000,
  });

  // Select a provider that requires privacy review (e.g. OpenAI)
  const providerSelect = page.getByLabel('AI Provider');
  await providerSelect.selectOption('openai');

  // The current Settings > AI contract uses the concise provider-scoped
  // status label and provides the Privacy workspace link for review.
  const privacyStatus = page.getByRole('region', { name: 'Privacy status' });
  await expect(privacyStatus.locator('p').filter({ hasText: 'Review required' })).toBeVisible();
  const privacyLink = page.getByRole('link', { name: /Review privacy in Settings → Privacy/i });
  await expect(privacyLink).toBeVisible();

  // 3. Click the navigation link to go to Settings > Privacy with provider context
  await privacyLink.click();
  await expect(page).toHaveURL(/\/settings\/privacy\?.*providerId=openai/);

  // 4. Verify Settings > Privacy has Provider Privacy and Project Privacy as separate sections
  const providerSection = page.locator('section[aria-labelledby="provider-privacy-heading"]');
  const projectSection = page.locator('section[aria-labelledby="project-privacy-heading"]');
  await expect(providerSection).toBeVisible();
  await expect(projectSection).toBeVisible();

  // Verify OpenAI is selected in Provider Privacy
  const privacyProviderSelect = providerSection.getByLabel('AI Provider');
  await expect(privacyProviderSelect).toHaveValue('openai');

  // 5. Request provider privacy approval
  const requestApprovalButton = providerSection.getByRole('button', {
    name: /Request (updated )?provider approval/i,
  });
  await expect(requestApprovalButton).toBeVisible();
  await requestApprovalButton.click();

  // Verify proposal pending message
  await expect(providerSection.getByText(/Review proposal pending for OpenAI:/i)).toBeVisible();

  // 6. Handle confirm dialog and explicitly approve
  page.on('dialog', (dialog) => void dialog.accept());
  const approveButton = providerSection.getByRole('button', {
    name: 'Approve provider review',
  });
  await expect(approveButton).toBeVisible();
  await approveButton.click();

  // Verify approval success message
  await expect(
    providerSection.getByText('Provider privacy approved for this provider.'),
  ).toBeVisible();

  // Verify Project Privacy remains intact and separate
  await expect(
    projectSection.getByRole('heading', { name: 'Project Privacy & External Data Transfer' }),
  ).toBeVisible();
});
