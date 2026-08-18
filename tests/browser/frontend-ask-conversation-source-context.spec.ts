import { expect, test } from '@playwright/test';

import { ASK_FIXTURE } from './fixtures/ask-workspace-fixture.js';
import { switchProject } from './helpers/hfm-commands.js';

test('Active B -> Conversation A uses only A Sources and submits the follow-up to A', async ({
  page,
}) => {
  await page.goto('/ask');
  await expect(page.locator('.project-summary')).toContainText('shotgun');

  const questionInput = page.getByRole('textbox', { name: 'Question', exact: true });
  await questionInput.fill('Create the Project A conversation for the cross-project boundary.');
  await page.getByRole('button', { name: 'Submit question' }).click();
  await expect(page).toHaveURL(/\/ask\/conversations\/[^/]+$/);
  const conversationUrl = new URL(page.url()).pathname;
  const conversationId = conversationUrl.split('/').at(-1)!;
  await expect(page.locator('.ask-workspace')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Request error' })).toHaveCount(0);

  await switchProject(page, 'Project B');
  await expect(page.locator('.project-summary')).toContainText('Project B');
  await page.goto(conversationUrl);
  await expect(page.locator('.project-summary')).toContainText('Project B');
  await expect(page.getByText('Project: shotgun')).toHaveCount(0);

  const sourceContextRequest = page.waitForRequest((request) =>
    request
      .url()
      .endsWith(`/product-api/frontend/ask/conversations/${conversationId}/source-context/query`),
  );
  await page.getByRole('combobox', { name: 'Ask mode' }).selectOption('SOURCE_EXPLORATION');
  const sourceRequestBody = (await sourceContextRequest).postDataJSON() as Record<string, unknown>;
  expect(Object.keys(sourceRequestBody).sort()).toEqual([
    'filters',
    'limit',
    'schemaVersion',
    'sort',
  ]);

  const projectASource = page.getByRole('checkbox', { name: /ask-exploration-source\.txt/ });
  await expect(projectASource).toBeVisible();
  await expect(page.getByText('ask-citation-source.txt')).toHaveCount(0);
  const projectASourceOption = projectASource.locator('xpath=ancestor::label');
  await expect(projectASourceOption.getByText('Version 1')).toBeVisible();
  await expect(projectASourceOption).not.toContainText(ASK_FIXTURE.selectableSourceVersionId);
  await projectASource.check();

  const followUp = 'Use the pinned Project A SourceVersion for this follow-up.';
  await questionInput.fill(followUp);
  const submitRequest = page.waitForRequest((request) =>
    request.url().endsWith('/product-api/frontend/ask/questions'),
  );
  const submitResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/product-api/frontend/ask/questions') && response.status() === 200,
  );
  await page.getByRole('button', { name: 'Submit question' }).click();
  expect((await submitRequest).postDataJSON()).toMatchObject({
    conversationId,
    sourceSelections: [
      {
        sourceId: ASK_FIXTURE.selectableSourceId,
        sourceVersionId: ASK_FIXTURE.selectableSourceVersionId,
        evidenceIds: [],
      },
    ],
  });
  expect(await (await submitResponse).json()).toMatchObject({
    submission: {
      answerRun: {
        conversationId,
        projectId: ASK_FIXTURE.projectAId,
        sourceSelections: [
          {
            sourceId: ASK_FIXTURE.selectableSourceId,
            sourceVersionId: ASK_FIXTURE.selectableSourceVersionId,
          },
        ],
      },
    },
  });
  await expect(
    page.getByLabel('Main Branch').getByRole('listitem').filter({ hasText: followUp }),
  ).toBeVisible();
  await expect(page.locator('.project-summary')).toContainText('Project B');
});
