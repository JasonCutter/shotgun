import { expect, test } from '@playwright/test';

import { ASK_FIXTURE } from './fixtures/ask-workspace-fixture.js';

test('Ask navigation exposes read-only workspace capability', async ({ page }) => {
  await page.goto('/ask');
  await expect(page.getByRole('heading', { name: 'Ask', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Question Draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit question' })).toBeDisabled();
  await expect(
    page.getByText('Server question submission is not active in this implementation slice.'),
  ).toBeVisible();
});

test('Ask draft blocks Project switching and is not moved to the next Project', async ({ page }) => {
  await page.goto('/ask');
  const questionInput = page.getByRole('textbox', { name: 'Question', exact: true });
  const projectSelector = page.getByRole('combobox', { name: 'Active Project' });

  await questionInput.fill('Transient browser draft question');
  await projectSelector.selectOption(ASK_FIXTURE.projectBId);
  await expect(projectSelector).toHaveValue(ASK_FIXTURE.projectAId);
  await expect(page.getByRole('alert')).toContainText('current Workspace');
  await expect(questionInput).toHaveValue('Transient browser draft question');

  await questionInput.fill('');
  await projectSelector.selectOption(ASK_FIXTURE.projectBId);
  await expect(projectSelector).toHaveValue(ASK_FIXTURE.projectBId);
  await expect(page.getByRole('heading', { name: 'Ask', level: 1 })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('');
});

test('Ask deep link uses accessible Resource Project without changing Active Project', async ({
  page,
}) => {
  await page.goto(`/ask/conversations/${ASK_FIXTURE.conversationId}`);

  await expect(page.getByRole('heading', { name: 'Ask', level: 1 })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: ASK_FIXTURE.conversationTitle, level: 3 }),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Active Project' })).toHaveValue(
    ASK_FIXTURE.projectAId,
  );
  await expect(page.getByText(`Project: ${ASK_FIXTURE.projectBId}`)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toBeEnabled();
});

test('Ask masks inaccessible Conversation as NOT_FOUND', async ({ page }) => {
  await page.goto(`/ask/conversations/${ASK_FIXTURE.inaccessibleConversationId}`);
  await expect(
    page.getByText(/requested conversation was not found|resource was not found/i),
  ).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Active Project' })).toHaveValue(
    ASK_FIXTURE.projectAId,
  );
});

test('Ask citation keeps SourceVersion pinned and restores exact conversation context', async ({
  page,
}) => {
  await page.goto(`/ask/conversations/${ASK_FIXTURE.conversationId}`);
  const projectSelector = page.getByRole('combobox', { name: 'Active Project' });
  await projectSelector.selectOption(ASK_FIXTURE.projectBId);
  await expect(projectSelector).toHaveValue(ASK_FIXTURE.projectBId);
  await expect(
    page.getByRole('heading', { name: ASK_FIXTURE.conversationTitle, level: 3 }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Open pinned Evidence' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/sources/${ASK_FIXTURE.sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?version=${ASK_FIXTURE.sourceVersionId}`,
    ),
  );
  await expect(page.getByText(ASK_FIXTURE.sourceVersionId)).toBeVisible();
  await expect(page.getByText(ASK_FIXTURE.sourceText)).toBeVisible();
  await expect(page.locator('.source-evidence-list li:focus')).toHaveCount(1);

  await page.getByRole('link', { name: 'Return to cited resource' }).click();
  await expect(page).toHaveURL(`/ask/conversations/${ASK_FIXTURE.conversationId}`);
  await expect(page.locator(`#citation-${ASK_FIXTURE.citationId}`)).toBeFocused();
  await expect(
    page.getByRole('heading', { name: ASK_FIXTURE.conversationTitle, level: 3 }),
  ).toBeVisible();
});
