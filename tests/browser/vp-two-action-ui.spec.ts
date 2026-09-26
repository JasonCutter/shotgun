import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import { tsImport } from 'tsx/esm/api';

type CrossPhaseBackend = {
  startFrontendCrossPhaseBackend(): Promise<{ close(): Promise<void> }>;
};

const BACKEND = 'http://127.0.0.1:3002';
const FRONTEND = 'http://127.0.0.1:5174';

test('VP browser journey uploads, revises, and answers from the latest source version', async ({
  page,
}) => {
  const fixture = (await tsImport(
    './fixtures/frontend-cross-phase-backend.ts',
    import.meta.url,
  )) as CrossPhaseBackend;
  const backend = await fixture.startFrontendCrossPhaseBackend();
  let frontend: ViteDevServer | undefined;

  try {
    const frontendRoot = path.resolve(process.cwd(), 'apps/shotgun-web');
    const frontendRequire = createRequire(path.join(frontendRoot, 'package.json'));
    const viteEntry = frontendRequire.resolve('vite');
    const vite = (await import(pathToFileURL(viteEntry).href)) as {
      createServer(options: unknown): Promise<ViteDevServer>;
    };
    const proxy = {
      '/api': { target: BACKEND, changeOrigin: false },
      '/product-api': { target: BACKEND, changeOrigin: false },
      '/health': { target: BACKEND, changeOrigin: false },
    };
    frontend = await vite.createServer({
      configFile: path.join(frontendRoot, 'vite.config.ts'),
      root: frontendRoot,
      server: { port: 5174, strictPort: true, proxy },
    });
    await frontend.listen();

    const bootstrap = await page.request.post(`${FRONTEND}/api/v1/session/local-bootstrap`, {
      data: {},
    });
    expect(bootstrap.ok()).toBe(true);
    const csrf = await page.request.get(`${FRONTEND}/api/v1/security/csrf`);
    const csrfToken = ((await csrf.json()) as { csrfToken?: string }).csrfToken;
    expect(csrfToken).toBeTruthy();
    const headers = { 'x-csrf-token': csrfToken as string };
    const projectId = `vp-ui-${randomUUID().slice(0, 12)}`;
    const project = await page.request.post(`${FRONTEND}/api/v1/projects`, {
      headers,
      data: {
        envelopeVersion: '1.0.0',
        commandType: 'project.create.v1',
        commandSchemaVersion: '1.0.0',
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        projectContext: {
          activeProjectId: 'shotgun',
          targetProjectId: 'shotgun',
          resourceProjectId: 'shotgun',
        },
        policyBinding: { mode: 'CURRENT' },
        preconditions: [],
        clientIssuedAt: new Date().toISOString(),
        payload: { newProjectId: projectId, name: projectId, description: 'VP UI journey' },
      },
    });
    expect(project.ok(), await project.text()).toBe(true);
    const switched = await page.request.post(`${FRONTEND}/api/v1/session/active-project`, {
      headers,
      data: { projectId },
    });
    expect(switched.ok(), await switched.text()).toBe(true);

    const sourceText = `VP browser source ${randomUUID().slice(0, 8)} says the project signal is amber.`;
    await page.goto(`${FRONTEND}/sources?view=add`);
    await page.locator('#source-intake-kind').selectOption('FILE');
    await page.locator('#source-intake-file').setInputFiles({
      name: 'vp-browser-source.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(sourceText),
    });
    const submissionResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/product-api/frontend/sources/submissions') &&
        response.request().method() === 'POST',
    );
    await page.locator('.source-intake-form button[type="submit"]').click();
    expect((await submissionResponse).ok()).toBe(true);

    await page.goto(`${FRONTEND}/ask`);
    await expect(page.locator('#global-ask-mode')).toHaveValue('AUTO_PROJECT_KNOWLEDGE');
    await page.locator('#global-ask-question').fill('What is the project signal?');
    const questionRequest = page.waitForRequest((request) =>
      request.url().endsWith('/product-api/frontend/ask/questions'),
    );
    await page.locator('.global-composer button[type="submit"]').click();
    expect((await questionRequest).postDataJSON()).toMatchObject({
      mode: 'AUTO_PROJECT_KNOWLEDGE',
      sourceSelections: [],
    });
    await expect(page.getByText(sourceText, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    const firstCitation = page.locator('.ask-citation-list a').first();
    await expect(firstCitation).toBeVisible();
    const previousHref = await firstCitation.getAttribute('href');
    expect(previousHref).toBeTruthy();
    const sourceId = new URL(previousHref as string, FRONTEND).pathname.split('/').at(-1);
    expect(sourceId).toBeTruthy();

    await firstCitation.click();
    await page.locator(`a[href*="view=add&sourceId=${sourceId}"]`).click();
    const revisedText = `VP browser source says the project signal is blue after revision ${randomUUID().slice(0, 8)}.`;
    await page.locator('#source-intake-kind').selectOption('FILE');
    await page.locator('#source-intake-file').setInputFiles({
      name: 'vp-browser-source.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(revisedText),
    });
    const revisedSubmission = page.waitForResponse(
      (response) =>
        response.url().endsWith('/product-api/frontend/sources/submissions') &&
        response.request().method() === 'POST',
    );
    await page.locator('.source-intake-form button[type="submit"]').click();
    const revisedResponse = await revisedSubmission;
    expect(revisedResponse.ok()).toBe(true);
    expect(revisedResponse.request().postDataJSON()).toMatchObject({
      payload: { inputs: [expect.objectContaining({ requestedSourceId: sourceId })] },
    });

    const secondSourceText = `An independent VP source ${randomUUID().slice(0, 8)} says the project signal is blue.`;
    await page.goto(`${FRONTEND}/sources?view=add`);
    await page.locator('#source-intake-kind').selectOption('FILE');
    await page.locator('#source-intake-file').setInputFiles({
      name: 'second-vp-source.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(secondSourceText),
    });
    const secondSubmission = page.waitForResponse(
      (response) =>
        response.url().endsWith('/product-api/frontend/sources/submissions') &&
        response.request().method() === 'POST',
    );
    await page.locator('.source-intake-form button[type="submit"]').click();
    expect((await secondSubmission).ok()).toBe(true);

    await page.goto(`${FRONTEND}/ask`);
    await page
      .locator('#global-ask-question')
      .fill('After the revision, what is the project signal?');
    await page.locator('.global-composer button[type="submit"]').click();
    await expect(page.getByText(revisedText, { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(secondSourceText, { exact: false }).first()).toBeVisible();
    const citationHrefs = await page
      .locator('.ask-turn')
      .last()
      .locator('.ask-citation-list a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    const citedSources = citationHrefs.map((href) => new URL(href as string, FRONTEND));
    expect(new Set(citedSources.map((url) => url.pathname)).size).toBeGreaterThanOrEqual(2);
    const currentSourceCitation = citedSources.find((url) =>
      url.pathname.endsWith(`/sources/${sourceId}`),
    );
    expect(currentSourceCitation?.searchParams.get('version')).not.toBe(
      new URL(previousHref as string, FRONTEND).searchParams.get('version'),
    );

    const otherProjectId = `vp-other-${randomUUID().slice(0, 12)}`;
    const freshCsrf = await page.request.get(`${FRONTEND}/api/v1/security/csrf`);
    const freshCsrfToken = ((await freshCsrf.json()) as { csrfToken?: string }).csrfToken;
    expect(freshCsrfToken).toBeTruthy();
    const freshHeaders = { 'x-csrf-token': freshCsrfToken as string };
    const otherProject = await page.request.post(`${FRONTEND}/api/v1/projects`, {
      headers: freshHeaders,
      data: {
        envelopeVersion: '1.0.0',
        commandType: 'project.create.v1',
        commandSchemaVersion: '1.0.0',
        clientRequestId: randomUUID(),
        idempotencyKey: randomUUID(),
        projectContext: {
          activeProjectId: projectId,
          targetProjectId: projectId,
          resourceProjectId: projectId,
        },
        policyBinding: { mode: 'CURRENT' },
        preconditions: [],
        clientIssuedAt: new Date().toISOString(),
        payload: {
          newProjectId: otherProjectId,
          name: otherProjectId,
          description: 'VP access test',
        },
      },
    });
    expect(otherProject.ok(), await otherProject.text()).toBe(true);
    const otherSwitch = await page.request.post(`${FRONTEND}/api/v1/session/active-project`, {
      headers: freshHeaders,
      data: { projectId: otherProjectId },
    });
    expect(otherSwitch.ok(), await otherSwitch.text()).toBe(true);
    await page.goto(`${FRONTEND}/sources?view=add&sourceId=${sourceId}`);
    await page.locator('#source-intake-kind').selectOption('FILE');
    await page.locator('#source-intake-file').setInputFiles({
      name: 'forbidden-revision.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('This cannot update another project source.'),
    });
    const rejectedSubmission = page.waitForResponse(
      (response) =>
        response.url().endsWith('/product-api/frontend/sources/submissions') &&
        response.request().method() === 'POST',
    );
    await page.locator('.source-intake-form button[type="submit"]').click();
    expect((await rejectedSubmission).ok()).toBe(false);
  } finally {
    await frontend?.close();
    await backend.close();
  }
});
