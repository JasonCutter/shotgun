import { expect, test } from '@playwright/test';

import { ASK_FIXTURE } from './fixtures/ask-workspace-fixture.js';
import { switchProject } from './helpers/hfm-commands.js';
import { expectTechnicalInformation } from './hfm-technical.js';

test('Ask navigation enables question submission and clears draft on success', async ({ page }) => {
  await page.goto('/ask');
  await expect(page.getByRole('heading', { name: 'Ask', level: 1 })).toBeVisible();

  const questionInput = page.getByRole('textbox', { name: 'Question', exact: true });
  const question = 'How does command gateway handle idempotency?';
  await questionInput.fill(question);
  await expect(page.getByRole('button', { name: 'Submit question' })).toBeEnabled();

  await page.getByRole('button', { name: 'Submit question' }).click();
  await expect(questionInput).toHaveValue('');
  const submittedTurn = page
    .getByLabel('Main Branch')
    .getByRole('listitem')
    .filter({ hasText: question });
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
  await expect(sourceOption).not.toContainText(ASK_FIXTURE.selectableSourceVersionId);

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
    page
      .getByLabel('Main Branch')
      .getByRole('listitem')
      .filter({ hasText: 'What does the selected Source establish?' }),
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
      name: 'Conversations',
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
  await expect(page.getByText('Project: Project B')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toBeEnabled();
});

test('Ask Conversation current item and Answer actions remain clear in the fixed PC pane', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/ask/conversations/${ASK_FIXTURE.conversationId}`);

  const conversations = page.getByRole('list', { name: 'Conversations' });
  const currentConversation = conversations.getByText(ASK_FIXTURE.conversationTitle, {
    exact: true,
  });
  await expect(currentConversation.locator('xpath=ancestor::a')).toHaveCount(0);
  await expect(currentConversation.locator('xpath=ancestor::*[@aria-current="page"]')).toHaveCount(
    1,
  );
  await expect(conversations).not.toContainText('1 turn');
  await expect(conversations).not.toContainText('Completed');

  const actions = page.getByRole('button', { name: 'Answer actions', exact: true });
  await expect(actions).toBeVisible();
  for (const label of ['Helpful', 'Not helpful', 'Export answer', 'Propose Intake Draft']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
  const layout = await actions.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(1280);
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
  const evidenceView = page.getByRole('button', { name: 'Evidence' });
  await expect(evidenceView).toHaveAttribute('aria-current', 'page');
  await expect(evidenceView).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Original Preview' })).toHaveCount(0);
  const evidenceTarget = page.locator(`#evidence-${ASK_FIXTURE.evidenceId}`);
  await expect(evidenceTarget).toBeVisible();
  await expect(evidenceTarget).toBeFocused();

  const conversationPane = page.locator('[data-global-shell-region="conversation"]');
  await expect(conversationPane).toBeVisible();
  await expect(conversationPane).toContainText(ASK_FIXTURE.conversationTitle);
  await expect(page.locator('[data-global-shell-region="composer"]')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Global Composer' })).toHaveCount(1);

  await expect(page.locator('main')).not.toContainText(ASK_FIXTURE.sourceVersionId);
  await expectTechnicalInformation(page, ASK_FIXTURE.sourceVersionId);

  const primaryNav = page.getByRole('navigation', { name: 'Primary navigation' });
  await primaryNav.getByRole('link', { name: 'Selected Source' }).click();

  await expect(page).toHaveURL(
    new RegExp(
      `/sources/${ASK_FIXTURE.sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?version=${ASK_FIXTURE.sourceVersionId}`,
    ),
  );
  await expect(evidenceView).toHaveAttribute('aria-current', 'page');
  await expect(evidenceView).toHaveAttribute('aria-pressed', 'true');
  await expect(evidenceTarget).toBeVisible();
  await expect(conversationPane).toBeVisible();
  await expect(conversationPane).toContainText(ASK_FIXTURE.conversationTitle);
  await expect(page.locator('[data-global-shell-region="composer"]')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Global Composer' })).toHaveCount(1);

  await expect(page.locator('main')).not.toContainText(ASK_FIXTURE.sourceVersionId);
  await expectTechnicalInformation(page, ASK_FIXTURE.sourceVersionId);

  await page.getByRole('link', { name: 'Return to cited resource' }).click();
  await expect(page).toHaveURL(`/ask/conversations/${ASK_FIXTURE.conversationId}`);
  await expect(page.locator(`#citation-${ASK_FIXTURE.citationId}`)).toBeFocused();
  await expect(
    page.getByRole('heading', { name: ASK_FIXTURE.conversationTitle, level: 3 }),
  ).toBeVisible();
});

test('Global Composer slash input opens shared Center Command Mode without creating an Ask turn', async ({
  page,
}) => {
  const askRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/product-api/frontend/ask/questions')) {
      askRequests.push(request.url());
    }
  });

  await page.goto('/sources');
  const composer = page.getByRole('textbox', { name: 'Question', exact: true });
  await composer.fill('/ai');

  const commands = page.getByRole('region', { name: 'Commands' });
  await expect(commands).toBeVisible();
  await expect(commands.getByRole('textbox', { name: 'Command search' })).toHaveValue('ai');
  await expect(page.getByRole('dialog', { name: 'Commands' })).toHaveCount(0);
  expect(askRequests).toHaveLength(0);

  await page.keyboard.press('Escape');
  await expect(commands).toHaveCount(0);
  await expect(composer).toBeFocused();
  expect(askRequests).toHaveLength(0);
});

test('navigating from selected conversation to exact /ask with no draft activates new project question scope', async ({
  page,
}) => {
  await page.goto(`/ask/conversations/${ASK_FIXTURE.conversationId}`);
  await expect(
    page.getByRole('heading', { name: ASK_FIXTURE.conversationTitle, level: 3 }),
  ).toBeVisible();

  // Navigate to exact /ask with no draft
  await page.goto('/ask');
  await expect(page.getByRole('heading', { name: 'Ask', level: 1 })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: ASK_FIXTURE.conversationTitle, level: 3 }),
  ).toHaveCount(0);

  const questionInput = page.getByRole('textbox', { name: 'Question', exact: true });
  const newQuestion = 'What is the project architecture overview?';
  await questionInput.fill(newQuestion);
  await expect(page.getByRole('button', { name: 'Submit question' })).toBeEnabled();

  const submitRequestPromise = page.waitForRequest((request) =>
    request.url().endsWith('/product-api/frontend/ask/questions'),
  );
  await page.getByRole('button', { name: 'Submit question' }).click();

  const request = await submitRequestPromise;
  const postData = request.postDataJSON() as Record<string, unknown>;
  expect(postData.conversationId).toBeUndefined();
  expect(postData.question).toBe(newQuestion);
});
