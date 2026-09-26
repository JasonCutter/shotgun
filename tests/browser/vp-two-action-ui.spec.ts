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

test('VP browser journey uploads one file and asks one automatic project question', async ({
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
    await expect(page.locator('.ask-citation-list a').first()).toBeVisible();
  } finally {
    await frontend?.close();
    await backend.close();
  }
});
