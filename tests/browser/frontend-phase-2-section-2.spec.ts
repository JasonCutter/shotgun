import { expect, test } from '@playwright/test';

import { ASK_FIXTURE } from './fixtures/ask-workspace-fixture.js';
import { switchProject } from './helpers/hfm-commands.js';

test('Ask navigation enables question submission and clears draft on success', async ({ page }) => {
  await page.goto('/ask');
  await expect(page.getByRole('heading', { name: 'Ask', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Question Draft' })).toBeVisible();

  const questionInput = page.getByRole('textbox', { name: 'Question', exact: true });
  const question = 'How does command gateway handle idempotency?';
  await questionInput.fill(question);
  await expect(page.getByRole('button', { name: 'Submit question' })).toBeEnabled();

  await page.getByRole('button', { name: 'Submit question' }).click();
  await expect(questionInput).toHaveValue('');
  const submittedTurn = page.getByLabel('Main Branch').getByText(question, { exact: true });
  await expect(submittedTurn).toHaveCount(1);
  await expect(submittedTurn).toBeVisible();
});

test('Ask Source Exploration pins a selected SourceVersion into the browser submission', async ({
  page,
}) => {
  await page.goto('/ask');
  await page.getByRole('combobox', { name: 'Ask mode' }).selectOption('SOURCE_EXPLORATION');

  const source = page.getByRole('checkbox', { name: /ask-exploration-source\.txt/ });
  await expect(source).toBeVisible();
  const sourceOption = source.locator('xpath=ancestor::label');
  await expect(sourceOption.getByText('Version 1')).toBeVisible();
  const technicalDetails = sourceOption.locator('details');
  await expect(technicalDetails).not.toHaveAttribute('open', '');
  await technicalDetails.locator('summary').click();
  await expect(technicalDetails.getByText(ASK_FIXTURE.selectableSourceVersionId)).toBeVisible();

  const questionInput = page.getByRole('textbox', { name: 'Question', exact: true });
  await questionInput.fill('What does the selected Source establish?');
  const submitButton = page.getByRole('button', { name: 'Submit question' });
  await expect(submitButton).toBeDisabled();
  await expect(
    page.getByText('Select at least one Source before using selected sources.'),
  ).toBeVisible();

  await source.check();
  await expect(submitButton).toBeEnabled();
  const submitRequest = page.waitForRequest((request) =>
    request.url().endsWith('/product-api/frontend/ask/questions'),
  );
  await submitButton.click();

  expect((await submitRequest).postDataJSON()).toMatchObject({
    mode: 'SOURCE_EXPLORATION',
    sourceSelections: [
      {
        sourceId: ASK_FIXTURE.selectableSourceId,
        sourceVersionId: ASK_FIXTURE.selectableSourceVersionId,
        evidenceIds: [],
      },
    ],
  });
  await expect(questionInput).toHaveValue('');
  await expect(
    page.getByLabel('Main Branch').getByText('What does the selected Source establish?', {
      exact: true,
    }),
  ).toBeVisible();
});

test('Ask draft blocks Project switching and is not moved to the next Project', async ({
  page,
}) => {
  await page.goto('/ask');
  const questionInput = page.getByRole('textbox', { name: 'Question', exact: true });

  await questionInput.fill('Transient browser draft question');
  await switchProject(page, 'Project B');
  await expect(page.locator('.project-summary')).toContainText('shotgun');
  await expect(page.locator('.global-tools [aria-live="polite"]')).toContainText(
    'Resolve the current Workspace before switching Projects.',
  );
  await expect(questionInput).toHaveValue('Transient browser draft question');

  await questionInput.fill('');
  await switchProject(page, 'Project B');
  await expect(page.locator('.project-summary')).toContainText('Project B');
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', {
      name: 'Ask',
    })
    .click();
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
  await expect(page.locator('.project-summary')).toContainText('shotgun');
  await expect(page.getByText('Project: Project B')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toBeEnabled();
});

test('Ask Conversation current item and Answer actions remain clear on a narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/ask/conversations/${ASK_FIXTURE.conversationId}`);

  const conversations = page.getByRole('list', { name: 'Conversations' });
  const currentConversation = conversations.getByText(ASK_FIXTURE.conversationTitle, {
    exact: true,
  });
  await expect(currentConversation.locator('xpath=ancestor::a')).toHaveCount(0);
  await expect(currentConversation.locator('xpath=ancestor::*[@aria-current="page"]')).toHaveCount(
    1,
  );
  await expect(conversations).toContainText('1 turn');

  const actions = page.getByLabel('AnswerRun actions');
  for (const label of [
    'Export answer',
    'Helpful',
    'Not helpful',
    'Propose Intake Draft',
    'Propose Draft ChangeSet',
    'Propose Directive',
  ]) {
    await expect(actions.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  const layout = await actions.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    buttons: [...element.querySelectorAll('button')].map((button) => ({
      left: button.getBoundingClientRect().left,
      right: button.getBoundingClientRect().right,
    })),
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.buttons.every((button) => button.left >= 0 && button.right <= 320)).toBe(true);
});

test('Ask masks inaccessible Conversation as NOT_FOUND', async ({ page }) => {
  await page.goto(`/ask/conversations/${ASK_FIXTURE.inaccessibleConversationId}`);
  await expect(
    page.getByText(/requested conversation was not found|resource was not found/i),
  ).toBeVisible();
  await expect(page.locator('.project-summary')).toContainText('shotgun');
});

test('Ask citation keeps SourceVersion pinned and restores exact conversation context', async ({
  page,
}) => {
  await page.goto(`/ask/conversations/${ASK_FIXTURE.conversationId}`);
  await switchProject(page, 'Project B');
  await expect(page.locator('.project-summary')).toContainText('Project B');
  await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
  await page.goto(`/ask/conversations/${ASK_FIXTURE.conversationId}`);
  await expect(
    page.getByRole('heading', { name: ASK_FIXTURE.conversationTitle, level: 3 }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Open pinned Evidence' }).click();
  await expect(page).toHaveURL(
    new RegExp(
      `/sources/${ASK_FIXTURE.sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?version=${ASK_FIXTURE.sourceVersionId}`,
    ),
  );
  await expect(page.locator('pre.source-preview')).toContainText(ASK_FIXTURE.sourceText);
  const evidenceTarget = page.locator(`#evidence-${ASK_FIXTURE.evidenceId}`);
  await expect(evidenceTarget).toBeVisible();
  await expect(evidenceTarget).toBeFocused();

  const sourceDetails = page.locator('details').filter({ hasText: 'SourceVersion ID' }).first();
  await expect(sourceDetails).not.toHaveAttribute('open', '');
  await sourceDetails.locator('summary').click();
  await expect(sourceDetails.getByText(ASK_FIXTURE.sourceVersionId)).toBeVisible();

  await page.getByRole('link', { name: 'Return to cited resource' }).click();
  await expect(page).toHaveURL(`/ask/conversations/${ASK_FIXTURE.conversationId}`);
  await expect(page.locator(`#citation-${ASK_FIXTURE.citationId}`)).toBeFocused();
  await expect(
    page.getByRole('heading', { name: ASK_FIXTURE.conversationTitle, level: 3 }),
  ).toBeVisible();
});
