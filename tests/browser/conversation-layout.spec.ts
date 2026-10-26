import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

import {
  layoutEligibility,
  layoutSession,
  layoutShell,
  layoutTime,
  layoutWorkspace,
} from '../../apps/shotgun-web/src/test/conversation-layout-fixture.js';

const originalText = '원문을 보존하고 변경된 자료를 반영합니다.';
const metadata = {
  schemaVersion: '1.0.0',
  projectId: 'project-a',
  projectionRevision: '1',
  accessRevision: '1',
  policyContextRevision: '1',
  fetchedAt: layoutTime,
};

const installFixture = async (page: Page, denySources = false, denyAsk = false) => {
  const requests: string[] = [];
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(/\/(?:api\/v1|product-api\/frontend)\//, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    requests.push(`${route.request().method()} ${path}`);
    let body: unknown;
    if (path === '/api/v1/projects') body = { projects: [] };
    else if (path === '/api/v1/session') body = { session: layoutSession };
    else if (path === '/api/v1/security/csrf') body = { csrfToken: 'isolated-layout-csrf' };
    else if (path === '/api/v1/settings/preferences')
      body = { preferences: { locale: 'ko-KR' }, preferenceRevision: 1 };
    else if (path === '/product-api/frontend/global-shell') body = { shell: layoutShell };
    else if (path === '/product-api/frontend/route-guard') {
      const target = route.request().postDataJSON().targetRoute;
      const denied =
        (denySources && target.routeId === 'sources') || (denyAsk && target.routeId === 'ask');
      body = {
        decision: {
          schemaVersion: '1.0.0',
          ...(denied ? {} : { targetRoute: target }),
          decision: denied ? 'FEATURE_UNAVAILABLE' : 'ALLOW',
          masked: false,
          message: denied ? 'Access denied by fixture policy.' : 'Allowed.',
          accessRevision: '1',
          policyContextRevision: '1',
        },
      };
    } else if (path === '/product-api/frontend/ask')
      body = { workspace: layoutWorkspace(url.searchParams.get('conversationId') ?? undefined) };
    else if (
      /^\/product-api\/frontend\/ask\/answer-runs\/run-conversation-[ab](?:\/events)?$/.test(path)
    ) {
      const id = path.includes('run-conversation-a') ? 'conversation-a' : 'conversation-b';
      const run = layoutWorkspace(id).selectedConversation!.branches[0]!.turns[0]!.answerRun;
      body = path.endsWith('/events')
        ? { events: { schemaVersion: '1.0.0', answerRunId: run.answerRunId, events: [] } }
        : { answerRun: run };
    } else if (path === '/product-api/frontend/ask/provider-eligibility')
      body = { providerEligibility: layoutEligibility };
    else if (path === '/product-api/frontend/sources/query')
      body = {
        page: {
          ...metadata,
          principalId: 'principal-a',
          sessionId: 'session-a',
          items: [],
          queryDigest: 'fixture-query',
          stale: false,
        },
      };
    else if (path === '/product-api/frontend/sources/source-a')
      body = {
        source: {
          ...metadata,
          sourceId: 'source-a',
          label: '원문 보존과 자료 갱신',
          lifecycle: 'ACTIVE',
          mediaType: 'text/plain',
          sensitivity: 'private',
          currentSourceVersionId: 'version-a',
          versionCount: 1,
          previewReadiness: 'READY',
          askUsageState: 'EVIDENCE_READY',
          askUsageExplanation: 'Ready.',
          capabilities: ['PREVIEW'],
          sourceRevision: '1',
          createdAt: layoutTime,
          updatedAt: layoutTime,
        },
      };
    else if (path.endsWith('/sources/source-a/versions'))
      body = {
        history: {
          ...metadata,
          sourceId: 'source-a',
          selectedSourceVersionId: 'version-a',
          versions: [
            {
              sourceVersionId: 'version-a',
              versionNumber: 1,
              contentHash: 'fixture-hash',
              mediaType: 'text/plain',
              sizeBytes: 128,
              createdAt: layoutTime,
              transformationState: 'READY',
              evidenceCount: 1,
            },
          ],
        },
      };
    else if (path.endsWith('/versions/version-a/preview'))
      body = {
        preview: {
          ...metadata,
          sourceId: 'source-a',
          sourceVersionId: 'version-a',
          mediaType: 'text/plain',
          contentHash: 'fixture-hash',
          mode: 'ORIGINAL',
          readiness: 'READY',
          text: originalText,
          locators: [],
          capabilities: ['PREVIEW'],
        },
      };
    else if (path.endsWith('/versions/version-a/evidence'))
      body = {
        evidence: {
          ...metadata,
          sourceId: 'source-a',
          sourceVersionId: 'version-a',
          items: [
            {
              evidenceId: 'evidence-a',
              sourceId: 'source-a',
              sourceVersionId: 'version-a',
              revisionId: '1',
              label: originalText,
              exactText: originalText,
              origin: 'ORIGINAL',
              locators: [
                {
                  type: 'TextPositionSelector',
                  start: 0,
                  end: originalText.length,
                  unit: 'unicode-code-point',
                },
              ],
              createdAt: layoutTime,
            },
          ],
        },
      };
    else {
      unexpected.push(`${route.request().method()} ${path}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.fulfill({ json: body });
  });
  return { requests, unexpected, errors };
};

test('conversation, drafts, pins, guarded evidence, keyboard and desktop layout', async ({
  page,
}, testInfo) => {
  const fixture = await installFixture(page);
  await page.goto('/ask/conversations/conversation-a');
  await expect(page.getByText(/두 자료는 원문 근거를/)).toBeVisible();
  const input = page.locator('#global-ask-question');
  await input.fill('기존 대화의 작성 중 질문');
  const main = page.locator('#main-content');
  const composer = page.locator('.conversation-composer');
  const bounds = await main.boundingBox();
  expect(bounds!.width).toBeGreaterThan(1000);
  expect((await composer.boundingBox())!.y).toBeGreaterThan(bounds!.y);
  expect(await page.locator('[data-global-shell-region="evidence"]').count()).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('conversation.png'), fullPage: true });

  await page.getByRole('button', { name: '대화 고정: 자료의 차이와 공통점', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: '고정한 대화' })
      .getByRole('link', { name: '자료의 차이와 공통점' }),
  ).toBeVisible();
  await page.getByRole('link', { name: '새 대화', exact: true }).click();
  await expect(page.getByRole('heading', { name: '무엇이 궁금하신가요?' })).toBeVisible();
  await expect(input).toHaveValue('');
  await input.fill('새 대화의 작성 중 질문');
  await page.getByRole('link', { name: '자료의 차이와 공통점', exact: true }).click();
  await expect(input).toHaveValue('기존 대화의 작성 중 질문');
  await page.getByRole('link', { name: /고정된 근거 열기/ }).click();
  const evidence = page.getByRole('complementary', { name: '원문 근거', exact: true });
  await expect(evidence).toBeVisible();
  await expect(evidence.getByText(originalText, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/두 자료는 원문 근거를/)).toBeVisible();
  await expect(input).toHaveValue('기존 대화의 작성 중 질문');
  await expect(page).toHaveURL(/\/sources\/source-a\?version=version-a$/);
  await page.screenshot({ path: testInfo.outputPath('evidence.png'), fullPage: true });
  await evidence.getByRole('link', { name: '닫기', exact: true }).click();
  await expect(page).toHaveURL(/\/ask\/conversations\/conversation-a$/);
  await expect(page.locator('#citation-citation-a')).toBeFocused();
  await page.getByRole('button', { name: '사이드바 접기' }).click();
  await expect(page.getByRole('link', { name: '새 대화', exact: true })).toBeHidden();
  await page.getByRole('button', { name: '사이드바 펼치기' }).press('Enter');
  await expect(page.getByRole('link', { name: '새 대화', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('region', { name: '명령', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByText('설정', { exact: true }).click();
  await page.getByRole('link', { name: '사용 환경', exact: true }).click();
  await expect(input).toHaveValue('기존 대화의 작성 중 질문');
  await page.getByRole('link', { name: '대화로 돌아가기', exact: true }).click();
  await expect(input).toHaveValue('기존 대화의 작성 중 질문');
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations).toEqual([]);
  expect(fixture.requests).toContain('POST /product-api/frontend/route-guard');
  expect(fixture.requests).toContain(
    'GET /product-api/frontend/sources/source-a/versions/version-a/evidence',
  );
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('source policy denial never renders source detail or issues source reads', async ({
  page,
}) => {
  const fixture = await installFixture(page, true);
  await page.goto('/ask/conversations/conversation-a');
  await page.getByRole('link', { name: /고정된 근거 열기/ }).click();
  await expect(page.getByText('Access denied by fixture policy.')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '원문 보존과 자료 갱신', exact: true }),
  ).toHaveCount(0);
  expect(
    fixture.requests.some((request) => request.startsWith('GET /product-api/frontend/sources/')),
  ).toBe(false);
  expect(fixture.errors).toEqual([]);
});

test('pins survive reload and the desktop layout fits 1280px and 1920px windows', async ({
  page,
}, testInfo) => {
  const fixture = await installFixture(page);
  await page.goto('/ask/conversations/conversation-a');
  await page.getByRole('button', { name: '대화 고정: 자료의 차이와 공통점', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('region', { name: '고정한 대화' })).toBeVisible();
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('#global-ask-question')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('link', { name: /고정된 근거 열기/ }).click();
    const evidence = page.getByRole('complementary', { name: '원문 근거', exact: true });
    await expect(evidence.getByText(originalText, { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`evidence-${width}.png`), fullPage: true });
    await evidence.getByRole('link', { name: '닫기', exact: true }).click();
  }
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('Ask policy denial renders no conversation answer', async ({ page }) => {
  const fixture = await installFixture(page, false, true);
  await page.goto('/ask/conversations/conversation-a');
  await expect(page.getByText('Access denied by fixture policy.')).toBeVisible();
  await expect(page.getByText(/두 자료는 원문 근거를/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /고정된 근거 열기/ })).toHaveCount(0);
  expect(fixture.errors).toEqual([]);
});

test('a long conversation keeps its reading position across workspaces and Add Source keeps the draft', async ({
  page,
}) => {
  const fixture = await installFixture(page);
  await page.goto('/ask/conversations/conversation-b');
  const main = page.locator('#main-content');
  await expect(main.getByText(/두 자료는 원문 근거를/)).toBeVisible();
  await expect.poll(() => main.evaluate((element) => element.scrollHeight)).toBeGreaterThan(1500);
  await main.evaluate((element) => {
    element.scrollTop = 450;
  });
  await page.getByText('설정', { exact: true }).click();
  await page.getByRole('link', { name: '사용 환경', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/preferences$/);
  await page.getByRole('link', { name: '대화로 돌아가기', exact: true }).click();
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(450);
  await page.locator('#global-ask-question').fill('자료 추가 후에 이어 쓸 질문');
  await page.getByRole('link', { name: '자료 추가', exact: true }).click();
  await expect(page.locator('#source-intake-kind')).toBeVisible();
  await expect(page.locator('#global-ask-question')).toHaveValue('자료 추가 후에 이어 쓸 질문');
  expect(fixture.unexpected).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
